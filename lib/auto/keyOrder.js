// CUSTOMER side of the prepaid-key Auto flow.
//   GET/POST /api/auto?route=key-catalog   (header x-km-key)  -> balance + what's orderable + rates (USD / 1000)
//   POST     /api/auto?route=key-order     (header x-km-key)  -> charge the key, then hand the legs to the scheduler
//
// The browser NEVER sees provider names, provider keys or service ids. The server picks the services from
// the admin's Service Mapping, charges the admin's customer_rate, and forwards the legs to the same
// scheduler (/schedule-order) the site already uses.
const { getSupabaseAdmin } = require("../supabase");
const { decryptSecret } = require("../crypto");
const { requireUsableKey, maskKey, round4 } = require("./keyStore");

// browser key -> service_mapping.service_type
const TYPE_MAP = { views: "views", likes: "likes", share: "shares", save: "saves", repost: "reposts", comments: "comments" };
const LABELS = { views: "Views", likes: "Likes", share: "Share", save: "Save", repost: "Repost", comments: "Comments" };
const WINDOWS = { pending: [360, 720], mid: [720, 1440], approved: [1440, 2880] }; // minutes: 6-12h, 12-24h, 24-48h
const MAX_LEGS_PER_TYPE = 400;
const MAX_TOTAL_LEGS = 1500;
const MAX_QTY_PER_TYPE = 5_000_000;
const MAX_COMMENTS = 500;

function renderBase() {
  return (process.env.RENDER_PROXY_URL || "https://kmpanel.onrender.com").replace(/\/+$/, "");
}

// What can be ordered right now, built from the admin's Service Mapping.
async function loadCatalog(supabase) {
  const { data: maps, error } = await supabase
    .from("service_mapping")
    .select("service_type, provider_id, provider_service_id, customer_rate, display_order, api_providers(id, api_url, encrypted_api_key, status)")
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (error) throw new Error("Could not load services.");

  const usable = (maps || []).filter((m) => m.api_providers && m.api_providers.status === "active");
  const providerIds = [...new Set(usable.map((m) => m.provider_id))];

  let limits = [];
  if (providerIds.length) {
    const { data } = await supabase.from("provider_services").select("provider_id, service_id, minimum, maximum").in("provider_id", providerIds);
    limits = data || [];
  }

  const services = {};
  for (const [clientKey, dbType] of Object.entries(TYPE_MAP)) {
    const rows = usable.filter((m) => m.service_type === dbType);
    const rates = rows.map((m) => Number(m.customer_rate)).filter((n) => Number.isFinite(n) && n > 0);
    if (!rows.length || !rates.length) continue; // not orderable until the admin sets a customer rate

    let min = 1;
    let max = MAX_QTY_PER_TYPE;
    rows.forEach((m) => {
      const lim = limits.find((l) => l.provider_id === m.provider_id && String(l.service_id) === String(m.provider_service_id));
      if (lim && Number(lim.minimum) > 0) min = Math.max(min, Number(lim.minimum));
      if (lim && Number(lim.maximum) > 0) max = Math.min(max, Number(lim.maximum));
    });

    services[clientKey] = {
      rate: round4(rates.reduce((a, b) => a + b, 0) / rates.length), // one flat rate per type, so the estimate always equals the charge
      min,
      max,
      mappings: rows.map((m) => ({ provider: m.api_providers, providerServiceId: String(m.provider_service_id) })),
    };
  }
  return services;
}

async function catalogRoute(req, res) {
  const supabase = getSupabaseAdmin();
  const keyRow = await requireUsableKey(req, res, supabase);
  if (!keyRow) return;

  const services = await loadCatalog(supabase);
  const out = {};
  for (const [k, s] of Object.entries(services)) out[k] = { rate: s.rate, min: s.min, max: s.max };

  return res.status(200).json({
    success: true,
    key: { masked: maskKey(keyRow.key_value), remaining: Number(keyRow.remaining_usd), initial: Number(keyRow.initial_usd), status: keyRow.status },
    services: out,
    windows: WINDOWS,
  });
}

