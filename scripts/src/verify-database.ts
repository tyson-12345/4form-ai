/**
 * Confirm the configured database is real, reachable, and correctly shaped.
 *
 * Written for the Neon → Supabase cutover: run it after `drizzle-kit push` and
 * before deleting anything. It answers the question you actually care about —
 * "is the new database genuinely ready?" — rather than "did a command exit 0".
 *
 * Reads DATABASE_URL from artifacts/api-server/.env. Read-only: it creates
 * nothing, changes nothing, and deletes nothing.
 *
 *   pnpm --filter @workspace/scripts run verify-database
 */

// Load the API server's .env before importing @workspace/db, which reads
// DATABASE_URL at module scope and throws if it is missing. Node 22's built-in
// loader is used rather than dotenv so this needs no extra dependency, and it
// keeps the connection string out of your shell history.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, "../../artifacts/api-server/.env"));
} catch {
  // Already set in the environment, or no .env file — the check below reports it.
}

const { sql } = await import("drizzle-orm");
const { db, pool } = await import("@workspace/db");

/** Tables the app cannot run without. */
const REQUIRED_TABLES = [
  "users",
  "athlete_profiles",
  "analyses",
  "coaching_tips",
  "injury_risks",
  "subscriptions",
  "chat_messages",
  "password_reset_tokens",
  "achievements",
  "user_achievements",
  "progress_entries",
] as const;

/**
 * Columns added by migrations 0003 and 0004. These are the ones most likely to
 * be missing, because they are newer than most people's mental model of the
 * schema — and their absence is not subtle: signup fails outright without
 * `birth_date`, and every session becomes unrevokable without
 * `sessions_valid_after`.
 */
const REQUIRED_COLUMNS: Array<[string, string, string]> = [
  ["users", "birth_date", "signup fails outright without it (migration 0004)"],
  ["users", "sessions_valid_after", "password reset cannot revoke sessions (migration 0003)"],
  ["users", "password_algo", "legacy hash migration (0001)"],
  ["users", "failed_login_attempts", "account lockout (0001)"],
  ["users", "locked_until", "account lockout (0001)"],
];

let failures = 0;

