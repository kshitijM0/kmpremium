const { getSupabaseAdmin } = require("../lib/supabase");
const { readSession } = require("../lib/keySession");
const { getLimiters, getClientIp } = require("../lib/ratelimit");

const ENGAGEMENT_TYPES = ["likes", "shares", "saves", "reposts", "comments"];

// Estimates cost from configured customer_rate mappings, honoring which
// engagement services the customer left ON. Disabled services never enter
// the calculation, the leg generation, or the provider placement.
async function estimateCost(supabase, viewsQuantity, ratios, enabledServices) {
  const quantities = { views: viewsQuantity };
  for (const r of ratios) {
    if (enabledServices && enabledServices[r.service_type] === false) continue; // explicitly OFF
    quantities[r.service_type] = Math.round(viewsQuantity * Number(r.ratio));
  }

  let total = 0;
  for (const serviceType of Object.keys(quantities)) {
    const { data: mapping } = await supabase
      .from("service_mapping")
      .select("customer_rate")
      .eq("service_type", serviceType)
      .eq("active", true)
      .order("display_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (mapping && mapping.customer_rate) {
      total += (quantities[serviceType] / 1000) * Number(mapping.customer_rate);
    }
  }
  return { total: Math.round(total * 100) / 100, quantities };
}

module.exports = async (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ success: false, error: "No active session." });

  const supabase = getSupabaseAdmin();

  // ---------- LIST / STATUS / RATIOS PREVIEW ----------
  if (req.method === "GET") {
    const view = req.query && req.query.view;

    if (view === "ratios") {
      const { data, error } = await supabase.from("engagement_ratios").select("service_type, ratio");
      if (error) return res.status(500).json({ success: false, error: "Could not load ratios.", retryable: true });

      const rates = {};
      for (const t of ["views", ...ENGAGEMENT_TYPES]) {
        const { data: mapping } = await supabase.from("service_mapping").select("customer_rate").eq("service_type", t).eq("active", true).order("display_order", { ascending: true }).limit(1).maybeSingle();
        rates[t] = mapping ? Number(mapping.customer_rate) || 0 : 0;
      }

      return res.status(200).json({ success: true, ratios: data, rates });
    }

    const orderId = req.query && req.query.id;
    if (orderId) {
      const { data: order, error } = await supabase
        .from("orders")
        .select("id, order_name, platform, link, mode, views_quantity, customer_cost, delivered_views, status, enabled_services, comment_text, created_at, updated_at")
        .eq("id", orderId)
        .eq("device_id", session.deviceId)
        .maybeSingle();
      if (error || !order) return res.status(404).json({ success: false, error: "Order not found." });
      return res.status(200).json({ success: true, order });
    }

    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, order_name, platform, link, mode, views_quantity, customer_cost, delivered_views, status, created_at")
      .eq("device_id", session.deviceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ success: false, error: "Could not load orders.", retryable: true });
    return res.status(200).json({ success: true, orders });
  }

  // ---------- CREATE ----------
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });

  const { general } = getLimiters();
  const { success: notLimited } = await general.limit(getClientIp(req));
  if (!notLimited) return res.status(429).json({ success: false, error: "Too many attempts. Try again later." });

  const { orderName, platform, link, mode, viewsQuantity, enabledServices, commentText } = req.body || {};

  if (!["instagram", "tiktok", "youtube"].includes(platform)) {
    return res.status(400).json({ success: false, error: "Invalid platform." });
  }
  if (!link || typeof link !== "string" || !/^https?:\/\//.test(link)) {
    return res.status(400).json({ success: false, error: "A valid link is required." });
  }
  const modeVal = ["viral", "fast", "trending", "slow"].includes(mode) ? mode : "viral";
  const qty = Number(viewsQuantity);
  if (!Number.isInteger(qty) || qty <= 0 || qty > 5_000_000) {
    return res.status(400).json({ success: false, error: "Invalid views quantity." });
  }

  // Sanitize the enabledServices map — only known keys, boolean values.
  let enabledMap = null;
  if (enabledServices && typeof enabledServices === "object") {
    enabledMap = {};
    for (const t of ENGAGEMENT_TYPES) {
      if (typeof enabledServices[t] === "boolean") enabledMap[t] = enabledServices[t];
    }
  }

  let commentTextVal = null;
  if (enabledMap && enabledMap.comments !== false) {
    if (commentText !== undefined && commentText !== null) {
      const trimmed = String(commentText).trim();
      if (trimmed.length > 500) return res.status(400).json({ success: false, error: "Comment text is too long." });
      commentTextVal = trimmed || null;
    }
  }

  const { data: viewsMapping } = await supabase.from("service_mapping").select("id").eq("service_type", "views").eq("active", true).limit(1);
  if (!viewsMapping || !viewsMapping.length) {
    return res.status(503).json({ success: false, error: "Auto Order is temporarily unavailable — no active Views provider configured." });
  }

  const { data: ratios } = await supabase.from("engagement_ratios").select("service_type, ratio");
  const { total: customerCost } = await estimateCost(supabase, qty, ratios || [], enabledMap);

  const { data: deviceRow } = await supabase.from("devices").select("wallet_balance").eq("device_id", session.deviceId).maybeSingle();
  const currentBalance = deviceRow ? Number(deviceRow.wallet_balance) : 0;
  if (currentBalance < customerCost) {
    return res.status(402).json({ success: false, error: "Insufficient KM Wallet balance.", required: customerCost, available: currentBalance });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      device_id: session.deviceId,
      order_name: orderName ? String(orderName).slice(0, 100) : null,
      platform,
      link,
      mode: modeVal,
      views_quantity: qty,
      customer_cost: customerCost,
      enabled_services: enabledMap,
      comment_text: commentTextVal,
      status: "pending",
    })
    .select("id")
    .single();
  if (orderError) return res.status(500).json({ success: false, error: "Could not create order.", retryable: true });

  const { error: holdError } = await supabase.from("wallet_holds").insert({ device_id: session.deviceId, order_id: order.id, amount: customerCost, status: "held" });
  if (holdError) {
    await supabase.from("orders").delete().eq("id", order.id);
    return res.status(500).json({ success: false, error: "Could not reserve wallet balance.", retryable: true });
  }

  await supabase.from("engine_logs").insert({
    order_id: order.id,
    event_type: "order_created",
    details: { platform, link, mode: modeVal, viewsQuantity: qty, customerCost, enabledServices: enabledMap },
  });

  return res.status(200).json({ success: true, orderId: order.id, customerCost });
};
