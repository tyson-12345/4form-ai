import { describe, it, expect } from "vitest";
import { deriveMuscleLoad } from "./muscleLoad";

/**
 * The joint→muscle inference behind the muscle map. The map colours body parts
 * on the strength of these rules, so what must hold is: measured joints light
 * only their own muscles, flags outrank effort, and nothing lights up on data
 * we do not have.
 */

const frames = 200;

describe("deriveMuscleLoad", () => {
  it("lights the thigh and calf from a hard-working knee", () => {
    const load = deriveMuscleLoad({
      frameCount: frames,
      joints: { leftKnee: { min: 45, max: 140 } }, // 95° of travel — a real stride
    });
    expect(load.left.quads.work).toBeGreaterThan(0.9);
    expect(load.left.hamstrings.work).toBeGreaterThan(0.9);
    expect(load.left.calves.work).toBeGreaterThan(0.9);
    // The other side and other groups stay dark.
    expect(load.right.quads.work).toBe(0);
    expect(load.left.biceps.work).toBe(0);
    expect(load.assessed).toBe(true);
  });

  it("keeps flag colour above effort colour", () => {
    const load = deriveMuscleLoad({
      frameCount: frames,
      joints: { rightHip: { min: 60, max: 150 } },
      riskFrames: { rightHip: { caution: 10, risk: 30 } }, // 15% in the risk band
    });
    expect(load.right.glutes.lvl).toBe(2);
    expect(load.right.hipFlexors.lvl).toBe(2);
    expect(load.right.lowerBack.lvl).toBe(2);
    expect(load.left.glutes.lvl).toBe(0);
  });

  it("marks caution from caution-band time alone", () => {
    const load = deriveMuscleLoad({
      frameCount: frames,
      joints: { leftElbow: { min: 90, max: 170 } },
      riskFrames: { leftElbow: { caution: 40, risk: 0 } }, // 20% caution
    });
    expect(load.left.biceps.lvl).toBe(1);
    expect(load.left.triceps.lvl).toBe(1);
    expect(load.left.forearms.lvl).toBe(1);
  });

  it("stays below the flag thresholds for trivial band time", () => {
    const load = deriveMuscleLoad({
      frameCount: frames,
      joints: { leftKnee: { min: 40, max: 130 } },
      riskFrames: { leftKnee: { caution: 4, risk: 2 } }, // 2% / 1% — noise
    });
    expect(load.left.quads.lvl).toBe(0);
  });

  it("reports nothing assessed when nothing moved", () => {
    const load = deriveMuscleLoad({
      frameCount: frames,
      joints: { leftKnee: { min: 170, max: 178 } }, // standing still
    });
    expect(load.assessed).toBe(false);
    expect(load.left.quads.work).toBeLessThan(0.15);
  });

  it("reports nothing assessed with no joints at all", () => {
    const load = deriveMuscleLoad({ frameCount: 0, joints: {} });
    expect(load.assessed).toBe(false);
    expect(load.left.quads).toEqual({ lvl: 0, work: 0 });
    expect(load.right.forearms).toEqual({ lvl: 0, work: 0 });
  });
});
