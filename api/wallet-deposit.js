const { getSupabaseAdmin } = require("../lib/supabase");
const { readSession } = require("../lib/keySession");
const { getLimiters, getClientIp } = require("../lib/ratelimit");

module.exports = async (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ success: false, error: "No active session." });

  if (req.method === "GET") {
    const upiId = process.env.UPI_ID;
    const upiName = process.env.UPI_NAME || "KM Panel";
    if (!upiId) return res.status(200).json({ success: false, error: "UPI ID not configured yet. Please check back soon." });
    return res.status(200).json({ success: true, upiId, upiName });
  }

  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });

  const { general } = getLimiters();
  const { success: notLimited } = await general.limit(getClientIp(req));
  if (!notLimited) return res.status(429).json({ success: false, error: "Too many attempts. Try again later." });

  const amount = Number(req.body && req.body.amount);
  const utr = req.body && req.body.utr;
  const screenshotBase64 = req.body && req.body.screenshotBase64; // optional, small data URL

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: "Invalid amount." });
  }
  if (!utr || typeof utr !== "string" || utr.trim().length < 4 || utr.length > 100) {
    return res.status(400).json({ success: false, error: "A valid UTR / transaction ID is required." });
  }

  const supabase = getSupabaseAdmin();

  let screenshotUrl = null;
  if (screenshotBase64 && typeof screenshotBase64 === "string" && screenshotBase64.startsWith("data:image/")) {
    try {
      const matches = screenshotBase64.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
      if (matches) {
        const ext = matches[1];
        const buffer = Buffer.from(matches[2], "base64");
        if (buffer.length <= 5 * 1024 * 1024) {
          // 5MB cap
          const path = `deposit-screenshots/${session.deviceId}-${Date.now()}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from("deposits")
            .upload(path, buffer, { contentType: `image/${ext}` });
          if (!uploadError) {
            const { data: pub } = supabase.storage.from("deposits").getPublicUrl(path);
            screenshotUrl = pub && pub.publicUrl;
          }
        }
      }
    } catch {
      // screenshot is optional — never fail the deposit submission over it
    }
  }

  const { data, error } = await supabase
    .from("wallet_transactions")
    .insert({
      device_id: session.deviceId,
      type: "deposit",
      amount,
      status: "pending",
      gateway: "manual_upi",
      gateway_reference: utr.trim(),
      screenshot_url: screenshotUrl,
      description: "Manual UPI deposit — pending verification",
    })
    .select("id")
    .single();

  if (error) {
    if (String(error.code) === "23505") {
      return res.status(409).json({ success: false, error: "This UTR has already been submitted." });
    }
    return res.status(500).json({ success: false, error: "Could not submit deposit.", retryable: true });
  }

  return res.status(200).json({ success: true, transactionId: data.id });
};
