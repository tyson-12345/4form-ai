import app from "./app";
import { logger } from "./lib/logger";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
