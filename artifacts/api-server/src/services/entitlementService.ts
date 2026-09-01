/**
 * What a user is entitled to, and the plan catalog that describes it.
 *
 * ── Why this is a service and not part of the subscriptions route ───────────
 * Three routes need to know a user's tier: analyses (monthly quota), chat (is
 * AI coaching included), and subscriptions (what to display). Previously
 * `routes/analyses.ts` and `routes/chat.ts` imported `TIER_LIMITS` and
 * `resolveEffectiveTier` from `routes/subscriptions.ts` — routes importing
 * routes, which means loading the analyses router pulls in an Express router
 * nobody asked for and the entitlement rules cannot be tested without one.
 *
 * ── The rule this file enforces ─────────────────────────────────────────────
 * **The client may never assert its own entitlement.** A tier is raised only by
 * a server-verified purchase receipt. The only self-service change a client can
 * make is downgrading itself, which costs us nothing.
 *
 * This is the single most important difference from Oscar's fork, where
 * `POST /subscriptions/update` writes `req.body.tier` straight to the database
 * — any authenticated user can grant themselves `elite` indefinitely, and the
 * advertised monthly allowance is never read by anything.
 */

/**
 * Monthly analysis allowance per tier. `-1` means unlimited.
 *
 * Single source of truth for both enforcement and the marketing copy below, so
 * the two cannot drift — earlier code advertised "3 per month" while enforcing
 * 3 *ever*.
 */
export const TIER_LIMITS = {
  free: { analysesPerMonth: 3, aiChat: false, proComparisons: false, priorityProcessing: false },
  pro: { analysesPerMonth: -1, aiChat: true, proComparisons: false, priorityProcessing: true },
  elite: { analysesPerMonth: -1, aiChat: true, proComparisons: true, priorityProcessing: true },
} as const;

export type Tier = keyof typeof TIER_LIMITS;

/** The shape `resolveEffectiveTier` needs — kept narrow so it is trivial to test. */
export interface EntitlementSource {
  tier: string;
  status: string;
  currentPeriodEnd: Date | null;
}

/**
 * The tier a user is actually entitled to right now.
 *
 * A stored tier of "pro" whose `currentPeriodEnd` has passed resolves to
 * "free". Without this an expired or refunded subscription keeps working
 * forever, because nothing else downgrades the row. Always call this rather
 * than reading `subscription.tier` directly.
 */
export function resolveEffectiveTier(sub: EntitlementSource | undefined): Tier {
  if (!sub) return "free";
  if (sub.tier === "free") return "free";
  if (sub.status !== "active") return "free";
  if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() < Date.now()) return "free";
  return (sub.tier in TIER_LIMITS ? sub.tier : "free") as Tier;
}

/**
 * True when real in-app purchases are wired up. While false the app must not
 * present a working purchase flow — see `billingEnabled` in the plans payload.
 */
export function billingEnabled(): boolean {
  return Boolean(process.env.REVENUECAT_WEBHOOK_SECRET && process.env.REVENUECAT_API_KEY);
}

/**
 * The plan catalog shown on the pricing screen.
 *
 * ── One rule: never advertise a feature that does not ship ──────────────────
 * Every string in a `features` array must correspond to behaviour a paying user
 * actually receives today. This is not a style preference — charging for a
 * capability that does not exist is a misrepresentation, it is the kind of thing
 * app review rejects, and it is the kind of thing a chargeback is granted over.
 *
 * An audit on 2026-08-12 found three claims that failed that test and removed
 * them:
 *
 *  - **"Priority processing"** (Pro). `TIER_LIMITS.priorityProcessing` is set
 *    but nothing reads it. Every analysis runs on the same path at the same
 *    speed regardless of tier.
 *  - **"Pro athlete comparisons" / "Side-by-side technique analysis"** (Elite).
 *    The Compare screen renders `PRO_ATHLETES` and `MOCK_ATHLETE` from
 *    `lib/athleteData.ts` with hard-coded similarity scores. No real comparison
 *    is computed from anyone's measurements.
 *  - **"Advanced biomechanics report" / "Custom training programs"** (Elite).
 *    Neither exists in any form.
 *
 * That left the Elite tier with nothing behind it, so it is no longer offered
 * for sale — see `available` below.
 */
export const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    period: null,
    description: "Get started with AI coaching",
    available: true,
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
    available: true,
    revenueCatProductId: "com.fourformai.pro.monthly",
    features: [
      "Unlimited video analyses",
      "AI coach chat",
      "Detailed coaching tips & drills",
      "Injury-risk readings with prevention work",
      "Progress tracking & charts",
    ],
    limits: TIER_LIMITS.pro,
  },
  {
    /**
     * Retained so existing `elite` subscription rows still resolve to their
     * entitlements, but not purchasable: every feature that justified the
     * $24.99 price is unbuilt. Re-enable by setting `available: true` once the
     * comparison feature genuinely ships — and not before.
     */
    id: "elite",
    name: "Elite",
    price: 24.99,
    period: "month",
    description: "Not yet available",
    available: false,
    unavailableReason:
      "Elite is still in development. We're not selling it until the features behind it are real.",
    revenueCatProductId: "com.fourformai.elite.monthly",
    features: ["Everything in Pro", "Pro athlete comparisons (in development)"],
    limits: TIER_LIMITS.elite,
  },
];

/** Plans a client may actually present a purchase button for. */
export const PURCHASABLE_PLANS = PLANS.filter((p) => p.available);

/**
 * Whether a verified purchase may be honoured for `tier`.
 *
 * Checked server-side on the receipt path as well as being reflected in the UI.
 * A store product can outlive the decision to sell it — if `com.fourformai.elite.monthly`
 * is still live in App Store Connect, someone can buy it (a stale client, a
 * restore of an old purchase) and arrive here with a genuinely valid receipt.
 * Taking that money for an unbuilt feature is the thing we are trying not to do,
 * so the grant is refused at the server and the caller is told to seek a refund.
 */
export function isPurchasableTier(tier: string): boolean {
  return PURCHASABLE_PLANS.some((p) => p.id === tier);
}

// ─── Monthly quota window ────────────────────────────────────────────────────

/** First instant of the current calendar month, in server local time. */
export function startOfMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** First instant of next calendar month — when a free user's allowance resets. */
export function startOfNextMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}
