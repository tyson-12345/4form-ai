/**
 * Authentication routes.
 *
 * ── Error-message policy ────────────────────────────────────────────────────
 * Auth responses are deliberately uninformative. Every failure to sign in —
 * unknown email, wrong password, or a locked account — returns the byte-identical
 * string `INVALID_CREDENTIALS`. Any variation lets an attacker enumerate which
 * emails are registered, or learn that they have successfully triggered a
 * lockout (which itself confirms the account exists).
 *
 * Timing is equalized to match: the "no such user" path runs a real bcrypt
 * comparison against a dummy hash so it costs the same as a genuine attempt.
 *
 * ── Passwords ───────────────────────────────────────────────────────────────
 * Passwords are never logged, never echoed, and never interpolated into an
 * error. Legacy hashes are transparently upgraded to bcrypt on first successful
 * login (see `migratePasswordHash`).
 */

import { Router } from "express";
import { z } from "zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  athleteProfilesTable,
  subscriptionsTable,
  passwordResetTokensTable,
} from "@workspace/db";

import {
  hashPassword,
  verifyPassword,
  signToken,
  dummyHash,
  needsRehash,
  generateResetToken,
  hashResetToken,
  type PasswordAlgo,
} from "../lib/auth.js";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { logger } from "../lib/logger.js";
import { recordAlert } from "../lib/alerting.js";
import {
  parseOrReject,
  safeBirthDate,
  safeEmail,
  safeOpaqueToken,
  safePassword,
  safeText,
} from "../lib/validate.js";
import {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MS,
  progressiveDelayMs,
  sleep,
  clientIp,
} from "../lib/rateLimit.js";
import { sendEmail, passwordResetEmail, accountLockedEmail } from "../lib/mailer.js";

const router = Router();

// ─── Canonical response strings ──────────────────────────────────────────────
// Never vary these per-case. See the error-message policy above.

const INVALID_CREDENTIALS = "Incorrect email or password";
const RESET_REQUESTED =
  "If that email is registered, you will receive a reset link.";
/**
 * Signup conflict. Phrased as a conditional so it does not *confirm* the address
 * is registered — it reads identically to a user who has simply mistyped.
 *
 * NOTE: perfect non-enumeration on signup requires email-verified registration
 * (respond identically in both cases, deliver the outcome by email). That needs
 * a configured mail provider; see SECURITY.md → "Known limitations".
 */
const SIGNUP_CONFLICT =
  "We couldn't create an account with those details. If you already have an account, try signing in or resetting your password.";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

// ─── Schemas ─────────────────────────────────────────────────────────────────

const signupSchema = z.object({
  email: safeEmail,
  password: safePassword,
  name: safeText(1, 80),
  /**
   * `YYYY-MM-DD`. Rejected below the age floor — see `safeBirthDate`.
   *
   * A failure here returns the same generic validation message as any other bad
   * field, which is deliberate: an under-13 who is told *precisely* which field
   * blocked them has been handed the instruction for getting past it. The app
   * explains the age requirement up front instead, before they type anything.
   */
  dateOfBirth: safeBirthDate,
});

const loginSchema = z.object({
  email: safeEmail,
  // Not `safePassword`: applying signup rules here would reject a legacy
  // short password and tell the caller their password is the wrong *shape*,
  // which is information. Bound the length only.
  password: z.string().min(1).max(200),
});

const forgotPasswordSchema = z.object({ email: safeEmail });

const resetPasswordSchema = z.object({
  token: safeOpaqueToken,
  password: safePassword,
});

// ─── POST /api/auth/signup ───────────────────────────────────────────────────

router.post("/auth/signup", async (req, res) => {
  const data = parseOrReject(signupSchema, req.body, res, {
    route: "auth/signup",
    ip: clientIp(req),
  });
  if (!data) return;

  const { email, password, name, dateOfBirth } = data;

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing) {
    // Burn equivalent time so a taken address isn't detectable by latency.
    await hashPassword(password);
    logger.warn(
      { route: "auth/signup", ip: clientIp(req), event: "signup_duplicate_email" },
      "Signup attempted with an already-registered email",
    );
    res.status(409).json({ error: SIGNUP_CONFLICT });
    return;
  }

  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash,
      passwordAlgo: "bcrypt",
      // Stored as YYYY-MM-DD; the column is a DATE, so no time component is
      // retained. Kept rather than discarded after the check so the age floor
      // can be re-verified and so 13–17 accounts are identifiable if parental
      // assent is ever enforced.
      birthDate: dateOfBirth.toISOString().slice(0, 10),
    })
    .returning({ id: usersTable.id, email: usersTable.email });

  await Promise.all([
    db.insert(athleteProfilesTable).values({
      userId: user.id,
      name,
      sport: "",
      level: "beginner",
      goals: [],
      injuryConcerns: [],
    }),
    db.insert(subscriptionsTable).values({
      userId: user.id,
      tier: "free",
      status: "active",
    }),
  ]);

  logger.info({ userId: user.id, event: "signup_success" }, "Account created");

  const token = signToken({ userId: user.id, email: user.email });
  res.status(201).json({ token, user: { id: user.id, email: user.email, name } });
});

