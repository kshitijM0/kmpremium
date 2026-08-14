const { isAdminRequest } = require("../../lib/adminSession");
const { createDepositIntent, confirmDeposit } = require("../../lib/deposits");

// Today (no gateway wired up yet): admin creates + immediately confirms a
// deposit in one step, e.g. after receiving a manual UPI/bank transfer.
// Later, Razorpay's webhook will call confirmDeposit() directly instead —
// this route itself won't need to change.
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

  try {
    const { transactionId } = await createDepositIntent(keyId, amount, "manual");
    const result = await confirmDeposit(transactionId, "manual-admin-confirm");
    return res.status(200).json({ success: true, walletBalance: result.walletBalance });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, retryable: true });
  }
};
