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

export interface PoseMetrics {
  /** Frames on which a pose was detected with acceptable confidence. */
  frameCount: number;
  /** Fraction (0–1) of sampled frames where the athlete was reliably tracked. */
  trackingQuality: number;
  durationSec: number;
  joints: Partial<Record<JointKey, JointStats>>;
  /** Frames where each joint sat in a caution (lvl 1) or risk (lvl 2) range. */
  riskFrames: Partial<Record<JointKey, { caution: number; risk: number }>>;
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
 * Technique — the share of tracked time spent outside safe joint ranges.
 *
 * A frame in the "risk" band costs twice what a "caution" frame costs, so a
 * brief excursion into a dangerous position outweighs a long mildly-suboptimal
 * one. 100 means no frame left the safe band.
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
 * Balance — left/right symmetry.
 *
 * Compares the mean angle of each paired joint. A 30° mean difference scores 0;
 * identical sides score 100. Pairs where only one side was tracked are skipped
 * rather than assumed symmetric.
 */
export function balanceScore(metrics: PoseMetrics): number | null {
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

/**
 * Consistency — how repeatable the movement was, from angular variability.
 *
 * Standard deviation is scaled against each joint's own range: a joint that
 * swings through 90° is expected to vary more than one held near-static, so
 * raw stdDev alone would unfairly penalise large-ROM movements.
 */
export function consistencyScore(metrics: PoseMetrics): number | null {
  const ratios: number[] = [];

  for (const key of JOINT_KEYS) {
    const stats = metrics.joints[key];
    if (!stats) continue;
    const range = Math.max(1, stats.max - stats.min);
    ratios.push(Math.min(1, stats.stdDev / range));
  }

  if (ratios.length === 0) return null;

  const meanRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  // A stdDev at 40% of range is treated as maximally inconsistent.
  return round(clamp(100 - (meanRatio / 0.4) * 100));
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

export function mobilityScore(metrics: PoseMetrics): number | null {
  const ratios: number[] = [];

  for (const key of JOINT_KEYS) {
    const stats = metrics.joints[key];
    if (!stats) continue;
    const rom = stats.max - stats.min;
    ratios.push(Math.min(1, rom / ROM_REFERENCE[key]));
  }

  if (ratios.length === 0) return null;

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
}

export function deriveRiskFindings(metrics: PoseMetrics): RiskFinding[] {
  if (!isScorable(metrics)) return [];

  const findings: RiskFinding[] = [];

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
