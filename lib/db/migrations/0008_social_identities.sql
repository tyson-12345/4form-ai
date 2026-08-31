-- Migration 0008 — federated sign-in identities (Apple, Google)
--
-- Additive and idempotent. Two changes, both safe to run twice and safe to run
-- against production while the old code is still serving traffic.
--
-- ── 1. A new `identities` table ─────────────────────────────────────────────
-- A provider identity is keyed on (provider, subject), never on email. Apple
-- returns the user's email only on the *first* authorization for an app and
-- omits it on every sign-in after that, so an email-keyed table would fail to
-- recognise a returning user. `subject` (the token's `sub`) is stable forever
-- and is the only join key that actually holds.
--
-- Note `subject` is stable *per developer team*, not globally — the same person
-- signing into a different vendor's app gets a different `sub`. That is Apple's
-- design and it is why this column is meaningless outside our own account
-- namespace, hence the composite unique rather than a global one.
--
-- ── 2. `users.password_hash` becomes nullable ───────────────────────────────
-- An account created through Apple or Google has no password and must not be
-- given a fabricated one. The alternative people reach for — storing a random
-- unguessable hash — is worse: it makes a social-only account indistinguishable
-- from a password account in the database, so nothing can tell you how an
-- account is actually reachable, and the row lies to anyone auditing it.
--
-- NULL here is read by the login route as "no password set". It does not need a
-- special branch: the existing code substitutes the dummy bcrypt hash when the
-- stored hash is absent, so a password login against a social-only account
-- costs the same time and returns the same INVALID_CREDENTIALS string as any
-- other failure. Social-only accounts are therefore not enumerable by trying to
-- sign into them with a password.

BEGIN;

CREATE TABLE IF NOT EXISTS identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  subject text NOT NULL,
  -- The email the provider asserted at link time, kept for support and for
  -- noticing drift. It is NOT a lookup key and must never be used as one:
  -- Apple's Private Relay address differs from the user's real address, and a
  -- user can turn relay off later, changing this value for the same `subject`.
  provider_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- One provider account links to exactly one user. Without this, two users could
-- both claim the same Apple ID and sign-in would be ambiguous — resolved
-- silently and differently depending on row order.
CREATE UNIQUE INDEX IF NOT EXISTS identities_provider_subject_key
  ON identities (provider, subject);

-- One identity per provider per user: a user may link both Apple and Google,
-- but linking a second Apple ID to the same account would leave two credentials
-- that cannot be told apart when revoking one.
CREATE UNIQUE INDEX IF NOT EXISTS identities_user_provider_key
  ON identities (user_id, provider);

CREATE INDEX IF NOT EXISTS identities_user_id_idx ON identities (user_id);

COMMENT ON TABLE identities IS
  'Federated sign-in identities. Keyed on (provider, subject); provider_email is descriptive only and is never a lookup key.';

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

COMMENT ON COLUMN users.password_hash IS
  'NULL for accounts that sign in only through a federated provider. Such an account has no password; a password login against it fails on the standard dummy-hash path.';

COMMIT;
