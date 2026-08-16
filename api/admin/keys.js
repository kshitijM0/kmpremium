const { getSupabaseAdmin } = require("../../lib/supabase");
const { generateKeyValue, expiryFromMinutes } = require("../../lib/keygen");
const { isAdminRequest } = require("../../lib/adminSession");
const { getLimiters, getClientIp } = require("../../lib/ratelimit");

module.exports = async (req, res) => {
  if (!isAdminRequest(req)) return res.status(401).json({ error: "Unauthorized." });
  const supabase = getSupabaseAdmin();

  if (req.method === "GET") {
    const { data: keys, error } = await supabase
      .from("keys")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: "Could not fetch keys." });

    const deviceIds = [...new Set(keys.filter((k) => k.device_id).map((k) => k.device_id))];
    let balanceByDevice = {};
    if (deviceIds.length) {
      const { data: devices } = await supabase.from("devices").select("device_id, wallet_balance").in("device_id", deviceIds);
      balanceByDevice = Object.fromEntries((devices || []).map((d) => [d.device_id, d.wallet_balance]));
    }
    const enriched = keys.map((k) => ({ ...k, wallet_balance: k.device_id ? (balanceByDevice[k.device_id] ?? 0) : null }));
    return res.status(200).json({ keys: enriched });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const { general } = getLimiters();
  const { success } = await general.limit(getClientIp(req));
  if (!success) return res.status(429).json({ error: "Rate limited." });

  const action = req.body && req.body.action;

  if (action === "generate") {
    const durationMinutes = Number(req.body.durationMinutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 60 * 24 * 365) {
      return res.status(400).json({ error: "Invalid duration." });
    }
    const keyValue = generateKeyValue();
    const expiresAt = expiryFromMinutes(durationMinutes);
    const { data, error } = await supabase
      .from("keys")
      .insert({ key_value: keyValue, duration_minutes: durationMinutes, expires_at: expiresAt.toISOString(), source: "admin", status: "active" })
      .select()
      .single();
    if (error) return res.status(500).json({ error: "Could not create key." });
    return res.status(200).json({ key: data });
  }

  if (action === "reload") {
    const id = req.body.id;
    if (!id) return res.status(400).json({ error: "Invalid request." });
    const newKeyValue = generateKeyValue();
    const { data, error } = await supabase
      .from("keys")
      .update({ key_value: newKeyValue, last_reloaded_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: "Could not reload key." });
    return res.status(200).json({ key: data });
  }

  if (action === "revoke") {
    const id = req.body.id;
    if (!id) return res.status(400).json({ error: "Invalid request." });
    const { error } = await supabase.from("keys").update({ status: "revoked" }).eq("id", id);
    if (error) return res.status(500).json({ error: "Could not revoke key." });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "Unknown action." });
};
