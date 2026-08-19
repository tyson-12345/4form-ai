/**
 * The boot-time migration runner.
 *
 * This code decides whether the API serves at all, and it is the only thing
 * that writes to production's schema. The properties below are the ones whose
 * violation would either take the service down or corrupt data, so they are
 * pinned here rather than trusted to review.
 *
 * The pg client is faked: the point is the runner's control flow (order, once,
 * atomicity, the baseline carve-out), not Postgres's own behaviour.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Queries the fake client has seen, in order. */
let issued: string[] = [];
/** Rows `SELECT name FROM schema_migrations` should return. */
let alreadyApplied: string[] = [];
/** Substring of a query that should throw, to simulate a bad migration. */
let failOn: string | null = null;

const client = {
  query: vi.fn(async (sql: string, _params?: unknown[]) => {
    issued.push(sql.trim());
    if (failOn && sql.includes(failOn)) throw new Error("syntax error at or near boom");
    if (sql.includes("SELECT name FROM schema_migrations")) {
      return { rows: alreadyApplied.map((name) => ({ name })) };
    }
    return { rows: [] };
  }),
  release: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  pool: { connect: async () => client },
}));

const { runMigrations } = await import("../src/lib/migrate.js");

/** Names of migration files actually executed, in order. */
const executedFiles = () =>
  issued.filter((q) => q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX") || q.startsWith("CREATE TABLE IF NOT EXISTS password_reset_tokens"));

beforeEach(() => {
  issued = [];
  alreadyApplied = [];
  failOn = null;
  client.query.mockClear();
  client.release.mockClear();
});

describe("runMigrations", () => {
  it("takes an advisory lock before touching the schema and releases it after", async () => {
    await runMigrations();
    const lockAt = issued.findIndex((q) => q.includes("pg_advisory_lock"));
    const firstWrite = issued.findIndex((q) => q.includes("CREATE TABLE IF NOT EXISTS schema_migrations"));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBeLessThan(firstWrite);
    expect(issued.some((q) => q.includes("pg_advisory_unlock"))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it("records 0001 without executing it", async () => {
    // 0001 ends in an UPDATE that would relabel in-flight analyses as legacy
    // unmeasured ones. It must be recorded, never re-run.
    const out = await runMigrations();
    expect(out.baselined).toContain("0001_security_and_measured_analysis.sql");
    expect(out.applied).not.toContain("0001_security_and_measured_analysis.sql");
    expect(issued.some((q) => q.includes("legacy-unverified"))).toBe(false);
  });

  it("applies the sport_mismatch migration", async () => {
    const out = await runMigrations();
    expect(out.applied).toContain("0007_sport_mismatch.sql");
    expect(issued.some((q) => q.includes("sport_mismatch"))).toBe(true);
  });

  it("runs migrations in filename order", async () => {
    const out = await runMigrations();
    expect(out.applied).toEqual([...out.applied].sort());
  });

  it("skips anything already recorded", async () => {
    alreadyApplied = ["0005_analysis_soft_delete.sql", "0007_sport_mismatch.sql"];
    const out = await runMigrations();
    expect(out.applied).not.toContain("0007_sport_mismatch.sql");
    expect(out.skipped).toBe(2);
    expect(issued.some((q) => q.includes("sport_mismatch"))).toBe(false);
  });

  it("wraps each migration and its bookkeeping in one transaction", async () => {
    await runMigrations();
    const begins = issued.filter((q) => q === "BEGIN").length;
    const commits = issued.filter((q) => q === "COMMIT").length;
    expect(begins).toBeGreaterThan(0);
    expect(begins).toBe(commits);
  });

  it("strips a migration's own BEGIN/COMMIT so the record stays inside the transaction", async () => {
    // 0002 opens its own transaction. Left in place, its COMMIT would close the
    // block before the schema_migrations INSERT, so a later crash could leave
    // the change applied but unrecorded, and it would run again next boot.
    await runMigrations();
    const withIndexes = issued.find((q) => q.includes("analyses_user_status_idx"));
    expect(withIndexes).toBeDefined();
    expect(withIndexes).not.toMatch(/^\s*BEGIN/im);
    expect(withIndexes).not.toMatch(/^\s*COMMIT/im);
  });

  it("rolls back and rejects when a migration fails", async () => {
    failOn = "sport_mismatch";
    await expect(runMigrations()).rejects.toThrow(/0007_sport_mismatch\.sql.*rolled back/s);
    expect(issued).toContain("ROLLBACK");
  });

  it("releases the connection even when a migration fails", async () => {
    failOn = "sport_mismatch";
    await runMigrations().catch(() => {});
    expect(issued.some((q) => q.includes("pg_advisory_unlock"))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });
});
