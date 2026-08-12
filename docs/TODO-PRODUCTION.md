# AthleteAI — Path to a Functional, Shippable App

**Owner:** Tyson · **Last updated:** 2026-08-12

What stands between the current codebase and an app real athletes can use and
pay for. Ordered by what blocks what — not by effort.

Status key: 🔴 blocks launch · 🟠 blocks charging money · 🟡 quality/scale · ⚪️ open question

---

## 0. The honest summary

The app **measures and scores correctly today**. Pose tracking, the scoring
engine, auth, the paywall logic, and account deletion all work and are tested
(315 tests green — 295 API, 20 mobile).

What it cannot do today: **generate coaching write-ups or chat** (no API key),
**complete a password reset** (mail provider code is done but unconfigured),
**take money** (no billing), or **run anywhere but your laptop** (never
deployed). Those four are the gap between "works" and "product".

**Everything still blocking launch now needs an account you have to log into** —
an Anthropic key, a mail provider, a Railway deploy, a Supabase project, two
store consoles, and a lawyer. There is no remaining code-side blocker.

---

## 1. 🔴 Blocks launch

### 1.1 Deploy the API somewhere
`Dockerfile` and `railway.json` exist and the image builds, but nothing has ever
been deployed. Until this happens the mobile app can only talk to your laptop.

