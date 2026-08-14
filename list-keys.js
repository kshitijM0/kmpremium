const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ error: "Unauthorized." });

  const { data, error } = await getSupabaseAdmin()
    .from("keys")
    .select("*, wallet_balance")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return res.status(500).json({ error: "Could not fetch keys." });
  }

  return res.status(200).json({ keys: data });
};
