/**
 * Periodic deletion of spent password-reset tokens.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Every "forgot password" request inserts a row. Nothing ever removed one, so
 * the table only grew — and the rows that accumulate are precisely the
 * security-sensitive ones. They are not usable (only a SHA-256 is stored, and
 * both the expiry and the used-at checks are in the query that redeems them),
 * but a table of hashes tied to user ids is data with no remaining purpose, and
 * data with no purpose is data you have to keep explaining in a privacy policy.
 *
 * ── Why in-process rather than a cron job ───────────────────────────────────
 * The deployment is a single long-running container with no scheduler. An
 * interval here needs no external service, no extra credential, and no separate
 * thing to notice has stopped working. `scripts/prune-reset-tokens.ts` exists
 * for a manual or externally-scheduled run if that ever changes.
 *
 * Same pattern as the rate-limiter's bucket sweeper in `rateLimit.ts`.
 */

import { lt, and, isNotNull, or } from "drizzle-orm";
import { db, passwordResetTokensTable, revokedSessionsTable } from "@workspace/db";
import { logger } from "./logger.js";
import { pruneDeletedAnalyses } from "../repositories/analysisRepository.js";

/** How often the sweep runs. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * How long a spent token is kept before deletion.
 *
 * Not zero. A short grace period means a user who clicks their reset link twice
 * — or whose mail client prefetches it — gets "this link has already been used"
 * rather than "this link is invalid", which is the more accurate message and
 * avoids a support email. It also leaves a trail for the day someone asks
 * whether a reset actually happened.
 */
const GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Delete tokens that are expired or used, past the grace period.
 *
 * Returns the number removed. Never throws — a failed cleanup is a housekeeping
 * problem, not a reason to take down the process that is also serving requests.
 */
export async function pruneResetTokens(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - GRACE_MS);

  try {
    const deleted = await db
      .delete(passwordResetTokensTable)
      .where(
        or(
          // Expired long enough ago that no one is still clicking the link.
          lt(passwordResetTokensTable.expiresAt, cutoff),
          // Already redeemed, past the grace period.
          and(
            isNotNull(passwordResetTokensTable.usedAt),
            lt(passwordResetTokensTable.usedAt, cutoff),
          ),
        ),
      )
      .returning({ id: passwordResetTokensTable.id });

    if (deleted.length > 0) {
      logger.info(
        { count: deleted.length, event: "reset_tokens_pruned" },
        "Pruned spent password reset tokens",
      );
    }
    return deleted.length;
  } catch (err) {
    logger.error(
      { err, event: "reset_token_prune_failed" },
      "Failed to prune password reset tokens",
    );
    return 0;
  }
}

/**
 * How long a scrubbed (soft-deleted) analysis row is kept.
 *
 * The row exists only so the monthly quota count cannot be refunded by
 * deleting sessions. 32 days guarantees the calendar month it was uploaded in
 * has closed — a row deleted more than 32 days ago was necessarily uploaded in
 * a prior month, and prior months never enter a quota count again.
 */
const DELETED_ANALYSIS_RETENTION_MS = 32 * 24 * 60 * 60 * 1000;

/** Remove scrubbed analysis rows that can no longer affect a quota count. */
export async function pruneDeletedAnalysisRows(now = new Date()): Promise<number> {
  try {
    const removed = await pruneDeletedAnalyses(
      new Date(now.getTime() - DELETED_ANALYSIS_RETENTION_MS),
    );
    if (removed > 0) {
      logger.info(
        { count: removed, event: "deleted_analyses_pruned" },
        "Pruned scrubbed analysis rows past their quota month",
      );
    }
    return removed;
  } catch (err) {
    logger.error(
      { err, event: "deleted_analysis_prune_failed" },
      "Failed to prune scrubbed analysis rows",
    );
    return 0;
  }
}

/**
 * Remove revocations whose token has expired on its own.
 *
 * A row in `revoked_sessions` exists to refuse one token. Once that token would
 * have been rejected anyway — its 7-day expiry has passed — the row answers a
 * question nobody will ask again, and every authenticated request pays a
 * fractionally larger join for it.
 *
 * No grace period, unlike the reset tokens above: there is no user-facing
 * message that depends on distinguishing "signed out" from "expired", and both
 * produce the same 401 by design.
 */
export async function pruneRevokedSessions(now = new Date()): Promise<number> {
  try {
    const deleted = await db
      .delete(revokedSessionsTable)
      .where(lt(revokedSessionsTable.expiresAt, now))
      .returning({ jti: revokedSessionsTable.jti });

    if (deleted.length > 0) {
      logger.info(
        { count: deleted.length, event: "revoked_sessions_pruned" },
        "Pruned revocations for tokens that have expired anyway",
      );
    }
    return deleted.length;
  } catch (err) {
    logger.error(
      { err, event: "revoked_session_prune_failed" },
      "Failed to prune revoked sessions",
    );
    return 0;
  }
}

let timer: NodeJS.Timeout | undefined;

/**
 * Start the periodic sweep. Idempotent — calling twice does not double up.
 *
 * The first sweep is deferred rather than run at boot: startup is when the
 * process is busiest and least able to absorb an extra query, and a table that
 * has grown for months can wait another six hours.
 */
export function startResetTokenCleanup(): void {
  if (timer) return;

  timer = setInterval(() => {
    void pruneResetTokens();
    void pruneDeletedAnalysisRows();
    void pruneRevokedSessions();
  }, SWEEP_INTERVAL_MS);

  // Do not hold the event loop open — this must never delay a shutdown or keep
  // a test runner alive.
  timer.unref?.();

  logger.info(
    { intervalHours: SWEEP_INTERVAL_MS / 3_600_000, event: "reset_token_cleanup_started" },
    "Password reset token cleanup scheduled",
  );
}

/** Test seam: stop the sweep. */
export function stopResetTokenCleanup(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