// ─── POST /api/auth/login ────────────────────────────────────────────────────

router.post("/auth/login", async (req, res) => {
  const data = parseOrReject(loginSchema, req.body, res, {
    route: "auth/login",
    ip: clientIp(req),
  });
  // A malformed login body gets the credentials message, not the validation
  // message — otherwise the two responses distinguish "bad shape" from
  // "bad password" and hand back a probing signal.
  if (!data) return;

  const { email, password } = data;
  const ip = clientIp(req);

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  const now = new Date();
  const isLocked = Boolean(user?.lockedUntil && user.lockedUntil > now);

  // Always run a real bcrypt comparison, even when the user does not exist or
  // is locked, so every failure path costs the same wall-clock time.
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

    res.status(401).json({ error: INVALID_CREDENTIALS });
    return;
  }

  // ── Success ──
  await migratePasswordHash(user.id, user.passwordHash, user.passwordAlgo, password);

  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await db
      .update(usersTable)
      .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));
  }

  const [profile] = await db
    .select({ name: athleteProfilesTable.name })
    .from(athleteProfilesTable)
    .where(eq(athleteProfilesTable.userId, user.id))
    .limit(1);

  logger.info({ userId: user.id, event: "login_success" }, "Login succeeded");

  const token = signToken({ userId: user.id, email: user.email });
  res.json({
    token,
    user: { id: user.id, email: user.email, name: profile?.name ?? "" },
  });
});

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
    const resetUrl = await createResetUrl(userId);
    await sendEmail(
      accountLockedEmail(email, resetUrl, Math.round(LOCKOUT_MS / 60000)),
    );
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
 */
async function migratePasswordHash(
  userId: string,
  storedHash: string,
  storedAlgo: string,
  plaintextPassword: string,
): Promise<void> {
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

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

router.post("/auth/forgot-password", async (req, res) => {
  const data = parseOrReject(forgotPasswordSchema, req.body, res, {
    route: "auth/forgot-password",
    ip: clientIp(req),
  });
  if (!data) return;

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.email, data.email))
    .limit(1);

  if (user) {
    const resetUrl = await createResetUrl(user.id);
    await sendEmail(
      passwordResetEmail(user.email, resetUrl, Math.round(RESET_TOKEN_TTL_MS / 60000)),
    );
    logger.info({ userId: user.id, event: "password_reset_requested" }, "Reset link issued");
  } else {
    logger.warn(
      { ip: clientIp(req), event: "password_reset_unknown_email" },
      "Reset requested for unknown email",
    );
  }

  // Identical response either way.
  res.json({ message: RESET_REQUESTED });
});

/** Mint a single-use reset token for `userId` and return the full reset URL. */
async function createResetUrl(userId: string): Promise<string> {
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
        "against a default domain — reset tokens must only ever point at a host " +
        "we control.",
    );
  }

  return `http://localhost:${process.env.PORT ?? 3000}`;
}

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

router.post("/auth/reset-password", async (req, res) => {
  const data = parseOrReject(resetPasswordSchema, req.body, res, {
    route: "auth/reset-password",
    ip: clientIp(req),
  });
  if (!data) return;

  const tokenHash = hashResetToken(data.token);

  const [tokenRow] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!tokenRow) {
    logger.warn(
      { ip: clientIp(req), event: "password_reset_invalid_token" },
      "Reset attempted with an invalid, used, or expired token",
    );
    res.status(400).json({ error: "This reset link is invalid or has expired." });
    return;
  }

  const passwordHash = await hashPassword(data.password);

  await db
    .update(usersTable)
    .set({
      passwordHash,
      passwordAlgo: "bcrypt",
      // A successful reset clears any lockout — the legitimate owner has
      // proven control of the mailbox.
      failedLoginAttempts: 0,
      lockedUntil: null,
      // Revoke every session issued before now. A reset is what a user does
      // when they think someone else is in their account; without this the
      // attacker's existing 7-day token would outlive the password change and
      // the reset would accomplish nothing.
      sessionsValidAfter: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, tokenRow.userId));

  await db
    .update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokensTable.id, tokenRow.id));

  logger.info(
    { userId: tokenRow.userId, event: "password_reset_success" },
    "Password reset completed",
  );

  res.json({ message: "Your password has been reset. You can now sign in." });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────

router.get("/auth/me", authenticate, async (req: AuthRequest, res) => {
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  if (!user) {
    // The token verified but the row is gone (deleted account). Treat as an
    // invalid session rather than a 404, so the client clears its token.
    res.status(401).json({ error: "Session expired. Please sign in again." });
    return;
  }

  const [profile] = await db
    .select()
    .from(athleteProfilesTable)
    .where(eq(athleteProfilesTable.userId, user.id))
    .limit(1);

  const [subscription] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, user.id))
    .limit(1);

  res.json({ user, profile, subscription });
});

export default router;
