/**
 * Deterministic biomechanics scoring.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * Scores used to come out of Claude, which was handed nothing but a sport name
 * and the title the user typed. There was no measurement anywhere in the path,
 * so the same clip uploaded twice produced different numbers, and every score
 * shown to the user was a plausible-sounding invention.
 *
 * Scores are now computed here, in pure functions, from joint angles actually
 * measured by MediaPipe in the client. The same metrics always produce the same
 * scores. Claude is still used — but only to *explain* these numbers, never to
 * produce them.
 *
 * ── What we can and cannot measure ──────────────────────────────────────────
 * A 2D pose estimate gives joint angles over time. From that we can honestly
 * derive range of motion, left/right symmetry, movement smoothness, and time
 * spent in high-strain joint positions.
 *
 * We cannot derive force, power, or ground-contact time from 2D angles without
 * a calibrated scale, mass, and camera geometry. Those scores are therefore
 * reported as `null` rather than filled with a number that looks measured but
 * isn't. `null` renders as "Not measured" in the app.
 */

/** Per-joint angle statistics over the analysed frames, in degrees. */
export interface JointStats {
  min: number;
  max: number;
  mean: number;
  /** Standard deviation — a proxy for how repeatable the movement was. */
  stdDev: number;
}

export type JointKey =
  | "leftKnee"
  | "rightKnee"
  | "leftHip"
  | "rightHip"
  | "leftElbow"
  | "rightElbow";

export const JOINT_KEYS: readonly JointKey[] = [
  "leftKnee",
  "rightKnee",
  "leftHip",
  "rightHip",
  "leftElbow",
  "rightElbow",
];

/**
 * Per-joint angle readings, one entry per tracked frame, in capture order.
 *
 * `null` marks a frame where that joint was not visible — the arrays stay index
 * aligned across joints so a single frame index means the same instant for all
 * of them. Optional because clips measured by app builds before this shipped
 * carry no series at all; see `consistencyScore` for what happens then.
 */
export type JointSeries = Partial<Record<JointKey, (number | null)[]>>;

/**
 * Classification zones for one joint kind, in degrees. A frame is "risk" at or
 * below `loRisk` / at or above `hiRisk`, "caution" at or below `loWarn` / at or
 * above `hiWarn`. `-1` disables the low side, `999` the high side.
 *
 * ── Why these are "bands" and never "safe" ──────────────────────────────────
 * A zone is a sport-typical joint-angle range and nothing more. Calling the
 * inside of one "safe" upgrades a geometry reading into a medical-adjacent
 * claim — that staying inside will not hurt you, and that leaving it will —
 * which is precisely the claim this app declines to make everywhere else (every
 * coaching surface carries "Not a medical assessment or an injury prediction").
 *
 * So the vocabulary, everywhere a person can reach it: a reading sits inside a
 * *band*, or it is *outside the band*. That covers rendered strings, the
 * fallback finding copy, and the model prompt in lib/claude.ts — the prompt
 * counts, because the model reuses its own prompt's words in the coaching text
 * the athlete then reads.
 *
 * The `safeMin`/`safeMax` fields on `RiskFinding` are the sole holdout, for a
 * wire-compatibility reason spelled out there.
 */
export interface JointZones {
  loRisk: number;
  loWarn: number;
  hiWarn: number;
  hiRisk: number;
}

/** Zones per joint kind; symmetric left/right. */
export interface RiskZones {
  knee: JointZones;
  hip: JointZones;
  elbow: JointZones;
}

/**
 * The bands the tracker used before sport profiles existed. Clips whose
 * metrics carry no `riskProfile` were classified against these — kept verbatim
 * (mirroring the client's constants/riskProfiles.ts) so legacy findings can
 * still be captioned with the band that actually produced them.
 */
