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

  const ip = getClientIp(req);
  const { adminLogin } = getLimiters();
  const { success } = await adminLogin.limit(ip);
  if (!success) {
    return res.status(429).json({ error: "Too many attempts. Try again later." });
  }

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
      maxAge: SESSION_TTL_SECONDS,
    })
  );
  return res.status(200).json({ ok: true });
};
