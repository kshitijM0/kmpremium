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
    .select("id, api_url, encrypted_api_key, status")
    .eq("id", id)
    .maybeSingle();

  if (fetchError || !provider) return res.status(404).json({ success: false, error: "Provider not found." });

  let apiKey;
  try {
    apiKey = decryptSecret(provider.encrypted_api_key);
  } catch {
    return res.status(500).json({ success: false, error: "Stored API key could not be decrypted." });
  }

  const result = await callProviderApi(provider.api_url, apiKey, { action: "balance" });

  let testStatus = "unknown";
  let balance = null;
  let currency = null;

  if (result.ok) {
    testStatus = "online";
    balance = result.data && (result.data.balance ?? null);
    currency = result.data && (result.data.currency ?? null);
  } else {
    const msg = (result.error || "").toLowerCase();
    if (msg.includes("invalid api key") || msg.includes("unauthorized") || msg.includes("authentication")) {
      testStatus = "invalid_key";
    } else if (msg.includes("rate limit")) {
      testStatus = "rate_limited";
    } else if (msg.includes("timed out") || msg.includes("network")) {
      testStatus = "offline";
    }
  }

  await supabase
    .from("api_providers")
    .update({
      last_tested: new Date().toISOString(),
      last_test_status: testStatus,
      last_test_balance: balance,
      last_test_currency: currency,
      last_test_response_ms: result.responseMs || null,
    })
    .eq("id", id);

  return res.status(200).json({
    success: result.ok,
    status: testStatus,
    balance,
    currency,
    responseMs: result.responseMs,
    error: result.ok ? undefined : result.error,
  });
};
