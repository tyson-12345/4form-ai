import { describe, it, expect } from "vitest";
import {
  computeScores,
  techniqueScore,
  balanceScore,
  consistencyScore,
  detectReps,
  mobilityScore,
  overallScore,
  deriveRiskFindings,
  isScorable,
  MIN_FRAMES_FOR_SCORING,
  type PoseMetrics,
} from "./scoring.js";

/**
 * A well-tracked clip with symmetric, clean movement.
 *
 * `facingRatio` is set to a square-on view so the balance comparison is
 * exercised by default; the view gate itself is covered separately.
 */
function goodMetrics(overrides: Partial<PoseMetrics> = {}): PoseMetrics {
  return {
    frameCount: 90,
    trackingQuality: 0.95,
    durationSec: 7.5,
    facingRatio: 0.75,
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

  describe("camera view gate", () => {
    /** Asymmetric enough that a computed score would be clearly non-null. */
    function lopsided(facingRatio: number | null | undefined): PoseMetrics {
      const m = goodMetrics({ joints: {}, facingRatio });
      m.joints.leftKnee = { min: 90, max: 170, mean: 120, stdDev: 20 };
      m.joints.rightKnee = { min: 90, max: 170, mean: 135, stdDev: 20 };
      return m;
    }

    it("scores symmetry when the athlete was square to the camera", () => {
      expect(lopsided(0.75)).toBeDefined();
      expect(balanceScore(lopsided(0.75))).not.toBeNull();
    });

    it("is null in profile, where the far side is occluded rather than measured", () => {
      // The view the app actually asks for. MediaPipe still emits landmarks for
      // the hidden limb, so without this the score looks measured and is not.
      expect(balanceScore(lopsided(0.1))).toBeNull();
    });

    it("is null just below the threshold and scores just above it", () => {
      expect(balanceScore(lopsided(0.34))).toBeNull();
      expect(balanceScore(lopsided(0.36))).not.toBeNull();
    });

    it("is null when the tracker could not read the view at all", () => {
      expect(balanceScore(lopsided(null))).toBeNull();
    });

    it("is null for clips from app builds predating the view measurement", () => {
      // Cannot be recovered after the fact: the clip may have been fine or may
      // have been shot in profile, and nothing recorded which.
      expect(balanceScore(lopsided(undefined))).toBeNull();
    });
  });
});

/**
 * `count` cycles of a smooth movement, each swinging `lo`→`hi`→`lo`.
 *
 * `drift` shrinks the amplitude progressively across the clip, the way range
 * of motion decays under fatigue. Progressive rather than alternating on
 * purpose: an every-other-rep wobble is not inconsistency at all, it is a
 * two-rep cycle that repeats perfectly, and the scorer is right to say so.
 *
 * Shared by the consistency and rep-detection suites — both run on the same
 * period search, and their fixtures should too.
 */
function reps(count: number, lo: number, hi: number, perRep = 20, drift = 0): number[] {
  const out: number[] = [];
  const mid = (hi + lo) / 2;
  const base = (hi - lo) / 2;
  for (let c = 0; c < count; c++) {
    const amp = base - drift * (count > 1 ? c / (count - 1) : 0);
    for (let i = 0; i < perRep; i++) {
      out.push(mid - amp * Math.cos((2 * Math.PI * i) / perRep));
    }
  }
  return out;
}

