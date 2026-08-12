/**
 * Liveness and operational metrics.
 *
 * `/healthz` is the load-balancer probe and must stay trivial — no database, no
 * Redis, no work that can make a healthy process look dead.
 *
 * `/health/metrics` is the polling endpoint for an uptime check. It is
 * deliberately unauthenticated but exposes only counters and booleans: no user
 * data, no configuration values, no secrets. Adopted from Oscar's fork, which
 * had this and this codebase did not.
 */

import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { alertSnapshot } from "../lib/alerting.js";
import { redisAvailable } from "../lib/redis.js";
import { claudeConfigured } from "../lib/claude.js";
import { activeProvider, emailConfigured } from "../lib/mailer.js";
import { billingEnabled } from "../services/entitlementService.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health/metrics", (_req, res) => {
  const alerts = alertSnapshot();

  res.json({
    // "degraded" rather than "unhealthy": everything below is a partial loss of
    // function, not a dead process. A probe that fails the instance on a Claude
    // outage would take the whole app down over an optional feature.
    status: alerts.alerting.length > 0 ? "degraded" : "ok",
    uptimeSec: alerts.uptimeSec,
    features: {
      // Coaching prose and chat are disabled without a key; measurement and
      // scoring are unaffected. Surfaced so "why are there no write-ups"
      // is answerable without shell access.
      coachingWriteups: claudeConfigured(),
      sharedRateLimits: redisAvailable(),
      billing: billingEnabled(),
      // Without this, password reset and lockout notices are generated and
      // logged but never delivered — the user-visible symptom is "the email
      // never arrived", which is otherwise invisible from outside.
      transactionalEmail: emailConfigured(),
      // The provider name is a config *choice*, not a credential — safe to
      // expose, and it is the fastest way to confirm a cutover actually took.
      emailProvider: activeProvider(),
    },
    alerts: alerts.counts,
    alerting: alerts.alerting,
  });
});

export default router;
