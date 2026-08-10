/**
 * Entitlement logic tests.
 *
 * The regression these guard against: `POST /subscriptions/update` used to take
 * a `tier` from the request body, so any authenticated user could grant
 * themselves Elite for free. The route is gone; these tests pin the properties
 * that replaced it.
 */

import { describe, it, expect, afterEach } from "vitest";
import { resolveEffectiveTier, TIER_LIMITS, billingEnabled, PLANS } from "./subscriptions.js";

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
    const mod = await import("./subscriptions.js");
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
