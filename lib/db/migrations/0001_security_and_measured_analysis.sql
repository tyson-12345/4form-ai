-- Migration 0001 — security hardening + measured analysis
--
-- Additive and idempotent: every statement is IF NOT EXISTS, no column is
-- dropped, and no existing row is rewritten. Safe to run against production
-- and safe to run twice.
--
-- Normal path is `pnpm --filter @workspace/db run push` (drizzle-kit diffs the
-- schema and applies it). This file exists so the exact change is reviewable in
-- git and can be applied by hand against a database you'd rather not point a
-- schema-diff tool at.

BEGIN;

-- ── Account lockout + password migration state ──────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_algo         text        NOT NULL DEFAULT 'bcrypt',
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until          timestamptz,
  ADD COLUMN IF NOT EXISTS last_failed_login_at  timestamptz;

-- Locked-account lookups happen on every login for a locked user.
CREATE INDEX IF NOT EXISTS users_locked_until_idx
  ON users (locked_until)
  WHERE locked_until IS NOT NULL;

-- ── Password reset tokens ───────────────────────────────────────────────────
-- Only the SHA-256 of each token is stored, so a dump of this table cannot be
-- used to reset anyone's password.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
  ON password_reset_tokens (user_id);

-- Supports the expiry sweep in scripts/prune-reset-tokens.ts.
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx
  ON password_reset_tokens (expires_at);

-- ── Measured analysis ───────────────────────────────────────────────────────

ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS summary         text,
  ADD COLUMN IF NOT EXISTS pose_metrics    jsonb,
  ADD COLUMN IF NOT EXISTS analysis_method text NOT NULL DEFAULT 'pose-measured';

-- Every analysis that predates this migration was produced by the old pipeline,
-- where scores came out of the language model with no measurement behind them.
-- Mark them so the UI can label them honestly rather than presenting invented
-- numbers as measurements.
UPDATE analyses
   SET analysis_method = 'legacy-unverified'
 WHERE pose_metrics IS NULL
   AND analysis_method = 'pose-measured';

-- The free-tier quota is now counted per calendar month.
CREATE INDEX IF NOT EXISTS analyses_user_uploaded_idx
  ON analyses (user_id, uploaded_at DESC);

-- ── Injury risk provenance ──────────────────────────────────────────────────
-- risk_percent is a measurement of time-in-position, not a predicted
-- probability of injury. These columns record what was actually observed.

ALTER TABLE injury_risks
  ADD COLUMN IF NOT EXISTS caution_percent real,
  ADD COLUMN IF NOT EXISTS observed_min    real,
  ADD COLUMN IF NOT EXISTS observed_max    real;

COMMIT;
