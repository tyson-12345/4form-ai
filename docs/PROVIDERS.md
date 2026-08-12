# Providers — what we pay for, what we underuse, what's missing

**Reviewed:** 12 August 2026

Two questions: are we getting everything from what we already run, and what is
worth adding. Ordered by value per hour of work, not by feature count.

Pricing moves — verify before committing money to anything here.

---

## What we run today

| Provider | Used for | Plan |
|---|---|---|
| **Supabase** | Postgres | Free |
| **Railway** | API hosting | Shared paid (Oscar's) |
| **Anthropic** | Coaching write-ups, chat | Pay-per-token, shared |
| **Resend** | Transactional email | Free (3k/mo) |
| **RevenueCat** | Billing | Not configured |

---

## 1. Underused: things we already pay for

### Supabase — we use ~15% of it

We adopted Supabase purely as a Postgres host, which was the right call for the
migration. But several things are sitting there switched off:

| Feature | Worth it? | Why |
|---|---|---|
| **Point-in-Time Recovery** | ⚠️ **Before real users** | Free tier keeps one daily backup. A bad migration at 4pm loses everything since midnight. This is the single highest-value thing on this page once real accounts exist. |
| **Storage** | Maybe | Would cover clip storage without adding Cloudflare R2. But see §4 — uploading video changes the privacy story, and that is a product decision, not a provider one. |
| **Read replicas** | Not yet | Single instance, no read pressure. |
| **Realtime** | No | Nothing needs live subscriptions. Polling the analysis status is fine at this scale. |
| **Auth** | **No** — deliberately | Would replace lockout, progressive delay, timing equalisation, session revocation, and hash migration. See `docs/FIREBASE-ASSESSMENT.md`; the reasoning is identical. |
| **Edge Functions** | No | The API is a working Express app. Splitting logic across two runtimes buys nothing. |

**Do now:** enable PITR when you have users worth losing.

### Railway — one real gap

| Feature | Worth it? | Why |
|---|---|---|
| **GitHub integration** | ✅ **Yes, today** | Deploys are CLI-only right now. Pushing to `main` does nothing until someone runs `railway up` — so what is deployed and what is on `main` can silently diverge. |
| **Redis** | Before a second instance | Rate limits are per-process. Two instances = double the effective limit. The code already supports `REDIS_URL`. |
| **Healthcheck restart** | Already configured | `railway.json` has `/api/healthz` with `ON_FAILURE`. |
| **Cron** | Nice to have | The reset-token sweep runs in-process on a 6h timer, which is fine for one instance. A Railway cron would be more robust if the API ever scales to zero. |
| **Horizontal scaling** | Not yet | One instance handles this load comfortably. Do not scale before Redis. |

**Do now:** connect the GitHub repo so deploys follow merges.

### Anthropic — the model choice is worth revisiting

Currently `claude-sonnet-5` for both the coaching write-up and chat.

| Opportunity | Value |
|---|---|
| **Prompt caching** | The system prompt plus sport research is resent on every call. Caching the stable prefix cuts input cost substantially at volume. Worth doing once there is volume; premature now. |
| **Batch API** | Analyses are already asynchronous — the client polls. Non-urgent write-ups could go through the batch endpoint at roughly half price. Real saving, moderate complexity. |
| **Haiku for chat** | Chat is short and conversational. Trying Haiku 4.5 there and keeping Sonnet for the write-up would cut the per-message cost. Test quality before switching; the write-up is the product and should stay on the stronger model. |
| **Streaming chat** | Chat currently waits for the full response. Streaming would make it feel dramatically faster with no cost change. **Best user-visible win in this table.** |

**Do now:** nothing. **Do at volume:** prompt caching, then batch. **Do for feel:** streaming chat.

### Resend — one thing to fix, one to add

| Feature | Worth it? |
|---|---|
| **Verified domain** | 🔴 **Required.** On the test sender we can only mail the account owner. Blocks every real user. |
| **Webhooks** | ✅ Worth it. Bounces and complaints currently vanish. A hard bounce on a reset email means the user is stranded and we would never know. |
| **Broadcasts** | ❌ No. Marketing email needs consent tracking and unsubscribe handling — a different compliance surface. Not now. |

---

## 2. Missing: genuinely worth adding

| Need | Pick | Why | Effort |
|---|---|---|---|
| **Crash reporting (mobile)** | Sentry | The API half is wired and inert without a DSN. The app half needs EAS dev builds — `@sentry/react-native` is a native module and breaks Expo Go. **You will not know when the app crashes on a real phone.** | 1h + DSN |
| **Uptime monitoring** | Better Uptime / UptimeRobot | `/api/health/metrics` exists and nothing polls it. It already reports `transactionalEmail`, `coachingWriteups`, `billing`, and alert counters — a check on it catches a broken mailer before a user does. | 15 min |
| **Product analytics** | PostHog | You cannot currently answer "does anyone record a second clip?" — the single most important number for this product. Self-hostable, and its EU cloud keeps the privacy story simple. | 2h |
| **Log retention** | Railway's own, or Axiom | Railway logs are ephemeral. The security logging built here — `login_failed`, `account_locked`, `suspicious_input`, `cors_rejected` — is worth nothing if it ages out before anyone reads it. | 30 min |

---

## 3. Deliberately not adding

- **A payment processor** — Apple and Google take the payment. Handling cards directly means PCI DSS.
- **An auth provider** — see `docs/FIREBASE-ASSESSMENT.md`.
- **A CDN** — the API serves JSON; the app ships through the stores.
- **A queue** — Oscar's fork has one. Analyses are fast enough that the added
  operational surface is not yet earned.
- **Search** — nothing to search.

---

## 4. The one that is a product decision, not a provider decision

**Object storage for clips.** Oscar's fork has it (S3, presigned URLs,
thumbnails) and it is his single best feature: users currently lose their
footage on reinstall or a new phone.

But today **video never leaves the device**, and that is:

- the strongest line in the privacy policy,
- a large part of why the App Privacy label declares no Photos or Videos,
- and the core of the BIPA position in `docs/LEGAL-RISK.md` §5.

Uploading footage changes the privacy policy, both store data-safety forms, the
biometric-privacy analysis, and the breach exposure — from "angles" to "video of
people's bodies". Worth doing, but decide it deliberately with that list in
front of you, not as a side effect of adopting a provider.

---

## If you do four things

1. **Verify a domain in Resend** — unblocks every real user. *(needs a domain)*
2. **Connect Railway to GitHub** — stops deployed and `main` diverging. *(15 min)*
3. **Create a Sentry project, set `SENTRY_DSN`** — the code is waiting. *(15 min)*
4. **Point an uptime check at `/api/health/metrics`** — catches a broken mailer
   before a user does. *(15 min)*

Three of those are quarter-hour jobs, and the fourth is the domain everything
else is waiting on.
