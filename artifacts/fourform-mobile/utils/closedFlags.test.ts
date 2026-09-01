import { describe, expect, it } from "vitest";
import { closedFlagCount, closedFlags, type ClosedFlagSession } from "./closedFlags";

const session = (
  daysAgo: number,
  improvements: string[],
  over: Partial<ClosedFlagSession> = {},
): ClosedFlagSession => ({
  status: "complete",
  analysisMethod: "pose-measured",
  uploadedAt: new Date(Date.UTC(2026, 7, 20 - daysAgo)).toISOString(),
  improvements,
  ...over,
});

describe("closedFlags", () => {
  it("closes a joint named earlier and absent from the latest session", () => {
    const out = closedFlags([
      session(0, ["Lead with your chest out of the bottom."]),
      session(7, ["Your right knee is collapsing inward."]),
    ]);
    expect(out.map((f) => f.joint)).toEqual(["Right Knee"]);
  });

  it("does not close a joint that is still flagged", () => {
    const out = closedFlags([
      session(0, ["The right knee is still collapsing."]),
      session(7, ["Your right knee is collapsing inward."]),
    ]);
    expect(out).toEqual([]);
  });

  it("needs two measured sessions — one reading is not a comparison", () => {
    expect(closedFlags([session(0, ["right knee"])])).toEqual([]);
  });

  it("ignores sessions that were never measured", () => {
    const out = closedFlags([
      session(0, []),
      session(7, ["right knee"], { analysisMethod: "unscored" }),
      session(9, ["right knee"], { status: "failed" }),
    ]);
    expect(out).toEqual([]);
  });

  it("orders by the joint list, not by input order", () => {
    const out = closedFlags([
      session(0, []),
      session(7, ["right elbow and left knee both drifted"]),
    ]);
    expect(out.map((f) => f.joint)).toEqual(["Left Knee", "Right Elbow"]);
  });

  it("counts what the list contains — Profile and Progress cannot disagree", () => {
    const sessions = [session(0, []), session(7, ["left hip", "right knee"])];
    expect(closedFlagCount(sessions)).toBe(closedFlags(sessions).length);
    expect(closedFlagCount(sessions)).toBe(2);
  });

  it("takes the latest session by date, not by array position", () => {
    // Deliberately oldest-first: the old Profile maths trusted position.
    const out = closedFlags([
      session(7, ["your right knee is collapsing"]),
      session(0, ["chest up"]),
    ]);
    expect(out.map((f) => f.joint)).toEqual(["Right Knee"]);
  });
});
