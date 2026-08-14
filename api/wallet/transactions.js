const { getSupabaseAdmin } = require("../../lib/supabase");
const { readSession } = require("../../lib/keySession");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed." });

  const session = readSession(req);
  if (!session) return res.status(401).json({ success: false, error: "No active session." });

  const { data, error } = await getSupabaseAdmin()
    .from("wallet_transactions")
    .select("id, type, amount, balance_after, description, status, created_at")
    .eq("device_id", session.deviceId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ success: false, error: "Could not load transactions.", retryable: true });
  return res.status(200).json({ success: true, transactions: data });
};
