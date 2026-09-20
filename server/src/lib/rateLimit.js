// Small in-process rate limiter for the login and signup endpoints.
//
// In-memory on purpose: v1 runs as a single Express process on one VPS, so a
// shared store would be complexity with no benefit. If the API is ever run as
// more than one process, this needs to move to the database or Redis —
// otherwise each worker enforces its own separate allowance.
const buckets = new Map();

const SWEEP_EVERY_MS = 1000 * 60 * 5;
let lastSweep = Date.now();

function sweep(now) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * @returns {{allowed: boolean, retryAfterSec: number, remaining: number}}
 */
export function consume(key, { limit, windowMs }) {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0, remaining: limit - 1 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      remaining: 0,
    };
  }
  return { allowed: true, retryAfterSec: 0, remaining: limit - bucket.count };
}

export function reset(key) {
  buckets.delete(key);
}

// Express middleware factory. `keyFn` decides what is being limited.
export function rateLimit({ limit, windowMs, keyFn, message }) {
  return (req, res, next) => {
    const result = consume(keyFn(req), { limit, windowMs });
    if (result.allowed) return next();
    res.set('Retry-After', String(result.retryAfterSec));
    res.status(429).json({
      error: 'rate_limited',
      message: message ?? `Too many attempts. Try again in ${result.retryAfterSec}s.`,
    });
  };
}

export function clientIp(req) {
  // No proxy trust is configured, so req.ip is the direct peer. Behind the
  // planned nginx reverse proxy this needs `app.set('trust proxy', 1)` or
  // every request will look like it came from 127.0.0.1.
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
