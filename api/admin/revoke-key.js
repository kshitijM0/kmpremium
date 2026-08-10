const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ error: "Unauthorized." });

  const id = req.body && req.body.id;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Invalid request." });

  const { error } = await getSupabaseAdmin().from("keys").update({ status: "revoked" }).eq("id", id);
  if (error) return res.status(500).json({ error: "Could not revoke key." });
  return res.status(200).json({ ok: true });
};
