# 4Form AI — Path to a Functional, Shippable App

**Owner:** Tyson · **Last updated:** 2026-08-12

What stands between the current codebase and an app real athletes can use and
pay for. Ordered by what blocks what — not by effort.

Status key: 🔴 blocks launch · 🟠 blocks charging money · 🟡 quality/scale · ⚪️ open question

---

## 0. The honest summary

The app **measures and scores correctly today**, and as of 2026-08-12 it is
**deployed and reachable**. Pose tracking, the scoring engine, auth, the paywall
logic, account deletion, and password reset all work and are tested
(673 tests green — 483 API, 170 mobile, 20 scripts).

Live at `https://fourformai-production-0b7f.up.railway.app`, on Supabase, with
coaching write-ups and chat enabled and password reset delivering real mail.

What it still cannot do: **take money** (billing unconfigured), **send mail to
anyone but the Resend account owner** (still on the test sender), and **point
users at legal documents** (nothing hosted yet).

**The domain blocker is cleared.** `4formai.com` was bought on 2026-09-01 and
the app renamed to **4Form AI** the same day. Mail from a real sender, the
privacy-policy and terms URLs both stores check, and a support address were all
waiting on exactly that. What remains is DNS records and hosting — see §1.8 —
plus a console login or a lawyer for everything else.

---

## 1. 🔴 Blocks launch

### 1.1 Deploy the API — ✅ DONE 2026-08-12

