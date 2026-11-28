// Schedules: what each device may see, and what the admin sees.
//   my-orders          GET   orders placed from THIS device (cookie), with every API detail removed
//   my-order-action    POST  { id, action: pause|resume|delete } — only on this device's own orders
//   schedule-order     POST  Manual-mode orders (the customer's own panel) are stored here, tied to this device
//   history            GET   ?link=...  what was delivered to a link in the last 7 days (Tracker tab)
//   admin-orders       GET   (admin) every order + the activity log, API details included
//   admin-order-action POST  (admin) pause / resume / delete any order
const { isAdminRequest } = require("../adminSession");
const { getDevice } = require("./device");
const store = require("../sched/store");

const ACTIONS = new Set(["pause", "resume", "delete"]);

function fail(res, err) {
  console.error("[schedules]", err.message);
  return res.status(500).json({ success: false, error: "Could not load the orders. Did you run supabase/scheduler-schema.sql?" });
}

async function myOrders(req, res) {
  const device = getDevice(req, res); // a brand-new browser simply gets an empty list
  try {
    return res.status(200).json({ success: true, orders: await store.listForDevice(device.tag) });
  } catch (err) {
    return fail(res, err);
  }
}

async function myOrderAction(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  const { id, action } = req.body || {};
  if (!ACTIONS.has(action)) return res.status(400).json({ success: false, error: "Bad request." });

  const device = getDevice(req, res, { create: false });
  if (!device) return res.status(404).json({ success: false, error: "Order not found." });
  try {
    const r = await store.act(String(id || ""), action, { ownerTag: device.tag });
    // someone else's order looks exactly like an order that doesn't exist
    if (!r.ok) return res.status(404).json({ success: false, error: "Order not found." });
    return res.status(200).json({ success: true });
  } catch (err) {
    return fail(res, err);
  }
}

// Manual-mode order: the browser sends the same payload as before (parts + the customer's own panel details).
// The panel key is stored encrypted and only decrypted at the moment a part is sent.
async function scheduleOrder(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const body = req.body || {};
  const link = String(body.link || "").trim();
  if (!/^https?:\/\/\S+$/i.test(link) || link.length > 500) return res.status(400).json({ error: "Add a valid link starting with http(s)://" });
  if (!Array.isArray(body.legs) || body.legs.length === 0 || body.legs.length > 2000) return res.status(400).json({ error: "The order has no valid parts." });
  if (typeof body.baseUrl !== "string" || typeof body.apiKey !== "string" || !body.apiKey) return res.status(400).json({ error: "Connect a panel first." });

  const device = getDevice(req, res);
  try {
    const legs = body.legs.map((l) => ({
      category: l && l.category,
      serviceId: l && l.serviceId,
      quantity: l && l.quantity,
      fireInMs: l && l.fireInMs,
      baseUrl: (l && l.baseUrl) || body.baseUrl,
      apiKey: (l && l.apiKey) || body.apiKey,
    }));
    if (legs.some((l) => l.serviceId === undefined || l.serviceId === null || l.serviceId === "")) return res.status(400).json({ error: "A part has no service." });
    const created = await store.createOrder({ name: String(body.name || "").trim(), link, deviceTag: device.tag, source: "manual", legs });
    return res.status(200).json({ scheduled: created.legs, orderId: created.id });
  } catch (err) {
    const clear = /panel|part|quantity|time|address|URL|port|IPv6|username/i.test(err.message);
    if (!clear) console.error("[schedule-order]", err.message);
    return res.status(clear ? 400 : 500).json({ error: clear ? err.message : "Could not save the order. Did you run supabase/scheduler-schema.sql?" });
  }
}

async function history(req, res) {
  const link = String((req.query && req.query.link) || "").trim();
  if (!/^https?:\/\/\S+$/i.test(link) || link.length > 500) return res.status(200).json([]);
  try {
    return res.status(200).json(await store.history(link));
  } catch (err) {
    console.error("[history]", err.message);
    return res.status(500).json({ error: "Could not load the history." });
  }
}

async function adminOrders(req, res) {
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });
  try {
    const [orders, activity] = await Promise.all([store.listAll(), store.listActivity().catch(() => null)]);
    const devices = new Set(orders.map((o) => o.device)).size;
    return res.status(200).json({ success: true, orders, activity, devices });
  } catch (err) {
    return fail(res, err);
  }
}

async function adminOrderAction(req, res) {
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  const { id, action } = req.body || {};
  if (!ACTIONS.has(action)) return res.status(400).json({ success: false, error: "Bad request." });
  try {
    const r = await store.act(String(id || ""), action);
    if (!r.ok) return res.status(404).json({ success: false, error: "Order not found." });
    return res.status(200).json({ success: true });
  } catch (err) {
    return fail(res, err);
  }
}

module.exports = { myOrders, myOrderAction, scheduleOrder, history, adminOrders, adminOrderAction };
