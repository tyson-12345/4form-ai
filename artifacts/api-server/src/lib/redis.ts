/**
 * Optional Redis connection, used to share rate-limit counters between API
 * instances.
 *
 * ── Why the loading is indirect ─────────────────────────────────────────────
 * `ioredis` is loaded through `require` rather than a static import so that no
 * connection machinery is constructed on the single-instance path, which is
 * every deployment we have run so far. Not configuring REDIS_URL stays a
 * first-class, silent, supported choice.
 *
 * ── Not configured is fine; configured and broken is not ────────────────────
 * Until 2026-09-02 this module treated a *missing driver* as the same thing as
 * a missing URL: it logged a warning and fell back to per-process buckets. And
 * `ioredis` was in no package.json in the workspace and had no entry in
 * pnpm-lock.yaml, so the `require` below threw in every artifact that has ever
 * been built. Setting REDIS_URL did nothing at all. Anyone who set it and
 * scaled to three instances was running with every rate limit silently tripled,
 * including the one on the login endpoint, and the health check said
 * `sharedRateLimits: false` in a corner nobody reads.
 *
 * So the two cases are now separated, and only one of them degrades:
 *
 *  - REDIS_URL unset — per-instance limits, logged once at info. Correct.
 *  - REDIS_URL set and unusable — throw. Loading happens at module load, and
 *    this module is on the import path of `lib/rateLimit.ts`, so it is a boot
 *    failure and not a per-request surprise. That is the same call `lib/auth.ts`
 *    makes about a short JWT_SECRET: a security control that was asked for and
 *    cannot be provided is an outage, never a downgrade.
 *
 * ── Availability is reported, never assumed ─────────────────────────────────
 * `redisAvailable()` tells callers what backing they actually have. This
 * matters because the rate limiter's correct behaviour when Redis is missing
 * is *not* to skip the limit — see `lib/rateLimit.ts`. Oscar's fork fails open
 * here, which turns a Redis outage into an unlimited login endpoint.
 *
 * Adapted from `lib/redis.ts` in Oscar's fork.
 */

import { logger } from "./logger.js";

type RedisLike = {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  pttl(key: string): Promise<number>;
  quit(): Promise<unknown>;
};

let client: RedisLike | null = null;
/**
 * `misconfigured` is a terminal state and is deliberately not the same as
 * `unavailable`. Recording the failure and then answering null would put the
 * fail-open back in one call later, which is the whole bug this replaced.
 */
let state: "unloaded" | "ready" | "unavailable" | "misconfigured" = "unloaded";
let misconfiguration: Error | null = null;

type RedisConstructor = new (url: string, options?: object) => RedisLike;

/**
 * Load the driver.
 *
 * `mod.default ?? mod` because ioredis's CommonJS build has published both
 * shapes across its majors, and destructuring `{ default: Redis }` against the
 * one that has no `default` yields `undefined` and a `not a constructor` at the
 * `new` below — a boot crash whose message names neither Redis nor the version.
 */
function loadRedis(): RedisConstructor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("ioredis") as RedisConstructor & { default?: RedisConstructor };
  return mod.default ?? mod;
}

/**
 * Record why REDIS_URL cannot be honoured, and refuse. Terminal: every later
 * call re-throws the same error rather than answering "not available", which
 * would hand the caller a per-instance limiter it did not ask for.
 */
function refuse(message: string, cause: unknown): never {
  misconfiguration = new Error(message, { cause });
  state = "misconfigured";
  throw misconfiguration;
}

/**
 * Resolve the client.
 *
 * Returns null — and stays null — when REDIS_URL is unset. That is a normal
 * single-instance configuration, so the absence is logged once at info, not as
 * an error. When REDIS_URL *is* set, anything that stops us honouring it
 * throws; see the header.
 */
