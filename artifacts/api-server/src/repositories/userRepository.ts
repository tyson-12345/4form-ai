/**
 * Database access for users, athlete profiles and subscriptions.
 *
 * Auth-specific writes (lockout counters, password migration, reset tokens)
 * stay in `routes/auth.ts` for now — they are tightly coupled to the login
 * state machine and moving them is a separate change from this refactor.
 *
 * See `analysisRepository.ts` for the ownership rule these functions follow.
 */

import { db } from "@workspace/db";
import { usersTable, athleteProfilesTable, subscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type UserRow = typeof usersTable.$inferSelect;
export type ProfileRow = typeof athleteProfilesTable.$inferSelect;
export type SubscriptionRow = typeof subscriptionsTable.$inferSelect;

// ─── Users ───────────────────────────────────────────────────────────────────

export async function findUserById(userId: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return row;
}

/**
 * Delete the user and, by cascade, everything attached to them.
 *
 * Every child table declares `onDelete: "cascade"` against `users.id`, so this
 * one statement removes profile, subscription, analyses, tips, risks, progress
 * entries, chat messages, achievements and reset tokens. Verified against the
 * schema — if a table is ever added without the cascade, this stops being
 * complete and account deletion silently leaves orphans.
 */
export async function deleteUser(userId: string): Promise<void> {
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}

// ─── Profiles ────────────────────────────────────────────────────────────────

export async function findProfileByUserId(userId: string): Promise<ProfileRow | undefined> {
  const [row] = await db
    .select()
    .from(athleteProfilesTable)
    .where(eq(athleteProfilesTable.userId, userId))
    .limit(1);
  return row;
}

export async function updateProfile(
  userId: string,
  data: Partial<typeof athleteProfilesTable.$inferInsert>,
): Promise<ProfileRow | undefined> {
  const [row] = await db
    .update(athleteProfilesTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(athleteProfilesTable.userId, userId))
    .returning();
  return row;
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

export async function findSubscriptionByUserId(
  userId: string,
): Promise<SubscriptionRow | undefined> {
  const [row] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);
  return row;
}

export async function updateSubscription(
  userId: string,
  data: Partial<typeof subscriptionsTable.$inferInsert>,
): Promise<SubscriptionRow | undefined> {
  const [row] = await db
    .update(subscriptionsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(subscriptionsTable.userId, userId))
    .returning();
  return row;
}
