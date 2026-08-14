const { getSupabaseAdmin } = require("./supabase");

// SERVER-ONLY FILE.
// This is the ONE place that knows how a deposit becomes a wallet credit.
// A payment gateway integration (Razorpay, etc.) never touches the `keys`
// table directly — it only calls confirmDeposit() after verifying payment
// on its own server side. This keeps the wallet logic identical no matter
// which gateway is wired in later.

// Step 1: user clicks "Add Funds" -> create a pending transaction row.
// Returns { transactionId } which the frontend hands to whichever gateway
// checkout flow is active (or to the admin, for manual confirmation today).
async function createDepositIntent(keyId, amount, gateway = null) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid deposit amount.");
  }

  const { data, error } = await getSupabaseAdmin()
    .from("wallet_transactions")
    .insert({
      key_id: keyId,
      type: "deposit",
      amount,
      status: "pending",
      gateway,
      description: gateway ? `Deposit via ${gateway}` : "Deposit (pending confirmation)",
    })
    .select("id")
    .single();

  if (error) throw new Error("Could not create deposit intent.");
  return { transactionId: data.id };
}

// Step 2: gateway confirms payment succeeded (webhook, or admin manual
// confirm today) -> atomically credit the wallet and mark the transaction
// completed. Idempotent: a transaction already completed/failed is a no-op,
// so a webhook firing twice can never double-credit.
async function confirmDeposit(transactionId, gatewayReference = null) {
  const supabase = getSupabaseAdmin();

  const { data: tx, error: fetchError } = await supabase
    .from("wallet_transactions")
    .select("id, key_id, amount, status, type")
    .eq("id", transactionId)
    .maybeSingle();

  if (fetchError || !tx) throw new Error("Deposit transaction not found.");
  if (tx.type !== "deposit") throw new Error("Not a deposit transaction.");
  if (tx.status !== "pending") return { alreadyProcessed: true, status: tx.status };

  const { data: newBalance, error: adjustError } = await supabase.rpc("adjust_wallet_balance", {
    p_key_id: tx.key_id,
    p_delta: tx.amount,
  });
  if (adjustError) throw new Error("Could not credit wallet.");

  await supabase
    .from("wallet_transactions")
    .update({
      status: "completed",
      balance_after: newBalance,
      gateway_reference: gatewayReference,
      completed_at: new Date().toISOString(),
    })
    .eq("id", transactionId);

  return { alreadyProcessed: false, walletBalance: newBalance };
}

async function failDeposit(transactionId, reason) {
  await getSupabaseAdmin()
    .from("wallet_transactions")
    .update({ status: "failed", description: reason || "Payment failed" })
    .eq("id", transactionId)
    .eq("status", "pending"); // only touch it if still pending
}

module.exports = { createDepositIntent, confirmDeposit, failDeposit };
