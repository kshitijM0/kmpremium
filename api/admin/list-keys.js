const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ error: "Unauthorized." });

  const supabase = getSupabaseAdmin();

  const { data: keys, error } = await supabase
    .from("keys")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: "Could not fetch keys." });

  const deviceIds = [...new Set(keys.filter((k) => k.device_id).map((k) => k.device_id))];
  let balanceByDevice = {};
  if (deviceIds.length) {
    const { data: devices } = await supabase
      .from("devices")
      .select("device_id, wallet_balance")
      .in("device_id", deviceIds);
    balanceByDevice = Object.fromEntries((devices || []).map((d) => [d.device_id, d.wallet_balance]));
  }

  const enriched = keys.map((k) => ({
    ...k,
    wallet_balance: k.device_id ? (balanceByDevice[k.device_id] ?? 0) : null, // null = no device linked yet
  }));

  return res.status(200).json({ keys: enriched });
};
