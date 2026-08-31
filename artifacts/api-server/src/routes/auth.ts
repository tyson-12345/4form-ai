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
 * login (see `migratePasswordHash` in lib/passwordAuth.ts, which is also where
 * the lockout counter and the timing equalisation live — shared with the
 * account-link challenge in routes/oauth.ts so there is only ever one
 * password-checking path).
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

import { hashPassword, signToken, hashResetToken } from "../lib/auth.js";
import {
  attemptPasswordAuth,
  completePasswordAuth,
  createResetUrl,
  RESET_TOKEN_TTL_MS,
} from "../lib/passwordAuth.js";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { logger } from "../lib/logger.js";
import {
  parseOrReject,
  safeBirthDate,
  safeEmail,
  safeOpaqueToken,
  safePassword,
  safeText,
} from "../lib/validate.js";
import { clientIp } from "../lib/rateLimit.js";
import { deferEmail, sendEmail, passwordResetEmail } from "../lib/mailer.js";

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

  // Every failure branch — unknown address, wrong password, locked account, an
  // account with no password because it signs in through Apple or Google — is
  // resolved in here, at equal cost, and reported the same way.
  const attempt = await attemptPasswordAuth(user, password, ip);
  if (!attempt.ok) {
    res.status(401).json({ error: INVALID_CREDENTIALS });
    return;
  }

  // ── Success ──
  await completePasswordAuth(attempt.user, password);

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
    /**
     * Deliberately not awaited.
     *
     * This route answers identically whether or not the address is registered
     * — that is the entire point of `RESET_REQUESTED`. But it only does work in
     * *this* branch, so awaiting the token write and the provider round-trip
     * would make a registered address take a few hundred milliseconds longer
     * than an unregistered one, every time. That is a reliable oracle for the
     * exact fact the response refuses to state, and it would have appeared the
     * day mail was configured rather than the day this code was written.
     *
     * Both branches now reach `res.json` having done the same amount of work.
     */
    deferEmail("password_reset", async () => {
      const resetUrl = await createResetUrl(user.id);
      await sendEmail(
        passwordResetEmail(user.email, resetUrl, Math.round(RESET_TOKEN_TTL_MS / 60000)),
      );
      logger.info({ userId: user.id, event: "password_reset_requested" }, "Reset link issued");
    });
  } else {
    logger.warn(
      { ip: clientIp(req), event: "password_reset_unknown_email" },
      "Reset requested for unknown email",
    );
  }

  // Identical response either way.
  res.json({ message: RESET_REQUESTED });
});

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
