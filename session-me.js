const { getSupabaseAdmin } = require("../lib/supabase");
const { readSession } = require("../lib/keySession");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed." });

  const keyId = readSession(req);
  if (!keyId) return res.status(401).json({ success: false, error: "No active session." });

  const { data, error } = await getSupabaseAdmin()
    .from("keys")
    .select("id, status, expires_at, wallet_balance")
    .eq("id", keyId)
    .maybeSingle();

  if (error || !data) return res.status(404).json({ success: false, error: "Session key not found." });

  const active = data.status === "active" && new Date(data.expires_at) > new Date();
  if (!active) return res.status(401).json({ success: false, error: "Key no longer active." });

  return res.status(200).json({
    success: true,
    walletBalance: Number(data.wallet_balance),
    expiresAt: data.expires_at,
  });
};
