/**
 * DELETE /api/profile/account — re-authentication is a throttled,
 * lockout-aware credential check, not a bare password comparison.
 *
 * ── The regression this guards against ───────────────────────────────────────
 * This endpoint used to call `verifyPassword` directly: no lockout counter, no
 * progressive delay, no timing equalisation. It is reachable with nothing but
 * a session token — exactly what an attacker holding a stolen phone or a
 * leaked JWT has — so it was an unthrottled password oracle sitting beside a
 * login route that was carefully all three. It now goes through the same
 * `attemptPasswordAuth` the login route uses, and has its own rate-limit
 * budget in app.ts (`account-delete`, max 5/min) tighter than the 120/min
 * catch-all every other authenticated route falls back to.
 *
 * The database is replaced with an in-memory fake, following the pattern in
 * test/login-lockout.test.ts: chainable, thenable stand-ins for Drizzle's
 * query builder, holding real row objects so lockout state genuinely
 * accumulates across requests.
 *
 * ── Why `update()` has to understand the SQL fragments it's handed ──────────
 * `registerFailure` (src/lib/passwordAuth.ts) increments `failedLoginAttempts`
 * and derives `lockedUntil` with `sql` fragments evaluated by the database, not
 * by the caller — that atomicity is itself one of the five fixes this project
 * is guarding (see test/lockout-counter-concurrency.test.ts). A fake that just
 * copied whatever `.set()` was given, as a naive stand-in would, would store
 * the raw `SQL` object instead of a number and every assertion below would
 * fail against a symptom that has nothing to do with this endpoint. So this
 * fake's `update()` special-cases exactly those two fragments, computing them
 * against its own current row the way Postgres would.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { MAX_FAILED_ATTEMPTS, LOCKOUT_MS } from "../src/lib/rateLimit.js";

// ─── In-memory database fake ─────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  passwordHash: string | null;
  passwordAlgo: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastFailedLoginAt: Date | null;
  lockoutNotifiedAt: Date | null;
  sessionsValidAfter: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const state = { users: [] as UserRow[] };

function chain(resolve: () => unknown[]) {
  const self: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "orderBy", "values", "execute", "leftJoin"]) {
    self[method] = () => self;
  }
  self.then = (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  self.catch = (onRejected: (e: unknown) => unknown) => Promise.resolve(resolve()).catch(onRejected);
  return self;
}

/** Anything that isn't a plain literal is treated as a computed SQL fragment. */
function isRawSqlExpr(v: unknown): boolean {
  return typeof v === "object" && v !== null && !(v instanceof Date);
}

/**
 * Apply a `.set()` payload to `user`, resolving the two fragments
 * `registerFailure` actually sends (`failedLoginAttempts + 1`, and the
 * `lockedUntil` CASE derived from that same post-increment value) against the
 * row's *current* value — not a value the caller captured earlier. That is the
 * whole point of the fix under test.
 */
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

  Object.assign(user, resolved);
}

/**
 * Project a row onto a `.returning({...})`-style shape.
 *
 * `projection`'s VALUES are the mocked column identifiers (see
 * `usersTableMock` below, which maps each field to itself), so
 * `{ notifiedAt: usersTable.lockoutNotifiedAt }` resolves to
 * `{ notifiedAt: "lockoutNotifiedAt" }` — reading `user[outKey]` instead of
 * `user[projection[outKey]]` would silently project every renamed field
 * (`attempts`, `notifiedAt`) to `undefined`.
 */
function project(user: UserRow, projection: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const userFields = user as unknown as Record<string, unknown>;
  for (const [outKey, field] of Object.entries(projection)) {
    row[outKey] = userFields[field as string];
  }
  return row;
}

