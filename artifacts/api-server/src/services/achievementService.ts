/**
 * Achievement catalog and unlock logic.
 *
 * Progress for the upload-count badges is derived from the analyses table on
 * every read rather than being incremented, so a deleted analysis is reflected
 * immediately and the counter cannot drift from reality. Unlocks, once earned,
 * are persisted and never revoked.
 */

import {
  findAllAchievements,
  findUserAchievements,
  seedAchievements,
  unlockAchievement,
  createUnlockedAchievement,
  type UserAchievementRow,
} from "../repositories/achievementRepository.js";
import { countAnalyses } from "../repositories/analysisRepository.js";

export interface CatalogEntry {
  id: string;
  title: string;
  description: string;
  icon: string;
  requiredCount: number;
}

export const ACHIEVEMENT_CATALOG: readonly CatalogEntry[] = [
  { id: "first-upload", title: "First Rep", description: "Upload your first training video", icon: "🎬", requiredCount: 1 },
  { id: "five-analyses", title: "Consistent", description: "Complete 5 video analyses", icon: "📊", requiredCount: 5 },
  { id: "ten-analyses", title: "Dedicated", description: "Complete 10 video analyses", icon: "🏆", requiredCount: 10 },
  { id: "streak-7", title: "Week Warrior", description: "Maintain a 7-day training streak", icon: "🔥", requiredCount: 7 },
  { id: "score-80", title: "High Performer", description: "Achieve an overall score of 80+", icon: "⭐", requiredCount: 1 },
  { id: "score-90", title: "Elite Athlete", description: "Achieve an overall score of 90+", icon: "💎", requiredCount: 1 },
  { id: "injury-free", title: "Safe Mover", description: "Complete 5 analyses with no high-risk injuries", icon: "🛡️", requiredCount: 5 },
  { id: "chat-10", title: "Coach's Pet", description: "Send 10 messages to your AI coach", icon: "💬", requiredCount: 10 },
];

/** Badges whose progress is the user's total analysis count. */
const UPLOAD_COUNT_BADGES = new Set(["first-upload", "five-analyses", "ten-analyses"]);

export interface AchievementView extends CatalogEntry {
  progress: number;
  total: number;
  unlockedAt: Date | null;
  unlocked: boolean;
}

export async function listAchievements(userId: string): Promise<AchievementView[]> {
  await seedAchievements([...ACHIEVEMENT_CATALOG]);

  const [catalog, earned, analysisCount] = await Promise.all([
    findAllAchievements(),
    findUserAchievements(userId),
    countAnalyses(userId),
  ]);

  const earnedById = new Map(earned.map((ua) => [ua.achievementId, ua]));

  const view = catalog.map((a): AchievementView => {
    const ua = earnedById.get(a.id);
    const progress = UPLOAD_COUNT_BADGES.has(a.id)
      ? Math.min(analysisCount, a.requiredCount)
      : (ua?.progress ?? 0);

    return {
      id: a.id,
      title: a.title,
      description: a.description,
      icon: a.icon,
      requiredCount: a.requiredCount,
      progress,
      total: a.requiredCount,
      unlockedAt: ua?.unlockedAt ?? null,
      unlocked: Boolean(ua?.unlockedAt) || progress >= a.requiredCount,
    };
  });

  await persistUnlocks(userId, analysisCount, earnedById);

  return view;
}

async function persistUnlocks(
  userId: string,
  analysisCount: number,
  earnedById: Map<string, UserAchievementRow>,
): Promise<void> {
  const newlyEarned = ACHIEVEMENT_CATALOG.filter(
    (a) =>
      UPLOAD_COUNT_BADGES.has(a.id) &&
      analysisCount >= a.requiredCount &&
      !earnedById.get(a.id)?.unlockedAt,
  );

  for (const a of newlyEarned) {
    const existing = earnedById.get(a.id);
    if (existing) {
      await unlockAchievement(existing.id, analysisCount);
    } else {
      await createUnlockedAchievement({
        userId,
        achievementId: a.id,
        progress: analysisCount,
        total: a.requiredCount,
        unlockedAt: new Date(),
      });
    }
  }
}
