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
import { requestIdentity } from "./requestIdentity.js";

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
  /**
   * What the bucket is keyed on.
   *
   * ── Why "account" exists ────────────────────────────────────────────────
   * Every limiter used to key on the client IP, which is right for the
   * credential endpoints — there is no account yet, and the network origin is
   * the only thing to ration. It is wrong for authenticated ones. A gym's wifi,
   * an office, or carrier-grade NAT puts hundreds of athletes behind one
   * address, so one heavy user throttles strangers, and the limit an individual
   * actually gets depends on who else happens to share their carrier.
   *
   * It is also the weaker control where an account exists: an attacker with a
   * session token can rotate IPs, and cannot rotate the account they are
   * authenticated as.
   *
   * `"account"` keys on the authenticated user when the request carries a valid
   * token and falls back to the IP when it does not — so an unauthenticated
   * caller is still rationed, and a signed-in one is rationed as themselves.
   */
  keyBy?: "ip" | "account";
  /**
   * How to answer a refused request, when JSON is the wrong answer.
   *
   * The default is `429 {"error":"Too many requests…"}`, which is right for the
   * API and wrong for a form on a web page: a browser without scripting is
   * *navigating*, so it renders that JSON as the page. A mount that a person can
   * reach directly passes a handler here and sends them somewhere they can read.
   *
   * The rate-limit headers are already set when this runs; the handler owns the
   * status and the body.
   */
  onLimited?: (req: Request, res: Response) => void;
}

/**
 * The identity this request is rationed against.
 *
 * The `user:` / `ip:` prefix is not decoration — without it an account whose id
 * happened to equal an IP string would share a bucket with it, and more
 * practically it makes a limiter's state readable when debugging which of the
 * two a request was charged to.
 */
function bucketKey(req: Request, keyBy: "ip" | "account"): string {
  if (keyBy === "account") {
    const identity = requestIdentity(req);
    if (identity) return `user:${identity.userId}`;
  }
  return `ip:${clientIp(req)}`;
}

/** Reject a request that exceeded its window. */
function reject(
  req: Request,
  res: Response,
  name: string,
  max: number,
  resetInMs: number,
  onLimited?: (req: Request, res: Response) => void,
): void {
  const retryAfterSec = Math.max(1, Math.ceil(resetInMs / 1000));
  res.setHeader("Retry-After", retryAfterSec);
  res.setHeader("RateLimit-Limit", max);
  res.setHeader("RateLimit-Remaining", 0);
  logger.warn({ limiter: name, ip: clientIp(req), path: req.path }, "Rate limit exceeded");
  if (onLimited) {
    onLimited(req, res);
    return;
  }
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
export function rateLimit({
  max,
  windowMs = 60_000,
  name,
  keyBy = "ip",
  onLimited,
}: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${name}:${bucketKey(req, keyBy)}`;

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
        reject(req, res, name, max, bucket.resetAt - now, onLimited);
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
          reject(req, res, name, max, resetInMs, onLimited);
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
          "Rate limit backend unavailable; failing closed",
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

// ─── Per-origin failure delay ────────────────────────────────────────────────

/**
 * Recent failed credential attempts per client IP, for the progressive delay.
 *
 * ── Why this is keyed on the IP and not the account ─────────────────────────
 * The delay used to be `progressiveDelayMs(user.failedLoginAttempts)`, read
 * from the row. That made the wait a direct function of a *per-account* value,
 * and the "no such account" branch had no row to read, so it slept a flat
 * `progressiveDelayMs(1)` = 250ms forever.
 *
 * Two probes were therefore enough to tell a registered address from an
 * unregistered one: guess twice, and a real account answers in 500ms while a
 * non-existent one still answers in 250. By the fourth probe the margin is
 * 4000ms against 250ms. Every byte of the response was identical and the
 * enumeration worked anyway — the wall clock said what `INVALID_CREDENTIALS`
 * refused to.
 *
 * Keyed on the requesting IP the escalation is identical on both branches,
 * because it no longer depends on anything the attacker is trying to learn. It
 * costs nothing in protection: this control was only ever slowing down one
 * origin guessing quickly, and *that* is exactly what the IP counter measures.
 * The per-account control is the lockout, which is unaffected and still counts
 * consecutive failures against the row.
 */
const failureCounts = new Map<string, Bucket>();

/** How long an IP's failure count persists with no further failures. */
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Ceiling on the per-failure sleep. Lower than `progressiveDelayMs`'s 4s cap,
 * deliberately.
 *
 * ── Why this cap is not the same as the account one ─────────────────────────
 * The sleep happens inside the request, so it holds a connection for its whole
 * duration. That was affordable while only *registered* accounts escalated: an
 * attacker sweeping addresses paid a flat 250ms per probe, because the "no such
 * account" branch had no row to escalate from. Making both branches escalate is
 * what closes the enumeration oracle — and it also means an attacker sweeping
 * unknown addresses can now pin a connection for the full cap on every request,
 * for free. At a 4s cap that is a better denial-of-service amplifier than the
 * guessing it exists to slow.
 *
 * The volumetric control here is the rate limiter, which refuses at 10/min
 * *without* running the handler or holding anything. The sleep only has to be
 * uniform across branches to do its job; it does not have to be long. 1.5s
 * still costs a serious guessing campaign orders of magnitude, and bounds the
 * worst case an anonymous caller can impose on us to roughly 12s of held
 * connection per minute per IP rather than 28s.
 */
const MAX_FAILURE_DELAY_MS = 1500;

const failureSweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of failureCounts) {
    if (now > bucket.resetAt) failureCounts.delete(key);
  }
}, 60_000);
failureSweeper.unref?.();

/**
 * Record one failed credential attempt from `ip` and return how long to wait.
 *
 * Call once per failure, on every branch — including the branches where no
 * account exists — so the two are indistinguishable.
 */
export function failureDelayMs(ip: string): number {
  const now = Date.now();
  const bucket = failureCounts.get(ip);

  if (!bucket || now > bucket.resetAt) {
    failureCounts.set(ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
    return Math.min(progressiveDelayMs(1), MAX_FAILURE_DELAY_MS);
  }

  bucket.count++;
  // Slide the window: an origin that keeps failing keeps its escalation.
  bucket.resetAt = now + FAILURE_WINDOW_MS;
  return Math.min(progressiveDelayMs(bucket.count), MAX_FAILURE_DELAY_MS);
}

/** Test seam: drop all rate-limit state between test cases. */
export function __resetRateLimitState(): void {
  buckets.clear();
  failureCounts.clear();
}
