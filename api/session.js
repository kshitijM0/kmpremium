const { getSupabaseAdmin } = require("../lib/supabase");
const { readSession } = require("../lib/keySession");
const { encryptSecret, decryptSecret } = require("../lib/crypto");
const { callProviderApi } = require("../lib/providerApi");
const { getLimiters, getClientIp } = require("../lib/ratelimit");

async function requireSession(req, res) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ success: false, error: "No active session." });
    return null;
  }
  return session;
}

module.exports = async (req, res) => {
  const supabase = getSupabaseAdmin();

  // ================= GET (read-only views) =================
  if (req.method === "GET") {
    const session = await requireSession(req, res);
    if (!session) return;

    const view = (req.query && req.query.view) || "wallet";

    if (view === "wallet") {
      const { data: keyRow, error: keyError } = await supabase.from("keys").select("id, status, expires_at").eq("id", session.keyId).maybeSingle();
      if (keyError || !keyRow) return res.status(404).json({ success: false, error: "Session key not found." });
      const active = keyRow.status === "active" && new Date(keyRow.expires_at) > new Date();
      if (!active) return res.status(401).json({ success: false, error: "Key no longer active." });

      const { data: deviceRow } = await supabase.from("devices").select("wallet_balance").eq("device_id", session.deviceId).maybeSingle();
      const response = { success: true, walletBalance: deviceRow ? Number(deviceRow.wallet_balance) : 0, expiresAt: keyRow.expires_at };

      if (req.query.include === "transactions") {
        const { data: transactions } = await supabase.from("wallet_transactions").select("id, type, amount, balance_after, description, status, created_at").eq("device_id", session.deviceId).order("created_at", { ascending: false }).limit(100);
        response.transactions = transactions || [];
      }
      return res.status(200).json(response);
    }

    if (view === "my-apis") {
      const { data, error } = await supabase.from("user_api_profiles").select("id, profile_name, api_url, status, created_at, updated_at").eq("device_id", session.deviceId).order("created_at", { ascending: true });
      if (error) return res.status(500).json({ success: false, error: "Could not load your APIs.", retryable: true });
      return res.status(200).json({ success: true, profiles: data });
    }

    if (view === "my-services") {
      const profileId = req.query.profileId;
      if (!profileId) return res.status(400).json({ success: false, error: "Missing profileId." });
      const { data: owned } = await supabase.from("user_api_profiles").select("id").eq("id", profileId).eq("device_id", session.deviceId).maybeSingle();
      if (!owned) return res.status(404).json({ success: false, error: "Profile not found." });

      let query = supabase.from("user_provider_services").select("id, service_id, service_name, category, rate, minimum, maximum").eq("profile_id", profileId).eq("active", true).limit(500);
      if (req.query.search) query = query.or(`service_name.ilike.%${req.query.search}%,service_id.ilike.%${req.query.search}%`);
      const { data, error } = await query;
      if (error) return res.status(500).json({ success: false, error: "Could not load services.", retryable: true });
      return res.status(200).json({ success: true, services: data });
    }

    if (view === "manual-orders") {
      const { data, error } = await supabase.from("manual_orders").select("id, profile_id, provider_service_id, service_name, link, quantity, status, provider_order_id, created_at").eq("device_id", session.deviceId).order("created_at", { ascending: false }).limit(100);
      if (error) return res.status(500).json({ success: false, error: "Could not load manual orders.", retryable: true });
      return res.status(200).json({ success: true, orders: data });
    }

    return res.status(400).json({ success: false, error: "Unknown view." });
  }

  // ================= POST (actions) =================
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });

  const session = await requireSession(req, res);
  if (!session) return;

  const { general } = getLimiters();
  const { success: notLimited } = await general.limit(getClientIp(req));
  if (!notLimited) return res.status(429).json({ success: false, error: "Too many attempts. Try again later." });

  const action = req.body && req.body.action;

  // ---------- CREATE MY API ----------
  if (action === "create-my-api") {
    const { profileName, apiUrl, apiKey } = req.body;
    if (!apiUrl || !/^https?:\/\//.test(apiUrl)) return res.status(400).json({ success: false, error: "A valid API URL is required." });
    if (!apiKey) return res.status(400).json({ success: false, error: "API key is required." });

    const { data, error } = await supabase
      .from("user_api_profiles")
      .insert({ device_id: session.deviceId, profile_name: profileName || "My Panel", api_url: apiUrl, encrypted_api_key: encryptSecret(apiKey), status: "active" })
      .select("id, profile_name, api_url, status, created_at")
      .single();
    if (error) return res.status(500).json({ success: false, error: "Could not save API.", retryable: true });
    return res.status(200).json({ success: true, profile: data });
  }

  // For all remaining actions, resolve + ownership-check the profile first.
  if (["update-my-api", "delete-my-api", "test-my-api", "fetch-my-api-services"].includes(action)) {
    const { profileId } = req.body;
    if (!profileId) return res.status(400).json({ success: false, error: "Missing profileId." });
    const { data: profile, error: fetchError } = await supabase.from("user_api_profiles").select("id, api_url, encrypted_api_key, device_id").eq("id", profileId).maybeSingle();
    if (fetchError || !profile || profile.device_id !== session.deviceId) {
      return res.status(404).json({ success: false, error: "Profile not found." });
    }

    if (action === "update-my-api") {
      const updates = { updated_at: new Date().toISOString() };
      if (req.body.status !== undefined) {
        if (!["active", "disabled"].includes(req.body.status)) return res.status(400).json({ success: false, error: "Invalid status." });
        updates.status = req.body.status;
      }
      if (req.body.profileName !== undefined) updates.profile_name = String(req.body.profileName);
      const { data, error } = await supabase.from("user_api_profiles").update(updates).eq("id", profileId).select("id, profile_name, status").single();
      if (error) return res.status(500).json({ success: false, error: "Could not update API." });
      return res.status(200).json({ success: true, profile: data });
    }

    if (action === "delete-my-api") {
      const { error } = await supabase.from("user_api_profiles").delete().eq("id", profileId);
      if (error) return res.status(500).json({ success: false, error: "Could not delete API.", retryable: true });
      return res.status(200).json({ success: true });
    }

    let apiKey;
    try {
      apiKey = decryptSecret(profile.encrypted_api_key);
    } catch {
      return res.status(500).json({ success: false, error: "Stored API key could not be decrypted." });
    }

    if (action === "test-my-api") {
      const result = await callProviderApi(profile.api_url, apiKey, { action: "balance" });
      return res.status(200).json({ success: result.ok, balance: result.ok ? result.data.balance : undefined, currency: result.ok ? result.data.currency : undefined, error: result.ok ? undefined : result.error });
    }

    if (action === "fetch-my-api-services") {
      const result = await callProviderApi(profile.api_url, apiKey, { action: "services" });
      if (!result.ok) return res.status(502).json({ success: false, error: result.error });
      const list = Array.isArray(result.data) ? result.data : [];
      const seen = [];
      const rows = list.filter((s) => s && s.service != null).map((s) => {
        const sid = String(s.service);
        seen.push(sid);
        return { profile_id: profileId, service_id: sid, service_name: s.name || null, category: s.category || null, rate: s.rate !== undefined ? Number(s.rate) : null, minimum: s.min !== undefined ? Number(s.min) : null, maximum: s.max !== undefined ? Number(s.max) : null, refill: !!s.refill, cancel: !!s.cancel, average_time: s.average_time || null, active: true, updated_at: new Date().toISOString() };
      });
      if (rows.length) await supabase.from("user_provider_services").upsert(rows, { onConflict: "profile_id,service_id" });
      if (seen.length) {
        await supabase.from("user_provider_services").update({ active: false }).eq("profile_id", profileId).not("service_id", "in", `(${seen.map((s) => `"${s}"`).join(",")})`);
      }
      return res.status(200).json({ success: true, fetched: list.length, saved: rows.length });
    }
  }

  // ---------- PLACE MANUAL ORDER (customer's own API, no engine involved) ----------
  if (action === "place-manual-order") {
    const { profileId, providerServiceId, serviceName, link, quantity } = req.body;
    if (!profileId || !providerServiceId || !link || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0) {
      return res.status(400).json({ success: false, error: "Missing or invalid order fields." });
    }
    const { data: profile } = await supabase.from("user_api_profiles").select("id, api_url, encrypted_api_key, device_id, status").eq("id", profileId).maybeSingle();
    if (!profile || profile.device_id !== session.deviceId) return res.status(404).json({ success: false, error: "Profile not found." });
    if (profile.status !== "active") return res.status(400).json({ success: false, error: "This API is disabled." });

    let apiKey;
    try {
      apiKey = decryptSecret(profile.encrypted_api_key);
    } catch {
      return res.status(500).json({ success: false, error: "Stored API key could not be decrypted." });
    }

    const result = await callProviderApi(profile.api_url, apiKey, { action: "add", service: providerServiceId, link, quantity });
    if (!result.ok) return res.status(502).json({ success: false, error: result.error });

    const providerOrderId = result.data && result.data.order !== undefined ? String(result.data.order) : null;
    const { data: order, error: insertError } = await supabase
      .from("manual_orders")
      .insert({ device_id: session.deviceId, profile_id: profileId, provider_service_id: providerServiceId, service_name: serviceName || null, link, quantity: Number(quantity), provider_order_id: providerOrderId, status: "processing" })
      .select("id")
      .single();
    if (insertError) return res.status(500).json({ success: false, error: "Order placed but could not be recorded — save this provider order id: " + providerOrderId });

    return res.status(200).json({ success: true, orderId: order.id, providerOrderId });
  }

  // ---------- CHECK MANUAL ORDER STATUS ----------
  if (action === "check-manual-order-status") {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: "Missing orderId." });
    const { data: order } = await supabase.from("manual_orders").select("id, profile_id, provider_order_id, device_id, status").eq("id", orderId).maybeSingle();
    if (!order || order.device_id !== session.deviceId) return res.status(404).json({ success: false, error: "Order not found." });
    if (!order.provider_order_id) return res.status(200).json({ success: true, status: order.status });

    const { data: profile } = await supabase.from("user_api_profiles").select("api_url, encrypted_api_key").eq("id", order.profile_id).maybeSingle();
    if (!profile) return res.status(200).json({ success: true, status: order.status });

    let apiKey;
    try {
      apiKey = decryptSecret(profile.encrypted_api_key);
    } catch {
      return res.status(200).json({ success: true, status: order.status });
    }

    const result = await callProviderApi(profile.api_url, apiKey, { action: "status", order: order.provider_order_id });
    if (result.ok && result.data && result.data.status) {
      const mapped = String(result.data.status).toLowerCase().includes("complet") ? "completed" : String(result.data.status).toLowerCase().includes("partial") ? "partial" : String(result.data.status).toLowerCase().includes("cancel") ? "cancelled" : "processing";
      await supabase.from("manual_orders").update({ status: mapped, updated_at: new Date().toISOString() }).eq("id", orderId);
      return res.status(200).json({ success: true, status: mapped, raw: result.data });
    }
    return res.status(200).json({ success: true, status: order.status });
  }

  return res.status(400).json({ success: false, error: "Unknown action." });
};
