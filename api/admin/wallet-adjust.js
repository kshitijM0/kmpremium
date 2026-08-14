const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");

// Admin still picks a KEY in the UI (keys are what admin generates and
// hands out) — this route resolves that key to its linked device and
// adjusts the device's wallet, since the wallet actually belongs to the
// device, not the key.
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const keyId = req.body && req.body.keyId;
  const amount = Number(req.body && req.body.amount);
  const description = (req.body && req.body.description) || "Admin balance adjustment";

  if (!keyId || typeof keyId !== "string") {
    return res.status(400).json({ success: false, error: "Missing keyId." });
  }
  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ success: false, error: "Invalid amount." });
  }

  const supabase = getSupabaseAdmin();

  const { data: keyRow, error: keyError } = await supabase
    .from("keys")
    .select("id, device_id")
    .eq("id", keyId)
    .maybeSingle();

  if (keyError || !keyRow) return res.status(404).json({ success: false, error: "Key not found." });
  if (!keyRow.device_id) {
    return res.status(400).json({
      success: false,
      error: "This key hasn't been used on any device yet — no wallet to adjust.",
    });
  }

  const { data: newBalance, error: adjustError } = await supabase.rpc("adjust_device_wallet_balance", {
    p_device_id: keyRow.device_id,
    p_delta: amount,
  });

  if (adjustError) {
    return res.status(500).json({ success: false, error: "Could not adjust balance.", retryable: true });
  }

  const { error: logError } = await supabase.from("wallet_transactions").insert({
    device_id: keyRow.device_id,
    key_id: keyId,
    type: "admin_adjustment",
    amount,
    balance_after: newBalance,
    description,
    status: "completed",
    completed_at: new Date().toISOString(),
  });

  if (logError) {
    return res.status(207).json({
      success: true,
      warning: "Balance updated but the transaction log entry failed to save.",
      walletBalance: newBalance,
    });
  }

  return res.status(200).json({ success: true, walletBalance: newBalance });
};
