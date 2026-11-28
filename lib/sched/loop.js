// Keeps the scheduler running on a normal Node host (Render, VPS, local). Every 15 seconds it sends the parts that are due.
// On Vercel there is no always-on process, so a pinger calls /api/auto?route=cron instead (see DEPLOY.txt).
const { runDue } = require("./fire");

const TICK_MS = 15000;
let timer = null;
let running = false;
let lastError = "";

async function tick() {
  if (running) return; // never overlap two passes
  running = true;
  try {
    for (let round = 0; round < 10; round++) {
      const r = await runDue();
      if (!r.more) break;
    }
    lastError = "";
  } catch (err) {
    // print each different problem once, not every 15 seconds
    if (err.message !== lastError) console.error("[scheduler] error:", err.message, "(did you run supabase/scheduler-schema.sql?)");
    lastError = err.message;
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return timer;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[scheduler] not started: Supabase is not configured.");
    return null;
  }
  timer = setInterval(tick, TICK_MS);
  if (timer.unref) timer.unref();
  const first = setTimeout(tick, 3000);
  if (first.unref) first.unref();
  console.log("[scheduler] started (checks every 15 seconds)");
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
