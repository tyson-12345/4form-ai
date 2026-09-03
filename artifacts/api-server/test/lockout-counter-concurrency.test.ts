/**
 * `registerFailure` (src/lib/passwordAuth.ts) — the failure counter is atomic
 * under concurrency.
 *
 * ── The regression this guards against ───────────────────────────────────────
 * The counter used to be advanced with
 * `set({ failedLoginAttempts: currentAttempts + 1 })`, where `currentAttempts`
 * was read *before* the ~250ms bcrypt comparison that precedes every failure.
 * Every request that started inside that window read the same stale value and
 * wrote the same result, so N concurrent failed logins against one account
 * advanced the counter by 1, not N — "five consecutive failures" was really
 * "five consecutive *serialised* failures", and an attacker willing to open
 * connections in parallel never reached the lockout at all. It now computes
 * the increment in SQL (`sql`${col} + 1``) and derives the lock from the
 * `RETURNING` value, so the increment happens against whatever the row
 * actually holds at write time, however many requests are racing for it.
 *
 * ── Why this fires N requests within the login limiter's own budget ─────────
 * `/api/auth/login` has its own rate limiter (10/min/IP, see app.ts) sitting in
 * front of the lockout logic. Anything past that limit gets a 429 before it
 * ever reaches `attemptPasswordAuth`, which would be measuring the limiter
 * instead of the counter. Nine is comfortably above `MAX_FAILED_ATTEMPTS` (5)
 * — enough to tell "+1" from "+N" apart — while staying under the 10/min cap,
 * so every one of the nine genuinely reaches the handler.
 *
 * The database fake and its handling of the `sql` increment fragment mirror
 * test/account-deletion-lockout.test.ts; see the comment there for why a
 * naive "copy whatever `.set()` was given" fake cannot exercise this fix.
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

/**
 * Apply a `.set()` payload against the row's *current* value.
 *
 * This is the crux of the whole test: `resolve()` runs synchronously, right
 * when a concurrent request's `await db.update(...)` is reached, so whichever
 * of the nine concurrent requests gets here first reads `user.failedLoginAttempts`
 * as it stands *at that instant* — genuinely live, the same guarantee a single
 * atomic `UPDATE ... SET x = x + 1` gives in Postgres. A fake that instead
 * echoed back whatever numeric value the caller had computed earlier (the
 * pre-fix shape) would let all nine racing requests compute "+1" off the same
 * stale read and reproduce exactly the bug this test exists to catch.
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

vi.mock("../src/lib/mailer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/mailer.js")>();
  return {
    ...actual,
    // A lockout notice fires once the ninth failure crosses the threshold;
    // stub the transport so the test never touches the network.
    sendEmail: async () => ({ delivered: true, provider: "resend" as const, attempts: 1 }),
  };
});

const { default: app } = await import("../src/app.js");
const { __resetRateLimitState } = await import("../src/lib/rateLimit.js");
const { drainMail } = await import("../src/lib/mailer.js");

const PASSWORD = "correct-horse-battery-staple";
const EMAIL = "athlete@example.com";

/** Comfortably above MAX_FAILED_ATTEMPTS (5), comfortably under the login limiter's 10/min. */
const CONCURRENT_FAILURES = 9;

async function seedUser(): Promise<void> {
  state.users = [
    {
      id: "33333333-3333-3333-3333-333333333333",
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
  await seedUser();
  currentEmail = EMAIL;
});

describe("concurrent failed logins", () => {
  it(
    `advance the failure counter by ${CONCURRENT_FAILURES}, not by 1, and lock the account`,
    { timeout: 30_000 },
    async () => {
      const attempts = Array.from({ length: CONCURRENT_FAILURES }, () =>
        login(EMAIL, "wrong-password-here"),
      );
      const results = await Promise.all(attempts);

      // Every one of them genuinely reached the handler (none absorbed by the
      // login rate limiter) and was refused for a bad password.
      for (const res of results) {
        expect(res.status).toBe(401);
      }

      // The count under test: N concurrent failures must land as N, not as 1
      // (the serialised-read bug) and not as some smaller number from lost
      // updates.
      expect(state.users[0]!.failedLoginAttempts).toBe(CONCURRENT_FAILURES);

      // Nine is past the five-failure threshold, so the account must have
      // locked — which a "+1" bug would never reach on its own.
      expect(state.users[0]!.lockedUntil).toBeInstanceOf(Date);
      expect(state.users[0]!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      await drainMail();
    },
  );
});
