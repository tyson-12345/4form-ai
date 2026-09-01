# Handoff — state as of 15 August 2026

Written so a session with no prior context can pick up and be useful in one read.

> ✅ **Deployed (late 2026-08-15).** Migrations 0005 + 0006 are applied to
> Supabase and the API redeployed twice — production runs the quota-integrity,
> rep-detection, prose, and audit-closeout changes. Verified live end to end
> with a throwaway account (walkthrough-prod-1@example.com, free tier): signup
> → 148/150-frame measurement → deterministic scores → real coaching write-up
> with drills. The cousin's 25-finding defect audit is fully reconciled: all
> fixed except 07 (unweighted overall — documented open decision) and the
> Caliper-migration polish tier (14–17, 21), tracked as item 20 below.
>
> The mobile changes are JS-only except app.json's photo-library usage
> strings (native rebuild needed before store submission).

---

## Where everything is

| Thing | Value |
|---|---|
| Repo | `/Users/tysonyoum/ACTIVE/ai-exercise-coach/AthleteAI_tyson` — local dir still carries the old name |
| Branch | `main` — single branch, keep it that way |
| GitHub | `tyson-12345/4form-ai` (public) |
| Live API | `https://fourformai-production-0b7f.up.railway.app` |
| Database | Supabase, `ca-central-1`, session pooler |
| Railway | project `athleteai` / `ad6fbf98-1a01-4366-9d04-153fa8705cbb`, service `fourformai` |
| Simulator | iPhone 17 Pro, UDID `27BBE9C0-B829-491B-B135-01C7FFCD18ED` |

**Verify commands** (all should pass):

```bash
pnpm --filter @workspace/api-server test        # 367
pnpm --filter @workspace/fourform-mobile test      # 76
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/fourform-mobile typecheck
pnpm --filter @workspace/api-server lint        # 0 errors, 11 known warnings
pnpm --filter @workspace/scripts run verify-database
curl -s https://fourformai-production-0b7f.up.railway.app/api/health/metrics | jq .features
```

**Local full stack (2026-08-15):** Homebrew Postgres 17 with database
`athleteai_dev` — **still the old name**; the 2026-09-01 rename did not touch
local databases. `artifacts/api-server/.env.local` points at it (port 3001,
throwaway JWT secret, `ALLOW_DEV_TIER_OVERRIDE=true` so
`POST /api/subscriptions/dev-set-tier` works). Run with
`node --env-file=.env.local ./dist/index.mjs` after `pnpm run build`. The
mobile `.env` keeps the localhost alternative as a comment. Local test data
(walkthrough-1@example.com) lives only in that local database.

To bring the local name in line with the rename (optional — nothing depends on
it), stop the API server, then:

```bash
psql -d postgres -c 'ALTER DATABASE athleteai_dev RENAME TO fourformai_dev'
```

and update `DATABASE_URL` in `artifacts/api-server/.env.local` to match.

---

## Getting the app on the simulator

The native project (`ios/`) is already generated and pods are installed. It is
gitignored (~1.8GB) so it exists only on this machine.

```bash
# 1. Boot the simulator
xcrun simctl boot 27BBE9C0-B829-491B-B135-01C7FFCD18ED

# 2. Start Metro (leave running)
cd /Users/tysonyoum/ACTIVE/ai-exercise-coach/AthleteAI_tyson/artifacts/fourform-mobile
pnpm exec expo start --port 8081

# 3. Install + launch the already-built app
xcrun simctl install 27BBE9C0-B829-491B-B135-01C7FFCD18ED \
  ios/build/Build/Products/Debug-iphonesimulator/4FormAI.app
xcrun simctl launch 27BBE9C0-B829-491B-B135-01C7FFCD18ED com.fourformai.app
```

If the app was changed natively (a new native module, an `app.json` change),
rebuild — **30–45 min cold, faster incremental**:

```bash
cd artifacts/fourform-mobile/ios
xcodebuild -workspace 4FormAI.xcworkspace -scheme 4FormAI \
  -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=27BBE9C0-B829-491B-B135-01C7FFCD18ED' \
  -derivedDataPath ./build build
```

JS-only changes need no rebuild — Metro reloads them. **`.env` changes are not
JS changes** — they need a Metro restart. See trap 5.

`.env` currently points at the live Railway API, so the simulator talks to
production Supabase data. Switch it back to a local server when doing backend
work; the previous local value is kept as a comment in that file.

### Five traps already paid for. Do not rediscover these.

