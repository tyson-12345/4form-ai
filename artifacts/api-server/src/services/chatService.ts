/**
 * Coach chat orchestration: entitlement, conversation assembly, and the model
 * call.
 *
 * Everything the athlete typed is wrapped as untrusted before it reaches the
 * prompt — see `lib/promptSafety.ts`. The chat path matters most for that,
 * because its athlete context is appended to the *system* prompt.
 */

import { chatWithCoach } from "../lib/claude.js";
import {
  findRecentMessages,
  createMessage,
  type ChatMessageRow,
} from "../repositories/chatRepository.js";
import {
  findLatestAnalysis,
  findAnalysisOwnership,
} from "../repositories/analysisRepository.js";
import { findProfileByUserId, findSubscriptionByUserId } from "../repositories/userRepository.js";
import { TIER_LIMITS, resolveEffectiveTier } from "./entitlementService.js";

/** How many prior turns are replayed to the model. */
const HISTORY_TURNS = 10;

/** How many messages the transcript endpoint returns. */
export const TRANSCRIPT_LIMIT = 50;

export async function getTranscript(userId: string): Promise<ChatMessageRow[]> {
  const messages = await findRecentMessages(userId, TRANSCRIPT_LIMIT);
  return messages.reverse();
}

/**
 * True when the user's *effective* tier includes AI chat.
 *
 * Uses `resolveEffectiveTier` rather than the stored tier so an expired or
 * cancelled paid plan stops granting access the moment it lapses.
 */
export async function canUseChat(userId: string): Promise<boolean> {
  const subscription = await findSubscriptionByUserId(userId);
  return TIER_LIMITS[resolveEffectiveTier(subscription)].aiChat;
}

/**
 * Confirm a referenced analysis belongs to the caller.
 *
 * Without this any user could attach someone else's analysis id to their own
 * message and have the coach read from it.
 */
export async function resolveReference(
  userId: string,
  analysisId: string,
): Promise<string | undefined> {
  const owned = await findAnalysisOwnership(analysisId, userId);
  return owned?.id;
}

export interface CoachReply {
  userMessage: ChatMessageRow;
  assistantMessage: ChatMessageRow;
}

/** Thrown when the user's message is stored but the coach could not reply. */
export class CoachReplyFailed extends Error {
  constructor(readonly userMessage: ChatMessageRow, cause: unknown) {
    super("Coach reply failed");
    this.name = "CoachReplyFailed";
    this.cause = cause;
  }
}

/**
 * Persist the athlete's message, ask the coach, persist the reply.
 *
 * The user's message is written first and deliberately kept on failure: a
 * retry should not have to re-send it, and losing what someone typed is worse
 * than showing them an error.
 */
export async function sendMessage(
  userId: string,
  content: string,
  referencedAnalysisId: string | undefined,
): Promise<CoachReply> {
  const userMessage = await createMessage({
    userId,
    role: "user",
    content,
    referencedAnalysisId,
  });

  const [profile, recentAnalysis, history] = await Promise.all([
    findProfileByUserId(userId),
    findLatestAnalysis(userId),
    findRecentMessages(userId, HISTORY_TURNS),
  ]);

  const conversation = history
    .reverse()
    .filter((m) => m.id !== userMessage.id)
    .map((m) => ({ role: m.role, content: m.content }));

  conversation.push({ role: "user", content });

  // Only a completed, genuinely measured analysis is offered as context. An
  // unscored or in-flight one has no numbers worth reasoning about.
  const measured =
    recentAnalysis?.status === "complete" && recentAnalysis.analysisMethod === "pose-measured"
      ? recentAnalysis
      : undefined;

  let replyText: string;
  try {
    replyText = await chatWithCoach(conversation, {
      sport: profile?.sport,
      level: profile?.level,
      recentAnalysis: measured
        ? {
            title: measured.title,
            // Only measured dimensions. Power and speed are deliberately absent
            // — they were dropped on 2026-08-12 rather than reported as "not
            // measured", so the coach has no reason to raise them at all.
            //
            // Remaining nulls still pass through: a dimension can be unmeasured
            // for this particular clip (poor tracking, partial body in frame),
            // and the coach should say so rather than treat it as a zero.
            scores: {
              overall: measured.overallScore,
              technique: measured.techniqueScore,
              balance: measured.balanceScore,
              consistency: measured.consistencyScore,
              mobility: measured.mobilityScore,
            },
            strengths: (measured.strengths) ?? [],
            improvements: (measured.improvements) ?? [],
          }
        : undefined,
    });
  } catch (err) {
    throw new CoachReplyFailed(userMessage, err);
  }

  const assistantMessage = await createMessage({
    userId,
    role: "assistant",
    content: replyText,
  });

  return { userMessage, assistantMessage };
}
