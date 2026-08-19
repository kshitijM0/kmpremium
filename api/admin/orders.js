const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");

module.exports = async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });
  const supabase = getSupabaseAdmin();

  if (req.method === "GET") {
    const view = (req.query && req.query.view) || "orders";

    if (view === "orders") {
      const { data, error } = await supabase
        .from("orders")
        .select("id, device_id, platform, link, mode, views_quantity, customer_cost, delivered_views, status, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return res.status(500).json({ success: false, error: "Could not load orders.", retryable: true });
      return res.status(200).json({ success: true, orders: data });
    }

    if (view === "logs") {
      const orderId = req.query.orderId;
      let query = supabase.from("engine_logs").select("id, order_id, leg_id, event_type, details, created_at").order("created_at", { ascending: false }).limit(300);
      if (orderId) query = query.eq("order_id", orderId);
      const { data, error } = await query;
      if (error) return res.status(500).json({ success: false, error: "Could not load logs.", retryable: true });
      return res.status(200).json({ success: true, logs: data });
    }

    if (view === "provider-health") {
      const { data, error } = await supabase
        .from("provider_health")
        .select("provider_id, status, consecutive_failures, last_checked, api_providers(provider_name)")
        .order("last_checked", { ascending: false });
      if (error) return res.status(500).json({ success: false, error: "Could not load provider health.", retryable: true });
      return res.status(200).json({ success: true, health: data });
    }

    if (view === "ratios") {
      const { data, error } = await supabase.from("engagement_ratios").select("service_type, ratio");
      if (error) return res.status(500).json({ success: false, error: "Could not load ratios.", retryable: true });
      return res.status(200).json({ success: true, ratios: data });
    }

    if (view === "order-detail") {
      const orderId = req.query.orderId;
      if (!orderId) return res.status(400).json({ success: false, error: "Missing orderId." });
      const { data: chunks, error } = await supabase
        .from("order_chunks")
        .select("id, chunk_number, views_quantity, status, order_legs(id, leg_number, scheduled_at, status, leg_services(service_type, quantity, status, provider_order_id, retry_count, api_providers(provider_name)))")
        .eq("order_id", orderId)
        .order("chunk_number", { ascending: true });
      if (error) return res.status(500).json({ success: false, error: "Could not load order detail.", retryable: true });
      return res.status(200).json({ success: true, chunks });
    }

    return res.status(400).json({ success: false, error: "Unknown view." });
  }

  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  const action = req.body && req.body.action;

  // ---------- UPDATE ENGAGEMENT RATIOS ----------
  if (action === "update-ratios") {
    const { ratios } = req.body; // [{ serviceType, ratio }, ...]
    if (!Array.isArray(ratios) || !ratios.length) return res.status(400).json({ success: false, error: "Missing ratios." });
    for (const r of ratios) {
      if (!["likes", "shares", "saves", "reposts", "comments"].includes(r.serviceType)) continue;
      if (!(Number(r.ratio) >= 0)) continue;
      await supabase.from("engagement_ratios").update({ ratio: Number(r.ratio) }).eq("service_type", r.serviceType);
    }
    return res.status(200).json({ success: true });
  }

  // ---------- CANCEL AN ORDER (admin override — releases any active hold) ----------
  if (action === "cancel-order") {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: "Missing orderId." });

    const { data: order } = await supabase.from("orders").select("status").eq("id", orderId).maybeSingle();
    if (!order) return res.status(404).json({ success: false, error: "Order not found." });
    if (["completed", "cancelled", "refunded"].includes(order.status)) {
      return res.status(409).json({ success: false, error: `Order already ${order.status}.` });
    }

    await supabase.from("orders").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", orderId);

    const { data: hold } = await supabase.from("wallet_holds").select("id, device_id, amount, status").eq("order_id", orderId).eq("status", "held").maybeSingle();
    if (hold) {
      await supabase.rpc("adjust_device_wallet_balance", { p_device_id: hold.device_id, p_delta: hold.amount });
      await supabase.from("wallet_holds").update({ status: "released", resolved_at: new Date().toISOString() }).eq("id", hold.id);
      await supabase.from("wallet_transactions").insert({
        device_id: hold.device_id,
        type: "refund",
        amount: hold.amount,
        description: "Order cancelled by admin — hold released",
        status: "completed",
        completed_at: new Date().toISOString(),
      });
    }

    await supabase.from("engine_logs").insert({ order_id: orderId, event_type: "order_cancelled_by_admin", details: {} });
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ success: false, error: "Unknown action." });
};
