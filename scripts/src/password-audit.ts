/**
 * Classification for the password-storage audit.
 *
 * Split out of `migrate-passwords.ts` so it can be tested without a database:
 * that module imports `@workspace/db`, which opens a connection pool at import
 * time. Everything here is pure.
 */

export type PasswordAlgo = "bcrypt" | "md5" | "sha1" | "sha256" | "plaintext";

/**
 * How a row stores a password.
 *
 * `none` is a **federated-only account** — signed in with Apple or Google, so
 * `users.password_hash` is NULL because there is no password. That is the
 * documented state of the column (see the `users` table comment), not a defect,
 * and it must never be reported as weak or written to `password_algo`.
 */
export type StorageClass = PasswordAlgo | "none";

/** Cost that a current bcrypt hash must meet. Mirrors `BCRYPT_ROUNDS` in api-server. */
export const BCRYPT_ROUNDS = 12;

/** The columns the audit reads. */
export interface AuditRow {
  id: string;
  passwordHash: string | null;
}

/** A row that should be tagged for login-time re-hashing. */
export interface Finding {
  id: string;
  detected: PasswordAlgo;
  reason: string;
}

export interface AuditResult {
  /** How many rows fell into each storage class. Classes with none are absent. */
  counts: Partial<Record<StorageClass, number>>;
  needsAttention: Finding[];
}

/**
 * Identify the storage format of a hash by shape.
 *
 * Takes a non-null string on purpose. A NULL `password_hash` must be handled by
 * the caller, not here: `RegExp.prototype.test` coerces its argument with
 * `String()`, so passing `null` would test the literal text `"null"`, match
 * nothing, and fall through to `"plaintext"` — reporting every federated-only
 * account as a plaintext password. `classify` is the null-safe entry point.
 */
export function detectAlgo(hash: string): PasswordAlgo {
  if (/^\$2[aby]\$\d{2}\$/.test(hash)) return "bcrypt";
  if (/^[a-f0-9]{32}$/i.test(hash)) return "md5";
  if (/^[a-f0-9]{40}$/i.test(hash)) return "sha1";
  if (/^[a-f0-9]{64}$/i.test(hash)) return "sha256";
  return "plaintext";
}

/** The cost factor baked into a bcrypt hash, or null if it is not bcrypt. */
export function bcryptCost(hash: string): number | null {
  const m = /^\$2[aby]\$(\d{2})\$/.exec(hash);
  return m ? Number(m[1]) : null;
}

/** Null-safe classification. NULL means "no password", not "plaintext password". */
export function classify(hash: string | null): StorageClass {
  return hash === null ? "none" : detectAlgo(hash);
}

/**
 * Count how every row stores its password and list the ones needing migration.
 *
 * Federated-only rows are counted under `none` and deliberately excluded from
 * `needsAttention`: they have nothing to re-hash, and tagging one would set
 * `password_algo = "plaintext"`, which sends its next login down
 * `verifyPassword`'s fast string-compare branch instead of bcrypt — a timing
 * side channel on exactly the accounts `attemptPasswordAuth` equalises.
 */
export function auditUsers(users: readonly AuditRow[]): AuditResult {
  const counts: Partial<Record<StorageClass, number>> = {};
  const needsAttention: Finding[] = [];

  for (const user of users) {
    const hash = user.passwordHash;

    // No password: nothing to migrate, nothing to tag. Checked before
    // `detectAlgo` so the null never reaches a regex, and so `hash` narrows to
    // string for the rest of the loop.
    if (hash === null) {
      counts.none = (counts.none ?? 0) + 1;
      continue;
    }

    const detected = detectAlgo(hash);
    counts[detected] = (counts[detected] ?? 0) + 1;

    if (detected !== "bcrypt") {
      needsAttention.push({
        id: user.id,
        detected,
        reason: `stored as ${detected} — will be re-hashed on next successful login`,
      });
      continue;
    }

    const cost = bcryptCost(hash);
    if (cost !== null && cost < BCRYPT_ROUNDS) {
      needsAttention.push({
        id: user.id,
        detected,
        reason: `bcrypt cost ${cost} is below the current ${BCRYPT_ROUNDS} — will be re-hashed on next successful login`,
      });
    }
  }

  return { counts, needsAttention };
}
