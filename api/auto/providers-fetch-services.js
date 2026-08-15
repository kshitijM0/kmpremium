const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");
const { decryptSecret } = require("../../lib/crypto");
const { callProviderApi } = require("../../lib/providerApi");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const id = req.body && req.body.id;
  if (!id || typeof id !== "string") return res.status(400).json({ success: false, error: "Missing id." });

  const supabase = getSupabaseAdmin();
  const { data: provider, error: fetchError } = await supabase
    .from("api_providers")
    .select("id, api_url, encrypted_api_key")
    .eq("id", id)
    .maybeSingle();

  if (fetchError || !provider) return res.status(404).json({ success: false, error: "Provider not found." });

  let apiKey;
  try {
    apiKey = decryptSecret(provider.encrypted_api_key);
  } catch {
    return res.status(500).json({ success: false, error: "Stored API key could not be decrypted." });
  }

  const result = await callProviderApi(provider.api_url, apiKey, { action: "services" });
  if (!result.ok) {
    return res.status(502).json({ success: false, error: result.error, retryable: result.retryable });
  }

  const list = Array.isArray(result.data) ? result.data : [];
  if (!list.length) {
    return res.status(200).json({ success: true, fetched: 0, updated: 0, inserted: 0, deactivated: 0 });
  }

  const seenServiceIds = [];
  const rows = list
    .filter((s) => s && s.service !== undefined && s.service !== null)
    .map((s) => {
      const serviceId = String(s.service);
      seenServiceIds.push(serviceId);
      return {
        provider_id: id,
        service_id: serviceId,
        service_name: s.name || null,
        category: s.category || null,
        rate: s.rate !== undefined ? Number(s.rate) : null,
        minimum: s.min !== undefined ? Number(s.min) : null,
        maximum: s.max !== undefined ? Number(s.max) : null,
        refill: !!s.refill,
        cancel: !!s.cancel,
        average_time: s.average_time || null,
        active: true,
        updated_at: new Date().toISOString(),
      };
    });

  // Upsert (insert new, update existing) on the (provider_id, service_id) unique key.
  const { error: upsertError } = await supabase
    .from("provider_services")
    .upsert(rows, { onConflict: "provider_id,service_id" });

  if (upsertError) {
    return res.status(500).json({ success: false, error: "Could not save services.", retryable: true });
  }

  // Soft-delete: anything for this provider NOT in the latest fetch becomes inactive
  // (never hard-deleted — a schedule using it should still see history).
  const { data: deactivated, error: deactivateError } = await supabase
    .from("provider_services")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("provider_id", id)
    .not("service_id", "in", `(${seenServiceIds.map((s) => `"${s}"`).join(",")})`)
    .select("id");

  return res.status(200).json({
    success: true,
    fetched: list.length,
    saved: rows.length,
    deactivated: deactivateError ? 0 : (deactivated || []).length,
  });
};
