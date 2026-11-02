// ONE serverless function that serves several routes (keeps you under Vercel's function limit).
//   /api/auto?route=providers | mapping | services      Auto Order admin (providers, service mapping)
//   /api/auto?route=keys                                 admin: prepaid USD keys
//   /api/auto?route=key-catalog | key-order              customer: balance, rates, place an order with a key
//   /api/admin/auth      -> route=auth                   admin login/logout       [see vercel.json]
//   /api/panel-config    -> route=panel-config           per-panel services       [see vercel.json]
const { catalogRoute, orderRoute } = require("../lib/auto/keyOrder");

const routes = {
  providers: require("../lib/auto/providers"),
  mapping: require("../lib/auto/mapping"),
  services: require("../lib/auto/services"),
  auth: require("../lib/auto/auth"),
  "panel-config": require("../lib/auto/panelConfig"),
  keys: require("../lib/auto/keys"),
  "key-catalog": catalogRoute,
  "key-order": orderRoute,
};

module.exports = async (req, res) => {
  const route = req.query && req.query.route;
  const handler = routes[route];
  if (!handler) return res.status(404).json({ success: false, error: "Unknown route." });
  try {
    return await handler(req, res);
  } catch (err) {
    console.error(`[api/auto:${route}]`, err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: err.message || "Server error." });
  }
};
