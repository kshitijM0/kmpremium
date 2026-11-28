// ADMIN: create / list / top up / deactivate prepaid USD keys.
//   GET  /api/auto?route=keys                 -> all keys
//   POST /api/auto?route=keys  { action: "create", amount, note, count }
//                              { action: "topup", id, amount }
//                              { action: "revoke", id }
//                              { action: "delete", id }
const { getSupabaseAdmin } = require("../supabase");
const { isAdminRequest } = require("../adminSession");
const { generateKeyValue, round4 } = require("./keyStore");

function parseAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 10000) return null;
  return round4(n);
}

module.exports = async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });
  const supabase = getSupabaseAdmin();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("auto_keys")
      .select("id, key_value, initial_usd, remaining_usd, status, note, created_at, last_used_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return res.status(500).json({ success: false, error: "Could not load keys. Did you run auto-keys-schema.sql?", retryable: true });
    return res.status(200).json({ success: true, keys: data });
  }

  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  const body = req.body || {};

  if (body.action === "create") {
    const amount = parseAmount(body.amount);
    if (amount === null) return res.status(400).json({ success: false, error: "Enter an amount between $0.01 and $10,000." });
    const count = Math.min(20, Math.max(1, parseInt(body.count, 10) || 1));
    const note = body.note ? String(body.note).slice(0, 100) : null;

    const created = [];
    for (let i = 0; i < count; i++) {
      let row = null;
      for (let attempt = 0; attempt < 5 && !row; attempt++) {
        const { data, error } = await supabase
          .from("auto_keys")
          .insert({ key_value: generateKeyValue(), initial_usd: amount, remaining_usd: amount, status: "active", note })
          .select("id, key_value, initial_usd, remaining_usd, status, note, created_at")
          .single();
        if (!error) row = data;
        else if (String(error.code) !== "23505") return res.status(500).json({ success: false, error: "Could not create key. Did you run auto-keys-schema.sql?" });
      }
      if (!row) return res.status(500).json({ success: false, error: "Could not generate a unique key." });
      created.push(row);
      await supabase.from("auto_key_events").insert({ key_id: row.id, type: "create", amount, balance_after: amount, note });
    }
    return res.status(200).json({ success: true, keys: created });
  }

  if (body.action === "topup") {
    const amount = parseAmount(body.amount);
    if (!body.id) return res.status(400).json({ success: false, error: "Missing id." });
    if (amount === null) return res.status(400).json({ success: false, error: "Enter an amount between $0.01 and $10,000." });
    const { data, error } = await supabase.rpc("auto_key_credit", { p_key_id: body.id, p_amount: amount, p_is_topup: true });
    const r = Array.isArray(data) ? data[0] : data;
    if (error) return res.status(500).json({ success: false, error: "Top-up failed." });
    if (!r || !r.ok) return res.status(409).json({ success: false, error: "That key is deactivated — create a new key instead." });
    await supabase.from("auto_key_events").insert({ key_id: body.id, type: "topup", amount, balance_after: r.remaining });
    return res.status(200).json({ success: true, remaining: Number(r.remaining), status: r.new_status });
  }

  if (body.action === "revoke") {
    if (!body.id) return res.status(400).json({ success: false, error: "Missing id." });
    const { error } = await supabase.from("auto_keys").update({ status: "revoked" }).eq("id", body.id);
    if (error) return res.status(500).json({ success: false, error: "Could not deactivate." });
    await supabase.from("auto_key_events").insert({ key_id: body.id, type: "revoke", note: "revoked by admin" });
    return res.status(200).json({ success: true });
  }

  if (body.action === "delete") {
    if (!body.id) return res.status(400).json({ success: false, error: "Missing id." });
    const { error } = await supabase.from("auto_keys").delete().eq("id", body.id);
    if (error) return res.status(500).json({ success: false, error: "Could not delete." });
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ success: false, error: "Unknown action." });
};
