/**
 * Analysis routes.
 *
 * The pipeline is: the client measures (MediaPipe pose tracking in the WebView)
 * → the server scores those measurements deterministically → Claude explains the
 * scores. See lib/scoring.ts for why the scoring half is not Claude's job.
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  analysesTable,
  coachingTipsTable,
  injuryRisksTable,
  progressEntriesTable,
  athleteProfilesTable,
  subscriptionsTable,
} from "@workspace/db";
import { eq, and, desc, count, gte } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { generateNarrative } from "../lib/claude.js";
import {
  computeScores,
  deriveRiskFindings,
  isScorable,
  JOINT_LABELS,
  type PoseMetrics,
} from "../lib/scoring.js";
import { TIER_LIMITS, resolveEffectiveTier } from "./subscriptions.js";
import { parseOrReject, safeText, safeUuid } from "../lib/validate.js";
import { logger } from "../lib/logger.js";
import { clientIp } from "../lib/rateLimit.js";

const router = Router();

// ─── Request schemas ─────────────────────────────────────────────────────────

const jointStatsSchema = z.object({
  min: z.number().min(0).max(360),
  max: z.number().min(0).max(360),
  mean: z.number().min(0).max(360),
  stdDev: z.number().min(0).max(360),
});

const riskFramesSchema = z.object({
  caution: z.number().int().min(0).max(1_000_000),
  risk: z.number().int().min(0).max(1_000_000),
});

const JOINT_ENUM = z.enum([
  "leftKnee",
  "rightKnee",
  "leftHip",
  "rightHip",
  "leftElbow",
  "rightElbow",
]);

const poseMetricsSchema = z.object({
  frameCount: z.number().int().min(0).max(1_000_000),
  trackingQuality: z.number().min(0).max(1),
  durationSec: z.number().min(0).max(7200),
  joints: z.record(JOINT_ENUM, jointStatsSchema),
  riskFrames: z.record(JOINT_ENUM, riskFramesSchema),
});

const createAnalysisSchema = z.object({
  title: safeText(1, 120),
  sport: safeText(1, 40),
  /**
   * Device-local video URI. Kept only so the client can re-open the clip; it is
   * never fetched server-side, which is why an arbitrary scheme is acceptable.
   */
  videoUrl: z.string().max(2048).optional(),
  duration: z.number().positive().max(7200).optional(),
  poseMetrics: poseMetricsSchema.optional(),
});

// ─── GET /api/analyses ───────────────────────────────────────────────────────

router.get("/analyses", authenticate, async (req: AuthRequest, res) => {
  const rows = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.userId, req.userId!))
    .orderBy(desc(analysesTable.uploadedAt));

  res.json({ analyses: rows });
});

// ─── GET /api/analyses/usage ─────────────────────────────────────────────────

/** How many analyses the user has left this calendar month. */
router.get("/analyses/usage", authenticate, async (req: AuthRequest, res) => {
  const [subscription] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, req.userId!))
    .limit(1);

  const tier = resolveEffectiveTier(subscription);
  const limit = TIER_LIMITS[tier].analysesPerMonth;
  const used = await countAnalysesThisMonth(req.userId!);

  res.json({
    tier,
    limit,
    used,
    remaining: limit === -1 ? -1 : Math.max(0, limit - used),
    resetsAt: startOfNextMonth().toISOString(),
  });
});

// ─── POST /api/analyses ──────────────────────────────────────────────────────

router.post("/analyses", authenticate, async (req: AuthRequest, res) => {
  const data = parseOrReject(createAnalysisSchema, req.body, res, {
    route: "analyses",
    ip: clientIp(req),
    userId: req.userId,
  });
  if (!data) return;

  // ── Quota ──
  const [subscription] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, req.userId!))
    .limit(1);

  const tier = resolveEffectiveTier(subscription);
  const monthlyLimit = TIER_LIMITS[tier].analysesPerMonth;

  if (monthlyLimit !== -1) {
    // Counted per calendar month, matching what the pricing screen advertises.
    // This previously counted every analysis the user had *ever* created, so a
    // "3 per month" plan silently became 3 for the lifetime of the account.
    const used = await countAnalysesThisMonth(req.userId!);
    if (used >= monthlyLimit) {
      res.status(403).json({
        error: "Monthly analysis limit reached",
        code: "UPGRADE_REQUIRED",
        message: `Your plan includes ${monthlyLimit} analyses per month. Your next ${monthlyLimit} unlock on ${startOfNextMonth().toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`,
        resetsAt: startOfNextMonth().toISOString(),
      });
      return;
    }
  }

  const [profile] = await db
    .select()
    .from(athleteProfilesTable)
    .where(eq(athleteProfilesTable.userId, req.userId!))
    .limit(1);

  const metrics = data.poseMetrics as PoseMetrics | undefined;
  const scorable = metrics ? isScorable(metrics) : false;

  const [analysis] = await db
    .insert(analysesTable)
    .values({
      userId: req.userId!,
      title: data.title,
      sport: data.sport,
      videoUrl: data.videoUrl,
      duration: data.duration,
      status: "processing",
      poseMetrics: metrics ?? null,
      analysisMethod: scorable ? "pose-measured" : "unscored",
    })
    .returning();

  // Run the write-up asynchronously; the client polls for status.
  runAnalysis(analysis!.id, req.userId!, data, profile, metrics).catch((err) => {
    logger.error(
      { analysisId: analysis!.id, err, event: "analysis_failed" },
      "Analysis generation failed",
    );
    db.update(analysesTable)
      .set({ status: "failed" })
      .where(eq(analysesTable.id, analysis!.id))
      .execute()
      .catch((dbErr: unknown) =>
        logger.error({ dbErr, event: "analysis_status_write_failed" }, "Could not mark analysis failed"),
      );
  });

  res.status(202).json({ analysis });
});

