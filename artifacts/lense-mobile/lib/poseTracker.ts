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

const MEDIAPIPE_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404";

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
 * KNOWN GAP: the WASM/model assets `pose.js` pulls at runtime via `locateFile`
 * are not SRI-covered (they are fetched by the wasm loader, not <script> tags).
 * The complete fix is to bundle all MediaPipe assets in the app and load them
 * from the local file system, which also lets both screens drop
 * `allowUniversalAccessFromFileURLs`. Tracked in docs/TODO-PRODUCTION.md.
 */
const MEDIAPIPE_POSE_SRI = "sha384-qcJQ+n/ZcF15Xu2EoRupB4Av+GEAGeW0Td1mp2A90u0NdNLzLYQVMUq1Ax1YAHqk";

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
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{width:100%;height:100%;overflow:hidden;background:#101312;font-family:-apple-system,sans-serif;color:#EDECE7}
#wrap{position:relative;width:100%;background:#000}
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
#ctrl{position:fixed;bottom:0;left:0;right:0;background:rgba(16,19,18,.96);
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
         <div class="lg"><span class="ld" style="background:#EDECE7"></span>IN RANGE</div>
         <div class="lg"><span class="ld" style="background:#8A8D89"></span>CAUTION</div>
         <div class="lg"><span class="ld" style="background:#C2542E"></span>FLAGGED</div>
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
  <p class="load-sub" id="loadSub">First run downloads ~6&nbsp;MB.<br>Later runs load from cache.</p>
</div>

<script src="${MEDIAPIPE_BASE}/pose.js" crossorigin="anonymous"
  integrity="${MEDIAPIPE_POSE_SRI}"
  onerror="window.__poseScriptFailed = true"></script>
<script>
(function(){
  "use strict";
  var VIDEO_URI = ${videoUri ? JSON.stringify(videoUri) : "null"};
  var IS_SCAN = ${isScan ? "true" : "false"};
  var SCAN_SAMPLES = ${SCAN_SAMPLES};
  // Sport-specific classification bands (see constants/riskProfiles.ts).
  // Serialized into the document so the WebView classifies frames against
  // exactly the profile this build selected — and reports it back as
  // provenance alongside the counts it produced.
  var ZONES = ${JSON.stringify(profile.zones)};
  var RISK_PROFILE = ${JSON.stringify({ id: profile.id, version: RISK_PROFILE_VERSION, zones: profile.zones })};

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
  var CONN=[[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[15,17],[15,19],[17,19],[12,14],[14,16],[16,18],[16,20],[18,20],[23,25],[25,27],[27,29],[27,31],[29,31],[24,26],[26,28],[28,30],[28,32],[30,32]];
  var KJ=[0,11,12,13,14,15,16,23,24,25,26,27,28];
  var RL=["#EDECE7","#8A8D89","#C2542E"];

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

    CONN.forEach(function(pair){
      var a = pair[0], b = pair[1];
      if (!vis(a) || !vis(b)) return;
      var pA = pt(a), pB = pt(b);
      var rm = Math.max(jr[a] ? jr[a].lvl : -1, jr[b] ? jr[b].lvl : -1);
      var col = rm >= 1 ? RL[rm] : "rgba(237,236,231,0.55)";
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = rm >= 1 ? 4.5 : 3.5; ctx.lineCap = "round";
      ctx.shadowBlur = rm >= 2 ? 17 : 10; ctx.shadowColor = col; ctx.globalAlpha = .92;
      ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.stroke();
      ctx.restore();
    });

    var seen = 0;
    KJ.forEach(function(i){
      if (!vis(i)) return;
      seen++;
      var p = pt(i), risk = jr[i];
      var col = risk ? RL[risk.lvl] : "#EDECE7";
      var r = risk && risk.lvl === 2 ? 9 : risk && risk.lvl === 1 ? 7.5 : 6.5;
      ctx.save();
      ctx.shadowBlur = 14; ctx.shadowColor = col;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#101312"; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill();
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
      sizeWrap();
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
      sizeWrap();
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

  function sizeWrap(){
    var ctrl = document.getElementById("ctrl");
    var h = ctrl ? ctrl.offsetHeight : 0;
    document.getElementById("wrap").style.height = (window.innerHeight - h) + "px";
  }
  window.addEventListener("resize", sizeWrap);
  sizeWrap();

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
