/**
 * Muscle-group load, derived from measured joints.
 *
 * The tracker measures six joints; a joint is moved by muscles, so each
 * measured joint vouches for the muscle groups that cross it:
 *
 *   knee  → quadriceps, hamstrings, calves
 *   hip   → glutes, hip flexors, lower back
 *   elbow → biceps, triceps, forearms
 *
 * This is inference, not measurement — pose tracking sees joint angles, not
 * muscle activation — and the UI must say so. The honest claim is "this joint
 * travelled 95° and spent 12% of the clip outside its band, and these are the
 * muscles that do that work", which is exactly what a coach infers watching
 * the same video.
 *
 * Muscles no measured joint crosses (chest, shoulders, abs) stay neutral and
 * are rendered as unmeasured. Colouring them would be invention.
 */

export type MuscleGroup =
  | "quads"
  | "hamstrings"
  | "calves"
  | "glutes"
  | "hipFlexors"
  | "lowerBack"
  | "biceps"
  | "triceps"
  | "forearms";

export interface MuscleState {
  /** 0 in range, 1 caution, 2 flagged — the classification of the joint this muscle crosses. */
  lvl: 0 | 1 | 2;
  /** How hard the joint worked, 0–1, from its range of travel. 0 also means "not measured". */
  work: number;
}

export interface MuscleLoad {
  left: Record<MuscleGroup, MuscleState>;
  right: Record<MuscleGroup, MuscleState>;
  /** False when nothing moved enough to be worth drawing. */
  assessed: boolean;
}

/** The joint-angle statistics this util reads; structural so tests stay small. */
export interface MuscleLoadInput {
  frameCount: number;
  joints: Partial<Record<string, { min: number; max: number }>>;
  riskFrames?: Partial<Record<string, { caution: number; risk: number }>>;
}

/** Degrees of travel that count as a full effort. A sprint knee covers ~100°. */
const FULL_WORK_RANGE_DEG = 90;

/** Fractions of the clip in a band before the muscle wears that band's colour. */
const RISK_FRACTION = 0.05;
const CAUTION_FRACTION = 0.1;

const GROUPS_FOR_JOINT: Record<"Knee" | "Hip" | "Elbow", MuscleGroup[]> = {
  Knee: ["quads", "hamstrings", "calves"],
  Hip: ["glutes", "hipFlexors", "lowerBack"],
  Elbow: ["biceps", "triceps", "forearms"],
};

const NEUTRAL: MuscleState = { lvl: 0, work: 0 };

function emptySide(): Record<MuscleGroup, MuscleState> {
  return {
    quads: NEUTRAL,
    hamstrings: NEUTRAL,
    calves: NEUTRAL,
    glutes: NEUTRAL,
    hipFlexors: NEUTRAL,
    lowerBack: NEUTRAL,
    biceps: NEUTRAL,
    triceps: NEUTRAL,
    forearms: NEUTRAL,
  };
}

export function deriveMuscleLoad(metrics: MuscleLoadInput): MuscleLoad {
  const load: MuscleLoad = { left: emptySide(), right: emptySide(), assessed: false };

  for (const side of ["left", "right"] as const) {
    for (const kind of ["Knee", "Hip", "Elbow"] as const) {
      const key = side + kind; // leftKnee, rightHip, …
      const stats = metrics.joints[key];
      if (!stats) continue;

      const range = Math.max(0, stats.max - stats.min);
      const work = Math.min(1, range / FULL_WORK_RANGE_DEG);

      let lvl: 0 | 1 | 2 = 0;
      const rf = metrics.riskFrames?.[key];
      if (rf && metrics.frameCount > 0) {
        if (rf.risk / metrics.frameCount > RISK_FRACTION) lvl = 2;
        else if (rf.caution / metrics.frameCount > CAUTION_FRACTION) lvl = 1;
      }

      const state: MuscleState = { lvl, work };
      for (const group of GROUPS_FOR_JOINT[kind]) load[side][group] = state;

      if (range >= 20) load.assessed = true;
    }
  }

  return load;
}
