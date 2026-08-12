/**
 * Entitlement logic tests.
 *
 * The regression these guard against: `POST /subscriptions/update` used to take
 * a `tier` from the request body, so any authenticated user could grant
 * themselves Elite for free. The route is gone; these tests pin the properties
 * that replaced it.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  resolveEffectiveTier,
  TIER_LIMITS,
  billingEnabled,
  isPurchasableTier,
  PLANS,
  PURCHASABLE_PLANS,
} from "./entitlementService.js";

const HOUR = 60 * 60 * 1000;

function sub(overrides: Partial<{ tier: string; status: string; currentPeriodEnd: Date | null }> = {}) {
  return {
    tier: "pro",
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 24 * HOUR),
    ...overrides,
  };
}

describe("resolveEffectiveTier", () => {
  it("returns free when there is no subscription row", () => {
    expect(resolveEffectiveTier(undefined)).toBe("free");
  });

  it("returns the stored tier for an active, unexpired subscription", () => {
    expect(resolveEffectiveTier(sub({ tier: "pro" }))).toBe("pro");
    expect(resolveEffectiveTier(sub({ tier: "elite" }))).toBe("elite");
  });

  it("downgrades an expired subscription to free", () => {
    // Nothing else writes the row when a period lapses, so without this an
    // expired plan would keep granting paid features forever.
    expect(resolveEffectiveTier(sub({ currentPeriodEnd: new Date(Date.now() - HOUR) }))).toBe("free");
  });

  it("downgrades a non-active subscription to free", () => {
    expect(resolveEffectiveTier(sub({ status: "cancelled" }))).toBe("free");
    expect(resolveEffectiveTier(sub({ status: "past_due" }))).toBe("free");
  });

  it("treats an unknown tier value as free", () => {
    // Defends against a malformed or hand-edited database row.
    expect(resolveEffectiveTier(sub({ tier: "platinum" }))).toBe("free");
    expect(resolveEffectiveTier(sub({ tier: "admin" }))).toBe("free");
  });

  it("allows a paid tier with no end date (lifetime/comp)", () => {
    expect(resolveEffectiveTier(sub({ currentPeriodEnd: null }))).toBe("pro");
  });
});

describe("TIER_LIMITS", () => {
  it("gates AI chat to paid tiers", () => {
    expect(TIER_LIMITS.free.aiChat).toBe(false);
    expect(TIER_LIMITS.pro.aiChat).toBe(true);
    expect(TIER_LIMITS.elite.aiChat).toBe(true);
  });

  it("gates pro comparisons to elite only", () => {
    expect(TIER_LIMITS.free.proComparisons).toBe(false);
    expect(TIER_LIMITS.pro.proComparisons).toBe(false);
    expect(TIER_LIMITS.elite.proComparisons).toBe(true);
  });

  it("caps the free tier at 3 analyses per month", () => {
    expect(TIER_LIMITS.free.analysesPerMonth).toBe(3);
  });

  it("gives paid tiers unlimited analyses", () => {
    expect(TIER_LIMITS.pro.analysesPerMonth).toBe(-1);
    expect(TIER_LIMITS.elite.analysesPerMonth).toBe(-1);
  });
});

describe("advertised plan copy matches enforced limits", () => {
  it("states the free allowance as the number actually enforced", () => {
    // The old copy promised "3 video analyses per month" while the code counted
    // every analysis ever created — so the plan silently became 3 per lifetime.
    const free = PLANS.find((p) => p.id === "free")!;
    const claim = free.features.find((f) => /analys/i.test(f))!;
    expect(claim).toContain(String(TIER_LIMITS.free.analysesPerMonth));
    expect(claim).toMatch(/per month/i);
  });

  it("keeps each plan's limits object in sync with TIER_LIMITS", () => {
    for (const plan of PLANS) {
      expect(plan.limits, plan.id).toEqual(TIER_LIMITS[plan.id as keyof typeof TIER_LIMITS]);
    }
  });
});

describe("no plan advertises a feature that does not ship", () => {
  /**
   * The 2026-08-12 audit found Elite selling four unbuilt features at
   * $24.99/month, and Pro advertising "priority processing" that no code path
   * reads. These pin the corrections so a future edit has to be deliberate.
   */

  it("does not offer Elite for sale while its features are unbuilt", () => {
    const elite = PLANS.find((p) => p.id === "elite")!;
    expect(elite.available).toBe(false);
    expect(elite.unavailableReason).toBeTruthy();
  });

  it("excludes unavailable plans from the purchasable set", () => {
    expect(PURCHASABLE_PLANS.map((p) => p.id)).not.toContain("elite");
    expect(isPurchasableTier("elite")).toBe(false);
    expect(isPurchasableTier("pro")).toBe(true);
    expect(isPurchasableTier("free")).toBe(true);
  });

  it("makes no claim about priority processing anywhere in the catalog", () => {
    // TIER_LIMITS.priorityProcessing is set but nothing reads it — every
    // analysis runs the same path at the same speed. Advertising it is a
    // promise we do not keep.
    for (const plan of PLANS) {
      for (const feature of plan.features) {
        expect(feature, `${plan.id}: "${feature}"`).not.toMatch(/priority/i);
      }
    }
  });

  it("does not advertise pro-athlete comparison as a shipped feature", () => {
    // The comparison screen renders reference models with no measured
    // similarity. Any claim here must be marked as in development.
    for (const plan of PLANS.filter((p) => p.available)) {
      for (const feature of plan.features) {
        expect(feature, `${plan.id}: "${feature}"`).not.toMatch(/comparison|side-by-side/i);
      }
    }
  });
});

describe("billingEnabled", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env.REVENUECAT_API_KEY = original.REVENUECAT_API_KEY;
    process.env.REVENUECAT_WEBHOOK_SECRET = original.REVENUECAT_WEBHOOK_SECRET;
  });

  it("is false when no payment provider is configured", () => {
    delete process.env.REVENUECAT_API_KEY;
    delete process.env.REVENUECAT_WEBHOOK_SECRET;
    expect(billingEnabled()).toBe(false);
  });

  it("is false when only part of the configuration is present", () => {
    process.env.REVENUECAT_API_KEY = "key";
    delete process.env.REVENUECAT_WEBHOOK_SECRET;
    expect(billingEnabled()).toBe(false);
  });

  it("is true only when fully configured", () => {
    process.env.REVENUECAT_API_KEY = "key";
    process.env.REVENUECAT_WEBHOOK_SECRET = "secret";
    expect(billingEnabled()).toBe(true);
  });
});

describe("no client-assertable upgrade path exists", () => {
  it("does not export a handler that sets a tier from request input", async () => {
    // Belt-and-braces: if someone reintroduces `/subscriptions/update`, the
    // route table will grow a POST that isn't in this allowlist.
    const mod = await import("../routes/subscriptions.js");
    const stack = (mod.default as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;

    const postRoutes = stack
      .filter((layer) => layer.route?.methods.post)
      .map((layer) => layer.route!.path);

    expect(postRoutes.sort()).toEqual(
      [
        "/subscriptions/cancel",
        "/subscriptions/dev-set-tier",
        "/subscriptions/verify-purchase",
      ].sort(),
    );
  });
});
