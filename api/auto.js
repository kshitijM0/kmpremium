// ONE serverless function that serves several routes (keeps you under Vercel's function limit).
//   /api/auto?route=providers | mapping | services      Auto Order admin (providers, service mapping)
//   /api/auto?route=keys                                 admin: prepaid USD keys
//   /api/auto?route=key-catalog | key-order              customer: balance, rates, place an order with a key
//   /api/auto?route=my-orders | my-order-action | schedule-order   customer: only this device's orders
//   /api/auto?route=admin-orders | admin-order-action    admin: every order + API details
//   /api/admin/auth      -> route=auth                   admin login/logout       [see vercel.json]
//   /api/panel-config    -> route=panel-config           per-panel services       [see vercel.json]
const { catalogRoute, orderRoute } = require("../lib/auto/keyOrder");
const schedules = require("../lib/auto/orders");

const routes = {
  providers: require("../lib/auto/providers"),
  mapping: require("../lib/auto/mapping"),
  services: require("../lib/auto/services"),
  auth: require("../lib/auto/auth"),
  "panel-config": require("../lib/auto/panelConfig"),
  keys: require("../lib/auto/keys"),
  "key-catalog": catalogRoute,
  "key-order": orderRoute,
  "my-orders": schedules.myOrders,
  "my-order-action": schedules.myOrderAction,
  "schedule-order": schedules.scheduleOrder,
  "admin-orders": schedules.adminOrders,
  "admin-order-action": schedules.adminOrderAction,
};

module.exports = async (req, res) => {
  let route = req.query && req.query.route;

  // Older admin pages sent "?route=mapping?serviceType=views" (a second "?" instead of "&").
  // Understand that too, so a cached or old page keeps working.
  if (typeof route === "string" && route.includes("?")) {
    const [name, rest] = route.split("?");
    const merged = { ...req.query, route: name };
    new URLSearchParams(rest).forEach((value, key) => {
      if (merged[key] === undefined) merged[key] = value;
    });
    Object.defineProperty(req, "query", { value: merged, configurable: true, writable: true });
    route = name;
  }

  const handler = routes[route];
  if (!handler) return res.status(404).json({ success: false, error: "Unknown route." });
  try {
    return await handler(req, res);
  } catch (err) {
    console.error(`[api/auto:${route}]`, err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: err.message || "Server error." });
  }
};
