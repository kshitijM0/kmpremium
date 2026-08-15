const { getSupabaseAdmin } = require("../../lib/supabase");
const { isAdminRequest } = require("../../lib/adminSession");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  if (!isAdminRequest(req)) return res.status(401).json({ success: false, error: "Unauthorized." });

  const id = req.body && req.body.id;
  if (!id || typeof id !== "string") return res.status(400).json({ success: false, error: "Missing id." });

  const supabase = getSupabaseAdmin();
  const { data: original, error: fetchError } = await supabase
    .from("api_providers")
    .select("provider_name, api_url, encrypted_api_key")
    .eq("id", id)
    .maybeSingle();

  if (fetchError || !original) return res.status(404).json({ success: false, error: "Provider not found." });

  // Encrypted key is copied as-is (already encrypted — no need to decrypt/re-encrypt).
  let newName = `${original.provider_name} (copy)`;
  const { data: clash } = await supabase.from("api_providers").select("id").eq("provider_name", newName).maybeSingle();
  if (clash) newName = `${original.provider_name} (copy ${Date.now()})`;

  const { data, error } = await supabase
    .from("api_providers")
    .insert({
      provider_name: newName,
      api_url: original.api_url,
      encrypted_api_key: original.encrypted_api_key,
      status: "disabled", // duplicated providers start disabled — avoids accidentally double-serving traffic
    })
    .select("id, provider_name, api_url, status, created_at")
    .single();

  if (error) return res.status(500).json({ success: false, error: "Could not duplicate provider.", retryable: true });
  return res.status(200).json({ success: true, provider: data });
};
