/**
 * Database access for the achievement catalog and per-user progress.
 *
 * See `analysisRepository.ts` for the ownership rule these functions follow.
 */

import { db } from "@workspace/db";
import { achievementsTable, userAchievementsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type AchievementRow = typeof achievementsTable.$inferSelect;
export type UserAchievementRow = typeof userAchievementsTable.$inferSelect;

export async function findAllAchievements(): Promise<AchievementRow[]> {
  return db.select().from(achievementsTable);
}

export async function findUserAchievements(userId: string): Promise<UserAchievementRow[]> {
  return db
    .select()
    .from(userAchievementsTable)
    .where(eq(userAchievementsTable.userId, userId));
}

/** Insert the catalog rows, leaving any that already exist untouched. */
export async function seedAchievements(
  rows: (typeof achievementsTable.$inferInsert)[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(achievementsTable).values(rows).onConflictDoNothing();
}

export async function unlockAchievement(
  id: string,
  progress: number,
): Promise<void> {
  await db
    .update(userAchievementsTable)
    .set({ unlockedAt: new Date(), progress })
    .where(eq(userAchievementsTable.id, id));
}

export async function createUnlockedAchievement(
  data: typeof userAchievementsTable.$inferInsert,
): Promise<void> {
  await db.insert(userAchievementsTable).values(data);
}
