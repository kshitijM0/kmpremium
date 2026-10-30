// Per-panel service configuration.
//
// GET  /api/panel-config?hosts=yoyomedia.in,groupsocial.in
//      -> returns the admin-curated services for the panels the customer connected.
//         No secrets are ever returned — only service ids/names.
// POST /api/panel-config   (admin cookie required)
//      actions: providers | panel-services | list | save | delete
//
// Uses the existing api_providers table (Auto Order > Master Providers) to read a panel's
// live service list with its stored, encrypted key. Nothing here exposes that key.

const { getSupabaseAdmin } = require("../lib/supabase");
const { isAdminRequest } = require("../lib/adminSession");
const { decryptSecret } = require("../lib/crypto");
const { callProviderApi } = require("../lib/providerApi");

const CATEGORIES = ["views", "likes", "share", "save", "comments", "repost"];
const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

function normalizeHost(urlOrHost) {
  const raw = String(urlOrHost || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function safeIsAdmin(req) {
  try { return isAdminRequest(req); } catch { return false; }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const supabase = getSupabaseAdmin();

  // ---------------- CUSTOMER READ ----------------
  if (req.method === "GET") {
    // Public read on purpose: only service ids/names, never keys. Requiring the key-session cookie
    // here made the Auto tab silently fall back to "all services" whenever the cookie was missing.
    const hosts = String((req.query && req.query.hosts) || "")
      .split(",")
      .map(normalizeHost)
      .filter((h) => h && HOST_RE.test(h))
      .slice(0, 10);
    if (!hosts.length) return res.status(200).json({ success: true, config: {} });

    const { data, error } = await supabase
      .from("panel_service_config")
      .select("panel_host, category, service_id, service_name, display_order")
      .in("panel_host", hosts)
      .eq("active", true)
      .order("display_order", { ascending: true });
    if (error) return res.status(500).json({ success: false, error: "Could not load panel config.", retryable: true });

    const config = {};
    for (const row of data || []) {
      if (!config[row.panel_host]) config[row.panel_host] = {};
      if (!config[row.panel_host][row.category]) config[row.panel_host][row.category] = [];
      config[row.panel_host][row.category].push({ id: row.service_id, name: row.service_name });
    }
    return res.status(200).json({ success: true, config });
  }

  // ---------------- ADMIN ACTIONS ----------------
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!safeIsAdmin(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const body = req.body || {};
  const action = body.action;

  if (action === "providers") {
    const { data, error } = await supabase
      .from("api_providers")
      .select("id, provider_name, api_url, status")
      .order("created_at", { ascending: true });
    if (error) return res.status(500).json({ success: false, error: "Could not load providers." });
    const providers = (data || []).map((p) => ({ ...p, host: normalizeHost(p.api_url) }));
    return res.status(200).json({ success: true, providers });
  }

  if (action === "panel-services") {
    if (!body.providerId) return res.status(400).json({ success: false, error: "Missing providerId." });
    const { data: provider } = await supabase
      .from("api_providers")
      .select("id, api_url, encrypted_api_key")
      .eq("id", body.providerId)
      .maybeSingle();
    if (!provider) return res.status(404).json({ success: false, error: "Provider not found." });

    let apiKey;
    try { apiKey = decryptSecret(provider.encrypted_api_key); }
    catch { return res.status(500).json({ success: false, error: "Stored API key could not be decrypted." }); }

    const result = await callProviderApi(provider.api_url, apiKey, { action: "services" });
    if (!result.ok) return res.status(502).json({ success: false, error: result.error });

    const list = Array.isArray(result.data) ? result.data : [];
    const services = list
      .filter((s) => s && s.service != null)
      .map((s) => ({
        id: String(s.service),
        name: s.name || "",
        category: s.category || "",
        rate: s.rate !== undefined ? Number(s.rate) : null,
        min: s.min !== undefined ? Number(s.min) : null,
        max: s.max !== undefined ? Number(s.max) : null,
      }));
    return res.status(200).json({ success: true, host: normalizeHost(provider.api_url), services });
  }

  if (action === "list") {
    const { data, error } = await supabase
      .from("panel_service_config")
      .select("panel_host, category, service_id, service_name, display_order")
      .order("panel_host", { ascending: true })
      .order("display_order", { ascending: true });
    if (error) return res.status(500).json({ success: false, error: "Could not load config." });
    const config = {};
    for (const row of data || []) {
      if (!config[row.panel_host]) config[row.panel_host] = {};
      if (!config[row.panel_host][row.category]) config[row.panel_host][row.category] = [];
      config[row.panel_host][row.category].push({ id: row.service_id, name: row.service_name });
    }
    return res.status(200).json({ success: true, config });
  }

  if (action === "save") {
    const host = normalizeHost(body.panelHost);
    const category = body.category;
    if (!host || !HOST_RE.test(host)) return res.status(400).json({ success: false, error: "Invalid panel host." });
    if (!CATEGORIES.includes(category)) return res.status(400).json({ success: false, error: "Invalid category." });
    if (!Array.isArray(body.services) || body.services.length > 200) {
      return res.status(400).json({ success: false, error: "services must be an array (max 200)." });
    }

    const seen = new Set();
    const rows = [];
    body.services.forEach((s) => {
      const id = s && s.id != null ? String(s.id).trim() : "";
      if (!id || id.length > 50 || seen.has(id)) return;
      seen.add(id);
      rows.push({
        panel_host: host,
        category,
        service_id: id,
        service_name: s.name ? String(s.name).slice(0, 300) : null,
        display_order: rows.length,
        active: true,
      });
    });

    const { error: delError } = await supabase.from("panel_service_config").delete().eq("panel_host", host).eq("category", category);
    if (delError) return res.status(500).json({ success: false, error: "Could not clear old config." });
    if (rows.length) {
      const { error: insError } = await supabase.from("panel_service_config").insert(rows);
      if (insError) return res.status(500).json({ success: false, error: "Could not save config." });
    }
    return res.status(200).json({ success: true, saved: rows.length });
  }

  if (action === "delete") {
    const host = normalizeHost(body.panelHost);
    if (!host) return res.status(400).json({ success: false, error: "Invalid panel host." });
    let q = supabase.from("panel_service_config").delete().eq("panel_host", host);
    if (body.category) {
      if (!CATEGORIES.includes(body.category)) return res.status(400).json({ success: false, error: "Invalid category." });
      q = q.eq("category", body.category);
    }
    const { error } = await q;
    if (error) return res.status(500).json({ success: false, error: "Could not delete." });
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ success: false, error: "Unknown action." });
};
