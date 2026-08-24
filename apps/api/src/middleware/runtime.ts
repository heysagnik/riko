import type { NextFunction, Request, Response } from "express";
import { SlidingWindowLimiter } from "@riko/worker/rate-limiter";
import { log, type LogFields } from "@riko/worker/logger";

const WINDOW_MS = 60_000;
const BUCKET_TTL_MS = 15 * 60_000;

export function ipRateLimiter(limitPerMinute: number) {
  const buckets = new Map<string, { limiter: SlidingWindowLimiter; lastSeen: number }>();

  setInterval(() => {
    const cutoff = Date.now() - BUCKET_TTL_MS;
    for (const [ip, entry] of buckets) {
      if (entry.lastSeen < cutoff) buckets.delete(ip);
    }
  }, BUCKET_TTL_MS).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? "unknown";
    let entry = buckets.get(ip);
    if (!entry) {
      entry = { limiter: new SlidingWindowLimiter(limitPerMinute, WINDOW_MS), lastSeen: Date.now() };
      buckets.set(ip, entry);
    }
    entry.lastSeen = Date.now();

    if (!entry.limiter.tryAcquire()) {
      log.warn("rate_limited", { ip: req.ip, path: req.path });
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  };
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/health") {
    next();
    return;
  }

  const start = performance.now();
  res.on("finish", () => {
    const fields: LogFields = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(performance.now() - start),
    };
    if (res.statusCode >= 500) log.error("http_request", fields);
    else log.info("http_request", fields);
  });
  next();
}
