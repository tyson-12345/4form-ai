// Must be first: Sentry instruments modules as they load, so anything imported
// before init is not covered.
import { initObservability, reportError } from "./lib/observability";

initObservability();

import app from "./app";
import { logger } from "./lib/logger";
import { warnOnPartialMailConfig } from "./lib/mailer";
import { startResetTokenCleanup } from "./lib/tokenCleanup";
import { runMigrations } from "./lib/migrate";

// ── Environment validation ────────────────────────────────────────────────────
// Without these the server cannot serve a single authenticated request, so
// failing at boot is better than failing per-request in production.
const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Required environment variable "${key}" is missing. Check your .env file.`);
  }
}

/**
 * Claude is required in production but optional locally.
 *
 * Scoring is computed from measured joint angles and does not involve Claude at
 * all — only the written coaching narrative and the chat do. Refusing to boot
 * without a key meant a developer couldn't run the app to test signup, upload,
 * measurement, or scoring. Those degrade cleanly instead (see routes/analyses.ts).
 */
if (!process.env["ANTHROPIC_API_KEY"]) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      'Required environment variable "ANTHROPIC_API_KEY" is missing. Check your .env file.',
    );
  }
  logger.warn(
    "ANTHROPIC_API_KEY is not set. Analyses will still be measured and scored, " +
      "but coaching write-ups and AI Coach chat are disabled.",
  );
}

// Mail is not required to boot — the app degrades to "reset link never arrives"
// rather than refusing to start — but a half-configured provider is a typo, not
// a decision, so it is surfaced loudly at startup.
warnOnPartialMailConfig();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Bring the schema up to date, then serve.
 *
 * Ordered deliberately: this process is the only thing that applies migrations,
 * so it must finish before the first request can arrive. A failure here aborts
 * the boot rather than degrading, because the alternative is serving writes
 * against a schema this build does not agree with. Railway's restart policy
 * retries, and a deploy that never becomes healthy is a visible failure — which
 * is the correct outcome for a migration that cannot be applied.
 */
async function start(): Promise<void> {
  const { applied, baselined, skipped } = await runMigrations();
  logger.info(
    { applied: applied.length, baselined: baselined.length, skipped, event: "migrations_ready" },
    applied.length > 0
      ? `Applied ${applied.length} migration(s): ${applied.join(", ")}`
      : "Schema already up to date",
  );

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    // Spent reset tokens are deleted on a timer rather than accumulating forever.
    // Started after listen so a database hiccup here can never stop the server
    // coming up.
    startResetTokenCleanup();
  });
}

start().catch((err) => {
  logger.fatal({ err, event: "boot_failed" }, "Startup failed; not serving");
  reportError(err, { kind: "bootFailure" });
  setTimeout(() => process.exit(1), 2000).unref();
});

// ── Last-resort handlers ──────────────────────────────────────────────────────
// Without these, an unhandled rejection or an uncaught exception outside a
// request produces a process that either dies silently or keeps running in an
// unknown state. Report first, then let the platform restart us — Railway's
// restart policy is a better recovery than continuing on a corrupted state.

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason, event: "unhandled_rejection" }, "Unhandled promise rejection");
  reportError(reason, { kind: "unhandledRejection" });
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err, event: "uncaught_exception" }, "Uncaught exception; exiting");
  reportError(err, { kind: "uncaughtException" });
  // Give the reporter a moment to flush, then exit non-zero so the platform
  // restarts rather than leaving a half-dead process serving requests.
  setTimeout(() => process.exit(1), 2000).unref();
});
