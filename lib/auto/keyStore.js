// Shared helpers for prepaid "auto keys" (USD balance).
const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no 0/O/1/I
const KEY_RE = /^KM-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const EXHAUSTED_BELOW = 0.01; // USD

function generateKeyValue() {
  const bytes = crypto.randomBytes(12);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length]; // 256 % 32 === 0 -> unbiased
  return `KM-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

function normalizeKey(input) {
  return String(input || "").trim().toUpperCase().replace(/\s+/g, "");
}

function maskKey(key) {
  return `KM-••••-••••-${String(key).slice(-4)}`;
}

function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}

function keyFromRequest(req) {
  const h = req.headers && (req.headers["x-km-key"] || req.headers["X-KM-Key"]);
  const b = req.body && typeof req.body === "object" ? req.body.key : null;
  return normalizeKey(h || b || "");
}

// Per-IP brake on WRONG keys only (valid keys never consume it). Skipped when Upstash isn't configured.
async function failedKeyBrake(req) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return false;
  try {
    const { getLimiters, getClientIp } = require("../ratelimit");
    const { success } = await getLimiters().validateKey.limit(getClientIp(req));
    return !success;
  } catch {
    return false;
  }
}

// Looks the key up and answers the request itself when it can't be used. Returns the row or null.
async function requireUsableKey(req, res, supabase) {
  const keyValue = keyFromRequest(req);
  const reject = async (status, code, error) => {
    if (code === "invalid" && (await failedKeyBrake(req))) {
      res.status(429).json({ success: false, code: "rate_limited", error: "Too many wrong keys. Try again in a minute." });
    } else {
      res.status(status).json({ success: false, code, error });
    }
    return null;
  };

  if (!KEY_RE.test(keyValue)) return reject(401, "invalid", "That key isn't valid.");

  const { data: row } = await supabase
    .from("auto_keys")
    .select("id, key_value, initial_usd, remaining_usd, status")
    .eq("key_value", keyValue)
    .maybeSingle();

  if (!row) return reject(401, "invalid", "That key isn't valid.");
  if (row.status === "revoked") return reject(403, "revoked", "This key has been deactivated.");
  if (row.status === "exhausted" || Number(row.remaining_usd) < EXHAUSTED_BELOW) {
    return reject(403, "exhausted", "This key's balance is used up. Ask for a new key.");
  }
  return row;
}

module.exports = { generateKeyValue, normalizeKey, maskKey, round4, keyFromRequest, requireUsableKey, KEY_RE, EXHAUSTED_BELOW };
