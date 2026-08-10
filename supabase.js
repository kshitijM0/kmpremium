const { createClient } = require("@supabase/supabase-js");

// SERVER-ONLY FILE. SUPABASE_SERVICE_ROLE_KEY bypasses Row Level Security —
// it must only exist as a Vercel environment variable, never in frontend code.

let client = null;

function getSupabaseAdmin() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

module.exports = { getSupabaseAdmin };
