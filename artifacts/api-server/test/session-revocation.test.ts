/**
 * Session revocation.
 *
 * The regression these guard against: JWTs live for 7 days and cannot be
 * recalled once signed, so before `users.sessions_valid_after` existed a
 * password reset left every already-issued token working. A user who reset
 * their password *because* they thought someone was in their account kept the
 * attacker signed in for up to a week.
 *
 * The database is replaced with a minimal fake — these exercise the middleware's
 * decision, not Drizzle.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Database fake ───────────────────────────────────────────────────────────

interface FakeUser {
  id: string;
  sessionsValidAfter: Date | null;
  /**
   * What the left join contributes.
   *
   * `authenticate` selects `revokedSessionsTable.revokedAt` alongside the user
   * columns, so a signed-out token comes back as one row with this populated and
   * a live one as the same row with it null. Modelling it as a field on the fake
   * user is the shape the real query actually returns.
   */
  revokedAt: Date | null;
}

const state: { user: FakeUser | null } = { user: null };

function chain(resolve: () => unknown[]) {
  const self: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "leftJoin"]) {
    self[method] = () => self;
  }
  self.then = (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return self;
}

vi.mock("@workspace/db", () => ({
  db: { select: () => chain(() => (state.user ? [state.user] : [])) },
  usersTable: { id: "id", sessionsValidAfter: "sessions_valid_after" },
  // `authenticate` left-joins the per-session denylist onto the user row so one
  // round trip answers both "was this account cut off?" and "was this token
  // signed out?". The join is a no-op for these cases — nothing here is signed
  // out — but the table has to exist for the module to import.
  revokedSessionsTable: { jti: "jti", revokedAt: "revoked_at" },
}));

vi.mock("drizzle-orm", () => ({ eq: () => ({}), sql: () => ({}) }));

const { authenticate } = await import("../src/middlewares/authenticate.js");
const { signToken } = await import("../src/lib/auth.js");

// ─── Harness ─────────────────────────────────────────────────────────────────

const USER_ID = "11111111-1111-4111-8111-111111111111";

function run(token: string | null) {
  const req = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    path: "/api/profile",
  } as never;

  let status = 0;
  let body: unknown = null;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as never;

  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  return authenticate(req, res, next).then(() => ({
    status,
    body,
    nextCalled,
    req: req as { userId?: string },
  }));
}

function tokenFor(userId = USER_ID): string {
  return signToken({ userId, email: "athlete@example.com" });
}

beforeEach(() => {
  state.user = { id: USER_ID, sessionsValidAfter: null, revokedAt: null };
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("authenticate — normal operation", () => {
  it("admits a valid token when no cutoff is set", async () => {
    const result = await run(tokenFor());
    expect(result.nextCalled).toBe(true);
    expect(result.req.userId).toBe(USER_ID);
  });

  it("rejects a request with no token", async () => {
    const result = await run(null);
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(401);
  });

  it("rejects a token that is not ours", async () => {
    const result = await run("not.a.real.token");
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(401);
  });
});

describe("authenticate — session cutoff", () => {
  it("rejects a token issued before the cutoff", async () => {
    const token = tokenFor();
    // Cutoff one hour in the future stands in for "the reset happened after
    // this token was minted".
    state.user = { id: USER_ID, sessionsValidAfter: new Date(Date.now() + 60 * 60 * 1000) };

    const result = await run(token);
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(401);
  });

  it("admits a token issued after the cutoff", async () => {
    state.user = { id: USER_ID, sessionsValidAfter: new Date(Date.now() - 60 * 60 * 1000) };

    const result = await run(tokenFor());
    expect(result.nextCalled).toBe(true);
  });

  it("rejects a token issued in the same second as the cutoff", async () => {
    // JWT `iat` has one-second resolution. A strict `<` would admit a token
    // minted in the same second as the reset that was meant to revoke it.
    const token = tokenFor();
    const issuedAtSecond = new Date(Math.floor(Date.now() / 1000) * 1000);

    state.user = { id: USER_ID, sessionsValidAfter: issuedAtSecond, revokedAt: null };

    const result = await run(token);
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(401);
  });

  it("does not leak why the token was refused", async () => {
    // A revoked session and an absent one must be indistinguishable — otherwise
    // the response confirms the account exists and has been reset recently.
    state.user = { id: USER_ID, sessionsValidAfter: new Date(Date.now() + 60_000) };
    const revoked = await run(tokenFor());

    state.user = null;
    const missing = await run(tokenFor());

    expect(revoked.body).toEqual(missing.body);
    expect(revoked.status).toBe(missing.status);
  });
});

describe("authenticate — deleted account", () => {
  it("rejects a structurally valid token whose user row is gone", async () => {
    state.user = null;
    const result = await run(tokenFor());
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(401);
  });
});

describe("per-session sign-out", () => {
  /**
   * The regression: signing out used to delete only the device's copy of the
   * token, leaving a live seven-day credential on a phone the user had just
   * handed back. `POST /auth/logout` now lists the token's own `jti`, and this
   * is the middleware half — the listed token is refused while every other
   * session for the same account keeps working.
   */
  it("rejects a token whose session was signed out", async () => {
    state.user = { id: USER_ID, sessionsValidAfter: null, revokedAt: new Date() };
    const result = await run(tokenFor());
    expect(result.nextCalled).toBe(false);
    expect(result.status).toBe(401);
  });

  it("does not say a token was signed out rather than merely invalid", async () => {
    state.user = { id: USER_ID, sessionsValidAfter: null, revokedAt: new Date() };
    const signedOut = await run(tokenFor());

    state.user = { id: USER_ID, sessionsValidAfter: null, revokedAt: null };
    const garbage = await run("not-a-token");

    // Distinguishing them would tell a token holder whether the account owner
    // has noticed them and signed out.
    expect(signedOut.body).toEqual(garbage.body);
  });

  it("admits a token that was not signed out", async () => {
    state.user = { id: USER_ID, sessionsValidAfter: null, revokedAt: null };
    const result = await run(tokenFor());
    expect(result.nextCalled).toBe(true);
    expect(result.req.userId).toBe(USER_ID);
  });

  it("stamps every token with a jti, so any session can be named", () => {
    const a = tokenFor();
    const b = tokenFor();

    const jtiOf = (t: string) =>
      (JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString()) as { jti?: string }).jti;

    expect(jtiOf(a)).toBeTruthy();
    // Two sessions for the same account must be separately revocable, which is
    // the whole point — a shared id would make signing out of one sign out both.
    expect(jtiOf(a)).not.toBe(jtiOf(b));
  });
});