Live at `https://fourformai-production-0b7f.up.railway.app` (Railway project
`athleteai`, service `fourformai`, in Oscar's workspace). `TRUST_PROXY=1` and
`NODE_ENV=production` are set, and `eas.json` points the production app build at
it.

Two things worth knowing about this deployment:

- **It runs from the CLI, not GitHub.** `railway up` from the repo root. Pushing
  to `main` does *not* redeploy. Connecting the repo is a 🟡 item below.
- **A `.dockerignore` was required first.** The build context was ~940MB, and
  without it `railway up` would have uploaded the local `.env` — Supabase
  password included — into the image build context.

Correction to an earlier note in this file: the Railway deployment Oscar created
on 2026-08-11 was already running **this** backend, not his fork. His
`POST /subscriptions/update` self-grant hole has never been deployed anywhere.

### 1.2 Set `ANTHROPIC_API_KEY` — ✅ DONE

Set on the Railway service. `GET /api/health/metrics` reports
`features.coachingWriteups: true`.

Shared with Oscar by agreement; the cost split is settled between them. Still
empty in the local `artifacts/api-server/.env`, so coaching write-ups and chat
are disabled when running the server locally — that is a local dev gap, not a
production one.

### 1.3 Configure a mail provider — ✅ WORKING 2026-08-12

Resend is wired and live. A real password reset was completed end to end:
request → token → email → inbox → link → landing page → password changed → old
password rejected → token refused on replay. Session revocation fired on the
reset, so any token issued beforehand died with it.

> Note: `APP_PUBLIC_URL` must be set on the server or `createResetUrl` throws by
> design. It previously defaulted to `athleteai.app`, a domain owned by someone
> else. Point it at `https://4formai.com` once that host serves the reset page.

**Still on Resend's test sender** (`onboarding@resend.dev`), which only delivers
to the Resend account owner. The domain that was blocking this now exists:
verify `mail.4formai.com` in Resend, publish its SPF/DKIM/DMARC records, then set
`MAIL_FROM="4Form AI <no-reply@mail.4formai.com>"` on the server. No code change
— `.env.example` already carries the new value. See `docs/EMAIL-SETUP.md`, which
also records the two failures this turned up and why neither was catchable by
the test suite.

Built along the way: **the reset link needed somewhere to land.** It previously
resolved to a JSON 404 — mail sent, token valid, user stuck. Universal Links
need a domain we do not have and custom schemes get stripped by mail clients,
so the API now serves a self-contained reset page (`routes/resetPage.ts`) with
its own CSP nonce and rate limit.

### 1.4 Move the database to Supabase — ✅ DONE 2026-08-12

Live on Supabase (`ca-central-1`, session pooler, PostgreSQL 17.6). Neon has
been deleted, which closes the never-rotated-password item outright.

Verified end to end, not just "the command exited zero":

- All 11 tables, every migration column (`birth_date`, `sessions_valid_after`,
  `password_algo`, the lockout fields), and 20 indexes — `0002`'s read-path
  indexes were created by `push`, so pasting that SQL turned out to be
  unnecessary.
- A real signup/login round trip against the live database: account created,
  the 9-year-old rejected by the age gate, duplicate email answered without
  enumeration, wrong password refused. The stored row carried
  `password_algo=bcrypt`, a `$2b$12$` hash, the birth date, and an incrementing
  failed-login counter. Profile and subscription rows cascaded on delete.
- Test account removed afterwards. The database holds 0 users.

`pnpm --filter @workspace/scripts run verify-database` re-checks all of this at
any time.

**TLS note for the deploy:** Supabase signs with its own CA, so a bare
connection fails with `SELF_SIGNED_CERT_IN_CHAIN`. `DATABASE_CA_CERT` must be
set — locally it points at a file; on Railway, paste the PEM into the variable.
Certificate verification stays on either way; do not "fix" this by disabling it.

<details>
<summary>Original plan (kept for the reasoning)</summary>

### Move the database to Supabase 🔴
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

</details>

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

### 1.8 Finish the 4Form AI rename outside the repo

The codebase was renamed on 2026-09-01: display brand **4Form AI**, domain
**4formai.com**, bundle id / Android package **`com.fourformai.app`**, URL scheme
**`fourformai://`**, Expo slug **`4form-ai`**, workspace package
**`@workspace/fourform-mobile`** (directory `artifacts/fourform-mobile`).

`com.4formai.app` and `4formai://` are **not** valid — an Android
`applicationId` segment and an RFC 3986 URL scheme must both begin with a
letter. Hence `fourformai`. The display name is the only place the digit form
appears.

Everything inside the repo is done. These live outside it and still carry the
old name — each needs a console login:

- 🔴 **DNS + Resend** — verify `mail.4formai.com`, publish SPF/DKIM/DMARC, set
  `MAIL_FROM` and `APP_PUBLIC_URL` on the Railway service. Unblocks §1.3.
- ✅ **Railway** — done 2026-09-01. Service renamed `athleteai` → `fourformai`,
  and the service domain renamed to `fourformai-production-0b7f.up.railway.app`.
  `eas.json`, the mobile `.env` and these docs were repointed in the same
  commit, and `APP_PUBLIC_URL` was updated on the service.

  Two things worth knowing for next time. **The service name and the domain are
  separate records** — renaming the service alone leaves the hostname untouched;
  the domain has its own id and its own `railway domain update --domain <label>`.
  And **the CLI cannot rename a service** (`railway service` has no `rename`);
  it takes the dashboard or the GraphQL mutation:

  ```bash
  railway api 'mutation { serviceUpdate(id: "<service-id>", input: { name: "fourformai" }) { id name } }'
  ```

  The old host 404s the moment the domain is renamed, so anything holding it —
  `APP_PUBLIC_URL` above all, since reset links are built from it — has to move
  in the same sitting. The Railway **project** is still named `athleteai`; it is
  cosmetic and appears in no URL.
- 🟠 **Apple Developer** — register `com.fourformai.app`, enable Sign in with
  Apple on it, and set `APPLE_CLIENT_IDS` to match. Nothing was registered
  under the old id (`eas.json` has an empty `ascAppId`), so nothing is orphaned.
- 🟠 **Google OAuth** — the client ids in `app.json` `extra.google` are still
  empty; create them against the new bundle id / package.
- 🟠 **App Store Connect / RevenueCat** — create products
  `com.fourformai.pro.monthly` and `com.fourformai.elite.monthly` (§2.2).
- ✅ **GitHub** — renamed to `tyson-12345/4form-ai` on 2026-09-01; `origin` now
  points at it. GitHub 301-redirects the old URL, so any other clone keeps
  working until its remote is updated.

  🟡 The **local checkout directory** is still `~/ACTIVE/ai-exercise-coach/AthleteAI_tyson`
  — renaming a directory out from under a running shell, Metro watcher or Xcode
  project is the kind of thing that costs an afternoon, so it was left alone.
  When nothing is running:

  ```bash
  mv ~/ACTIVE/ai-exercise-coach/AthleteAI_tyson ~/ACTIVE/ai-exercise-coach/4form-ai
  ```

  Then update the two absolute paths in `docs/HANDOFF.md`, and re-run
  `pnpm install` — a moved workspace root invalidates pnpm's symlinks. Note
  `docs/RUNNING-THE-APP.md` warns the path must contain no spaces; `4form-ai`
  is fine.
- 🟡 **App icon** — `assets/images/*.png` still render the old "A, measured
  across" mark, and `scripts/generate-icons.py` still draws it. Replacing the
  four PNGs (`icon.png`, `adaptive-icon.png`, `icon-store.png`, `icon-tinted.png`,
  plus `splash.png` and `favicon.png`) is all that is needed; nothing reads the
  script at build time.

**On deploy, every existing session is signed out.** `JWT_ISSUER` moved from
`athleteai-api` to `fourformai-api` and is checked on verify, so tokens minted
before the deploy no longer validate. Pre-launch this costs nothing; it is
listed here so it is not a surprise.

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
`com.fourformai.pro.monthly` ($9.99) and `com.fourformai.elite.monthly` ($24.99)
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
| **Connect Railway to GitHub** | Deploys are CLI-only; pushing to `main` does not redeploy. |
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

### 5.1b Firebase — ✅ resolved 2026-08-31
Assessed 2026-08-12 — **recommendation: don't migrate.** Firestore is the wrong
shape for these relational queries, and Firebase Auth's defaults are not
obviously better than the auth already built here. Adopt Sentry for crash
reporting. Full reasoning: `docs/FIREBASE-ASSESSMENT.md`.

The one open condition — "revisit Firebase Auth only if you want Google/Apple
sign-in" — is now closed. Both are built, directly against the providers'
published keys, with no new backend and no new dependency: the server still
issues its own JWT, so the lockout, progressive delay, timing equalisation and
session revocation all still apply. See `docs/FEDERATED-SIGN-IN.md`, including
the Apple Developer and Google Cloud credentials still to be created and the
App Store 4.8 constraint that Apple must ship with or before Google.

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

## 5b. Running the app locally

See **`docs/RUNNING-THE-APP.md`**.

> ⚠️ **The repository path must not contain spaces.** The iOS build fails with a
> misleading "No such file or directory" — `expo-constants` ships a build phase
> that double-expands `$PODS_TARGET_SRCROOT` through two shells, and a space
> tears the path apart. The checkout moved from `~/ai exercise coach/` to
> `~/ai-exercise-coach/` on 2026-08-12 for this reason. Nothing on our side can
> fix it; the quoting bug is upstream.

---

## 6. Quick reference

```bash
# Verify everything
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server lint
pnpm --filter @workspace/api-server test        # 326
pnpm --filter @workspace/fourform-mobile typecheck
pnpm --filter @workspace/fourform-mobile test      # 50

# Is the deployment healthy and fully featured?
curl https://fourformai-production-0b7f.up.railway.app/api/health/metrics
```
