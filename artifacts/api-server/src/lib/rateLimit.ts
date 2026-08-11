/**
 * Request rate limiting (per IP) and account lockout (per user).
 *
 * Two independent controls with different jobs:
 *
 *  - `rateLimit()` throttles requests from one network origin. It stops
 *    volumetric abuse — someone hammering an endpoint, or burning our Claude
 *    budget — but it cannot stop a distributed attack on one account.
 *
 *  - `recordFailedLogin()` / `isLocked()` (in routes/auth.ts, backed by the
 *    users table) lock a *single account* after repeated failures, regardless
 *    of how many IPs the attempts come from.
 *
 * State here is per-process and in memory. That is correct for a single API
 * instance; if this is ever scaled horizontally, move the buckets to Redis or
 * the failed-attempt counters alone will still hold (they are in Postgres).
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger.js";
import { redisAvailable, incrementWindow } from "./redis.js";
import { recordAlert } from "./alerting.js";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Resolve the client IP.
 *
 * `X-Forwarded-For` is attacker-controlled unless a proxy we trust rewrites it,
 * so it is only consulted when TRUST_PROXY is explicitly enabled. Reading it
 * unconditionally (the previous behaviour) let anyone bypass every rate limit
 * by sending a random value in that header on each request.
 *
 * Express is configured with `app.set("trust proxy", ...)` to match, so `req.ip`
 * already reflects this policy — we use it directly.
 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/** Purge expired buckets so the map cannot grow without bound. */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, 60_000);
// Don't hold the event loop open in tests or during shutdown.
sweeper.unref?.();

export interface RateLimitOptions {
  /** Maximum requests allowed inside the window. */
  max: number;
  /** Window length in milliseconds. Defaults to one minute. */
  windowMs?: number;
  /** Label used to namespace the bucket so limits don't share counters. */
  name: string;
}

/** Reject a request that exceeded its window. */
function reject(
  req: Request,
  res: Response,
  name: string,
  max: number,
  resetInMs: number,
): void {
  const retryAfterSec = Math.max(1, Math.ceil(resetInMs / 1000));
  res.setHeader("Retry-After", retryAfterSec);
  res.setHeader("RateLimit-Limit", max);
  res.setHeader("RateLimit-Remaining", 0);
  logger.warn({ limiter: name, ip: clientIp(req), path: req.path }, "Rate limit exceeded");
  res.status(429).json({ error: "Too many requests. Please slow down." });
}

/**
 * Fixed-window rate limiter.
 *
 * Emits `Retry-After` and `RateLimit-*` headers so clients can back off
 * intelligently rather than retrying blindly.
 *
 * ── Backing store ───────────────────────────────────────────────────────────
 * Counters live in Redis when REDIS_URL is configured, so limits hold across
 * instances; otherwise they are per-process, which is correct for a single
 * instance. The in-memory path stays fully synchronous — `redisAvailable()` is
 * a sync check, so the common configuration adds no latency and no microtask.
 *
 * ── Failure policy: closed ──────────────────────────────────────────────────
 * If Redis was configured but the call fails, the request is **rejected**, not
 * waved through. A rate limiter that fails open converts a cache outage into an
 * unlimited credential-stuffing window on the login endpoint — which is exactly
 * when you least want the limiter gone. Oscar's fork returns `true` (allow) on
 * a Redis error; that is the one part of his design not adopted here.
 */
export function rateLimit({ max, windowMs = 60_000, name }: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${name}:${clientIp(req)}`;

    if (!redisAvailable()) {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || now > bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        res.setHeader("RateLimit-Limit", max);
        res.setHeader("RateLimit-Remaining", max - 1);
        next();
        return;
      }

      bucket.count++;

      if (bucket.count > max) {
        reject(req, res, name, max, bucket.resetAt - now);
        return;
      }

      res.setHeader("RateLimit-Limit", max);
      res.setHeader("RateLimit-Remaining", Math.max(0, max - bucket.count));
      next();
      return;
    }

    incrementWindow(`rl:${key}`, windowMs)
      .then(({ count, resetInMs }) => {
        if (count > max) {
          reject(req, res, name, max, resetInMs);
          return;
        }
        res.setHeader("RateLimit-Limit", max);
        res.setHeader("RateLimit-Remaining", Math.max(0, max - count));
        next();
      })
      .catch((err: unknown) => {
        recordAlert("rate_limit_backend_failed");
        logger.error(
          { err, limiter: name, path: req.path, event: "rate_limit_backend_failed" },
          "Rate limit backend unavailable — failing closed",
        );
        res.setHeader("Retry-After", 5);
        res.status(503).json({
          error: "Service temporarily unavailable. Please try again in a moment.",
        });
      });
  };
}

// ─── Account lockout policy ──────────────────────────────────────────────────

/** Consecutive failures that trigger a lockout. */
export const MAX_FAILED_ATTEMPTS = 5;

/** How long an account stays locked once the threshold is hit. */
export const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Progressive delay applied after each failed login.
 *
 * Doubling from 250ms caps at ~4s so a human who genuinely mistyped is barely
 * inconvenienced, while an online guessing attack is slowed by orders of
 * magnitude before the lockout at attempt 5 even applies.
 *
 * The delay is applied to failures only — a correct password always returns at
 * full speed, so this cannot be used as an oracle.
 */
export function progressiveDelayMs(failedAttempts: number): number {
  if (failedAttempts <= 0) return 0;
  return Math.min(250 * 2 ** (failedAttempts - 1), 4000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Test seam: drop all rate-limit state between test cases. */
export function __resetRateLimitState(): void {
  buckets.clear();
}
