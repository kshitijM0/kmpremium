const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const keyId = req.body && req.body.keyId;
  const amount = Number(req.body && req.body.amount); // positive = credit, negative = debit
  const description = (req.body && req.body.description) || "Admin balance adjustment";

  if (!keyId || typeof keyId !== "string") {
    return res.status(400).json({ success: false, error: "Missing keyId." });
  }
  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ success: false, error: "Invalid amount." });
  }

  const supabase = getSupabaseAdmin();

  // Atomic — the SQL function does the increment in a single UPDATE, so two
  // simultaneous admin adjustments can never overwrite each other.
  const { data: newBalance, error: adjustError } = await supabase.rpc("adjust_wallet_balance", {
    p_key_id: keyId,
    p_delta: amount,
  });

  if (adjustError) {
    return res.status(500).json({ success: false, error: "Could not adjust balance.", retryable: true });
  }

  const { error: logError } = await supabase.from("wallet_transactions").insert({
    key_id: keyId,
    type: "admin_adjustment",
    amount,
    balance_after: newBalance,
    description,
  });

  if (logError) {
    // Balance already changed — surface this clearly rather than pretending
    // nothing happened, per the "never silently fail" rule.
    return res.status(207).json({
      success: true,
      warning: "Balance updated but the transaction log entry failed to save.",
      walletBalance: newBalance,
    });
  }

  return res.status(200).json({ success: true, walletBalance: newBalance });
};