describe("consistencyScore", () => {
  const withSeries = (signal: (number | null)[]) =>
    goodMetrics({ series: { leftKnee: signal, rightKnee: signal } });

  it("is null when the clip carries no series at all", () => {
    // Clips measured by app builds predating this must still be accepted; they
    // simply have no repeatability to report.
    const m = goodMetrics();
    expect(m.series).toBeUndefined();
    expect(consistencyScore(m)).toBeNull();
  });

  it("is null for a single rep — one repetition has no repeatability", () => {
    expect(consistencyScore(withSeries(reps(1, 80, 170, 40)))).toBeNull();
  });

  it("is null for a static hold, rather than scoring it well", () => {
    // The old metric gave motionless clips a *better* score than real reps.
    expect(consistencyScore(withSeries(new Array(80).fill(120)))).toBeNull();
  });

  it("scores identical repetitions near 100", () => {
    expect(consistencyScore(withSeries(reps(4, 80, 170)))!).toBeGreaterThan(95);
  });

  it("scores a textbook full-range rep highly, not near zero", () => {
    // The regression that prompted this rewrite: a perfect squat scored 12.
    expect(consistencyScore(withSeries(reps(4, 80, 170)))!).toBeGreaterThan(90);
  });

  it("does not penalise range of motion on its own", () => {
    const wide = consistencyScore(withSeries(reps(4, 60, 180)))!;
    const narrow = consistencyScore(withSeries(reps(4, 130, 160)))!;
    expect(wide).toBeCloseTo(narrow, 0);
  });

  it("penalises reps that vary from each other", () => {
    const steady = consistencyScore(withSeries(reps(4, 80, 170, 20, 0)))!;
    const erratic = consistencyScore(withSeries(reps(4, 80, 170, 20, 25)))!;
    expect(erratic).toBeLessThan(steady);
  });

  it("ranks a clean athlete above an erratic one", () => {
    expect(consistencyScore(withSeries(reps(4, 80, 170, 20, 2)))!).toBeGreaterThan(
      consistencyScore(withSeries(reps(4, 80, 170, 20, 30)))!,
    );
  });

  it("bridges brief visibility gaps rather than discarding the joint", () => {
    const signal: (number | null)[] = reps(4, 80, 170);
    signal[5] = null;
    signal[31] = null;
    expect(consistencyScore(withSeries(signal))!).toBeGreaterThan(90);
  });

  it("is null when a joint was visible for too little of the clip", () => {
    const signal: (number | null)[] = reps(4, 80, 170);
    for (let i = 0; i < signal.length * 0.7; i++) signal[i] = null;
    expect(consistencyScore(withSeries(signal))).toBeNull();
  });

  it("no longer lets standing still outscore a real rep", () => {
    // The exact inversion this replaced: motionless 25, perfect rep 12.
    const moving = consistencyScore(withSeries(reps(4, 80, 170)));
    const still = consistencyScore(withSeries(new Array(80).fill(120)));
    expect(still).toBeNull();
    expect(moving!).toBeGreaterThan(90);
  });
});

describe("detectReps", () => {
  const withSeries = (signal: (number | null)[]) =>
    goodMetrics({ series: { leftKnee: signal, rightKnee: signal } });

  it("counts the repetitions in a clean set", () => {
    expect(detectReps(withSeries(reps(4, 80, 170)))).toBe(4);
    expect(detectReps(withSeries(reps(6, 80, 170)))).toBe(6);
  });

  it("is null for a single rep — nothing repeated", () => {
    expect(detectReps(withSeries(reps(1, 80, 170, 40)))).toBeNull();
  });

  it("is null for a static hold", () => {
    expect(detectReps(withSeries(new Array(80).fill(120)))).toBeNull();
  });

  it("is null without a series", () => {
    expect(detectReps(goodMetrics())).toBeNull();
  });

  it("does not halve the count when noise favours the double period", () => {
    // The octave error: per-rep noise can push the autocorrelation at 2× the
    // true period a hair above the period itself, and taking the tallest peak
    // then reports half the reps. Alternate cycles are nudged in opposite
    // directions here, which makes lag 2T correlate perfectly while lag T
    // stays merely excellent — the fundamental must still win.
    const signal = reps(4, 80, 170).map((v, i) => {
      const cycle = Math.floor(i / 20);
      return v + (cycle % 2 === 0 ? 1.2 : -1.2);
    });
    expect(detectReps(withSeries(signal))).toBe(4);
  });

  it("agrees with consistencyScore about whether repetition exists", () => {
    // The two share one period search; a clip must never carry a consistency
    // score while claiming no reps, or a rep count with no consistency score.
    const repeating = withSeries(reps(5, 80, 170));
    const lone = withSeries(reps(1, 80, 170, 40));
    expect(detectReps(repeating) !== null).toBe(consistencyScore(repeating) !== null);
    expect(detectReps(lone) !== null).toBe(consistencyScore(lone) !== null);
  });
});

describe("mobilityScore", () => {
  it("is null for a static hold — a position has no range of motion", () => {
    // A plank used to score ~4, indistinguishable from terrible mobility.
    const still = goodMetrics({
      joints: {
        leftKnee: { min: 175, max: 179, mean: 177, stdDev: 1 },
        rightKnee: { min: 174, max: 179, mean: 177, stdDev: 1 },
        leftHip: { min: 168, max: 174, mean: 171, stdDev: 1.5 },
        rightHip: { min: 169, max: 175, mean: 172, stdDev: 1.5 },
      },
    });
    expect(mobilityScore(still)).toBeNull();
  });

  it("still scores a real movement whose range is merely poor", () => {
    // 30° of knee travel is shallow, not static — it must keep its low score
    // rather than escaping into "not measured".
    const shallow = goodMetrics({
      joints: {
        leftKnee: { min: 140, max: 170, mean: 155, stdDev: 8 },
        rightKnee: { min: 141, max: 171, mean: 156, stdDev: 8 },
      },
    });
    const score = mobilityScore(shallow);
    expect(score).not.toBeNull();
    expect(score!).toBeLessThan(50);
  });

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
