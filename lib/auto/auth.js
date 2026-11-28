// Admin login / logout. Replaces the missing api/admin/auth.js.
// Accepts both body shapes used by the site:  { password }  and  { action: "login", password }.
const { SESSION_COOKIE, SESSION_TTL_SECONDS, createSessionValue, verifyAdminPassword } = require("../adminSession");
const { serializeCookie } = require("../cookies");

async function rateLimited(req) {
  // Uses Upstash if it's configured; if it isn't (or errors), login still works.
  try {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return false;
    const { getLimiters, getClientIp } = require("../ratelimit");
    const { success } = await getLimiters().adminLogin.limit(getClientIp(req));
    return !success;
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const body = req.body || {};

  if (body.action === "logout") {
    res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "Strict", maxAge: 0 }));
    return res.status(200).json({ ok: true });
  }

  if (await rateLimited(req)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });

  let okPassword = false;
  try {
    okPassword = verifyAdminPassword(typeof body.password === "string" ? body.password : "");
  } catch (err) {
    return res.status(500).json({ error: "Server is missing ADMIN_PASSWORD." });
  }
  if (!okPassword) return res.status(401).json({ error: "Wrong password." });

  let sessionValue;
  try {
    sessionValue = createSessionValue();
  } catch (err) {
    return res.status(500).json({ error: "Server is missing ADMIN_SESSION_SECRET." });
  }

  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, sessionValue, { httpOnly: true, secure: true, sameSite: "Strict", maxAge: SESSION_TTL_SECONDS }));
  return res.status(200).json({ ok: true });
};
