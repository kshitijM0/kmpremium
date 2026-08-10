const { getSupabaseAdmin } = require("../lib/supabase");
const { getLimiters, getClientIp } = require("../lib/ratelimit");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ valid: false, error: "Method not allowed." });

  const { validateKey } = getLimiters();
  const { success } = await validateKey.limit(getClientIp(req));
  if (!success) {
    return res.status(429).json({ valid: false, error: "Too many attempts. Try again later." });
  }

  const key = req.body && req.body.key;
  if (!key || typeof key !== "string" || key.length < 5 || key.length > 100) {
    return res.status(400).json({ valid: false, error: "Invalid request." });
  }

  const { data } = await getSupabaseAdmin()
    .from("keys")
    .select("status, expires_at")
    .eq("key_value", key)
    .maybeSingle();

  const isValid = !!data && data.status === "active" && new Date(data.expires_at) > new Date();
  return res.status(200).json({ valid: isValid });
};
