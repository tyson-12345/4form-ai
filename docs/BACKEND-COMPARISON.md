# AthleteAI — Backend Comparison and Consolidation Decision

**Status:** decision document, for Tyson and Oscar to agree on.
**Date:** 2026-08-10
**Compared:** `origin/main` @ `a2eae91` (Tyson) vs `oscar/main` @ `d43c8b3` (Oscar)
**Common ancestor:** `e719ca7` — 12 commits behind mine, 643 behind Oscar's.

---

## 0. How to read this

These are two independently rebuilt applications that share a name, an ancestor,
and roughly one API shape. A merge has already been attempted: all 34 file
conflicts resolved, then 134 typecheck errors, because the data models are
incompatible at the primary-key level (`serial` integer vs `uuid`). **That path
is closed.** One backend survives and the other is harvested.

Everything below was verified by reading the source at both commits, not by
recall. Where I make a claim about Oscar's code I cite the file. Where I could
not verify something, I say so.

Two caveats on my own even-handedness, stated up front so you can discount for
them: this document was written from my working tree, and I ran my test suite
but not Oscar's. Section 3 contains the findings that go against me.

**Verified while writing:** my API suite is **229/229 passing** (8 files, 96 s).
I did not execute Oscar's suite — it needs a separate workspace install — so
every claim about his tests below is static (dependency graph and import
analysis), and flagged as such.

---

## 1. Architecture

### Oscar's: `routes → services → repositories`

```
routes/analyses.ts      HTTP: parse, authenticate, status codes
services/analysisService.ts   orchestration, validation, AI calls, formatting
repositories/analysisRepository.ts   every DB query, nothing else
lib/ai/*                Claude prompt construction, split by use case
lib/{redis,queue,objectStorage,alerting}.ts   infrastructure
```

### Mine: `routes → lib`

```
routes/analyses.ts      HTTP + orchestration + validation, in one file
lib/{scoring,auth,sanitize,validate,rateLimit,claude}.ts   pure modules
```

### Which is the better base — honestly, his

I looked hard for a reason to say otherwise and did not find one.

`repositories/analysisRepository.ts` is the strongest single file in either
repo. Every query is a named function, and — this is the part that matters —
**every user-scoped query takes `userId` and puts it in the `WHERE` clause**:
`findAnalysisById(id, userId)`, `deleteAnalysis(id, userId)`,
`findCompletedDrill(userId, analysisId, tipId)`. There is no way to call the
repository and accidentally read another user's row, because there is no
function that fetches by ID alone. That is IDOR prevention enforced by the
shape of the API rather than by remembering to write the check. My routes do
the same check correctly today, but they do it inline, which means correctness
depends on the next person remembering.

The service layer earns its place too. `analysisService.ts` holds
`validateVideoUrl`, `sanitizeJointAngles`, `sanitizeJointRisks`,
`MAX_TITLE_LENGTH` and `formatAnalysis` — all unit-testable without an HTTP
server or a database, and all reusable between the route handler and the
background job path.

The honest counter-argument is that the layering is not free and is not fully
paid for. `services/` and `repositories/` add two files and two hops per
feature, and in several places the service is a pass-through that adds nothing.
For a two-person team this is real overhead. But the overhead is *linear* and
the safety is *structural*, and my flat version has already started to show the
cost: `routes/auth.ts` on my side does HTTP parsing, lockout arithmetic, hash
migration, and email dispatch in one file, and it is the file I am least
comfortable changing.

**One caveat that is his to fix, not an argument against the layering:** the
schema carries **two profile tables**. `lib/db/src/schema/index.ts` defines
`athleteProfilesTable` with the comment `legacy — routes/profile.ts still
references this`, alongside the newer `profilesTable` in
`schema/profiles.ts`. `routes/auth.ts` writes a row to `athleteProfilesTable`
on signup, while `securityHardening.test.ts` mocks `profilesTable`. Signup and
the rest of the app are writing and reading different tables. This needs
resolving before anything else is built on it.

**Verdict: adopt Oscar's layering.** The `repositories/` pattern in particular
should be non-negotiable in the merged codebase regardless of which tree we
start from.

---

## 2. Feature-by-feature

### Only mine