export const LEGACY_ZONES: RiskZones = {
  knee: { loRisk: 70, loWarn: 90, hiWarn: 175, hiRisk: 178 },
  hip: { loRisk: 55, loWarn: 80, hiWarn: 999, hiRisk: 999 },
  elbow: { loRisk: -1, loWarn: -1, hiWarn: 160, hiRisk: 172 },
};

export interface PoseMetrics {
  /** Frames on which a pose was detected with acceptable confidence. */
  frameCount: number;
  /** Fraction (0–1) of sampled frames where the athlete was reliably tracked. */
  trackingQuality: number;
  durationSec: number;
  joints: Partial<Record<JointKey, JointStats>>;
  /** Frames where each joint sat in a caution (lvl 1) or risk (lvl 2) range. */
  riskFrames: Partial<Record<JointKey, { caution: number; risk: number }>>;
  /**
   * The sport risk profile the client classified frames against — provenance
   * for every `riskFrames` count. Sport-specific because what counts as a
   * flag-worthy position differs by sport: a locked elbow overhead is required
   * technique in weightlifting and a caution sign in gymnastics. Absent on
   * clips from app builds predating profiles; those used `LEGACY_ZONES`.
   */
  riskProfile?: {
    id: string;
    version: number;
    zones: RiskZones;
  };
  /** Ordered angle readings per joint. Absent on clips from older app builds. */
  series?: JointSeries;
  /**
   * Median shoulder-and-hip width against torso length — how square the athlete
   * stood to the camera. Absent on clips from older app builds; `null` when the
   * torso was never fully visible. See `balanceScore`.
   */
  facingRatio?: number | null;
  /**
   * Repetitions detected by `detectReps`. Server-derived at scoring time and
   * stored back into the metrics; never accepted from the client (the request
   * schema does not include it). `null` when the movement did not repeat.
   */
  detectedReps?: number | null;
}

export interface Scores {
  overall: number | null;
  technique: number | null;
  balance: number | null;
  consistency: number | null;
  mobility: number | null;
  /** Not derivable from 2D pose angles — always null. See module header. */
  power: null;
  /** Not derivable from 2D pose angles — always null. See module header. */
  speed: null;
}

/** Minimum tracked frames before any score is statistically meaningful. */
export const MIN_FRAMES_FOR_SCORING = 20;

/** Minimum tracking quality before we trust the measurements at all. */
export const MIN_TRACKING_QUALITY = 0.5;

