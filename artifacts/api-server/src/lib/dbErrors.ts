/**
 * Normalising database errors so their bind values never leave the process.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * drizzle-orm raises `DrizzleQueryError`, and that error does not merely
 * *carry* the failing statement — it interpolates the SQL and every bind value
 * into its own `message`, which means they are also in `stack`. Bind values are
 * user data by definition: on a signup collision that is an email address and a
 * bcrypt hash; on a profile write it is free-text injury notes; on the age gate
 * it is a date of birth.
 *
 * `logger.ts` redacts `err.query` and `err.params`, which handles the structured
 * fields. It cannot help with `message`: pino always emits it, and a redact path
 * cannot reach inside a string. Sentry has the same problem for the same reason,
 * and Sentry sends it off-box.
 *
 * `repositories/waitlistRepository.ts` solved this locally by throwing a
 * replacement error. That is the right shape, but one repository doing it is
 * one query out of dozens. This is the same fix applied at the boundary, so it
 * covers every query in the app including ones not written yet.
 *
 * ── What survives ───────────────────────────────────────────────────────────
 * The SQLSTATE code, which is what you actually debug from ("23505" is a unique
 * violation), and the constraint name, which says *which* uniqueness. Neither
 * is user data. The statement text and the values are dropped.
 */

/** Postgres attaches these to the driver error; none of them are user data. */
interface PgErrorFields {
  code?: string;
  constraint?: string;
  table?: string;
  schema?: string;
}

/**
 * True for drizzle's query wrapper.
 *
 * Matched on the constructor name rather than with `instanceof` so this module
 * does not import drizzle, and so it keeps working across the minor version
 * bumps that have already moved this class once.
 */
export function isDrizzleQueryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.constructor?.name === "DrizzleQueryError" || error.name === "DrizzleQueryError")
  );
}

/**
 * Replace a `DrizzleQueryError` with an equivalent that carries no SQL and no
 * bind values. Any other value is returned unchanged.
 *
 * A new Error is built rather than mutating the original: `message` and `stack`
 * are both derived from the interpolated text, and clearing them in place would
 * still leave the original object reachable from `cause`.
 */
export function stripBoundValues(error: unknown): unknown {
  if (!isDrizzleQueryError(error)) return error;

  const cause = (error as { cause?: unknown }).cause as PgErrorFields | undefined;
  const parts = [
    cause?.code && `code ${cause.code}`,
    cause?.constraint && `constraint ${cause.constraint}`,
    cause?.table && `table ${cause.table}`,
  ].filter(Boolean);

  const stripped = new Error(
    parts.length > 0 ? `Database query failed (${parts.join(", ")})` : "Database query failed",
  ) as Error & PgErrorFields;

  stripped.name = "DatabaseError";
  if (cause?.code) stripped.code = cause.code;
  if (cause?.constraint) stripped.constraint = cause.constraint;
  if (cause?.table) stripped.table = cause.table;
  // Deliberately no `stack` from the original — it contains the same
  // interpolated statement as `message`.
  stripped.stack = `${stripped.name}: ${stripped.message}`;

  return stripped;
}
