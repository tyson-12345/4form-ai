/**
 * The password credential path: verification, failure accounting, lockout, hash
 * migration, and reset-link minting.
 *
 * ── Why this is a module and not inline in the login route ──────────────────
 * Two endpoints now check a password: `POST /auth/login`, and the account-link
 * challenge at `POST /auth/oauth/link` where a user proves ownership of an
 * existing account before a provider identity is attached to it.
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

import { eq } from "drizzle-orm";
import { db, usersTable, passwordResetTokensTable } from "@workspace/db";

import {
  dummyHash,
  generateResetToken,
  hashPassword,
  needsRehash,
  verifyPassword,
  type PasswordAlgo,
} from "./auth.js";
import { logger } from "./logger.js";
import { recordAlert } from "./alerting.js";
import { MAX_FAILED_ATTEMPTS, LOCKOUT_MS, progressiveDelayMs, sleep } from "./rateLimit.js";
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

  if (!user || isLocked || !passwordValid) {
    if (user && !isLocked) {
      await registerFailure(user.id, user.email, user.failedLoginAttempts, ip);
    } else if (user && isLocked) {
      logger.warn(
        { userId: user.id, ip, event: "login_while_locked" },
        "Login attempt on a locked account",
      );
      // Match the delay a non-locked failure would incur so lockout is not
      // detectable by response time.
      await sleep(progressiveDelayMs(MAX_FAILED_ATTEMPTS));
    } else {
      logger.warn({ ip, event: "login_unknown_email" }, "Login attempt for unknown email");
      await sleep(progressiveDelayMs(1));
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
  const attempts = currentAttempts + 1;
  const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
  const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_MS) : null;

  await db
    .update(usersTable)
    .set({
      failedLoginAttempts: attempts,
      lastFailedLoginAt: new Date(),
      ...(shouldLock ? { lockedUntil } : {}),
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));

  if (shouldLock) {
    recordAlert("account_locked");
    logger.warn(
      { userId, ip, attempts, event: "account_locked" },
      "Account locked after consecutive failed logins",
    );
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
  } else {
    logger.warn(
      { userId, ip, attempts, event: "login_failed" },
      "Failed login attempt",
    );
  }

  await sleep(progressiveDelayMs(attempts));
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