1. **The repo path must not contain spaces.** `expo-constants` ships a build
   phase that double-expands `$PODS_TARGET_SRCROOT` through two shells; a space
   tears the path apart and the build dies with a misleading
   `No such file or directory`. The folder was renamed from `ai exercise coach`
   to `ai-exercise-coach` for this. Upstream quoting bug — not fixable here.

2. **Use `expo install`, never `pnpm add`, for anything with native code.**
   `pnpm add expo-secure-store` installed 57.x when SDK 54 needs `~15.0.8`. The
   native module was absent, `lib/api.ts` failed at import, and **every
   API-touching screen was dead** — while typecheck and all tests passed.
   `pnpm exec expo install --fix` reconciles versions.

3. **A red-screen error after a dependency change is usually a stale Metro
   cache.** A `LinkPreviewContext must be used within a Provider` error cost
   hours chasing duplicate `expo-router` instances in the pnpm store. The
   duplicates were real but never bundled — Metro resolved one the whole time.
   `pnpm exec expo start --clear` was the fix. **Clear the cache before
   theorising about the dependency tree.**

4. **Never wait on a build with `until ! pgrep -f xcodebuild`.** `pgrep -f`
   matches full command lines, so it matches the waiter itself and never exits.
   Watch the **log file's growth and its result line** instead.

5. **"Can't reach the server" on login is almost always `.env`, not the app.**
   `artifacts/fourform-mobile/.env` sets `EXPO_PUBLIC_API_URL`. It was left pointing
   at a local dev server (`http://192.168.1.157:3001`) with nothing listening, so
   every auth call died with `ECONNREFUSED (61)` → `NSURLErrorDomain -1004`. The
   app was fine; it was aimed at a backend that did not exist.
   - Confirm from the simulator, not from the code:
     `xcrun simctl spawn <UDID> log show --last 3m --predicate 'processImagePath CONTAINS "4FormAI"' --style compact | grep -i "error\|3001"`
     — it prints the exact failing URL.
   - **`EXPO_PUBLIC_*` vars are inlined into the bundle at build time, not read
     at runtime.** Editing `.env` does nothing until Metro restarts. Restart with
     `--clear` (see trap 3) and relaunch the app.
   - To prove the change landed rather than assume it, grep the *served* bundle:
     `curl -s "http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true" | grep -c <your-host>`
     (that virtual entry path is the one the app actually requests — `/index.bundle`
     and `/node_modules/expo-router/entry.bundle` both 404).
   - Note `.env.example` documents port **3000**, but the stale `.env` used
     **3001**, and `api-server` has no default — `PORT` is required.

---

## Railway — one specific hazard

**Always pass `--project` explicitly:**

```bash
railway up --service fourformai --environment production \
  --project ad6fbf98-1a01-4366-9d04-153fa8705cbb --ci
```

Without it, an unlinked directory plus `--ci` makes `railway up` **silently
create a brand-new project**. That happened once (after the folder rename broke
the link) and created a stray project in Oscar's workspace.

> ✅ **Resolved 2026-08-13.** The stray project has been deleted.
>
> Worth knowing for next time: `railway delete --project <id-or-name> --yes`
> returned `not found` for a project that was plainly listed — its lookup does
> not appear to resolve into the shared workspace, only the personal one. The
> GraphQL mutation worked:
> `railway api 'mutation { projectDelete(id: "<id>") }'`

The CLI is authenticated as **`oac60647@gmail.com` — Oscar's account.** It is a
shared paid account. Anything done there is attributed to him and shows on his
billing. **Never modify or redeploy a service that is not `fourformai`.**

---

## What is done

- **Deployed and running** — API on Railway, Supabase database, coaching
  write-ups and chat enabled.
- **Password reset works end to end** — verified with a real inbox: request →
  token → email → link → landing page → password changed → old password dead →
  token refused on replay.
- **Security** — bcrypt 12, lockout, progressive delay, non-enumeration, timing
  equalisation, session revocation, age gate (13+), rate limits on every
  endpoint, secrets never committed. Structural invariants pinned by tests in
  `test/authorization-invariants.test.ts`.
- **Legal** — privacy policy, terms, risk register, store-compliance answers all
  drafted. Six real named athletes removed from the app (right-of-publicity).
- **Billing honesty** — Elite withdrawn (its features do not exist), unshipped
  feature claims removed, no client-assertable tier.
- **Plain-language coaching** — the prompt writes instructions rather than
  reciting joint angles; jargon translation applied on both chat and the
  analysis screen. Skeleton overlay keeps exact degrees by design.
