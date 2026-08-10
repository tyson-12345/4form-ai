# AthleteAI — Architecture

How the system fits together, and why the important parts are built the way they are.

## Repository layout

```
artifacts/
  api-server/          Express + TypeScript API (the only thing that talks to Postgres)
    src/lib/           Pure logic: scoring, sanitization, validation, auth, rate limiting
    src/routes/        HTTP handlers
    src/middlewares/   authenticate
    test/              Integration tests + static source audits
  lense-mobile/        Expo / React Native app (expo-router)
    app/               Screens, file-based routing
    lib/               API client, pose tracker, video storage, contexts
  mockup-sandbox/      Design scratchpad — not shipped
lib/
  db/                  Drizzle schema + connection (shared workspace package)
  api-client-react/    Generated client (legacy, largely unused)
scripts/               Operational scripts (password migration)
docs/                  This directory
```

Package manager is **pnpm** with workspaces. `@workspace/db` is consumed by both
the API server and the scripts package.

---

## The analysis pipeline

This is the heart of the product and the part most worth understanding.

```
┌──────────────┐   1. pick clip      ┌──────────────────┐
│  analyze.tsx │ ──────────────────▶ │   measure.tsx    │
└──────────────┘                     │  (hidden WebView)│
                                     └────────┬─────────┘
                                              │ 2. MediaPipe steps the clip at
                                              │    fixed timestamps, accumulating
                                              │    per-joint angle statistics
                                              ▼
                                     ┌──────────────────┐
                                     │   PoseMetrics    │  min/max/mean/stdDev per joint,
                                     │  (measurements)  │  frames in caution/risk bands
                                     └────────┬─────────┘
                                              │ 3. POST /api/analyses
                                              ▼
                              ┌───────────────────────────────┐
                              │  lib/scoring.ts (pure)        │  4. deterministic scores
                              │  computeScores(metrics)       │
                              └───────────────┬───────────────┘
                                              │ 5. scores + measurements
                                              ▼
                              ┌───────────────────────────────┐
                              │  lib/claude.ts                │  6. Claude writes the
                              │  generateNarrative(...)       │     coaching narrative
                              └───────────────┬───────────────┘     from those numbers
                                              ▼
                                        Postgres (analyses,
                                        coaching_tips, injury_risks,
                                        progress_entries)
```

### Why the split matters

**Claude never produces a score.** Scores come from `lib/scoring.ts`, which is a
set of pure functions over measured joint angles. Claude receives those numbers
and writes the prose that explains them.

This is not a stylistic preference. Before this change, the server sent Claude
the sport name and the title the user typed and asked it to produce a full
biomechanical assessment. No measurement existed anywhere in the path, so:

- the same clip uploaded twice produced different scores,
- every number shown to the user was invented,
- and the pose-tracking that *did* exist (the skeleton overlay) was never
  connected to the analysis at all.

The measurement step now runs before the analysis is created, so an analysis
cannot exist without the measurements behind it.

### Reproducibility

`measure.tsx` seeks to **N evenly-spaced timestamps** derived from the clip's
duration rather than sampling during playback. Realtime sampling captures
whatever frames the device happened to render, which differs per run and per
device. Fixed timestamps mean the same clip yields the same samples, the same
measurements, and therefore the same scores — every time, on every phone.

`analyses.pose_metrics` stores the raw measurements, so any score can be
re-derived and audited: running `computeScores` on the stored blob must
reproduce the stored scores exactly.

### What is and isn't measured

| Score | Derived from | Notes |
|---|---|---|
| `technique` | share of frames outside safe joint bands, risk weighted 2× caution | |
| `balance` | mean left/right angle difference across paired joints | 30° difference → 0 |
| `consistency` | per-joint stdDev scaled by that joint's own range | large ROM isn't penalised |
| `mobility` | achieved range of motion vs a per-joint reference | capped at 100 |
| `overall` | unweighted mean of the above that were measurable | |
| `power` | **always `null`** | not derivable from 2D angles |
| `speed` | **always `null`** | not derivable from 2D angles |

`null` means *not measured* and must never render as `0`. Force and power need
mass, scale, and camera geometry we don't have; emitting a number would present
an invention as a measurement.

When a clip can't be tracked (fewer than 20 usable frames, or tracking quality
below 0.5), the analysis completes with `analysis_method = "unscored"` and no
scores, plus advice on how to film a usable clip.

### `analysis_method`

| Value | Meaning |
|---|---|
| `pose-measured` | Scores computed from measured joint angles |
| `unscored` | Clip could not be tracked; no scores exist |
| `legacy-unverified` | Created before measurement existed. Its scores were generated text. The app labels these explicitly. |

---

## Pose tracking

`lense-mobile/lib/poseTracker.ts` builds a self-contained HTML document that
runs MediaPipe Pose inside a `WebView`. One builder serves two modes so the
angle maths and risk thresholds exist in exactly one place:

- **`scan`** — headless, seeks through the clip, posts one `metrics` message.
  Used by `measure.tsx`.
