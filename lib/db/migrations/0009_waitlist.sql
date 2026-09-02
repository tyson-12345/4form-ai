-- The landing page's waitlist.
--
-- The page at `/` asks for an email and says one email will arrive when the
-- TestFlight build opens. Until this table existed there was nowhere for that
-- address to go, and a form that thanks you for joining a list that does not
-- exist is a lie told at scale — the same reason the legal documents refuse to
-- serve themselves while they still have blanks in them.
--
-- ── Shape ───────────────────────────────────────────────────────────────────
-- Three columns, and deliberately no more. No IP, no user agent, no referrer,
-- no A/B bucket: none of it is needed to send one email, and every column here
-- is a column that has to be disclosed, defended and deleted on request. The
-- privacy policy's collection table gains exactly one row for this.
--
-- `email` is UNIQUE so a second submission is a no-op rather than a duplicate
-- send. The value stored is always `normalizeEmail()`'s output (trimmed,
-- lowercased, invisible characters stripped) — the same normalisation `users`
-- uses, so the two tables can be compared without a functional index. Postgres
-- has no case-insensitive text type here (`citext` is not installed and this is
-- not the table to introduce it on), so the invariant is the application's:
-- everything that writes or reads this column goes through `safeEmail`.
--
-- ── Not a user ──────────────────────────────────────────────────────────────
-- No `user_id` and no foreign key. Someone on the waitlist has no account yet,
-- and joining the waitlist must never create one. If they later sign up, the
-- two rows are related only by the address, and that is enough: the waitlist's
-- whole job is one announcement, after which it can be dropped.
--
-- Additive and idempotent. Safe to run twice, and safe to run against
-- production while the previous build is still serving traffic.
--
-- Apply to an existing database with:
--   psql "$DATABASE_URL" -f lib/db/migrations/0009_waitlist.sql

BEGIN;

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A unique index rather than a table constraint, so `ON CONFLICT (email)` in
-- the repository has something named to conflict against and re-running this
-- file cannot fail on an existing constraint.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signups_email_key
  ON waitlist_signups (email);

-- The only query anyone will run against this table is "everyone, oldest
-- first", when the build opens.
CREATE INDEX IF NOT EXISTS waitlist_signups_created_at_idx
  ON waitlist_signups (created_at);

COMMIT;
