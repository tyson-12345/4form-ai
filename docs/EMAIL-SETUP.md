# Email setup

**Status: ✅ WORKING — 12 August 2026.** Resend is wired and a real password
reset has been completed end to end: request → token → email → inbox → link →
landing page → password changed → old password dead → token refused on replay.
Session revocation fired on the reset, as designed.

**Still on the test sender.** `MAIL_FROM` is `onboarding@resend.dev`, which
Resend only delivers **to the address that owns the account**. That is fine for
development and useless for users. Swapping to your own domain is §1–§3 below,
and it is the only thing left.

**Hardened 2026-08-31.** No new setup steps; the delivery path around them
changed. Sends are now dispatched *after* the response rather than awaited
inside it — required, because awaiting one made `/auth/forgot-password` slower
for a registered address than an unregistered one and turned a deliberately
non-enumerating endpoint into a timing oracle the moment mail worked. Transient
failures are retried with an idempotency key, a deploy drains in-flight mail
instead of dropping it, and `pnpm mail:verify` (§4) diagnoses a misconfiguration
in one command. Details in `docs/SECURITY.md` → Transactional email.

Note the local checkout carries no mail credentials — `.env` has no
`RESEND_API_KEY` — so mail only actually sends from the deployed server.

> ### Two things that cost time, so you don't repeat them
>
> **1. `403: You can only send testing emails to your own email address.`**
> Not a bug. The test sender delivers only to the Resend account owner. If you
> need to mail anyone else, you need a verified domain — there is no way around
> it, and it is the whole reason §1–§3 exist.
>
> **2. `"Something went wrong"` when submitting the new password.**
> This was CORS, and it was our bug. The reset page is served *by* this API and
> fetches this API, and browsers attach an `Origin` header even to same-origin
> requests. `ALLOWED_ORIGINS` listed only localhost, so the server refused a
> request from its own page — and reported the refusal as a 500, which sent us
> hunting in the wrong place.
>
> Fixed: the API always allows its own origin, derived from `APP_PUBLIC_URL` so
> it follows a domain change, and CORS rejections now return 403.
>
> **Neither failure was reachable by the test suite.** 326 tests, typecheck, and
> curl smoke tests all passed while both bugs were live, because none of them
> send an `Origin` header or talk to a real provider. Click the link in a real
> browser before calling this done.

---

## Original notes

**Was:** code complete, provider not yet configured.
**Blocked:** password reset, account-lockout notification.

Everything in the app is wired. What remains is creating an account with one
provider, publishing four DNS records, and setting two environment variables.
Budget about an hour, most of it waiting for DNS.

---

## Why this blocks launch

Without a provider, `sendEmail()` logs the message and returns. Nothing is
delivered. The consequences are not cosmetic:

- **A user who forgets their password is permanently locked out.** The reset
  flow is fully built and tested, but the link only ever reaches a log line.
- **Lockout notices never arrive.** After five failed attempts an account locks
  for fifteen minutes. The owner is told out-of-band, by email — that is the
  *only* signal they get, because the login response is deliberately identical
  whether or not a lockout is in effect.

Both stores also expect a working account-recovery path.

---

> ⚠️ **`athleteai.app` is not yours.** It is registered at Porkbun with Google
> Workspace mail already on it, and it belonged to someone else as of
> 2026-08-12. Every example below uses `yourdomain.com` as a placeholder —
> substitute a domain you actually control.
>
> The app no longer defaults to it either: `constants/legal.ts` and the reset
> link builder now refuse to guess a domain rather than pointing users at a
> stranger's site. See the note in each file.

## Choosing a provider

Any of the three work. The code picks one by which credentials are present.

| | Resend | Postmark | Amazon SES |
|---|---|---|---|
| Setup time | ~15 min | ~20 min | ~1 hour |
| Free tier | 3,000/mo | 100/mo trial | 62,000/mo from EC2 |
| Cost at 50k/mo | $20 | ~$55 | ~$5 |
| Deliverability | Good | Best in class | Good, needs warming |
| Sandbox to escape | No | No | **Yes** — approval takes 24h+ |

**Recommendation: Resend.** Fastest path, generous free tier, and the DNS setup
is guided. Postmark is worth the money if reset mail starts landing in spam.
SES is cheapest at scale but the sandbox-exit approval is a real delay — do not
discover that the day before launch.

---

## 1. Pick a sending subdomain

Send from a **subdomain**, not your root domain:

```
mail.yourdomain.com
```

This matters. If transactional mail is ever sent from the root domain and
something goes wrong — a spam complaint spike, a compromised key — the
reputational damage hits everything at that domain. A subdomain keeps the blast
radius contained, and lets you move providers later without touching root DNS.

---

## 2. Publish DNS records

Your provider's dashboard generates exact values. The four record types below
are what to expect. Publish all four; three of them are what stops your reset
mail going to spam.

### SPF — who is allowed to send

```
Type:  TXT
Name:  mail.yourdomain.com
Value: v=spf1 include:_spf.resend.com ~all
```

Swap `_spf.resend.com` for `spf.mtasv.net` (Postmark) or
`amazonses.com` (SES).

> **One SPF record per name, ever.** Two `v=spf1` records on the same name is a
> permanent error — receivers fail the check outright rather than merging them.
> If a record already exists, add the `include:` to the existing one.

### DKIM — cryptographic signature

Your provider gives you one to three CNAMEs:

```
Type:  CNAME
Name:  resend._domainkey.mail.yourdomain.com
Value: resend._domainkey.resend.com
```

DKIM survives forwarding, where SPF does not. Do not skip it.

### DMARC — what receivers do when the above fail

```
Type:  TXT
Name:  _dmarc.mail.yourdomain.com
Value: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com; pct=100
```

