-- Per-session revocation, so signing out on one device does not end every session.
--
-- `users.sessions_valid_after` is a cutoff: it refuses everything issued before
-- an instant. That is exactly right for a password reset — the user is saying
-- "whoever else is in here, get out" — and much too blunt for a sign-out, where
-- the user means this device and not their other one.
--
-- Before this existed the choice was between the two bad options: sign-out was a
-- client-side no-op that left a live seven-day credential on a borrowed phone,
-- or it bumped the cutoff and signed the user out everywhere. Naming each token
-- with a `jti` and listing the revoked ones makes the precise thing possible.
--
-- Rows are pruned once the token they name has expired on its own; a revocation
-- that outlives its token is dead weight. See `pruneRevokedSessions`.
CREATE TABLE IF NOT EXISTS revoked_sessions (
  jti         text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at  timestamptz NOT NULL DEFAULT now(),
  -- When the revoked token would have expired anyway. The prune key.
  expires_at  timestamptz NOT NULL
);

-- The prune scan, and nothing else, reads by expiry.
CREATE INDEX IF NOT EXISTS revoked_sessions_expires_at_idx
  ON revoked_sessions (expires_at);

-- Deleting an account should not leave its revocations behind; the cascade above
-- handles that, and this index makes it cheap.
CREATE INDEX IF NOT EXISTS revoked_sessions_user_id_idx
  ON revoked_sessions (user_id);
