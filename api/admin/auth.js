const { getLimiters, getClientIp } = require("../../lib/ratelimit");
const {
  createSessionValue,
  verifyAdminPassword,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} = require("../../lib/adminSession");
const { serializeCookie } = require("../../lib/cookies");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const action = req.body && req.body.action;

  if (action === "logout") {
    res.setHeader(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "Strict", maxAge: 0 })
    );
    return res.status(200).json({ ok: true });
  }

  // default: login
  const ip = getClientIp(req);
  const { adminLogin } = getLimiters();
  const { success } = await adminLogin.limit(ip);
  if (!success) return res.status(429).json({ error: "Too many attempts. Try again later." });

  const password = req.body && req.body.password;
  if (!password || typeof password !== "string") {
    return res.status(400).json({ error: "Invalid request." });
  }
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ error: "Incorrect password." });
  }

  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, createSessionValue(), {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS,
    })
  );
  return res.status(200).json({ ok: true });
};
