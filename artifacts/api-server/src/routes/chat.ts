/**
 * Coach chat routes — HTTP only.
 *
 * Orchestration lives in `services/chatService.ts`.
 */

import { Router } from "express";
import { z } from "zod";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { parseOrReject, safeMultiline, safeUuid } from "../lib/validate.js";
import { logger } from "../lib/logger.js";
import { recordAlert } from "../lib/alerting.js";
import { clientIp } from "../lib/rateLimit.js";
import { deleteMessages } from "../repositories/chatRepository.js";
import {
  getTranscript,
  canUseChat,
  resolveReference,
  sendMessage,
  CoachReplyFailed,
} from "../services/chatService.js";

const router = Router();

const sendMessageSchema = z.object({
  content: safeMultiline(1, 2000),
  referencedAnalysisId: safeUuid.optional(),
});

// ─── GET /api/chat ───────────────────────────────────────────────────────────

router.get("/chat", authenticate, async (req: AuthRequest, res) => {
  res.json({ messages: await getTranscript(req.userId!) });
});

// ─── POST /api/chat ──────────────────────────────────────────────────────────

router.post("/chat", authenticate, async (req: AuthRequest, res) => {
  const data = parseOrReject(sendMessageSchema, req.body, res, {
    route: "chat",
    ip: clientIp(req),
    userId: req.userId,
  });
  if (!data) return;

  if (!(await canUseChat(req.userId!))) {
    res.status(403).json({
      error: "AI Coach requires a Pro plan",
      code: "UPGRADE_REQUIRED",
      message: "Upgrade to Pro to chat with your AI coach.",
    });
    return;
  }

  let referencedAnalysisId: string | undefined;
  if (data.referencedAnalysisId) {
    referencedAnalysisId = await resolveReference(req.userId!, data.referencedAnalysisId);
    if (!referencedAnalysisId) {
      logger.warn(
        { userId: req.userId, event: "chat_foreign_analysis_ref" },
        "Chat referenced an analysis the caller does not own",
      );
      res.status(404).json({ error: "Analysis not found" });
      return;
    }
  }

  try {
    const reply = await sendMessage(req.userId!, data.content, referencedAnalysisId);
    res.json(reply);
  } catch (err) {
    if (err instanceof CoachReplyFailed) {
      recordAlert("chat_failed");
      logger.error(
        { err: err.cause, userId: req.userId, event: "chat_failed" },
        "Coach reply failed",
      );
      // The user's message is already persisted; surface a clean failure so the
      // client can offer a retry without duplicating it.
      res.status(503).json({
        error: "The coach is unavailable right now. Please try again in a moment.",
        userMessage: err.userMessage,
      });
      return;
    }
    throw err;
  }
});

// ─── DELETE /api/chat ────────────────────────────────────────────────────────

router.delete("/chat", authenticate, async (req: AuthRequest, res) => {
  await deleteMessages(req.userId!);
  res.json({ success: true });
});

export default router;
