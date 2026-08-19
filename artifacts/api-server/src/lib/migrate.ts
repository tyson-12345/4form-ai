/**
 * Schema migrations, applied at boot.
 *
 * ── Why at boot ───────────────────────────────────────────────────────────────
 * Deploys here are a single `railway up`, and there is no release phase to hang
 * a migration step from. Before this existed, shipping a schema change meant
 * remembering to run psql by hand against production at the right moment, and
 * the failure mode when you forgot was new code writing a column the database
 * did not have. Running them here makes "deploy the code and the schema
 * together" the only thing that can happen.
 *
 * ── Guarantees ────────────────────────────────────────────────────────────────
 *  - **Ordered.** Files run in filename order, which is why they are numbered.
 *  - **Once.** Applied names are recorded in `schema_migrations` and skipped
 *    thereafter.
 *  - **Atomic per migration.** Each file runs inside a transaction together with
 *    the row that records it, so a failure can never leave a migration recorded
 *    but not applied, or vice versa.
 *  - **Single-flight.** A Postgres advisory lock serialises concurrent boots, so
 *    a rolling restart or a replica scale-up cannot run the same file twice.
 *  - **Loud.** A failure rejects, and the caller must abort the boot. A server
 *    that starts against a schema it does not understand is worse than one that
 *    refuses to start: it corrupts data instead of paging someone.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Migrations that must never be executed by this runner, only recorded.
 *
 * `0001` ends with a data statement, not just DDL:
 *
 *     UPDATE analyses SET analysis_method = 'legacy-unverified'
 *      WHERE pose_metrics IS NULL AND analysis_method = 'pose-measured';
 *
 * That was correct exactly once, against the rows that existed the day it ran.
 * Today an analysis is created with `analysis_method = 'pose-measured'` and a
 * null `pose_metrics`, and stays that way for the seconds between the upload
 * and the pipeline persisting measurements. Re-running the file would relabel
 * every in-flight analysis as a legacy unmeasured one, permanently, and the
 * app would then tell those athletes their scores were invented.
 *
 * Every other migration is pure `IF NOT EXISTS` DDL and is safe to re-run, so
 * this list should stay at one entry. If you write a migration containing
 * UPDATE, DELETE, or INSERT, either make it idempotent or add it here.
 */
const NEVER_EXECUTE = new Set(["0001_security_and_measured_analysis.sql"]);

/** Arbitrary but fixed: two boots must derive the same key to serialise. */
const ADVISORY_LOCK_KEY = 8_233_119_004;

/**
 * Locate `lib/db/migrations` by walking up from this module.
 *
 * A fixed number of `..` segments cannot work: this file runs from
 * `artifacts/api-server/dist/index.mjs` once bundled but from
 * `artifacts/api-server/src/lib/` under vitest, and those are different depths.
 * The first version hardcoded the bundled depth and silently pointed at a
 * non-existent `artifacts/lib/db/migrations` everywhere else.
 *
 * Walking up finds the workspace root from any of them, and keeps working if
 * the build layout moves. Deliberately not `process.cwd()`, which differs
 * between `railway up` (`/app`) and `pnpm start` (the package directory).
 */
function migrationsDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));

  for (;;) {
    const candidate = path.join(dir, "lib", "db", "migrations");
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached the filesystem root without finding them.
      throw new Error(
        "Could not locate lib/db/migrations by walking up from " +
          `"${path.dirname(fileURLToPath(import.meta.url))}". The build must ship lib/db/migrations.`,
      );
    }
    dir = parent;
  }
}

export interface MigrationResult {
  applied: string[];
  baselined: string[];
  skipped: number;
}

export async function runMigrations(): Promise<MigrationResult> {
  // Throws if the directory is absent. The container copies `lib/` wholesale, so
  // that would mean a packaging change dropped the SQL — and failing here is
  // right, because booting anyway defers the problem to the first query against
  // a column that does not exist.
  const dir = migrationsDir();

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    logger.warn({ dir, event: "migrations_empty" }, "No migration files found");
    return { applied: [], baselined: [], skipped: 0 };
  }

  const client = await pool.connect();
  const result: MigrationResult = { applied: [], baselined: [], skipped: 0 };

  try {
    // Serialise against other booting instances. Released implicitly when the
    // session ends, and explicitly in `finally` for the normal path.
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now(),
        baselined   boolean NOT NULL DEFAULT false
      )
    `);

    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const done = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) {
        result.skipped++;
        continue;
      }

      // Recorded without running. See NEVER_EXECUTE.
      if (NEVER_EXECUTE.has(file)) {
        await client.query(
          "INSERT INTO schema_migrations (name, baselined) VALUES ($1, true) ON CONFLICT DO NOTHING",
          [file],
        );
        result.baselined.push(file);
        logger.info({ migration: file, event: "migration_baselined" }, "Migration recorded, not run");
        continue;
      }

      const sql = fs.readFileSync(path.join(dir, file), "utf8");

      // Some files open their own transaction. Postgres treats a nested BEGIN
      // as a no-op with a warning, and the inner COMMIT would end the outer
      // block early, leaving the bookkeeping INSERT outside it. Stripping them
      // keeps one transaction per migration with the record inside it.
      const body = sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, "");

      try {
        await client.query("BEGIN");
        await client.query(body);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        result.applied.push(file);
        logger.info({ migration: file, event: "migration_applied" }, "Migration applied");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(
          `Migration "${file}" failed and was rolled back: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { cause: err },
        );
      }
    }

    return result;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    client.release();
  }
}
