/**
 * Analysis orchestration: quota checks and the measure → score → explain
 * pipeline.
 *
 * ── The pipeline, and why it is ordered this way ────────────────────────────
 * The client measures (MediaPipe pose tracking in the WebView), this server
 * scores those measurements deterministically (`lib/scoring.ts`), and only then
 * does Claude explain the numbers. Claude never produces a score. See the
 * header of `lib/scoring.ts` for why.
 *
 * Measurements and scores are persisted *before* the write-up is requested, so
 * an API outage, a rate limit, or a missing key costs the user their prose but
 * never their measurements. An earlier version marked the whole analysis
 * "failed" in that case and threw away work that was already complete and
 * correct.
 */

import {
  computeScores,
  deriveRiskFindings,
  detectReps,
  isScorable,
  JOINT_LABELS,
  type PoseMetrics,
  type Scores,
} from "../lib/scoring.js";
import { generateNarrative, CoachUnavailableError, type Narrative } from "../lib/claude.js";
import { SPORTS_WITH_RESEARCH } from "../lib/sportResearch.js";
import { logger } from "../lib/logger.js";
import { recordAlert } from "../lib/alerting.js";
import {
  insertAnalysisWithinQuota,
  updateAnalysisById,
  countAnalysesSince,
  createRisks,
  createTips,
  createProgressEntry,
  updateRiskProse,
  findAnalysesByUserId,
  type NewAnalysis,
  type AnalysisRow,
} from "../repositories/analysisRepository.js";
import { findSubscriptionByUserId } from "../repositories/userRepository.js";
import {
  TIER_LIMITS,
  resolveEffectiveTier,
  startOfMonth,
  startOfNextMonth,
  type Tier,
} from "./entitlementService.js";

// ─── Quota ───────────────────────────────────────────────────────────────────

export interface UsageSnapshot {
  tier: Tier;
  /** `-1` means unlimited. */
  limit: number;
  used: number;
  /** `-1` means unlimited. */
  remaining: number;
  resetsAt: string;
}

/**
 * How many analyses the user has left this calendar month.
 *
 * Counted per calendar month to match what the pricing screen advertises.
 * Earlier code counted every analysis the user had *ever* created, so a
 * "3 per month" plan silently became 3 for the lifetime of the account.
 */
export async function getUsage(userId: string): Promise<UsageSnapshot> {
  const subscription = await findSubscriptionByUserId(userId);
  const tier = resolveEffectiveTier(subscription);
  const limit = TIER_LIMITS[tier].analysesPerMonth;
  const used = await countAnalysesSince(userId, startOfMonth());

  return {
    tier,
    limit,
    used,
    remaining: limit === -1 ? -1 : Math.max(0, limit - used),
    resetsAt: startOfNextMonth().toISOString(),
  };
}

export interface QuotaRejection {
  error: string;
  code: "UPGRADE_REQUIRED";
  message: string;
  resetsAt: string;
}

/**
 * The 403 body for an account that has spent this month's allowance.
 *
 * Returning the payload rather than throwing keeps the route handler a straight
 * line and keeps the decision testable without an Express response.
 *
 * There is deliberately no exported "may this user upload?" helper beside it.
 * One existed — `checkQuota` — and the route called it, then inserted, which is
 * the check-then-act race `insertAnalysisWithinQuota` now closes. A read-only
 * quota check that returns a verdict a caller is meant to act on is an
 * invitation to reopen that hole, so the only way to spend a slot is to take
 * one atomically.
 */
function quotaRejection(limit: number): QuotaRejection {
  const resetsAt = startOfNextMonth();
  return {
    error: "Monthly analysis limit reached",
    code: "UPGRADE_REQUIRED",
    message:
      `Your plan includes ${limit} analyses per month. Your next ${limit} unlock on ` +
      `${resetsAt.toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`,
    resetsAt: resetsAt.toISOString(),
  };
}

// ─── Creation ────────────────────────────────────────────────────────────────

export interface CreateAnalysisInput {
  title: string;
  sport: string;
  videoUrl?: string;
  duration?: number;
  poseMetrics?: PoseMetrics;
}

export interface AthleteContext {
  level: string;
  goals: string[];
  injuryConcerns: string[];
}

/** Admitted, with the row to poll; or refused, with the 403 body to send back. */
export type StartAnalysisResult =
  | { admitted: true; analysis: AnalysisRow }
  | { admitted: false; rejection: QuotaRejection };