**Start at `p=none`.** That means "check, report, but deliver anyway". Watch the
aggregate reports for a week or two, confirm legitimate mail passes, and only
then tighten:

```
p=none  →  p=quarantine  →  p=reject
```

Going straight to `p=reject` before you know your own mail passes is the
classic way to make every email you send disappear silently.

### Return-Path / bounce handling

Provider-specific; usually one more CNAME. It aligns the envelope sender with
your domain, which is what makes SPF pass under DMARC's alignment rule.

---

## 3. Set environment variables

Local `.env` and the deployed host both need these.

```bash
MAIL_FROM="AthleteAI <no-reply@mail.yourdomain.com>"
RESEND_API_KEY=re_xxxxxxxxxxxx
```

Postmark instead:

```bash
MAIL_FROM="AthleteAI <no-reply@mail.yourdomain.com>"
POSTMARK_SERVER_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

SES instead:

```bash
MAIL_FROM="AthleteAI <no-reply@mail.yourdomain.com>"
AWS_SES_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

Also set `APP_PUBLIC_URL` to wherever the reset screen is actually served —
reset links are built from it, and a wrong value produces links that 404.

The API key is a **secret**. It belongs in the host's secret store (Railway →
Variables), never in a commit, and never in a screenshot.

---

## 4. Verify

### Fastest check: `pnpm mail:verify`

```bash
cd artifacts/api-server
pnpm mail:verify you@example.com
```

Sends one real message through the same `sendEmail` the app uses, and names the
specific thing that is wrong when it fails. Every setup mistake below presents
to the app as the identical symptom — "the email did not arrive" — so this
exists to tell them apart in one command instead of one password-reset round
trip per guess:

| What it says | What is actually wrong |
|---|---|
| `401 / API key rejected` | Wrong key, a trailing newline, or a key scoped to a different domain |
| `403 / domain not verified` | Resend → Domains still says *Pending*; DNS has not propagated |
| `422 / invalid from` | `MAIL_FROM`'s domain is not the domain you verified — `mail.example.com` and `example.com` are different domains to the provider |
| `testing mode` | No domain verified yet, so Resend only delivers to the account owner's own address |
| `gmail.com cannot be used` | Caught before sending: you cannot prove you own a consumer domain |

It also warns when `APP_PUBLIC_URL` is unset, because reset links are built from
it and a missing value produces links that go nowhere.

**Accepted is not delivered.** A pass means the provider took the message; it
says nothing about whether it reached the inbox. Do the header check below.

### Then confirm the running server agrees

Boot it. A partial configuration fails loudly at startup rather than at the
first password reset.

Confirm from outside:

```bash
curl -s https://<host>/api/health/metrics | jq '.features'
```

```json
{
  "coachingWriteups": true,
  "sharedRateLimits": false,
  "billing": false,
  "transactionalEmail": true,
  "emailProvider": "resend"
}
```

`transactionalEmail: false` means the app is still logging-and-dropping.

### End-to-end check

1. Request a reset for a real address you control.
2. Confirm the mail arrives **in the inbox, not spam**.
3. Open the raw headers and check all three:

```
spf=pass       dkim=pass       dmarc=pass
```

Gmail: ⋮ → Show original. Anything other than three passes means a DNS record is
wrong or has not propagated — fix it before launch, because reset mail in spam
is functionally the same as no reset mail.

4. Confirm the link opens the reset screen and the new password works.
5. Fail a login five times and confirm the lockout notice arrives.

### Monitoring afterwards

`email_delivery_failed` is counted in `/api/health/metrics` and flags at five
failures since process start. If that number climbs, the provider, the key, or
the domain authentication has broken — users are being locked out silently.

---

## Notes on the implementation

- **Reset links expire in 30 minutes and are single-use.** Only the SHA-256 of
  the token is stored, so a database leak does not yield working reset links.
- **Both templates ship HTML and plain text.** No remote images, no tracking
  pixel — which also means nothing extra to disclose in the privacy policy.
- **`sendEmail` never throws.** A provider outage must not turn a reset request
  into a 500, and must not change the response — the response is identical
  whether or not the address is registered, and an error leaking through would
  break that guarantee. It returns a `SendOutcome` instead, which is what
  `pnpm mail:verify` reads.
- **Nothing is delivered inside a request.** Sends are dispatched *after* the
  response, via `deferEmail`. This is a security property, not a performance
  one: `/auth/forgot-password` only does work when the address is registered, so
  awaiting a provider round-trip there would make a registered address reliably
  slower than an unregistered one — an oracle for exactly the fact the response
  text refuses to state, which would have appeared the day this document was
  first followed. It also lets retries take as long as they need.
- **Transient failures are retried**, three attempts with jittered backoff, on
  429, 5xx, timeouts and dropped connections. A 401, 403 or 422 is not retried:
  it will fail identically forever, and retrying only delays the alert. Resend
  sends get an `Idempotency-Key` reused across retries, so a retry after a lost
  response does not deliver a second copy or mint a second reset token.
- **A deploy does not drop mail in flight.** SIGTERM stops the listener, then
  waits up to 8s for scheduled sends. A hard kill can still lose one — that is
  the accepted cost of not running a durable queue.
- **Provider errors are not propagated verbatim.** The status is kept, plus a
  bounded reason with anything address-shaped or key-shaped redacted. That is a
  deliberate widening from status-only: a bare `403` does not distinguish a bad
  key from an unverified domain from a rate limit, and each has a different fix.
  The reason goes to the server log only; the caller's response is unchanged.
- **Expired reset tokens are pruned on a timer** — `startResetTokenCleanup`,
  started after the server binds.
