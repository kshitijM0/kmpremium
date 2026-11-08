// "This device" = a random id kept in an HttpOnly cookie. It never leaves the server in readable form:
// orders are tagged with a short HMAC of it, so nobody can work out another device's id from an order.
const crypto = require("crypto");
const { parseCookies, serializeCookie } = require("../cookies");

const COOKIE = "km_device";
const TWO_YEARS = 60 * 60 * 24 * 730;
const ID_RE = /^[0-9a-f]{36}$/;
const TAG_AT_END = /\s*⟦d:([0-9a-f]{10})⟧\s*$/;
const ANY_TAG = /\s*⟦d:[^⟧]*⟧/g;

function secret() {
  const s = process.env.DEVICE_TAG_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("Set ADMIN_SESSION_SECRET (or DEVICE_TAG_SECRET) so devices can be told apart.");
  return s;
}

function tagFor(deviceId) {
  return crypto.createHmac("sha256", secret()).update(`device:${deviceId}`).digest("hex").slice(0, 10);
}

function isHttps(req) {
  return Boolean(req.secure) || String((req.headers && req.headers["x-forwarded-proto"]) || "").split(",")[0].trim() === "https";
}

// Returns { id, tag }. Creates the cookie when the browser has none (unless create:false -> null).
function getDevice(req, res, { create = true } = {}) {
  const existing = parseCookies(req)[COOKIE];
  if (existing && ID_RE.test(existing)) return { id: existing, tag: tagFor(existing) };
  if (!create) return null;

  const id = crypto.randomBytes(18).toString("hex");
  const cookie = serializeCookie(COOKIE, id, { httpOnly: true, secure: isHttps(req), sameSite: "Lax", maxAge: TWO_YEARS });
  const previous = typeof res.getHeader === "function" ? res.getHeader("Set-Cookie") : undefined;
  res.setHeader("Set-Cookie", previous ? [].concat(previous, cookie) : cookie);
  return { id, tag: tagFor(id) };
}

// Order names carry the owner tag at the end. Whatever tag a browser sends is thrown away first.
function cleanName(name) {
  return String(name || "").replace(ANY_TAG, "").trim().slice(0, 90);
}
function tagName(name, tag) {
  return `${cleanName(name) || "Untitled order"} ⟦d:${tag}⟧`;
}
function splitName(name) {
  const text = String(name || "");
  const m = text.match(TAG_AT_END);
  return { name: cleanName(text), tag: m ? m[1] : null };
}

module.exports = { getDevice, tagFor, tagName, splitName, cleanName, COOKIE };
