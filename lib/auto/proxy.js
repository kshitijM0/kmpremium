// Relay for the calls the browser makes to a customer's OWN panel (connect, balance, services...).
// Browsers can't call other panels directly (CORS), so the page posts { baseUrl, params } here and gets the panel's answer.
//   POST /api/proxy  { baseUrl: "https://panel.example/api/v2", params: { key, action, ... } }
const { assertPublicHttpUrl } = require("../urlGuard");

const MAX_PARAMS = 30;
const MAX_BODY_CHARS = 120000;

async function limited(req) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return false;
  try {
    const { getLimiters, getClientIp } = require("../ratelimit");
    const { success } = await getLimiters().proxy.limit(getClientIp(req));
    return !success;
  } catch {
    return false; // the rate limiter being down must not take the site down
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const { baseUrl, params } = req.body || {};

  let url;
  try {
    url = assertPublicHttpUrl(baseUrl);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) return res.status(400).json({ error: "Missing request details." });
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0 || entries.length > MAX_PARAMS) return res.status(400).json({ error: "Missing request details." });
  const body = new URLSearchParams();
  for (const [k, v] of entries) body.append(String(k).slice(0, 60), String(v));
  if (body.toString().length > MAX_BODY_CHARS) return res.status(413).json({ error: "The request is too large." });

  if (await limited(req)) return res.status(429).json({ error: "Too many requests. Wait a minute and try again." });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let text;
  let status;
  try {
    const r = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "manual", // never follow a redirect to somewhere the address check didn't see
      signal: controller.signal,
    });
    status = r.status;
    if (status >= 300 && status < 400) return res.status(502).json({ error: "The panel redirected the request. Use its exact address, starting with https://" });
    text = await r.text();
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    return res.status(504).json({ error: timedOut ? "The panel took too long to answer." : "Could not reach the panel." });
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return res.status(502).json({ error: `The panel did not return JSON (HTTP ${status}). Check the API address.` });
  }

  // remember (for the admin) which panel was connected with which key; never allowed to break the connection itself
  if (params.action === "services" && params.key && !(data && data.error)) {
    try {
      await require("../sched/store").recordConnect(url.toString(), String(params.key));
    } catch (err) {
      console.error("[proxy] could not log the connection:", err.message);
    }
  }
  return res.status(200).json(data);
};
