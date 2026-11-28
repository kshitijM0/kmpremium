// Sends the parts that are due. Called by the cron route (and by server.js on a normal Node host).
// Each part: read the panel details (decrypted only here), call the panel, then mark the part sent / retry / failed.
// A part that can't be delivered is retried twice; after that, if it was paid from a KM key, the key is refunded for it.
const { getSupabaseAdmin } = require("../supabase");
const { decryptSecret } = require("../crypto");
const { callProviderApi } = require("../providerApi");
const { assertPublicHttpUrl } = require("../urlGuard");

const MAX_ATTEMPTS = 3;
const STUCK_AFTER_MS = 15 * 60 * 1000;
const CONCURRENCY = 5;

const failure = (error) => ({ ok: false, retryable: false, error });

async function sendLeg(leg, order, providers) {
  let url;
  let key;
  try {
    if (leg.provider_id) {
      const p = providers.get(String(leg.provider_id));
      if (!p) return failure("The provider was removed.");
      url = p.api_url;
      key = decryptSecret(p.encrypted_api_key);
    } else {
      if (!leg.base_url || !leg.api_key_enc) return failure("This part has no panel details.");
      url = leg.base_url;
      key = decryptSecret(leg.api_key_enc);
    }
    assertPublicHttpUrl(url);
  } catch (err) {
    return failure(err.message);
  }

  const params = { action: "add", service: String(leg.service_id), link: order.link };
  if (leg.comments) params.comments = String(leg.comments).split("\n").join("\r\n"); // panels take one comment per line
  else params.quantity = String(leg.quantity);

  const r = await callProviderApi(url, key, params, { maxAttempts: 1, timeoutMs: 20000 });
  if (!r.ok) return r;
  const id = r.data && (r.data.order !== undefined ? r.data.order : r.data.order_id);
  if (id === undefined || id === null) return failure("The panel accepted the request but returned no order id.");
  return { ok: true, orderId: String(id) };
}

async function refund(sb, leg, order, reason) {
  const amount = Number(leg.cost_usd);
  if (!order || !order.key_id || !(amount > 0)) return;
  const { data } = await sb.rpc("auto_key_credit", { p_key_id: order.key_id, p_amount: amount, p_is_topup: false });
  const r = Array.isArray(data) ? data[0] : data;
  await sb.from("auto_key_events").insert({
    key_id: order.key_id,
    type: "refund",
    amount,
    balance_after: r && r.ok ? r.remaining : null,
    note: `part not delivered: ${String(reason).slice(0, 120)}`,
  });
}

async function finishLeg(sb, leg, order, result) {
  if (result.ok) {
    await sb.from("sched_legs").update({ status: "sent", provider_order_id: result.orderId, error: null, sent_at: new Date().toISOString() }).eq("id", leg.id);
    return "sent";
  }
  const error = String(result.error || "unknown error").slice(0, 300);
  if (result.retryable && leg.attempts < MAX_ATTEMPTS) {
    const retryAt = new Date(Date.now() + leg.attempts * 2 * 60 * 1000).toISOString();
    await sb.from("sched_legs").update({ status: "pending", fire_at: retryAt, error }).eq("id", leg.id);
    return "retried";
  }
  await sb.from("sched_legs").update({ status: "failed", error }).eq("id", leg.id);
  await refund(sb, leg, order, error);
  return "failed";
}

async function runDue({ limit, supabase } = {}) {
  const sb = supabase || getSupabaseAdmin();
  const max = Math.min(Math.max(parseInt(limit || process.env.CRON_BATCH || 20, 10) || 20, 1), 100);
  const out = { handled: 0, sent: 0, retried: 0, failed: 0, more: false };

  // a part stuck in "sending" means the server stopped mid-request: don't guess, never re-send blindly
  await sb
    .from("sched_legs")
    .update({ status: "failed", error: "Interrupted while sending — check the panel before re-sending." })
    .eq("status", "sending")
    .lt("claimed_at", new Date(Date.now() - STUCK_AFTER_MS).toISOString());

  const { data: claimed, error } = await sb.rpc("sched_claim_legs", { p_limit: max });
  if (error) throw new Error(error.message || "Could not claim the due parts.");
  const legs = Array.isArray(claimed) ? claimed : [];
  if (!legs.length) return out;
  out.more = legs.length >= max;

  const orderIds = [...new Set(legs.map((l) => l.order_id))];
  const { data: orderRows } = await sb.from("sched_orders").select("id, link, key_id").in("id", orderIds);
  const orders = new Map((orderRows || []).map((o) => [o.id, o]));

  const providerIds = [...new Set(legs.filter((l) => l.provider_id).map((l) => String(l.provider_id)))];
  let providerRows = [];
  if (providerIds.length) {
    const { data } = await sb.from("api_providers").select("id, api_url, encrypted_api_key").in("id", providerIds);
    providerRows = data || [];
  }
  const providers = new Map(providerRows.map((p) => [String(p.id), p]));

  let next = 0;
  async function worker() {
    while (next < legs.length) {
      const leg = legs[next++];
      const order = orders.get(leg.order_id);
      let result;
      try {
        result = order ? await sendLeg(leg, order, providers) : failure("The order no longer exists.");
      } catch (err) {
        result = { ok: false, retryable: true, error: err.message };
      }
      try {
        const outcome = await finishLeg(sb, leg, order, result);
        out[outcome] += 1;
      } catch (err) {
        console.error("[scheduler] could not record the result of a part:", err.message);
      }
      out.handled += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, legs.length) }, worker));
  return out;
}

module.exports = { runDue, MAX_ATTEMPTS };
