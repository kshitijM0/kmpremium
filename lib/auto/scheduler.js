// Server-side client for the external scheduler (kmpanel). The browser never talks to its /orders or
// /activity-log endpoints any more; only this server does, and it filters what each person may see.
function base() {
  return (process.env.RENDER_PROXY_URL || "https://kmpanel.onrender.com").replace(/\/+$/, "");
}

async function call(path, { method = "GET", body, timeoutMs = 20000 } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // optional shared secret: once the scheduler is told to require it, only this server can read the order lists
  if (process.env.KM_SCHEDULER_SECRET) headers["x-km-secret"] = process.env.KM_SCHEDULER_SECRET;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base()}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not json */ }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function listOrders() {
  const r = await call("/orders");
  if (!r.ok || !Array.isArray(r.data)) throw new Error(`The scheduler did not return the orders (HTTP ${r.status}).`);
  return r.data;
}

async function listActivity() {
  const r = await call("/activity-log");
  if (!r.ok || !Array.isArray(r.data)) return null;
  return r.data;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ACTIONS = new Set(["pause", "resume", "delete"]);

async function orderAction(id, action) {
  if (!SAFE_ID.test(String(id)) || !ACTIONS.has(action)) throw new Error("Bad request.");
  const path = `/orders/${encodeURIComponent(id)}`;
  return action === "delete" ? call(path, { method: "DELETE" }) : call(`${path}/${action}`, { method: "POST" });
}

module.exports = { call, listOrders, listActivity, orderAction, SAFE_ID, ACTIONS };