| Feature | Where | Notes |
|---|---|---|
| Password reset | `routes/auth.ts`, `passwordResetTokensTable` | Hash-only token storage. Cannot complete E2E — no mail provider configured. |
| Account deletion | `DELETE /profile/account` | **App Store requirement.** Oscar has no equivalent endpoint. |
| Account lockout | `users.failed_login_attempts`, `locked_until` | 5 strikes / 15 min, progressive delay. |
| Enforced monthly quota | `GET /analyses/usage`, `subscriptions.ts` | Per calendar month, server-side. |
| Server-authoritative tier | `subscriptions.ts` | See §3 — this is the big one. |
| Deterministic measured scoring | `lib/scoring.ts` | See §4. |
| Security headers, CORS allowlist, body limits | `app.ts` | |
| Wired rate limiting | `app.ts` + `lib/rateLimit.ts` | Per-route limits, actually mounted. |
| Static source audit for leaky auth strings | `test/auth-messages.test.ts` | Fails the build on a banned phrase. |
| Graceful degradation without `ANTHROPIC_API_KEY` | `lib/claude.ts:46` | App still measures and scores. |
| Caliper design system, light/dark | mobile | |
| `docs/ARCHITECTURE.md`, `SECURITY.md`, `RUNBOOK.md` | | |

### Only Oscar's

| Feature | Where | Notes |
|---|---|---|
| `resolveApiUrl()` | `lense-mobile/lib/api.ts:3` | **Genuinely better than mine.** See below. |
| Repository + service layers | `repositories/`, `services/` | §1. |
| Prompt-injection defence | `ai/initialAnalysis.ts:174`, `chatService.ts:116` | **Better than mine.** See §3. |
| Redis caching | `lib/redis.ts` → profile/progress/chat services | Soft-`require`, degrades to no-op without `REDIS_URL`. |
| Object storage + ACL | `lib/objectStorage.ts`, `lib/objectAcl.ts`, `routes/storage.ts` | Router is **not mounted** (`routes/index.ts`). |
| Thumbnail resize + alerting | `lib/resize-thumbnail.ts`, `lib/alerting.ts` | |
| `GET /health/metrics` with alert counters | `routes/health.ts` | Real operational telemetry. |
| Broader DB indexes | `schema/analyses.ts`, `drizzle/0007` | Composite indexes; I have one. |
| Sport-specific research citations in prompts | `ai/initialAnalysis.ts` `SPORT_RESEARCH` | Cited literature per sport. |
| Biomechanics term translation | `lib/formatters.ts` | Jargon → plain English, single-pass. |
| Coaching moments, movement summary, completed drills, streaks, share cards, notifications | mobile + API | Substantially richer product surface. |
| `Dockerfile`, `railway.json` | | Deployable; mine is not. |
| BullMQ job queue | `lib/queue.ts` | **Not wired** — no non-test file imports it. |
| ESLint config | `eslint.config.js` | I have none. |

### `resolveApiUrl()` — the clearest single win on his side

```ts
// lense-mobile/lib/api.ts:3
if (process.env.EXPO_PUBLIC_API_URL) return `${process.env.EXPO_PUBLIC_API_URL}/api`;
if (typeof window !== "undefined") { … return `${protocol}//${hostname}/api`; }
return "http://localhost:8080/api";
```

Routing through the proxy's `/api` path on 443 instead of hitting `:8080`
directly. Non-standard ports are blocked on many cellular and corporate
networks, which shows up as a request that hangs and then aborts — the "Aborted
error" his last two commits are named after. This is a real field-failure fix
that I do not have, and it survives whichever backend wins.

---

## 3. Correctness and security

### Where Oscar is stronger — and he genuinely is, in four places

**1. Prompt-injection defence. He has one; I do not.**

`ai/initialAnalysis.ts` wraps all athlete-supplied text in `<user_input>`
delimiters, strips `</?user_input>` tokens from the values first (`:179`), and
gives the model an explicit instruction to treat delimited content as data
(`:184`). `chatService.ts:116` applies the same treatment to chat messages.

My `lib/claude.ts` does none of this. Looking at `buildPrompt` around `:203`,
user-controlled `title`, `goals` and `injuryConcerns` are interpolated raw into
an unstructured plaintext prompt with no delimiters and no instruction. My
`lib/sanitize.ts` strips markup and control characters, which is useful, but it
is not a defence against prompt injection — nothing in it stops
`"Morning run. Ignore all previous instructions and…"`. **His design is
structurally better here and mine should adopt it.**

**2. Redis-backed rate limiting is the right design.** `middleware/rateLimit.ts`
keys buckets in Redis, so limits hold across instances. Mine
(`lib/rateLimit.ts`) is an in-process `Map` — correct for one instance, wrong
the moment we scale horizontally, and I say so in the module comment. His
*design* is the one we want long-term.

**3. Broader index coverage.** Composite indexes on
`(user_id, uploaded_at)` and `(user_id, status, biomechanics_applied)`, plus
indexes on `chat_messages` and `completed_drills`. I have `users_locked_until`,
two on `password_reset_tokens`, and one `analyses_user_uploaded` — his
analysis-path coverage is better thought through.

**4. Ownership scoping by construction** in the repository layer — §1.

### Where mine is stronger

**1. The paywall is open on his side.** This is the most serious finding in
this document.

```ts
// oscar routes/subscriptions.ts:101
router.post("/subscriptions/update", authenticate, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);   // { tier: "free"|"pro"|"elite", … }
  await db.update(subscriptionsTable)
    .set({ tier: parsed.data.tier, currentPeriodEnd: … })
    .where(eq(subscriptionsTable.userId, req.userId!));
