const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");

const VALID_TYPES = ["views", "likes", "shares", "saves", "reposts", "comments"];
const ROUND_ROBIN_TYPES = ["views", "likes"]; // only these may have more than one mapped service

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const { serviceType, providerId, providerServiceId, customerRate } = req.body || {};

  if (!VALID_TYPES.includes(serviceType)) {
    return res.status(400).json({ success: false, error: "Invalid serviceType." });
  }
  if (!providerId || typeof providerId !== "string") {
    return res.status(400).json({ success: false, error: "Missing providerId." });
  }
  if (!providerServiceId || typeof providerServiceId !== "string") {
    return res.status(400).json({ success: false, error: "Missing providerServiceId." });
  }
  if (customerRate !== undefined && customerRate !== null && !(Number(customerRate) >= 0)) {
    return res.status(400).json({ success: false, error: "Invalid customerRate." });
  }

  const supabase = getSupabaseAdmin();

  if (!ROUND_ROBIN_TYPES.includes(serviceType)) {
    const { data: existing } = await supabase
      .from("service_mapping")
      .select("id")
      .eq("service_type", serviceType)
      .eq("active", true);
    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        error: `${serviceType} uses a single service only — remove the existing mapping before adding a new one.`,
      });
    }
  }

  const { data: maxOrderRow } = await supabase
    .from("service_mapping")
    .select("display_order")
    .eq("service_type", serviceType)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = maxOrderRow ? maxOrderRow.display_order + 1 : 0;

  const { data, error } = await supabase
    .from("service_mapping")
    .insert({
      service_type: serviceType,
      provider_id: providerId,
      provider_service_id: providerServiceId,
      customer_rate: customerRate !== undefined ? customerRate : null,
      display_order: nextOrder,
      active: true,
    })
    .select("id, service_type, provider_id, provider_service_id, customer_rate, display_order")
    .single();

  if (error) return res.status(500).json({ success: false, error: "Could not save mapping.", retryable: true });
  return res.status(200).json({ success: true, mapping: data });
};
