/**
 * `GET /assets/mediapipe/:file` — the pose runtime, served from our own origin.
 *
 * ── Why this is not in landingPage.ts with the other assets ─────────────────
 * Those are base64-inlined into the bundle by esbuild, which is the right shape
 * for three fonts and two icons totalling a couple of hundred kilobytes. These
 * are 22 MB, and base64 would put roughly 28 MB of string literal into the
 * JavaScript. They are vendored to disk by `scripts/fetch-mediapipe.mjs` and
 * streamed from there.
 *
 * ── Why we serve them at all ────────────────────────────────────────────────
 * The WebView used to fetch them straight from jsDelivr — a free public CDN with
 * no data processing agreement and no Standard Contractual Clauses, receiving
 * every EU/UK athlete's IP address on every pose session. That is a transfer
 * with no contractual basis, and the privacy policy had to disclose it as one.
 * Serving them ourselves moves the request to a processor already named in that
 * document.
 *
 * ── Closed set, no directory ───────────────────────────────────────────────
 * The names come from the vendoring manifest, not from the filesystem and never
 * from the request. `req.params.file` is only ever used as a Map key, so there
 * is no path to traverse: `..%2f..%2fetc%2fpasswd` is simply a name that is not
 * in the map, and falls through to the JSON 404 like any other unknown route.
 */

import { Router, type IRouter } from "express";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/**
 * Where `scripts/fetch-mediapipe.mjs` puts them.
 *
 * ── Why this is a search and not one path ───────────────────────────────────
 * Resolved from this module rather than `process.cwd()`, which differs between
 * a local `tsx src/index.ts` and the image's `node dist/index.mjs`. But the
 * module's own depth differs too: in development this file is
 * `src/routes/mediapipe.ts`, two levels below the package root, while the build
 * bundles everything into a single `dist/index.mjs`, one level below it. A
 * single relative path is therefore correct in exactly one of the two — and the
 * wrong one fails at boot with nine "asset is missing" lines and a pose screen
 * that never loads, which is a miserable thing to debug from a deploy log.
 *
 * Both candidates are checked, nearest first.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

const VENDOR_DIR =
  [join(HERE, "..", "vendor", "mediapipe"), join(HERE, "..", "..", "vendor", "mediapipe")].find(
    (candidate) => existsSync(candidate),
  ) ?? join(HERE, "..", "..", "vendor", "mediapipe");

/** Content types, and — by being a closed list — the set of servable names. */
const TYPES: Record<string, string> = {
  "pose.js": "text/javascript; charset=utf-8",
  "pose_solution_packed_assets_loader.js": "text/javascript; charset=utf-8",
  "pose_solution_packed_assets.data": "application/octet-stream",
  "pose_solution_wasm_bin.js": "text/javascript; charset=utf-8",
  "pose_solution_wasm_bin.wasm": "application/wasm",
  "pose_solution_simd_wasm_bin.js": "text/javascript; charset=utf-8",
  "pose_solution_simd_wasm_bin.wasm": "application/wasm",
  "pose_web.binarypb": "application/octet-stream",
  "pose_landmark_full.tflite": "application/octet-stream",
};

/**
 * Read once at boot, held in memory.
 *
 * 22 MB resident is a real cost and it is the right trade here: these are served
 * on every cold pose session, they never change for a given deployment, and the
 * alternative is a synchronous disk read on the request path or a stream to
 * manage. A missing file is logged loudly rather than throwing — the server
 * still serves everything else, and the WebView has a documented failure path
 * (`window.__poseScriptFailed`) for a runtime it cannot load.
 */
const FILES = new Map<string, Buffer>();

for (const name of Object.keys(TYPES)) {
  const path = join(VENDOR_DIR, name);
  if (!existsSync(path)) {
    logger.error(
      { file: name, event: "mediapipe_asset_missing" },
      "MediaPipe asset is missing; pose tracking will not load. Run `pnpm mediapipe:fetch`.",
    );
    continue;
  }
  FILES.set(name, readFileSync(path));
}

if (FILES.size > 0) {
  const mb = [...FILES.values()].reduce((n, b) => n + b.byteLength, 0) / 1_000_000;
  logger.info(
    { count: FILES.size, megabytes: Number(mb.toFixed(1)), event: "mediapipe_assets_loaded" },
    "MediaPipe pose runtime loaded",
  );
}

router.get("/assets/mediapipe/:file", (req, res, next) => {
  const name = req.params.file;
  const body = FILES.get(name);
  if (!body) return next();

  res.setHeader("Content-Type", TYPES[name]!);
  // The version is pinned in the vendoring manifest, so these bytes are the only
  // bytes this URL will ever have for this deployment.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  /**
   * `cross-origin`, unlike the fonts' `same-origin`.
   *
   * The document asking for these is a `file://` page inside the app's WebView,
   * so every one of these requests *is* cross-origin by construction. The
   * global header block sets `same-site`, which would refuse them.
   */
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.status(200).send(body);
});

export default router;
