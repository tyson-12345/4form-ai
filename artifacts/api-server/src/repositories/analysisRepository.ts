/**
 * Every database query touching analyses, coaching tips, injury risks and
 * progress entries. No HTTP, no Claude, no business rules — just data access.
 *
 * ── The ownership rule ──────────────────────────────────────────────────────
 * Every function that reads or writes a user-owned row takes `userId` and puts
 * it in the WHERE clause. There is deliberately no `findAnalysisById(id)`
 * without an owner, because the moment one exists, a caller will use it and an
 * IDOR ships. Making the safe call the *only* call means the check cannot be
 * forgotten rather than merely being remembered.
 *
 * This layering is adopted from Oscar's fork, which had the better structure
 * here. The queries are rewritten against this schema (uuid keys, different
 * table set) — the pattern ports, the code did not.
 */

import { db } from "@workspace/db";
import {
  analysesTable,
  coachingTipsTable,
  injuryRisksTable,
  progressEntriesTable,
} from "@workspace/db";
import { eq, and, desc, count, gte } from "drizzle-orm";

export type AnalysisRow = typeof analysesTable.$inferSelect;
export type NewAnalysis = typeof analysesTable.$inferInsert;
export type CoachingTipRow = typeof coachingTipsTable.$inferSelect;
export type InjuryRiskRow = typeof injuryRisksTable.$inferSelect;

// ─── Analyses ────────────────────────────────────────────────────────────────

export async function findAnalysesByUserId(userId: string): Promise<AnalysisRow[]> {
  return db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.userId, userId))
    .orderBy(desc(analysesTable.uploadedAt));
}

export async function findAnalysisById(
  id: string,
  userId: string,
): Promise<AnalysisRow | undefined> {
  const [row] = await db
    .select()
    .from(analysesTable)
    .where(and(eq(analysesTable.id, id), eq(analysesTable.userId, userId)))
    .limit(1);
  return row;
}

/** Ownership probe that reads only the id — used before accepting a reference. */
export async function findAnalysisOwnership(
  id: string,
  userId: string,
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: analysesTable.id })
    .from(analysesTable)
    .where(and(eq(analysesTable.id, id), eq(analysesTable.userId, userId)))
    .limit(1);
  return row;
}

export async function findLatestAnalysis(userId: string): Promise<AnalysisRow | undefined> {
  const [row] = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.userId, userId))
    .orderBy(desc(analysesTable.uploadedAt))
    .limit(1);
  return row;
}

export async function createAnalysis(data: NewAnalysis): Promise<AnalysisRow> {
  const [row] = await db.insert(analysesTable).values(data).returning();
  return row;
}

/**
 * Update by id alone.
 *
 * The one function here without an owner check, because the pipeline that
 * calls it is operating on a row it has already created in this request. It is
 * not reachable from a route handler with a user-supplied id — keep it that
 * way.
 */
export async function updateAnalysisById(
  id: string,
  data: Partial<AnalysisRow>,
): Promise<void> {
  await db.update(analysesTable).set(data).where(eq(analysesTable.id, id));
}

export async function deleteAnalysis(
  id: string,
  userId: string,
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .delete(analysesTable)
    .where(and(eq(analysesTable.id, id), eq(analysesTable.userId, userId)))
    .returning({ id: analysesTable.id });
  return row;
}

export async function countAnalysesSince(userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(analysesTable)
    .where(and(eq(analysesTable.userId, userId), gte(analysesTable.uploadedAt, since)));
  return Number(row?.total ?? 0);
}

export async function countAnalyses(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(analysesTable)
    .where(eq(analysesTable.userId, userId));
  return Number(row?.total ?? 0);
}

// ─── Coaching tips ───────────────────────────────────────────────────────────

export async function findTipsByAnalysis(analysisId: string): Promise<CoachingTipRow[]> {
  return db
    .select()
    .from(coachingTipsTable)
    .where(eq(coachingTipsTable.analysisId, analysisId));
}

export async function createTips(
  rows: (typeof coachingTipsTable.$inferInsert)[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(coachingTipsTable).values(rows);
}

// ─── Injury risks ────────────────────────────────────────────────────────────

export async function findRisksByAnalysis(analysisId: string): Promise<InjuryRiskRow[]> {
  return db
    .select()
    .from(injuryRisksTable)
    .where(eq(injuryRisksTable.analysisId, analysisId));
}

export async function createRisks(
  rows: (typeof injuryRisksTable.$inferInsert)[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(injuryRisksTable).values(rows);
}

/** Upgrade the prose on one measured risk row, leaving its numbers untouched. */
export async function updateRiskProse(
  analysisId: string,
  joint: string,
  prose: { description: string; prevention: string },
): Promise<void> {
  await db
    .update(injuryRisksTable)
    .set(prose)
    .where(and(eq(injuryRisksTable.analysisId, analysisId), eq(injuryRisksTable.joint, joint)));
}

// ─── Progress entries ────────────────────────────────────────────────────────

export async function findProgressEntries(userId: string, limit = 90) {
  return db
    .select()
    .from(progressEntriesTable)
    .where(eq(progressEntriesTable.userId, userId))
    .orderBy(desc(progressEntriesTable.date))
    .limit(limit);
}

export async function createProgressEntry(
  data: typeof progressEntriesTable.$inferInsert,
): Promise<void> {
  await db.insert(progressEntriesTable).values(data);
}
