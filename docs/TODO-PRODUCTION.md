# AthleteAI — Path to a Functional, Shippable App

**Owner:** Tyson · **Last updated:** 2026-08-11

What stands between the current codebase and an app real athletes can use and
pay for. Ordered by what blocks what — not by effort.

Status key: 🔴 blocks launch · 🟠 blocks charging money · 🟡 quality/scale · ⚪️ open question

---

## 0. The honest summary

The app **measures and scores correctly today**. Pose tracking, the scoring
engine, auth, the paywall logic, and account deletion all work and are tested
(291 tests green).

What it cannot do today: **generate coaching write-ups or chat** (no API key),
**complete a password reset** (no mail provider), **take money** (no billing),
or **run anywhere but your laptop** (never deployed). Those four are the gap
between "works" and "product".

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
`lib/mailer.ts` exists and the reset flow is fully built and tested, but nothing
delivers. **Password reset cannot complete end to end**, and the account-lockout
email never arrives. Any user who forgets their password is permanently locked
out with no self-service path.

Wire Resend/Postmark/SES, set the sender domain, verify SPF/DKIM.

### 1.4 Rotate the Neon database password ⚪️
Started, not finished — see the conversation of 2026-08-10. `JWT_SECRET` was
rotated; the DB password was not, because it needs a Neon console login.

Neon console → Roles → `neondb_owner` → Reset password → update `DATABASE_URL`
everywhere it is set (local `.env` **and** the deployed host once 1.1 is done).

### 1.5 App Store / Play Store prerequisites
- ✅ **Account deletion in-app** — done (`DELETE /profile/account`).
- 🔴 **Privacy policy URL** — required by both stores. Must state that video is
  processed on-device, that joint angles leave the device, and that clips do not.
- 🔴 **Data safety / privacy nutrition labels** — must match what the app
  actually collects.
- 🔴 **Camera and photo-library usage strings** in `app.json` — must explain
  *why*, not just *that*. Generic strings get rejected.
- 🟠 **Health-adjacent review risk.** The app shows injury-risk readings. Keep
  the existing "measurement, not a medical assessment" framing visible in the
  UI — reviewers look for implied diagnosis. See §5.

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
`TIER_LIMITS.elite.proComparisons` is `true`, but the comparison feature does
not exist — the design deck explicitly excludes that screen because it isn't
built. **Selling Elite today sells a feature that doesn't ship.** Either build
it or drop the tier before billing goes live.

---

## 3. 🟡 Quality and scale

| Item | Why it matters |
|---|---|
| **Mobile screen tests** | Only `utils/` is covered (20 tests). No screen has a test — needs jest-expo + native-module mocks. |
| **Redis** | Rate limits are per-instance until `REDIS_URL` is set. Fine for one instance; **required before scaling to two**, or limits silently weaken. |
| **Run migration 0002** | The read-path indexes are written but must be applied to the live DB. |
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

### 5.2 Neon vs Supabase
You referred to the database as Supabase; it is Neon. If a move to Supabase is
actually on the table, note that Supabase would want to own auth — and this app
has hand-rolled auth with lockout, progressive delay, timing mitigation, and
hash migration that is currently ahead of what a default Supabase setup gives
you. Migrating means either giving that up or running both. Worth a real
conversation before committing.

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
pnpm --filter @workspace/api-server test        # 271
pnpm --filter @workspace/lense-mobile typecheck
pnpm --filter @workspace/lense-mobile test      # 20

# Is the deployment healthy and fully featured?
curl https://<host>/api/health/metrics
```
