/**
 * Counters for conditions worth waking someone up about.
 *
 * ── What this is and is not ─────────────────────────────────────────────────
 * This is not a metrics system. It is a small in-process tally of the specific
 * failures that mean the app is lying to users or losing their work — the
 * things that would otherwise only be visible by grepping logs after a
 * complaint. `GET /api/health/metrics` exposes it for an uptime check to poll.
 *
 * Counters are per-process and reset on restart. That is a real limitation
 * with more than one instance: poll every instance, or ship these to a real
 * metrics backend. It is still far better than having no signal at all.
 *
 * Adapted from `lib/alerting.ts` in Oscar's fork, which had the better
 * instinct here — this codebase had no operational telemetry whatsoever.
 */

import { logger } from "./logger.js";

/** The conditions we count. Adding one here is the whole registration step. */
export const ALERT_EVENTS = [
  /** Scores were computed but the coaching write-up could not be generated. */
  "narrative_unavailable",
  /** An analysis failed outright and was marked failed. */
  "analysis_failed",
  /** The coach chat call failed after the user's message was already stored. */
  "chat_failed",
  /** The rate-limit backend was configured but unreachable — requests are 503ing. */
  "rate_limit_backend_failed",
  /** A login was refused because the account is locked out. */
  "account_locked",
  /** A request was rejected by the CORS allowlist. */
  "cors_rejected",
] as const;

export type AlertEvent = (typeof ALERT_EVENTS)[number];

/**
 * Thresholds above which a counter is reported as alerting.
 *
 * Deliberately conservative: these are counts since process start, so a
 * threshold that is too low will fire on a long-running healthy process. They
 * are a smoke signal for a polling check, not a paging rule.
 */
const THRESHOLDS: Record<AlertEvent, number> = {
  narrative_unavailable: 25,
  analysis_failed: 10,
  chat_failed: 20,
  rate_limit_backend_failed: 1,
  account_locked: 50,
  cors_rejected: 100,
};

const counters = new Map<AlertEvent, number>();
const startedAt = Date.now();

/**
 * Record one occurrence.
 *
 * Never throws and never blocks — an alerting path that can fail the request it
 * is observing is worse than no alerting.
 */
export function recordAlert(event: AlertEvent): void {
  try {
    const next = (counters.get(event) ?? 0) + 1;
    counters.set(event, next);

    // Log exactly once at the crossing, so the threshold shows up in the log
    // stream without every subsequent occurrence repeating it.
    if (next === THRESHOLDS[event]) {
      logger.error(
        { event: "alert_threshold_crossed", alert: event, count: next },
        `Alert threshold crossed for ${event}`,
      );
    }
  } catch {
    // Deliberately swallowed — see above.
  }
}

export interface AlertSnapshot {
  uptimeSec: number;
  counts: Record<string, number>;
  /** Events currently at or above their threshold. */
  alerting: string[];
}

export function alertSnapshot(): AlertSnapshot {
  const counts: Record<string, number> = {};
  const alerting: string[] = [];

  for (const event of ALERT_EVENTS) {
    const count = counters.get(event) ?? 0;
    counts[event] = count;
    if (count >= THRESHOLDS[event]) alerting.push(event);
  }

  return {
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    counts,
    alerting,
  };
}

/** Test seam: clear all counters between cases. */
export function __resetAlerts(): void {
  counters.clear();
}
