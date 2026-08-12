/**
 * Manually prune spent password-reset tokens.
 *
 * The API server does this on a 6-hour timer (see
 * `api-server/src/lib/tokenCleanup.ts`), so this script is for the cases the
 * timer does not cover:
 *
 *  - clearing a backlog that built up before the timer existed
 *  - running from an external scheduler if the API is ever scaled to zero
 *  - checking what would be deleted, without deleting it
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run prune-reset-tokens          # dry run
 *   pnpm --filter @workspace/scripts run prune-reset-tokens -- --apply
 */

import { and, isNotNull, isNull, lt, or, gte, sql } from "drizzle-orm";
import { db, passwordResetTokensTable } from "@workspace/db";

const GRACE_MS = 24 * 60 * 60 * 1000;
const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - GRACE_MS);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      live: sql<number>`count(*) filter (
        where ${passwordResetTokensTable.usedAt} is null
          and ${passwordResetTokensTable.expiresAt} >= ${now}
      )::int`,
      prunable: sql<number>`count(*) filter (
        where ${passwordResetTokensTable.expiresAt} < ${cutoff}
           or (${passwordResetTokensTable.usedAt} is not null
               and ${passwordResetTokensTable.usedAt} < ${cutoff})
      )::int`,
    })
    .from(passwordResetTokensTable);

  console.log("Password reset token audit");
  console.log("──────────────────────────");
  console.log(`Total rows:        ${counts?.total ?? 0}`);
  console.log(`Live (usable):     ${counts?.live ?? 0}`);
  console.log(`Prunable:          ${counts?.prunable ?? 0}`);
  console.log("");
  console.log(`Grace period: ${GRACE_MS / 3_600_000}h after expiry or use.`);
  console.log("");

  if ((counts?.prunable ?? 0) === 0) {
    console.log("Nothing to prune.");
    return;
  }

  if (!apply) {
    console.log("Dry run. Re-run with --apply to delete the prunable rows.");
    return;
  }

  const deleted = await db
    .delete(passwordResetTokensTable)
    .where(
      or(
        lt(passwordResetTokensTable.expiresAt, cutoff),
        and(
          isNotNull(passwordResetTokensTable.usedAt),
          lt(passwordResetTokensTable.usedAt, cutoff),
        ),
      ),
    )
    .returning({ id: passwordResetTokensTable.id });

  console.log(`Deleted ${deleted.length} row(s).`);

  // Belt-and-braces: confirm nothing usable was removed. A bug in the predicate
  // here would silently invalidate live reset links, which strands exactly the
  // users who are already locked out.
  const [after] = await db
    .select({
      live: sql<number>`count(*)::int`,
    })
    .from(passwordResetTokensTable)
    .where(
      and(
        isNull(passwordResetTokensTable.usedAt),
        gte(passwordResetTokensTable.expiresAt, now),
      ),
    );

  console.log(`Live tokens remaining: ${after?.live ?? 0} (was ${counts?.live ?? 0})`);
  if ((after?.live ?? 0) !== (counts?.live ?? 0)) {
    console.error("WARNING: the live token count changed. Investigate before re-running.");
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err: unknown) => {
    console.error("Prune failed:", err instanceof Error ? err.message : "unknown error");
    process.exit(1);
  });
