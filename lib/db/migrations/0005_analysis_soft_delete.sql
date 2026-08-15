-- Soft-delete for analyses, so deleting a session cannot refund its monthly
-- quota slot. Deleted rows are scrubbed of content immediately, hidden from
-- every read path, and hard-pruned by the in-process sweep once the calendar
-- month they counted toward has closed.
--
-- Apply to an existing database with:
--   psql "$DATABASE_URL" -f lib/db/migrations/0005_analysis_soft_delete.sql
-- (A fresh database gets this column from `drizzle-kit push` / schema/index.ts.)

ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
