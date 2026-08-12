/**
 * Reference technique models — the movement patterns a comparison would be
 * measured against.
 *
 * ── Why there are no real athletes here ─────────────────────────────────────
 * This list previously named six real, living professional athletes (a golfer,
 * a basketball player, a fencer, a tennis player, a gymnast, and a sprinter)
 * and displayed a "similarity" percentage against them. Removed on 2026-08-12
 * for two independent reasons, either of which is disqualifying:
 *
 *  1. **Right of publicity / NIL.** Using a living person's name to promote or
 *     sell a product requires a licence. This was attached to a $24.99/month
 *     tier, which is squarely commercial use and forecloses most defences.
 *  2. **False endorsement** (Lanham Act §43(a)). Presenting a named athlete as
 *     a feature implies they are associated with the app. They are not.
 *
 * Named athletes may only return here under a signed licence. Describing the
 * *technique* is not restricted — an anonymous "tour-level driver swing" makes
 * the same coaching point and carries no exposure, which is what these are.
 *
 * ── Why this file replaced athleteData.ts ───────────────────────────────────
 * That module also held MOCK_ANALYSES, MOCK_PROGRESS, MOCK_ACHIEVEMENTS,
 * MOCK_ATHLETE, and MOCK_CHAT — fabricated sessions with invented scores,
 * including power and speed figures for dimensions the engine cannot measure.
 * Nothing imported any of them, so they were deleted rather than carried
 * forward. Keeping fake scores in the tree next to a real scoring engine is
 * how a fake score ends up on screen.
 */

import type { ProAthlete } from "./types";

export const REFERENCE_MODELS: ProAthlete[] = [
  { id: "ref-golf-drive", name: "Tour-level driver swing", sport: "golf", specialty: "Driver Swing", imageUrl: "", keyAttributes: ["Club head speed", "Hip rotation", "Lag maintenance", "Follow-through"] },
  { id: "ref-bball-jumper", name: "Elite jump shot", sport: "basketball", specialty: "Jump Shot", imageUrl: "", keyAttributes: ["Release point", "Wrist snap", "Balance", "Arc consistency"] },
  { id: "ref-fencing-fleche", name: "International fleche attack", sport: "fencing", specialty: "Fleche Attack", imageUrl: "", keyAttributes: ["Explosive lunge", "Blade control", "Footwork speed", "Recovery"] },
  { id: "ref-tennis-groundstroke", name: "Tour-level groundstroke", sport: "tennis", specialty: "Baseline Groundstroke", imageUrl: "", keyAttributes: ["Topspin rotation", "Footwork", "Recovery position", "Follow-through"] },
  { id: "ref-gym-tumbling", name: "Elite floor tumbling pass", sport: "gymnastics", specialty: "Floor Tumbling", imageUrl: "", keyAttributes: ["Air awareness", "Rotation speed", "Stick landing", "Body position"] },
  { id: "ref-sprint-mechanics", name: "World-class sprint mechanics", sport: "running", specialty: "Sprint Mechanics", imageUrl: "", keyAttributes: ["Stride length", "Ground contact", "Arm drive", "Lean angle"] },
];
