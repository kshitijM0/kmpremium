const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

const distDir = path.join(__dirname, "dist");
const siteDir = fs.existsSync(path.join(distDir, "index.html")) ? distDir : __dirname;

function dispatchAuto(req, res) {
  try {
    const handler = require("./api/auto");
    return handler(req, res);
  } catch (error) {
    console.error("[api/auto] Could not load API handler:", error);
    return res.status(500).json({
      success: false,
      error: "Auto API is not ready. Check that all required api/ and lib/ files are present."
    });
  }
}

// Vercel rewrite compatibility.
app.all("/api/admin/auth", (req, res) => {
  req.query = { ...req.query, route: "auth" };
  return dispatchAuto(req, res);
});
app.all("/api/panel-config", (req, res) => {
  req.query = { ...req.query, route: "panel-config" };
  return dispatchAuto(req, res);
});
app.all("/api/auto", dispatchAuto);

// Adapt existing Vercel-style API modules to Express, when those files exist.
app.all(/^\/api\/(.+)$/, (req, res) => {
  const relative = req.params[0];
  const apiRoot = path.resolve(__dirname, "api");
  const handlerPath = path.resolve(apiRoot, `${relative}.js`);

  if (!handlerPath.startsWith(apiRoot + path.sep) || !fs.existsSync(handlerPath)) {
    return res.status(404).json({ success: false, error: "API route not found." });
  }

  try {
    const handler = require(handlerPath);
    if (typeof handler !== "function") {
      return res.status(500).json({ success: false, error: "API handler must export a function." });
    }
    return handler(req, res);
  } catch (error) {
    console.error(`[api/${relative}]`, error);
    return res.status(500).json({ success: false, error: "API handler could not be loaded." });
  }
});

// Prevent private source/config files from being served publicly.
// This runs after API routing so /api endpoints above remain reachable.
app.use((req, res, next) => {
  const pathname = decodeURIComponent((req.path || "/").toLowerCase());
  const blocked = [
    /^\/lib(?:\/|$)/,
    /^\/supabase(?:\/|$)/,
    /^\/node_modules(?:\/|$)/,
    /^\/\.git(?:\/|$)/,
    /^\/api(?:\/|$)/,
    /^\/(server\.js|package\.json|package-lock\.json|vercel\.json|build\.js|setup\.txt)$/
  ];
  if (blocked.some((pattern) => pattern.test(pathname))) {
    return res.status(404).type("text/plain").send("Not found");
  }
  next();
});

app.use(express.static(siteDir, {
  index: "index.html",
  extensions: ["html"],
  fallthrough: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith(".css")) res.type("text/css");
    if (filePath.endsWith(".js")) res.type("application/javascript");
  }
}));

app.get("/auto-admin", (req, res) => {
  const adminFile = path.join(siteDir, "auto-admin.html");
  if (!fs.existsSync(adminFile)) return res.status(404).send("auto-admin.html not found");
  return res.sendFile(adminFile);
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  const indexFile = path.join(siteDir, "index.html");
  if (!fs.existsSync(indexFile)) return res.status(404).send("index.html not found");
  return res.sendFile(indexFile);
});

app.use((err, req, res, next) => {
  console.error("[server]", err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ success: false, error: "Internal server error." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`The KM server listening on port ${PORT}`);
});
