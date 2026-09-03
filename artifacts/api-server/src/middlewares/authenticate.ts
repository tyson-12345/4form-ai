import type { Request, Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, revokedSessionsTable } from "@workspace/db";
import { verifyToken } from "../lib/auth.js";
import { requestIdentity } from "../lib/requestIdentity.js";
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

  /**
   * Reuses the verification the account-keyed rate limiters already did.
   *
   * Those run above the router, so on an authenticated route the signature has
   * been checked before this middleware is reached. `requestIdentity` memoises
   * the result on the request; without it every such request would verify its
   * own token twice. It returns `null` for every failure without distinguishing
   * them, which is what this route wants anyway — the reason is logged, and the
   * caller is told nothing beyond `AUTH_REQUIRED`.
   */
  const payload = requestIdentity(req);
  if (!payload) {
    // Re-run the verification purely to log *why*. Cheap, and only on the
    // failure path.
    let reason = "unknown";
    try {
      verifyToken(token);
    } catch (err) {
      reason = err instanceof Error ? err.message : "unknown";
    }
    // Log the reason (expired vs malformed vs bad signature) but never the token.
    logger.warn(
      { path: req.path, reason, event: "auth_token_rejected" },
      "Rejected bearer token",
    );
    res.status(401).json({ error: AUTH_REQUIRED });
    return;
  }

  /**
   * One round trip answers both revocation questions.
   *
   * The cutoff (`sessions_valid_after`) lives on the user row; the per-session
   * revocation lives in `revoked_sessions`, keyed by this token's own `jti`. A
   * second query for the second question would double the per-request cost of
   * being authenticated, so the join asks both at once — and the join key is
   * this token's id, so it matches at most one row.
   *
   * `payload.jti` is undefined on a token minted before `jti` existed. Joining
   * on a NULL matches nothing, which is the correct answer for those: they
   * cannot be individually revoked, only cut off, and the cutoff is checked
   * below regardless.
   */
  const [user] = await db
    .select({
      id: usersTable.id,
      sessionsValidAfter: usersTable.sessionsValidAfter,
      revokedAt: revokedSessionsTable.revokedAt,
    })
    .from(usersTable)
    .leftJoin(
      revokedSessionsTable,
      payload.jti
        ? eq(revokedSessionsTable.jti, payload.jti)
        : sql`false`,
    )
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

  if (user.revokedAt) {
    logger.warn(
      { userId: payload.userId, path: req.path, event: "auth_session_signed_out" },
      "Rejected a token that was signed out",
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
