const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");

// Body: { orderedIds: ["mapping-id-1", "mapping-id-2", ...] } — index in the
// array becomes the new display_order, so the pool rotates in exactly this order.
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const orderedIds = req.body && req.body.orderedIds;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ success: false, error: "Missing orderedIds." });
  }

  const supabase = getSupabaseAdmin();
  const updates = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("service_mapping").update({ display_order: index }).eq("id", id)
    )
  );

  const failed = updates.some((r) => r.error);
  if (failed) return res.status(500).json({ success: false, error: "Could not save new order.", retryable: true });
  return res.status(200).json({ success: true });
};
