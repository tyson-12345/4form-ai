-- Record when the movement in a clip does not look like the sport the athlete
-- picked for it, so the analysis screen can say so.
--
-- The sport is chosen per clip, not just per profile, and cross-training is a
-- deliberate, supported case: an athlete whose profile says Running may quite
-- reasonably upload a squat. So this is a note, never a correction, and it is
-- only written when the contradiction is unambiguous.
--
-- jsonb rather than a pair of columns because the shape is Claude's structured
-- output (verdict, suggested sport, confidence, wording) and is expected to
-- change as the prompt is tuned. NULL means "not assessed": every analysis
-- created before this column existed, plus any clip too poorly tracked to
-- judge. That is distinct from a stored verdict of "matches".
--
-- Apply to an existing database with:
--   psql "$DATABASE_URL" -f lib/db/migrations/0007_sport_mismatch.sql

ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "sport_mismatch" jsonb;
