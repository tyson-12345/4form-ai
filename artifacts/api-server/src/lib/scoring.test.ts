import { describe, it, expect } from "vitest";
import {
  computeScores,
  techniqueScore,
  balanceScore,
  consistencyScore,
  mobilityScore,
  overallScore,
  deriveRiskFindings,
  isScorable,
  MIN_FRAMES_FOR_SCORING,
  type PoseMetrics,
} from "./scoring.js";

/** A well-tracked clip with symmetric, clean movement. */
function goodMetrics(overrides: Partial<PoseMetrics> = {}): PoseMetrics {
  return {
    frameCount: 90,
    trackingQuality: 0.95,
    durationSec: 7.5,
    joints: {
      leftKnee: { min: 95, max: 175, mean: 135, stdDev: 22 },
      rightKnee: { min: 96, max: 174, mean: 135, stdDev: 22 },
      leftHip: { min: 85, max: 165, mean: 125, stdDev: 20 },
      rightHip: { min: 86, max: 164, mean: 125, stdDev: 20 },
      leftElbow: { min: 60, max: 155, mean: 110, stdDev: 25 },
      rightElbow: { min: 61, max: 154, mean: 110, stdDev: 25 },
    },
    riskFrames: {
      leftKnee: { caution: 0, risk: 0 },
      rightKnee: { caution: 0, risk: 0 },
      leftHip: { caution: 0, risk: 0 },
      rightHip: { caution: 0, risk: 0 },
      leftElbow: { caution: 0, risk: 0 },
      rightElbow: { caution: 0, risk: 0 },
    },
    ...overrides,
  };
}

describe("isScorable", () => {
  it("accepts a well-tracked clip", () => {
    expect(isScorable(goodMetrics())).toBe(true);
  });

  it("rejects too few frames", () => {
    expect(isScorable(goodMetrics({ frameCount: MIN_FRAMES_FOR_SCORING - 1 }))).toBe(false);
  });

  it("rejects poor tracking quality", () => {
    expect(isScorable(goodMetrics({ trackingQuality: 0.2 }))).toBe(false);
  });

  it("rejects a clip with no tracked joints", () => {
    expect(isScorable(goodMetrics({ joints: {} }))).toBe(false);
  });
});

describe("determinism", () => {
  it("produces identical scores for identical metrics", () => {
    // This is the property that fixes "the same video scores differently every
    // time". Scoring must be a pure function of the measurements.
    const metrics = goodMetrics();
    const a = computeScores(metrics);
    const b = computeScores(structuredClone(metrics));
    expect(a).toEqual(b);
  });

  it("produces different scores for different metrics", () => {
    const clean = computeScores(goodMetrics());
    const risky = computeScores(
      goodMetrics({
        riskFrames: {
          ...goodMetrics().riskFrames,
          leftKnee: { caution: 20, risk: 30 },
        },
      }),
    );
    expect(risky.technique).toBeLessThan(clean.technique!);
  });
});

describe("techniqueScore", () => {
  it("is 100 when no frame leaves the safe band", () => {
    expect(techniqueScore(goodMetrics())).toBe(100);
  });

  it("drops as risk frames accumulate", () => {
    const m = goodMetrics();
    m.riskFrames.leftKnee = { caution: 45, risk: 0 };
    expect(techniqueScore(m)).toBeLessThan(100);
  });

  it("weights risk frames twice as heavily as caution frames", () => {
    const caution = goodMetrics();
    caution.riskFrames.leftKnee = { caution: 30, risk: 0 };

    const risk = goodMetrics();
    risk.riskFrames.leftKnee = { caution: 0, risk: 30 };

    const cautionPenalty = 100 - techniqueScore(caution)!;
    const riskPenalty = 100 - techniqueScore(risk)!;
    // Scores are rounded to integers, so allow a point of slack either way
    // rather than asserting exact arithmetic on a rounded value.
    expect(Math.abs(riskPenalty - cautionPenalty * 2)).toBeLessThanOrEqual(1);
  });

  it("never returns a negative score", () => {
    const m = goodMetrics({ frameCount: 10 });
    m.riskFrames.leftKnee = { caution: 100, risk: 100 };
    expect(techniqueScore(m)).toBeGreaterThanOrEqual(0);
  });

  it("returns null when nothing was measured", () => {
    expect(techniqueScore(goodMetrics({ riskFrames: {}, frameCount: 90 }))).toBeNull();
  });
});

describe("balanceScore", () => {
  it("is near 100 for symmetric movement", () => {
    expect(balanceScore(goodMetrics())).toBeGreaterThan(95);
  });

  it("falls as left and right diverge", () => {
    const m = goodMetrics();
    m.joints.leftKnee = { min: 95, max: 175, mean: 120, stdDev: 22 };
    m.joints.rightKnee = { min: 96, max: 174, mean: 150, stdDev: 22 };
    expect(balanceScore(m)!).toBeLessThan(80);
  });

  it("reaches 0 at a 30-degree mean difference", () => {
    const m = goodMetrics({ joints: {} });
    m.joints.leftKnee = { min: 0, max: 180, mean: 100, stdDev: 10 };
    m.joints.rightKnee = { min: 0, max: 180, mean: 130, stdDev: 10 };
    expect(balanceScore(m)).toBe(0);
  });

  it("skips pairs where only one side was tracked", () => {
    // Assuming symmetry from a single side would invent a measurement.
    const m = goodMetrics({ joints: {} });
    m.joints.leftKnee = { min: 90, max: 170, mean: 130, stdDev: 20 };
    expect(balanceScore(m)).toBeNull();
  });
});

