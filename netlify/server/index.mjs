// Netlify Server: runs the existing Vercel-style API handlers from api/ on Netlify.
// The website itself (index.html, script.js, ...) is served as static files from dist/ (see netlify.toml),
// so this server only receives /api/* requests.
import express from "express";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Every handler in api/, loaded on first use so one broken file can't take down the others.
// Paths are written out literally so the bundler includes each file in the deploy.
const handlers = {
  auto: () => import("../../api/auto.js"),
  session: () => import("../../api/session.js"),
  orders: () => import("../../api/orders.js"),
  "validate-key": () => import("../../api/validate-key.js"),
  "claim-free-key": () => import("../../api/claim-free-key.js"),
  "wallet-deposit": () => import("../../api/wallet-deposit.js"),
  "admin/wallet": () => import("../../api/admin/wallet.js"),
  "admin/keys": () => import("../../api/admin/keys.js"),
  "admin/generate-key": () => import("../../api/admin/generate-key.js"),
  "admin/logout": () => import("../../api/admin/logout.js"),
  "admin/orders": () => import("../../api/admin/orders.js"),
  "admin/list-keys": () => import("../../api/admin/list-keys.js"),
};

// Same rewrites as vercel.json.
const rewrites = {
  "admin/auth": { name: "auto", route: "auth" },
  "panel-config": { name: "auto", route: "panel-config" },
};

async function run(name, req, res) {
  let handler;
  try {
    const mod = await handlers[name]();
    handler = mod.default || mod;
  } catch (error) {
    console.error(`[api/${name}] Could not load API handler:`, error);
    return res.status(500).json({ success: false, error: "API handler could not be loaded." });
  }
  if (typeof handler !== "function") {
    return res.status(500).json({ success: false, error: "API handler must export a function." });
  }
  try {
    await handler(req, res);
  } catch (error) {
    console.error(`[api/${name}]`, error);
    if (!res.headersSent) res.status(500).json({ success: false, error: "Internal server error." });
  }
}

app.all(/^\/api\/(.+?)\/?$/, (req, res) => {
  const relative = req.params[0];
  const rewrite = rewrites[relative];
  if (rewrite) {
    Object.defineProperty(req, "query", {
      value: { ...req.query, route: rewrite.route },
      configurable: true,
      writable: true,
    });
    return run(rewrite.name, req, res);
  }
  if (!Object.hasOwn(handlers, relative)) {
    return res.status(404).json({ success: false, error: "API route not found." });
  }
  return run(relative, req, res);
});

app.use((req, res) => res.status(404).json({ success: false, error: "Not found." }));

// Bad JSON body, body too large, unexpected failures: always answer with JSON.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err && (err.status === 400 || err.status === 413) ? err.status : 500;
  if (status === 500) console.error("[server]", err);
  const message =
    status === 400 ? "Invalid request body." : status === 413 ? "Request body too large." : "Internal server error.";
  return res.status(status).json({ success: false, error: message });
});

export const config = {
  path: "/api/*",
};

export default app;
