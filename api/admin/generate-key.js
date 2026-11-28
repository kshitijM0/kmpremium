const { getSupabaseAdmin } = require("../../lib/supabase");
const { generateKeyValue, expiryFromMinutes } = require("../../lib/keygen");
const { isAdminRequest } = require("../../lib/adminSession");
const { getLimiters, getClientIp } = require("../../lib/ratelimit");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ error: "Unauthorized." });

  const { general } = getLimiters();
  const { success } = await general.limit(getClientIp(req));
  if (!success) return res.status(429).json({ error: "Rate limited." });

  const durationMinutes = Number(req.body && req.body.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 60 * 24 * 365) {
    return res.status(400).json({ error: "Invalid duration." });
  }

  const keyValue = generateKeyValue();
  const expiresAt = expiryFromMinutes(durationMinutes);

  const { data, error } = await getSupabaseAdmin()
    .from("keys")
    .insert({
      key_value: keyValue,
      duration_minutes: durationMinutes,
      expires_at: expiresAt.toISOString(),
      source: "admin",
      status: "active",
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: "Could not create key." });
  return res.status(200).json({ key: data });
};
