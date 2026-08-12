-- Migration 0003 — session revocation cutoff
--
-- Additive and idempotent: one nullable column, no default, no row rewrite,
-- no lock beyond the brief ACCESS EXCLUSIVE that ADD COLUMN takes. Safe to run
-- against production and safe to run twice.
--
-- ── What this fixes ─────────────────────────────────────────────────────────
-- JWTs cannot be recalled once signed. Ours live for 7 days, so before this
-- column a password reset had no effect on sessions that already existed: a
-- user who suspected their account was compromised, and did exactly what they
-- are told to do, left the attacker signed in for up to a week.
--
-- `sessions_valid_after` is the cutoff. A token whose `iat` is at or before it
-- is refused regardless of signature validity. NULL means "no cutoff set" —
-- the normal state for an account that has never reset a password.
--
-- Deliberately NOT backfilled with now(): that would sign out every existing
-- user on deploy for no security benefit. Only a real credential change should
-- invalidate sessions.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz;

COMMENT ON COLUMN users.sessions_valid_after IS
  'JWTs issued at or before this instant are rejected. Set on password reset.';

COMMIT;
