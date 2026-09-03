/**
 * `failureDelayMs` — the per-IP progressive delay used by every branch of
 * `attemptPasswordAuth` (unknown email, wrong password, locked account).
 *
 * ── The regression this guards against ───────────────────────────────────────
 * The delay used to be `progressiveDelayMs(user.failedLoginAttempts)` for a
 * real account but a flat `progressiveDelayMs(1)` for an unknown address, so
 * two probes told a registered address from an unregistered one by wall clock
 * (500ms vs 250ms) even though the JSON body was byte-identical
 * (`INVALID_CREDENTIALS` either way). `failureDelayMs(ip)` closes that: it is a
 * pure function of the requesting IP and how many times *that IP* has failed
 * recently, and nothing else — in particular, not of whether the account it
 * was guessing against exists.
 *
 * These are unit tests on the function directly, not wall-clock assertions
 * against the running server. `test/login-lockout.test.ts` already has three
 * timing assertions that flake under CPU load (see its own comments); this
 * file exists specifically so the *shape* of the delay schedule is covered
 * without depending on real elapsed time at all.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { failureDelayMs, __resetRateLimitState } from "../src/lib/rateLimit.js";

beforeEach(() => {
  __resetRateLimitState();
});

describe("failureDelayMs", () => {
  it("returns the same delay for the Nth failure regardless of which branch produced it", () => {
    // Simulates the two call sites that used to disagree: a failed login
    // against a real account, and a failed login against an address that does
    // not exist. Both now call this function with nothing but the requesting
    // IP — there is no "account exists" input to diverge on — so the same
    // failure count on two different IPs must produce the same schedule.
    const knownAccountIp = "203.0.113.10"; // stands in for the "real account" branch
    const unknownAccountIp = "203.0.113.20"; // stands in for the "no such account" branch

    const fromKnownAccountBranch: number[] = [];
    for (let i = 0; i < 8; i++) fromKnownAccountBranch.push(failureDelayMs(knownAccountIp));

    const fromUnknownAccountBranch: number[] = [];
    for (let i = 0; i < 8; i++) fromUnknownAccountBranch.push(failureDelayMs(unknownAccountIp));

    expect(fromUnknownAccountBranch).toEqual(fromKnownAccountBranch);
  });

  it("tracks the failure count per IP independently", () => {
    // Two IPs failing for the first time must see the same "first failure"
    // delay — neither has any history yet.
    const ipA = "198.51.100.1";
    const ipB = "198.51.100.2";

    expect(failureDelayMs(ipA)).toBe(failureDelayMs(ipB)); // both IPs' 1st failure

    // Fail IP A three more times. IP B must not move at all — its next call
    // is still only its *second* failure, and must match what IP A's second
    // failure was, not whatever IP A has escalated to by now.
    const ipASecond = failureDelayMs(ipA); // IP A's 2nd
    failureDelayMs(ipA); // IP A's 3rd
    failureDelayMs(ipA); // IP A's 4th

    const ipBSecond = failureDelayMs(ipB); // IP B's 2nd — untouched by IP A's run
    expect(ipBSecond).toBe(ipASecond);
  });

  it("escalates with repeated failures from the same IP, then plateaus rather than growing without bound", () => {
    const ip = "198.51.100.50";
    const delays = Array.from({ length: 10 }, () => failureDelayMs(ip));

    // Monotonically non-decreasing — a later failure is never punished less
    // than an earlier one.
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]!);
    }
    // It genuinely escalates at the start...
    expect(delays[1]).toBeGreaterThan(delays[0]!);
    // ...and is bounded — the whole point of a cap is that it stops growing,
    // so the tail of a long run must be flat.
    expect(delays[9]).toBe(delays[8]);
  });

  it("__resetRateLimitState clears accumulated per-IP failure state", () => {
    const ip = "198.51.100.99";
    const firstEver = failureDelayMs(ip);
    failureDelayMs(ip);
    failureDelayMs(ip);
    const thirdFailure = failureDelayMs(ip);
    expect(thirdFailure).not.toBe(firstEver); // escalated by the third failure

    __resetRateLimitState();

    // A fresh failure after the reset must be treated as the first one again,
    // not the fifth — proving the counter was actually dropped, not merely
    // paused.
    const firstAfterReset = failureDelayMs(ip);
    expect(firstAfterReset).toBe(firstEver);
  });
});
