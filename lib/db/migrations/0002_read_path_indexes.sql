-- Migration 0002 — indexes for the hot read paths
--
-- Additive and idempotent: every statement is IF NOT EXISTS, no column is
-- changed, and no row is rewritten. Safe to run against production and safe to
-- run twice.
--
-- Index coverage adopted from Oscar's fork (lib/db/drizzle/0007), which had
-- thought this through more carefully than migration 0001 did. Adapted to this
-- schema's uuid keys and table set, and made composite where the query filters
-- and sorts on different columns.
--
-- CONCURRENTLY is deliberately not used: these tables are small today, the
-- locks are brief, and CONCURRENTLY cannot run inside the transaction that
-- makes this file safe to re-run. Revisit if analyses grows past ~1M rows.

BEGIN;

-- ── analyses ────────────────────────────────────────────────────────────────
-- The list screen filters by user and sorts by uploaded_at descending. A
-- composite covers both, so Postgres walks the index instead of sorting the
-- user's whole partition.
CREATE INDEX IF NOT EXISTS analyses_user_uploaded_idx
  ON analyses (user_id, uploaded_at DESC);

-- The monthly quota count runs on every upload attempt, before any work is
-- done, so it is on the latency path for the action users care most about.
CREATE INDEX IF NOT EXISTS analyses_user_status_idx
  ON analyses (user_id, status);

-- ── coaching_tips ───────────────────────────────────────────────────────────
-- Fetched by analysis on the detail screen.
CREATE INDEX IF NOT EXISTS coaching_tips_analysis_idx
  ON coaching_tips (analysis_id);

-- ── injury_risks ────────────────────────────────────────────────────────────
-- Fetched by analysis alongside tips, and updated per (analysis, joint) when a
-- write-up upgrades the prose on a measured row.
CREATE INDEX IF NOT EXISTS injury_risks_analysis_idx
  ON injury_risks (analysis_id);

CREATE INDEX IF NOT EXISTS injury_risks_analysis_joint_idx
  ON injury_risks (analysis_id, joint);

-- ── progress_entries ────────────────────────────────────────────────────────
-- Charted per user, ordered by date.
CREATE INDEX IF NOT EXISTS progress_entries_user_date_idx
  ON progress_entries (user_id, date DESC);

-- ── chat_messages ───────────────────────────────────────────────────────────
-- Every read is "newest N for this user" — both the transcript and the history
-- window replayed to the model.
CREATE INDEX IF NOT EXISTS chat_messages_user_created_idx
  ON chat_messages (user_id, created_at DESC);

-- ── user_achievements ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS user_achievements_user_idx
  ON user_achievements (user_id);

COMMIT;