```

Any authenticated user can `POST {"tier":"elite","currentPeriodEnd":"2099-01-01T00:00:00Z"}`
and receive every paid feature permanently, free. There is no receipt
validation and no server-side authority over entitlement.

Separately: `analysesPerMonth` appears **only** in the `PLANS` literal
(`:24`, `:47`, `:69`). Grepping the whole api-server, it is never read. The free
tier advertises "3 video analyses per month" and enforces nothing.

My `subscriptions.ts` closes both: the client cannot assert its own tier,
`resolveEffectiveTier()` treats an expired `currentPeriodEnd` as free, and the
monthly allowance is enforced per calendar month.

**2. JWT handling.** His `lib/auth.ts:4`:

```ts
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";
```

A missing env var in production silently yields a server signing tokens with a
secret that is published in the repository — anyone can mint a valid token for
any `userId`. There is also no algorithm pinning on `jwt.verify`. Mine throws at
startup if `JWT_SECRET` is absent or under 32 chars, pins `algorithms: ["HS256"]`,
and sets/verifies an issuer.

**3. Rate limiting is not actually on.** I grepped every non-test file in his
api-server: **nothing imports `middleware/rateLimit`.** It appears only in
`lib/__tests__/rateLimit.test.ts` and as a `vi.mock` in `routes/analyses.test.ts`.
`app.ts` mounts pino, `cors()`, and the body parsers — no limiter. And even if
it were mounted, `checkRateLimit` returns `true` when Redis is absent or errors
(`:29`, `:52`) — it **fails open**. With no `REDIS_URL` set, there is no limit
on login attempts or on Claude-billed endpoints.

**4. `app.ts` hardening.** His: `app.use(cors())` — fully open to every origin;
no security headers; no body size limit; no 404 handler; no error handler, so an
unhandled throw returns Express's default stack trace. Mine sets CSP/nosniff/
frame-options/HSTS, uses a CORS allowlist, caps bodies at 256 kb, handles
`trust proxy` explicitly (an untrusted `X-Forwarded-For` lets anyone rotate past
an IP limiter), and returns generic errors while logging the detail.

**5. Login enumeration — narrower than I previously claimed.** To be fair to
Oscar: his `POST /auth/login` returns `"Invalid email or password"` for both
unknown-email and bad-password, which is correct. The `"User not found"` string
is in `GET /auth/me` behind `authenticate`, where it discloses nothing. The one
real leak is signup: `409 "An account with this email already exists"` (`:44`),
which is a genuine enumeration oracle, though a very common one.

What he does not have is the *timing* half. His login returns early when the
user is missing, skipping bcrypt entirely — so a request for an unregistered
email comes back measurably faster than one for a real account. That is an
enumeration oracle that no amount of message-flattening fixes. Mine hashes
against a real bcrypt dummy (`lib/auth.ts`, `DUMMY_HASH_PROMISE`) so both paths
cost the same ~250 ms.

**6. Test suites are not comparable in the way the counts suggest.** His raw
count is far higher than my 229. But of his 643 commits, the overwhelming
majority are mobile UI tests — share-card colour schemes, toast auto-dismiss,
confetti gating, scrubber hit-targets. That is real work and real coverage, but
it is not backend assurance.

Looking specifically at `__tests__/securityHardening.test.ts`, which is his
flagship security suite:

- Its header tests assert helmet's output. **`helmet` is not a dependency of
  `artifacts/api-server/package.json`**, and `app.ts` does not use it. Grepping
  his whole tree, the string `helmet` appears in exactly one file — that test.
  Those two assertions cannot pass.
- The rate-limiter test expects `429` on the 11th login. Nothing mounts a
  limiter. That cannot pass either.
- The Zod validation tests assert `expect([400, 401]).toContain(res.status)`.
  The token is `"Bearer fake-token-that-fails-jwt"`, so every one of them
  returns `401` and passes without ever reaching the validation being tested.

The prompt-injection tests in that same file are real, exercise real code, and
pass — that part is good work. But the security suite as a whole documents an
intended posture rather than the one that ships. I did not run it, so I cannot
say whether it currently fails or has been skipped; either way the assertions
do not match `app.ts`.

My equivalent is `test/auth-messages.test.ts`, which scans source for banned
phrases and fails the build on a leak — verified green as part of 229/229.

---

## 4. The scoring question

This is the real product disagreement, and it is worth stating precisely,
because the shorthand ("his weighted six vs my measured four-plus-nulls")
understates the difference.

### What his actually does

`lib/scoring.ts` — the weighted-six file — **is dead code.** Nothing imports it.
The real path is `ai/initialAnalysis.ts`: Claude is asked to emit the six
sub-scores as JSON with prompted ranges (`techniqueScore: <integer 50-100>`,
mobility `45-100`, `:188`), and the weighted average is inlined at `:351`.

So the six scores are **generated by a language model**, not computed. Measured
joint angles *are* fed in as context, and the prompt is firm about using them
(`ai/types.ts:106`, mapping high-risk joints to sub-65 bands) — this is grounded
generation, not invention. But it is generation:

- **Non-deterministic.** The same clip re-analysed gives different numbers.
- **Floor-clamped by prompt.** Nothing can score below 50 (45 for mobility) no
  matter how poor the movement, because the prompt forbids it.
- **Single-frame.** `formatJointAngles` passes angles "from the highest-risk
  frame" — one frame, not a distribution over the clip.
- **Requires an API key.** With `ANTHROPIC_API_KEY` empty, as it is in
  `artifacts/api-server/.env` today, his pipeline produces no scores at all.
- **Duplicated.** `biomechanicsGrounding.ts` defines a *second* LLM-generated
  score set (flow / efficiency / bodyControl / consistency / rhythm, 40–100)
  overlapping the first.

### What mine does

`lib/scoring.ts` computes four scores as pure functions over MediaPipe joint
statistics aggregated across all tracked frames — `technique` from weighted
time-in-risk-band, `balance` from left/right mean asymmetry, `consistency` from
stdDev normalised against each joint's own range, `mobility` from achieved ROM
against a per-joint reference. `overall` is their unweighted mean.
`power` and `speed` are typed `null` and always null. Below 20 tracked frames or
50% tracking quality, everything returns null rather than a number derived from
noise.

### The case for his approach

- **Six filled scores look like a finished product.** Two "Not measured" tiles
  on the results screen read as an incomplete app to a user who does not care
  why. This is a real retention argument, not a vanity one.
- **Athletes expect power and speed.** They are the vocabulary of the sport.
  Refusing to show them is a product position competitors will not take.
- **Grounded generation catches things measurement misses.** An LLM reading
  angles plus sport context can notice sport-specific patterns my four formulas
  have no representation for. His `SPORT_RESEARCH` citations are genuinely good.
- **Sport-specific weighting is directionally right.** Technique should
  probably matter more than mobility for a powerlifter. My unweighted mean
  ducks that question.
- **My thresholds are also unvalidated.** 30° for zero balance, 0.4 stdDev
  ratio, the ROM reference table — I picked those. They are deterministic, but
  determinism is not the same as accuracy, and I should not claim otherwise.

### The case for mine

- **Reproducibility is table stakes.** An athlete who re-uploads the same clip
  and sees 71 then 78 has learned the number is not about them. Everything
  downstream — progress charts, week-over-week deltas, "most improved joint" —
  is measuring model variance, not the athlete.
- **A prompt-clamped floor of 50 is not a score.** If the worst possible
  movement scores 50, the bottom half of the scale is decorative.
- **Power and speed are not derivable from 2D pose.** Force needs mass and a
  calibrated scale; speed needs camera geometry. A number in that tile is a
  fabrication with a plausible shape, and it sits next to an *injury risk*
  readout. That is the part I will not move on: it is a health-adjacent claim.
- **It works with no API key**, which is the state of the repo today.
- **Single-frame vs distribution.** Even setting aside generation, scoring from
  the highest-risk frame throws away the clip.

### My recommendation, and it is a compromise

Keep the measured engine as the source of truth for the four measurable
dimensions and for anything that feeds progress tracking. **Do not fill power
and speed with generated numbers.**

But `null` was the wrong UI answer, and that is my error, not a principle.
Replace the two nulls with something honest that still occupies the space:

- Ship a **"Movement Quality" composite** built from measured inputs, using
  sport-specific weights (his idea, my numbers) — so the headline score reflects
  sport demands.
- Where power/speed sit, show a **qualitative, clearly-labelled coach read**
  from Claude, grounded in the measured angles and visibly distinguished from
  the measured scores — no 0–100 number, no fake precision, and it degrades to
  hidden when there is no API key.
- Adopt his `SPORT_RESEARCH` citations into the write-up layer regardless. That
  is good work and is orthogonal to who computes the numbers.

That keeps the results screen full, keeps the charts meaningful, and does not
print an invented force measurement next to an injury warning.

---

## 5. Recommendation

**Mine (`origin/main`) survives as the trunk. Oscar's architecture is adopted
into it.**

To be explicit about why, since his codebase is larger and in several respects
better built: the deciding factor is that the gaps run in one direction. His
architecture is better than mine and I can adopt it — refactoring routes into
`services/` + `repositories/` is mechanical, bounded work. My security and
correctness posture is ahead of his and porting it *into* his tree means
redoing auth, the paywall, headers, rate limiting, quota, deletion, reset, and
the scoring engine — substantially all of the 12 commits — inside a codebase
where the schema currently has two competing profile tables.

It is also the shorter path to shipping. Account deletion is an App Store
requirement and only exists on my side. An open tier-escalation endpoint is a
launch blocker and only exists on his.

This is not a judgment that his 643 commits are worth less than my 12. Most of
that work is mobile product surface that we will want back, and §6 is explicit
about the cost of not having it.

### Port list, ordered by value-per-effort

| # | Item | Source | Effort | Why |
|---|---|---|---|---|
| 1 | `resolveApiUrl()` | `lense-mobile/lib/api.ts` | **1–2 h** | Fixes a real connectivity failure. Nearly free. |
| 2 | Prompt-injection delimiters + stripping | `ai/initialAnalysis.ts:174–184`, `chatService.ts:116` | **3–4 h** | Closes my worst security gap. Port into `lib/claude.ts` + `sanitize.ts`. |
| 3 | Broader DB indexes | `schema/analyses.ts`, `drizzle/0007` | **2–3 h** | Adapt to `uuid` columns. Pure win. |
| 4 | `repositories/` layer | `repositories/*` | **2–3 days** | The architecture decision from §1. Rewrite queries against my schema — the *pattern* ports, the code does not. |
| 5 | `services/` layer | `services/*` | **2–3 days** | Do together with #4. |
| 6 | `SPORT_RESEARCH` citations | `ai/initialAnalysis.ts` | **3–4 h** | Drop into my write-up prompt. Independent of scoring. |
| 7 | Biomechanics term translation | `lib/formatters.ts` | **4–6 h** | Well-tested, self-contained, real UX value. |
| 8 | ESLint config | `artifacts/api-server/eslint.config.js` | **2 h** | I have none. |
| 9 | `Dockerfile` + `railway.json` | root | **3–4 h** | I have no deploy config at all. |
| 10 | `/health/metrics` + alerting | `routes/health.ts`, `lib/alerting.ts` | **1 day** | Real operational telemetry. |
| 11 | Redis-backed rate limiting | `middleware/rateLimit.ts` | **1–2 days** | Take the design, **not** the fail-open behaviour — must fail closed, and keep my per-route limits. |
| 12 | Thumbnail resize | `lib/resize-thumbnail.ts` | **1 day** | Needs object storage (#13) to be useful. |
| 13 | Object storage + ACL | `lib/objectStorage.ts`, `objectAcl.ts`, `routes/storage.ts` | **2–3 days** | Note his router is unmounted — this is untested in production on either side. |
| 14 | Sport-specific score weighting | `ai/initialAnalysis.ts` weights | **1–2 days** | Per §4: his weights, my measured inputs. |
| 15 | Mobile product surface (coaching moments, movement summary, drills, streaks, share cards, notifications) | `lense-mobile/*` | **3–6 weeks** | The large one. Scope and sequence separately — this is a roadmap, not a port. |
| — | BullMQ queue | `lib/queue.ts` | **skip for now** | Unwired on his side; no current need. Revisit when analysis latency demands it. |

Items 1–3 are roughly a day together and I would do them this week regardless
of how the rest lands.

---

## 6. What gets lost either way

### If mine survives (the recommendation), we lose

- **The 643 commits of mobile product work** — coaching moments, movement
  summary drill-downs, completed-drill tracking, streaks, share cards,
  notifications, joint-history sheets, crop editor, frame scrubber. Reaching
  feature parity is weeks, not days, and item 15 above is a placeholder for a
  plan we have not made.
- **His mobile test suite** — hundreds of Jest/RNTL tests. They test components
  I do not have, so they cannot be ported; they are lost with the components.
- **A working layered architecture in situ.** I get the pattern, not the code.
  The rewrite against a `uuid` schema is where the estimate could double.
- **Redis caching wired into three services**, and the operational instincts
  behind it.
- **The generated-scores product**, if we take my §4 position. Six filled tiles
  is a more complete-looking app than four plus a qualitative read, and I might
  be wrong about how much users care.
- **Oscar's ownership of the codebase he has spent 643 commits in.** This is not
  a technical cost but it is the largest one, and it should be said plainly
  rather than buried.

### If his survives instead, we lose

- **Account deletion** — App Store requirement, would need rebuilding before
  submission.
- **Server-authoritative entitlement.** The tier-escalation hole and the
  unenforced quota would both need closing before charging anyone.
- **JWT fail-fast, algorithm pinning, issuer verification.**
- **Account lockout, progressive delay, dummy-hash timing mitigation, password
  reset** — all absent on his side; roughly the whole of my `576c025`.
- **App-level hardening** — headers, CORS allowlist, body limits, trust-proxy
  handling, non-leaking error handler.
- **Working rate limiting.** His exists but is unmounted and fails open.
- **The static auth-string audit** and 229 verified-green API tests.
- **Deterministic scoring** and the ability to run without an API key — which,
  with `ANTHROPIC_API_KEY` empty today, means his tree currently cannot produce
  a score at all.
- **The Caliper design system** across every screen.

### Lost either way

- **The merge itself.** Neither history absorbs the other; whichever tree loses
  becomes a reference checkout, and the losing side's git history stops being
  the record of the live app.
- **Time already spent on the 34 resolved conflicts.**

---

## 7. Open questions for Oscar

1. **The two profile tables** — `athleteProfilesTable` vs `profilesTable`. Which
   is canonical? `routes/auth.ts` writes the legacy one on signup.
2. **Does `securityHardening.test.ts` currently pass?** I could not run it.
   Statically, the helmet and rate-limiter assertions cannot hold against
   `app.ts` as written. If it is green, I have misread something and want to
   know what.
3. **Was `POST /subscriptions/update` intended as a stub** pending RevenueCat
   validation, or is it the shipping design?
4. **Do you agree with the §4 compromise** — measured engine for the four, your
   sport weights on top, and a qualitative labelled read where power/speed sit —
   or do you want to argue for generated numbers in those tiles? This is the one
   I most expect pushback on and the one where I am most open to being wrong.

---

## Appendix — verification method

- `git fetch oscar`; `oscar/main` confirmed at `d43c8b3` (his main force-updates).
- `git merge-base main oscar/main` = `e719ca7`; 12 vs 643 commits.
- Full source of `artifacts/api-server/src/**` and `lib/**` extracted at both
  commits and read directly.
- Dead-code and wiring claims established by grepping non-test files for
  importers (`queue`, `middleware/rateLimit`, `scoring`, `storage` router,
  `analysesPerMonth`, `helmet`).
- My suite: `npx vitest run` in `artifacts/api-server` — 8 files, 229 tests,
  229 passing, 96 s.
- Oscar's suite: **not executed.** All claims about it are static.
