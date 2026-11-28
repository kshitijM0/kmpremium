// The scheduler's storage: orders, their timed parts ("legs") and the activity log. Lives in Supabase.
const crypto = require("crypto");
const { getSupabaseAdmin } = require("../supabase");
const { encryptSecret, decryptSecret } = require("../crypto");
const { assertPublicHttpUrl } = require("../urlGuard");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 400;
const MAX_LEGS = 2000;
const MAX_FIRE_MS = 30 * 24 * 60 * 60 * 1000; // a part may be scheduled at most 30 days ahead

function statusOf(row) {
  if (row.paused) return "paused";
  return Number(row.open_legs) > 0 ? "running" : "completed";
}

function publicOrder(row) {
  return {
    id: String(row.id),
    name: row.name,
    link: row.link || "",
    status: statusOf(row),
    totalLegs: Number(row.total_legs) || 0,
    doneLegs: Number(row.done_legs) || 0,
    byCategory: row.by_category && typeof row.by_category === "object" ? row.by_category : {},
    nextFireAt: row.next_fire_at || null,
  };
}

function tryDecrypt(value) {
  if (!value) return null;
  try { return decryptSecret(value); } catch { return null; }
}

// legs: [{ category, serviceId, quantity, comments?, fireInMs, baseUrl?, apiKey?, providerId?, costUsd? }]
async function createOrder({ name, link, deviceTag, source, keyId, baseUrl, apiKeyEnc, legs }) {
  if (!Array.isArray(legs) || legs.length === 0 || legs.length > MAX_LEGS) throw new Error("The order has no valid parts.");
  const sb = getSupabaseAdmin();
  const now = Date.now();

  const cache = new Map();
  const enc = (k) => {
    if (!cache.has(k)) cache.set(k, encryptSecret(k));
    return cache.get(k);
  };

  const byCategory = {};
  const rows = legs.map((l) => {
    const quantity = Number(l.quantity);
    const fireIn = Number(l.fireInMs);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5_000_000) throw new Error("A part has an invalid quantity.");
    if (!Number.isFinite(fireIn) || fireIn < 0 || fireIn > MAX_FIRE_MS) throw new Error("A part has an invalid time.");
    const category = String(l.category || "other").slice(0, 30);
    byCategory[category] = (byCategory[category] || 0) + quantity;

    if (!l.providerId) {
      assertPublicHttpUrl(l.baseUrl); // customer-supplied panel: must be a public web address
      if (!l.apiKey || String(l.apiKey).length > 300) throw new Error("A part has no panel key.");
    }
    return {
      category,
      service_id: String(l.serviceId).slice(0, 50),
      quantity,
      comments: l.comments ? String(l.comments).slice(0, 40000) : null,
      base_url: l.providerId ? null : String(l.baseUrl).trim(),
      api_key_enc: l.providerId ? null : enc(String(l.apiKey)),
      provider_id: l.providerId ? String(l.providerId) : null,
      cost_usd: Number(l.costUsd) > 0 ? Number(l.costUsd) : 0,
      fire_at: new Date(now + fireIn).toISOString(),
    };
  });

  const first = legs[0];
  const { data: order, error } = await sb
    .from("sched_orders")
    .insert({
      name: String(name || "Untitled order").slice(0, 100),
      link,
      device_tag: deviceTag || null,
      source: source === "key" ? "key" : "manual",
      key_id: keyId || null,
      base_url: baseUrl || (first.providerId ? null : String(first.baseUrl).trim()),
      api_key_enc: apiKeyEnc || (first.providerId ? null : enc(String(first.apiKey))),
      by_category: byCategory,
    })
    .select("id")
    .single();
  if (error || !order) throw new Error("Could not save the order.");

  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK).map((r) => ({ ...r, order_id: order.id }));
      const { error: legError } = await sb.from("sched_legs").insert(part);
      if (legError) throw new Error("Could not save the order's parts.");
    }
  } catch (err) {
    await sb.from("sched_orders").delete().eq("id", order.id); // parts cascade
    throw err;
  }

  const total = Object.values(byCategory).reduce((a, b) => a + b, 0);
  await sb.from("sched_activity").insert({
    type: "order",
    base_url: baseUrl || (first.providerId ? null : String(first.baseUrl).trim()),
    api_key_enc: apiKeyEnc || (first.providerId ? null : enc(String(first.apiKey))),
    link,
    leg_count: rows.length,
    total_quantity: total,
  });

  return { id: order.id, legs: rows.length };
}

