-- Migration 0004 — date of birth, for the under-13 age gate
--
-- Additive and idempotent: one nullable column, no default, no row rewrite.
-- Safe to run against production and safe to run twice.
--
-- ── Why this column exists ──────────────────────────────────────────────────
-- COPPA applies to users under 13 and carries per-violation penalties; GDPR
-- Article 8 sets a digital-consent floor of 13–16 depending on member state. A
-- sports-technique app attracts minors whether or not it targets them, so
-- "we didn't ask" is not a defence — it is the finding.
--
-- Stored as a DATE, not a timestamp: the time of day is not information we
-- need, and collecting less of a minor's data is the whole point.
--
-- NULL means "signed up before the gate existed". Those accounts are left
-- alone rather than being locked out or force-prompted, which would punish
-- existing users for a control added after they joined. New signups cannot be
-- NULL — the server rejects a signup without a verifiable date.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birth_date date;

COMMENT ON COLUMN users.birth_date IS
  'Date of birth, collected at signup for the under-13 age gate. NULL for accounts created before migration 0004.';

COMMIT;
