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

// ─── Monthly quota window ────────────────────────────────────────────────────

/** First instant of the current calendar month, in server local time. */
export function startOfMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** First instant of next calendar month — when a free user's allowance resets. */
export function startOfNextMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}
