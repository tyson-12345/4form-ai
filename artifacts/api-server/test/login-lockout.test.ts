/**
 * Login endpoint behaviour: response uniformity and account lockout.
 *
 * The database is replaced with an in-memory fake so these run without a live
 * Postgres. The fake mimics Drizzle's chainable, thenable query builder closely
 * enough for the auth route's query shapes, and holds real row objects — so
 * lockout state genuinely accumulates across requests rather than being scripted.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";

// ─── In-memory database fake ─────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  passwordAlgo: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastFailedLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const state = {
  users: [] as UserRow[],
  profiles: [] as { userId: string; name: string }[],
  resetTokens: [] as { id: string; userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }[],
  /** Which table the current chain targets, so `where` can filter correctly. */
};

/**
 * A chain object that is both chainable and awaitable, matching how Drizzle's
 * builders behave. `resolve` supplies the rows the chain settles to.
 */
function chain(resolve: () => unknown[]) {
  const self: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "orderBy", "values", "set", "returning", "execute"]) {
    self[method] = () => self;
  }
  self.then = (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  self.catch = (onRejected: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).catch(onRejected);
  return self;
}

/**
 * The fake reads the *email* out of the login body via a module-level hook
 * rather than interpreting Drizzle's predicate objects, which are opaque.
 * `currentEmail` is set by the test before each request.
 */
let currentEmail = "";
/** Captures the values passed to the most recent `.set()` so we can apply them. */
let pendingUpdate: Partial<UserRow> | null = null;

const db = {
  select: (_projection?: unknown) =>
    chain(() => {
      // Both the user lookup and the profile lookup key off the same user.
      const user = state.users.find((u) => u.email === currentEmail);
      if (!user) return [];
      // Distinguish by whether a projection was requested (profile name query).
      if (_projection && typeof _projection === "object" && "name" in _projection) {
        const profile = state.profiles.find((p) => p.userId === user.id);
        return profile ? [profile] : [];
      }
      return [user];
    }),

  insert: () => chain(() => []),

  update: () => {
    const self = chain(() => {
      const user = state.users.find((u) => u.email === currentEmail);
      if (user && pendingUpdate) Object.assign(user, pendingUpdate);
      pendingUpdate = null;
      return [];
    });
    self.set = (values: Partial<UserRow>) => {
      pendingUpdate = values;
      return self;
    };
    return self;
  },

  delete: () => chain(() => []),
};

vi.mock("@workspace/db", () => ({
  db,
  pool: { end: async () => {} },
  usersTable: { email: "email", id: "id" },
  athleteProfilesTable: { userId: "user_id", name: "name" },
  subscriptionsTable: { userId: "user_id" },
  passwordResetTokensTable: { id: "id", tokenHash: "token_hash", userId: "user_id", expiresAt: "expires_at", usedAt: "used_at" },
  analysesTable: {},
  chatMessagesTable: {},
  coachingTipsTable: {},
  injuryRisksTable: {},
  progressEntriesTable: {},
  achievementsTable: {},
  userAchievementsTable: {},
}));

// Emails are dispatched in-process; assert on the fake rather than the network.
const sentEmails: { to: string; subject: string }[] = [];
vi.mock("../src/lib/mailer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/mailer.js")>();
  return {
    ...actual,
    sendEmail: async (email: { to: string; subject: string }) => {
      sentEmails.push(email);
    },
  };
});

const { default: app } = await import("../src/app.js");
const { __resetRateLimitState } = await import("../src/lib/rateLimit.js");

const PASSWORD = "correct-horse-battery-staple";
const EMAIL = "athlete@example.com";

async function seedUser(): Promise<void> {
  state.users = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      email: EMAIL,
      passwordHash: await bcrypt.hash(PASSWORD, 12),
      passwordAlgo: "bcrypt",
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastFailedLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  state.profiles = [{ userId: state.users[0]!.id, name: "Test Athlete" }];
}

function login(email: string, password: string) {
  currentEmail = email.trim().toLowerCase();
  return request(app).post("/api/auth/login").send({ email, password });
}

