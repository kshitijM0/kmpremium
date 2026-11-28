// SERVER-ONLY FILE.
// Same wire format as the existing Kmpanel-proxy's callPanel() —
// form-urlencoded POST with { key, action, ... } — so behavior matches
// what the site's real panels already expect.

const DEFAULT_TIMEOUT_MS = 15000;

async function callProviderApiOnce(apiUrl, apiKey, params, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

  const body = new URLSearchParams({ key: apiKey, ...params });
  const started = Date.now();

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    const responseMs = Date.now() - started;
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, retryable: false, error: "Provider did not return valid JSON.", responseMs };
    }

    if (data && data.error) {
      return { ok: false, retryable: isRetryableProviderError(data.error), error: String(data.error), responseMs };
    }
    return { ok: true, data, responseMs };
  } catch (err) {
    const responseMs = Date.now() - started;
    if (err.name === "AbortError") {
      return { ok: false, retryable: true, error: "Provider timed out.", responseMs };
    }
    return { ok: false, retryable: true, error: `Network error: ${err.message}`, responseMs };
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableProviderError(message) {
  const msg = String(message).toLowerCase();
  if (msg.includes("invalid api key") || msg.includes("unauthorized") || msg.includes("authentication")) {
    return false; // permanent — stop this provider, don't retry
  }
  return true; // temporary/unknown — safe to retry
}

// Retries only retryable failures, with a short backoff. Used by the queue
// engine (Phase 3+); the Provider Manager's own "Test" button uses a single
// attempt (retrying a live user-clicked test would just feel slow).
async function callProviderApi(apiUrl, apiKey, params, opts = {}) {
  const maxAttempts = opts.maxAttempts || 1;
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await callProviderApiOnce(apiUrl, apiKey, params, opts.timeoutMs);
    if (last.ok || !last.retryable || attempt === maxAttempts) return last;
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  return last;
}

module.exports = { callProviderApi };
