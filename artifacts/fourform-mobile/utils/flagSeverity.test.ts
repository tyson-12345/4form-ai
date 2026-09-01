import { describe, it, expect } from "vitest";
import { flagSeverity, isAlarming, FLAG_ALARM_THRESHOLD } from "./flagSeverity";

describe("flagSeverity", () => {
  it("labels a joint out of range for most of the clip", () => {
    expect(flagSeverity(60)).toBe("OFTEN");
    expect(flagSeverity(25)).toBe("OFTEN");
  });

  it("labels the middle band", () => {
    expect(flagSeverity(24.9)).toBe("SOMETIMES");
    expect(flagSeverity(10)).toBe("SOMETIMES");
  });

  it("labels a brief excursion", () => {
    expect(flagSeverity(9.9)).toBe("BRIEFLY");
    expect(flagSeverity(0.1)).toBe("BRIEFLY");
  });

  it("labels zero as a single occurrence, not a frequent one", () => {
    expect(flagSeverity(0)).toBe("ONCE");
  });

  it("counts caution frames, not just risk ones", () => {
    // deriveRiskFindings keeps a finding when *either* band was entered, so a
    // joint can arrive with riskPercent 0 and a large cautionPercent. Reading
    // risk alone stamped that "ONCE" — a single excursion into a band it never
    // entered — next to text describing a sustained one.
    expect(flagSeverity(0, 30)).toBe("OFTEN");
    expect(flagSeverity(0, 12)).toBe("SOMETIMES");
    expect(flagSeverity(0, 4)).toBe("BRIEFLY");

    // Colour still keys on risk alone, so caution-only is stated, not alarmed.
    expect(isAlarming(0)).toBe(false);
  });

  it("adds the two bands together", () => {
    expect(flagSeverity(6, 6)).toBe("SOMETIMES");
    expect(flagSeverity(20, 8)).toBe("OFTEN");
  });

  it("changes wording at the same point the colour changes", () => {
    // The stamp and the alarm colour must agree, or a flag reads as mild while
    // being drawn in rust.
    expect(flagSeverity(FLAG_ALARM_THRESHOLD)).toBe("SOMETIMES");
    expect(isAlarming(FLAG_ALARM_THRESHOLD)).toBe(true);
    expect(flagSeverity(FLAG_ALARM_THRESHOLD - 0.1)).toBe("BRIEFLY");
    expect(isAlarming(FLAG_ALARM_THRESHOLD - 0.1)).toBe(false);
  });

  it("does not report a malformed measurement as the worst case", () => {
    // A missing or NaN reading must never render as "OFTEN" — that would
    // invent a severe finding out of an absent one, which is the failure this
    // app is built to avoid.
    expect(flagSeverity(Number.NaN)).toBe("ONCE");
    expect(flagSeverity(Number.POSITIVE_INFINITY)).toBe("ONCE");
    expect(flagSeverity(-5)).toBe("ONCE");
  });

});

describe("isAlarming", () => {
  it("is true at or above the threshold", () => {
    expect(isAlarming(10)).toBe(true);
    expect(isAlarming(80)).toBe(true);
  });

  it("is false below it, and for a malformed value", () => {
    expect(isAlarming(9.9)).toBe(false);
    expect(isAlarming(0)).toBe(false);
    expect(isAlarming(Number.NaN)).toBe(false);
  });
});
