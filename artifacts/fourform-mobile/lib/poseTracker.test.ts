import { describe, it, expect, vi } from "vitest";
import { buildPoseHtml } from "./poseTracker";

/**
 * `videoStore.ts` pulls in `@react-native-async-storage/async-storage`, which
 * transitively imports `react-native` itself — plain Flow/JSX source Vite's
 * SSR transform cannot parse outside a React Native runtime. `isLocalAppFile`
 * doesn't touch either dependency, but the module does at import time, so both
 * need a stand-in before `./videoStore` can be imported at all under vitest.
 * No other test in this package imports a module with this dependency yet,
 * so this is the first instance of the pattern rather than a re-use of one.
 */
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    setItem: vi.fn(async () => {}),
    getItem: vi.fn(async () => null),
    removeItem: vi.fn(async () => {}),
    getAllKeys: vi.fn(async () => []),
    multiRemove: vi.fn(async () => {}),
  },
}));

const FAKE_DOCUMENT_DIR = "file:///var/mobile/Containers/Data/Application/APP-ID/Documents/";
const FAKE_CACHE_DIR = "file:///var/mobile/Containers/Data/Application/APP-ID/Library/Caches/";

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: FAKE_DOCUMENT_DIR,
  cacheDirectory: FAKE_CACHE_DIR,
  getInfoAsync: vi.fn(async () => ({ exists: false })),
  makeDirectoryAsync: vi.fn(async () => {}),
  copyAsync: vi.fn(async () => {}),
  deleteAsync: vi.fn(async () => {}),
  readDirectoryAsync: vi.fn(async () => []),
}));

const { isLocalAppFile } = await import("./videoStore");

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

// ─── Script-context injection via videoUri (jsonForScript) ───────────────────

/**
 * The measure screen's `uri` param is reachable from a deep link, so
 * `videoUri` here is not a value this app produced — it's attacker input
 * flowing straight into an inline `<script>` in a WebView document loaded
 * with `allowUniversalAccessFromFileURLs`. `JSON.stringify` alone does not
 * escape for the *HTML* grammar wrapped around the script block, and the HTML
 * parser finds `</script` before any JavaScript parser sees the string at
 * all — so a value containing `</script><script>…` used to close our block
 * and open the attacker's, verbatim.
 */
describe("buildPoseHtml — script-context escaping of videoUri", () => {
  const XSS_PAYLOAD = 'x</script><script>alert(1)</script>';

  /** Pull the exact JS literal `buildPoseHtml` emitted for `var VIDEO_URI = …;`. */
  function videoUriLiteral(html: string): string {
    const match = html.match(/var VIDEO_URI = (.+);\r?\n/);
    if (!match) throw new Error("could not find the VIDEO_URI assignment in the emitted document");
    return match[1]!;
  }

  it("produces no closing script tag originating from the video URI", () => {
    const html = buildPoseHtml({ videoUri: XSS_PAYLOAD, mode: "scan" });

    // The raw payload — and in particular its closing tag — must not appear
    // anywhere in the document verbatim. If it did, an HTML parser would end
    // the legitimate script block right there and treat the rest as markup,
    // including a second, executing <script> the attacker supplied.
    expect(html).not.toContain(XSS_PAYLOAD);
    expect(html).not.toContain("</script><script>alert(1)</script>");

    // More precisely: the literal assigned to VIDEO_URI must contain no angle
    // brackets at all, so no `<script` / `</script` text — escaped or not —
    // can originate from it.
    const literal = videoUriLiteral(html);
    expect(literal).not.toMatch(/[<>]/);

    // And the payload must not have opened an extra inline script block: the
    // count of real <script> tags is unaffected by what's inside the string.
    const baseline = inlineScripts(buildPoseHtml({ videoUri: "file:///clip.mp4", mode: "scan" }));
    expect(inlineScripts(html)).toHaveLength(baseline.length);
  });

  it("still parses as the original string once a JS engine evaluates the escaped literal", () => {
    const html = buildPoseHtml({ videoUri: XSS_PAYLOAD, mode: "scan" });
    const literal = videoUriLiteral(html);

    // eslint-disable-next-line no-new-func -- exercising the literal exactly as a <script> tag's JS parser would.
    const parsed = new Function(`return (${literal});`)() as string;
    expect(parsed).toBe(XSS_PAYLOAD);
  });

  it("keeps the rest of the inline script parseable alongside the escaped value", () => {
    const html = buildPoseHtml({ videoUri: XSS_PAYLOAD, mode: "interactive" });
    const scripts = inlineScripts(html);
    expect(scripts.length).toBeGreaterThan(0);
    for (const src of scripts) {
      expect(() => new Function(src)).not.toThrow();
    }
  });
});

// ─── isLocalAppFile (videoStore.ts) ───────────────────────────────────────────

/**
 * `isLocalAppFile` is the gate `stageForWebView` relies on before copying a
 * caller-supplied URI next to the pose-tracker HTML and handing it to a
 * WebView with filesystem privileges. Anything that isn't a `file://` path
 * this app itself wrote must be refused.
 */
describe("isLocalAppFile", () => {
  it("rejects http(s) URLs", () => {
    expect(isLocalAppFile("http://evil.example/clip.mp4")).toBe(false);
    expect(isLocalAppFile("https://evil.example/clip.mp4")).toBe(false);
  });

  it("rejects data: URIs", () => {
    expect(isLocalAppFile("data:video/mp4;base64,AAAA")).toBe(false);
  });

  it("rejects javascript: URIs", () => {
    expect(isLocalAppFile("javascript:alert(1)")).toBe(false);
  });

  it("rejects a path that traverses out with ..", () => {
    expect(isLocalAppFile(`${FAKE_DOCUMENT_DIR}athlete-videos/../../../etc/passwd`)).toBe(false);
  });

  it("rejects a file:// path belonging to another app's sandbox", () => {
    expect(isLocalAppFile("file:///var/mobile/Containers/Data/Application/OTHER-APP-ID/Documents/clip.mp4")).toBe(
      false,
    );
  });

  it("accepts a file:// path actually inside this app's document directory", () => {
    expect(isLocalAppFile(`${FAKE_DOCUMENT_DIR}athlete-videos/some-analysis-id.mp4`)).toBe(true);
  });

  it("accepts a file:// path actually inside this app's cache directory", () => {
    expect(isLocalAppFile(`${FAKE_CACHE_DIR}pose-video.mp4`)).toBe(true);
  });
});