function pass(msg: string): void {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): void {
  console.log(`  ✗ ${msg}`);
  failures++;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  // Host only — never print the password.
  const host = url.replace(/^.*@/, "").replace(/\/.*$/, "") || "(unparseable)";

  console.log("Database verification");
  console.log("─────────────────────");
  console.log(`Host: ${host}`);
  if (/supabase/i.test(host)) console.log("Provider: Supabase");
  else if (/neon/i.test(host)) console.log("Provider: Neon  ← still pointing at the OLD database");
  console.log("");

  // ── Preflight: is the string even shaped right? ───────────────────────────
  //
  // Checked before connecting, because the driver's errors for a malformed URL
  // are cryptic ("SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a
  // string") and send people looking in the wrong place. Every problem below is
  // one people actually hit copying from the Supabase dashboard.
  console.log("Connection string");
  let preflightFailed = false;

  if (!url) {
    fail("DATABASE_URL is not set in artifacts/api-server/.env");
    preflightFailed = true;
  } else {
    if (!/^postgresql:\/\//.test(url)) {
      fail(`does not start with postgresql:// — got "${url.slice(0, 12)}…"`);
      preflightFailed = true;
    }
    // The dashboard ships literal placeholders. Leaving the brackets in is the
    // single most common copy-paste mistake.
    if (/\[|\]/.test(url)) {
      fail("still contains [SQUARE BRACKETS] — replace the placeholder AND remove the brackets");
      preflightFailed = true;
    }
    if (/YOUR-PASSWORD|your-password/i.test(url)) {
      fail("still contains the literal text YOUR-PASSWORD — paste your real password there");
      preflightFailed = true;
    }
    if (/\s/.test(url)) {
      fail("contains a space or line break — it was probably wrapped when copied");
      preflightFailed = true;
    }
    if (/:6543\//.test(url)) {
      fail(
        "uses port 6543 (transaction pooler). Use the SESSION pooler on 5432 — " +
          "transaction mode has no prepared statements or session state and will " +
          "break this long-running server",
      );
      preflightFailed = true;
    }
    // A password with @ : / ? # & in it must be percent-encoded or it splits
    // the URL in the wrong place. Detect the symptom: more than one @.
    if ((url.match(/@/g) ?? []).length > 1) {
      fail(
        "has more than one @ — your password probably contains a special character. " +
          "Percent-encode it (@ becomes %40, : becomes %3A, / becomes %2F, # becomes %23), " +
          "or reset the password in Supabase to one without symbols",
      );
      preflightFailed = true;
    }
    if (!preflightFailed) pass("format looks correct");
  }

  if (preflightFailed) {
    console.log("");
    console.log("Fix the connection string before anything else — nothing below can run.");
    process.exitCode = 1;
    return;
  }
  console.log("");

  // ── Connectivity ──────────────────────────────────────────────────────────
  console.log("Connection");
  const [{ version }] = await db.execute<{ version: string }>(sql`select version()`).then(
    (r) => r.rows as { version: string }[],
  );
  pass(`connected — ${version.split(",")[0]}`);

  // TLS is reported, not asserted.
  //
  // `pg_stat_ssl` describes the connection *the Postgres backend sees*. Both
  // Neon and Supabase put a proxy or pooler in front, which terminates TLS and
  // then talks to Postgres over the internal network — so this reads `false`
  // on a connection that is genuinely encrypted end to end from here.
  //
  // Treating that as a failure would make this script cry wolf on every
  // correctly-configured managed database, and a check that always fails is a
  // check people learn to ignore. The real guarantee is in the driver: the pool
  // sets `rejectUnauthorized: true` unless the host is loopback (see
  // lib/db/src/index.ts), so a connection to a remote host either negotiates
  // verified TLS or does not connect at all.
  const [{ ssl }] = await db
    .execute<{ ssl: boolean }>(
      sql`select coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as ssl`,
    )
    .then((r) => r.rows as { ssl: boolean }[]);

  const remote = !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  if (ssl) {
    pass("connection is encrypted end to end (TLS to Postgres itself)");
  } else if (remote) {
    pass("connected to a remote host — the driver requires verified TLS to do so");
    console.log("    (pg_stat_ssl reads false because a pooler terminates TLS in front");
    console.log("     of Postgres; that is expected on both Neon and Supabase)");
  } else {
    console.log("  ⚠ local connection, TLS not in use — fine for development only");
  }
  console.log("");

  // ── Schema ────────────────────────────────────────────────────────────────
  console.log("Tables");
  const tables = await db
    .execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )
    .then((r) => (r.rows as { table_name: string }[]).map((x) => x.table_name));

  for (const t of REQUIRED_TABLES) {
    if (tables.includes(t)) pass(t);
    else fail(`${t} — MISSING. Run: pnpm --filter @workspace/db run push`);
  }
  console.log("");

  console.log("Columns added by later migrations");
  for (const [table, column, why] of REQUIRED_COLUMNS) {
    const found = await db
      .execute(
        sql`select 1 from information_schema.columns
            where table_schema='public' and table_name=${table} and column_name=${column}`,
      )
      .then((r) => r.rows.length > 0);
    if (found) pass(`${table}.${column}`);
    else fail(`${table}.${column} — MISSING: ${why}`);
  }
  console.log("");

  // ── Indexes ───────────────────────────────────────────────────────────────
  console.log("Read-path indexes (migration 0002)");
  const indexes = await db
    .execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public'`,
    )
    .then((r) => (r.rows as { indexname: string }[]).map((x) => x.indexname));

  const wanted = ["analyses_user_uploaded_idx", "analyses_user_status_idx"];
  const missing = wanted.filter((i) => !indexes.includes(i));
  if (missing.length === 0) {
    pass(`all present (${indexes.length} indexes total)`);
  } else {
    console.log(`  ⚠ missing: ${missing.join(", ")}`);
    console.log("    Not fatal — the app works, but the monthly quota count that runs");
    console.log("    before every upload will do a sequential scan.");
    console.log("    Fix: paste lib/db/migrations/0002_read_path_indexes.sql into the SQL editor.");
  }
  console.log("");

  // ── Row counts ────────────────────────────────────────────────────────────
  console.log("Contents");
  const [{ count: userCount }] = await db
    .execute<{ count: number }>(sql`select count(*)::int as count from users`)
    .then((r) => r.rows as { count: number }[]);
  console.log(`  users: ${userCount}`);
  if (userCount === 0) {
    console.log("    (expected for a fresh database — sign up once to smoke-test the write path)");
  }
  console.log("");

  // ── Verdict ───────────────────────────────────────────────────────────────
  if (failures === 0) {
    console.log("READY. Safe to point the app at this database.");
    if (/neon/i.test(host)) {
      console.log("");
      console.log("NOTE: this is still the Neon database. Update DATABASE_URL before");
      console.log("deleting anything.");
    }
  } else {
    console.log(`NOT READY — ${failures} problem(s) above.`);
    console.log("Do NOT delete the old database until this reports READY.");
    process.exitCode = 1;
  }
}

