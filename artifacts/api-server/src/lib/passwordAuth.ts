/**
 * The password credential path: verification, failure accounting, lockout, hash
 * migration, and reset-link minting.
 *
 * ── Why this is a module and not inline in the login route ──────────────────
 * Three endpoints check a password: `POST /auth/login`; the account-link
 * challenge at `POST /auth/oauth/link`, where a user proves ownership of an
 * existing account before a provider identity is attached to it; and
 * `DELETE /profile/account`, where a user re-authenticates before erasing
 * everything.
 *
 * The third one is the cautionary tale the paragraph below predicted. It was
 * added later, called `verifyPassword` directly, and for as long as it did so
 * it was an unthrottled password oracle reachable with nothing but a session
 * token — no lockout, no counter, no delay — sitting beside a login route that
 * was carefully all three. It now goes through here like the others.
 *
 * A second endpoint that checks passwords with its own copy of this logic is
 * how a rate limit gets bypassed. The copy starts identical, then one side
 * gains a fix the other does not — most likely the new one never grows the
 * timing equalisation or the lockout counter at all, at which point the link
 * endpoint is an unthrottled password oracle *and* an email-enumeration oracle,
 * sitting right next to a login endpoint that is carefully neither.
 *
 * So there is one implementation, and both callers are thin.
 */

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, usersTable, passwordResetTokensTable } from "@workspace/db";

import {
  dummyHash,
  isLegacyAlgo,
  generateResetToken,
  hashPassword,
  needsRehash,
  verifyPassword,
  type PasswordAlgo,
} from "./auth.js";
import { logger } from "./logger.js";
import { recordAlert } from "./alerting.js";
import { MAX_FAILED_ATTEMPTS, LOCKOUT_MS, failureDelayMs, sleep } from "./rateLimit.js";
import { deferEmail, sendEmail, accountLockedEmail } from "./mailer.js";

/** The columns a password check needs. */
export interface PasswordAuthUser {
  id: string;
  email: string;
  /** NULL for a federated-only account — see the `users` table comment. */
  passwordHash: string | null;
  passwordAlgo: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

/**
 * Check `password` against `user`, applying lockout and timing equalisation.
 *
 * `user` may be `undefined` — that is the "no account with this address" case,
 * and it deliberately runs the same work as every other failure. Callers must
 * respond identically to `{ ok: false }` regardless of which branch produced
 * it; the reason is logged, never returned.
 *
 * On failure this has already slept for the progressive delay and updated the
 * counters, so the caller writes the response and nothing else. On success it
 * hands back the narrowed user, so no caller needs a non-null assertion to
 * reach the row it just authenticated.
 */
export async function attemptPasswordAuth(
  user: PasswordAuthUser | undefined,
  password: string,
  ip: string,
): Promise<{ ok: false } | { ok: true; user: PasswordAuthUser }> {
  const now = new Date();
  const isLocked = Boolean(user?.lockedUntil && user.lockedUntil > now);

  // Always run a real bcrypt comparison, even when the user does not exist, has
  // no password set, or is locked, so every failure path costs the same
  // wall-clock time.
  const hashToCheck = user?.passwordHash ?? (await dummyHash());
  const algoToCheck = (user?.passwordAlgo ?? "bcrypt") as PasswordAlgo;
  const passwordValid = await verifyPassword(password, hashToCheck, algoToCheck);

  /**
   * Legacy hashes are fast, and that inverts the oracle the dummy hash closed.
   *
   * `dummyHash()` makes the "no such account" path cost a full cost-12 bcrypt.
   * But `verifyPassword` takes the non-bcrypt arm for a row tagged
   * `md5`/`sha1`/`sha256`/`plaintext` and returns in microseconds — so a failed
   * login against one of those accounts came back *measurably faster* than one
   * against an address that was never registered. The equalisation held for
   * every account except the ones still on a legacy hash, and those are exactly
   * the accounts worth finding.
   *
   * Burning an equivalent bcrypt afterwards costs nothing on the path that
   * matters (there should be no legacy rows left; the migration script and
   * migrate-on-login exist to see to that) and removes the tell while any
   * remain. The result is discarded — this is spent time, not a check.
   */
  if (isLegacyAlgo(algoToCheck)) {
    await verifyPassword(password, await dummyHash(), "bcrypt");
  }

  if (!user || isLocked || !passwordValid) {
    if (user && !isLocked) {
      await registerFailure(user.id, user.email, user.failedLoginAttempts, ip);
    } else if (user && isLocked) {
      logger.warn(
        { userId: user.id, ip, event: "login_while_locked" },
        "Login attempt on a locked account",
      );
      // Same delay as every other failure — see `failureDelayMs`. A locked
      // account must not be distinguishable from a wrong password, and neither
      // must be distinguishable from an address that was never registered.
      await sleep(failureDelayMs(ip));
    } else {
      logger.warn({ ip, event: "login_unknown_email" }, "Login attempt for unknown email");
      await sleep(failureDelayMs(ip));
    }
    return { ok: false };
  }

  return { ok: true, user };
}

/**
 * Clear failure state and upgrade the stored hash after a successful password
 * check. Safe to call unconditionally.
 */
export async function completePasswordAuth(
  user: PasswordAuthUser,
  password: string,
): Promise<void> {
  await migratePasswordHash(user.id, user.passwordHash, user.passwordAlgo, password);

  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await db
      .update(usersTable)
      .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));
  }
}

