const { Ratelimit } = require("@upstash/ratelimit");
const { Redis } = require("@upstash/redis");

let redis = null;
function getRedis() {
  if (redis) return redis;
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return redis;
}

let limiters = null;
function getLimiters() {
  if (limiters) return limiters;
  const r = getRedis();
  limiters = {
    general: new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      prefix: "ratelimit:general",
    }),
    validateKey: new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(5, "1 m"),
      prefix: "ratelimit:validate",
    }),
    adminLogin: new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(5, "10 m"),
      prefix: "ratelimit:admin_login",
    }),
    freeKey: new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(1, "1440 m"),
      prefix: "ratelimit:free_key",
    }),
  };
  return limiters;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
}

module.exports = { getLimiters, getClientIp };
