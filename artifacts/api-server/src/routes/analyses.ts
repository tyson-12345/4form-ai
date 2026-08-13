/**
 * Analysis routes — HTTP only.
 *
 * Parsing, authentication, status codes and shaping the response. Everything
 * else lives in `services/analysisService.ts` (orchestration) and
 * `repositories/analysisRepository.ts` (data access).
 */

import { Router } from "express";
import { z } from "zod";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { parseOrReject, safeMediaUrl, safeText, safeUuid } from "../lib/validate.js";
import { logger } from "../lib/logger.js";
import { recordAlert } from "../lib/alerting.js";
import { clientIp } from "../lib/rateLimit.js";
import {
  findAnalysesByUserId,
  findAnalysisById,
  findTipsByAnalysis,
  findRisksByAnalysis,
  deleteAnalysis,
} from "../repositories/analysisRepository.js";
import { findProfileByUserId } from "../repositories/userRepository.js";
import {
  getUsage,
  checkQuota,
  startAnalysis,
  runPipeline,
  markFailed,
} from "../services/analysisService.js";

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

/**
 * Ordered angle readings for one joint, `null` where it was not visible.
 *
 * Bounded at 600 against SCAN_SAMPLES of 90: generous enough that raising the
 * sample cap does not require a schema change, tight enough that six of these
 * cannot approach the 256 kB body limit.
 */
const jointSeriesSchema = z.array(z.number().min(0).max(360).nullable()).max(600);

const poseMetricsSchema = z.object({
  frameCount: z.number().int().min(0).max(1_000_000),
  trackingQuality: z.number().min(0).max(1),
  durationSec: z.number().min(0).max(7200),
  joints: z.record(JOINT_ENUM, jointStatsSchema),
  riskFrames: z.record(JOINT_ENUM, riskFramesSchema),
  /**
   * Optional so clips from app builds predating the consistency rewrite are
   * still accepted. Those score `null` for consistency rather than being
   * rejected — the rest of the measurement is unaffected.
   */
  series: z.record(JOINT_ENUM, jointSeriesSchema).optional(),
  /**
   * How square the athlete stood to the camera; see `balanceScore`. Nullable
   * because the tracker reports `null` when the torso was never fully visible,
   * and optional for the same backward-compatibility reason as `series`.
   */
  facingRatio: z.number().min(0).max(10).nullable().optional(),
});

const createAnalysisSchema = z.object({
  title: safeText(1, 120),
  sport: safeText(1, 40),
  /**
   * Device-local video URI. Kept only so the client can re-open the clip; it is
   * never fetched server-side, which is why an arbitrary scheme is acceptable.
   */
  videoUrl: safeMediaUrl.optional(),
  duration: z.number().positive().max(7200).optional(),
  poseMetrics: poseMetricsSchema.optional(),
});

// ─── GET /api/analyses ───────────────────────────────────────────────────────

router.get("/analyses", authenticate, async (req: AuthRequest, res) => {
  const analyses = await findAnalysesByUserId(req.userId!);
  res.json({ analyses });
});

// ─── GET /api/analyses/usage ─────────────────────────────────────────────────

router.get("/analyses/usage", authenticate, async (req: AuthRequest, res) => {
  res.json(await getUsage(req.userId!));
});

// ─── POST /api/analyses ──────────────────────────────────────────────────────

router.post("/analyses", authenticate, async (req: AuthRequest, res) => {
  const data = parseOrReject(createAnalysisSchema, req.body, res, {
    route: "analyses",
    ip: clientIp(req),
    userId: req.userId,
  });
  if (!data) return;

  const rejection = await checkQuota(req.userId!);
  if (rejection) {
    res.status(403).json(rejection);
    return;
  }

  const profile = await findProfileByUserId(req.userId!);
  const metrics = data.poseMetrics;

  const analysis = await startAnalysis(req.userId!, { ...data, poseMetrics: metrics });

  // Run the write-up asynchronously; the client polls for status.
  runPipeline(
    analysis.id,
    req.userId!,
    { title: data.title, sport: data.sport },
    profile
      ? {
          level: profile.level,
          goals: profile.goals,
          injuryConcerns: profile.injuryConcerns,
        }
      : undefined,
    metrics,
  ).catch((err: unknown) => {
    recordAlert("analysis_failed");
    logger.error(
      { analysisId: analysis.id, err, event: "analysis_failed" },
      "Analysis generation failed",
    );
    markFailed(analysis.id).catch((dbErr: unknown) =>
      logger.error(
        { dbErr, event: "analysis_status_write_failed" },
        "Could not mark analysis failed",
      ),
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

  const analysis = await findAnalysisById(id.data, req.userId!);
  if (!analysis) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }

  const [tips, injuryRisks] = await Promise.all([
    findTipsByAnalysis(analysis.id),
    findRisksByAnalysis(analysis.id),
  ]);

  res.json({ analysis, tips, injuryRisks });
});

// ─── DELETE /api/analyses/:id ────────────────────────────────────────────────

router.delete("/analyses/:id", authenticate, async (req: AuthRequest, res) => {
  const id = safeUuid.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }

  const deleted = await deleteAnalysis(id.data, req.userId!);
  if (!deleted) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }

  res.json({ success: true });
});

export default router;
