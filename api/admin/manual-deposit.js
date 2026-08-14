const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");
const { createDepositIntent, confirmDeposit } = require("../../lib/deposits");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const keyId = req.body && req.body.keyId;
  const amount = Number(req.body && req.body.amount);

  if (!keyId || typeof keyId !== "string") {
    return res.status(400).json({ success: false, error: "Missing keyId." });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: "Invalid amount." });
  }

  const { data: keyRow, error: keyError } = await getSupabaseAdmin()
    .from("keys")
    .select("device_id")
    .eq("id", keyId)
    .maybeSingle();

  if (keyError || !keyRow) return res.status(404).json({ success: false, error: "Key not found." });
  if (!keyRow.device_id) {
    return res.status(400).json({ success: false, error: "This key hasn't been used on any device yet." });
  }

  try {
    const { transactionId } = await createDepositIntent(keyRow.device_id, amount, "manual");
    const result = await confirmDeposit(transactionId, "manual-admin-confirm");
    return res.status(200).json({ success: true, walletBalance: result.walletBalance });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, retryable: true });
  }
};
