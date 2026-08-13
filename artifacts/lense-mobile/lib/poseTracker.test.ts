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

it("carries the per-frame angle series in the scan payload", () => {
  // Consistency is rep-to-rep agreement, which the aggregates cannot express.
  // If this stops being sent, consistency silently becomes null for everyone.
  const all = inlineScripts(buildPoseHtml({ videoUri: "file:///clip.mp4", mode: "scan" })).join("\n");
  expect(all).toContain("recordFrame");
  expect(all).toMatch(/series:\s*out/);
});
