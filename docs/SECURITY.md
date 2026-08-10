# AthleteAI — Security

What's protected, how, and what still isn't. Written to be read before launch.

---

## Password storage

| Property | Value |
|---|---|
| Algorithm | bcrypt |
| Cost factor | 12 (`BCRYPT_ROUNDS` in `src/lib/auth.ts`) |
| Comparison | `bcrypt.compare` (constant-time) — never `===` |
| Minimum length | 12 characters |
| Maximum length | 200 (bounds bcrypt CPU cost) |

### Legacy hash migration

`password_algo` records the format each row is actually stored in. Anything
other than `bcrypt` — `md5`, `sha1`, `sha256`, `plaintext` — is verified once
using `crypto.timingSafeEqual` (over SHA-256 digests, so a length mismatch can't
throw or leak) and then **immediately re-hashed with bcrypt** inside the same
successful login. Bcrypt hashes below the current cost are upgraded the same way.

A hash cannot be converted without the plaintext, so the upgrade has to happen at
the one moment the plaintext is legitimately in memory: login.

To audit what's in the database:

```bash
pnpm --filter @workspace/scripts run migrate-passwords
```

Add `-- --apply` to tag rows with their detected algorithm so the login path
picks them up. The script prints counts and user ids — never hashes, never
passwords.

> If the audit reports any **plaintext** rows, treat those passwords as
> compromised. Force a reset for those users rather than waiting for them to
> sign in.

### Passwords are never logged

Enforced by a test, not by discipline: `test/auth-messages.test.ts` scans every
source file for `logger.*`/`console.*` calls whose arguments contain a
password-bearing identifier, and separately fails the build on any remaining
`console.log`. The logger also redacts `password`, `token`, `secret`,
`authorization`, and friends as a backstop.

---

## Authentication responses

Every failure to sign in returns the **byte-identical** string:

```
Incorrect email or password
```

That covers an unknown email, a wrong password, and a locked account. Any
variation lets an attacker enumerate registered addresses, or learn that they
have successfully triggered a lockout — which itself confirms the account exists.

| Situation | Response |
|---|---|
| Unknown email | 401 `Incorrect email or password` |
| Wrong password | 401 `Incorrect email or password` |
| Locked account | 401 `Incorrect email or password` |
| Password reset requested | 200 `If that email is registered, you will receive a reset link.` (identical whether or not it is) |
| Any auth-middleware failure | 401 `Authentication required. Please sign in.` |
| Any validation failure | 400 `Invalid request. Please check your input and try again.` |

### Timing

The "no such user" path runs a **real bcrypt comparison against a real dummy
hash** generated at startup at production cost. The previous code used a
hand-written placeholder that wasn't valid bcrypt, so `compare` rejected it
instantly and unknown-email responses came back measurably faster than
wrong-password ones — an enumeration oracle. A test asserts the two paths cost
comparable time.

---

## Account lockout and rate limiting

Two independent controls with different jobs.

### Per-account lockout (`users` table, survives restarts)

- **5** consecutive failures → locked for **15 minutes**
- Progressive delay on failures: 250 ms doubling to a 4 s cap. Applied to
  failures only, so it can't be used as an oracle.
- The counter resets on any successful sign-in, and a successful password reset
  clears the lock (the owner proved control of the mailbox).
- On lockout, the account owner gets an email with a reset link. The HTTP
  response is unchanged.

### Per-IP rate limits

| Route | Limit (per minute) |
|---|---|
| `POST /api/auth/login` | 10 |
| `POST /api/auth/signup` | 5 |
| `POST /api/auth/forgot-password` | 3 |
| `POST /api/auth/reset-password` | 5 |
| other `/api/auth/*` | 20 |
| `/api/chat` | 20 (Claude inference costs money) |
| `/api/analyses` | 20 |
| everything else under `/api` | 120 |

> **`TRUST_PROXY` must be set in production if you deploy behind a load
> balancer.** Rate limits key on the client IP. `X-Forwarded-For` is
> caller-supplied, so it is only consulted when `TRUST_PROXY` is set to the
> number of proxies in front of the server. The previous code read that header
> unconditionally, which meant anyone could bypass every limit by sending a
> random value on each request. With `TRUST_PROXY` unset behind a proxy, every
> request appears to come from the proxy and the limits apply globally — safe,
> but noisy. The server logs a warning on boot in that state.

State is per-process and in memory. Correct for a single instance; move the
buckets to Redis before scaling horizontally. The **account** counters are in
Postgres and already survive both restarts and multiple instances.

---

## Input validation and sanitization

Server-side, on every endpoint, regardless of what the app checks.

`src/lib/validate.ts` provides sanitizing zod primitives:

| Primitive | Behaviour |
|---|---|
| `safeText(min,max)` | strips markup/control chars, collapses whitespace, then length-checks |
| `safeMultiline(min,max)` | same but preserves paragraph breaks |
| `safeEmail` | normalizes to canonical lowercase, then format-checks |
| `safePassword` | length only — **deliberately not sanitized** |
| `safeUuid` | rejects path traversal and injection payloads in id params |

Order matters: sanitize **then** length-check, so a value padded with markup
can't slip past a limit measured before stripping.

`safePassword` is not sanitized on purpose. Stripping characters from a password
would silently change it and lock out anyone using markup characters in an
otherwise strong passphrase.

### What sanitization removes

Script and style **element bodies** (not just their tags — dropping only tags
leaves the executable text behind as innocent-looking content), all HTML/XML
tags, `javascript:`/`vbscript:`/`data:` schemes, C0/C1 control characters, and
zero-width / bidi-override characters used to spoof text direction.

Layout whitespace is converted to spaces *before* control characters are
stripped, so words aren't glued together — a bug caught by the test suite.

