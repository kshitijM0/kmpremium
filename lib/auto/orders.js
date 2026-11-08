// Schedules: what each device may see, and what the admin sees.
//   my-orders         GET   orders placed from THIS device (cookie), with every API detail removed
//   my-order-action   POST  { id, action: pause|resume|delete } — only on this device's own orders
//   schedule-order    POST  Manual-mode orders go through here so they get tied to this device
//   admin-orders      GET   (admin) every order + the scheduler's activity log, API details included
//   admin-order-action POST (admin) pause / resume / delete any order
const { isAdminRequest } = require("../adminSession");
const { getDevice, tagName, splitName } = require("./device");
const { call, listOrders, listActivity, orderAction, SAFE_ID, ACTIONS } = require("./scheduler");

function publicOrder(o) {
  const { name } = splitName(o.name);
  return {
    id: String(o.id),
    name,
    link: o.link || "",
    status: o.status || "running",
    totalLegs: Number(o.totalLegs) || 0,
    doneLegs: Number(o.doneLegs) || 0,
    byCategory: o.byCategory && typeof o.byCategory === "object" ? o.byCategory : {},
    nextFireAt: o.nextFireAt || null,
  };
}

function fail(res, err) {
  console.error("[schedules]", err.message);
  return res.status(502).json({ success: false, error: "The scheduler could not be reached. Try again in a minute." });
}

async function myOrders(req, res) {
  const device = getDevice(req, res); // a brand-new browser simply gets an empty list
  try {
    const all = await listOrders();
    const mine = all.filter((o) => splitName(o.name).tag === device.tag).map(publicOrder);
    return res.status(200).json({ success: true, orders: mine });
  } catch (err) {
    return fail(res, err);
  }
}

async function myOrderAction(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  const { id, action } = req.body || {};
  if (!SAFE_ID.test(String(id || "")) || !ACTIONS.has(action)) return res.status(400).json({ success: false, error: "Bad request." });

  const device = getDevice(req, res, { create: false });
  if (!device) return res.status(404).json({ success: false, error: "Order not found." });

  try {
    const all = await listOrders();
    const order = all.find((o) => String(o.id) === String(id));
    // someone else's order looks exactly like an order that doesn't exist
    if (!order || splitName(order.name).tag !== device.tag) return res.status(404).json({ success: false, error: "Order not found." });
    const r = await orderAction(id, action);
    if (!r.ok) return res.status(502).json({ success: false, error: "The scheduler refused that. Try again." });
    return res.status(200).json({ success: true });
  } catch (err) {
    return fail(res, err);
  }
}

// Manual-mode order: same payload the browser used to send straight to the scheduler, but the order name is
// tagged with this device first. The user's own panel credentials are only forwarded, never stored or listed.
async function scheduleOrder(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const body = req.body || {};
  const link = String(body.link || "").trim();
  if (!/^https?:\/\/\S+$/i.test(link) || link.length > 500) return res.status(400).json({ error: "Add a valid link starting with http(s)://" });
  if (!Array.isArray(body.legs) || body.legs.length === 0 || body.legs.length > 2000) return res.status(400).json({ error: "The order has no valid parts." });
  if (typeof body.baseUrl !== "string" || !/^https?:\/\//i.test(body.baseUrl) || typeof body.apiKey !== "string" || !body.apiKey) {
    return res.status(400).json({ error: "Connect a panel first." });
  }

  const device = getDevice(req, res);
  try {
    const r = await call("/schedule-order", { method: "POST", body: { ...body, link, name: tagName(body.name, device.tag) }, timeoutMs: 30000 });
    if (!r.data) return res.status(502).json({ error: `The scheduler answered HTTP ${r.status}.` });
    return res.status(r.ok ? 200 : r.status).json(r.data);
  } catch (err) {
    console.error("[schedule-order]", err.message);
    return res.status(502).json({ error: "The scheduler could not be reached. Try again in a minute." });
  }
}

async function adminOrders(req, res) {
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });
  try {
    const [orders, activity] = await Promise.all([listOrders(), listActivity().catch(() => null)]);
    const seen = new Map();
    const out = orders.map((o) => {
      const { name, tag } = splitName(o.name);
      if (tag && !seen.has(tag)) seen.set(tag, seen.size + 1);
      return {
        ...publicOrder(o),
        device: tag ? `Device ${tag.slice(0, 6)}` : "Before device tracking",
        baseUrl: o.baseUrl || null,
        apiKey: o.apiKey || null,
      };
    });
    return res.status(200).json({ success: true, orders: out, activity, devices: seen.size });
  } catch (err) {
    return fail(res, err);
  }
}

async function adminOrderAction(req, res) {
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  const { id, action } = req.body || {};
  if (!SAFE_ID.test(String(id || "")) || !ACTIONS.has(action)) return res.status(400).json({ success: false, error: "Bad request." });
  try {
    const r = await orderAction(id, action);
    if (!r.ok) return res.status(502).json({ success: false, error: "The scheduler refused that." });
    return res.status(200).json({ success: true });
  } catch (err) {
    return fail(res, err);
  }
}

module.exports = { myOrders, myOrderAction, scheduleOrder, adminOrders, adminOrderAction, publicOrder };
