const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");
const { createDepositIntent, confirmDeposit } = require("../../lib/deposits");

async function resolveDeviceId(supabase, keyId) {
  const { data, error } = await supabase.from("keys").select("device_id").eq("id", keyId).maybeSingle();
  if (error || !data) return { error: "Key not found." };
  if (!data.device_id) return { error: "This key hasn't been used on any device yet." };
  return { deviceId: data.device_id };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const supabase = getSupabaseAdmin();
  const action = req.body && req.body.action;
  const keyId = req.body && req.body.keyId;
  const amount = Number(req.body && req.body.amount);

  if (!keyId || typeof keyId !== "string") return res.status(400).json({ success: false, error: "Missing keyId." });

  const { deviceId, error: resolveError } = await resolveDeviceId(supabase, keyId);
  if (resolveError) return res.status(400).json({ success: false, error: resolveError });

  if (action === "manual-deposit") {
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, error: "Invalid amount." });
    try {
      const { transactionId } = await createDepositIntent(deviceId, amount, "manual");
      const result = await confirmDeposit(transactionId, "manual-admin-confirm");
      return res.status(200).json({ success: true, walletBalance: result.walletBalance });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message, retryable: true });
    }
  }

  // default: "adjust"
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ success: false, error: "Invalid amount." });

  const { data: newBalance, error: adjustError } = await supabase.rpc("adjust_device_wallet_balance", {
    p_device_id: deviceId,
    p_delta: amount,
  });
  if (adjustError) return res.status(500).json({ success: false, error: "Could not adjust balance.", retryable: true });

  const description = (req.body && req.body.description) || "Admin balance adjustment";
  await supabase.from("wallet_transactions").insert({
    device_id: deviceId,
    key_id: keyId,
    type: "admin_adjustment",
    amount,
    balance_after: newBalance,
    description,
    status: "completed",
    completed_at: new Date().toISOString(),
  });

  return res.status(200).json({ success: true, walletBalance: newBalance });
};
