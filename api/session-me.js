const { getSupabaseAdmin } = require("../lib/supabase");
const { readSession } = require("../lib/keySession");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed." });

  const session = readSession(req);
  if (!session) return res.status(401).json({ success: false, error: "No active session." });

  const supabase = getSupabaseAdmin();

  const { data: keyRow, error: keyError } = await supabase
    .from("keys")
    .select("id, status, expires_at")
    .eq("id", session.keyId)
    .maybeSingle();

  if (keyError || !keyRow) return res.status(404).json({ success: false, error: "Session key not found." });

  const active = keyRow.status === "active" && new Date(keyRow.expires_at) > new Date();
  if (!active) return res.status(401).json({ success: false, error: "Key no longer active." });

  const { data: deviceRow } = await supabase
    .from("devices")
    .select("wallet_balance")
    .eq("device_id", session.deviceId)
    .maybeSingle();

  return res.status(200).json({
    success: true,
    walletBalance: deviceRow ? Number(deviceRow.wallet_balance) : 0,
    expiresAt: keyRow.expires_at,
  });
};
