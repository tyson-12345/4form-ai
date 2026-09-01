import { describe, expect, it } from "vitest";
import { usualBand } from "./usualBand";

describe("usualBand", () => {
  it("has no band below three readings", () => {
    expect(usualBand([])).toBeNull();
    expect(usualBand([80])).toBeNull();
    expect(usualBand([80, 90])).toBeNull();
  });

  it("is symmetric at exactly three readings", () => {
    // The floor-indexed version returned [70, 80] here: the best session sat
    // outside the band the moment the athlete had the three it needs.
    expect(usualBand([70, 80, 90])).toEqual({ low: 75, high: 85 });
  });

  it("does not exclude the top reading at four", () => {
    const band = usualBand([70, 80, 90, 100])!;
    expect(band.high).toBeGreaterThan(90);
  });

  it("can be exceeded, which min/max never could", () => {
    // Today is always part of the history, so a min/max band always contained
    // it. This one does not have to.
    const scores = [60, 72, 74, 75, 76, 78, 95];
    const band = usualBand(scores)!;
    expect(band.high).toBeLessThan(95);
    expect(band.low).toBeGreaterThan(60);
  });

  it("is not blown open by a single bad clip", () => {
    const steady = [74, 75, 76, 77, 78];
    const withOutlier = [...steady, 12];
    const a = usualBand(steady)!;
    const b = usualBand(withOutlier)!;
    expect(b.high - b.low).toBeLessThan(a.high - a.low + 12);
  });

  it("ignores readings that are not finite", () => {
    expect(usualBand([70, 80, 90, NaN, Infinity])).toEqual({ low: 75, high: 85 });
  });

  it("does not mutate its input", () => {
    const scores = [90, 70, 80];
    usualBand(scores);
    expect(scores).toEqual([90, 70, 80]);
  });

  it("handles every reading being identical", () => {
    expect(usualBand([80, 80, 80])).toEqual({ low: 80, high: 80 });
  });
});

describe("usualBand, when the athlete is consistent", () => {
  it("does not render a zero-width band", () => {
    // Twelve sessions clustered on 88 collapse the quartiles exactly.
    const clustered = [74, 87, 87, 88, 88, 88, 88, 88, 88, 88, 88, 99];
    const band = usualBand(clustered)!;
    expect(band.high).toBeGreaterThan(band.low);
    expect(band).toEqual({ low: 74, high: 99 });
  });

  it("still prefers the quartiles when there is real spread", () => {
    const spread = [40, 55, 62, 70, 74, 78, 85, 92];
    const band = usualBand(spread)!;
    expect(band.low).toBeGreaterThan(40);
    expect(band.high).toBeLessThan(92);
  });

  it("survives every reading being identical", () => {
    expect(usualBand([80, 80, 80])).toEqual({ low: 80, high: 80 });
  });
});
