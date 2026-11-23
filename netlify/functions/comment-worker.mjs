// Scheduled function: delivers customers' queued custom comments to the provider.
// On Render this ran as a 15-second timer inside server.js; on Netlify it runs once a minute instead.
import worker from "../../lib/auto/commentWorker.js";

export default async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[comments] skipped: Supabase is not configured.");
    return;
  }
  try {
    const handled = await worker.runOnce();
    if (handled) console.log(`[comments] handled ${handled} job(s)`);
  } catch (err) {
    console.error("[comments] worker error:", err.message);
  }
};

export const config = {
  schedule: "* * * * *",
};