- Pick a host (Railway is pre-configured; Fly/Render equivalent).
- Set env: `DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `TRUST_PROXY=1`.
- **`TRUST_PROXY` is not optional behind a load balancer** — without it every
  request looks like it comes from the proxy and rate limits apply globally
  instead of per-user. `app.ts` warns at boot if it's unset in production.
- Point `EXPO_PUBLIC_API_URL` at the deployed origin.

### 1.2 Set `ANTHROPIC_API_KEY`
Currently empty in `artifacts/api-server/.env`. Consequence: every analysis
completes with measurements and scores but **no written coaching and no chat**.
The app degrades gracefully rather than failing — but a coaching app with no
coaching text is not the product.

`GET /api/health/metrics` reports `features.coachingWriteups: false` so you can
confirm this from outside.

### 1.3 Configure a mail provider
**Code complete as of 2026-08-12 — needs an account and DNS records.**

`lib/mailer.ts` now supports **Resend, Postmark, and SES**, selected by which
credentials are present, with HTML + plain-text templates, a 10s timeout,
delivery-failure alerting, and a startup warning for a half-configured setup.
`/api/health/metrics` reports `transactionalEmail` and `emailProvider`.

What remains needs a login: create an account with one provider, publish the
SPF/DKIM/DMARC records, set `MAIL_FROM` + the key. Step-by-step, with the exact
DNS records and a verification procedure: **`docs/EMAIL-SETUP.md`**.

Until that is done, password reset still cannot complete end to end.

### 1.4 Move the database to Supabase 🔴
**Decided 2026-08-12: Supabase as the Postgres host only. Auth stays as it is.**
**Starting fresh — no data migration.**

Code side is done: `lib/db/src/index.ts` is provider-agnostic with explicit TLS
handling and a bounded pool. What remains needs a Supabase login — create the
project, take the **session pooler** connection string, `drizzle-kit push`, then
apply `0002_read_path_indexes.sql` by hand.

Step by step, including the traps: **`docs/SUPABASE-MIGRATION.md`**.

> ⚠️ **Do not run `0001`–`0004` against the fresh Supabase database.** They are
> incremental and start with `ALTER TABLE users`, which does not exist yet. On a
> new database, `schema/index.ts` is the source of truth and already includes
> everything those files add.

**This supersedes the old "rotate the Neon password" item.** That password was
never rotated (see the conversation of 2026-08-10 — `JWT_SECRET` was, the DB
password wasn't). Deleting the Neon project after the cutover closes it
outright, which is better than rotating a credential on a database you are about
to abandon.

### 1.5 App Store / Play Store prerequisites
**Mostly done 2026-08-12. Full detail in `docs/STORE-COMPLIANCE.md`.**

- ✅ **Account deletion in-app** — `DELETE /profile/account`, password-confirmed.
- ✅ **Privacy policy written** — `docs/PRIVACY-POLICY.md`, verified against what
  the code actually collects. 🔴 **Still needs hosting at a public URL.**
- ✅ **Data safety / nutrition label answers worked out** — `STORE-COMPLIANCE.md`
  §2 and §3, field by field. 🔴 **Still needs entering in both consoles.**
- ✅ **Usage strings fixed.** The app requested **five permissions it never
  used** — camera, microphone, photo-library-write, legacy storage, and an
  unused `expo-location` dependency. All removed; the remaining photo-library
  string explains why and states that video never leaves the device.
- ✅ **Health-adjacent framing** — disclaimers on the analysis and skeleton
  screens plus a new one at signup; a marketing-language table is in
  `STORE-COMPLIANCE.md` §4.
- ✅ **Age gate** — signup now collects a date of birth and refuses under-13s,
  enforced server-side (migration `0004_age_gate.sql`).

### 1.6 Legal
**Reviewed 2026-08-12 — see `docs/LEGAL-RISK.md` for the full register.**

- ✅ **Terms of Service drafted** — `docs/TERMS-OF-SERVICE.md`, with the medical
  disclaimer, assumption of risk, liability cap, and store-billing terms.
  🔴 **Needs a lawyer** for §7, §8, §14 — the arbitration clause must be removed
  for EU/UK consumers.
- ✅ **Right-of-publicity exposure closed.** The Compare screen shipped **six
  real, named professional athletes** with fabricated similarity percentages,
  inside a paid tier. That was a NIL and false-endorsement claim waiting to
  happen. Replaced with unnamed reference technique models.
- ✅ **Terms + Privacy now linked at signup** and in Profile, so the agreement is
  presented at account creation rather than buried.
- 🔴 **Sign DPAs** with hosting, database, Anthropic, and the mail provider.

### 1.7 Analysis readability
✅ Done 2026-08-12. The coaching prompt no longer asks the model to cite joint
angles; it reasons from the measurements and writes plain instructions, with the
highest-priority fix first. Flag stamps read `OFTEN` / `SOMETIMES` / `BRIEFLY`
rather than `62–104°`. The skeleton overlay keeps the exact figures.

---

## 2. 🟠 Blocks charging money

### 2.1 Wire RevenueCat receipt validation
`POST /api/subscriptions/verify-purchase` returns **501 by design** until
billing is configured. This is deliberate: the alternative (granting a tier on
an unverified client claim) is the revenue hole that was closed during the
backend consolidation. Do not "temporarily" re-open it.

- Set `REVENUECAT_API_KEY` and `REVENUECAT_WEBHOOK_SECRET` → `billingEnabled()`
  flips true and the client renders a real purchase button.
- Implement the receipt check in `routes/subscriptions.ts` and set the tier from
  the **verified product id**, never from the request body.
- Add the webhook endpoint for renewals, cancellations, refunds, and expiry.

### 2.2 Create the store products
`com.athleteai.pro.monthly` ($9.99) and `com.athleteai.elite.monthly` ($24.99)
in App Store Connect and Play Console, matching `PLANS` in
`services/entitlementService.ts`.

### 2.3 Elite tier has nothing behind it
✅ **Resolved 2026-08-12 by withdrawing it from sale.**

The audit found Elite advertising four unbuilt features at $24.99/month, and Pro
advertising "priority processing" that no code path reads. All removed. Elite
carries `available: false` and is rendered as an inert "in development" card
with no price. `isPurchasableTier()` exists so the receipt path can refuse a
withdrawn tier once billing ships — a store product can outlive the decision to
sell it. Four tests pin the invariant.

To re-enable: build the comparison feature, then set `available: true`. Not
before.

---

## 3. 🟡 Quality and scale

| Item | Why it matters |
|---|---|
| **Mobile screen tests** | Only `utils/` is covered (20 tests). No screen has a test — needs jest-expo + native-module mocks. |
| **Redis** | Rate limits are per-instance until `REDIS_URL` is set. Fine for one instance; **required before scaling to two**, or limits silently weaken. |
| **Run migrations 0002, 0003, 0004** | Read-path indexes, session revocation, and the age-gate column are written but must be applied to the live DB. **0004 is required** — signup fails without `users.birth_date`. |
| **Sentry** | No crash or error reporting on either side. See `docs/FIREBASE-ASSESSMENT.md`. |
| **Prune expired reset tokens** | No scheduled job — the table grows forever. |
| **`/health/metrics` monitoring** | Endpoint exists; nothing polls it. Point an uptime check at it. |
| **Sentry / crash reporting** | None. You will not know when the app crashes in the field. |
| **Object storage for clips** | Videos are device-local. Users lose their footage on reinstall or device change. |

---

## 4. 🎨 Design — Instrument rollout

The Instrument direction (21 screens) is **partially implemented**. The design
system, shared ruler, and the two core measurement screens are done; the rest
still run the previous Caliper layouts, which share the same palette, type, and
rules, so nothing looks broken — it is just less refined.

**Done**
- `MetricBand` upgraded to full spec — previous-session reference mark, 4-point
  numeric axis, 25 ticks, corrected geometry, optional band caption
- `ReferenceRow` — YOUR BAND / PREVIOUS / BEST
- `metricHeroXL` (82pt) and `stampDay()`
- **Home** — hero restructured: provenance line, XL index, ruler, reference row
- **Analysis** — ruler with band caption, frame provenance
- **App icon** — the "A, measured across" mark, generated from
  `scripts/generate-icons.py` (the script is the source of truth; the PNGs are
  committed build output). iOS, Android adaptive, splash, favicon, store and
  tinted variants. Replaced a placeholder orange square on the landing page.
- **`AppMark`** component for in-app use — same geometry, no bitmap.

**Icon follow-ups**
- 🟡 **Apple touch icon** for the landing page (`apple-touch-icon.png`, 180×180)
  — iOS home-screen bookmarks currently fall back to a screenshot.
- 🟡 **`icon-store.png` / `icon-tinted.png` are generated but unwired** — the
  store variant goes in App Store Connect by hand; the tinted variant needs an
  iOS 18 `.icon` asset catalog, which Expo does not yet configure from
  `app.json`.
- ⚪️ **Dead file:** `constants/colors.ts` (Volt-era) is no longer imported by
  anything — `hooks/useColors.ts` is a shim onto Caliper tokens. Both can go
  once the 5 screens still using `useColors()` (compare, +not-found, measure,
  skeleton, ErrorFallback) import `@/constants/caliper` directly.

**Remaining** (each still functional, just not yet reworked)

| Priority | Screens |
|---|---|
| High | Progress · Sessions · Skeleton overlay |
| Medium | Coach (2 states) · Profile · Plans |
| Low | Onboarding (3) · Auth (3) · Landing · Measuring · New-session sheet · empty and error states |

---

## 5. ⚪️ Open product questions

### 5.1 The scoring disagreement with Oscar
Unresolved. Four questions in `docs/BACKEND-COMPARISON.md` §7 are still open,
the substantive one being **power and speed**. Today they are `null`
("not measured") because they are not derivable from 2D pose. Oscar's fork fills
them with LLM-generated numbers.

Proposed compromise (not yet agreed, not yet built): keep the measured engine
for the four measurable dimensions, adopt Oscar's sport-specific weighting, and
replace the two nulls with a clearly-labelled qualitative read rather than a
fabricated number. **This needs Oscar's answer before anyone builds it.**

### 5.1b Firebase
Assessed 2026-08-12 — **recommendation: don't migrate.** Firestore is the wrong
shape for these relational queries, and Firebase Auth's defaults are not
obviously better than the auth already built here. Adopt Sentry for crash
reporting; revisit Firebase Auth only if you want Google/Apple sign-in. Full
reasoning, plus what providers are actually still missing:
`docs/FIREBASE-ASSESSMENT.md`.

### 5.2 Neon vs Supabase — ✅ resolved 2026-08-12
Moving to **Supabase, as the Postgres host only.** Auth stays as it is.

This splits the decision the old entry warned about. Supabase *is* Postgres, so
hosting there is a connection-string change — but adopting **Supabase Auth**
would replace the lockout, progressive delay, timing equalisation, session
revocation, and hash migration this codebase has invested most in. Those are two
separate decisions and only the first is being made now.

Execution: `docs/SUPABASE-MIGRATION.md`. Auth reassessment, if it ever happens,
should follow the method in `docs/FIREBASE-ASSESSMENT.md` — compare against
`docs/SECURITY.md` rather than assuming managed means stronger.

### 5.3 Band requires 3 sessions
A new user sees no band until their third measured clip, so the core idea of the
product ("your number against your range") is invisible for the first two
sessions. Deliberate — two readings do not make a range — but it is the weakest
part of the first-run experience. Consider a provisional band with an explicit
"provisional" mark.

---

## 6. Quick reference

```bash
# Verify everything
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server lint
pnpm --filter @workspace/api-server test        # 295
pnpm --filter @workspace/lense-mobile typecheck
pnpm --filter @workspace/lense-mobile test      # 20

# Is the deployment healthy and fully featured?
curl https://<host>/api/health/metrics
```
