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

/**
 * The lockout policy, restated here rather than imported.
 *
 * The fake has to evaluate the same `CASE` the real UPDATE does (see
 * `applyUpdate`), and importing `lib/rateLimit.js` at module scope would pull a
 * chunk of the app in ahead of `vi.mock`. These are asserted against the real
 * behaviour by the tests below, so a drift in either direction fails loudly.
 */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  passwordAlgo: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastFailedLoginAt: Date | null;
  lockoutNotifiedAt: Date | null;
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

/**
 * Apply a `.set()` payload to a row, evaluating the SQL expressions the auth
 * path relies on.
 *
 * ── Why the fake has to understand these ────────────────────────────────────
 * `registerFailure` no longer computes the new failure count in JavaScript. It
 * did, from a value read *before* the ~250ms bcrypt comparison, which meant
 * every attempt inside that window read and wrote the same number and N
 * concurrent guesses advanced the counter by one — the "5 consecutive failures"
 * lockout admitted 5 x concurrency. The increment is now evaluated by the
 * database inside the UPDATE, and `locked_until` is decided in the same
 * statement from the post-increment value.
 *
 * A fake that stores drizzle's `SQL` object verbatim would record
 * `failedLoginAttempts = SQL{...}` and no lockout would ever trigger. Modelling
 * the two expressions is what makes this fake a fake of the current database
 * behaviour rather than of the previous code.
 */
function applyUpdate(user: UserRow, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!isSqlExpression(value)) {
      (user as Record<string, unknown>)[key] = value;
      continue;
    }

    if (key === "failedLoginAttempts") {
      // `failed_login_attempts + 1`
      user.failedLoginAttempts += 1;
    } else if (key === "lockedUntil") {
      // `CASE WHEN failed_login_attempts + 1 >= MAX THEN now() + interval … ELSE locked_until END`
      // Evaluated after the increment above, matching the statement's own
      // post-increment comparison.
      user.lockedUntil =
        user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_MS)
          : user.lockedUntil;
    } else {
      throw new Error(`login-lockout fake: unmodelled SQL expression for column "${key}"`);
    }
  }
}

/** Drizzle's `sql` template returns an `SQL` instance carrying `queryChunks`. */
function isSqlExpression(value: unknown): boolean {
  return typeof value === "object" && value !== null && "queryChunks" in value;
}

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
      if (user && pendingUpdate) applyUpdate(user, pendingUpdate);
      pendingUpdate = null;
      // `.returning()` callers read the post-update row — `registerFailure`
      // decides whether to lock from the value the database hands back, not
      // from the one it read before bcrypt. Returning it unconditionally is
      // harmless for the callers that ignore it.
      return user ? [user] : [];
    });
    self.set = (values: Record<string, unknown>) => {
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
  usersTable: {
    email: "email",
    id: "id",
    failedLoginAttempts: "failed_login_attempts",
    lockedUntil: "locked_until",
    lockoutNotifiedAt: "lockout_notified_at",
  },
  athleteProfilesTable: { userId: "user_id", name: "name" },
  subscriptionsTable: { userId: "user_id" },
  passwordResetTokensTable: { id: "id", tokenHash: "token_hash", userId: "user_id", expiresAt: "expires_at", usedAt: "used_at" },
  // Not exercised here, but app.ts mounts the federated sign-in router, so the
  // export has to exist or importing the app throws before any test runs.
  identitiesTable: { userId: "user_id", provider: "provider", subject: "subject" },
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
/** Simulated provider latency, so response timing can be asserted. */
let mailDelayMs = 0;
vi.mock("../src/lib/mailer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/mailer.js")>();
  return {
    ...actual,
    sendEmail: async (email: { to: string; subject: string }) => {
      if (mailDelayMs > 0) await new Promise((r) => setTimeout(r, mailDelayMs));
      sentEmails.push(email);
      return { delivered: true, provider: "resend" as const, attempts: 1 };
    },
  };
});

const { default: app } = await import("../src/app.js");
const { __resetRateLimitState } = await import("../src/lib/rateLimit.js");
// The lockout notice is dispatched *after* the response so that delivery time
// cannot be measured from outside (see lib/mailer.ts). That makes "the request
// finished" and "the mail was handed to the provider" two different moments, so
// these tests wait for the second one explicitly rather than relying on
// microtask ordering — which would pass locally and flake under load.
const { drainMail } = await import("../src/lib/mailer.js");

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
      lockoutNotifiedAt: null,
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
 *
 * 60s rather than 30s. The delay alone is 7.75s and the bcrypt work is CPU-
 * bound, so on a loaded machine this genuinely approaches 30s — observed
 * failing at 31.9s while an Xcode build was running, with nothing wrong in the
 * code. The alternative is mocking the delay, which would delete the assertion
 * that the delay exists at all.
 *
 * If this ever times out on an *idle* machine, that is a real signal: something
 * has made the login path meaningfully slower.
 */
