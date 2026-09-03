-- Cap on how often a locked account is emailed about it.
--
-- `failed_login_attempts` is never decayed, so once an account passes the
-- threshold every subsequent failed attempt satisfies the lock condition. The
-- lockout notice was sent on each one, which meant four requests an hour kept
-- an account permanently locked out of password login *and* pointed our mail
-- provider at the victim's inbox as an amplifier — the only outbound mail path
-- in the app with no per-account ceiling.
--
-- One notice per episode is the signal; the rest is noise an attacker chose to
-- send. NULL means "never notified", so existing rows are eligible immediately.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS lockout_notified_at timestamptz;
