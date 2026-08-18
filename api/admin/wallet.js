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
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });
  const supabase = getSupabaseAdmin();

  // ---------- GET: list pending UPI deposits ----------
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("id, device_id, amount, gateway_reference, screenshot_url, description, status, created_at")
      .eq("type", "deposit")
      .eq("gateway", "manual_upi")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) return res.status(500).json({ success: false, error: "Could not load pending deposits.", retryable: true });
    return res.status(200).json({ success: true, deposits: data });
  }

  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  const action = req.body && req.body.action;

  // ---------- APPROVE DEPOSIT ----------
  if (action === "approve-deposit") {
    const { transactionId } = req.body;
    if (!transactionId) return res.status(400).json({ success: false, error: "Missing transactionId." });
    try {
      const result = await confirmDeposit(transactionId, "manual-upi-admin-approved");
      if (result.alreadyProcessed) {
        return res.status(409).json({ success: false, error: `Already ${result.status}.` });
      }
      return res.status(200).json({ success: true, walletBalance: result.walletBalance });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message, retryable: true });
    }
  }

  // ---------- REJECT DEPOSIT ----------
  if (action === "reject-deposit") {
    const { transactionId, reason } = req.body;
    if (!transactionId) return res.status(400).json({ success: false, error: "Missing transactionId." });
    const { data, error } = await supabase
      .from("wallet_transactions")
      .update({ status: "failed", rejection_reason: reason || "Rejected by admin" })
      .eq("id", transactionId)
      .eq("status", "pending") // only touch it if still pending
      .select("id")
      .maybeSingle();
    if (error) return res.status(500).json({ success: false, error: "Could not reject deposit.", retryable: true });
    if (!data) return res.status(409).json({ success: false, error: "Deposit is no longer pending." });
    return res.status(200).json({ success: true });
  }

  // ---------- EXISTING: manual-deposit (admin creates + confirms in one step) ----------
  if (action === "manual-deposit") {
    const { keyId } = req.body;
    const amount = Number(req.body.amount);
    if (!keyId) return res.status(400).json({ success: false, error: "Missing keyId." });
    const { deviceId, error: resolveError } = await resolveDeviceId(supabase, keyId);
    if (resolveError) return res.status(400).json({ success: false, error: resolveError });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, error: "Invalid amount." });
    try {
      const { transactionId } = await createDepositIntent(deviceId, amount, "manual");
      const result = await confirmDeposit(transactionId, "manual-admin-confirm");
      return res.status(200).json({ success: true, walletBalance: result.walletBalance });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message, retryable: true });
    }
  }

  // ---------- EXISTING: adjust (admin add/subtract balance directly, no transaction claim) ----------
  const { keyId } = req.body;
  const amount = Number(req.body.amount);
  if (!keyId) return res.status(400).json({ success: false, error: "Missing keyId." });
  const { deviceId, error: resolveError } = await resolveDeviceId(supabase, keyId);
  if (resolveError) return res.status(400).json({ success: false, error: resolveError });
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ success: false, error: "Invalid amount." });

  const { data: newBalance, error: adjustError } = await supabase.rpc("adjust_device_wallet_balance", {
    p_device_id: deviceId,
    p_delta: amount,
  });
  if (adjustError) return res.status(500).json({ success: false, error: "Could not adjust balance.", retryable: true });

  const description = req.body.description || "Admin balance adjustment";
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