const db = {
  select: (projection?: Record<string, unknown>) =>
    chain(() => {
      const user = state.users[0];
      if (!user) return [];
      // authenticate() asks for exactly {id, sessionsValidAfter}.
      if (projection && "sessionsValidAfter" in projection) {
        return [{ id: user.id, sessionsValidAfter: user.sessionsValidAfter }];
      }
      // Everything else here (findUserById, the linked-identity lookup) wants
      // the full row or nothing; no test in this file exercises the identity
      // path, so it can safely fall through to "no match".
      return [user];
    }),

  insert: () => chain(() => []),

  update: () => {
    let pendingSet: Record<string, unknown> | null = null;
    let pendingReturning: Record<string, unknown> | null = null;

    const self = chain(() => {
      const user = state.users[0];
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

  delete: () => chain(() => { state.users.length = 0; return []; }),
};

// Column identifiers only need to be self-consistent within this fake — every
// value here is a plain string identical to the camelCase field it stands for
// (matching test/login-lockout.test.ts's `{ email: "email", id: "id" }`), so
// `.returning({ attempts: usersTable.failedLoginAttempts })` naturally projects.
const usersTableMock = {
  id: "id",
  email: "email",
  passwordHash: "passwordHash",
  passwordAlgo: "passwordAlgo",
  failedLoginAttempts: "failedLoginAttempts",
  lockedUntil: "lockedUntil",
  lastFailedLoginAt: "lastFailedLoginAt",
  lockoutNotifiedAt: "lockoutNotifiedAt",
  sessionsValidAfter: "sessionsValidAfter",
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
  identitiesTable: { id: "id", userId: "user_id", provider: "provider", subject: "subject" },
  // `authenticate` left-joins the per-session denylist onto the user row, so one
  // round trip answers both "was this account cut off?" and "was this token
  // signed out?". Nothing in these cases is signed out, so the join contributes
  // no columns — but the table has to exist for the module to import.
  revokedSessionsTable: { jti: "jti", userId: "user_id", revokedAt: "revoked_at", expiresAt: "expires_at" },
  analysesTable: {},
  chatMessagesTable: {},
  coachingTipsTable: {},
  injuryRisksTable: {},
  progressEntriesTable: {},
  achievementsTable: {},
  userAchievementsTable: {},
}));

// Deletion that locks the account defers a "your account is locked" email the
// same way login does; stub the transport so tests never hit the network.
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
const { signToken } = await import("../src/lib/auth.js");

const PASSWORD = "correct-horse-battery-staple";
const EMAIL = "athlete@example.com";
const USER_ID = "22222222-2222-2222-2222-222222222222";

async function seedUser(): Promise<void> {
  state.users = [
    {
      id: USER_ID,
      email: EMAIL,
      passwordHash: await bcrypt.hash(PASSWORD, 12),
      passwordAlgo: "bcrypt",
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastFailedLoginAt: null,
      lockoutNotifiedAt: null,
      sessionsValidAfter: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

function authToken(): string {
  return signToken({ userId: USER_ID, email: EMAIL });
}

function deleteAccount(body: Record<string, unknown>) {
  return request(app)
    .delete("/api/profile/account")
    .set("Authorization", `Bearer ${authToken()}`)
    .send(body);
}

beforeEach(async () => {
  __resetRateLimitState();
  sentEmails.length = 0;
  await seedUser();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DELETE /api/profile/account — routes through the shared lockout path", () => {
  it(
    "increments failed_login_attempts on each wrong-password attempt and locks the account at the threshold",
    { timeout: 60_000 },
    async () => {
      // The account-delete limiter's own budget (5/min) and MAX_FAILED_ATTEMPTS
      // (5) happen to coincide, so five wrong-password attempts is exactly
      // enough to demonstrate the lockout without also tripping the limiter —
      // that boundary is covered separately below.
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        const res = await deleteAccount({ password: "not-the-password" });
        expect(res.status).toBe(401);
      }

      expect(state.users[0]!.failedLoginAttempts).toBe(MAX_FAILED_ATTEMPTS);
      expect(state.users[0]!.lockedUntil).toBeInstanceOf(Date);
      expect(state.users[0]!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      // The account is untouched — a bare password oracle would have no such
      // guarantee, but a real deletion never happened here.
      expect(state.users).toHaveLength(1);

      await drainMail();
    },
  );

  it("refuses a deletion attempt with the CORRECT password once the account is locked", async () => {
    // Drive the row straight to "locked" rather than spending the delete
    // limiter's budget getting there — test/login-lockout.test.ts's own
    // "clears an expired lock automatically" test uses the same shortcut.
    state.users[0]!.failedLoginAttempts = MAX_FAILED_ATTEMPTS;
    state.users[0]!.lockedUntil = new Date(Date.now() + LOCKOUT_MS);

    const res = await deleteAccount({ password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Incorrect email or password" });
    // The account must still exist — the correct password did not slip
    // through the lock.
    expect(state.users).toHaveLength(1);
  });

  it("returns exactly the login route's failure message on a wrong password", async () => {
    const res = await deleteAccount({ password: "not-the-password" });
    expect(res.status).toBe(401);
    // Byte-identical to a failed /api/auth/login response — this is a
    // credential check, and must not be distinguishable from one by its
    // wording.
    expect(res.body).toEqual({ error: "Incorrect email or password" });
  });

  it("429s off its own tight budget well before the 120/min catch-all would apply", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await deleteAccount({ password: "not-the-password" });
      statuses.push(res.status);
    }

    // Five attempts get through to the handler (and fail on the password);
    // the sixth is refused by the account-delete limiter itself.
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });
});
