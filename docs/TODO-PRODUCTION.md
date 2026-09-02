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
`4form`, service `fourformai`, in Oscar's workspace). `TRUST_PROXY=1` and
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

### 1.3 Configure a mail provider — ✅ WORKING 2026-09-01, own domain

Resend is wired and live. A real password reset was completed end to end:
request → token → email → inbox → link → landing page → password changed → old
password rejected → token refused on replay. Session revocation fired on the
reset, so any token issued beforehand died with it.

> Note: `APP_PUBLIC_URL` must be set on the server or `createResetUrl` throws by
> design. It previously defaulted to `athleteai.app`, a domain owned by someone
> else. Since 2026-09-01 it is `https://4formai.com`, so reset links land on the
> app's own domain. The Railway hostname still serves everything as well —
> nothing was orphaned by the move.

> ✅ **Sending from `no-reply@mail.4formai.com` since 2026-09-01.** The domain
> was registered in Resend and its DKIM/SPF published at Porkbun the same day;
> a real send was accepted through `pnpm mail:verify`. Mail now reaches any
> address, not just the Resend account owner — the long-standing test-sender
> limitation is gone.
>
> Two traps worth recording, both of which produced confidently wrong readings
> during setup:
>
> - **`GET /domains` returns `[]` even when the domain exists and is verified.**
>   The production key is send-only, so a listing is empty for permissions
>   reasons, not because nothing is registered. Do not use it to check state.
> - **The DKIM record is at `resend._domainkey.mail.4formai.com`,** not
>   `resend._domainkey.4formai.com`. Query the wrong name and Porkbun's wildcard
>   answers with `uixie.porkbun.com`, which looks like a misconfigured record
>   rather than a missing one.
>
> The only trustworthy check is an actual send:
>
> ```bash
> cd artifacts/api-server && pnpm mail:verify you@example.com
> ```
>
> Accepted is not delivered — open the inbox and confirm `spf=pass dkim=pass
> dmarc=pass` in the raw headers.

