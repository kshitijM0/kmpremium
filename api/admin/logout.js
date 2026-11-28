const { SESSION_COOKIE } = require("../../lib/adminSession");
const { serializeCookie } = require("../../lib/cookies");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: 0,
    })
  );
  return res.status(200).json({ ok: true });
};
