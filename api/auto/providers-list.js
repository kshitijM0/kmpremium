const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const { data, error } = await getSupabaseAdmin()
    .from("api_providers")
    // encrypted_api_key intentionally excluded — never sent to the browser
    .select("id, provider_name, api_url, status, created_at, updated_at, last_tested, last_test_status, last_test_balance, last_test_currency, last_test_response_ms")
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ success: false, error: "Could not load providers.", retryable: true });
  return res.status(200).json({ success: true, providers: data });
};
