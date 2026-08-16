import { describe, it, expect } from "vitest";
import {
  profileForSport,
  jointKind,
  safeBand,
  LEGACY_ZONES,
  SPORTS_WITH_PROFILES,
  type JointZones,
} from "./riskProfiles";
import { SPORTS } from "./sports";

/** Every boundary in order: risk ≤ warn on the low side, warn ≤ risk on the high. */
function ordered(z: JointZones): boolean {
  return z.loRisk <= z.loWarn && z.loWarn < z.hiWarn && z.hiWarn <= z.hiRisk;
}

describe("profile shape", () => {
  it("keeps every zone ordered, for every sport", () => {
    for (const sport of [...SPORTS_WITH_PROFILES, "anything else"]) {
      const { zones } = profileForSport(sport);
      expect(ordered(zones.knee), `${sport} knee`).toBe(true);
      expect(ordered(zones.hip), `${sport} hip`).toBe(true);
      expect(ordered(zones.elbow), `${sport} elbow`).toBe(true);
    }
  });

  it("covers every canonical sport with either a profile or the generic fallback", () => {
    for (const sport of SPORTS) {
      // Must never throw, and must always produce usable zones.
      const profile = profileForSport(sport);
      expect(profile.zones.knee).toBeDefined();
      expect(profile.basis.length).toBeGreaterThan(0);
    }
  });

  it("matches sports case-insensitively through the canonical list", () => {
    expect(profileForSport("Weightlifting").id).toBe("weightlifting");
    expect(profileForSport("weightlifting").id).toBe("weightlifting");
    expect(profileForSport("WEIGHTLIFTING").id).toBe("weightlifting");
  });

  it("gives unknown sports the generic profile rather than a guess", () => {
    expect(profileForSport("underwater basket weaving").id).toBe("generic");
    expect(profileForSport(null).id).toBe("generic");
    expect(profileForSport("Other").id).toBe("generic");
  });
});

describe("a straight limb is not automatically a finding", () => {
  // The correction the profiles exist for: the legacy bands flagged any
  // straight elbow (≥160°) and any straight knee (≥175°) in every sport.

  it("never flags a locked elbow overhead in weightlifting", () => {
    const { elbow } = profileForSport("Weightlifting").zones;
    expect(safeBand(elbow)).toBeNull(); // no band at all — nothing to violate
  });

  it("never flags streamline (straight everything) in swimming", () => {
    const { knee, elbow } = profileForSport("Swimming").zones;
    expect(safeBand(elbow)).toBeNull();
    expect(safeBand(knee)?.high ?? null).toBeNull();
  });

  it("never flags a straight-arm hang in climbing", () => {
    expect(safeBand(profileForSport("Climbing").zones.elbow)).toBeNull();
  });

  it("never flags a standing knee in the generic profile", () => {
    expect(safeBand(profileForSport("Other").zones.knee)?.high ?? null).toBeNull();
  });

  it("still flags full extension where the sport's literature documents it", () => {
    // Boxing: punches snapped to lockout. Gymnastics: weight on a locked arm.
    // Cycling: sustained extension = saddle too high (Bini 2011).
    expect(safeBand(profileForSport("Boxing").zones.elbow)?.high).toBe(170);
    expect(safeBand(profileForSport("Gymnastics").zones.elbow)?.high).toBe(172);
    expect(safeBand(profileForSport("Cycling").zones.knee)?.high).toBe(160);
  });

  it("keeps jump sports free of extension flags a frame cannot attribute", () => {
    // Standing between plays and a stiff landing look identical to a single
    // frame; flagging extension would mostly measure standing.
    expect(safeBand(profileForSport("Basketball").zones.knee)?.high ?? null).toBeNull();
    expect(safeBand(profileForSport("Volleyball").zones.knee)?.high ?? null).toBeNull();
  });

  it("lets running swing flexion pass that the legacy bands would have flagged", () => {
    // Sprint swing folds the knee to ~40° included; the legacy band cautioned
    // everything under 90°.
    const { knee } = profileForSport("Running").zones;
    expect(knee.loWarn).toBeLessThan(45);
    expect(LEGACY_ZONES.knee.loWarn).toBe(90);
  });
});

describe("helpers", () => {
  it("maps joint keys to kinds", () => {
    expect(jointKind("leftKnee")).toBe("knee");
    expect(jointKind("rightHip")).toBe("hip");
    expect(jointKind("leftElbow")).toBe("elbow");
  });

  it("turns sentinel bounds into open band sides", () => {
    expect(safeBand({ loRisk: -1, loWarn: -1, hiWarn: 160, hiRisk: 172 })).toEqual({
      low: null,
      high: 160,
    });
    expect(safeBand({ loRisk: 40, loWarn: 55, hiWarn: 999, hiRisk: 999 })).toEqual({
      low: 55,
      high: null,
    });
  });
});
