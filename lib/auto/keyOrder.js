// CUSTOMER side of the prepaid-key Auto flow.
//   GET/POST /api/auto?route=key-catalog   (header x-km-key)  -> balance + what's orderable + rates (USD / 1000)
//   POST     /api/auto?route=key-order     (header x-km-key)  -> charge the key, then store the timed parts in the scheduler
//
// The browser NEVER sees provider names, provider keys or service ids. The server picks the services from
// the admin's Service Mapping, charges the admin's customer_rate, and saves the parts in the built-in scheduler
// (lib/sched); the cron job sends each part at its time.
const { getSupabaseAdmin } = require("../supabase");
const { requireUsableKey, maskKey, round4 } = require("./keyStore");
const { getDevice } = require("./device");
const store = require("../sched/store");

// browser key -> service_mapping.service_type
const TYPE_MAP = { views: "views", likes: "likes", share: "shares", save: "saves", repost: "reposts", comments: "comments" };
const LABELS = { views: "Views", likes: "Likes", share: "Share", save: "Save", repost: "Repost", comments: "Comments" };
const WINDOWS = { pending: [360, 720], mid: [720, 1440], approved: [1440, 2880] }; // minutes: 6-12h, 12-24h, 24-48h
const MAX_LEGS_PER_TYPE = 400;
const MAX_TOTAL_LEGS = 1500;
const MAX_QTY_PER_TYPE = 5_000_000;
const MAX_COMMENTS = 500;

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

// Turns the validated plan into scheduler parts. Every part is paid for, so it carries its own price: if it can't
// be delivered, the key is refunded for exactly that part.
// Panels share each service's quantity (about 50/50 when there are two), then the services inside each panel.
// Each part goes to whoever has received the least so far, in time order, so one order is never sent to a single
// panel and every panel keeps delivering from the first minute to the last.
function buildLegs(legsByType, services) {
  const legs = [];
  let firstProvider = null;

  for (const k of Object.keys(legsByType)) {
    const panels = [];
    services[k].mappings.forEach((mp) => {
      let panel = panels.find((x) => x.id === mp.provider.id);
      if (!panel) {
        panel = { id: mp.provider.id, given: 0, maps: [], givenBy: [] };
        panels.push(panel);
      }
      panel.maps.push(mp);
      panel.givenBy.push(0);
    });

    legsByType[k].forEach((l) => {
      let pi = 0;
      for (let j = 1; j < panels.length; j++) if (panels[j].given < panels[pi].given) pi = j;
      const panel = panels[pi];
      let si = 0;
      for (let j = 1; j < panel.maps.length; j++) if (panel.givenBy[j] < panel.givenBy[si]) si = j;
      panel.given += l.amount;
      panel.givenBy[si] += l.amount;
      const m = panel.maps[si];
      if (!firstProvider && k === "views") firstProvider = m.provider;
      legs.push({
        category: k,
        serviceId: m.providerServiceId,
        quantity: l.amount,
        comments: l.comments || null,
        providerId: String(m.provider.id),
        costUsd: round4((l.amount / 1000) * services[k].rate),
        fireInMs: Math.round(l.minutesAt * 60000),
      });
    });
  }
  return { legs, firstProvider };
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
  const device = getDevice(req, res); // the order will show up in THIS device's Schedules tab
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

  // 2) store the timed parts in the scheduler; give the money back if that fails
  try {
    const { legs, firstProvider } = buildLegs(plan.legsByType, services);
    const created = await store.createOrder({
      name,
      link,
      deviceTag: device.tag,
      source: "key",
      keyId: keyRow.id,
      baseUrl: firstProvider ? firstProvider.api_url : null,
      apiKeyEnc: firstProvider ? firstProvider.encrypted_api_key : null, // already encrypted; only the admin page decrypts it
      legs,
    });
    await supabase.from("auto_key_orders").update({ status: "scheduled", legs_count: created.legs }).eq("id", orderRow.id);
    await supabase.from("auto_key_events").insert({ key_id: keyRow.id, type: "order", amount: -plan.cost, balance_after: spend.remaining, note: name });
    return res.status(200).json({ success: true, cost: plan.cost, remaining: Number(spend.remaining), status: spend.new_status, scheduledLegs: created.legs });
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
