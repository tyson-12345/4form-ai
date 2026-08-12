# Email setup

**Status:** code complete, provider not yet configured.
**Blocks:** password reset, account-lockout notification.

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
mail.athleteai.app
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
Name:  mail.athleteai.app
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
Name:  resend._domainkey.mail.athleteai.app
Value: resend._domainkey.resend.com
```

DKIM survives forwarding, where SPF does not. Do not skip it.

### DMARC — what receivers do when the above fail

```
Type:  TXT
Name:  _dmarc.mail.athleteai.app
Value: v=DMARC1; p=none; rua=mailto:dmarc@athleteai.app; pct=100
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
MAIL_FROM="AthleteAI <no-reply@mail.athleteai.app>"
RESEND_API_KEY=re_xxxxxxxxxxxx
```

Postmark instead:

```bash
MAIL_FROM="AthleteAI <no-reply@mail.athleteai.app>"
POSTMARK_SERVER_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

SES instead:

```bash
MAIL_FROM="AthleteAI <no-reply@mail.athleteai.app>"
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

Boot the server. A partial configuration now fails loudly at startup rather than
at the first password reset.

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
  break that guarantee.
- **Provider errors are not propagated verbatim.** They routinely echo the
  recipient address; only the HTTP status is logged.
- **Expired reset tokens are never pruned.** The table grows forever. Not urgent,
  but see `docs/TODO-PRODUCTION.md` §3.
