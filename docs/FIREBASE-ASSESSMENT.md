# Should AthleteAI move to Firebase?

**Asked:** 12 August 2026 · **Short answer: no — not wholesale.**

You'd be trading a working, unusually well-hardened backend for a rewrite that
solves one real problem you have and creates several you don't. There is a
narrower version of the idea that is worth considering, and one Firebase product
you should adopt regardless.

Prices below are from memory and move; check current pricing before deciding
anything on cost.

---

## What you have today

| Concern | Today |
|---|---|
| Database | Supabase Postgres + Drizzle, relational schema, 4 migrations |
| Auth | Hand-rolled: bcrypt cost 12, lockout, progressive delay, non-enumeration, timing equalisation, legacy-hash migration, session revocation |
| API | Express, repositories/services layering, 295 tests |
| Hosting | Railway (configured, not yet deployed) |
| Email | Resend/Postmark/SES — code complete, not configured |
| Billing | RevenueCat — 501 by design until wired |
| Video | On-device only. Never uploaded. |

---

## What migrating would actually cost

### 1. The auth you'd give up is better than the default you'd get

This is the crux. Your auth is not average hand-rolled auth — it has controls
most production apps lack:

- Account lockout after 5 failures, with an out-of-band email notification
- Progressive delay that doubles per failure
- Byte-identical responses across "no such user", "wrong password", and "locked"
- Timing equalisation via a real bcrypt comparison on the no-user path
- Transparent legacy-hash migration (md5/sha1/sha256/plaintext → bcrypt)
- Session revocation on password reset
- 295 tests, many of which exist specifically to pin these properties

Firebase Auth gives you managed password reset, verified email delivery, and
providers (Google/Apple sign-in) essentially free. It also gives you email
enumeration protection — but you have to turn it on, and its behaviour is not
identical to what you built. The lockout policy, the progressive delay, and the
timing equalisation are **not** things you configure; they are Firebase's, and
they are not the same as yours.

You would be handing over control of the layer you have invested most in.

### 2. Firestore is the wrong shape for this data

Your schema is relational and your queries are relational:

- monthly analysis counts per user (quota enforcement)
- progress series over time
- analyses joined to tips and risk findings
- entitlement resolution across users → subscriptions

Firestore can do all of this, but you would denormalise, maintain counters by
hand, and give up transactional joins. The read-path indexes in migration 0002
exist because you profiled these queries. That work doesn't port.

Roughly: rewrite every repository, every service that queries, and every test
that touches the database. Weeks, not days — and the app is not better at the
end of it.

### 3. You'd rewrite the API layer too

Express-on-Railway → Cloud Functions is a different execution model: cold
starts, a different local dev story, and per-invocation billing. Your rate
limiter is in-process with a Redis path; on Cloud Functions you'd need the Redis
path always, or Firebase's own controls.

### 4. Vendor lock-in asymmetry

Postgres is portable — Supabase, Neon, RDS, or your own box, with the same SQL.
(The August 2026 move from Neon to Supabase proved the point: it was a
connection-string change, not a migration.)
Firestore is not. Leaving later means the same migration again, backwards.

---

## What Firebase would genuinely fix

Being fair to the idea — three real wins:

1. **Password reset email.** This is your actual blocker (§1.3), and Firebase
   Auth would close it without you configuring a mail provider or publishing
   SPF/DKIM records.
2. ~~**Social sign-in.**~~ **Closed 2026-08-31 without Firebase.** Apple and
   Google sign-in are built directly against the providers' published keys —
   see `docs/FEDERATED-SIGN-IN.md`. This assessment assumed the choice was
   "adopt Firebase Auth or go without", and that framing was wrong: verifying a
   provider's identity token is a JWKS fetch and a signature check, so it needed
   no new backend and no new dependency. The server still issues its own JWT and
   every control below still applies. Firebase Auth would have replaced them.
3. **Crashlytics.** You have no crash reporting at all. You will not know when
   the app breaks in the field.

Note that win #1 is one hour of work with Resend — the code is already written
and the setup guide is in `docs/EMAIL-SETUP.md`. Migrating a backend to avoid
publishing three DNS records is not a good trade.

---

## Recommendation

### Adopt now: Firebase Crashlytics (or Sentry)

Genuinely missing, cheap, and independent of everything else. Crashlytics is
free and the Expo integration is straightforward. Sentry is the alternative and
covers the API server too, which Crashlytics does not — **if you only add one
thing, Sentry is the better single choice** because it gives you both sides.

### Do not adopt: Firestore, Cloud Functions

Wrong shape, large rewrite, no benefit to the user.

### Do not adopt: Firebase Auth — resolved 2026-08-31

This entry said "only worth it if you want Google/Apple sign-in". Those are now
built without it (`docs/FEDERATED-SIGN-IN.md`), which removes the only reason
that was on the table. The remaining pitch would be the password-reset email,
and that is an hour with Resend against a migration that would replace the
lockout, progressive delay, timing equalisation, session revocation and hash
migration described in `docs/SECURITY.md`.

The original caution still stands as a method, and it is the reason this ended
where it did: the honest question was never "is Firebase good", it was "are
Firebase's protections equivalent to the ones already here" — answered by
reading their docs against `docs/SECURITY.md`, not by assuming managed means
stronger.

If you go this way, it is a **standalone project**, not a side effect of a
database migration: Firebase Auth issues its own tokens, so `authenticate` and
every session-revocation path change, and you would need to migrate existing
password hashes (Firebase supports importing bcrypt hashes, which makes this
possible — but it is still a careful, one-shot operation).

---

## Do you need any other providers?

Here is the full picture of what a launched AthleteAI needs.

### Already chosen and wired

| Need | Provider | State |
|---|---|---|
| Database | Supabase | Migrating from Neon — see SUPABASE-MIGRATION.md |
| API hosting | Railway | Configured, never deployed |
| AI | Anthropic | Key needed |
| Email | Resend/Postmark/SES | Code done, needs a key + DNS |
| Billing | RevenueCat | 501 until configured |

### Genuinely missing

| Need | Why it matters | Suggestion |
|---|---|---|
| **Crash + error reporting** | You will not know when the app crashes. Today there is nothing. | **Sentry** — covers app and API |
| **Uptime monitoring** | `/api/health/metrics` exists and nothing polls it | Better Uptime, Cronitor, or UptimeRobot |
| **Analytics** | You cannot tell whether anyone completes a second analysis | PostHog (self-hostable, good privacy story) |

### Probably needed soon

| Need | Trigger | Suggestion |
|---|---|---|
| **Redis** | The moment you run two API instances — rate limits silently weaken otherwise | Upstash, or Railway's Redis |
| **Object storage** | If clips should survive reinstall. **Think hard:** today video never leaves the device, which is your strongest privacy claim and a large part of the store and BIPA story. Uploading footage changes your privacy policy, your data-safety labels, and your legal exposure. | Cloudflare R2, only if the feature is worth that |

### Not needed

- **CDN** — the API serves JSON; the app ships through the stores
- **Payment processor** — Apple and Google handle it; taking cards directly
  means PCI DSS, which you do not want
- **Auth provider** — not needed. Apple and Google sign-in are verified in
  process against the providers' own keys; see `docs/FEDERATED-SIGN-IN.md`
- **Search** — nothing to search

---

## If you want one sentence

Fix email with Resend (an hour), add Sentry (an hour), deploy to Railway — and
do not migrate to Firebase Auth at all. The one thing it was being held in
reserve for, Google and Apple sign-in, shipped on 2026-08-31 without it.
