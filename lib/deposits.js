const { getSupabaseAdmin } = require("./supabase");

// SERVER-ONLY FILE.
// Deposits credit a DEVICE's wallet (persists across key renewals on that
// device), not a specific key. A gateway integration only ever needs to
// call createDepositIntent()/confirmDeposit() — it never touches the
// devices table directly.

async function createDepositIntent(deviceId, amount, gateway = null) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid deposit amount.");
  }

  const { data, error } = await getSupabaseAdmin()
    .from("wallet_transactions")
    .insert({
      device_id: deviceId,
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

async function confirmDeposit(transactionId, gatewayReference = null) {
  const supabase = getSupabaseAdmin();

  const { data: tx, error: fetchError } = await supabase
    .from("wallet_transactions")
    .select("id, device_id, amount, status, type")
    .eq("id", transactionId)
    .maybeSingle();

  if (fetchError || !tx) throw new Error("Deposit transaction not found.");
  if (tx.type !== "deposit") throw new Error("Not a deposit transaction.");
  if (tx.status !== "pending") return { alreadyProcessed: true, status: tx.status };

  const { data: newBalance, error: adjustError } = await supabase.rpc("adjust_device_wallet_balance", {
    p_device_id: tx.device_id,
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
    .eq("status", "pending");
}

module.exports = { createDepositIntent, confirmDeposit, failDeposit };