// Validates the plan the browser built and works out the exact cost. Returns { error } or { legsByType, cost, perType }.
function validatePlan(plan, services, windowMax) {
  if (!plan || typeof plan !== "object") return { error: "Missing order details." };
  const legsByType = {};
  const perType = {};
  let cost = 0;
  let totalLegs = 0;

  for (const k of Object.keys(TYPE_MAP)) {
    const p = plan[k];
    const rawLegs = p && Array.isArray(p.legs) ? p.legs : [];
    if (!rawLegs.length) continue;

    const svc = services[k];
    if (!svc) return { error: `${LABELS[k]} isn't available right now.` };
    if (rawLegs.length > MAX_LEGS_PER_TYPE) return { error: `${LABELS[k]}: too many parts.` };

    let total = 0;
    const legs = [];
    for (const l of rawLegs) {
      const amount = Number(l && l.amount);
      const minutesAt = Number(l && l.minutesAt);
      if (!Number.isInteger(amount) || amount < 1) return { error: `${LABELS[k]}: invalid quantity.` };
      if (!Number.isFinite(minutesAt) || minutesAt < 0 || minutesAt > windowMax * 1.02 + 5) return { error: `${LABELS[k]}: invalid timing.` };
      if (amount < svc.min) return { error: `${LABELS[k]}: the minimum is ${svc.min.toLocaleString("en-US")}.` };
      if (amount > svc.max) return { error: `${LABELS[k]}: too large for one part (max ${svc.max.toLocaleString("en-US")}).` };
      total += amount;
      legs.push({ amount, minutesAt });
    }
    if (total > MAX_QTY_PER_TYPE) return { error: `${LABELS[k]}: quantity is too large.` };
    legs.sort((a, b) => a.minutesAt - b.minutesAt);

    if (k === "comments") {
      const lines = (Array.isArray(p.lines) ? p.lines : []).map((s) => String(s).trim()).filter(Boolean);
      if (!lines.length) return { error: "Write at least one comment." };
      if (lines.length > MAX_COMMENTS) return { error: `Comments: at most ${MAX_COMMENTS} lines.` };
      if (lines.some((s) => s.length > 300)) return { error: "Each comment must be 300 characters or fewer." };
      if (lines.length !== total) return { error: "Comment count doesn't match your lines." };
      let cursor = 0;
      legs.forEach((l) => { l.comments = lines.slice(cursor, cursor + l.amount).join("\n"); cursor += l.amount; });
    }

    totalLegs += legs.length;
    const typeCost = round4((total / 1000) * svc.rate);
    cost += typeCost;
    legsByType[k] = legs;
    perType[k] = { quantity: total, cost: typeCost };
  }

  if (!legsByType.views) return { error: "Views are required for an order." };
  if (perType.views.quantity < 1000) return { error: "Views: the minimum order is 1,000." };
  if (totalLegs > MAX_TOTAL_LEGS) return { error: "This order has too many parts. Reduce the quantity." };
  return { legsByType, perType, cost: round4(cost), totalLegs };
}