Resend is wired and the plumbing is proven: a real password reset completed end
to end on 2026-08-12 — request → token → email → inbox → link → landing page →
password changed → old password rejected → token refused on replay. Session
revocation fired on the reset, so any token issued beforehand died with it. See
`docs/EMAIL-SETUP.md`, which also records the two failures that turned up and why
neither was catchable by the test suite.

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
- 🔴 **Fill in the bracketed values, then the documents publish themselves.**
  Both files still carry values only a person can supply, and the server
  **refuses to serve either document while any remain** — `/privacy` and
  `/terms` return 503 and a short "not published yet" page rather than leak a
  blank or a draft note to a store reviewer. Filling them in and redeploying is
  the entire publishing step; nothing else is wired to a switch.

  Filled 2026-09-01: the operators are **Tyson Youm and Oscar Chuang** (named
  individuals — there is no company, and no separate UK/EU controller), and the
  processors are Railway and Resend.

  Two more were filled 2026-09-02, leaving four values and one of them is really
  a single action.

  | Still blank | Appears in | What it needs |
  |---|---|---|
  | `[privacy@…]`, `[security@…]` | Privacy | Working mailboxes |
  | `[support@…]` | Terms | Working mailbox — **and already live in the landing page footer** |

  **`[JURISDICTION]` → the United States of America, 2026-09-02.** Chosen with the
  trade-off on the table rather than by default: US contract law is state law, so
  a national choice leaves a court to run the conflict-of-laws analysis that the
  same sentence disclaims, and the clause partly argues with itself. Naming a
  single state would be the stronger drafting, and it is a one-word change if that
  is ever wanted — but it is a decision about where a dispute would be fought, not
  a blank, so it was not made on Tyson's behalf.

  While filling it: **§14 pointed at "the courts identified in section 13", and
  §13 identifies no courts** — only a governing law. A dispute clause aimed at a
  venue that does not exist is worse than one that names none, so §14 now reads
  "any court of competent jurisdiction". That was a defect in the draft and not a
  consequence of the choice above; naming a state later does not resolve it,
  because §13 would still have to gain a venue sentence for the old wording to
  mean anything.

  Filled 2026-09-02: `[DATE — set when published]` → 2 September 2026 in both, and
  `[USD 100]` → `USD 100` in the Terms. The cap was only ever bracketed to mark it
  as unconfirmed; the figure itself is the conventional one and is a real term —
  it is the ceiling on our exposure, and it is a number to change on purpose, not
  a blank to fill. The privacy policy's **Last updated** moved to the same date,
  because its collection table gained the waitlist row that day and the old date
  had stopped being true of the document.

  If publication slips past 2 September, bump both **Effective** lines. A document
  cannot be effective from a date on which it returned 503.

  Two bugs in the guard were found while filling these in, both of which would
  have defeated it:

  - It required an uppercase first character, so the **lowercase contact
    addresses were invisible to it** and would have shipped verbatim on a live
    privacy policy. A third one, `[security@yourdomain.com]`, only surfaced once
    the pattern was widened.
  - It scanned the **raw** Markdown, including the publisher notes — which
    contain the literal string `[BRACKETED]`. Every real blank could have been
    filled and the documents would still have sat at 503 for ever, held there by
    a string no reader can see. The scan now runs on the stripped text, so the
    guard and the reader see the same document.

  Both are pinned by regression tests.

  **Porkbun email forwarding — deferred 2026-09-01, do this first.** It unblocks
  three of the five remaining blanks and takes minutes. Forwarding is already the
  mail handler for the apex (`MX 10 fwd1.porkbun.com`, `20 fwd2.porkbun.com`), so
  nothing needs enabling — only aliases adding, under **Domain Management →
  4formai.com → Email Forwarding**, which is its own section and not DNS Records:

  | Forward from | Forward to |
  |---|---|
  | `privacy@4formai.com` | a real inbox |
  | `security@4formai.com` | a real inbox |
  | `support@4formai.com` | a real inbox |

  Skip the catch-all Porkbun offers — an address published in a privacy policy
  attracts enough spam without one.

  Two things not to touch. **Anything under `mail.4formai.com`**: that is the
  Resend sending domain, with its own DKIM, SPF and `MX`, and apex forwarding
  does not collide with it. And **the apex `MX` itself** — `fwd1`/`fwd2` are what
  make forwarding work at all.

  Send a test to each address before saying it is done. A contact address on a
  privacy policy has to actually receive mail; one that bounces is worse than the
  503 the documents currently return.

  **`support@4formai.com` is already published**, in the landing page footer that
  went live 2026-09-02 — so unlike the other two, that alias is not waiting on the
  legal documents. Until it forwards, the only contact route on a live page that
  asks for an email address is an address that may not receive one. It is the
  first of the three to add.

  **`[ADDRESS]` was removed, 2026-09-02 — decided, not deferred.** Both documents
  now identify the operators by name and give an email; §1 says plainly that there
  is no office and no postal correspondence. Do not put the blank back without
  reading the next two paragraphs.

  The earlier note here said "GDPR and CCPA both require a real, reachable one".
  That was wrong and had been repeated without checking. GDPR Article 13(1)(a)
  requires the controller's *identity and contact details* — not a postal address.
  The names satisfy the identity; a working mailbox satisfies the contact details.
  A postal address is conventional and is what a reviewer expects to see, which is
  a different claim from a requirement, and the two had been run together.

  **What the removal does not remove.** Two obligations sit outside the policy and
  are untouched by this:

  - **The launch email.** Anti-spam law wants a mailing address *in the commercial
    message itself* — CAN-SPAM requires a valid physical postal address, and CASL
    requires a mailing address in every commercial electronic message. The
    waitlist exists to send exactly one such message. Settle this before sending
    it, not before publishing the policy; whether CASL applies turns on where the
    operators actually are, which is not recorded anywhere in this repo.
  - **Google Play** verifies a developer address and publishes it on the store
    listing. An address becomes public through that route whether or not it is in
    the policy.

  Also unresolved, and older than this decision: `LEGAL-RISK.md` §7 flags that EU
  users with no EU establishment may need an **Article 27 representative**, who is
  themselves an address that belongs in the policy. The exemption is for occasional
  low-risk processing, and joint angles with injury-risk flags sit close enough to
  health data not to assume it.

  One thing to check while in there: §6 rests the UK/EU transfer on the **adequacy
  decision for Canada**, which covers organisations subject to PIPEDA. That is an
  assumption about where the operators are established, not just about where
  Supabase runs. If it is wrong, §6 is wrong — and it was wrong before this
  change, not because of it.

  Optional while in there: `_dmarc.4formai.com` has no record — the lookup
  returns Porkbun's wildcard, not a policy. `TXT` at host `_dmarc` with
  `v=DMARC1; p=none; rua=mailto:security@4formai.com` is monitor-only, changes
  nothing about delivery, and stops others spoofing the domain. Add it after the
  forwarding, so the reports have somewhere to land.

  The four "delete before publishing" blocks need no action: the renderer strips
  any blockquote marked that way, so the Markdown stays the single source of
  truth rather than being hand-edited into a second copy.

  **`EXPO_PUBLIC_LEGAL_BASE_URL` is deliberately still unset.** Setting it would
  turn the in-app Terms and Privacy links live, and today they would open the
  503 page. The app currently tells the user plainly that the documents are not
  published, which is more honest than a link that leads to a notice saying the
  same thing. Set it in the same change that fills the placeholders.

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