export function clamp(value: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

const round = (n: number): number => Math.round(n);

/**
 * True when metrics are good enough to score. Below this bar we return all-null
 * scores rather than numbers derived from a handful of noisy frames.
 */
export function isScorable(metrics: PoseMetrics): boolean {
  return (
    metrics.frameCount >= MIN_FRAMES_FOR_SCORING &&
    metrics.trackingQuality >= MIN_TRACKING_QUALITY &&
    Object.keys(metrics.joints).length > 0
  );
}

/**
 * Technique — the share of tracked time spent outside the sport's joint bands.
 *
 * A frame in the "risk" band costs twice what a "caution" frame costs, so a
 * brief excursion into an extreme position outweighs a long mildly-suboptimal
 * one. 100 means no frame left its band.
 */
export function techniqueScore(metrics: PoseMetrics): number | null {
  const tracked = metrics.frameCount;
  if (tracked <= 0) return null;

  const measured = Object.keys(metrics.riskFrames).length;
  if (measured === 0) return null;

  let weighted = 0;
  for (const key of JOINT_KEYS) {
    const rf = metrics.riskFrames[key];
    if (!rf) continue;
    weighted += (rf.caution + rf.risk * 2) / tracked;
  }

  const meanPenalty = weighted / measured; // 0 (clean) .. 2 (always in risk)
  return round(clamp(100 - meanPenalty * 100));
}

/**
 * How square to the camera the athlete must be before left/right symmetry means
 * anything.
 *
 * Filmed square-on the ratio sits near 0.75 — shoulder breadth is roughly 0.85
 * of shoulder-to-hip length and hip breadth roughly 0.65. In true profile it
 * collapses to about 0.1. 0.35 sits between them, at roughly 28° off profile,
 * with margin for body-type variation and for the torso pitch of a deep hinge.
 *
 * The failure direction is deliberate: an ambiguous view returns `null` rather
 * than a number we cannot stand behind.
 */
const MIN_FACING_RATIO_FOR_BALANCE = 0.35;

/**
 * Balance — left/right symmetry, when the camera angle can actually show it.
 *
 * Compares the mean angle of each paired joint. A 30° mean difference scores 0;
 * identical sides score 100. Pairs where only one side was tracked are skipped
 * rather than assumed symmetric.
 *
 * ── Why the view gate exists ────────────────────────────────────────────────
 * Every filming instruction in the app asks for side-on, and it is right to:
 * that is the view where knee, hip and elbow flexion project cleanly, which is
 * what Technique and Mobility are built from. It is also the one view where the
 * far side of the body is behind the near side. MediaPipe still emits landmarks
 * for the occluded limb — inferred, not seen — and the visibility gate in the
 * tracker is permissive enough to let them through.
 *
 * So this score was being computed, and reported with the same confidence as
 * the rest, from the least reliable measurement the recommended camera angle
 * can produce. It now returns `null` unless the athlete was square enough for
 * both sides to be genuinely visible. That means most clips shot to our own
 * guidance will not carry a Balance score — which is the honest outcome, and
 * the same choice already made for power and speed.
 *
 * Clips from app builds that predate `facingRatio` also return `null`: the
 * measurement may have been fine or may have been occluded, and there is no way
 * to tell after the fact.
 */
export function balanceScore(metrics: PoseMetrics): number | null {
  if (metrics.facingRatio == null) return null;
  if (metrics.facingRatio < MIN_FACING_RATIO_FOR_BALANCE) return null;
  return rawBalanceScore(metrics);
}

/** The symmetry comparison itself, once the view has been judged usable. */
function rawBalanceScore(metrics: PoseMetrics): number | null {
  const pairs: [JointKey, JointKey][] = [
    ["leftKnee", "rightKnee"],
    ["leftHip", "rightHip"],
    ["leftElbow", "rightElbow"],
  ];

  const deltas: number[] = [];
  for (const [l, r] of pairs) {
    const left = metrics.joints[l];
    const right = metrics.joints[r];
    if (!left || !right) continue;
    deltas.push(Math.abs(left.mean - right.mean));
  }

  if (deltas.length === 0) return null;

  const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const DEGREES_FOR_ZERO = 30;
  return round(clamp(100 - (meanDelta / DEGREES_FOR_ZERO) * 100));
}

// ─── Consistency ─────────────────────────────────────────────────────────────
//
// ── What this used to do, and why it was replaced ───────────────────────────
// The previous implementation scored `stdDev / range` per joint, mapping 0.4 to
// zero. That number cannot measure repeatability, because it is fixed by the
// *shape* of the motion rather than by the athlete: a smooth full-range rep sits
// at ≈0.354 and a linear one at ≈0.289 no matter how well or badly it is
// performed. A textbook-perfect squat scored 12/100, and standing almost still
// scored 25 — higher — because low travel produces both a small deviation and a
// small range. The metric was inverted, and it capped every athlete's overall
// score near 80 because overall is an unweighted mean.
//
// Repeatability is a property of the *sequence*, so it cannot be recovered from
// a standard deviation at all. It needs the ordered readings, which the tracker
// now sends. A clip with no detectable repetition — a single rep, a static hold,
// a warm-up wander — has no repeatability to measure, and returns `null` rather
// than a number, exactly as power and speed do.

/** Fewest frames a cycle may span before it is noise rather than a repetition. */
const MIN_PERIOD_FRAMES = 4;

/** How strongly the signal must repeat before we accept a period at all. */
const MIN_AUTOCORRELATION = 0.5;

/** Fraction of frames a joint must be visible for before we trust its series. */
const MIN_JOINT_COVERAGE = 0.6;

/** Points each cycle is resampled to before cycles are compared. */
const CYCLE_RESOLUTION = 32;

/**
 * Mean rep-to-rep deviation, in degrees, that scores zero.
 *
 * 15° is roughly the point where two reps stop looking like the same movement
 * to the eye. Elite repeatability sits near 3–5°.
 */
const DEVIATION_FOR_ZERO_DEG = 15;

/**
 * Fill visibility gaps by linear interpolation, and trim the unmeasured ends.
 *
 * Returns `null` when the joint was visible for too little of the clip to be
 * worth comparing — an occluded far-side limb interpolated across half the clip
 * would otherwise contribute invented smoothness.
 */
function cleanSeries(raw: (number | null)[]): number[] | null {
  const first = raw.findIndex((v) => v !== null);
  if (first === -1) return null;
  let last = raw.length - 1;
  while (last > first && raw[last] === null) last--;

  const span = raw.slice(first, last + 1);
  const seen = span.filter((v) => v !== null).length;
  if (seen / raw.length < MIN_JOINT_COVERAGE) return null;

  const out: number[] = [];
  for (let i = 0; i < span.length; i++) {
    const v = span[i];
    if (v !== null) {
      out.push(v);
      continue;
    }
    // Bridge the gap between the nearest real readings either side.
    let prev = i - 1;
    while (prev >= 0 && span[prev] === null) prev--;
    let next = i + 1;
    while (next < span.length && span[next] === null) next++;
    if (prev < 0 || next >= span.length) {
      out.push(span[prev >= 0 ? prev : next] as number);
      continue;
    }
    const a = span[prev] as number;
    const b = span[next] as number;
    out.push(a + ((b - a) * (i - prev)) / (next - prev));
  }
  return out;
}

/**
 * The repetition period of a signal, in frames, or `null` if it does not repeat.
 *
 * Normalised autocorrelation rather than peak-finding: peak detection needs
 * thresholds that differ per movement, while autocorrelation asks the question
 * directly — "does this signal look like itself, shifted?" — and answers it on
 * the same scale for a squat and a sprint stride.
 */
function findPeriod(signal: number[]): number | null {
  const n = signal.length;
  const maxLag = Math.floor(n / 2);
  if (maxLag < MIN_PERIOD_FRAMES) return null;

  const mean = signal.reduce((a, b) => a + b, 0) / n;
  const centred = signal.map((v) => v - mean);

  const r: number[] = new Array<number>(maxLag + 1).fill(0);
  for (let lag = 1; lag <= maxLag; lag++) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i + lag < n; i++) {
      dot += centred[i] * centred[i + lag];
      normA += centred[i] * centred[i];
      normB += centred[i + lag] * centred[i + lag];
    }
    r[lag] = normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
  }

  // Look for a local maximum, not merely a lag that clears the threshold.
  //
  // Any smooth signal resembles itself at short lags, so a single slow rep
  // scores highly at a lag of a few frames and would be reported as a rapid
  // repetition — which is how an unrepeated movement ends up scored as a very
  // inconsistent one. What separates real repetition from mere smoothness is
  // that repetition puts a *peak* back into the autocorrelation after it has
  // fallen away; a lone arc only ever declines.
  interface Peak {
    lag: number;
    score: number;
  }
  const peaks: Peak[] = [];
  for (let lag = MIN_PERIOD_FRAMES; lag < maxLag; lag++) {
    const isPeak = r[lag] > r[lag - 1] && r[lag] >= r[lag + 1];
    if (isPeak && r[lag] > MIN_AUTOCORRELATION) peaks.push({ lag, score: r[lag] });
  }
  if (peaks.length === 0) return null;

  // Prefer the *fundamental*, not the tallest peak. Real reps carry noise, and
  // noise can nudge the correlation at 2× the true period a hair above the
  // correlation at the period itself — the "octave error" of pitch detection.
  // Taking the tallest peak then halves the rep count and coarsens the
  // consistency comparison. So: find the best score, then take the shortest
  // peak lag that comes close to it.
  const best = peaks.reduce((a, b) => (b.score > a.score ? b : a));
  const OCTAVE_TOLERANCE = 0.9;
  for (const peak of peaks) {
    if (peak.score >= best.score * OCTAVE_TOLERANCE) return peak.lag;
  }
  return best.lag;
}

