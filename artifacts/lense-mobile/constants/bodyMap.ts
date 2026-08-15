/**
 * Anatomical body map geometry — front and back, in a 120 × 268 viewBox.
 *
 * ── What may light up, and what may not ─────────────────────────────────────
 * Only regions centred on a joint the tracker actually measures. That is six
 * joints and nothing else: left and right knee, hip, and elbow.
 *
 * This is the whole constraint on the file. Charts of this kind normally shade
 * *muscle groups* — quadriceps, latissimus, hamstrings — and nothing in this
 * app measures a muscle. `poseTracker` computes joint angles from landmark
 * triples; there is no EMG, no load, no tissue model. A shaded quadriceps
 * would be a reading we never took, presented in the most confident visual
 * language the screen has.
 *
 * So the musculature below is drawn, and permanently inert. It exists to make
 * the figure legible as a body. The regions are the only things that respond
 * to data, and each one is named for its joint rather than for the muscle that
 * happens to sit under it.
 *
 * ── Construction ───────────────────────────────────────────────────────────
 * The outline is one closed path built by mirroring a half-profile about the
 * centre line, so the figure cannot drift out of symmetry when tuned. Detail
 * and regions are drawn over it and clipped to it, so nothing can bleed
 * outside the silhouette.
 */

/** Catmull-Rom through `pts`, emitted as closed cubic beziers. */
function smooth(pts: [number, number][]): string {
  const n = pts.length;
  const at = (i: number) => pts[(i + n) % n];
  let d = `M${at(0)[0]} ${at(0)[1]}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

export const VIEWBOX = { width: 120, height: 268 };

const AXIS = 60;
const mirror = (pts: [number, number][]): [number, number][] =>
  pts.map(([x, y]) => [2 * AXIS - x, y]);

/** Right half of the outline: crown → arm → armpit → hip → leg → crotch. */
const HALF: [number, number][] = [
  [60, 2], [71, 5], [75, 17], [72, 29],            // skull
  [68, 36], [66, 42],                              // neck
  [77, 45], [88, 53],                              // trapezius into shoulder
  [96, 63], [98, 78],                              // deltoid
  [95, 93], [96, 107],                             // upper arm, elbow
  [99, 125], [100, 143],                           // forearm
  [98, 159], [93, 167],                            // hand
  [88, 161], [87, 143],                            // inner hand, inner forearm
  [84, 123], [80, 105],                            // inner elbow
  [77, 85], [74, 68],                              // inner upper arm, armpit
  [72, 86], [70, 104],                             // ribs, waist
  [74, 120], [79, 137],                            // hip
  [82, 153], [81, 175],                            // thigh
  [77, 194], [76, 208],                            // knee
  [79, 222], [73, 242],                            // calf
  [69, 252], [75, 263], [62, 265],                 // ankle, foot
  [66, 246], [67, 216], [67, 192],                 // inner shin
  [66, 170], [62, 151],                            // inner thigh into crotch
];

export const SILHOUETTE = smooth([...HALF, ...mirror([...HALF]).reverse()]);

/** Musculature. Descriptive only — never driven by data. See the header. */
export const FRONT_DETAIL = [
  "M60 44v104",
  "M46 58c6-3 10-3 14-2M74 58c-6-3-10-3-14-2",
  "M42 62c2 10 8 16 18 17M78 62c-2 10-8 16-18 17",
  "M50 96h20M51 110h18M52 124h16",
  "M44 74c-1 14 0 26 4 36M76 74c1 14 0 26-4 36",
  "M38 61c-4 8-6 17-5 25M82 61c4 8 6 17 5 25",
  "M32 83c-1 10-1 18 1 24M88 83c1 10 1 18-1 24",
  "M45 152c-2 14-2 28 1 40M75 152c2 14 2 28-1 40",
  "M53 154c0 14 0 28 1 36M67 154c0 14 0 28-1 36",
  "M47 218c-1 10-1 20 1 28M73 218c1 10 1 20-1 28",
];

export const BACK_DETAIL = [
  "M60 44v100",
  "M40 52c8 4 32 4 40 0",
  "M44 62c6 6 26 6 32 0",
  "M42 74c0 16 6 28 18 34M78 74c0 16-6 28-18 34",
  "M50 112h20",
  "M38 61c-4 8-6 17-5 25M82 61c4 8 6 17 5 25",
  "M32 83c-1 10-1 18 1 24M88 83c1 10 1 18-1 24",
  "M45 128c5 6 25 6 30 0",
  "M45 158c-1 14-1 26 1 36M75 158c1 14 1 26-1 36",
  "M60 150v42",
  "M47 220c-2 10-2 20 0 28M73 220c2 10 2 20 0 28",
];

/**
 * `joint` matches the label the API stores on a risk finding — "left knee".
 * Keep these strings in step with JOINT_LABELS in the server's lib/scoring.ts.
 */
export interface BodyRegion {
  joint: string;
  d: string;
}

export const FRONT_REGIONS: BodyRegion[] = [
  { joint: "left elbow",  d: "M22 94c-3 0-5 3-5 8v14c0 5 2 8 5 8h20c3 0 5-3 5-8v-14c0-5-2-8-5-8z" },
  { joint: "right elbow", d: "M98 94c3 0 5 3 5 8v14c0 5-2 8-5 8H78c-3 0-5-3-5-8v-14c0-5 2-8 5-8z" },
  { joint: "left hip",    d: "M38 116c-5 7-6 18-4 30 8 5 18 5 26 1 2-11 2-22-1-31z" },
  { joint: "right hip",   d: "M82 116c5 7 6 18 4 30-8 5-18 5-26 1-2-11-2-22 1-31z" },
  { joint: "left knee",   d: "M41 180c-4 7-5 18-4 27 1 8 4 13 9 15 6-2 10-8 11-17 1-10-1-20-5-27z" },
  { joint: "right knee",  d: "M79 180c4 7 5 18 4 27-1 8-4 13-9 15-6-2-10-8-11-17-1-10 1-20 5-27z" },
];

export const BACK_REGIONS: BodyRegion[] = [
  { joint: "left elbow",  d: "M22 94c-3 0-5 3-5 8v14c0 5 2 8 5 8h20c3 0 5-3 5-8v-14c0-5-2-8-5-8z" },
  { joint: "right elbow", d: "M98 94c3 0 5 3 5 8v14c0 5-2 8-5 8H78c-3 0-5-3-5-8v-14c0-5 2-8 5-8z" },
  { joint: "left hip",    d: "M39 112c-6 7-8 20-5 33 9 6 19 5 26 0 2-13 1-24-2-33z" },
  { joint: "right hip",   d: "M81 112c6 7 8 20 5 33-9 6-19 5-26 0-2-13-1-24 2-33z" },
  { joint: "left knee",   d: "M41 182c-4 7-5 17-4 26 1 8 4 12 9 14 6-2 10-8 11-17 1-9-1-18-5-25z" },
  { joint: "right knee",  d: "M79 182c4 7 5 17 4 26-1 8-4 12-9 14-6-2-10-8-11-17-1-9 1-18 5-25z" },
];
