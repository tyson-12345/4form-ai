# AthleteAI — Runbook

Getting it running, and what has to be true before it ships.

---

## Prerequisites

- **Node 22+**
- **pnpm** (`npm i -g pnpm`) — the repo refuses `npm install`
- A **Postgres** database (Supabase works; the project was built against it)
- An **Anthropic API key**

---

## First-time setup

```bash
pnpm install
```

Create `artifacts/api-server/.env`:

```bash
# Required — the server refuses to boot without these
DATABASE_URL=postgresql://user:pass@host:5432/postgres
JWT_SECRET=<openssl rand -base64 48>
ANTHROPIC_API_KEY=sk-ant-...
PORT=3001

# Recommended
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:8081,http://localhost:19006,exp://localhost:8081
LOG_LEVEL=debug

# Set in production if behind a load balancer (Fly/Render/nginx = 1)
# TRUST_PROXY=1

# Dev convenience — lets you switch tiers without a payment provider.
# Ignored unless NODE_ENV is not "production".
ALLOW_DEV_TIER_OVERRIDE=true

# Email (unset = links are generated but never delivered)
# RESEND_API_KEY=re_...
# MAIL_FROM=AthleteAI <noreply@yourdomain.com>
# APP_PUBLIC_URL=https://athleteai.app

# Billing (unset = purchases are disabled and the app says so)
# REVENUECAT_API_KEY=...
# REVENUECAT_WEBHOOK_SECRET=...
```

Create `artifacts/lense-mobile/.env`:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3001
```

> On a physical device, `localhost` is the phone. Use your machine's LAN IP
> (`http://192.168.x.x:3001`) or run `pnpm --filter @workspace/lense-mobile dev:tunnel`.

Apply the schema:

```bash
pnpm --filter @workspace/db run push
```

---

## Running

```bash
# API (rebuilds, then starts on $PORT)
pnpm --filter @workspace/api-server dev

# Mobile
pnpm --filter @workspace/lense-mobile dev
```

Health check: `curl http://localhost:3001/api/healthz`

---

## Checks

```bash
pnpm run typecheck                                   # whole workspace
pnpm --filter @workspace/api-server test             # 229 tests
pnpm --filter @workspace/api-server test:coverage
```

If the API server's typecheck reports missing exports from `@workspace/db` after
a schema change, its declaration output is stale:

```bash
npx tsc --build --force
```

---

## Operational scripts

```bash
# Audit password storage (read-only)
pnpm --filter @workspace/scripts run migrate-passwords

# Tag weak-hash rows so login-time re-hashing picks them up
pnpm --filter @workspace/scripts run migrate-passwords -- --apply
```

---

## Migrations

Normal path is drizzle-kit push:

```bash
pnpm --filter @workspace/db run push
```

`lib/db/migrations/0001_security_and_measured_analysis.sql` contains the same
change as reviewable, idempotent SQL for applying by hand. It is additive: no
column is dropped and no existing row is rewritten, apart from marking
pre-measurement analyses as `legacy-unverified`.

---

## Troubleshooting

**Server won't start: "Required environment variable X is missing"**
Working as intended. Fill in the `.env`.

**"JWT_SECRET must be at least 32 characters"**
`openssl rand -base64 48`.

**Mobile app can't reach the API**
`EXPO_PUBLIC_API_URL` points at `localhost`, which on a device is the device.
Use the LAN IP or the tunnel.

**Typed-route error for a screen that exists**
Expo regenerates `.expo/types/router.d.ts` when the dev server runs. Start it
once and re-run the typecheck.

**"The pose model failed to load"**
MediaPipe is fetched from a CDN on first use (~6 MB). Needs internet on the
device the first time; cached afterwards.

**Analysis completes with no scores**
Expected when the clip couldn't be tracked — fewer than 20 usable frames or
tracking quality below 0.5. Film side-on, whole body in frame, good light,
steady camera. The app says this on the analysis screen.

**Skeleton overlay says the clip is no longer on the device**
Videos are stored on the phone, not our servers. The file was deleted or the app
was reinstalled. Scores and coaching notes are unaffected.

**Login feels slow after a few wrong passwords**
The progressive delay, working. It doubles from 250 ms to a 4 s cap and resets
on a successful sign-in.

---

## Pre-launch checklist

### Blocking

- [ ] **Rotate `ANTHROPIC_API_KEY`, `DATABASE_URL`, and `JWT_SECRET`** — all have
      been in local dev files shared between two developers
- [ ] Set `NODE_ENV=production`
- [ ] Set `TRUST_PROXY` to match your deployment topology
- [ ] Set `ALLOWED_ORIGINS` to real origins; ensure `CORS_ALLOW_ALL` is unset
- [ ] Ensure `ALLOW_DEV_TIER_OVERRIDE` is **unset** in production
- [ ] **Set a real `ANTHROPIC_API_KEY`** — the key is currently blank, so clips
      are measured and scored but no coaching write-ups or chat are produced.
      The server refuses to boot without it when `NODE_ENV=production`.
- [ ] Configure a mail provider — the reset flow is built and tested end to end,
      but without `RESEND_API_KEY` + `MAIL_FROM` the link is generated and never
      delivered, so password reset cannot actually complete
- [ ] Run `pnpm --filter @workspace/scripts run migrate-passwords` and force a
      reset for any plaintext rows
- [ ] Add a privacy policy and terms; both stores require URLs
- [ ] Decide on billing: either wire RevenueCat receipt verification, or ship
      with purchases disabled (the app already presents this honestly)

### Strongly recommended

- [ ] Move rate-limit buckets to Redis if running more than one instance
- [ ] Add error tracking (Sentry) and uptime monitoring
- [ ] Add a scheduled job to prune expired `password_reset_tokens`
- [ ] Set a spend cap and alerting on the Anthropic account
- [ ] `pnpm audit`; enable Dependabot
- [ ] Add a security contact
- [ ] Load-test the analysis endpoint — each one is a Claude call

### Product

- [ ] Have a coach or physio review the risk thresholds in
      `lense-mobile/lib/poseTracker.ts`. They are reasonable general ranges, not
      sport-specific or clinically validated norms, and the app makes claims about
      injury risk on the strength of them.
- [ ] Confirm the medical disclaimer wording with someone qualified
- [ ] Decide what to do with existing `legacy-unverified` analyses — they are
      labelled in the UI, but you may prefer to delete them