/**
 * Increment the failure counter, apply a progressive delay, and lock the
 * account once the threshold is reached.
 *
 * The delay happens *before* the response is written but after the DB update,
 * so concurrent attempts all see an up-to-date counter.
 */
async function registerFailure(
  userId: string,
  email: string,
  currentAttempts: number,
  ip: string,
): Promise<void> {
  /**
   * The increment is computed by the database, not by us.
   *
   * `currentAttempts` was read before the ~250ms bcrypt comparison that
   * precedes this call, so every attempt that starts inside that window reads
   * the same value and, under the previous `set({ failedLoginAttempts:
   * currentAttempts + 1 })`, wrote the same value. Ten concurrent guesses
   * advanced the counter by one. The lockout was therefore not "five
   * consecutive failures" but "five consecutive *serialised* failures", and an
   * attacker willing to open connections in parallel never reached it.
   *
   * `failed_login_attempts + 1` evaluated inside the UPDATE is atomic per row,
   * so N concurrent failures advance it by N. `locked_until` is set in the same
   * statement, from the post-increment value, so the decision to lock is made
   * against the count the database actually holds. The parameter is kept only
   * for the log line.
   */
  const [row] = await db
    .update(usersTable)
    .set({
      failedLoginAttempts: sql`${usersTable.failedLoginAttempts} + 1`,
      lastFailedLoginAt: new Date(),
      lockedUntil: sql`CASE WHEN ${usersTable.failedLoginAttempts} + 1 >= ${MAX_FAILED_ATTEMPTS}
        THEN now() + ${sql.raw(`interval '${Math.round(LOCKOUT_MS / 1000)} seconds'`)}
        ELSE ${usersTable.lockedUntil} END`,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId))
    .returning({
      attempts: usersTable.failedLoginAttempts,
      lockedUntil: usersTable.lockedUntil,
      notifiedAt: usersTable.lockoutNotifiedAt,
    });

  const attempts = row?.attempts ?? currentAttempts + 1;
  const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

  if (shouldLock) {
    recordAlert("account_locked");
    logger.warn(
      { userId, ip, attempts, event: "account_locked" },
      "Account locked after consecutive failed logins",
    );
    await notifyLockout(userId, email, row?.notifiedAt ?? null);
  } else {
    logger.warn(
      { userId, ip, attempts, event: "login_failed" },
      "Failed login attempt",
    );
  }

  await sleep(failureDelayMs(ip));
}

/**
 * How long a lockout notice suppresses the next one.
 *
 * `failedLoginAttempts` is never decayed, so once an account is past the
 * threshold *every* subsequent failure satisfies `attempts >= MAX` and, before
 * this existed, sent another lockout email. Four requests an hour kept an
 * account permanently locked out of password login and turned our mail
 * provider into an amplifier pointed at the victim's inbox — the only outbound
 * mail path in the app with no per-account ceiling.
 *
 * One notice per lockout episode is the useful signal; the rest is noise the
 * attacker chose to send.
 */
