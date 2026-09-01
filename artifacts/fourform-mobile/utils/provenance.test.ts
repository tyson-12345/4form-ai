import { describe, expect, it } from "vitest";
import { provenance } from "./provenance";

describe("provenance", () => {
  it("includes the rep count when the movement repeated", () => {
    expect(provenance({ frameCount: 90, detectedReps: 4 })).toBe("4 REPS · 90 FRAMES MEASURED");
  });

  it("shows frames alone when nothing repeated", () => {
    expect(provenance({ frameCount: 90, detectedReps: null })).toBe("90 FRAMES MEASURED");
    expect(provenance({ frameCount: 90 })).toBe("90 FRAMES MEASURED");
  });

  it("is null with no usable frame count — a stamp must never read 0 FRAMES", () => {
    expect(provenance(null)).toBeNull();
    expect(provenance(undefined)).toBeNull();
    expect(provenance({})).toBeNull();
    expect(provenance({ frameCount: 0 })).toBeNull();
  });

  it("never claims reps without frames to back them", () => {
    expect(provenance({ frameCount: 0, detectedReps: 4 })).toBeNull();
  });
});
