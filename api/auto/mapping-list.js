const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");

const VALID_TYPES = ["views", "likes", "shares", "saves", "reposts", "comments"];

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const serviceType = req.query && req.query.serviceType;
  if (!VALID_TYPES.includes(serviceType)) {
    return res.status(400).json({ success: false, error: "Invalid or missing serviceType." });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("service_mapping")
    .select("id, provider_id, provider_service_id, customer_rate, display_order, active, api_providers(provider_name), created_at")
    .eq("service_type", serviceType)
    .order("display_order", { ascending: true });

  if (error) return res.status(500).json({ success: false, error: "Could not load mapping.", retryable: true });
  return res.status(200).json({ success: true, mapping: data });
};
