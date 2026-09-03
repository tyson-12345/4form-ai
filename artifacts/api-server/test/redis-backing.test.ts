/**
 * That REDIS_URL can actually do something.
 *
 * `lib/redis.ts` reaches its driver through `require("ioredis")`, and until
 * 2026-09-02 `ioredis` appeared in no package.json in the workspace and had no
 * entry in pnpm-lock.yaml. So that call threw in every artifact ever built, the
 * module caught it, logged a warning and fell back to per-process buckets —
 * meaning setting REDIS_URL was a no-op and anyone running more than one
 * instance had every rate limit silently multiplied by the instance count,
 * including the one in front of the login endpoint.
 *
 * Nothing in the type system or the suite could see that, because the code path
 * was correct and the *dependency* was missing. These two assertions are the
 * cheapest thing that would have caught it, and they need no Redis server: one
 * checks the declaration, the other checks that the declaration resolves.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { dependencies?: Record<string, string> };

describe("the shared rate-limit backend", () => {
  it("declares ioredis as a real dependency", () => {
    // A dependency and not a devDependency: the production bundle require()s it.
    expect(packageJson.dependencies).toHaveProperty("ioredis");
  });

  it("resolves the driver lib/redis.ts require()s", () => {
    // The same call the module makes, from the same package. If this throws,
    // REDIS_URL is decorative again.
    expect(() => createRequire(import.meta.url)("ioredis")).not.toThrow();
  });

  it("exposes a constructor under one of the two shapes the loader accepts", () => {
    const mod = createRequire(import.meta.url)("ioredis") as
      | (new (url: string) => unknown)
      | { default?: new (url: string) => unknown };
    const Redis = (mod as { default?: unknown }).default ?? mod;
    expect(typeof Redis).toBe("function");
  });
});
