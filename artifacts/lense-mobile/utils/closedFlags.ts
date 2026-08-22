/**
 * Flags closed — a joint that was flagged in an earlier session and is not
 * flagged in the most recent one.
 *
 * ── Why this is shared ──────────────────────────────────────────────────────
 * Profile and Progress both showed "flags closed" and they disagreed, in the
 * same session, on the same account. Progress derived it properly. Profile
 * computed:
 *
 *   Math.max(0, new Set(sessions.flatMap(a => a.improvements.slice(0, 1))).size
 *                 - (measured[0]?.improvements?.length ?? 0))
 *
 * — the number of distinct *first* improvements across every session, minus the
 * *count* of the latest session's improvements. Those are unrelated quantities;
 * subtracting one from the other is not a measurement of anything. On a real
 * account it read 3 while Progress, for the same data, listed 1.
 *
 * Worse than wrong, it was wrong in the flattering direction: it mostly
 * reported the number of problems *found* under a heading that says closed.
 *
 * One function, one definition, used by both screens.
 *
 * ── The known limitation, stated rather than hidden ─────────────────────────
 * The list endpoint does not carry per-joint findings, only the coaching
 * `improvements` prose, so "was this joint flagged" is inferred from the joint
 * being named in that text. It is a proxy. It is the same proxy Progress
 * always used, and it is honest as long as nobody mistakes it for the finding
 * records themselves.
 */

/** The joints the tracker measures. Order fixes the display order. */
const JOINTS = [
  "left knee",
  "right knee",
  "left hip",
  "right hip",
  "left elbow",
  "right elbow",
] as const;

/** How many earlier sessions to look back over. */
const LOOKBACK = 4;

/** Most recent first is not assumed — this sorts. */
export interface ClosedFlagSession {
  status: string;
  analysisMethod: string;
  uploadedAt: string | Date;
  improvements?: string[] | null;
}

export interface ClosedFlag {
  /** Title-cased for display: "Right Knee". */
  joint: string;
  /** When it was observed closed — the latest measured session's date. */
  closedAt: Date;
}

export function closedFlags(sessions: ClosedFlagSession[]): ClosedFlag[] {
  const measured = sessions
    .filter((a) => a.status === "complete" && a.analysisMethod === "pose-measured")
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  // One session is a reading, not a comparison. Nothing can be "closed" yet.
  if (measured.length < 2) return [];

  const latest = measured[0]!;
  const earlier = measured.slice(1, 1 + LOOKBACK);
  const latestText = (latest.improvements ?? []).join(" ").toLowerCase();

  const out: ClosedFlag[] = [];
  for (const joint of JOINTS) {
    const wasFlagged = earlier.some((a) =>
      (a.improvements ?? []).join(" ").toLowerCase().includes(joint),
    );
    if (wasFlagged && !latestText.includes(joint)) {
      out.push({ joint: titleCase(joint), closedAt: new Date(latest.uploadedAt) });
    }
  }
  return out;
}

/** How many flags are closed. The number Profile shows. */
export function closedFlagCount(sessions: ClosedFlagSession[]): number {
  return closedFlags(sessions).length;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
