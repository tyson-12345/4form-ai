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
}

export type PoseMessage =
  | { type: "ready" }
  | { type: "meta"; vw: number; vh: number; dur: number }
  | { type: "progress"; done: number; total: number }
  | { type: "angles"; data: Record<JointKey, number>; risk: Record<JointKey, number>; maxLvl: number }
  | { type: "metrics"; metrics: PoseMetrics }
  | { type: "error"; message: string };

/** How many timestamps scan mode samples. Bounded so long clips stay quick. */
export const SCAN_SAMPLES = 90;

const MEDIAPIPE_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404";

export function buildPoseHtml(options: { videoUri?: string; mode: PoseMode }): string {
  const { videoUri, mode } = options;
  const isScan = mode === "scan";

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
  onerror="window.__poseScriptFailed = true"></script>
<script>
(function(){
  "use strict";
  var VIDEO_URI = ${videoUri ? JSON.stringify(videoUri) : "null"};
  var IS_SCAN = ${isScan ? "true" : "false"};
  var SCAN_SAMPLES = ${SCAN_SAMPLES};

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
  // Risk banding. Knees fail at both extremes (deep flexion / hyperextension);
  // hips only on deep flexion; elbows only on hyperextension.
  function lvl(a,loRisk,loWarn,hiWarn,hiRisk){
    if(a<=loRisk||a>=hiRisk) return 2;
    if(a<=loWarn||a>=hiWarn) return 1;
    return 0;
  }

  // ── Measurement accumulators (scan mode) ──
  var KEYS = ["leftKnee","rightKnee","leftHip","rightHip","leftElbow","rightElbow"];
  var acc = {};
  KEYS.forEach(function(k){
    acc[k] = { n:0, sum:0, sumSq:0, min:Infinity, max:-Infinity, caution:0, risk:0 };
  });
  var trackedFrames = 0, attemptedFrames = 0;

  function record(key, deg, level){
    var a = acc[key];
    a.n++; a.sum += deg; a.sumSq += deg*deg;
    if (deg < a.min) a.min = deg;
    if (deg > a.max) a.max = deg;
    if (level === 1) a.caution++;
    else if (level === 2) a.risk++;
  }

  function buildMetrics(){
    var joints = {}, riskFrames = {};
    KEYS.forEach(function(k){
      var a = acc[k];
      if (a.n === 0) return;
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
      riskFrames: riskFrames
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
    if(vis(23)&&vis(25)&&vis(27)){var a1=ang(pt(23),pt(25),pt(27));jr[25]={deg:a1,lvl:lvl(a1,70,90,175,178),key:"leftKnee"};}
    if(vis(24)&&vis(26)&&vis(28)){var a2=ang(pt(24),pt(26),pt(28));jr[26]={deg:a2,lvl:lvl(a2,70,90,175,178),key:"rightKnee"};}
    if(vis(11)&&vis(23)&&vis(25)){var a3=ang(pt(11),pt(23),pt(25));jr[23]={deg:a3,lvl:lvl(a3,55,80,999,999),key:"leftHip"};}
    if(vis(12)&&vis(24)&&vis(26)){var a4=ang(pt(12),pt(24),pt(26));jr[24]={deg:a4,lvl:lvl(a4,55,80,999,999),key:"rightHip"};}
    if(vis(11)&&vis(13)&&vis(15)){var a5=ang(pt(11),pt(13),pt(15));jr[13]={deg:a5,lvl:lvl(a5,-1,-1,160,172),key:"leftElbow"};}
    if(vis(12)&&vis(14)&&vis(16)){var a6=ang(pt(12),pt(14),pt(16));jr[14]={deg:a6,lvl:lvl(a6,-1,-1,160,172),key:"rightElbow"};}

    var measured = Object.keys(jr);
    if (measured.length > 0) {
      trackedFrames++;
      measured.forEach(function(idx){ record(jr[idx].key, jr[idx].deg, jr[idx].lvl); });
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

  pose.initialize().then(function(){
    clearTimeout(initTimeout);
    post({ type:"ready" });
    if (IS_SCAN) {
      if (planScan()) { armWatchdog(); seekTo(scanTimes[0]); }
    } else {
      loading.classList.add("hide");
      if (btxt) btxt.textContent = "Ready — press play";
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