describe("consistencyScore", () => {
  it("rewards low variability relative to range", () => {
    const m = goodMetrics({ joints: {} });
    m.joints.leftKnee = { min: 100, max: 180, mean: 140, stdDev: 2 };
    expect(consistencyScore(m)!).toBeGreaterThan(90);
  });

  it("penalises high variability relative to range", () => {
    const m = goodMetrics({ joints: {} });
    m.joints.leftKnee = { min: 100, max: 180, mean: 140, stdDev: 40 };
    expect(consistencyScore(m)!).toBeLessThan(10);
  });

  it("does not penalise large range of motion on its own", () => {
    // A big movement should not score worse than a small one just for being big.
    const wide = goodMetrics({ joints: {} });
    wide.joints.leftKnee = { min: 60, max: 180, mean: 120, stdDev: 12 };

    const narrow = goodMetrics({ joints: {} });
    narrow.joints.leftKnee = { min: 130, max: 160, mean: 145, stdDev: 3 };

    expect(consistencyScore(wide)!).toBeCloseTo(consistencyScore(narrow)!, 0);
  });
});

describe("mobilityScore", () => {
  it("is 100 when range of motion meets the reference", () => {
    const m = goodMetrics({ joints: {} });
    m.joints.leftKnee = { min: 60, max: 160, mean: 110, stdDev: 20 }; // 100° vs 90° ref
    expect(mobilityScore(m)).toBe(100);
  });

  it("scales down for restricted range", () => {
    const m = goodMetrics({ joints: {} });
    m.joints.leftKnee = { min: 130, max: 175, mean: 150, stdDev: 10 }; // 45° vs 90° ref
    expect(mobilityScore(m)).toBe(50);
  });

  it("does not exceed 100 for exceptional range", () => {
    const m = goodMetrics({ joints: {} });
    m.joints.leftKnee = { min: 10, max: 180, mean: 90, stdDev: 40 };
    expect(mobilityScore(m)).toBe(100);
  });
});

describe("overallScore", () => {
  it("averages only the measured dimensions", () => {
    expect(overallScore([80, 60, null, null])).toBe(70);
  });

  it("is null when nothing was measured", () => {
    expect(overallScore([null, null])).toBeNull();
  });

  it("ignores nulls rather than treating them as zero", () => {
    // Treating an unmeasured dimension as 0 would drag every overall score down.
    expect(overallScore([90, null])).toBe(90);
  });
});

describe("computeScores", () => {
  it("returns all nulls for an unscorable clip", () => {
    const scores = computeScores(goodMetrics({ frameCount: 3 }));
    expect(scores).toEqual({
      overall: null,
      technique: null,
      balance: null,
      consistency: null,
      mobility: null,
      power: null,
      speed: null,
    });
  });

  it("always reports power and speed as null", () => {
    // Neither is derivable from 2D joint angles. Emitting a number here would
    // be presenting an invention as a measurement.
    const scores = computeScores(goodMetrics());
    expect(scores.power).toBeNull();
    expect(scores.speed).toBeNull();
  });

  it("keeps every score within 0-100", () => {
    const scores = computeScores(goodMetrics());
    for (const [key, value] of Object.entries(scores)) {
      if (value === null) continue;
      expect(value, key).toBeGreaterThanOrEqual(0);
      expect(value, key).toBeLessThanOrEqual(100);
    }
  });

  it("returns integers", () => {
    const scores = computeScores(goodMetrics());
    for (const value of Object.values(scores)) {
      if (value === null) continue;
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe("deriveRiskFindings", () => {
  it("returns nothing when no joint was flagged", () => {
    expect(deriveRiskFindings(goodMetrics())).toEqual([]);
  });

  it("reports the measured share of frames, not a probability", () => {
    const m = goodMetrics({ frameCount: 100 });
    m.riskFrames.leftKnee = { caution: 10, risk: 25 };
    const [finding] = deriveRiskFindings(m);
    expect(finding.riskPercent).toBe(25);
    expect(finding.cautionPercent).toBe(10);
  });

  it("includes the observed angle extremes", () => {
    const m = goodMetrics({ frameCount: 100 });
    m.riskFrames.leftKnee = { caution: 0, risk: 5 };
    const [finding] = deriveRiskFindings(m);
    expect(finding.observedMin).toBe(95);
    expect(finding.observedMax).toBe(175);
  });

  it("sorts worst-first", () => {
    const m = goodMetrics({ frameCount: 100 });
    m.riskFrames.leftKnee = { caution: 0, risk: 5 };
    m.riskFrames.rightHip = { caution: 0, risk: 40 };
    const findings = deriveRiskFindings(m);
    expect(findings[0].joint).toBe("rightHip");
  });

  it("returns nothing for an unscorable clip", () => {
    const m = goodMetrics({ frameCount: 2 });
    m.riskFrames.leftKnee = { caution: 1, risk: 1 };
    expect(deriveRiskFindings(m)).toEqual([]);
  });
});
