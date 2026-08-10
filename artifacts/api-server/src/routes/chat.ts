import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  chatMessagesTable,
  analysesTable,
  athleteProfilesTable,
  subscriptionsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { chatWithCoach } from "../lib/claude.js";
import { parseOrReject, safeMultiline, safeUuid } from "../lib/validate.js";
import { resolveEffectiveTier, TIER_LIMITS } from "./subscriptions.js";
import { logger } from "../lib/logger.js";
import { clientIp } from "../lib/rateLimit.js";

const router = Router();

const sendMessageSchema = z.object({
  content: safeMultiline(1, 2000),
  referencedAnalysisId: safeUuid.optional(),
});

// ─── GET /api/chat ───────────────────────────────────────────────────────────

router.get("/chat", authenticate, async (req: AuthRequest, res) => {
  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.userId, req.userId!))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(50);

  res.json({ messages: messages.reverse() });
});

// ─── POST /api/chat ──────────────────────────────────────────────────────────

router.post("/chat", authenticate, async (req: AuthRequest, res) => {
  const data = parseOrReject(sendMessageSchema, req.body, res, {
    route: "chat",
    ip: clientIp(req),
    userId: req.userId,
  });
  if (!data) return;

  // ── Entitlement ──
  const [subscription] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, req.userId!))
    .limit(1);

  // resolveEffectiveTier (not `subscription.tier`) so an expired or cancelled
  // paid plan stops granting access the moment it lapses.
  const tier = resolveEffectiveTier(subscription);
  if (!TIER_LIMITS[tier].aiChat) {
    res.status(403).json({
      error: "AI Coach requires a Pro plan",
      code: "UPGRADE_REQUIRED",
      message: "Upgrade to Pro to chat with your AI coach.",
    });
    return;
  }

  // A referenced analysis must belong to the caller — otherwise any user could
  // attach someone else's analysis id to their own message.
  let referencedAnalysisId: string | undefined;
  if (data.referencedAnalysisId) {
    const [owned] = await db
      .select({ id: analysesTable.id })
      .from(analysesTable)
      .where(
        and(
          eq(analysesTable.id, data.referencedAnalysisId),
          eq(analysesTable.userId, req.userId!),
        ),
      )
      .limit(1);

    if (!owned) {
      logger.warn(
        { userId: req.userId, event: "chat_foreign_analysis_ref" },
        "Chat referenced an analysis the caller does not own",
      );
      res.status(404).json({ error: "Analysis not found" });
      return;
    }
    referencedAnalysisId = owned.id;
  }

  const [userMsg] = await db
    .insert(chatMessagesTable)
    .values({
      userId: req.userId!,
      role: "user",
      content: data.content,
      referencedAnalysisId,
    })
    .returning();

  const [profile] = await db
    .select()
    .from(athleteProfilesTable)
    .where(eq(athleteProfilesTable.userId, req.userId!))
    .limit(1);

  const [recentAnalysis] = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.userId, req.userId!))
    .orderBy(desc(analysesTable.uploadedAt))
    .limit(1);

  const history = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.userId, req.userId!))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(10);

  const conversation = history
    .reverse()
    .filter((m) => m.id !== userMsg!.id)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  conversation.push({ role: "user", content: data.content });

  let replyText: string;
  try {
    replyText = await chatWithCoach(conversation, {
      sport: profile?.sport,
      level: profile?.level,
      recentAnalysis:
        recentAnalysis?.status === "complete" && recentAnalysis.analysisMethod === "pose-measured"
          ? {
              title: recentAnalysis.title,
              // Nulls are passed through so the coach can say "not measured"
              // rather than treating an unmeasured dimension as a zero.
              scores: {
                overall: recentAnalysis.overallScore,
                technique: recentAnalysis.techniqueScore,
                balance: recentAnalysis.balanceScore,
                consistency: recentAnalysis.consistencyScore,
                mobility: recentAnalysis.mobilityScore,
                power: recentAnalysis.powerScore,
                speed: recentAnalysis.speedScore,
              },
              strengths: (recentAnalysis.strengths as string[]) ?? [],
              improvements: (recentAnalysis.improvements as string[]) ?? [],
            }
          : undefined,
    });
  } catch (err) {
    logger.error({ err, userId: req.userId, event: "chat_failed" }, "Coach reply failed");
    // The user's message is already persisted; surface a clean failure so the
    // client can offer a retry without duplicating it.
    res.status(503).json({
      error: "The coach is unavailable right now. Please try again in a moment.",
      userMessage: userMsg,
    });
    return;
  }

  const [assistantMsg] = await db
    .insert(chatMessagesTable)
    .values({ userId: req.userId!, role: "assistant", content: replyText })
    .returning();

  res.json({ userMessage: userMsg, assistantMessage: assistantMsg });
});

// ─── DELETE /api/chat ────────────────────────────────────────────────────────

router.delete("/chat", authenticate, async (req: AuthRequest, res) => {
  await db.delete(chatMessagesTable).where(eq(chatMessagesTable.userId, req.userId!));
  res.json({ success: true });
});

export default router;
