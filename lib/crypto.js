const crypto = require("crypto");

// SERVER-ONLY FILE. Provider API keys are encrypted at rest using
// PROVIDER_ENCRYPTION_KEY (a Vercel-only secret, never sent to the browser).

function getKey() {
  const secret = process.env.PROVIDER_ENCRYPTION_KEY;
  if (!secret) throw new Error("Missing PROVIDER_ENCRYPTION_KEY env variable.");
  // Derive a fixed 32-byte key from whatever-length secret string is set.
  return crypto.createHash("sha256").update(secret).digest();
}

// Returns "iv:tag:ciphertext" (all base64) — safe to store as a single text column.
function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted payload.");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

module.exports = { encryptSecret, decryptSecret };
