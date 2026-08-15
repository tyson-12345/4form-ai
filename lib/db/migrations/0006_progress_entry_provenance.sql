-- Link each progress entry to the analysis whose scores it carries, so
-- deleting a session also removes its point from the trend. Without this,
-- a deleted session's score lived on in Progress ("BEST 100" from a session
-- that no longer exists anywhere in the app).
--
-- Bare uuid, no FK: the analyses row is scrubbed and later hard-pruned for
-- quota-integrity reasons, and this entry must follow the user's delete, not
-- the janitor's. Rows created before this column exist with NULL and are
-- left untouched by per-session deletion.
--
-- Apply to an existing database with:
--   psql "$DATABASE_URL" -f lib/db/migrations/0006_progress_entry_provenance.sql

ALTER TABLE "progress_entries" ADD COLUMN IF NOT EXISTS "analysis_id" uuid;
