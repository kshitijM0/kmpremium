// /api/auto?route=cron — sends the scheduled parts that are due.
// Needed only where no always-on server exists (Vercel): a free pinger (e.g. cron-job.org) calls it every minute.
//   POST with header  x-cron-secret: <CRON_SECRET>          (preferred)
//   GET  ...&secret=<CRON_SECRET>                            (for pingers that cannot set headers)
// The admin page can also trigger it ("Send due parts now"). On Render the server does this by itself.
const { timingSafeEqual } = require("crypto");
const { isAdminRequest } = require("../adminSession");
const { runDue } = require("../sched/fire");

function secretMatches(given) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false; // no secret configured -> only the admin may trigger it
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ success: false, error: "Use POST or GET." });
  const byAdmin = (() => { try { return isAdminRequest(req); } catch { return false; } })();
  const given = req.headers["x-cron-secret"] || (req.query && req.query.secret) || "";
  if (!byAdmin && !secretMatches(given)) return res.status(401).json({ success: false, error: "Unauthorized." });

  try {
    const result = await runDue({ limit: req.query && req.query.limit });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("[cron]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