async function scheduleOnRender({ name, link, legsByType, services }) {
  const used = new Map(); // decrypted keys, once per provider
  const legs = [];
  let firstProvider = null;

  for (const k of Object.keys(legsByType)) {
    const maps = services[k].mappings;
    const given = maps.map(() => 0); // quantity handed to each panel so far
    legsByType[k].forEach((l) => {
      // Every part goes to the panel that has received the LEAST so far, in time order. So each order is split
      // about 50/50 by quantity between the panels (never one panel for one order and the other for the next),
      // and both panels keep delivering from the first minute to the last.
      let pick = 0;
      for (let j = 1; j < maps.length; j++) if (given[j] < given[pick]) pick = j;
      given[pick] += l.amount;
      const m = maps[pick];
      if (!used.has(m.provider.id)) used.set(m.provider.id, { url: m.provider.api_url, key: decryptSecret(m.provider.encrypted_api_key) });
      const prov = used.get(m.provider.id);
      if (!firstProvider && k === "views") firstProvider = prov;
      const leg = {
        serviceId: m.providerServiceId,
        link,
        quantity: l.amount,
        category: k,
        serviceLabel: LABELS[k],
        baseUrl: prov.url,
        apiKey: prov.key,
        fireInMs: Math.round(l.minutesAt * 60000),
      };
      if (l.comments) leg.comments = l.comments;
      legs.push(leg);
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const r = await fetch(`${renderBase()}/schedule-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, link, baseUrl: firstProvider.url, apiKey: firstProvider.key, legs }),
      signal: controller.signal,
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not json */ }
    if (!r.ok || !data || data.error) throw new Error((data && data.error) || `Scheduler answered HTTP ${r.status}`);
    return { scheduled: Number(data.scheduled) || legs.length };
  } finally {
    clearTimeout(timer);
  }
}

async function orderRoute(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  const supabase = getSupabaseAdmin();
  const keyRow = await requireUsableKey(req, res, supabase);
  if (!keyRow) return;

  const body = req.body || {};
  const link = String(body.link || "").trim();
  if (!/^https?:\/\/\S+$/i.test(link) || link.length > 500) return res.status(400).json({ success: false, error: "Add a valid link starting with http(s)://" });
  const windowChoice = String(body.window || "");
  if (!WINDOWS[windowChoice]) return res.status(400).json({ success: false, error: "Choose Pending, Mid or Approved." });
  const name = String(body.name || "").trim().slice(0, 100) || "Auto order";
  const clientToken = body.clientToken ? String(body.clientToken).slice(0, 64) : null;

  // Same click sent twice (retry / double tap) -> answer with the first result, never charge again.
  if (clientToken) {
    const { data: prev } = await supabase.from("auto_key_orders").select("id, status, cost_usd, legs_count").eq("key_id", keyRow.id).eq("client_token", clientToken).maybeSingle();
    if (prev) {
      if (prev.status === "scheduled") {
        const { data: fresh } = await supabase.from("auto_keys").select("remaining_usd, status").eq("id", keyRow.id).maybeSingle();
        return res.status(200).json({ success: true, replay: true, cost: Number(prev.cost_usd), remaining: fresh ? Number(fresh.remaining_usd) : null, status: fresh ? fresh.status : "active", scheduledLegs: prev.legs_count });
      }
      if (prev.status === "pending") return res.status(409).json({ success: false, error: "This order is still being placed. Wait a few seconds." });
      return res.status(409).json({ success: false, error: "That attempt failed. Press Create Order again." });
    }
  }

  const services = await loadCatalog(supabase);
  const plan = validatePlan(body.plan, services, WINDOWS[windowChoice][1]);
  if (plan.error) return res.status(400).json({ success: false, error: plan.error });
  if (plan.cost < 0.0001) return res.status(400).json({ success: false, error: "Order is too small." });

  const { data: orderRow, error: insErr } = await supabase
    .from("auto_key_orders")
    .insert({ key_id: keyRow.id, client_token: clientToken, order_name: name, link, window_choice: windowChoice, cost_usd: plan.cost, legs_count: plan.totalLegs, quantities: plan.perType, status: "pending" })
    .select("id")
    .single();
  if (insErr) {
    if (String(insErr.code) === "23505") return res.status(409).json({ success: false, error: "This order is already being placed." });
    return res.status(500).json({ success: false, error: "Could not start the order. Did you run auto-keys-schema.sql?" });
  }

  // 1) take the money (atomic)
  const { data: spendData, error: spendErr } = await supabase.rpc("auto_key_spend", { p_key_id: keyRow.id, p_amount: plan.cost });
  const spend = Array.isArray(spendData) ? spendData[0] : spendData;
  if (spendErr) {
    await supabase.from("auto_key_orders").update({ status: "failed", error: "spend error" }).eq("id", orderRow.id);
    return res.status(500).json({ success: false, error: "Could not charge the key. Nothing was ordered." });
  }
  if (!spend || !spend.ok) {
    await supabase.from("auto_key_orders").update({ status: "rejected", error: "insufficient balance" }).eq("id", orderRow.id);
    const { data: fresh } = await supabase.from("auto_keys").select("remaining_usd").eq("id", keyRow.id).maybeSingle();
    return res.status(402).json({ success: false, code: "insufficient", error: "Not enough balance for this order.", required: plan.cost, available: fresh ? Number(fresh.remaining_usd) : 0 });
  }

  // 2) hand the legs to the scheduler; give the money back if that fails
  try {
    const { scheduled } = await scheduleOnRender({ name, link, legsByType: plan.legsByType, services });
    await supabase.from("auto_key_orders").update({ status: "scheduled", legs_count: scheduled }).eq("id", orderRow.id);
    await supabase.from("auto_key_events").insert({ key_id: keyRow.id, type: "order", amount: -plan.cost, balance_after: spend.remaining, note: name });
    return res.status(200).json({ success: true, cost: plan.cost, remaining: Number(spend.remaining), status: spend.new_status, scheduledLegs: scheduled });
  } catch (err) {
    console.error("[key-order] scheduling failed:", err.message);
    const { data: refundData } = await supabase.rpc("auto_key_credit", { p_key_id: keyRow.id, p_amount: plan.cost, p_is_topup: false });
    const refund = Array.isArray(refundData) ? refundData[0] : refundData;
    await supabase.from("auto_key_orders").update({ status: "failed", error: String(err.message).slice(0, 300) }).eq("id", orderRow.id);
    await supabase.from("auto_key_events").insert({ key_id: keyRow.id, type: "refund", amount: plan.cost, balance_after: refund ? refund.remaining : null, note: "scheduler failed" });
    return res.status(502).json({ success: false, error: "Couldn't start delivery, so you weren't charged. Please try again in a minute.", remaining: refund ? Number(refund.remaining) : null });
  }
}

module.exports = { catalogRoute, orderRoute, loadCatalog, validatePlan, WINDOWS, TYPE_MAP };
