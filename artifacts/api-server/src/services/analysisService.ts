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
import { logger } from "../lib/logger.js";
import { recordAlert } from "../lib/alerting.js";
import {
  createAnalysis,
  updateAnalysisById,
  countAnalysesSince,
  createRisks,
  createTips,
  createProgressEntry,
  updateRiskProse,
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
 * `null` when the user may create another analysis, or the 403 body to return.
 *
 * Returning the payload rather than throwing keeps the route handler a straight
 * line and keeps this function testable without an Express response.
 */
export async function checkQuota(userId: string): Promise<QuotaRejection | null> {
  const { limit, used } = await getUsage(userId);
  if (limit === -1 || used < limit) return null;

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

/**
 * Create the analysis row in `processing` and hand back the row immediately.
 *
 * The write-up runs afterwards via `runPipeline`; the client polls for status.
 */
export async function startAnalysis(
  userId: string,
  input: CreateAnalysisInput,
): Promise<AnalysisRow> {
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

  return createAnalysis(row);
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

const UNSCORABLE_SUMMARY =
  "We couldn't get enough reliable readings from this clip to measure joint angles. " +
  "Film at least ten seconds with your whole body in frame, good lighting, and the " +
  "camera steady side-on.";

const NO_NARRATIVE_SUMMARY =
  "Your movement was measured and scored. The written coaching notes " +
  "couldn't be generated this time. Pull to refresh in a moment, or open " +
  "the skeleton overlay to review your joint angles directly.";

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
    });
  } catch (err) {
    const unavailable = err instanceof CoachUnavailableError;
    recordAlert("narrative_unavailable");
    logger[unavailable ? "warn" : "error"](
      { analysisId, err: unavailable ? undefined : err, event: "narrative_unavailable" },
      "Scores stored; coaching write-up could not be generated",
    );

    await updateAnalysisById(analysisId, { summary: NO_NARRATIVE_SUMMARY });

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

  await persistNarrative(analysisId, narrative, riskFindings);

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
 * described as having "spent 0% of the clip outside its typical safe range" —
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
  leftElbow:
    "Keep the elbow stacked under the load and avoid letting it flare at the end of the range. Lighten the load if it drifts.",
  rightElbow:
    "Keep the elbow stacked under the load and avoid letting it flare at the end of the range. Lighten the load if it drifts.",
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
): Promise<void> {
  await updateAnalysisById(analysisId, {
    strengths: narrative.strengths,
    improvements: narrative.improvements,
    summary: narrative.summary,
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

/** Mark an analysis failed after an unrecoverable pipeline error. */
export async function markFailed(analysisId: string): Promise<void> {
  await updateAnalysisById(analysisId, { status: "failed" });
}