/**
 * Claim a monthly slot and create the analysis row in `processing` — or
 * neither.
 *
 * The slot is claimed by the same transaction that writes the row (see
 * `insertAnalysisWithinQuota`), which is the whole point: the count and the
 * insert used to be two statements with a window between them wide enough to
 * drive twenty concurrent uploads through on a three-a-month plan. The caller
 * gets a decision it cannot race, not a verdict it has to act on in time.
 *
 * The write-up runs afterwards via `runPipeline`; the client polls for status.
 */
export async function startAnalysis(
  userId: string,
  input: CreateAnalysisInput,
): Promise<StartAnalysisResult> {
  const subscription = await findSubscriptionByUserId(userId);
  const limit = TIER_LIMITS[resolveEffectiveTier(subscription)].analysesPerMonth;

  const metrics = input.poseMetrics;
  const scorable = metrics ? isScorable(metrics) : false;

  const row: NewAnalysis = {
    userId,
    title: input.title,
    sport: input.sport,
    videoUrl: input.videoUrl,
    duration: input.duration,
    status: "processing",
    poseMetrics: metrics ?? null,
    analysisMethod: scorable ? "pose-measured" : "unscored",
  };

  const result = await insertAnalysisWithinQuota(row, { since: startOfMonth(), limit });
  return result.admitted
    ? { admitted: true, analysis: result.row }
    : { admitted: false, rejection: quotaRejection(limit) };
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

const UNSCORABLE_SUMMARY =
  "We couldn't get enough reliable readings from this clip to measure joint angles. " +
  "Film at least ten seconds with your whole body in frame, good lighting, and the " +
  "camera steady side-on.";

/**
 * Shown on the analysis screen when the measurements landed but the coach did
 * not.
 *
 * Two promises have been taken out of this string, both of them things the app
 * cannot do. It first told the reader to "Pull to refresh" — an affordance that
 * screen does not have: `app/analysis/[id].tsx` has no `RefreshControl`, only a
 * focus refetch and a bounded poll. It then said the notes "will appear here
 * shortly", which was worse, because nothing in this codebase retries a
 * write-up: there is no queue, no job, and no regenerate control. The athlete
 * was told to wait for something that was never coming.
 *
 * What is left is the truth and the two things that are actually true of the
 * screen: the measurements are real and readable, and this clip was not
 * charged (see `narrativeStatus` below, and `quotaConsuming` in the
 * repository).
 */
const NO_NARRATIVE_SUMMARY =
  "Your movement was measured and scored, but the written coaching notes " +
  "couldn't be generated for this clip and won't arrive later. Open the " +
  "skeleton overlay to read your joint angles directly. This session doesn't " +
  "count against your monthly analyses.";

/**
 * Score the measurements, persist them, then attempt the coaching write-up.
 *
 * Never throws for an unavailable coach — the analysis completes with its
 * measurements either way. Genuine faults propagate to the caller, which marks
 * the row failed.
 */
export async function runPipeline(
  analysisId: string,
  userId: string,
  input: { title: string; sport: string },
  profile: AthleteContext | undefined,
  metrics: PoseMetrics | undefined,
): Promise<void> {
  // Without usable measurements there is nothing honest to score. Complete in
  // an explicit "unscored" state rather than inventing numbers.
  if (!metrics || !isScorable(metrics)) {
    await updateAnalysisById(analysisId, {
      status: "complete",
      analysisMethod: "unscored",
      summary: UNSCORABLE_SUMMARY,
    });
    logger.info(
      { analysisId, event: "analysis_unscored" },
      "Completed without scores; clip not trackable",
    );
    return;
  }

  const scores = computeScores(metrics);
  const riskFindings = deriveRiskFindings(metrics);
  const reps = detectReps(metrics);

  await persistMeasurements(analysisId, userId, scores, riskFindings, metrics, reps);

  // What the coach told this athlete after their last sessions of this sport.
  // Handed to the model so it builds on previous advice instead of reissuing
  // it — the difference between a coach who remembers you and a template.
  // Best-effort: a failure here costs continuity, not the analysis.
  const priorSessions = await findAnalysesByUserId(userId)
    .then((rows) =>
      rows
        .filter(
          (r) =>
            r.id !== analysisId &&
            r.status === "complete" &&
            r.sport.toLowerCase() === input.sport.toLowerCase() &&
            r.summary,
        )
        .slice(0, 2)
        .map((r) => ({ summary: r.summary as string, improvements: r.improvements })),
    )
    .catch(() => undefined);

  let narrative: Narrative;
  try {
    narrative = await generateNarrative({
      sport: input.sport,
      title: input.title,
      level: profile?.level ?? "intermediate",
      metrics,
      scores,
      riskFindings,
      goals: profile?.goals,
      injuryConcerns: profile?.injuryConcerns,
      priorSessions,
    });
  } catch (err) {
    const unavailable = err instanceof CoachUnavailableError;
    recordAlert("narrative_unavailable");
    logger[unavailable ? "warn" : "error"](
      { analysisId, err: unavailable ? undefined : err, event: "narrative_unavailable" },
      "Scores stored; coaching write-up could not be generated",
    );

    // Half an analysis is not an analysis. The row stays `complete` and
    // `pose-measured` because the measurements genuinely are both — but it is
    // flagged here so `countAnalysesSince` stops counting it, exactly the way
    // an unscored clip is already spared. Without this, a free user's third
    // clip of the month could spend their last slot on measurements plus an
    // apology, with nothing anywhere that would ever write the missing half.
    await updateAnalysisById(analysisId, {
      summary: NO_NARRATIVE_SUMMARY,
      narrativeStatus: "unavailable",
    });

    logger.info(
      {
        analysisId,
        overall: scores.overall,
        frames: metrics.frameCount,
        event: "analysis_complete_no_narrative",
      },
      "Analysis complete without narrative",
    );
    return;
  }

  await persistNarrative(analysisId, narrative, riskFindings, input.sport);

  logger.info(
    {
      analysisId,
      overall: scores.overall,
      frames: metrics.frameCount,
      event: "analysis_complete",
    },
    "Analysis complete",
  );
}

/**
 * The factual description a finding carries until (unless) the write-up
 * upgrades its prose.
 *
 * Band-aware, because the previous copy read `riskPercent` alone: a joint that
 * spent 7% of the clip in the caution band and never entered the risk band was
 * described as having "spent 0% of the clip outside its typical band" —
 * directly beside a severity stamp that counts both bands and therefore said
 * BRIEFLY. The sentence and the stamp must agree on what "out of range" means
 * (see the client's utils/flagSeverity.ts, which settled the same question the
 * same way).
 */
export function fallbackRiskDescription(f: {
  joint: keyof typeof JOINT_LABELS;
  riskPercent: number;
  cautionPercent: number;
  observedMin: number;
  observedMax: number;
}): string {
  const label = JOINT_LABELS[f.joint];
  const range = `(observed ${f.observedMin}–${f.observedMax}°)`;

  if (f.riskPercent > 0 && f.cautionPercent > 0) {
    return (
      `Your ${label} spent ${f.riskPercent}% of the clip in a high-strain position, ` +
      `and another ${f.cautionPercent}% close to one ${range}.`
    );
  }
  if (f.riskPercent > 0) {
    return `Your ${label} spent ${f.riskPercent}% of the clip in a high-strain position ${range}.`;
  }
  return (
    `Your ${label} spent ${f.cautionPercent}% of the clip near the edge of its ` +
    `typical range. Worth watching, not yet a problem ${range}.`
  );
}

/**
 * Prevention copy per joint for the no-write-up path. Generic by necessity —
 * it has no model behind it — but at least anatomically sensible, which the
 * previous single string ("reduce the depth or load") was not for an elbow.
 */
const FALLBACK_PREVENTION: Record<keyof typeof JOINT_LABELS, string> = {
  leftKnee:
    "Control the lowering phase and keep the knee tracking over the foot. Shorten the range until you can hold that line.",
  rightKnee:
    "Control the lowering phase and keep the knee tracking over the foot. Shorten the range until you can hold that line.",
  leftHip:
    "Sit back into the hips rather than folding forward, and keep your chest up through the deepest part of the movement.",
  rightHip:
    "Sit back into the hips rather than folding forward, and keep your chest up through the deepest part of the movement.",
  // Elbow findings only arise in sports whose profile flags full extension —
  // ballistic strikes and weight-bearing on a locked arm — so the copy coaches
  // the finish, not the load path.
  leftElbow:
    "Finish the movement just short of a fully locked elbow — a soft final few degrees absorbs the snap instead of the joint taking it.",
  rightElbow:
    "Finish the movement just short of a fully locked elbow — a soft final few degrees absorbs the snap instead of the joint taking it.",
};

/** Scores and risk rows — everything derived from measurement, no model call. */
async function persistMeasurements(
  analysisId: string,
  userId: string,
  scores: Scores,
  riskFindings: ReturnType<typeof deriveRiskFindings>,
  metrics: PoseMetrics,
  detectedReps: number | null,
): Promise<void> {
  await updateAnalysisById(analysisId, {
    status: "complete",
    analysisMethod: "pose-measured",
    overallScore: scores.overall,
    techniqueScore: scores.technique,
    balanceScore: scores.balance,
    consistencyScore: scores.consistency,
    mobilityScore: scores.mobility,
    // Explicitly null: not derivable from 2D pose. See lib/scoring.ts.
    powerScore: null,
    speedScore: null,
    // Enrich the stored metrics with the rep count the consistency pass
    // already derived — measured provenance the client shows beside the
    // frame count. jsonb column, so no migration.
    poseMetrics: { ...metrics, detectedReps },
  });

  // Risk rows are measurements too, so they are written whether or not Claude
  // is reachable. Prose is upgraded later if a write-up arrives.
  await createRisks(
    riskFindings.map((f) => ({
      analysisId,
      joint: JOINT_LABELS[f.joint],
      riskPercent: f.riskPercent,
      cautionPercent: f.cautionPercent,
      observedMin: f.observedMin,
      observedMax: f.observedMax,
      description: fallbackRiskDescription(f),
      prevention: FALLBACK_PREVENTION[f.joint],
    })),
  );

  if (scores.overall !== null) {
    await createProgressEntry({
      userId,
      // Provenance: the trend point dies with the session that produced it.
      analysisId,
      date: new Date().toISOString().split("T")[0],
      overallScore: scores.overall,
      techniqueScore: scores.technique,
      balanceScore: scores.balance,
      consistencyScore: scores.consistency,
      mobilityScore: scores.mobility,
      powerScore: null,
      speedScore: null,
    });
  }
}

/** Prose only — strengths, improvements, summary, tips, risk explanations. */
async function persistNarrative(
  analysisId: string,
  narrative: Narrative,
  riskFindings: ReturnType<typeof deriveRiskFindings>,
  selectedSport: string,
): Promise<void> {
  await updateAnalysisById(analysisId, {
    strengths: narrative.strengths,
    improvements: narrative.improvements,
    summary: narrative.summary,
    sportMismatch: validateSportMismatch(narrative.sportMismatch, selectedSport),
  });

  await createTips(
    narrative.tips.map((t) => ({
      analysisId,
      category: t.category,
      severity: t.severity,
      title: t.title,
      description: t.description,
      drill: t.drill,
    })),
  );

  // The risk rows already exist with measured values and a factual fallback
  // description. Upgrade the *prose only*, and only for a joint we actually
  // flagged — a joint Claude invents has no measurement to attach to and is
  // ignored rather than written as a new finding.
  if (riskFindings.length === 0 || narrative.riskExplanations.length === 0) return;

  const explanationFor = new Map(
    narrative.riskExplanations.map((e) => [e.joint.toLowerCase().trim(), e]),
  );

  for (const finding of riskFindings) {
    const label = JOINT_LABELS[finding.joint];
    const explanation =
      explanationFor.get(label) ?? explanationFor.get(finding.joint.toLowerCase());
    if (!explanation) continue;

    await updateRiskProse(analysisId, label, {
      description: explanation.description,
      prevention: explanation.prevention,
    });
  }
}

/**
 * Gate Claude's sport-mismatch verdict before it reaches the athlete.
 *
 * This is the one field in the narrative that contradicts something the user
 * typed, so it gets checked rather than trusted. Three ways a verdict is
 * discarded:
 *
 *  - It names a sport we do not know. A suggestion the app cannot offer is
 *    worse than silence.
 *  - It names the sport the athlete already picked, which is a contradiction in
 *    terms and reads as a bug.
 *  - Anything below high confidence. Sport is chosen per clip and cross-training
 *    is supported, so a wrong warning costs more than a missed one.
 *
 * Returns null in every rejected case, which the column reads as "not assessed".
 */
export function validateSportMismatch(
  verdict: Narrative["sportMismatch"],
  selectedSport: string,
): { suggestedSport: string; confidence: "medium" | "high"; message: string } | null {
  if (!verdict) return null;

  const suggested = verdict.suggestedSport.trim();
  const known = SPORTS_WITH_RESEARCH.find((s) => s.toLowerCase() === suggested.toLowerCase());
  if (!known) return null;
  if (known.toLowerCase() === selectedSport.trim().toLowerCase()) return null;
  if (verdict.confidence !== "high") return null;

  return { suggestedSport: known, confidence: verdict.confidence, message: verdict.message };
}

/** Mark an analysis failed after an unrecoverable pipeline error. */
export async function markFailed(analysisId: string): Promise<void> {
  await updateAnalysisById(analysisId, { status: "failed" });
}
