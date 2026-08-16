const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");
const { encryptSecret, decryptSecret } = require("../../lib/crypto");
const { callProviderApi } = require("../../lib/providerApi");

module.exports = async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });
  const supabase = getSupabaseAdmin();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("api_providers")
      .select("id, provider_name, api_url, status, created_at, updated_at, last_tested, last_test_status, last_test_balance, last_test_currency, last_test_response_ms")
      .order("created_at", { ascending: true });
    if (error) return res.status(500).json({ success: false, error: "Could not load providers.", retryable: true });
    return res.status(200).json({ success: true, providers: data });
  }

  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  const action = req.body && req.body.action;

  // ---------- CREATE ----------
  if (action === "create") {
    const { providerName, apiUrl, apiKey } = req.body;
    if (!providerName) return res.status(400).json({ success: false, error: "Provider name is required." });
    if (!apiUrl || !/^https?:\/\//.test(apiUrl)) return res.status(400).json({ success: false, error: "A valid API URL is required." });
    if (!apiKey) return res.status(400).json({ success: false, error: "API key is required." });

    const { data: existing } = await supabase.from("api_providers").select("id").eq("provider_name", providerName).maybeSingle();
    if (existing) return res.status(409).json({ success: false, error: "A provider with this name already exists." });

    const { data, error } = await supabase
      .from("api_providers")
      .insert({ provider_name: providerName, api_url: apiUrl, encrypted_api_key: encryptSecret(apiKey), status: "active" })
      .select("id, provider_name, api_url, status, created_at")
      .single();
    if (error) return res.status(500).json({ success: false, error: "Could not create provider.", retryable: true });
    return res.status(200).json({ success: true, provider: data });
  }

  // ---------- UPDATE ----------
  if (action === "update") {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, error: "Missing id." });
    const updates = { updated_at: new Date().toISOString() };
    if (req.body.providerName !== undefined) updates.provider_name = String(req.body.providerName);
    if (req.body.apiUrl !== undefined) {
      if (!/^https?:\/\//.test(req.body.apiUrl)) return res.status(400).json({ success: false, error: "Invalid API URL." });
      updates.api_url = req.body.apiUrl;
    }
    if (req.body.apiKey) updates.encrypted_api_key = encryptSecret(req.body.apiKey);
    if (req.body.status !== undefined) {
      if (!["active", "disabled"].includes(req.body.status)) return res.status(400).json({ success: false, error: "Invalid status." });
      updates.status = req.body.status;
    }
    const { data, error } = await supabase.from("api_providers").update(updates).eq("id", id).select("id, provider_name, api_url, status, updated_at").single();
    if (error || !data) return res.status(404).json({ success: false, error: "Could not update provider." });
    return res.status(200).json({ success: true, provider: data });
  }

  // ---------- DELETE ----------
  if (action === "delete") {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, error: "Missing id." });
    const { error } = await supabase.from("api_providers").delete().eq("id", id);
    if (error) return res.status(500).json({ success: false, error: "Could not delete provider.", retryable: true });
    return res.status(200).json({ success: true });
  }

  // ---------- DUPLICATE ----------
  if (action === "duplicate") {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, error: "Missing id." });
    const { data: original, error: fetchError } = await supabase.from("api_providers").select("provider_name, api_url, encrypted_api_key").eq("id", id).maybeSingle();
    if (fetchError || !original) return res.status(404).json({ success: false, error: "Provider not found." });

    let newName = `${original.provider_name} (copy)`;
    const { data: clash } = await supabase.from("api_providers").select("id").eq("provider_name", newName).maybeSingle();
    if (clash) newName = `${original.provider_name} (copy ${Date.now()})`;

    const { data, error } = await supabase
      .from("api_providers")
      .insert({ provider_name: newName, api_url: original.api_url, encrypted_api_key: original.encrypted_api_key, status: "disabled" })
      .select("id, provider_name, api_url, status, created_at")
      .single();
    if (error) return res.status(500).json({ success: false, error: "Could not duplicate provider.", retryable: true });
    return res.status(200).json({ success: true, provider: data });
  }

  // ---------- TEST ----------
  if (action === "test") {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, error: "Missing id." });
    const { data: provider, error: fetchError } = await supabase.from("api_providers").select("id, api_url, encrypted_api_key").eq("id", id).maybeSingle();
    if (fetchError || !provider) return res.status(404).json({ success: false, error: "Provider not found." });

    let apiKey;
    try {
      apiKey = decryptSecret(provider.encrypted_api_key);
    } catch {
      return res.status(500).json({ success: false, error: "Stored API key could not be decrypted." });
    }

    const result = await callProviderApi(provider.api_url, apiKey, { action: "balance" });
    let testStatus = "unknown", balance = null, currency = null;
    if (result.ok) {
      testStatus = "online";
      balance = result.data && (result.data.balance ?? null);
      currency = result.data && (result.data.currency ?? null);
    } else {
      const msg = (result.error || "").toLowerCase();
      if (msg.includes("invalid api key") || msg.includes("unauthorized") || msg.includes("authentication")) testStatus = "invalid_key";
      else if (msg.includes("rate limit")) testStatus = "rate_limited";
      else if (msg.includes("timed out") || msg.includes("network")) testStatus = "offline";
    }

    await supabase.from("api_providers").update({
      last_tested: new Date().toISOString(), last_test_status: testStatus, last_test_balance: balance,
      last_test_currency: currency, last_test_response_ms: result.responseMs || null,
    }).eq("id", id);

    return res.status(200).json({ success: result.ok, status: testStatus, balance, currency, responseMs: result.responseMs, error: result.ok ? undefined : result.error });
  }

  // ---------- FETCH SERVICES ----------
  if (action === "fetch-services") {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, error: "Missing id." });
    const { data: provider, error: fetchError } = await supabase.from("api_providers").select("id, api_url, encrypted_api_key").eq("id", id).maybeSingle();
    if (fetchError || !provider) return res.status(404).json({ success: false, error: "Provider not found." });

    let apiKey;
    try {
      apiKey = decryptSecret(provider.encrypted_api_key);
    } catch {
      return res.status(500).json({ success: false, error: "Stored API key could not be decrypted." });
    }

    const result = await callProviderApi(provider.api_url, apiKey, { action: "services" });
    console.log("PROVIDER RAW RESPONSE:", result.data?.slice(0, 3));