export const LOCKOUT_NOTICE_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/**
 * Mail the account owner that their account is locked, at most once per
 * cooldown window.
 *
 * The claim is written before the send, and only by a statement that also
 * checks the previous value, so two concurrent lock transitions cannot both
 * decide they are the one to send.
 */
async function notifyLockout(
  userId: string,
  email: string,
  notifiedAt: Date | null,
): Promise<void> {
  const cutoff = new Date(Date.now() - LOCKOUT_NOTICE_COOLDOWN_MS);
  if (notifiedAt && notifiedAt > cutoff) return;

  const claimed = await db
    .update(usersTable)
    .set({ lockoutNotifiedAt: new Date() })
    .where(
      and(
        eq(usersTable.id, userId),
        or(
          isNull(usersTable.lockoutNotifiedAt),
          lt(usersTable.lockoutNotifiedAt, cutoff),
        ),
      ),
    )
    .returning({ id: usersTable.id });

  if (claimed.length === 0) return;

  // Notify out-of-band. The response to the caller is unchanged — only the
  // account owner learns that a lockout happened.
  //
  // Deferred for the same reason as the reset mail: with retries a send can
  // now take tens of seconds, and this sits inside a request. It is also the
  // attempt that *transitions* an account into lockout, so awaiting delivery
  // would make that one response measurably longer than the locked responses
  // that follow it — a smaller tell than the reset route's, but the same
  // kind, and free to remove.
  deferEmail("account_locked", async () => {
    const resetUrl = await createResetUrl(userId);
    await sendEmail(accountLockedEmail(email, resetUrl, Math.round(LOCKOUT_MS / 60000)));
  });
}

/**
 * Re-hash a password with current parameters when the stored hash is legacy
 * (md5/sha1/sha256/plaintext) or bcrypt below our current cost.
 *
 * This is the "migrate on next login" half of the password migration; the
 * bulk-invalidation half lives in scripts/migrate-passwords.ts.
 *
 * A NULL stored hash returns immediately. That case is a federated-only
 * account, and it is unreachable via a successful password check — but
 * `needsRehash("")` would answer *true*, so a missing guard here would quietly
 * mint a password for an account that is supposed to have none.
 */
async function migratePasswordHash(
  userId: string,
  storedHash: string | null,
  storedAlgo: string,
  plaintextPassword: string,
): Promise<void> {
  if (storedHash === null) return;
  if (!needsRehash(storedHash, storedAlgo)) return;

  const upgraded = await hashPassword(plaintextPassword);
  await db
    .update(usersTable)
    .set({ passwordHash: upgraded, passwordAlgo: "bcrypt", updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  logger.info(
    { userId, from: storedAlgo, event: "password_rehashed" },
    "Upgraded stored password hash to bcrypt",
  );
}

// ─── Reset links ─────────────────────────────────────────────────────────────

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/** Mint a single-use reset token for `userId` and return the full reset URL. */
export async function createResetUrl(userId: string): Promise<string> {
  const { raw, hash } = generateResetToken();

  await db.insert(passwordResetTokensTable).values({
    userId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });

  return `${resetLinkBase()}/reset-password?token=${raw}`;
}

/**
 * Base URL that reset links are built from.
 *
 * ── Why this throws instead of defaulting ───────────────────────────────────
 * It used to fall back to `https://athleteai.app`. On 2026-08-12 that domain
 * turned out to belong to someone else. A password-reset link is a single-use
 * credential: sending one to a domain we do not control means mailing working
 * account-recovery tokens to a third party, and the user sees a link that looks
 * official and isn't.
 *
 * There is no safe default here. In production a missing `APP_PUBLIC_URL` is a
 * misconfiguration that must be fixed, not papered over — the request fails,
 * the error is logged, and the caller still gets the same generic "if that email
 * is registered…" response, so nothing about account existence leaks either way.
 *
 * Locally it falls back to the dev server so the flow can be exercised.
 */
function resetLinkBase(): string {
  const configured = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "APP_PUBLIC_URL is not set. Refusing to build a password reset link " +
        "against a default domain; reset tokens must only ever point at a host " +
        "we control.",
    );
  }

  return `http://localhost:${process.env.PORT ?? 3000}`;
}
