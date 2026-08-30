import { RequestHandler } from 'express';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyResolver?: (req: import('express').Request) => string;
}

type Bucket = { count: number; resetAt: number };

export const createRateLimiter = (options: RateLimiterOptions): RequestHandler => {
  const buckets = new Map<string, Bucket>();
  const windowMs = Math.max(options.windowMs, 1000);
  const max = Math.max(options.max, 1);
  const keyResolver =
    options.keyResolver ||
    ((req: import('express').Request) => req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown');

  // Periodically prune expired buckets to prevent memory leak
  const PRUNE_INTERVAL_MS = Math.max(windowMs * 10, 60_000);
  const pruneInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt < now) {
        buckets.delete(key);
      }
    }
  }, PRUNE_INTERVAL_MS);
  pruneInterval.unref(); // Don't keep process alive just for pruning

  return (req, res, next) => {
    const key = keyResolver(req);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (bucket.count >= max) {
      res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
      return;
    }

    bucket.count += 1;
    next();
  };
};
