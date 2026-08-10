const { getSupabaseAdmin } = require("../lib/supabase");
const { generateKeyValue, expiryFromMinutes } = require("../lib/keygen");
const { getLimiters, getClientIp } = require("../lib/ratelimit");

const FREE_KEY_DURATION_MINUTES = 48 * 60; // 48 hours
const LINKVERTISE_VERIFY_URL = "https://publisher.linkvertise.com/api/v1/anti_bypassing";

async function verifyLinkvertiseHash(hash) {
  const token = process.env.LINKVERTISE_ANTI_BYPASS_TOKEN;
  if (!token) throw new Error("Missing LINKVERTISE_ANTI_BYPASS_TOKEN.");

  const url = `${LINKVERTISE_VERIFY_URL}?token=${encodeURIComponent(token)}&hash=${encodeURIComponent(hash)}`;
  const r = await fetch(url, { method: "POST" });
  if (!r.ok) return false;

  const text = (await r.text()).trim().toUpperCase();
  return text === "TRUE" || text === '"TRUE"';
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  // TEMP: disabled for testing — re-enable before going live!
  // const { freeKey } = getLimiters();
  // const { success } = await freeKey.limit(getClientIp(req));
  // if (!success) {
  //   return res.status(429).json({ error: "You've already claimed a free key today." });
  // }
  const hash = req.body && req.body.hash;
  if (!hash || typeof hash !== "string") {
    return res.status(400).json({ error: "Invalid request." });
  }

  let verified;
  try {
    verified = await verifyLinkvertiseHash(hash);
  } catch {
    return res.status(502).json({ error: "Verification service error." });
  }

  if (!verified) {
    return res.status(403).json({ error: "Ad completion could not be verified. Please try again." });
  }

  const keyValue = generateKeyValue();
  const expiresAt = expiryFromMinutes(FREE_KEY_DURATION_MINUTES);

  const { data, error } = await getSupabaseAdmin()
    .from("keys")
    .insert({
      key_value: keyValue,
      duration_minutes: FREE_KEY_DURATION_MINUTES,
      expires_at: expiresAt.toISOString(),
      source: "free_ad",
      status: "active",
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: "Could not create key." });
  return res.status(200).json({ key: data.key_value, expiresAt: data.expires_at });
};
