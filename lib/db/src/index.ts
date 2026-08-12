import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Postgres connection.
 *
 * Provider-agnostic on purpose: this is the standard `pg` driver over a plain
 * connection string, with no vendor SDK. Neon, Supabase, RDS, or a container all
 * work by changing `DATABASE_URL` alone — which is what made the move off Neon a
 * config change rather than a migration.
 *
 * ── TLS ─────────────────────────────────────────────────────────────────────
 * Managed Postgres requires TLS, and the database holds password hashes and
 * reset tokens, so this is not optional.
 *
 * The failure people hit here is `self-signed certificate in certificate chain`,
 * and the fix reached for is `rejectUnauthorized: false` — which disables
 * verification entirely and turns TLS into encryption without authentication.
 * That leaves the connection open to an active man-in-the-middle, which is the
 * threat TLS is for. We do not do that.
 *
 * Instead: verification stays on, and `DATABASE_CA_CERT` lets you supply the
 * provider's CA bundle (Supabase publishes one in Project Settings → Database →
 * SSL Configuration) when the system trust store doesn't already cover it.
 */
type SslConfig = boolean | { rejectUnauthorized: boolean; ca?: string };

function sslConfig(): SslConfig {
  const url = process.env.DATABASE_URL!;

  // A local database over a loopback address has no meaningful TLS story and
  // usually has no certificate at all.
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  if (isLocal && process.env.NODE_ENV !== "production") return false;

  const ca = process.env.DATABASE_CA_CERT;
  if (ca) {
    // Accept either the PEM itself (env vars can hold newlines awkwardly, so
    // `\n` escapes are unescaped) or a path to a file.
    return { rejectUnauthorized: true, ca: ca.replace(/\\n/g, "\n") };
  }

  return { rejectUnauthorized: true };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
  /**
   * Bounded so a burst of requests cannot exhaust the database's connection
   * limit. Supabase's pooler allows far more client connections than direct
   * Postgres does, but the ceiling still exists and hitting it fails every
   * query at once rather than queueing.
   */
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

/**
 * A pool error is emitted for idle clients dropped by the server — routine with
 * a connection pooler in front. Without a listener, Node treats it as an
 * unhandled `error` event and terminates the process.
 */
pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
