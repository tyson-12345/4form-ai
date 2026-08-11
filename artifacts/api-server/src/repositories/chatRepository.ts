/**
 * Database access for coach chat messages.
 *
 * See `analysisRepository.ts` for the ownership rule these functions follow.
 */

import { db } from "@workspace/db";
import { chatMessagesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

export type ChatMessageRow = typeof chatMessagesTable.$inferSelect;

/**
 * Most recent messages first — callers reverse for display.
 *
 * Ordering newest-first and limiting is deliberate: the tail of the
 * conversation is what matters, and an athlete with a long history should not
 * pull their entire transcript to render the last screenful.
 */
export async function findRecentMessages(userId: string, limit: number): Promise<ChatMessageRow[]> {
  return db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.userId, userId))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(limit);
}

export async function createMessage(
  data: typeof chatMessagesTable.$inferInsert,
): Promise<ChatMessageRow> {
  const [row] = await db.insert(chatMessagesTable).values(data).returning();
  return row;
}

export async function deleteMessages(userId: string): Promise<void> {
  await db.delete(chatMessagesTable).where(eq(chatMessagesTable.userId, userId));
}

export async function countMessages(userId: string): Promise<number> {
  const rows = await db
    .select({ id: chatMessagesTable.id })
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.userId, userId));
  return rows.length;
}