### Error handling and monitoring

Validation failures return the generic message above. The **field paths and
error codes** go to the server log (`event: "validation_failure"`), never the
offending values, which may contain credentials.

Payloads matching an injection heuristic are logged separately as
`event: "suspicious_input"` and still processed normally after sanitization —
the point is visibility into probing, not blocking.

---

## Secrets

- `.env` is gitignored at both the repo root and in `artifacts/api-server`.
  **Verified: no `.env` file has ever been committed to this repository's
  history.** Only `.env.example` files (placeholders) are tracked.
- No hardcoded API keys, tokens, connection strings, or private keys exist in
  tracked files.
- The server refuses to boot without `DATABASE_URL`, `JWT_SECRET`, and
  `ANTHROPIC_API_KEY`, and refuses a `JWT_SECRET` shorter than 32 characters.
- The global error handler logs the full error server-side and returns only a
  generic message. Error text routinely carries connection strings, file paths,
  and SQL fragments.
- Request bodies are never logged.

### Rotate before launch

`ANTHROPIC_API_KEY`, `DATABASE_URL`, and `JWT_SECRET` have all been present in
local `.env` files during development and shared between two developers. Rotate
all three before going live. Rotating `JWT_SECRET` invalidates every existing
session, which is the desired effect.

Generate a new JWT secret with:

```bash
openssl rand -base64 48
```

---

## Transport and headers

Set on every response:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Resource-Policy` | `same-site` |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()` |
| `Cache-Control` | `no-store` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (production only) |

`X-XSS-Protection` is deliberately **not** set: it is deprecated and its legacy
filter introduced vulnerabilities of its own. CSP is the real control.

### CORS

Allowed origins come from `ALLOWED_ORIGINS` (comma-separated). Requests with no
`Origin` header are allowed — native apps and curl send none, and there is no
browser same-origin policy to enforce for them.

Wildcard origins now require `NODE_ENV=development` **and**
`CORS_ALLOW_ALL=true`. The previous condition was `NODE_ENV !== "production"`,
which meant an unset `NODE_ENV` — the common case — disabled CORS entirely.

---

## Authorization

Every resource route filters by `userId` from the verified JWT. Specifically
checked:

- `GET/DELETE /api/analyses/:id` — scoped to the caller, and the id is
  uuid-validated before it reaches the query.
- `POST /api/chat` — a `referencedAnalysisId` is verified to belong to the
  caller before being stored. Previously any user could attach another user's
  analysis id to their own message.
- `GET /api/auth/me` — a verified token for a deleted user returns 401 (so the
  client clears its token), not 404.

### JWT hardening

`verifyToken` pins `algorithms: ["HS256"]` and checks the issuer. Pinning blocks
the classic `alg: none` confusion attack; a test asserts an unsigned token is
rejected.

---

## Billing integrity

The previous build had a complete paywall bypass: `POST /subscriptions/update`
accepted a `tier` from the request body, and the pricing screen called it
directly. Tapping "Get Elite" granted Elite, permanently, with no payment — while
the screen displayed real prices and stated that payments were "processed by
Apple App Store or Google Play".

Fixed:

- The client can no longer assert its own tier. Upgrades require a
  server-verified store receipt (`/subscriptions/verify-purchase`, currently 501
  because billing isn't configured).
- The dev override is double-gated (`NODE_ENV !== production` **and**
  `ALLOW_DEV_TIER_OVERRIDE=true`) and returns 404 when disabled.
- `resolveEffectiveTier` expires lapsed subscriptions rather than trusting the
  stored tier forever.
- The pricing screen shows an honest "not available yet" state and no longer
  claims payments are being processed.
- The free tier's advertised "3 per month" is now **enforced per calendar
  month**. It previously counted every analysis ever created, silently turning a
  monthly allowance into a lifetime cap.

---

## Known limitations

Things a reader should not assume are covered.

1. **Signup is not fully non-enumerable.** A duplicate email returns a
   conditional message (`"…If you already have an account, try signing in or
   resetting your password."`) with matched timing, which does not *confirm*
   registration. True non-enumeration requires email-verified registration —
   respond identically in both cases and deliver the outcome by email. That needs
   a configured mail provider.

2. **Email is not configured.** `RESEND_API_KEY` and `MAIL_FROM` are unset, so
   `sendEmail` logs and returns without delivering. Lockout notifications and
   password reset links **are generated but not sent**. The reset flow is built
   and tested end to end — screens included — but cannot complete until a
   provider is wired up.

3. **Rate-limit state is in-process.** Horizontal scaling needs Redis.

4. **No email verification on signup.** Anyone can register with an address they
   don't control.

5. **No 2FA.**

6. **Videos are unencrypted on the device.** They never leave it, but they sit in
   the app's document directory in the clear.

7. **The Claude API key is a shared org key.** Per-user cost attribution and
   spend caps don't exist; the per-IP rate limits on `/api/chat` and
   `/api/analyses` are the only spend control.

8. **No automated dependency scanning.** Run `pnpm audit` and wire up
   Dependabot before launch.

### Account deletion

`DELETE /api/profile/account` permanently removes the user row; every child
table cascades from it (profile, subscription, analyses, tips, injury risks,
progress entries, chat, achievements, reset tokens). Clips live on the device
and are removed by the client.

Deletion requires the current password. A stolen unlocked phone must not be able
to erase someone's history, and the UI adds a typed `DELETE` confirmation on top
of that. A wrong password returns the same `Incorrect email or password` string
as a failed sign-in, since it is the same credential check.

---

## Reporting

There is no security contact configured. Add one (`SECURITY.md` in the GitHub
repo root, or a `security@` address) before the app is publicly available.
