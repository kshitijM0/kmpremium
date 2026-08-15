const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");
const { encryptSecret } = require("../../lib/crypto");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const id = req.body && req.body.id;
  if (!id || typeof id !== "string") return res.status(400).json({ success: false, error: "Missing id." });

  const updates = { updated_at: new Date().toISOString() };

  if (req.body.providerName !== undefined) updates.provider_name = String(req.body.providerName);
  if (req.body.apiUrl !== undefined) {
    if (!/^https?:\/\//.test(req.body.apiUrl)) {
      return res.status(400).json({ success: false, error: "Invalid API URL." });
    }
    updates.api_url = req.body.apiUrl;
  }
  if (req.body.apiKey) updates.encrypted_api_key = encryptSecret(req.body.apiKey); // only overwrite if a new key was actually provided
  if (req.body.status !== undefined) {
    if (!["active", "disabled"].includes(req.body.status)) {
      return res.status(400).json({ success: false, error: "Invalid status." });
    }
    updates.status = req.body.status;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("api_providers")
    .update(updates)
    .eq("id", id)
    .select("id, provider_name, api_url, status, updated_at")
    .single();

  if (error || !data) return res.status(404).json({ success: false, error: "Could not update provider." });
  return res.status(200).json({ success: true, provider: data });
};
