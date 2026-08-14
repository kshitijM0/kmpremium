const { getSupabaseAdmin } = require("../lib/supabase");
const { getLimiters, getClientIp } = require("../lib/ratelimit");
const { createSessionValue, SESSION_COOKIE, SESSION_TTL_SECONDS } = require("../lib/keySession");
const { serializeCookie } = require("../lib/cookies");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ valid: false, error: "Method not allowed." });

  const { validateKey } = getLimiters();
  const { success } = await validateKey.limit(getClientIp(req));
  if (!success) {
    return res.status(429).json({ valid: false, error: "Too many attempts. Try again later." });
  }

  const key = req.body && req.body.key;
  const deviceId = req.body && req.body.deviceId;

  if (!key || typeof key !== "string" || key.length < 5 || key.length > 100) {
    return res.status(400).json({ valid: false, error: "Invalid request." });
  }
  if (!deviceId || typeof deviceId !== "string" || deviceId.length < 5 || deviceId.length > 200) {
    return res.status(400).json({ valid: false, error: "Invalid request." });
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("keys")
    .select("id, status, expires_at, device_id")
    .eq("key_value", key)
    .maybeSingle();

  const activeAndNotExpired =
    !!data && data.status === "active" && new Date(data.expires_at) > new Date();

  if (!activeAndNotExpired) {
    return res.status(200).json({ valid: false });
  }

  if (!data.device_id) {
    await supabase.from("keys").update({ device_id: deviceId }).eq("id", data.id);
  } else if (data.device_id !== deviceId) {
    return res.status(200).json({ valid: false, error: "This key is already in use on another device." });
  }

  // Ensure the device's wallet row exists (no-op if it already does) —
  // wallet_balance stays whatever it already was for this device.
  await supabase
    .from("devices")
    .upsert({ device_id: deviceId }, { onConflict: "device_id", ignoreDuplicates: true });

  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, createSessionValue(data.id, deviceId), {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: SESSION_TTL_SECONDS,
    })
  );

  return res.status(200).json({ valid: true });
};
