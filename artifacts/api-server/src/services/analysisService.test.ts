import { describe, expect, it } from "vitest";
import { fallbackRiskDescription } from "./analysisService.js";

/**
 * The factual fallback prose every risk row is born with. It must agree with
 * the severity stamp shown beside it, which counts caution and risk frames
 * together (utils/flagSeverity.ts on the client). The bug this pins: a
 * caution-only finding used to read "spent 0% of the clip outside its typical
 * safe range" next to a stamp that said BRIEFLY.
 */
describe("fallbackRiskDescription", () => {
  const base = { joint: "leftKnee" as const, observedMin: 64, observedMax: 169 };

  it("describes a finding that entered both bands with both numbers", () => {
    const text = fallbackRiskDescription({ ...base, riskPercent: 9, cautionPercent: 13 });
    expect(text).toContain("9% of the clip in a high-strain position");
    expect(text).toContain("13% close to one");
    expect(text).toContain("left knee");
    expect(text).toContain("64–169°");
  });

  it("describes a risk-only finding without a phantom caution clause", () => {
    const text = fallbackRiskDescription({ ...base, riskPercent: 12, cautionPercent: 0 });
    expect(text).toContain("12% of the clip in a high-strain position");
    expect(text).not.toContain("close to one");
  });

  it("never says 0% for a caution-only finding", () => {
    const text = fallbackRiskDescription({ ...base, riskPercent: 0, cautionPercent: 7 });
    expect(text).not.toContain("0%");
    expect(text).toContain("7%");
    expect(text).toContain("near the edge");
  });

  it("keeps the evidence range in every variant", () => {
    for (const [risk, caution] of [
      [9, 13],
      [12, 0],
      [0, 7],
    ] as const) {
      expect(
        fallbackRiskDescription({ ...base, riskPercent: risk, cautionPercent: caution }),
      ).toContain("(observed 64–169°)");
    }
  });
});
