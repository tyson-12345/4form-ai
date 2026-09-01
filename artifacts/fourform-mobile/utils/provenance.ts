/**
 * The provenance stamp shown beside a Form Index reading — where the number
 * came from, in the instrument's shorthand.
 *
 * "4 REPS · 90 FRAMES MEASURED" when the server detected repetition,
 * "90 FRAMES MEASURED" when it did not (a hold, a single rep, or a clip from
 * a build predating rep detection). One function so Home and the analysis
 * screen can never phrase the same fact differently.
 */

export interface ProvenanceMetrics {
  frameCount?: number;
  /** Server-derived; null when the movement didn't repeat. */
  detectedReps?: number | null;
}

export function provenance(metrics: ProvenanceMetrics | null | undefined): string | null {
  const frames = metrics?.frameCount;
  if (frames == null || frames <= 0) return null;

  const base = `${frames} FRAMES MEASURED`;
  const reps = metrics?.detectedReps;
  return reps != null && reps > 0 ? `${reps} REPS · ${base}` : base;
}