- ✅ **DNS + Resend** — done 2026-09-01. `mail.4formai.com` is verified in
  Resend, DKIM/SPF are live at Porkbun, `MAIL_FROM` is set on the service, and a
  real send was accepted. See §1.3 for the two checks that lie.
- ✅ **`4formai.com` is live** — done 2026-09-01, pointing at the API service.
  The apex is an **ALIAS**, not a CNAME: Porkbun refuses a CNAME at the root and
  is right to, because a CNAME there is only legal if the name has no other
  records, and the apex carries the `MX` for Porkbun's mail forwarding. A
  registrar that allowed it would have silently taken that mail down. Railway's
  setup instructions say "CNAME @" because most registrars offer nothing better.

  The API now serves `/`, `/privacy` and `/terms` (`routes/legalPages.ts`).

- ✅ **The landing page** — done 2026-09-01. Built from Tyson's design, served
  by `routes/landingPage.ts` from `src/pages/landing.html`, which is inlined into
  the bundle at build time exactly as the legal documents are.

  Four things about it are worth knowing before editing it.

  **It loads nothing from anywhere.** The design was authored against Google
  Fonts and GSAP from jsDelivr; both are gone. The three faces are vendored as
  latin-subset woff2 (138 KB, SIL OFL, `src/assets/fonts/LICENSE.md`) and served
  from a content-hashed, immutable URL, and the motion is ~200 lines of plain
  DOM code instead of a 70 KB library. That keeps every reader's IP off a third
  party — which is what the privacy policy says — and keeps the page working when
  someone else's CDN does not.

  **The CSP pins hashes, not a nonce**, unlike the other HTML routes here. A
  nonce makes every response body unique, which costs the ETag and 90 KB on every
  reload of a page whose content never changes. The digests are computed from the
  finished HTML at module load and the module refuses to load if it cannot find
  exactly one `<style>` and two `<script>` blocks — a policy that does not cover
  the page renders it unstyled and inert, silently, and only in a browser. The
  test hashes what was actually served and asserts the policy names it.

  **Nothing is hidden that JavaScript is not there to reveal.** Every
  pre-animation state is scoped to `html.motion`, which the head script sets only
  when scripting is on and reduced motion is not asked for. There is a test for
  that scoping, because the failure mode is a blank page.

  **The waitlist is real.** `POST /waitlist` writes to `waitlist_signups`
  (migration `0009`), and the form works with scripting off — POST, 303, the page
  comes back in its joined state. A form that thanks you for joining a list that
  does not exist is the same class of thing as a privacy policy with blanks in it.

- 🟡 **The waitlist has no way to read it out yet.** When TestFlight opens,
  `psql "$DATABASE_URL" -c "\\copy (SELECT email FROM waitlist_signups ORDER BY created_at) TO STDOUT WITH CSV"` is the whole export. Worth a script if it is
  ever needed twice.

- 🟡 **Two chips on ink are still under AA.** `+6 VS LAST` measures 3.30:1 and
  `BACK SQUAT · SIDE ON` 3.91:1 — both are `onInkMuted` on a bone-washed pill,
  which is the device `constants/caliper.ts` already documents accepting at
  3.43:1 ("the joint chips on the skeleton"). Left as the app has it rather than
  diverging on the landing page alone; if that trade is ever revisited, these two
  move with it. Everything else on the page passes: a sweep of all 254 text
  nodes at 1440×900 returns only these.

  Three others were fixed on the way. The footer copyright used `textGhost`, a
  *paper* tone, on ink (3.46:1) and now uses `onInkMuted` (5.59:1). The `TODAY`
  label and the SVG angle label were true cobalt on ink (2.2:1); blue carries
  almost no luminance, so cobalt cannot clear 4.5:1 on both grounds — the page
  now has a `--cobalt-on-ink` for *text*, exactly as the palette already has
  `rustOnInk`, and the arc and stem keep the true cobalt because a graphic's bar
  is 3:1 and the accent is theirs.

