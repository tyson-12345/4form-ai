/**
 * The movement signature — the measured rhythm the narrative model reasons from.
 *
 * This is the evidence that lets "running clip labelled volleyball" be caught:
 * angle ranges overlap between sports, rhythm does not. The classifications
 * here are the ones the wrong-sport prompt keys off, so each synthetic clip
 * below is a caricature of a real one: a gait, a rally, a hold.
 */

import { describe, it, expect } from "vitest";
import { movementSignature, repDepths, type PoseMetrics } from "../src/lib/scoring.js";

/** A metrics blob with only the fields the signature reads. */
function metricsWith(series: (number | null)[], durationSec: number): PoseMetrics {
  return {
    frameCount: series.length,
    trackingQuality: 0.9,
    durationSec,
    joints: {},
    riskFrames: {},
    series: { leftKnee: series },
  };
}

describe("movementSignature", () => {
  it("reads a steady gait as continuous-cyclic at the right tempo", () => {
    // A running stride: the knee swings 45–135° at 1.4 cycles/sec for 10s.
    // 150 samples over 10s = 15 samples/sec, the scan default.
    const samples = 150;
    const hz = 1.4;
    const series = Array.from({ length: samples }, (_, i) => {
      const t = (i / samples) * 10;
      return 90 + 45 * Math.sin(2 * Math.PI * hz * t);
    });

    const sig = movementSignature(metricsWith(series, 10));
    expect(sig).not.toBeNull();
    expect(sig?.pattern).toBe("continuous-cyclic");
    expect(sig?.driverJoint).toBe("leftKnee");
    expect(sig?.cyclesPerSec).toBeGreaterThan(1.1);
    expect(sig?.cyclesPerSec).toBeLessThan(1.7);
    expect(sig?.activeFraction).toBeGreaterThan(0.5);
  });

  it("reads bursts separated by standing as repeated-efforts, not a gait", () => {
    // A rally: mostly standing near extension, with four brief deep dips —
    // jumps or lunges — evenly spaced through the clip.
    const series: number[] = [];
    for (let burst = 0; burst < 4; burst++) {
      for (let i = 0; i < 30; i++) series.push(172 + (i % 3)); // standing
      for (let i = 0; i < 8; i++) series.push(172 - 80 * Math.sin((Math.PI * i) / 7)); // one dip
    }
    const sig = movementSignature(metricsWith(series, 10));
    expect(sig).not.toBeNull();
    expect(sig?.pattern).toBe("repeated-efforts");
    // The defining feature: NOT in motion most of the time.
    expect(sig?.activeFraction).toBeLessThan(0.5);
  });

  it("reads a hold as mostly-still", () => {
    const series = Array.from({ length: 150 }, (_, i) => 90 + (i % 2));
    const sig = movementSignature(metricsWith(series, 10));
    expect(sig?.pattern).toBe("mostly-still");
    expect(sig?.cyclesPerSec).toBeNull();
  });

  it("reads one large movement as single-effort-or-hold", () => {
    // One slow squat: down and up once, no repetition to find.
    const series = Array.from({ length: 150 }, (_, i) => 170 - 100 * Math.sin((Math.PI * i) / 149));
    const sig = movementSignature(metricsWith(series, 10));
    expect(sig?.pattern).toBe("single-effort-or-hold");
    expect(sig?.cyclesPerSec).toBeNull();
    expect(sig?.driverRange).toBeGreaterThan(80);
  });

  it("returns null with no series, and null for a zero-length clip", () => {
    expect(movementSignature(metricsWith([], 10))).toBeNull();
    expect(
      movementSignature({ ...metricsWith([1, 2, 3], 10), series: undefined }),
    ).toBeNull();
    const sine = Array.from({ length: 150 }, (_, i) => 90 + 45 * Math.sin(i / 3));
    expect(movementSignature(metricsWith(sine, 0))).toBeNull();
  });

  it("picks the joint that travels furthest as the driver", () => {
    const still = Array.from({ length: 150 }, () => 165);
    const moving = Array.from({ length: 150 }, (_, i) => 90 + 45 * Math.sin(i / 4));
    const metrics = metricsWith(still, 10);
    metrics.series = { leftElbow: still, rightKnee: moving };
    const sig = movementSignature(metrics);
    expect(sig?.driverJoint).toBe("rightKnee");
  });
});

describe("repDepths", () => {
  it("reads one bottom angle per rep, in clip order", () => {
    // Six identical squats bottoming out near 70°: one depth per cycle,
    // all within noise of each other.
    const samples = 150;
    const series = Array.from({ length: samples }, (_, i) => {
      const phase = (i / samples) * 6 * 2 * Math.PI;
      return 120 - 50 * (0.5 - 0.5 * Math.cos(phase));
    });
    const out = repDepths(metricsWith(series, 12));
    expect(out).not.toBeNull();
    expect(out?.joint).toBe("leftKnee");
    expect(out?.depths.length).toBeGreaterThanOrEqual(5);
    for (const d of out?.depths ?? []) {
      expect(d).toBeGreaterThan(60);
      expect(d).toBeLessThan(80);
    }
  });

  it("puts a fading session's drift where the model can see it", () => {
    // Four deep reps, then two shallow ones — the exact pattern "your last
    // two reps lost depth" is written from. The depths must carry it.
    const perRep = 25;
    const series: number[] = [];
    for (let rep = 0; rep < 6; rep++) {
      const bottom = rep < 4 ? 70 : 95;
      for (let i = 0; i < perRep; i++) {
        series.push(120 - (120 - bottom) * Math.sin((Math.PI * i) / (perRep - 1)));
      }
    }
    const out = repDepths(metricsWith(series, 12));
    expect(out).not.toBeNull();
    const depths = out?.depths ?? [];
    const early = depths.slice(0, 3);
    const late = depths.slice(-2);
    expect(Math.max(...early)).toBeLessThan(Math.min(...late));
  });

  it("returns null when the movement does not repeat", () => {
    const oneSquat = Array.from({ length: 150 }, (_, i) => 170 - 100 * Math.sin((Math.PI * i) / 149));
    expect(repDepths(metricsWith(oneSquat, 10))).toBeNull();
    expect(repDepths({ ...metricsWith([], 10), series: undefined })).toBeNull();
  });
});