function getClient(): RedisLike | null {
  if (misconfiguration) throw misconfiguration;
  if (state !== "unloaded") return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    state = "unavailable";
    logger.info(
      { event: "redis_not_configured" },
      "REDIS_URL not set; rate limits are per-instance. Fine for one instance; " +
        "set REDIS_URL before scaling out.",
    );
    return null;
  }

  let Redis: RedisConstructor;
  try {
    Redis = loadRedis();
  } catch (err) {
    refuse(
      "REDIS_URL is set but the ioredis driver could not be loaded, so rate-limit " +
        "counters cannot be shared between instances. Refusing to start: falling back " +
        "to per-process buckets would multiply every limit — including the one in front " +
        "of the login endpoint — by the instance count, and say nothing. Run " +
        "`pnpm install` (ioredis is a dependency of @workspace/api-server), or unset " +
        "REDIS_URL to accept per-instance limits deliberately.",
      err,
    );
  }

  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      // Fail fast: a limiter that waits on a dead Redis is a latency incident.
      connectTimeout: 1_000,
      lazyConnect: false,
    });
  } catch (err) {
    // Rarely reached, and kept for the same reason as the branch above rather
    // than for a case we have seen: ioredis 5 accepts almost any string here
    // and reports a bad address in the background instead, which surfaces as a
    // thrown `incrementWindow` and is answered by failing the request closed.
    // What must not happen is that a constructor failure — a URL it does reject,
    // an option it does not like — quietly becomes per-instance limits.
    refuse(
      "REDIS_URL is set but ioredis would not accept it. Refusing to start rather " +
        "than falling back to per-instance rate limits. Check the value is a " +
        "`redis://` or `rediss://` URL.",
      err,
    );
  }

  state = "ready";
  logger.info({ event: "redis_connected" }, "Redis connected; rate limits are shared");
  return client;
}

/**
 * Resolve at module load, so a REDIS_URL that cannot be honoured kills the boot
 * instead of the first rate-limited request. `lib/rateLimit.ts` imports this
 * module, `app.ts` imports that, so this runs before anything is listening.
 */
getClient();

/** True when counters are shared across instances. */
export function redisAvailable(): boolean {
  return getClient() !== null;
}

/**
 * Increment a fixed-window counter and return the new count and remaining TTL.
 *
 * Throws on a Redis error rather than returning a sentinel — the caller must
 * decide the policy, and silently returning "0 requests so far" would be a
 * fail-open disguised as a value.
 */
export async function incrementWindow(
  key: string,
  windowMs: number,
): Promise<{ count: number; resetInMs: number }> {
  const redis = getClient();
  if (!redis) throw new Error("Redis unavailable");

  const count = await redis.incr(key);

  // Fixed-window: the key gets its TTL when first created. The condition is
  // `ttl < 0` rather than `count === 1` because those can disagree, and the
  // disagreement fails dangerous. If an earlier request incremented the key but
  // the process died before PEXPIRE landed — or the PEXPIRE itself errored — the
  // counter would live forever with no expiry, holding that key's window open
  // permanently and locking a legitimate IP out until someone deletes the key by
  // hand. Re-applying the TTL whenever it is missing self-heals that on the next
  // request. It does not slide the window under normal load: a key that already
  // has a TTL is left untouched. (pttl: -1 = key exists but has no expiry set,
  // -2 = key no longer exists.)
  let ttl = await redis.pttl(key);
  if (ttl < 0) {
    await redis.pexpire(key, windowMs);
    ttl = windowMs;
  }

  return { count, resetInMs: ttl > 0 ? ttl : windowMs };
}

/** Close the connection during shutdown. */
export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
    state = "unloaded";
  }
}

/** Test seam: force a known state without touching the environment. */
export function __setRedisClientForTests(mock: RedisLike | null): void {
  client = mock;
  state = mock ? "ready" : "unavailable";
  // Clear any recorded refusal too, or a test that ran after one would still
  // be answered with the throw rather than the client it just installed.
  misconfiguration = null;
}
