// Sends the customers' custom comments to the provider at the right time.
//
// Why this exists: the external scheduler (/schedule-order) only knows service id + quantity, so a "custom comments"
// service never received the text the customer typed. Those parts are queued in auto_comment_jobs instead and this
// worker (it runs inside server.js) posts them to the provider itself, with the exact lines the customer wrote.
//
// A part that can't be delivered is retried a couple of times; if it still fails the customer's key is refunded
// for that part.
const { getSupabaseAdmin } = require("../supabase");
const { decryptSecret } = require("../crypto");
const { callProviderApi } = require("../providerApi");
const { round4 } = require("./keyStore");

const TICK_MS = 15000;
const BATCH = 10;
const MAX_ATTEMPTS = 3;
const STUCK_AFTER_MS = 15 * 60 * 1000;

async function sendToProvider(supabase, job) {
  const { data: provider } = await supabase
    .from("api_providers")
    .select("api_url, encrypted_api_key, status")
    .eq("id", job.provider_id)
    .maybeSingle();
  if (!provider) return { ok: false, retryable: false, error: "The provider was removed." };

  let apiKey;
  try {
    apiKey = decryptSecret(provider.encrypted_api_key);
  } catch {
    return { ok: false, retryable: false, error: "Stored provider key could not be decrypted." };
  }

  const r = await callProviderApi(
    provider.api_url,
    apiKey,
    {
      action: "add",
      service: job.provider_service_id,
      link: job.link,
      comments: String(job.comments).split("\n").join("\r\n"), // SMM panels take one comment per line
    },
    { maxAttempts: 1, timeoutMs: 25000 }
  );
  if (!r.ok) return r;

  const id = r.data && (r.data.order !== undefined ? r.data.order : r.data.order_id);
  if (id === undefined || id === null) return { ok: false, retryable: false, error: "Provider accepted the request but returned no order id." };
  return { ok: true, orderId: String(id) };
}

async function refundJob(supabase, job, reason) {
  const amount = round4(job.cost_usd);
  if (!job.key_id || !(amount > 0)) return;
  const { data } = await supabase.rpc("auto_key_credit", { p_key_id: job.key_id, p_amount: amount, p_is_topup: false });
  const r = Array.isArray(data) ? data[0] : data;
  await supabase.from("auto_key_events").insert({
    key_id: job.key_id,
    type: "refund",
    amount,
    balance_after: r && r.ok ? r.remaining : null,
    note: `comments not delivered: ${String(reason).slice(0, 120)}`,
  });
}

async function processJob(supabase, job) {
  let result;
  try {
    result = await sendToProvider(supabase, job);
  } catch (err) {
    result = { ok: false, retryable: true, error: err.message };
  }

  if (result.ok) {
    await supabase.from("auto_comment_jobs").update({ status: "sent", provider_order_id: result.orderId, error: null, sent_at: new Date().toISOString() }).eq("id", job.id);
    return "sent";
  }

  const error = String(result.error || "unknown error").slice(0, 300);
  if (result.retryable && job.attempts < MAX_ATTEMPTS) {
    const retryAt = new Date(Date.now() + job.attempts * 3 * 60 * 1000).toISOString();
    await supabase.from("auto_comment_jobs").update({ status: "pending", fire_at: retryAt, error }).eq("id", job.id);
    return "retry";
  }

  await supabase.from("auto_comment_jobs").update({ status: "failed", error }).eq("id", job.id);
  await refundJob(supabase, job, error);
  return "failed";
}

// One pass: send everything that is due. Returns how many were handled.
async function runOnce(supabase) {
  const db = supabase || getSupabaseAdmin();

  // a job stuck in "sending" means the server stopped mid-request: don't guess, flag it for a human
  await db
    .from("auto_comment_jobs")
    .update({ status: "failed", error: "Interrupted while sending — check the provider panel before re-sending." })
    .eq("status", "sending")
    .lt("claimed_at", new Date(Date.now() - STUCK_AFTER_MS).toISOString());

  let handled = 0;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await db.rpc("auto_comment_claim", { p_limit: BATCH });
    if (error) throw new Error(error.message || "claim failed");
    const jobs = Array.isArray(data) ? data : [];
    if (!jobs.length) break;
    for (const job of jobs) {
      await processJob(db, job);
      handled += 1;
    }
    if (jobs.length < BATCH) break;
  }
  return handled;
}

let timer = null;
let running = false;
let lastError = "";

function start() {
  if (timer) return timer;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[comments] worker not started: Supabase is not configured.");
    return null;
  }
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runOnce();
      lastError = "";
    } catch (err) {
      // print each different problem once, not every 15 seconds
      if (err.message !== lastError) console.error("[comments] worker error:", err.message, "(did you run supabase/auto-comment-jobs.sql?)");
      lastError = err.message;
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, TICK_MS);
  if (timer.unref) timer.unref();
  setTimeout(tick, 3000).unref();
  console.log("[comments] custom-comments worker started (checks every 15s)");
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce, processJob, MAX_ATTEMPTS };
