import { it, expect } from "vitest";
import { buildPoseHtml } from "./poseTracker";

/**
 * The tracker's browser JS lives inside a template string, so TypeScript checks
 * none of it. These parse the emitted document instead — a syntax error here
 * would otherwise reach a phone before anyone noticed.
 */
const inlineScripts = (html: string) =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

for (const mode of ["scan", "interactive"] as const) {
  it(`emits parseable browser JS in ${mode} mode`, () => {
    const scripts = inlineScripts(buildPoseHtml({ videoUri: "file:///clip.mp4", mode }));
    expect(scripts.length).toBeGreaterThan(0);
    for (const src of scripts) {
      expect(() => new Function(src), src.slice(0, 140)).not.toThrow();
    }
  });
}

it("carries the camera-view measurement in the scan payload", () => {
  // Balance is gated on this. If it stops being sent, every clip silently
  // loses its symmetry score rather than failing loudly.
  const all = inlineScripts(buildPoseHtml({ videoUri: "file:///clip.mp4", mode: "scan" })).join("\n");
  expect(all).toContain("recordFacing");
  expect(all).toMatch(/facingRatio:\s*medianFacing\(\)/);
});

it("carries the per-frame angle series in the scan payload", () => {
  // Consistency is rep-to-rep agreement, which the aggregates cannot express.
  // If this stops being sent, consistency silently becomes null for everyone.
  const all = inlineScripts(buildPoseHtml({ videoUri: "file:///clip.mp4", mode: "scan" })).join("\n");
  expect(all).toContain("recordFrame");
  expect(all).toMatch(/series:\s*out/);
});

it("bakes the sport's risk zones into the document", () => {
  // A weightlifting clip must not classify against the boxing elbow band.
  const lifting = inlineScripts(
    buildPoseHtml({ videoUri: "file:///clip.mp4", mode: "scan", sport: "Weightlifting" }),
  ).join("\n");
  const boxing = inlineScripts(
    buildPoseHtml({ videoUri: "file:///clip.mp4", mode: "scan", sport: "Boxing" }),
  ).join("\n");
  expect(lifting).toContain('"id":"weightlifting"');
  expect(boxing).toContain('"id":"boxing"');
  expect(lifting).not.toBe(boxing);
});

it("falls back to the generic profile for an unknown sport", () => {
  const all = inlineScripts(
    buildPoseHtml({ videoUri: "file:///clip.mp4", mode: "scan", sport: "parkour???" }),
  ).join("\n");
  expect(all).toContain('"id":"generic"');
});

it("reports the applied profile in the scan payload", () => {
  // Provenance: the server stores the zones each clip was classified against,
  // so a stored finding is always read against the band that produced it.
  const all = inlineScripts(buildPoseHtml({ videoUri: "file:///clip.mp4", mode: "scan" })).join("\n");
  expect(all).toMatch(/riskProfile:\s*RISK_PROFILE/);
});
