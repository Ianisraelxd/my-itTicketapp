// A small in-memory rate limiter (per client address). It slows down password guessing across many
// accounts and sign-up floods; the per-account lockout still protects a single account.
// For several API processes behind a load balancer use a shared store (for example Redis) instead.
export function rateLimit({ windowMs = 60000, max = 60, message = "Too many attempts. Please wait a minute and try again.", key: keyOf = (req) => req.ip } = {}) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs);
  timer.unref?.();

  return (req, res, next) => {
    const key = String(keyOf(req) ?? "unknown");
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.set("RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
