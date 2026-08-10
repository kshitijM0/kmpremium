const { getSupabaseAdmin } = require("../../lib/supabase");
const { generateKeyValue } = require("../../lib/keygen");
const { isAdminRequest } = require("../../lib/adminSession");
const { getLimiters, getClientIp } = require("../../lib/ratelimit");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ error: "Unauthorized." });

  const { general } = getLimiters();
  const { success } = await general.limit(getClientIp(req));
  if (!success) return res.status(429).json({ error: "Rate limited." });

  const id = req.body && req.body.id;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Invalid request." });

  const newKeyValue = generateKeyValue();

  const { data, error } = await getSupabaseAdmin()
    .from("keys")
    .update({ key_value: newKeyValue, last_reloaded_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) return res.status(404).json({ error: "Could not reload key." });
  return res.status(200).json({ key: data });
};
