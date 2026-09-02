/**
 * The landing page's waitlist.
 *
 * One row per address, one write path, no reads from the API — the list is read
 * once, by a person, when the build opens. See `analysisRepository.ts` for the
 * ownership rule the other repositories follow; a waitlist row is not
 * user-owned, so it is deliberately exempt.
 */

import { db } from "@workspace/db";
import { waitlistSignupsTable } from "@workspace/db";

/**
 * Drizzle wraps every driver failure in a `DrizzleQueryError`, whose message is
 * `Failed query: <sql>\nparams: <params>` and which also carries `query` and
 * `params` as own enumerable properties. pino's default error serializer emits
 * all of them, and a 500 additionally sends the exception to Sentry — so a
 * dropped connection while an address was in flight would put that address in
 * the logs and in a third-party service, which is exactly what the route
 * promises does not happen.
 *
 * Redaction cannot fix this: `params` is a path pino can censor, but the values
 * are also inside `message` and `stack` as text, and no path matches a
 * substring. The error has to be replaced, not filtered — which is what this
 * does. The SQLSTATE is carried across because that is the whole operational
 * signal (`57P01` admin shutdown, `53300` too many connections, `08006`
 * connection failure); nothing else from the original survives.
 */
function withoutBoundValues(error: unknown): Error {
  const cause = (error as { cause?: unknown })?.cause;
  const code = (cause as { code?: unknown })?.code;
  const stripped = new Error("waitlist insert failed") as Error & { code?: string };
  if (typeof code === "string") stripped.code = code;
  return stripped;
}

/**
 * Record an address, or do nothing if it is already there.
 *
 * `onConflictDoNothing` rather than a read-then-write: two submissions racing
 * would both see an empty table and both insert, and the unique index would
 * then turn the loser into a 500. Letting Postgres decide makes a re-submission
 * indistinguishable from a first one, which is also what the caller wants to
 * tell the person on the other end.
 *
 * @param email must already be normalized (`safeEmail` / `normalizeEmail`) —
 *   the uniqueness of this column is a plain byte comparison, so a caller that
 *   skips normalisation silently creates a second row for the same person.
 * @returns true if this call created the row, false if the address was already
 *   on the list. Nothing user-facing should branch on it; it exists so the
 *   server can count real sign-ups in its logs.
 */
export async function addToWaitlist(email: string): Promise<boolean> {
  try {
    const inserted = await db
      .insert(waitlistSignupsTable)
      .values({ email })
      .onConflictDoNothing({ target: waitlistSignupsTable.email })
      .returning({ id: waitlistSignupsTable.id });

    return inserted.length > 0;
  } catch (error) {
    // Never let the address travel with the failure. See above.
    throw withoutBoundValues(error);
  }
}
