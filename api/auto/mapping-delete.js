const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const id = req.body && req.body.id;
  if (!id || typeof id !== "string") return res.status(400).json({ success: false, error: "Missing id." });

  const { error } = await getSupabaseAdmin().from("service_mapping").delete().eq("id", id);
  if (error) return res.status(500).json({ success: false, error: "Could not delete mapping.", retryable: true });
  return res.status(200).json({ success: true });
};
