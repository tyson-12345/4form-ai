import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

/**
 * Read a CA bundle from disk, resolving `~` and relative paths.
 *
 * Fails loudly. A missing CA file must not silently fall back to the system
 * trust store — that would turn a configuration mistake into a connection that
 * looks fine and verifies against the wrong authority.
 */
function readCaFile(value: string): string {
  const resolved = value.startsWith("~")
    ? path.join(os.homedir(), value.slice(1))
    : path.resolve(value);

  if (!fs.existsSync(resolved)) {
    throw new Error(
      `DATABASE_CA_CERT points at "${resolved}", which does not exist. ` +
        "Give it the path to the certificate downloaded from your provider, " +
        "or paste the PEM contents directly.",
    );
  }

  const pem = fs.readFileSync(resolved, "utf8");
  if (!pem.includes("BEGIN CERTIFICATE")) {
    throw new Error(
      `The file at "${resolved}" is not a PEM certificate. ` +
        "Download the CA certificate again — a saved HTML error page is the usual cause.",
    );
  }
  return pem;
}

function sslConfig(): SslConfig {
  const url = process.env.DATABASE_URL!;

  // A local database over a loopback address has no meaningful TLS story and
  // usually has no certificate at all.
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  if (isLocal && process.env.NODE_ENV !== "production") return false;

  const ca = process.env.DATABASE_CA_CERT;
  if (ca) {
    // Accepts either form, because the two deployment targets want different
    // things: a downloaded `.crt` path is natural locally, while a hosting
    // platform's variable UI wants the PEM pasted inline.
    const pem = ca.includes("BEGIN CERTIFICATE")
      ? // Inline PEM. Some variable UIs collapse real newlines into `\n`
        // escapes, which produces a certificate OpenSSL cannot parse.
        ca.replace(/\\n/g, "\n")
      : readCaFile(ca);

    return { rejectUnauthorized: true, ca: pem };
  }

  return { rejectUnauthorized: true };
}

/**
 * Query parameters `pg` turns into a TLS configuration of its own.
 *
 * These matter because the driver does not merge them with the config above —
 * it replaces it. `pg/lib/connection-parameters.js` runs
 * `config = Object.assign({}, config, parse(config.connectionString))`, so the
 * connection string is applied *over* the explicit options, and then
 * `this.ssl = typeof config.ssl === 'undefined' ? … : config.ssl` takes
 * whatever came out. Measured against the installed pg 8.20.0 /
 * pg-connection-string 2.12.0, passing `ssl: { rejectUnauthorized: true, ca }`
 * explicitly and varying only the string:
 *
 *   (no parameter)       → { rejectUnauthorized: true, ca }   as written
 *   ?sslmode=no-verify   → { rejectUnauthorized: false }      verification gone
 *   ?sslmode=disable     → false                              TLS gone
 *   ?ssl=0               → false                              TLS gone
 *   ?ssl=true            → true                               the CA is gone
 *   ?sslmode=require     → {}                                 the CA is gone
 *   ?sslmode=verify-full → {}                                 the CA is gone
 *
 * The first three are the `rejectUnauthorized: false` the block above refuses
 * to write, reachable from a string an operator pastes out of a provider's
 * dashboard, with nothing logged and a connection that looks healthy.
 *
 * So the parameters are taken out of the string before `pg` is handed it, and
 * the explicit config becomes the only one there is. Stripping rather than
 * arguing about precedence is also what survives pg 9 / pg-connection-string 3,
 * which change what `prefer`, `require` and `verify-ca` mean.
 */
const SSL_URL_PARAMS = new Set([
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "uselibpqcompat",
]);

/**
 * The values that ask for no more than we already do, and can therefore be
 * dropped without argument.
 *
 * `verify-full` is what this module does. `require`, `verify-ca` and `prefer`
 * all ask for something weaker, so honouring our own config gives the operator
 * more than they asked for, never less — nothing is lost by ignoring them, and
 * a Supabase or Neon string that carries `?sslmode=require` keeps working.
 *
 * Everything else is refused rather than ignored: `disable` and `no-verify` are
 * a deliberate request to drop encryption or authentication, and answering that
 * by quietly doing the opposite would leave an operator debugging a TLS error
 * they thought they had turned off. `sslrootcert`, `sslcert`, `sslkey` and
 * `uselibpqcompat` are refused because they replace the trust anchor — which is
 * what DATABASE_CA_CERT is for, and which is the one thing that must not be
 * decided by a string.
 */
const REDUNDANT_SSL_VALUES: Record<string, ReadonlySet<string>> = {
  sslmode: new Set(["prefer", "require", "verify-ca", "verify-full"]),
  ssl: new Set(["1", "true"]),
};

function hardenConnectionString(raw: string, tlsRequired: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // `pg` parses with the same WHATWG parser, so a string this cannot read is
    // one the driver cannot read either — and it reports that better than a
    // guess here would. Nothing to strip, nothing to refuse.
    return raw;
  }

  const refused: string[] = [];

  // A snapshot of distinct names, because the loop deletes as it goes. `getAll`
  // rather than `get`: a repeated parameter (`?ssl=1&ssl=0`) must be judged on
  // every value it carries, not just the first one.
  for (const name of new Set(url.searchParams.keys())) {
    const key = name.toLowerCase();
    if (!SSL_URL_PARAMS.has(key)) continue;

    for (const value of url.searchParams.getAll(name)) {
      // On a loopback database in development `sslConfig()` has already chosen
      // no TLS, so there is no guarantee left for the string to weaken and
      // `sslmode=disable` simply agrees with us.
      if (tlsRequired && !REDUNDANT_SSL_VALUES[key]?.has(value.toLowerCase())) {
        refused.push(`${name}=${value}`);
      }
    }
    url.searchParams.delete(name);
  }

  if (refused.length > 0) {
    throw new Error(
      `DATABASE_URL carries ${refused.join(", ")}, which node-postgres applies *over* ` +
        "this module's TLS settings rather than alongside them — replacing " +
        "certificate verification, or TLS itself, with whatever the string says. " +
        "Refusing to start rather than honouring it. Remove the parameter; TLS is " +
        "already on and verified. If the connection then fails with " +
        '"self-signed certificate in certificate chain", supply the provider\'s CA ' +
        "bundle in DATABASE_CA_CERT — that is the supported way to fix it, and it " +
        "keeps the authentication that stops a man-in-the-middle.",
    );
  }

  // `toString()` leaves a bare "?" behind when the last parameter goes.
  return url.toString().replace(/\?$/, "");
}

const ssl = sslConfig();

export const pool = new Pool({
  connectionString: hardenConnectionString(process.env.DATABASE_URL!, ssl !== false),
  ssl,
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