/** Resample `slice` onto a fixed number of points so cycles can be compared. */
function resample(slice: number[], points: number): number[] {
  if (slice.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const pos = (i * (slice.length - 1)) / (points - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(slice.length - 1, lo + 1);
    out.push(slice[lo] + (slice[hi] - slice[lo]) * (pos - lo));
  }
  return out;
}

/**
 * Mean spread between repetitions of `signal`, in degrees.
 *
 * Each cycle is resampled to a common length, then we take the standard
 * deviation across cycles at each point of the movement and average it. The
 * result reads directly: "your reps differ by about N degrees".
 */
function cycleSpreadDegrees(signal: number[], period: number): number | null {
  const cycles = Math.floor(signal.length / period);
  if (cycles < 2) return null;

  const shapes: number[][] = [];
  for (let c = 0; c < cycles; c++) {
    shapes.push(resample(signal.slice(c * period, (c + 1) * period), CYCLE_RESOLUTION));
  }

  let total = 0;
  for (let i = 0; i < CYCLE_RESOLUTION; i++) {
    const at = shapes.map((s) => s[i]);
    const mean = at.reduce((a, b) => a + b, 0) / at.length;
    total += Math.sqrt(at.reduce((a, v) => a + (v - mean) ** 2, 0) / at.length);
  }
  return total / CYCLE_RESOLUTION;
}

/**
 * Clean every joint series and find the movement's repetition period.
 *
 * The period is a property of the whole body, so it is found once — on the
 * joint that travels furthest, which carries the movement's rhythm most
 * clearly — and then applied to all joints. Shared by `consistencyScore` and
 * `detectReps` so the two can never disagree about what a rep is.
 */
function cleanedSeriesWithPeriod(metrics: PoseMetrics): {
  cleaned: { key: JointKey; signal: number[]; range: number }[];
  period: number;
} | null {
  if (!metrics.series) return null;

  const cleaned: { key: JointKey; signal: number[]; range: number }[] = [];
  for (const key of JOINT_KEYS) {
    const raw = metrics.series[key];
    if (!raw || raw.length === 0) continue;
    const signal = cleanSeries(raw);
    if (!signal || signal.length < MIN_PERIOD_FRAMES * 2) continue;
    cleaned.push({ key, signal, range: Math.max(...signal) - Math.min(...signal) });
  }
  if (cleaned.length === 0) return null;

  const driver = cleaned.reduce((a, b) => (b.range > a.range ? b : a));
  const period = findPeriod(driver.signal);
  if (period === null) return null;

  return { cleaned, period };
}

/**
 * How many repetitions the clip contains, or `null` when the movement does
 * not detectably repeat (a single rep, a hold, or no usable series).
 *
 * Derived from the same autocorrelation the consistency score runs on — the
 * count was always computed and then thrown away. It is honest data with an
 * obvious home in the UI ("4 REPS"), so it is now surfaced.
 */
export function detectReps(metrics: PoseMetrics): number | null {
  const found = cleanedSeriesWithPeriod(metrics);
  if (!found) return null;

  const driver = found.cleaned.reduce((a, b) => (b.range > a.range ? b : a));
  const reps = Math.floor(driver.signal.length / found.period);
  return reps >= 2 ? reps : null;
}

/**
 * The shape of the clip's effort, measured — not which sport it is.
 *
 * Angle ranges alone cannot tell a running stride from a volleyball rally: both
 * take the knee through similar arcs. What separates them is *rhythm* — a gait
 * cycles without pause for the whole clip, while court sports come in bursts
 * with stiller frames between. That rhythm is sitting in the series data the
 * client already sends; this reads it out so the narrative model reasons from
 * measured tempo instead of guessing from angles.
 *
 * Deliberately descriptive, never conclusive: it reports "continuous-cyclic at
 * 1.4 cycles/sec", not "this is running". Naming the sport is a judgement that
 * belongs where the sport context lives, with the model.
 */
export interface MovementSignature {
  /** The joint that travels furthest — the one carrying the movement. */
  driverJoint: JointKey;
  /** Degrees of travel on that joint. */
  driverRange: number;
  /** Repetition rate, when the movement repeats. Null for a single effort. */
  cyclesPerSec: number | null;
  /** Fraction of sampled frames where the driver joint is meaningfully away from its rest position. */
  activeFraction: number;
  pattern: "continuous-cyclic" | "repeated-efforts" | "single-effort-or-hold" | "mostly-still";
}

/** Degrees a reading must deviate from the joint's mean to count as "moving". */
const ACTIVE_DEVIATION_DEG = 10;

export function movementSignature(metrics: PoseMetrics): MovementSignature | null {
  if (!metrics.series || metrics.durationSec <= 0) return null;

  let driver: { key: JointKey; signal: number[]; rawLength: number } | null = null;
  let driverRange = 0;
  for (const key of JOINT_KEYS) {
    const raw = metrics.series[key];
    if (!raw || raw.length === 0) continue;
    const signal = cleanSeries(raw);
    if (!signal || signal.length < MIN_PERIOD_FRAMES * 2) continue;
    const range = Math.max(...signal) - Math.min(...signal);
    if (range > driverRange) {
      driverRange = range;
      driver = { key, signal, rawLength: raw.length };
    }
  }
  if (!driver) return null;

  const { signal } = driver;
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const activeFraction =
    signal.filter((v) => Math.abs(v - mean) > ACTIVE_DEVIATION_DEG).length / signal.length;

  // Sample rate comes from the raw series: samples are spread evenly across the
  // clip, so rawLength / duration is the rate even after cleaning trimmed the ends.
  const samplesPerSec = driver.rawLength / metrics.durationSec;
  const period = findPeriod(signal);
  const cycles = period === null ? 0 : Math.floor(signal.length / period);
  const cyclesPerSec = period === null || cycles < 2 ? null : samplesPerSec / period;

  // A still clip has no tempo worth reporting: sensor flicker of a degree or
  // two "repeats" as far as autocorrelation is concerned, and reporting it as
  // 3.75 cycles/sec would hand the model a rhythm that does not exist.
  if (driverRange < 15) {
    return {
      driverJoint: driver.key,
      driverRange,
      cyclesPerSec: null,
      activeFraction,
      pattern: "mostly-still",
    };
  }

  let pattern: MovementSignature["pattern"];
  if (cyclesPerSec !== null && cycles >= 3 && activeFraction >= 0.5) {
    // Repeats, keeps repeating, and is in motion most of the time: a gait or a
    // continuous drill, not a sequence of separate efforts.
    pattern = "continuous-cyclic";
  } else if (cyclesPerSec !== null) {
    pattern = "repeated-efforts";
  } else {
    pattern = "single-effort-or-hold";
  }

  return { driverJoint: driver.key, driverRange, cyclesPerSec, activeFraction, pattern };
}

/**
 * The bottom angle of every repetition, in clip order — this clip's
 * fingerprint. Two videos of the same sport can share a mean and a range;
 * they cannot share a rep-by-rep sequence. Handing this to the narrative
 * model is what lets it write "rep four was your shallowest" instead of prose
 * that would fit any session of the sport.
 *
 * Same period detection as `detectReps` and the consistency score, so the
 * reps referenced in coaching prose are the same reps those numbers counted.
 */
export function repDepths(metrics: PoseMetrics): { joint: JointKey; depths: number[] } | null {
  const found = cleanedSeriesWithPeriod(metrics);
  if (!found) return null;

  const driver = found.cleaned.reduce((a, b) => (b.range > a.range ? b : a));
  const cycles = Math.floor(driver.signal.length / found.period);
  if (cycles < 2) return null;

  const depths: number[] = [];
  for (let c = 0; c < cycles; c++) {
    const slice = driver.signal.slice(c * found.period, (c + 1) * found.period);
    depths.push(Math.round(Math.min(...slice)));
  }
  return { joint: driver.key, depths };
}

/**
 * Consistency — how closely the athlete's repetitions match each other.
 *
 * `null` when there is nothing to compare: no series (an older app build), no
 * joint tracked well enough, or a movement that does not repeat. A single rep
 * is not inconsistent; it is unmeasured, and saying so is the point.
 */
export function consistencyScore(metrics: PoseMetrics): number | null {
  const found = cleanedSeriesWithPeriod(metrics);
  if (!found) return null;

  const spreads: number[] = [];
  for (const { signal } of found.cleaned) {
    const spread = cycleSpreadDegrees(signal, found.period);
    if (spread !== null) spreads.push(spread);
  }
  if (spreads.length === 0) return null;

  const meanSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  return round(clamp(100 - (meanSpread / DEVIATION_FOR_ZERO_DEG) * 100));
}

/**
 * Mobility — achieved range of motion against a per-joint reference.
 *
 * References are broad functional ranges, not sport-specific norms: hitting the
 * reference scores 100 and we do not penalise exceeding it.
 */
const ROM_REFERENCE: Record<JointKey, number> = {
  leftKnee: 90,
  rightKnee: 90,
  leftHip: 80,
  rightHip: 80,
  leftElbow: 100,
  rightElbow: 100,
};

/**
 * Below this much total travel on every joint, the clip is a hold, not a
 * movement — a plank, an isometric, a balance drill. Range of motion is not a
 * property of a position, so mobility reports "not measured" rather than
 * scoring the athlete near zero for doing exactly what the drill asks.
 * A squat's driving joints travel 80–110°; camera jitter sits under ~8°.
 */
const MIN_TRAVEL_FOR_MOBILITY_DEG = 15;

export function mobilityScore(metrics: PoseMetrics): number | null {
  const ratios: number[] = [];
  let maxTravel = 0;

  for (const key of JOINT_KEYS) {
    const stats = metrics.joints[key];
    if (!stats) continue;
    const rom = stats.max - stats.min;
    maxTravel = Math.max(maxTravel, rom);
    ratios.push(Math.min(1, rom / ROM_REFERENCE[key]));
  }

  if (ratios.length === 0) return null;

  // A static hold has no range of motion to measure — the previous behaviour
  // scored it ~4 and left the athlete reading a meaningless number as damning.
  if (maxTravel < MIN_TRAVEL_FOR_MOBILITY_DEG) return null;

  const meanRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return round(clamp(meanRatio * 100));
}

/**
 * Overall — mean of the sub-scores we could actually measure.
 *
 * Deliberately unweighted: any weighting would be an unvalidated claim about
 * which dimension matters most, and would differ by sport.
 */
export function overallScore(parts: (number | null)[]): number | null {
  const present = parts.filter((p): p is number => p !== null);
  if (present.length === 0) return null;
  return round(present.reduce((a, b) => a + b, 0) / present.length);
}

/**
 * Compute the full score set from measured pose metrics.
 *
 * Pure and deterministic: identical metrics always yield identical scores,
 * which is what makes a re-run of the same clip reproducible.
 */
export function computeScores(metrics: PoseMetrics): Scores {
  if (!isScorable(metrics)) {
    return {
      overall: null,
      technique: null,
      balance: null,
      consistency: null,
      mobility: null,
      power: null,
      speed: null,
    };
  }

  const technique = techniqueScore(metrics);
  const balance = balanceScore(metrics);
  const consistency = consistencyScore(metrics);
  const mobility = mobilityScore(metrics);

  return {
    overall: overallScore([technique, balance, consistency, mobility]),
    technique,
    balance,
    consistency,
    mobility,
    power: null,
    speed: null,
  };
}

/**
 * Injury-risk findings, derived directly from measured time-in-range.
 *
 * `riskPercent` is a literal measurement — the share of tracked frames the
 * joint spent in a flagged position — not a predictive probability of injury.
 * The wording surfaced in the UI must not imply the latter.
 */
export interface RiskFinding {
  joint: JointKey;
  riskPercent: number;
  cautionPercent: number;
  observedMin: number;
  observedMax: number;
  /**
   * The caution boundaries the frames were classified against — the band a
   * finding is read against in the UI. `null` on a side the profile leaves
   * unflagged (an open-ended band has no boundary to print).
   *
   * These two keep the `safe` prefix while nothing the athlete reads does,
   * because they are published wire fields: renaming them is a breaking change
   * that has to land in the OpenAPI spec, the generated client and both sides
   * of the app in one move. A stale internal name costs nothing; a half-renamed
   * response field costs a broken client. See `JointZones` for the vocabulary
   * decision itself.
   */
  safeMin: number | null;
  safeMax: number | null;
}

/** Joint kind ("knee") from a joint key ("leftKnee"). */
export function jointKind(key: JointKey): keyof RiskZones {
  if (key.includes("Knee")) return "knee";
  if (key.includes("Hip")) return "hip";
  return "elbow";
}

/**
 * The classification zones in force for these metrics — the embedded profile
 * when present, the legacy fixed bands otherwise. Never invents: a legacy clip
 * really was classified against `LEGACY_ZONES`.
 */
export function zonesForMetrics(metrics: PoseMetrics): RiskZones {
  return metrics.riskProfile?.zones ?? LEGACY_ZONES;
}

/**
 * Display boundaries of a zone set: null on a side with no flags. Named after
 * the wire fields it fills, not after the vocabulary — see `RiskFinding`.
 */
export function safeBandOf(zones: JointZones): { safeMin: number | null; safeMax: number | null } {
  return {
    safeMin: zones.loWarn >= 0 ? zones.loWarn : null,
    safeMax: zones.hiWarn <= 360 ? zones.hiWarn : null,
  };
}

export function deriveRiskFindings(metrics: PoseMetrics): RiskFinding[] {
  if (!isScorable(metrics)) return [];

  const findings: RiskFinding[] = [];
  const zones = zonesForMetrics(metrics);

  for (const key of JOINT_KEYS) {
    const rf = metrics.riskFrames[key];
    const stats = metrics.joints[key];
    if (!rf || !stats) continue;
    if (rf.risk === 0 && rf.caution === 0) continue;

    findings.push({
      joint: key,
      riskPercent: round((rf.risk / metrics.frameCount) * 100),
      cautionPercent: round((rf.caution / metrics.frameCount) * 100),
      observedMin: round(stats.min),
      observedMax: round(stats.max),
      ...safeBandOf(zones[jointKind(key)]),
    });
  }

  // Worst first, so the UI's first card is the most significant finding.
  return findings.sort(
    (a, b) => b.riskPercent - a.riskPercent || b.cautionPercent - a.cautionPercent,
  );
}

/** Human-readable joint labels for prompts and UI. */
export const JOINT_LABELS: Record<JointKey, string> = {
  leftKnee: "left knee",
  rightKnee: "right knee",
  leftHip: "left hip",
  rightHip: "right hip",
  leftElbow: "left elbow",
  rightElbow: "right elbow",
};
