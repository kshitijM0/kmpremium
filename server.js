// The KM — Express server (Render / any Node host).
// Serves the built frontend from dist/ and runs the existing Vercel-style API handlers from api/.

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ---------- which folder is the website served from? ----------
const distDir = path.join(__dirname, "dist");
const hasDist = fs.existsSync(path.join(distDir, "index.html"));
const siteDir = hasDist ? distDir : __dirname;
console.log(
  hasDist
    ? "[server] Serving the production build from dist/"
    : "[server] WARNING: dist/ not found, serving files from the project root. Run `npm run build` first."
);

// ---------- startup check: environment variable NAMES only (values are never printed) ----------
const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "PROVIDER_ENCRYPTION_KEY",
  "KEY_SESSION_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN"
];
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missingEnv.length) {
  console.warn("[server] WARNING: these environment variables are not set: " + missingEnv.join(", "));
}

// ---------- helpers ----------
// Vercel handlers are `async (req, res)`. Express 4 does not catch their rejected promises,
// and on modern Node an unhandled rejection can crash the whole server. This wrapper makes
// sure any error becomes a clean JSON 500 instead.
function runHandler(handler, req, res, label) {
  return Promise.resolve()
    .then(() => handler(req, res))
    .catch((error) => {
      console.error(`[${label}]`, error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "Internal server error." });
      }
    });
}

function dispatchAuto(req, res) {
  let handler;
  try {
    handler = require("./api/auto");
  } catch (error) {
    console.error("[api/auto] Could not load API handler:", error);
    return res.status(500).json({
      success: false,
      error: "Auto API is not ready. Check that all required api/ and lib/ files are present."
    });
  }
  return runHandler(handler, req, res, "api/auto");
}

// ---------- health check (used by Render) ----------
app.get("/healthz", (req, res) => res.type("text/plain").send("ok"));

// ---------- API ----------
// Same rewrites as vercel.json.
app.all("/api/admin/auth", (req, res) => {
  req.query = { ...req.query, route: "auth" };
  return dispatchAuto(req, res);
});
app.all("/api/panel-config", (req, res) => {
  req.query = { ...req.query, route: "panel-config" };
  return dispatchAuto(req, res);
});
app.all("/api/auto", dispatchAuto);

// Every other file in api/ becomes /api/<name> (e.g. api/admin/keys.js -> /api/admin/keys).
app.all(/^\/api\/(.+)$/, (req, res) => {
  const relative = req.params[0];
  const apiRoot = path.resolve(__dirname, "api");
  const handlerPath = path.resolve(apiRoot, `${relative}.js`);

  if (!handlerPath.startsWith(apiRoot + path.sep) || !fs.existsSync(handlerPath)) {
    return res.status(404).json({ success: false, error: "API route not found." });
  }

  let handler;
  try {
    handler = require(handlerPath);
  } catch (error) {
    console.error(`[api/${relative}]`, error);
    return res.status(500).json({ success: false, error: "API handler could not be loaded." });
  }
  if (typeof handler !== "function") {
    return res.status(500).json({ success: false, error: "API handler must export a function." });
  }
  return runHandler(handler, req, res, `api/${relative}`);
});

// ---------- never serve private source / config files ----------
// Runs after API routing, so /api endpoints above stay reachable.
app.use((req, res, next) => {
  let pathname;
  try {
    pathname = decodeURIComponent(req.path || "/").toLowerCase();
  } catch {
    return res.status(400).type("text/plain").send("Bad request");
  }
  const blocked = [
    /^\/lib(?:\/|$)/,
    /^\/supabase(?:\/|$)/,
    /^\/node_modules(?:\/|$)/,
    /^\/api(?:\/|$)/,
    /(?:^|\/)\.[^/]/, // any dotfile or dot-folder: .env, .git, .gitignore ...
    /\.(?:sql|env|log|md)$/,
    /^\/(server\.js|package\.json|package-lock\.json|vercel\.json|build\.js|setup\.txt|deploy-render\.txt)$/
  ];
  if (blocked.some((pattern) => pattern.test(pathname))) {
    return res.status(404).type("text/plain").send("Not found");
  }
  next();
});

// ---------- frontend ----------
app.use(
  express.static(siteDir, {
    index: "index.html",
    extensions: ["html"], // /wallet -> wallet.html, /admin -> admin.html (same as Vercel cleanUrls)
    fallthrough: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".css")) res.type("text/css");
      if (filePath.endsWith(".js")) res.type("application/javascript");
      // always re-check pages and code with the server, so a new deploy shows up on the next visit
      if (/\.(?:html|css|js)$/i.test(filePath)) res.setHeader("Cache-Control", "no-cache");
    }
  })
);

app.get("/auto-admin", (req, res) => {
  const adminFile = path.join(siteDir, "auto-admin.html");
  if (!fs.existsSync(adminFile)) return res.status(404).send("auto-admin.html not found");
  return res.sendFile(adminFile);
});

// Fallback to index.html ONLY for page-like URLs (no file extension).
// A missing file such as /gate.js or /logo.png must be a real 404. Returning index.html for it
// is what caused the browser error  "Uncaught SyntaxError: Unexpected token '<'".
app.get("*", (req, res) => {
  if (path.extname(req.path)) {
    return res.status(404).type("text/plain").send("Not found");
  }
  const indexFile = path.join(siteDir, "index.html");
  if (!fs.existsSync(indexFile)) return res.status(404).send("index.html not found");
  return res.sendFile(indexFile);
});

// Anything else (e.g. POST to an unknown page).
app.use((req, res) => res.status(404).type("text/plain").send("Not found"));

// Errors (bad JSON body, body too large, unexpected failures).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err && (err.status === 400 || err.status === 413) ? err.status : 500;
  if (status === 500) console.error("[server]", err);
  const message =
    status === 400 ? "Invalid request body." : status === 413 ? "Request body too large." : "Internal server error.";
  return res.status(status).json({ success: false, error: message });
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`The KM server listening on port ${PORT}`);
  // Sends customers' custom comments to the provider at their scheduled time (see lib/auto/commentWorker.js).
  try {
    require("./lib/auto/commentWorker").start();
  } catch (error) {
    console.error("[comments] worker could not start:", error.message);
  }
});

// Render sends SIGTERM when it replaces the service with a new deploy: finish current requests first.
process.on("SIGTERM", () => {
  console.log("[server] SIGTERM received, shutting down");
  try {
    require("./lib/auto/commentWorker").stop();
  } catch {
    /* ignore */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
});
