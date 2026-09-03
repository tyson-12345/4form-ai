/**
 * `notifyLockout` (src/lib/passwordAuth.ts) — the "your account is locked"
 * email is sent at most once per cooldown window, not once per failure.
 *
 * ── The regression this guards against ───────────────────────────────────────
 * `failedLoginAttempts` is never decayed, so once an account is past
 * `MAX_FAILED_ATTEMPTS` every *later* failure that reaches `registerFailure`
 * (i.e. any failure recorded after the previous lock has expired) again
 * satisfies `attempts >= MAX_FAILED_ATTEMPTS` and, before `lockoutNotifiedAt`
 * existed, sent another lockout email — a password-login DoS that doubled as
 * a way to keep pointing our mail provider at the victim's inbox. The fix
 * claims `users.lockout_notified_at` before sending, with a 12-hour cooldown
 * (`LOCKOUT_NOTICE_COOLDOWN_MS`), so repeated lock episodes inside that window
 * produce one email, not one per episode.
 *
 * ── Why the test manipulates `lockedUntil` directly between attempts ────────
 * Reproducing "many lock episodes" through real wall-clock time would mean
 * waiting out the real 15-minute lock (`LOCKOUT_MS`) between each one — this
 * test instead does what test/login-lockout.test.ts's own "clears an expired
 * lock automatically" test does: forces `lockedUntil` into the past directly
 * on the fake row before each attempt, standing in for "the previous lock has
 * already expired by the time this next failure arrives". That is exactly the
 * condition under which `attemptPasswordAuth` lets a failure reach
 * `registerFailure` again (`isLocked` is false), so it reliably reproduces the
 * "many lock-worthy failures in a row" scenario the fix targets, without
 * depending on real elapsed time anywhere in the test.
 *
 * The database fake mirrors test/account-deletion-lockout.test.ts and
 * test/lockout-counter-concurrency.test.ts; see the comment on `applyUpdate`
 * there for why it has to interpret the `sql` increment/CASE fragments rather
 * than copy them.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { MAX_FAILED_ATTEMPTS, LOCKOUT_MS } from "../src/lib/rateLimit.js";

// ─── In-memory database fake ─────────────────────────────────────────────────

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

const state = { users: [] as UserRow[] };
let currentEmail = "";

function chain(resolve: () => unknown[]) {
  const self: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "orderBy", "values", "execute"]) {
    self[method] = () => self;
  }
  self.then = (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  self.catch = (onRejected: (e: unknown) => unknown) => Promise.resolve(resolve()).catch(onRejected);
  return self;
}

function isRawSqlExpr(v: unknown): boolean {
  return typeof v === "object" && v !== null && !(v instanceof Date);
}

function applyUpdate(user: UserRow, values: Record<string, unknown>): void {
  const resolved: Record<string, unknown> = { ...values };

  let newAttempts = user.failedLoginAttempts;
  if (isRawSqlExpr(values.failedLoginAttempts)) {
    newAttempts = user.failedLoginAttempts + 1;
    resolved.failedLoginAttempts = newAttempts;
  }

  if (isRawSqlExpr(values.lockedUntil)) {
    resolved.lockedUntil =
      newAttempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : user.lockedUntil;
  }

  // `notifyLockout` claims the cooldown with a plain `new Date()` — a literal,
  // not a fragment — so it always falls through to a direct assignment here.
  Object.assign(user, resolved);
}

function project(user: UserRow, projection: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const userFields = user as unknown as Record<string, unknown>;
  // `projection`'s VALUES are the mocked column identifiers (see usersTableMock
  // below, which maps each field to itself) — e.g. { notifiedAt:
  // usersTable.lockoutNotifiedAt } is really { notifiedAt: "lockoutNotifiedAt" }
  // once the mock resolves. Reading `user[outKey]` instead of
  // `user[projection[outKey]]` would silently project every field to
  // `undefined` whenever the requested output name (`notifiedAt`, `attempts`)
  // differs from the stored field name (`lockoutNotifiedAt`,
  // `failedLoginAttempts`) — exactly the case `registerFailure`'s
  // `.returning({ attempts, lockedUntil, notifiedAt })` hits.
  for (const [outKey, field] of Object.entries(projection)) {
    row[outKey] = userFields[field as string];
  }
  return row;
}

const db = {
  select: () =>
    chain(() => {
      const user = state.users.find((u) => u.email === currentEmail);
      return user ? [user] : [];
    }),

  insert: () => chain(() => []),

  update: () => {
    let pendingSet: Record<string, unknown> | null = null;
    let pendingReturning: Record<string, unknown> | null = null;

    const self = chain(() => {
      const user = state.users.find((u) => u.email === currentEmail);
      if (!user) {
        pendingSet = null;
        pendingReturning = null;
        return [];
      }
      if (pendingSet) applyUpdate(user, pendingSet);
      pendingSet = null;
      const row = pendingReturning ? project(user, pendingReturning) : user;
      pendingReturning = null;
      return [row];
    });
    self.set = (values: Record<string, unknown>) => {
      pendingSet = values;
      return self;
    };
    self.returning = (projection?: Record<string, unknown>) => {
      pendingReturning = projection ?? null;
      return self;
    };
    return self;
  },

  delete: () => chain(() => []),
};

const usersTableMock = {
  id: "id",
  email: "email",
  passwordHash: "passwordHash",
  passwordAlgo: "passwordAlgo",
  failedLoginAttempts: "failedLoginAttempts",
  lockedUntil: "lockedUntil",
  lastFailedLoginAt: "lastFailedLoginAt",
  lockoutNotifiedAt: "lockoutNotifiedAt",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

vi.mock("@workspace/db", () => ({
  db,
  pool: { end: async () => {} },
  usersTable: usersTableMock,
  athleteProfilesTable: { userId: "user_id", name: "name" },
  subscriptionsTable: { userId: "user_id" },
  passwordResetTokensTable: {
    id: "id",
    tokenHash: "token_hash",
    userId: "user_id",
    expiresAt: "expires_at",
    usedAt: "used_at",
  },
  identitiesTable: { userId: "user_id", provider: "provider", subject: "subject" },
  analysesTable: {},
  chatMessagesTable: {},
  coachingTipsTable: {},
  injuryRisksTable: {},
  progressEntriesTable: {},
  achievementsTable: {},
  userAchievementsTable: {},
}));

const sentEmails: { to: string; subject: string }[] = [];
vi.mock("../src/lib/mailer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/mailer.js")>();
  return {
    ...actual,
    sendEmail: async (email: { to: string; subject: string }) => {
      sentEmails.push(email);
      return { delivered: true, provider: "resend" as const, attempts: 1 };
    },
  };
});

const { default: app } = await import("../src/app.js");
const { __resetRateLimitState } = await import("../src/lib/rateLimit.js");
const { drainMail } = await import("../src/lib/mailer.js");

const PASSWORD = "correct-horse-battery-staple";
const EMAIL = "athlete@example.com";

async function seedUser(): Promise<void> {
  state.users = [
    {
      id: "44444444-4444-4444-4444-444444444444",
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
}

function login(email: string, password: string) {
  currentEmail = email.trim().toLowerCase();
  return request(app).post("/api/auth/login").send({ email, password });
}

beforeEach(async () => {
  __resetRateLimitState();
  sentEmails.length = 0;
  await seedUser();
  currentEmail = EMAIL;
});

function lockoutEmails() {
  return sentEmails.filter((e) => /unusual sign-in/i.test(e.subject));
}

describe("lockout notice cooldown", () => {
  it(
    "sends exactly one lockout email across many failures past the threshold",
    { timeout: 60_000 },
    async () => {
      const FAILURES_PAST_THRESHOLD = 15;

      for (let i = 0; i < FAILURES_PAST_THRESHOLD; i++) {
        // Stand in for "any earlier lock has already expired" so every one of
        // these failures reaches `registerFailure` and re-satisfies
        // `attempts >= MAX_FAILED_ATTEMPTS` — the exact repeated-trigger
        // condition `notifyLockout`'s cooldown exists to absorb.
        state.users[0]!.lockedUntil = new Date(Date.now() - 1000);
        // This test is about the notice cooldown, not the login endpoint's own
        // 10/min-per-IP limiter — fifteen attempts would otherwise trip that
        // limiter partway through and 429 the rest, masking what's under test
        // (see test/login-lockout.test.ts's "blocks after 10 login attempts").
        // Clearing it before every attempt removes it from the picture.
        __resetRateLimitState();
        const res = await login(EMAIL, "wrong-password-here");
        expect(res.status).toBe(401);
      }

      expect(state.users[0]!.failedLoginAttempts).toBe(FAILURES_PAST_THRESHOLD);

      await drainMail();

      expect(lockoutEmails()).toHaveLength(1);
      expect(lockoutEmails()[0]!.to).toBe(EMAIL);
    },
  );

  it("claims lockout_notified_at on the account so a second process cannot also decide to send", async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await login(EMAIL, "wrong-password-here");
    }
    await drainMail();

    expect(state.users[0]!.lockoutNotifiedAt).toBeInstanceOf(Date);
    expect(lockoutEmails()).toHaveLength(1);
  });
});
