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
  /**
   * A transactional email failed to send. Worth watching closely: silent mail
   * failure is indistinguishable from "no mail provider" to the user, and it
   * strands anyone who has forgotten their password.
   */
  "email_delivery_failed",
] as const;

export type AlertEvent = (typeof ALERT_EVENTS)[number];

/**
 * Thresholds above which a counter is reported as alerting.
 *
 * These are counts within `ALERT_WINDOW_MS`, not since process start, so a
 * threshold is a rate rather than a lifetime total. They are a smoke signal for
 * a polling check, not a paging rule.
 */
const THRESHOLDS: Record<AlertEvent, number> = {
  narrative_unavailable: 25,
  analysis_failed: 10,
  chat_failed: 20,
  rate_limit_backend_failed: 1,
  account_locked: 50,
  cors_rejected: 100,
  // Low on purpose. A handful of bounces is normal; five hard failures means
  // the provider, the domain authentication, or the key is broken.
  email_delivery_failed: 5,
};

/**
 * How far back a threshold looks.
 *
 * ── Why the counters are windowed and not cumulative ────────────────────────
 * They used to be totals since process start, with no decay and no reset outside
 * tests. A threshold crossed once stayed crossed for the life of the process, so
 * `GET /api/health/metrics` reported "degraded" forever and the uptime check
 * that polls it became noise the moment anything ever went briefly wrong.
 *
 * `cors_rejected` made that trivially reachable by an outsider: a rejected
 * origin is refused *before* any rate limiter, so a hundred requests carrying
 * `Origin: https://evil.example` — costing nothing, needing no account — pinned
 * the endpoint to degraded permanently.
 *
 * An hour is long enough that a real, sustained fault still crosses, and short
 * enough that a one-off burst ages out.
 */
export const ALERT_WINDOW_MS = 60 * 60 * 1000;

interface Counter {
  /** Occurrences inside the current window. */
  windowCount: number;
  /** When the current window began. */
  windowStart: number;
  /** Occurrences since process start. Reported, never compared to a threshold. */
  total: number;
  /** Whether the crossing has been logged for the current window. */
  logged: boolean;
}

const counters = new Map<AlertEvent, Counter>();
const startedAt = Date.now();

/** Read a counter, rotating the window first if it has expired. */
function current(event: AlertEvent, now: number): Counter {
  const existing = counters.get(event);
  if (!existing) {
    const fresh: Counter = { windowCount: 0, windowStart: now, total: 0, logged: false };
    counters.set(event, fresh);
    return fresh;
  }
  if (now - existing.windowStart >= ALERT_WINDOW_MS) {
    existing.windowCount = 0;
    existing.windowStart = now;
    existing.logged = false;
  }
  return existing;
}

/**
 * Record one occurrence.
 *
 * Never throws and never blocks — an alerting path that can fail the request it
 * is observing is worse than no alerting.
 */
export function recordAlert(event: AlertEvent): void {
  try {
    const now = Date.now();
    const counter = current(event, now);
    counter.windowCount++;
    counter.total++;

    // Log exactly once per window at the crossing, so the threshold shows up in
    // the log stream without every subsequent occurrence repeating it.
    if (!counter.logged && counter.windowCount >= THRESHOLDS[event]) {
      counter.logged = true;
      logger.error(
        { event: "alert_threshold_crossed", alert: event, count: counter.windowCount },
        `Alert threshold crossed for ${event}`,
      );
    }
  } catch {
    // Deliberately swallowed — see above.
  }
}

export interface AlertSnapshot {
  uptimeSec: number;
  /** Occurrences inside the current window — what `alerting` is derived from. */
  counts: Record<string, number>;
  /** Occurrences since process start, for context. Not compared to thresholds. */
  totals: Record<string, number>;
  windowSec: number;
  /** Events currently at or above their threshold *within the window*. */
  alerting: string[];
}

export function alertSnapshot(): AlertSnapshot {
  const now = Date.now();
  const counts: Record<string, number> = {};
  const totals: Record<string, number> = {};
  const alerting: string[] = [];

  for (const event of ALERT_EVENTS) {
    const counter = counters.get(event);
    // Rotate a stale window on read too, so a quiet process reports zero rather
    // than the last burst it saw.
    const windowCount =
      counter && now - counter.windowStart < ALERT_WINDOW_MS ? counter.windowCount : 0;

    counts[event] = windowCount;
    totals[event] = counter?.total ?? 0;
    if (windowCount >= THRESHOLDS[event]) alerting.push(event);
  }

  return {
    uptimeSec: Math.floor((now - startedAt) / 1000),
    counts,
    totals,
    windowSec: Math.floor(ALERT_WINDOW_MS / 1000),
    alerting,
  };
}

/** Test seam: clear all counters between cases. */
export function __resetAlerts(): void {
  counters.clear();
}
