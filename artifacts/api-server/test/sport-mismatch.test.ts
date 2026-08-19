/**
 * The sport-mismatch gate.
 *
 * This is the only field in the coaching narrative that contradicts something
 * the athlete typed, so it is the only one that gets checked rather than
 * trusted. The cost of the two failure directions is not symmetric: a missed
 * mismatch means one clip scored against the wrong bands, while a false one
 * tells an athlete who filmed exactly what they meant to that they got their
 * own sport wrong. The gate is tuned for the second to be impossible.
 *
 * Sport is also chosen per clip precisely so athletes can cross-train, so
 * "unusual for this sport" is never sufficient grounds.
 */

import { describe, it, expect } from "vitest";
import { validateSportMismatch } from "../src/services/analysisService.js";

const verdict = (over: Partial<{ suggestedSport: string; confidence: "medium" | "high"; message: string }> = {}) => ({
  suggestedSport: "weightlifting",
  confidence: "high" as const,
  message: "This looks like a barbell squat rather than a swim.",
  ...over,
});

describe("validateSportMismatch", () => {
  it("passes a high-confidence verdict naming a known, different sport", () => {
    const out = validateSportMismatch(verdict(), "swimming");
    expect(out).not.toBeNull();
    expect(out?.suggestedSport).toBe("weightlifting");
  });

  it("returns null when the coach declined to judge", () => {
    expect(validateSportMismatch(null, "swimming")).toBeNull();
  });

  it("drops a sport the app does not know", () => {
    // A suggestion the athlete cannot act on is worse than silence: there is no
    // such entry to re-upload under.
    expect(validateSportMismatch(verdict({ suggestedSport: "quidditch" }), "swimming")).toBeNull();
  });

  it("drops a verdict that suggests the sport already selected", () => {
    // Self-contradiction. Reads as a bug, and tells the athlete nothing.
    expect(validateSportMismatch(verdict({ suggestedSport: "swimming" }), "swimming")).toBeNull();
    expect(validateSportMismatch(verdict({ suggestedSport: "Swimming" }), "swimming")).toBeNull();
  });

  it("drops anything below high confidence", () => {
    expect(validateSportMismatch(verdict({ confidence: "medium" }), "swimming")).toBeNull();
  });

  it("compares sports without regard to case or surrounding space", () => {
    expect(validateSportMismatch(verdict({ suggestedSport: "  Weightlifting " }), "swimming"))
      .not.toBeNull();
    expect(validateSportMismatch(verdict({ suggestedSport: "WEIGHTLIFTING" }), " weightlifting  "))
      .toBeNull();
  });

  it("returns the app's own spelling, not the model's", () => {
    // What reaches the screen has to match the sport list the athlete picks
    // from, or the instruction to re-upload names something they cannot find.
    const out = validateSportMismatch(verdict({ suggestedSport: "WeightLifting" }), "swimming");
    expect(out?.suggestedSport).toBe("weightlifting");
  });
});
