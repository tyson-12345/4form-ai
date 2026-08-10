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
import { db } from "@workspace/db";
import { subscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { parseOrReject } from "../lib/validate.js";
import { logger } from "../lib/logger.js";
import { clientIp } from "../lib/rateLimit.js";

const router = Router();

/**
 * Monthly analysis allowance per tier. `-1` means unlimited.
 *
 * This constant is the single source of truth for both the enforcement in
 * routes/analyses.ts and the marketing copy below, so the two cannot drift —
 * the previous code advertised "3 per month" while enforcing 3 *ever*.
 */
export const TIER_LIMITS = {
  free: { analysesPerMonth: 3, aiChat: false, proComparisons: false, priorityProcessing: false },
  pro: { analysesPerMonth: -1, aiChat: true, proComparisons: false, priorityProcessing: true },
  elite: { analysesPerMonth: -1, aiChat: true, proComparisons: true, priorityProcessing: true },
} as const;

export type Tier = keyof typeof TIER_LIMITS;

/**
 * True when real in-app purchases are wired up. While false, the app must not
 * present a working purchase flow — see `billingEnabled` in the plans payload.
 */
export function billingEnabled(): boolean {
  return Boolean(process.env.REVENUECAT_WEBHOOK_SECRET && process.env.REVENUECAT_API_KEY);
}

export const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    period: null,
    description: "Get started with AI coaching",
    features: [
      `${TIER_LIMITS.free.analysesPerMonth} video analyses per month`,
      "Pose tracking with joint-angle measurement",
      "Technique scores",
      "Injury risk indicators",
    ],
    limits: TIER_LIMITS.free,
  },
  {
    id: "pro",
    name: "Pro",
    price: 9.99,
    period: "month",
    description: "For serious athletes",
    popular: true,
    revenueCatProductId: "com.athleteai.pro.monthly",
    features: [
      "Unlimited video analyses",
      "AI coach chat",
      "Detailed coaching tips & drills",
      "Injury prevention plans",
      "Progress tracking & charts",
      "Priority processing",
    ],
    limits: TIER_LIMITS.pro,
  },
  {
    id: "elite",
    name: "Elite",
    price: 24.99,
    period: "month",
    description: "For competitive athletes",
    revenueCatProductId: "com.athleteai.elite.monthly",
    features: [
      "Everything in Pro",
      "Pro athlete comparisons",
      "Side-by-side technique analysis",
      "Advanced biomechanics report",
      "Custom training programs",
      "Early access to new features",
    ],
    limits: TIER_LIMITS.elite,
  },
];

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
  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, req.userId!))
    .limit(1);

  const tier = resolveEffectiveTier(sub);
  const plan = PLANS.find((p) => p.id === tier) ?? PLANS[0];
  res.json({ subscription: sub ? { ...sub, tier } : null, plan });
});

/**
 * The tier a user is actually entitled to right now.
 *
 * A stored tier of "pro" whose `currentPeriodEnd` has passed is treated as
 * "free". Without this an expired or refunded subscription keeps working
 * forever, because nothing else downgrades the row.
 */
export function resolveEffectiveTier(sub: {
  tier: string;
  status: string;
  currentPeriodEnd: Date | null;
} | undefined): Tier {
  if (!sub) return "free";
  if (sub.tier === "free") return "free";
  if (sub.status !== "active") return "free";
  if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() < Date.now()) return "free";
  return (sub.tier in TIER_LIMITS ? sub.tier : "free") as Tier;
}

// ─── POST /api/subscriptions/cancel ──────────────────────────────────────────

/**
 * Self-service downgrade to Free. Always permitted: a user may always give up
 * entitlements. Note this only updates our record — the actual store
 * subscription must be cancelled through Apple/Google.
 */
router.post("/subscriptions/cancel", authenticate, async (req: AuthRequest, res) => {
  const [updated] = await db
    .update(subscriptionsTable)
    .set({ tier: "free", status: "cancelled", updatedAt: new Date() })
    .where(eq(subscriptionsTable.userId, req.userId!))
    .returning();

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
router.post("/subscriptions/verify-purchase", authenticate, async (req: AuthRequest, res) => {
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

  const [updated] = await db
    .update(subscriptionsTable)
    .set({
      tier: data.tier,
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.userId, req.userId!))
    .returning();

  logger.warn(
    { userId: req.userId, tier: data.tier, event: "dev_tier_override_used" },
    "DEV ONLY: subscription tier overridden without payment",
  );

  res.json({ subscription: updated });
});

export default router;
