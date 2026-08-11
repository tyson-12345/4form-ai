/**
 * Subscription and entitlement routes.
 *
 * ── Why this file is written defensively ────────────────────────────────────
 * The previous implementation exposed `POST /subscriptions/update` taking a
 * `tier` straight from the request body. Any authenticated user could send
 * `{"tier":"elite"}` and receive every paid feature for free, permanently. The
 * mobile app did exactly that when you tapped "Get Pro" — no payment was ever
 * taken, while the screen displayed real prices and claimed cards were charged
 * through the App Store.
 *
 * The rule now: **the client may never assert its own entitlement.** A tier can
 * only be raised by a server-verified purchase receipt. The only self-service
 * change a client can make is downgrading itself, which costs us nothing.
 */

import { Router } from "express";
import { z } from "zod";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { parseOrReject } from "../lib/validate.js";
import { logger } from "../lib/logger.js";
import { clientIp } from "../lib/rateLimit.js";
import {
  findSubscriptionByUserId,
  updateSubscription,
} from "../repositories/userRepository.js";
import {
  PLANS,
  billingEnabled,
  resolveEffectiveTier,
} from "../services/entitlementService.js";

const router = Router();

// TIER_LIMITS, PLANS, billingEnabled and resolveEffectiveTier moved to
// services/entitlementService.ts — routes/analyses.ts and routes/chat.ts need
// them too, and a route should not have to import another route to find out
// what a user is entitled to.

// ─── GET /api/subscriptions/plans ────────────────────────────────────────────

router.get("/subscriptions/plans", (_req, res) => {
  // `billingEnabled` tells the client whether to render a working purchase
  // button or a "not yet available" state. Shipping a button that silently
  // grants a paid tier without charging is both a revenue hole and a
  // misrepresentation to the user.
  res.json({ plans: PLANS, billingEnabled: billingEnabled() });
});

// ─── GET /api/subscriptions/current ──────────────────────────────────────────

router.get("/subscriptions/current", authenticate, async (req: AuthRequest, res) => {
  const sub = await findSubscriptionByUserId(req.userId!);
  const tier = resolveEffectiveTier(sub);
  const plan = PLANS.find((p) => p.id === tier) ?? PLANS[0];
  res.json({ subscription: sub ? { ...sub, tier } : null, plan });
});

// ─── POST /api/subscriptions/cancel ──────────────────────────────────────────

/**
 * Self-service downgrade to Free. Always permitted: a user may always give up
 * entitlements. Note this only updates our record — the actual store
 * subscription must be cancelled through Apple/Google.
 */
router.post("/subscriptions/cancel", authenticate, async (req: AuthRequest, res) => {
  const updated = await updateSubscription(req.userId!, {
    tier: "free",
    status: "cancelled",
  });

  logger.info(
    { userId: req.userId, event: "subscription_cancelled" },
    "User downgraded to free tier",
  );

  res.json({ subscription: updated });
});

// ─── POST /api/subscriptions/verify-purchase ─────────────────────────────────

const verifyPurchaseSchema = z.object({
  /** Opaque receipt from StoreKit / Google Play, forwarded for server-side check. */
  receipt: z.string().min(1).max(8192),
  platform: z.enum(["ios", "android"]),
});

/**
 * Upgrade path. The client submits a store receipt; the server verifies it with
 * Apple/Google (via RevenueCat) and sets the tier from the *verified* product
 * id — never from anything the client claims.
 *
 * Until billing is configured this returns 501 rather than granting anything.
 * Returning a free upgrade here would recreate exactly the hole this file exists
 * to close.
 */
router.post("/subscriptions/verify-purchase", authenticate, (req: AuthRequest, res) => {
  const data = parseOrReject(verifyPurchaseSchema, req.body, res, {
    route: "subscriptions/verify-purchase",
    ip: clientIp(req),
    userId: req.userId,
  });
  if (!data) return;

  if (!billingEnabled()) {
    logger.warn(
      { userId: req.userId, event: "purchase_attempt_billing_disabled" },
      "Purchase verification attempted while billing is not configured",
    );
    res.status(501).json({
      error: "In-app purchases aren't available yet.",
      code: "BILLING_NOT_CONFIGURED",
    });
    return;
  }

  // Wire the RevenueCat receipt-validation call here, then set the tier from
  // the verified entitlement. See docs/BILLING.md for the full checklist.
  logger.error(
    { userId: req.userId, event: "purchase_verification_unimplemented" },
    "billingEnabled() is true but receipt verification is not implemented",
  );
  res.status(501).json({
    error: "In-app purchases aren't available yet.",
    code: "BILLING_NOT_CONFIGURED",
  });
});

// ─── POST /api/subscriptions/dev-set-tier ────────────────────────────────────

const devTierSchema = z.object({ tier: z.enum(["free", "pro", "elite"]) });

/**
 * Development-only tier override so paid features can be exercised without a
 * payment provider.
 *
 * Guarded by two independent conditions — NODE_ENV must not be production *and*
 * ALLOW_DEV_TIER_OVERRIDE must be explicitly "true". A single misconfigured
 * variable in production therefore cannot re-open the paywall.
 */
router.post("/subscriptions/dev-set-tier", authenticate, async (req: AuthRequest, res) => {
  const enabled =
    process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_TIER_OVERRIDE === "true";

  if (!enabled) {
    logger.warn(
      { userId: req.userId, ip: clientIp(req), event: "dev_tier_override_blocked" },
      "Attempt to use the dev tier override while it is disabled",
    );
    res.status(404).json({ error: "Not found" });
    return;
  }

  const data = parseOrReject(devTierSchema, req.body, res, {
    route: "subscriptions/dev-set-tier",
    userId: req.userId,
  });
  if (!data) return;

  const updated = await updateSubscription(req.userId!, {
    tier: data.tier,
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  logger.warn(
    { userId: req.userId, tier: data.tier, event: "dev_tier_override_used" },
    "DEV ONLY: subscription tier overridden without payment",
  );

  res.json({ subscription: updated });
});

export default router;
