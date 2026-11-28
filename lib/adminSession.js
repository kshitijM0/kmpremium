const { createHmac, timingSafeEqual } = require("crypto");
const { parseCookies } = require("./cookies");

const SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("Missing ADMIN_SESSION_SECRET env variable.");
  return secret;
}

function sign(payload) {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

function createSessionValue() {
  const expiry = Date.now() + SESSION_TTL_MS;
  const payload = String(expiry);
  return `${payload}.${sign(payload)}`;
}

function isSessionValid(value) {
  if (!value) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;

  const expected = sign(payload);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  if (!timingSafeEqual(sigBuf, expBuf)) return false;

  const expiry = Number(payload);
  return Number.isFinite(expiry) && Date.now() < expiry;
}

function verifyAdminPassword(candidate) {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) throw new Error("Missing ADMIN_PASSWORD env variable.");
  const candidateBuf = Buffer.from(candidate || "");
  const realBuf = Buffer.from(real);
  if (candidateBuf.length !== realBuf.length) return false;
  return timingSafeEqual(candidateBuf, realBuf);
}

function isAdminRequest(req) {
  const cookies = parseCookies(req);
  return isSessionValid(cookies[SESSION_COOKIE]);
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS: SESSION_TTL_MS / 1000,
  createSessionValue,
  isSessionValid,
  verifyAdminPassword,
  isAdminRequest,
};