/**
 * Unwrap the driver's error chain.
 *
 * Drizzle reports "Failed query: select version()" and puts the actual cause on
 * `.cause`. Printing only the wrapper hides the one piece of information that
 * identifies the problem — a wrong password and an untrusted certificate look
 * identical without it.
 */
function rootCause(err: unknown): { code: string; message: string } {
  let current = err;
  let best = { code: "", message: err instanceof Error ? err.message : String(err) };

  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    const code = (current as { code?: string }).code;
    if (code) best = { code, message: current.message };
    current = (current as { cause?: unknown }).cause;
  }
  return best;
}

/** Map the errors we can recognise onto the actual fix. */
function explain(code: string, message: string): string[] {
  if (code === "SELF_SIGNED_CERT_IN_CHAIN" || /self-signed certificate/i.test(message)) {
    return [
      "The database's certificate is signed by a private CA that this machine does not trust.",
      "Supabase uses its own CA, so this is expected until you supply it.",
      "",
      "  1. Supabase → Project Settings → Database → SSL Configuration",
      "  2. Download the certificate (prod-ca-*.crt)",
      "  3. Add its path to artifacts/api-server/.env:",
      "",
      "       DATABASE_CA_CERT=/Users/you/Downloads/prod-ca-2021.crt",
      "",
      "Do NOT 'fix' this by disabling certificate verification. That keeps the",
      "encryption and throws away the authentication — which is the half that",
      "stops someone impersonating your database.",
    ];
  }
  if (code === "28P01" || /password authentication failed/i.test(message)) {
    return [
      "The password was rejected.",
      "  • Check you replaced [YOUR-PASSWORD] with the real one",
      "  • If it contains symbols, percent-encode them (@ = %40, : = %3A)",
      "  • Or reset it: Supabase → Settings → Database → Reset database password",
    ];
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return ["The hostname did not resolve. Check it was copied in full."];
  }
  if (code === "ETIMEDOUT" || code === "ECONNREFUSED") {
    return [
      "Could not reach the host.",
      "  • Confirm the project is not paused (free projects sleep when idle)",
      "  • Confirm you used the session pooler on :5432",
    ];
  }
  if (/Tenant or user not found/i.test(message)) {
    return [
      "The pooler did not recognise the username.",
      "The session pooler needs the 'postgres.<project-ref>' form, not plain 'postgres'.",
      "Re-copy the string from Supabase → Connect → Session pooler.",
    ];
  }
  return [
    "Unrecognised error. Common causes:",
    "  • wrong password, or a truncated connection string",
    "  • transaction pooler (:6543) instead of session pooler (:5432)",
    "  • project paused",
  ];
}

main()
  .catch((err: unknown) => {
    const { code, message } = rootCause(err);
    console.error("");
    console.error(`Could not connect${code ? ` [${code}]` : ""}: ${message}`);
    console.error("");
    for (const line of explain(code, message)) console.error(line);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
