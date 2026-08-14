const { createHmac, timingSafeEqual } = require("crypto");
const { parseCookies } = require("./cookies");

// SERVER-ONLY FILE.
// After a raw access key is validated once, we issue this signed cookie
// containing only the key's internal id (never the raw key string).
// Every later request (wallet, orders, profiles) trusts this cookie instead
// of requiring the raw key again.

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

// payload = "<keyId>.<expiryTimestamp>"
function createSessionValue(keyId) {
  const expiry = Date.now() + SESSION_TTL_MS;
  const payload = `${keyId}.${expiry}`;
  return `${payload}.${sign(payload)}`;
}

// Returns the keyId if the cookie is valid and unexpired, otherwise null.
function readSession(req) {
  const cookies = parseCookies(req);
  const value = cookies[SESSION_COOKIE];
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [keyId, expiryStr, signature] = parts;
  const payload = `${keyId}.${expiryStr}`;

  const expected = sign(payload);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || Date.now() >= expiry) return null;

  return keyId;
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS: SESSION_TTL_MS / 1000,
  createSessionValue,
  readSession,
};
