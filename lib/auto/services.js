const { getSupabaseAdmin } = require("../supabase");
const { isAdminRequest } = require("../adminSession");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const { providerId, category, search } = req.query || {};

  let query = getSupabaseAdmin()
    .from("provider_services")
    .select("id, provider_id, service_id, service_name, category, rate, minimum, maximum, refill, cancel, average_time, active, api_providers(provider_name)")
    .eq("active", true)
    .order("category", { ascending: true })

  if (providerId) query = query.eq("provider_id", providerId);
  if (category) query = query.eq("category", category);
  if (search) query = query.or(`service_name.ilike.%${search}%,service_id.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false, error: "Could not search services.", retryable: true });
  return res.status(200).json({ success: true, services: data });
};