beforeEach(async () => {
  __resetRateLimitState();
  sentEmails.length = 0;
  await seedUser();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/auth/login — response uniformity", () => {
  it("signs in with the correct password", async () => {
    const res = await login(EMAIL, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(EMAIL);
  });

  it("never returns the password hash", async () => {
    const res = await login(EMAIL, PASSWORD);
    expect(JSON.stringify(res.body)).not.toContain("$2");
  });

  it("returns the exact agreed message for a wrong password", async () => {
    const res = await login(EMAIL, "wrong-password-here");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Incorrect email or password" });
  });

  it("returns the identical message for an unknown email", async () => {
    // Any difference here — status, body, or wording — enumerates accounts.
    const wrongPassword = await login(EMAIL, "wrong-password-here");
    const unknownEmail = await login("nobody@example.com", PASSWORD);

    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it("returns the identical message for a malformed body", async () => {
    currentEmail = "";
    const res = await request(app).post("/api/auth/login").send({ email: "x", password: "" });
    expect(res.status).toBe(400);
    // A 400 here is unavoidable (the body isn't a login attempt at all), but it
    // must not name the offending field.
    expect(JSON.stringify(res.body)).not.toMatch(/email|password/i);
  });
});

/**
 * Reaching the lockout takes real wall-clock time: five bcrypt comparisons at
 * cost 12 plus the progressive delay (250 + 500 + 1000 + 2000 + 4000 ms). That
 * cost is the point — an online guessing attack pays it too — so these tests
 * get a generous timeout rather than the delay being mocked away.
 */
const LOCKOUT_TEST_TIMEOUT = 30_000;

describe("account lockout", () => {
  it("locks the account after 5 consecutive failures", { timeout: LOCKOUT_TEST_TIMEOUT }, async () => {
    for (let i = 0; i < 5; i++) await login(EMAIL, "wrong-password-here");

    expect(state.users[0]!.failedLoginAttempts).toBe(5);
    expect(state.users[0]!.lockedUntil).toBeInstanceOf(Date);
    expect(state.users[0]!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("locks for 15 minutes", { timeout: LOCKOUT_TEST_TIMEOUT }, async () => {
    for (let i = 0; i < 5; i++) await login(EMAIL, "wrong-password-here");

    const remainingMs = state.users[0]!.lockedUntil!.getTime() - Date.now();
    expect(remainingMs).toBeGreaterThan(14 * 60 * 1000);
    expect(remainingMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("rejects the correct password while locked", { timeout: LOCKOUT_TEST_TIMEOUT }, async () => {
    for (let i = 0; i < 5; i++) await login(EMAIL, "wrong-password-here");

    const res = await login(EMAIL, PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it("does not reveal that the account is locked", { timeout: LOCKOUT_TEST_TIMEOUT }, async () => {
    for (let i = 0; i < 5; i++) await login(EMAIL, "wrong-password-here");

    const locked = await login(EMAIL, PASSWORD);
    expect(locked.body).toEqual({ error: "Incorrect email or password" });
    expect(JSON.stringify(locked.body)).not.toMatch(/lock|attempt|wait|too many/i);
  });

  it("emails the account owner a reset link when the lockout triggers", { timeout: LOCKOUT_TEST_TIMEOUT }, async () => {
    for (let i = 0; i < 5; i++) await login(EMAIL, "wrong-password-here");

    const lockoutEmail = sentEmails.find((e) => /unusual sign-in/i.test(e.subject));
    expect(lockoutEmail).toBeDefined();
    expect(lockoutEmail!.to).toBe(EMAIL);
  });

  it("does not email before the threshold is reached", { timeout: LOCKOUT_TEST_TIMEOUT }, async () => {
    for (let i = 0; i < 4; i++) await login(EMAIL, "wrong-password-here");
    expect(sentEmails).toHaveLength(0);
  });

  it("resets the counter on a successful sign-in", { timeout: LOCKOUT_TEST_TIMEOUT }, async () => {
    for (let i = 0; i < 3; i++) await login(EMAIL, "wrong-password-here");
    expect(state.users[0]!.failedLoginAttempts).toBe(3);

    await login(EMAIL, PASSWORD);
    expect(state.users[0]!.failedLoginAttempts).toBe(0);
    expect(state.users[0]!.lockedUntil).toBeNull();
  });

  it("clears an expired lock automatically", async () => {
    state.users[0]!.lockedUntil = new Date(Date.now() - 1000);
    state.users[0]!.failedLoginAttempts = 5;

    const res = await login(EMAIL, PASSWORD);
    expect(res.status).toBe(200);
  });
});

describe("progressive delay", () => {
  it("slows each successive failure", async () => {
    const timeOne = async () => {
      const start = Date.now();
      await login(EMAIL, "wrong-password-here");
      return Date.now() - start;
    };

    const first = await timeOne();
    const second = await timeOne();
    const third = await timeOne();

    // 250ms, 500ms, 1000ms nominal — assert the trend, not exact timings.
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("does not delay a successful sign-in", async () => {
    const start = Date.now();
    await login(EMAIL, PASSWORD);
    // Only bcrypt's own cost, no punitive sleep on top.
    expect(Date.now() - start).toBeLessThan(1500);
  });
});

describe("rate limiting", () => {
  it("blocks after 10 login attempts from one IP in a minute", async () => {
    // Independent of lockout: this caps volume per network origin.
    let sawRateLimit = false;
    for (let i = 0; i < 12; i++) {
      const res = await login(`user${i}@example.com`, "some-password");
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
    }
    expect(sawRateLimit).toBe(true);
  }, 30000);
});

describe("POST /api/auth/forgot-password", () => {
  it("returns the agreed message for a registered email", async () => {
    currentEmail = EMAIL;
    const res = await request(app).post("/api/auth/forgot-password").send({ email: EMAIL });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("If that email is registered, you will receive a reset link.");
  });

  it("returns the identical message for an unregistered email", async () => {
    currentEmail = EMAIL;
    const known = await request(app).post("/api/auth/forgot-password").send({ email: EMAIL });

    __resetRateLimitState();
    currentEmail = "nobody@example.com";
    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@example.com" });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });
});
