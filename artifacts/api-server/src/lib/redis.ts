/**
 * Optional Redis connection, used to share rate-limit counters between API
 * instances.
 *
 * ── Why the loading is indirect ─────────────────────────────────────────────
 * `ioredis` is an optional dependency. A static import would make the whole
 * server fail to boot when it isn't installed, which is the wrong trade for a
 * feature that is only needed once we run more than one instance. It is
 * therefore resolved at first use and the module degrades to "unavailable"
 * when absent or unconfigured.
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
let state: "unloaded" | "ready" | "unavailable" = "unloaded";

/**
 * Resolve the client on first use.
 *
 * Returns null — and stays null — when REDIS_URL is unset or ioredis is not
 * installed. Both are normal single-instance configurations, so the absence is
 * logged once at info, not as an error.
 */
function getClient(): RedisLike | null {
  if (state !== "unloaded") return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    state = "unavailable";
    logger.info(
      { event: "redis_not_configured" },
      "REDIS_URL not set — rate limits are per-instance. Fine for one instance; " +
        "set REDIS_URL before scaling out.",
    );
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: Redis } = require("ioredis") as { default: new (u: string, o?: object) => RedisLike };
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      // Fail fast: a limiter that waits on a dead Redis is a latency incident.
      connectTimeout: 1_000,
      lazyConnect: false,
    });
    state = "ready";
    logger.info({ event: "redis_connected" }, "Redis connected — rate limits are shared");
    return client;
  } catch (err) {
    state = "unavailable";
    logger.warn(
      { err, event: "redis_unavailable" },
      "REDIS_URL is set but ioredis could not be loaded — falling back to in-memory limits",
    );
    return null;
  }
}

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
  if (count === 1) await redis.pexpire(key, windowMs);

  const ttl = await redis.pttl(key);
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
}