- **Passwords** — 8 char minimum, no composition rules (NIST SP 800-63B).

Read `docs/TODO-PRODUCTION.md` for the full history and reasoning.

---

## What is left

### 🔴 Blocks launch

| # | Item | Notes |
|---|---|---|
| 1 | ~~**Buy a domain**~~ | ✅ `4formai.com` bought 2026-09-01. (The old `athleteai.app` was never ours.) |
| 2 | Verify domain in Resend, swap `MAIL_FROM` | Mail currently only reaches the Resend account owner |
| 3 | Host privacy policy + terms; set `EXPO_PUBLIC_LEGAL_BASE_URL` and `EXPO_PUBLIC_SUPPORT_EMAIL` | Both stores check these during review |
| 4 | Fill App Privacy + Data Safety forms | Answers written in `docs/STORE-COMPLIANCE.md` |

### 🟠 Blocks charging money

| # | Item |
|---|---|
| 5 | Sign DPAs — Supabase, Railway, Anthropic, Resend |
| 6 | RevenueCat — keys, receipt validation, webhook. Must call `isPurchasableTier()` before granting |
| 7 | Create store products — Pro only at $9.99 |
| 8 | Decide 13–17 parental assent |
| 9 | Lawyer on Terms §7/§8 *(deferred by choice — this is the injury-claim exposure)* |

### 🟡 Quality — the quarter-hour wins first

| # | Item | Effort |
|---|---|---|
| 10 | Create a Sentry project, set `SENTRY_DSN` — code is wired and inert without it | 15 min |
| 11 | Point an uptime check at `/api/health/metrics` | 15 min |
| 12 | Connect Railway to GitHub — deploys are CLI-only, so `main` and deployed can diverge | 15 min |
| 13 | Resend webhooks — bounces currently vanish; a hard bounce strands a user | 30 min |
| 14 | Supabase PITR before real users — free tier can lose 24h | 5 min |
| 15 | Redis — required before a second instance or rate limits multiply | 30 min |
| 16 | `ALLOWED_ORIGINS` is localhost-only — a web build would be CORS-blocked | 5 min |
| 17 | PostHog — cannot currently answer "does anyone record a second clip?" | 2h |
| 18 | Log retention — security logs age out of Railway | 30 min |
| 19 | Mobile Sentry — needs EAS dev builds; breaks Expo Go | 1h |
| 20 | Instrument redesign — Progress, Sessions, Skeleton (+ the `useColors` migration) | days |
| 21 | Delete the `oac60647@gmail.com` test account — **the sign-up half is done** (Tyson signed up fresh in-app on 2026-08-13, against the live Railway API / production Supabase). The old test account has **not** been deleted; it is still live in production. Deleting it destroys production data, so confirm the correct account before running anything | 2 min |

### 🔵 Provider upgrades — see `docs/PROVIDERS.md`

| # | Item |
|---|---|
| 22 | **Streaming chat** — best user-visible win, no cost change |
| 23 | Anthropic prompt caching — worthwhile at volume |
| 24 | Batch API for write-ups — roughly half price, analyses are already async |
| 25 | Try Haiku for chat, keep Sonnet for the write-up |

### ⚪️ Decisions

| # | Item |
|---|---|
| 26 | Which fork survives — effectively settled: this one is deployed |
| 27 | Build Elite or kill it |
| 28 | Band requires 3 sessions — the core idea is invisible for a new user's first two clips |
| 29 | Object storage for clips — Oscar's best feature, but it changes the privacy policy, both store labels, and the BIPA position |
| 30 | `docs/LEGAL-RISK.md` is on a public repo and reads as a written admission |

---

## Working agreements

- **Verify, don't assert.** Several claims in this project turned out wrong when
  checked — "Oscar's backend is deployed" (it was this one), "push doesn't create
  the 0002 indexes" (it does). Check before stating.
- **Run the thing.** Two total-app-failure bugs passed typecheck and every test.
- **Commit only when asked. Branch off `main`, keep one branch.**
- **Secrets never enter the repo or a commit message.** `.env` is gitignored and
  dockerignored; scan staged diffs before committing.
- Full reasoning for past decisions lives in `docs/` — `SECURITY.md`,
  `LEGAL-RISK.md`, `BACKEND-COMPARISON.md`, `SUPABASE-MIGRATION.md`,
  `EMAIL-SETUP.md`, `PROVIDERS.md`, `RUNNING-THE-APP.md`.