const LOCKOUT_TEST_TIMEOUT = 60_000;

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
    await drainMail();

    const lockoutEmail = sentEmails.find((e) => /unusual sign-in/i.test(e.subject));
    expect(lockoutEmail).toBeDefined();
    expect(lockoutEmail!.to).toBe(EMAIL);
  });

  it("does not email before the threshold is reached", { timeout: LOCKOUT_TEST_TIMEOUT }, async () => {
    for (let i = 0; i < 4; i++) await login(EMAIL, "wrong-password-here");
    await drainMail();
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
    await timeOne();
    const third = await timeOne();

    /**
     * Compares the first failure with the *third*, not each with its neighbour.
     *
     * Nominal delays are 250ms, 500ms and 1000ms, so adjacent samples differ by
     * 250ms — and every one of them also carries a bcrypt comparison whose own
     * cost varies by more than that when the machine is busy. `second > first`
     * therefore failed with 1085 against 1122 on a loaded runner, which says
     * nothing about the delay and everything about scheduling noise.
     *
     * First to third is a 750ms nominal gap. A 400ms floor survives the jitter
     * and still fails outright if the escalation is removed, which is the only
     * regression worth catching here. The exact curve is pinned deterministically
     * by the unit tests on `failureDelayMs` in test/failure-delay.test.ts; this
     * one exists to prove it is actually wired into the request path.
     */
    expect(third - first).toBeGreaterThan(400);
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
    /**
     * 90s, not 30. Every one of these twelve attempts deliberately sleeps — the
     * per-origin failure delay escalates to its 1.5s cap — and each also runs a
     * real bcrypt. The wall-clock cost is the feature working, so a timeout
     * tuned to the old flat 250ms delay was measuring the wrong thing and
     * failing on a busy machine while the limiter it tests was fine.
     */
  }, 90_000);
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

  it("answers in the same time whether or not the address is registered", async () => {
    /**
     * The body is identical by design. This asserts the *other* half of that
     * promise, which is easy to lose without noticing: only the registered
     * branch does any work — mint a token, hand the message to the provider —
     * so awaiting that work makes a registered address reliably slower than an
     * unregistered one, and the response time answers the question the response
     * text refuses to.
     *
     * It was not observable while mail was unconfigured, because `sendEmail`
     * returned immediately. It would have appeared the day an API key was
     * pasted in, with no code change to attribute it to. The delivery is
     * dispatched after the response instead; this pins that down.
     *
     * The provider is stubbed to take 400ms — far longer than the real gap
     * would be — so a regression fails loudly rather than marginally.
     */
    mailDelayMs = 400;
    try {
      currentEmail = EMAIL;
      const startKnown = Date.now();
      await request(app).post("/api/auth/forgot-password").send({ email: EMAIL });
      const knownMs = Date.now() - startKnown;

      __resetRateLimitState();
      currentEmail = "nobody@example.com";
      const startUnknown = Date.now();
      await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: "nobody@example.com" });
      const unknownMs = Date.now() - startUnknown;

      /**
       * Both thresholds are derived from the stubbed provider delay rather than
       * being absolute wall-clock numbers.
       *
       * They used to be `< 200` and `< 150`. The claim being made is "the 400ms
       * send is not on the response path at all" — and a machine busy enough to
       * make an empty Express round trip take 344ms (which has happened here)
       * fails a 200ms floor while that claim is still perfectly true. That is a
       * test measuring the CI runner, not the code.
       *
       * Expressed against `mailDelayMs`, a response that awaited the send is
       * necessarily >= 400ms and fails; one that did not has to be pathologically
       * slow to reach 300ms; and the gap between the two branches has to grow to
       * half the send before it trips. The regression this exists to catch moves
       * these numbers by 400ms, not by 50.
       */
      expect(knownMs).toBeLessThan(mailDelayMs * 0.75);
      expect(Math.abs(knownMs - unknownMs)).toBeLessThan(mailDelayMs / 2);

      // And the mail really was sent, just afterwards — otherwise this would
      // also pass if the feature had simply been deleted.
      await drainMail();
      expect(sentEmails.some((e) => /reset your/i.test(e.subject))).toBe(true);
    } finally {
      mailDelayMs = 0;
    }
  });
});