- 🟡 **Two headings sit very tight at desktop width.** `IN THE APP` and `PLANS`
  cap their headings at 24ch and 26ch, measured in the *body* font, so at a
  desktop font size "One reading, one thing to do next." sets in five short
  lines. That is the design's own value and the stacked look is clearly
  deliberate across the page, so it was built as drawn — but it is the one place
  worth a second look on a wide screen.
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
  in the same sitting.

  The **project** was renamed `athleteai` → `4form` on 2026-09-01 too. Nothing
  in the repo depends on the project *name*: every documented command pins the
  project **id** (`ad6fbf98-…`), which a rename does not change.

  One thing does break, and it is not the rename. `railway link` is keyed by
  **absolute directory path**, stored in `~/.railway/config.json` — so moving
  the checkout unlinks it, and `railway status` then reports "No linked
  project". That is exactly the state in which `railway up --ci` silently
  creates a stray project, which is why every command here passes `--project`
  explicitly. Re-link with:

  ```bash
  railway link --project ad6fbf98-1a01-4366-9d04-153fa8705cbb
  ```
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

  The **local checkout** moved to `~/ACTIVE/ai-exercise-coach/4form-ai` the same
  day. It survived the move intact: pnpm's `node_modules` symlinks are
  *relative* (`.pnpm/typescript@5.9.3/node_modules/typescript`, not an absolute
  path), and CocoaPods' generated xcconfigs carry no absolute paths either, so
  neither needed regenerating. Only three files hardcoded the old location —
  `docs/HANDOFF.md`, this file, and `.claude/launch.json` in the *parent*
  directory, which is outside the repo and easy to miss.

  Do it with nothing running: a Metro watcher or Xcode holding the old path is
  what actually costs an afternoon, not the `mv` itself.
- ✅ **App icon** — done 2026-09-01. The mark is the numeral 4 drawn as a
  measured angle: stem and crossbar in ink form the frame, the diagonal is the
  limb under measurement and is the only cobalt in the icon. Six PNGs are
  generated by `scripts/generate-icons.py`, and the same geometry is drawn as
  SVG by `AppMark` in `components/caliper/glyphs.tsx` so the mark can appear
  in-app without a bitmap. The old A-monogram is gone from both.

  Four things about that script worth knowing before touching it:

  - **The geometry is a lookup table, not a formula.** The handoff ships six
    hand-corrected rungs; as the icon shrinks the crossbar drops, the diagonal
    reaches further left and the stroke thickens, so the counter stays open.
    Interpolating between rungs gets every value wrong — that was tried.
  - **It rasterises without any image library.** There is no rsvg-convert,
    Inkscape, ImageMagick, cairosvg or Pillow on this machine. It does not need
    one: a round-capped stroke is a capsule, so signed distance to a segment
    renders it exactly, anti-aliased, from the standard library. ~3s for all six.
  - **Opaque outputs are written as RGB, not RGBA.** App Store Connect rejects an
    app icon carrying an alpha channel *at all*, and an all-opaque alpha channel
    still counts. The transparent assets (Android foreground, splash) keep theirs.
  - **The Android foreground is inset to 66/108,** Android's guaranteed-visible
    safe zone, or launcher masks clip the diagonal's tip. `adaptiveIcon.backgroundColor`
    is `#EDECE7` to match — it was ink, which would have rendered a dark glyph
    on a dark field.

  Still open: Expo generates the iOS icon set by downscaling the 1024 master, so
  the per-size rungs are not wired into the iOS asset catalogue. Honouring them
  there needs a config plugin. `LADDER` already carries all six.

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
- ✅ **Apple touch icon** — done 2026-09-01. `generate-icons.py` now writes a
  second output, `artifacts/api-server/src/assets/apple-touch-icon.png` (180×180,
  the 1024 rung, bone role), because `artifacts/fourform-mobile` is excluded from
  the Docker build context wholesale and the server cannot read the app's assets.
  The ladder stays the single source of truth for the geometry. The tab favicon
  is drawn as SVG by the server from the same 29-rung numbers; Safari will not
  take an SVG for `apple-touch-icon`, which is why that one has to be a bitmap.
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
| Low | Onboarding (3) · Auth (3) · Measuring · New-session sheet · empty and error states |

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
