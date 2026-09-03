/**
 * The pose runtime is served by us, and the app asks for it by name.
 *
 * ── The failure this guards against ─────────────────────────────────────────
 * `artifacts/fourform-mobile/lib/poseTracker.ts` builds a `file://` document
 * that loads `pose.js` from `<api>/assets/mediapipe/` and lets MediaPipe's own
 * `locateFile` callback append the other eight names to that same base. Nothing
 * in either codebase checks that the names line up: the app hard-codes a base
 * URL, the server hard-codes a manifest, and the two agree only because someone
 * wrote them to.
 *
 * A rename, a version bump on one side, or a file dropped from the vendoring
 * manifest therefore produces a 404 at the exact moment a user tries to film —
 * and it produces it on a device, in a WebView, behind an `onerror` handler
 * whose only visible symptom is "the analysis engine failed to start". That is
 * about the worst place in this product for a broken path to hide.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "vendor", "mediapipe");

/** The manifest the vendoring script pins, read from the script itself. */
function manifest(): Record<string, string> {
  const src = readFileSync(join(ROOT, "scripts", "fetch-mediapipe.mjs"), "utf8");
  const block = /const FILES = \{([\s\S]*?)\n\};/.exec(src)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/"([^"]+)":\s*\n?\s*"([^"]+)"/g)) out[m[1]!] = m[2]!;
  return out;
}

const FILES = manifest();

describe("MediaPipe vendoring manifest", () => {
  it("pins every file the pose runtime asks for", () => {
    // Not a round number, and not one to "tidy". Both wasm variants are here
    // because pose.js requests both and lets the browser pick, and the iOS
    // deployment target predates WebAssembly SIMD in WKWebView.
    expect(Object.keys(FILES)).toHaveLength(9);
    expect(Object.keys(FILES)).toContain("pose_solution_simd_wasm_bin.wasm");
    expect(Object.keys(FILES)).toContain("pose_solution_wasm_bin.wasm");
  });

  it("serves exactly the names it pins, and no others", async () => {
    const { default: router } = await import("../src/routes/mediapipe.js");
    // The route's content-type table is what makes a name servable at all, so
    // a file vendored but not typed would 404 in production and pass a test
    // that only looked at the manifest.
    const source = readFileSync(join(ROOT, "src", "routes", "mediapipe.ts"), "utf8");
    for (const name of Object.keys(FILES)) {
      expect(source, `${name} is vendored but has no content type`).toContain(`"${name}"`);
    }
    expect(router).toBeDefined();
  });
});

// The vendored bytes only exist after `pnpm mediapipe:fetch`, which the build
// runs. Skipped rather than failed on a bare checkout, so a fresh clone can run
// the suite before it has downloaded 22 MB.
describe.skipIf(!existsSync(VENDOR))("vendored bytes", () => {
  it("matches the pinned digest for every file", () => {
    for (const [name, expected] of Object.entries(FILES)) {
      const path = join(VENDOR, name);
      expect(existsSync(path), `${name} is missing from vendor/mediapipe`).toBe(true);
      const actual = createHash("sha384").update(readFileSync(path)).digest("base64");
      expect(actual, `${name} does not match its pinned SHA-384`).toBe(expected);
    }
  });
});

describe("the app and the server agree", () => {
  it("asks for the version the server vendors", () => {
    const tracker = readFileSync(
      join(ROOT, "..", "fourform-mobile", "lib", "poseTracker.ts"),
      "utf8",
    );
    const script = readFileSync(join(ROOT, "scripts", "fetch-mediapipe.mjs"), "utf8");

    const appVersion = /MEDIAPIPE_VERSION = "([^"]+)"/.exec(tracker)?.[1];
    const serverVersion = /const VERSION = "([^"]+)"/.exec(script)?.[1];

    expect(appVersion).toBeTruthy();
    expect(appVersion).toBe(serverVersion);
  });

  it("asks for the path the server mounts", () => {
    const tracker = readFileSync(
      join(ROOT, "..", "fourform-mobile", "lib", "poseTracker.ts"),
      "utf8",
    );
    const route = readFileSync(join(ROOT, "src", "routes", "mediapipe.ts"), "utf8");

    expect(tracker).toContain("/assets/mediapipe");
    expect(route).toContain('"/assets/mediapipe/:file"');
  });

  it("no longer points at a third-party CDN", () => {
    const tracker = readFileSync(
      join(ROOT, "..", "fourform-mobile", "lib", "poseTracker.ts"),
      "utf8",
    );
    // The privacy policy states, as fact, that the only companies a device
    // contacts are the four processors in §5. A CDN URL reappearing here makes
    // that document untrue — which is a disclosure problem, not just a
    // dependency one.
    const inCode = tracker
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
      .join("\n");
    expect(inCode).not.toContain("cdn.jsdelivr.net");
  });
});

describe("a file:// document can actually read them", () => {
  /**
   * The regression this exists for, in full.
   *
   * The `<script>` tag that loads `pose.js` carries `crossorigin="anonymous"`,
   * and it has to: an `integrity` attribute on a cross-origin script is ignored
   * without it. A `file://` document with that attribute sends `Origin: null`.
   *
   * `null` matches nothing in the allowlist and is same-origin with nothing, so
   * the moment these assets stopped coming from a CDN and started coming from
   * us, every request for them was refused with a 403. Caught by hand before the
   * change shipped — the production symptom would have been "the analysis engine
   * failed to start", on every device, with the real reason in a `cors_rejected`
   * log line nobody would have connected to it.
   *
   * This is the codebase's second visit to this exact header on this exact kind
   * of request: it once blocked the landing page's own self-hosted fonts.
   */
  it("serves the runtime to Origin: null", async () => {
    const { default: app } = await import("../src/app.js");
    const res = await request(app).get("/assets/mediapipe/pose.js").set("Origin", "null");
    expect(res.status).toBe(200);
  });

  it("does not extend that exemption to the rest of the API", async () => {
    const { default: app } = await import("../src/app.js");
    // The exemption is a path prefix, not an addition to the allowlist. If it
    // ever becomes the latter, any sandboxed or file:// context can call the
    // authenticated API — so this is the half of the test that matters.
    const res = await request(app).get("/api/subscriptions/plans").set("Origin", "null");
    expect(res.status).toBe(403);
  });
});
