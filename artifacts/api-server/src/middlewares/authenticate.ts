import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { verifyToken } from "../lib/auth.js";
import { logger } from "../lib/logger.js";

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

/**
 * Single generic message for every authentication failure.
 *
 * Distinguishing "no header" from "malformed token" from "expired token" tells
 * an attacker how far they got. The specific reason is logged instead.
 */
const AUTH_REQUIRED = "Authentication required. Please sign in.";

/**
 * Verify the bearer token and confirm the session has not been revoked.
 *
 * ── Why there is a database read here ───────────────────────────────────────
 * A JWT is a bearer credential that cannot be recalled: once signed it is valid
 * until it expires, and ours last 7 days. That means a signature check alone
 * cannot answer "is this session still allowed?" — only "was this token ever
 * issued?".
 *
 * Two cases where those answers differ, and both matter:
 *
 *  - **Password reset.** A user who believes their account is compromised
 *    resets their password. Without this check the attacker's existing token
 *    keeps working for up to a week, so the one action the user is told to take
 *    does nothing.
 *  - **Deleted account.** The row is gone but the token still verifies. Every
 *    route would then run queries for a user that no longer exists.
 *
 * The cost is one indexed primary-key lookup per authenticated request. That is
 * the price of revocable sessions with stateless tokens; the alternative is a
 * server-side session store, which is a larger change for the same outcome.
 */
export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    logger.warn(
      { path: req.path, event: "auth_missing_header" },
      "Request without a bearer token",
    );
    res.status(401).json({ error: AUTH_REQUIRED });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: AUTH_REQUIRED });
    return;
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    // Log the reason (expired vs malformed vs bad signature) but never the token.
    logger.warn(
      {
        path: req.path,
        reason: err instanceof Error ? err.message : "unknown",
        event: "auth_token_rejected",
      },
      "Rejected bearer token",
    );
    res.status(401).json({ error: AUTH_REQUIRED });
    return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      sessionsValidAfter: usersTable.sessionsValidAfter,
    })
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .limit(1);

  if (!user) {
    logger.warn(
      { path: req.path, event: "auth_user_gone" },
      "Valid token for a user that no longer exists",
    );
    res.status(401).json({ error: AUTH_REQUIRED });
    return;
  }

  // `<=` not `<`: a token minted in the same second as the reset must be
  // refused. JWT `iat` has one-second resolution, so a strict comparison would
  // let a token issued moments before the reset survive it.
  if (user.sessionsValidAfter && payload.issuedAt <= user.sessionsValidAfter) {
    logger.warn(
      { userId: payload.userId, path: req.path, event: "auth_session_revoked" },
      "Rejected a token issued before the account's session cutoff",
    );
    res.status(401).json({ error: AUTH_REQUIRED });
    return;
  }

  req.userId = payload.userId;
  req.userEmail = payload.email;
  next();
}