async function listForDevice(deviceTag) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("sched_orders_view")
    .select("id, name, link, by_category, paused, total_legs, done_legs, open_legs, next_fire_at, created_at")
    .eq("device_tag", deviceTag)
    .eq("deleted", false)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error("Could not load the orders.");
  return (data || []).map(publicOrder);
}

async function listAll() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("sched_orders_view")
    .select("id, name, link, device_tag, source, base_url, api_key_enc, by_category, paused, total_legs, done_legs, failed_legs, open_legs, next_fire_at, created_at")
    .eq("deleted", false)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error("Could not load the orders.");
  return (data || []).map((row) => ({
    ...publicOrder(row),
    device: row.device_tag ? `Device ${String(row.device_tag).slice(0, 6)}` : "Unknown device",
    source: row.source,
    baseUrl: row.base_url || null,
    apiKey: tryDecrypt(row.api_key_enc),
    failedLegs: Number(row.failed_legs) || 0,
  }));
}

// Pause / resume / delete. For a customer pass { ownerTag }: someone else's order looks exactly like a missing one.
async function act(id, action, { ownerTag } = {}) {
  if (!UUID_RE.test(String(id))) return { ok: false, notFound: true };
  const sb = getSupabaseAdmin();
  const { data: order } = await sb.from("sched_orders").select("id, device_tag, paused, deleted").eq("id", id).maybeSingle();
  if (!order || order.deleted) return { ok: false, notFound: true };
  if (ownerTag !== undefined && order.device_tag !== ownerTag) return { ok: false, notFound: true };

  if (action === "pause") {
    if (!order.paused) await sb.from("sched_orders").update({ paused: true, paused_at: new Date().toISOString() }).eq("id", id);
  } else if (action === "resume") {
    if (order.paused) {
      const { error } = await sb.rpc("sched_resume", { p_order_id: id });
      if (error) throw new Error("Could not resume the order.");
    }
  } else if (action === "delete") {
    await sb.from("sched_orders").update({ deleted: true }).eq("id", id);
    await sb.from("sched_legs").update({ status: "cancelled" }).eq("order_id", id).eq("status", "pending");
  } else {
    return { ok: false, badAction: true };
  }
  return { ok: true };
}

// What the Tracker tab draws: parts delivered to this link in the last 7 days.
async function history(link) {
  const sb = getSupabaseAdmin();
  const { data: orders } = await sb.from("sched_orders").select("id").eq("link", link).limit(100);
  if (!orders || orders.length === 0) return [];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: legs, error } = await sb
    .from("sched_legs")
    .select("category, quantity, sent_at")
    .in("order_id", orders.map((o) => o.id))
    .eq("status", "sent")
    .gte("sent_at", since)
    .order("sent_at", { ascending: true })
    .limit(5000);
  if (error) throw new Error("Could not load the history.");
  return (legs || []).map((l) => ({ category: l.category, amount: l.quantity, timestamp: Date.parse(l.sent_at) }));
}

// Called when someone connects a panel through /api/proxy. One row per panel+key per hour at most.
async function recordConnect(baseUrl, apiKey) {
  const sb = getSupabaseAdmin();
  const hour = new Date().toISOString().slice(0, 13);
  const dedupe = crypto.createHash("sha256").update(`${baseUrl}|${apiKey}|${hour}`).digest("hex");
  await sb.from("sched_activity").upsert({ type: "connect", base_url: baseUrl, api_key_enc: encryptSecret(apiKey), dedupe }, { onConflict: "dedupe", ignoreDuplicates: true });
}

async function listActivity(limit = 200) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("sched_activity")
    .select("created_at, type, base_url, api_key_enc, link, leg_count, total_quantity")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return null;
  return (data || []).map((r) => ({
    timestamp: Date.parse(r.created_at),
    type: r.type,
    baseUrl: r.base_url,
    apiKey: tryDecrypt(r.api_key_enc),
    link: r.link,
    legCount: r.leg_count,
    totalQuantity: r.total_quantity,
  }));
}

module.exports = { createOrder, listForDevice, listAll, act, history, recordConnect, listActivity, publicOrder, UUID_RE };
