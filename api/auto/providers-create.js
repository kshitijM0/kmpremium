const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");
const { encryptSecret } = require("../../lib/crypto");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const providerName = req.body && req.body.providerName;
  const apiUrl = req.body && req.body.apiUrl;
  const apiKey = req.body && req.body.apiKey;

  if (!providerName || typeof providerName !== "string") {
    return res.status(400).json({ success: false, error: "Provider name is required." });
  }
  if (!apiUrl || typeof apiUrl !== "string" || !/^https?:\/\//.test(apiUrl)) {
    return res.status(400).json({ success: false, error: "A valid API URL is required." });
  }
  if (!apiKey || typeof apiKey !== "string") {
    return res.status(400).json({ success: false, error: "API key is required." });
  }

  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from("api_providers")
    .select("id")
    .eq("provider_name", providerName)
    .maybeSingle();
  if (existing) {
    return res.status(409).json({ success: false, error: "A provider with this name already exists." });
  }

  const { data, error } = await supabase
    .from("api_providers")
    .insert({
      provider_name: providerName,
      api_url: apiUrl,
      encrypted_api_key: encryptSecret(apiKey),
      status: "active",
    })
    .select("id, provider_name, api_url, status, created_at")
    .single();

  if (error) return res.status(500).json({ success: false, error: "Could not create provider.", retryable: true });
  return res.status(200).json({ success: true, provider: data });
};