- **`interactive`** — the review player with scrub/step/speed controls and the
  skeleton overlay. Used by `analysis/skeleton/[id].tsx`.

MediaPipe loads from a CDN (~6 MB, cached by the WebView after first use). The
document degrades with a clear error and a retry button if it can't load.

### Risk bands

| Joint | Caution | Risk |
|---|---|---|
| Knee | ≤90° or ≥175° | ≤70° or ≥178° |
| Hip | ≤80° | ≤55° |
| Elbow | ≥160° | ≥172° |

Knees fail at both extremes (deep flexion and hyperextension); hips only on deep
flexion; elbows only on hyperextension.

`risk_percent` on an injury-risk row is **the share of tracked frames the joint
spent in the risk band** — a measurement of time-in-position, not a predicted
probability of injury. UI copy must not present it as the latter.

---

## Video storage

Clips live **on the device only**. They are never uploaded to our servers.

`lense-mobile/lib/videoStore.ts` copies each picked clip into
`documentDirectory/athlete-videos/<analysisId>.<ext>`.

The previous implementation referenced the URI returned by `expo-image-picker`,
which points into the app's **cache** directory. iOS evicts that whenever it
wants space. The analysis row survived in Postgres, so the app kept offering
"Skeleton Overlay" for a file that no longer existed — which is why the overlay
worked right after upload and silently stopped working days later.

`resolveVideo` verifies the file is on disk before returning it, so a missing
clip produces an explanatory screen rather than a black WebView.

`stageForWebView` copies into the cache directory next to the tracker HTML,
because WKWebView's `allowingReadAccessTo` only covers the HTML file's own
directory. That copy is disposable; the durable original stays put.

---

## Auth

Full detail in [SECURITY.md](./SECURITY.md). In brief:

- bcrypt at cost 12; legacy hashes (md5/sha1/sha256/plaintext) are accepted once
  and immediately re-hashed on successful login.
- JWT, HS256, algorithm-pinned, 7-day expiry, issuer-checked.
- Every login failure returns the byte-identical `"Incorrect email or password"`
  with matched timing.
- 5 consecutive failures → 15-minute account lock, plus an email to the owner.
- Progressive delay (250 ms doubling to a 4 s cap) on failures only.

---

## Entitlements

`resolveEffectiveTier(subscription)` is the only correct way to ask what a user
is entitled to. It downgrades to `free` when the subscription is expired,
non-active, or has an unrecognised tier — reading `subscription.tier` directly
would let a lapsed plan keep working forever.

`TIER_LIMITS` is the single source of truth for both enforcement and the
marketing copy in `PLANS`, so the two cannot drift. A test asserts they match.

**The client can never assert its own tier.** The old
`POST /subscriptions/update` took a `tier` from the request body; the routes
that replaced it are:

| Route | Effect |
|---|---|
| `POST /subscriptions/cancel` | Downgrade to free. Always allowed. |
| `POST /subscriptions/verify-purchase` | Upgrade from a **server-verified** store receipt. Returns 501 until billing is configured. |
| `POST /subscriptions/dev-set-tier` | Dev only. Requires `NODE_ENV !== production` **and** `ALLOW_DEV_TIER_OVERRIDE=true`. Returns 404 otherwise. |

---

## Data model

Notable columns added during the hardening work:

**`users`** — `password_algo`, `failed_login_attempts`, `locked_until`,
`last_failed_login_at`

**`password_reset_tokens`** — stores only the SHA-256 of each token, so a
database dump cannot be used to reset accounts.

**`analyses`** — `summary`, `pose_metrics`, `analysis_method`

**`injury_risks`** — `caution_percent`, `observed_min`, `observed_max`

Migration: `lib/db/migrations/0001_security_and_measured_analysis.sql`
(additive and idempotent). The normal path is
`pnpm --filter @workspace/db run push`.

---

## Testing

229 tests in `artifacts/api-server`. Run with:

```bash
pnpm --filter @workspace/api-server test
```

| Suite | Covers |
|---|---|
| `lib/sanitize.test.ts` | markup/control-char stripping, email normalization, injection heuristics |
| `lib/scoring.test.ts` | every score function, determinism, null handling |
| `lib/auth.test.ts` | hashing, legacy verification, rehash detection, JWT attacks, reset tokens |
| `lib/rateLimit.test.ts` | windows, per-IP isolation, lockout constants, progressive delay |
| `lib/validate.test.ts` | schemas, generic error responses, non-disclosure |
| `routes/subscriptions.test.ts` | entitlement resolution, plan/limit consistency, no client-assertable upgrade |
| `test/auth-messages.test.ts` | **static source audit** — scans every file for leaky auth strings and logged passwords |
| `test/login-lockout.test.ts` | end-to-end login, lockout, delay, rate limit, reset (in-memory DB fake) |

The lockout tests take ~90 s because the progressive delay is real and is not
mocked away — that cost is the security control working.
