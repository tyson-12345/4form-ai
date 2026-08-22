import { describe, expect, it } from "vitest";
import { bandScale } from "./bandScale";

const num = (p: `${number}%`) => Number(p.slice(0, -1));

describe("bandScale", () => {
  it("keeps the default window when everything fits inside it", () => {
    const sc = bandScale(40, 100, [70, 60, 80], 20);
    expect([sc.from, sc.to]).toEqual([40, 100]);
    expect(num(sc.pct(70))).toBeCloseTo(50);
  });

  it("widens rather than clamps when a reading falls below the window", () => {
    // The real case: Form Index 22 against the 40–100 default. It used to pin
    // to 0% and draw exactly where a 40 draws.
    const sc = bandScale(40, 100, [22, 22, 93], 20);
    expect(sc.from).toBe(20);
    expect(num(sc.pct(22))).toBeGreaterThan(0);
    expect(num(sc.pct(22))).not.toBeCloseTo(num(sc.pct(40)));
  });

  it("widens above the window too", () => {
    const sc = bandScale(40, 100, [118], 20);
    expect(sc.to).toBe(120);
    expect(num(sc.pct(118))).toBeLessThan(100);
  });

  it("rounds the window outward to the step so axis labels stay round", () => {
    const sc = bandScale(40, 100, [23], 20);
    expect(sc.from).toBe(20);
    const sc5 = bandScale(40, 100, [23], 5);
    expect(sc5.from).toBe(20);
    const sc1 = bandScale(40, 100, [23], 1);
    expect(sc1.from).toBe(23);
  });

  it("never lets a fill run past the right edge — the 118%-wide band bug", () => {
    const sc = bandScale(40, 100, [22, 22, 93], 20);
    const w = num(sc.fillWidth(22, 93, 2));
    expect(w).toBeLessThanOrEqual(100 - sc.ratio(22) + 0.001);
    expect(w).toBeLessThanOrEqual(100);
  });

  it("clamps a fill that starts inside and would end outside", () => {
    // A caller passing a hi beyond the computed window still cannot overflow.
    const sc = bandScale(0, 100, [50], 1);
    expect(num(sc.fillWidth(90, 400, 2))).toBeLessThanOrEqual(10.001);
  });

  it("honours the minimum fill width so a zero-width band is still visible", () => {
    const sc = bandScale(40, 100, [70], 20);
    expect(num(sc.fillWidth(70, 70, 4))).toBe(4);
  });

  it("ignores nulls, undefined and non-finite values", () => {
    const sc = bandScale(40, 100, [null, undefined, NaN, Infinity, 70], 20);
    expect([sc.from, sc.to]).toEqual([40, 100]);
  });

  it("survives being given no values at all", () => {
    const sc = bandScale(40, 100, [], 20);
    expect([sc.from, sc.to]).toEqual([40, 100]);
    expect(num(sc.pct(40))).toBe(0);
    expect(num(sc.pct(100))).toBe(100);
  });

  it("never divides by zero when the window collapses", () => {
    const sc = bandScale(50, 50, [50], 1);
    expect(Number.isFinite(num(sc.pct(50)))).toBe(true);
  });

  it("clamps positions to the track", () => {
    const sc = bandScale(40, 100, [], 20);
    expect(num(sc.pct(-999))).toBe(0);
    expect(num(sc.pct(999))).toBe(100);
  });
});
