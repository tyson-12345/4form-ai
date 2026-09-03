/**
 * Vendor the MediaPipe Pose runtime into `vendor/mediapipe/`, verifying every
 * byte against a pinned hash.
 *
 * ── Why these files are served by us at all ─────────────────────────────────
 * They used to be fetched straight from jsDelivr by the WebView. jsDelivr is a
 * free public CDN with no data processing agreement and no Standard Contractual
 * Clauses, and it received every EU/UK athlete's IP address on every pose
 * session — a transfer to a third country with no contractual basis, which the
 * privacy policy then had to disclose as exactly that. Serving them from our own
 * origin moves the request to a processor we already name and already have an
 * agreement with.
 *
 * ── Why they are fetched here rather than committed ─────────────────────────
 * 21 MB. The existing assets (three fonts and two icons) are base64-inlined into
 * the bundle by esbuild, which is right for 200 kB of fonts and absurd for this:
 * base64 would make it ~28 MB of JavaScript. Committing them instead would put
 * 21 MB of vendor binaries in git forever. So they are downloaded at build time,
 * verified, and served from disk.
 *
 * ── Why the hashes are the point, not a nicety ──────────────────────────────
 * The old arrangement pinned an SRI hash on `pose.js` and on nothing else — so
 * 47 kB of the 21 MB was integrity-checked and the other 21 MB, including the
 * WebAssembly binary that actually runs and the model it runs against, was
 * accepted from a CDN on trust. This script refuses to write a file whose digest
 * does not match, so a compromised or substituted artifact fails the build
 * rather than shipping.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "vendor", "mediapipe");

/**
 * The pinned release. Must stay in step with `MEDIAPIPE_VERSION` in
 * artifacts/fourform-mobile/lib/poseTracker.ts — the app asks our server for
 * these names, and a version bump on one side alone is a 404 at the moment a
 * user tries to film.
 */
const VERSION = "0.5.1675469404";
const UPSTREAM = `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${VERSION}`;

/**
 * Every file `pose.js` requests through its `locateFile` callback, for this
 * app's configuration (`modelComplexity: 1`).
 *
 * Both wasm variants are here on purpose. `pose.js` requests both and lets the
 * browser's own feature detection pick one, and the iOS deployment target is
 * 15.1 while WKWebView only gained WebAssembly SIMD in 16.4 — so dropping the
 * non-SIMD fallback would silently break pose tracking on real supported
 * devices.
 *
 * Digests are SHA-384, base64 — the same form the SRI attribute takes, so the
 * one on `pose.js` in poseTracker.ts is directly comparable to the entry here.
 */
const FILES = {
  "pose.js":
    "qcJQ+n/ZcF15Xu2EoRupB4Av+GEAGeW0Td1mp2A90u0NdNLzLYQVMUq1Ax1YAHqk",
  "pose_solution_packed_assets_loader.js":
    "uX6+ouLDLw6XpHCIIHjeJ3m/U5fNh6dzoXuQUVThq2Ei/FQHxJtAINwOnSMQRjLK",
  "pose_solution_packed_assets.data":
    "EI8Lk/mR/7uPwkTa+2Iv/i0twGfnvYXut+zg2t54QyG4qQsGnuJ9O7kXNQ8U7tDy",
  "pose_solution_wasm_bin.js":
    "ScjoSLjtMDZnOC1qdyAL0+OCfkmEX7bJ/Jj9MOP6Rknqbo18GmlGlImrdijS+BAC",
  "pose_solution_wasm_bin.wasm":
    "mXlrzBYcnTXh+7xv/hJWHl1MqWhiMbe8stOWeuGF0reQS5yhTRslhsDF5e7dN/Hi",
  "pose_solution_simd_wasm_bin.js":
    "FVYNA77JlOUDDvw/w2wKrf+nhL3ighCPRmSAJ4uQ0gGQN1p46g5hv0p6476J6eHV",
  "pose_solution_simd_wasm_bin.wasm":
    "9UYXdms/iXCYUFpybirxFGvHUoO66fVCZRR3wLuWKnwRC0ep0dgTImf4H/KVCzmq",
  "pose_web.binarypb":
    "YQQwslM+4Zz4f0yiRlmY36W2hMte1Jp79Z3KUK6vvX3r162N0ggQ9LRiaBBgl474",
  "pose_landmark_full.tflite":
    "qKONzXayIt/vBWsQw7tauo0e9bWo3uSNROgwys2Qej0BX0aREbrEYYuS8GRDVOEh",
};

const digest = (buf) => createHash("sha384").update(buf).digest("base64");

/** True when the file is already on disk and already correct. */
async function alreadyGood(path, expected) {
  try {
    await access(path);
  } catch {
    return false;
  }
  return digest(await readFile(path)).trim() === expected;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let fetched = 0;
  let skipped = 0;
  let bytes = 0;

  for (const [name, expected] of Object.entries(FILES)) {
    const path = join(OUT_DIR, name);

    if (await alreadyGood(path, expected)) {
      skipped += 1;
      bytes += (await readFile(path)).byteLength;
      continue;
    }

    const res = await fetch(`${UPSTREAM}/${name}`);
    if (!res.ok) {
      throw new Error(`${name}: upstream returned ${res.status} ${res.statusText}`);
    }
    const body = Buffer.from(await res.arrayBuffer());
    const actual = digest(body);

    if (actual !== expected) {
      // Never write it. A mismatch is either a substituted artifact or an
      // upstream that silently republished under the same version; both are
      // reasons to stop, not to continue with a warning.
      throw new Error(
        `${name}: digest mismatch.\n  expected sha384-${expected}\n  received sha384-${actual}\n` +
          `Refusing to vendor an artifact that is not the pinned one.`,
      );
    }

    await writeFile(path, body);
    fetched += 1;
    bytes += body.byteLength;
  }

  const mb = (bytes / 1_000_000).toFixed(1);
  console.log(
    `mediapipe@${VERSION}: ${fetched} fetched, ${skipped} already present, ${mb} MB verified in vendor/mediapipe/`,
  );
}

await main();