console.log("TOTAL FROM PROVIDER:", Array.isArray(result.data) ? result.data.length : 0);
console.log("4132 CHECK:", result.data?.find(s => String(s.service) === "4132"));
    if (!result.ok) return res.status(502).json({ success: false, error: result.error, retryable: result.retryable });

    const list = Array.isArray(result.data) ? result.data : [];
    console.log("API TOTAL SERVICES:", list.length);
console.log("SERVICE 4132:", list.find(s => String(s.service) === "4132"));
console.log("WITHOUT SERVICE FIELD:", list.filter(s => !s.service).length);
    if (!list.length) return res.status(200).json({ success: true, fetched: 0, saved: 0, deactivated: 0 });

    const seenServiceIds = [];
    const rows = list.filter((s) => s && s.service !== undefined && s.service !== null).map((s) => {
      const serviceId = String(s.service);
      seenServiceIds.push(serviceId);
      return {
        provider_id: id, service_id: serviceId, service_name: s.name || null, category: s.category || null,
        rate: s.rate !== undefined ? Number(s.rate) : null, minimum: s.min !== undefined ? Number(s.min) : null,
        maximum: s.max !== undefined ? Number(s.max) : null, refill: !!s.refill, cancel: !!s.cancel,
        average_time: s.average_time || null, active: true, updated_at: new Date().toISOString(),
      };
    });

    const { error: upsertError } = await supabase.from("provider_services").upsert(rows, { onConflict: "provider_id,service_id" });
    if (upsertError) return res.status(500).json({ success: false, error: "Could not save services.", retryable: true });

    const { data: deactivated, error: deactivateError } = await supabase
      .from("provider_services")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("provider_id", id)
      .not("service_id", "in", `(${seenServiceIds.map((s) => `"${s}"`).join(",")})`)
      .select("id");

    return res.status(200).json({ success: true, fetched: list.length, saved: rows.length, deactivated: deactivateError ? 0 : (deactivated || []).length });
  }

  return res.status(400).json({ success: false, error: "Unknown action." });
};
