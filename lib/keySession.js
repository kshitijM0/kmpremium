const { createHmac, timingSafeEqual } = require("crypto");
const { parseCookies } = require("./cookies");

// SERVER-ONLY FILE.
// Session carries BOTH the key id (to check that specific key's
// active/expiry status) and the device id (the wallet's real owner —
// wallet balance persists across key renewals on the same device).

const SESSION_COOKIE = "km_customer_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (re-validated on next key entry)

function getSecret() {
  const secret = process.env.KEY_SESSION_SECRET;
  if (!secret) throw new Error("Missing KEY_SESSION_SECRET env variable.");
  return secret;
}

function sign(payload) {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

// payload = "<keyId>.<deviceId>.<expiryTimestamp>"
// deviceId is expected to be a UUID (no "." characters), so splitting on "."
// and taking the last 2 parts as expiry+signature, everything before that
// jointly as keyId+deviceId, keeps this safe even though deviceId itself
// contains no separator conflicts.
function createSessionValue(keyId, deviceId) {
  const expiry = Date.now() + SESSION_TTL_MS;
  const payload = `${keyId}.${deviceId}.${expiry}`;
  return `${payload}.${sign(payload)}`;
}

// Returns { keyId, deviceId } if the cookie is valid and unexpired, else null.
function readSession(req) {
  const cookies = parseCookies(req);
  const value = cookies[SESSION_COOKIE];
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [keyId, deviceId, expiryStr, signature] = parts;
  const payload = `${keyId}.${deviceId}.${expiryStr}`;

  const expected = sign(payload);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || Date.now() >= expiry) return null;

  return { keyId, deviceId };
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS: SESSION_TTL_MS / 1000,
  createSessionValue,
  readSession,
};
