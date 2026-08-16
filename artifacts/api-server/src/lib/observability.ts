/**
 * Error reporting.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Until now there was no crash reporting anywhere. A 500 in production was
 * visible only if someone happened to be reading the log stream at the time, and
 * a crash-loop was visible only as "the app is down". The `/health/metrics`
 * counters cover the specific failures we predicted; this covers the ones we
 * did not.
 *
 * ── Inert without a DSN ─────────────────────────────────────────────────────
 * Everything here is a no-op unless `SENTRY_DSN` is set, so this can ship and
 * sit dormant until someone creates a project. No account is needed to land it,
 * nothing breaks locally, and tests do not need a network.
 *
 * ── What must never reach Sentry ────────────────────────────────────────────
 * Error reports leave our infrastructure, so they are held to the same rule as
 * logs: no passwords, no reset tokens, no bearer tokens, no email addresses.
 * `beforeSend` below strips them rather than relying on every future call site
 * to remember — the one place this can be enforced is the place it leaves from.
 */

import * as Sentry from "@sentry/node";
import { logger } from "./logger.js";

export function sentryEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

/** Keys whose values are never worth the risk of sending off-box. */
const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|email/i;

/** Recursively redact sensitive keys. Depth-bounded against hostile nesting. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export function initObservability(): void {
  if (!sentryEnabled()) {
    logger.info(
      { event: "sentry_disabled" },
      "SENTRY_DSN not set; error reporting is off",
    );
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.RAILWAY_GIT_COMMIT_SHA ?? undefined,

    // Sampled, not exhaustive: performance data is nice to have and we would
    // rather spend the quota on errors.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),

    // Sentry's default PII collection is off; this makes it explicit rather
    // than dependent on a default that could change.
    sendDefaultPii: false,

    beforeSend(event) {
      // Request bodies carry passwords and reset tokens. We never want them,
      // and the redaction below would only mask the keys it recognises.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          event.request.headers = redact(event.request.headers) as Record<string, string>;
        }
        // Query strings should never hold anything sensitive, but the reset
        // link puts a token in one, so the whole string goes.
        delete event.request.query_string;
      }

      if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
      if (event.contexts) event.contexts = redact(event.contexts) as typeof event.contexts;

      // A user id is useful for correlating reports and is not itself PII in
      // our schema (a random uuid). Email and IP are.
      if (event.user) {
        event.user = { id: event.user.id };
      }

      return event;
    },
  });

  logger.info(
    { environment: process.env.NODE_ENV, event: "sentry_enabled" },
    "Error reporting initialised",
  );
}

/**
 * Report an exception.
 *
 * Safe to call unconditionally — a no-op when Sentry is not configured, so call
 * sites do not need to branch. `context` is redacted before it is sent.
 */
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  if (!sentryEnabled()) return;
  Sentry.captureException(err, context ? { extra: redact(context) as Record<string, unknown> } : undefined);
}

/** Associate the current scope with a user id. Never pass an email. */
export function setReportingUser(userId: string | undefined): void {
  if (!sentryEnabled()) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Test seam. */
export const __redactForTest = redact;
