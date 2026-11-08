// PASTE THIS INTO THE kmpanel SCHEDULER (the service at https://kmpanel.onrender.com), not into the website.
//
// Why: the order list and the activity log (which contains people's API keys) are readable by anyone who
// knows the URL. The website now reads them through its own server, which filters what each person may see,
// but that only helps if the scheduler stops answering strangers.
//
// How:
//  1) Add the middleware below to the scheduler's Express app, BEFORE its routes (right after `const app = express()`).
//  2) On the scheduler's Render service add an environment variable  KM_SCHEDULER_SECRET = <a long random text>.
//  3) On the WEBSITE's Render service add the same variable with the SAME value, then redeploy both.
//  Until KM_SCHEDULER_SECRET is set on the scheduler this does nothing, so nothing can break while you roll it out.
//
// It protects only the lists that leak data. /proxy, /schedule-order and /history keep working as before.
const crypto = require("crypto");

const PROTECTED = [/^\/orders(\/|$)/, /^\/activity-log\/?$/, /^\/delivered-log\/?$/];

function kmSecretGuard(req, res, next) {
  const secret = process.env.KM_SCHEDULER_SECRET;
  if (!secret) return next(); // not configured yet -> behave exactly as before
  if (!PROTECTED.some((re) => re.test(req.path))) return next();

  const given = Buffer.from(String(req.get("x-km-secret") || ""));
  const wanted = Buffer.from(secret);
  const ok = given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
  if (!ok) return res.status(401).json({ error: "Unauthorized" });
  return next();
}

// usage:   app.use(kmSecretGuard);
module.exports = kmSecretGuard;