// ─── GET /api/analyses/:id ───────────────────────────────────────────────────

router.get("/analyses/:id", authenticate, async (req: AuthRequest, res) => {
  const id = safeUuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }

  const [analysis] = await db
    .select()
    .from(analysesTable)
    .where(and(eq(analysesTable.id, id.data), eq(analysesTable.userId, req.userId!)))
    .limit(1);

  if (!analysis) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }

  const [tips, risks] = await Promise.all([
    db.select().from(coachingTipsTable).where(eq(coachingTipsTable.analysisId, analysis.id)),
    db.select().from(injuryRisksTable).where(eq(injuryRisksTable.analysisId, analysis.id)),
  ]);

  res.json({ analysis, tips, injuryRisks: risks });
});

// ─── DELETE /api/analyses/:id ────────────────────────────────────────────────

router.delete("/analyses/:id", authenticate, async (req: AuthRequest, res) => {
  const id = safeUuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }

  const [deleted] = await db
    .delete(analysesTable)
    .where(and(eq(analysesTable.id, id.data), eq(analysesTable.userId, req.userId!)))
    .returning({ id: analysesTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }

  res.json({ success: true });
});

// ─── Pipeline ────────────────────────────────────────────────────────────────

async function runAnalysis(
  analysisId: string,
  userId: string,
  input: { title: string; sport: string; duration?: number },
  profile: { level: string; goals: string[]; injuryConcerns: string[] } | undefined,
  metrics: PoseMetrics | undefined,
): Promise<void> {
  // Without usable measurements there is nothing honest to score. Complete the
  // analysis in an explicit "unscored" state instead of inventing numbers.
  if (!metrics || !isScorable(metrics)) {
    await db
      .update(analysesTable)
      .set({
        status: "complete",
        analysisMethod: "unscored",
        summary:
          "We couldn't track your body reliably enough in this clip to measure joint angles. " +
          "Film again with your whole body in frame, good lighting, and the camera steady side-on.",
      })
      .where(eq(analysesTable.id, analysisId));

    logger.info({ analysisId, event: "analysis_unscored" }, "Completed without scores — clip not trackable");
    return;
  }

  const scores = computeScores(metrics);
  const riskFindings = deriveRiskFindings(metrics);

  const narrative = await generateNarrative({
    sport: input.sport,
    title: input.title,
    level: profile?.level ?? "intermediate",
    metrics,
    scores,
    riskFindings,
    goals: profile?.goals,
    injuryConcerns: profile?.injuryConcerns,
  });

  await db
    .update(analysesTable)
    .set({
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
      strengths: narrative.strengths,
      improvements: narrative.improvements,
      summary: narrative.summary,
    })
    .where(eq(analysesTable.id, analysisId));

  if (narrative.tips.length > 0) {
    await db.insert(coachingTipsTable).values(
      narrative.tips.map((t) => ({
        analysisId,
        category: t.category,
        severity: t.severity,
        title: t.title,
        description: t.description,
        drill: t.drill,
      })),
    );
  }

  // Risk rows are built from the *measured* findings; Claude only supplies the
  // prose for joints we actually flagged. A joint it invents has no measurement
  // to attach to and is dropped.
  if (riskFindings.length > 0) {
    const explanationFor = new Map(
      narrative.riskExplanations.map((e) => [e.joint.toLowerCase().trim(), e]),
    );

    await db.insert(injuryRisksTable).values(
      riskFindings.map((f) => {
        const label = JOINT_LABELS[f.joint];
        const explanation =
          explanationFor.get(label) ?? explanationFor.get(f.joint.toLowerCase());
        return {
          analysisId,
          joint: label,
          riskPercent: f.riskPercent,
          cautionPercent: f.cautionPercent,
          observedMin: f.observedMin,
          observedMax: f.observedMax,
          description:
            explanation?.description ??
            `Your ${label} spent ${f.riskPercent}% of the clip outside its typical safe range (observed ${f.observedMin}–${f.observedMax}°).`,
          prevention:
            explanation?.prevention ??
            "Reduce the depth or load of this movement until you can hold the position with control.",
        };
      }),
    );
  }

  if (scores.overall !== null) {
    await db.insert(progressEntriesTable).values({
      userId,
      date: new Date().toISOString().split("T")[0]!,
      overallScore: scores.overall,
      techniqueScore: scores.technique,
      balanceScore: scores.balance,
      consistencyScore: scores.consistency,
      mobilityScore: scores.mobility,
      powerScore: null,
      speedScore: null,
    });
  }

  logger.info(
    { analysisId, overall: scores.overall, frames: metrics.frameCount, event: "analysis_complete" },
    "Analysis complete",
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function startOfNextMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

async function countAnalysesThisMonth(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(analysesTable)
    .where(
      and(eq(analysesTable.userId, userId), gte(analysesTable.uploadedAt, startOfMonth())),
    );
  return Number(row?.total ?? 0);
}

export default router;
