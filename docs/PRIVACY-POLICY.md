# 4Form AI Privacy Policy

**Effective:** 2 September 2026
**Last updated:** 2 September 2026

> **Publishing note (delete this block before publishing).**
> Both app stores require this to be reachable at a **public HTTPS URL** before
> review, and the same URL goes in App Store Connect, Play Console, and the
> app's Profile screen. Replace every `[BRACKETED]` value. The factual claims
> below were verified against the code on 12 August 2026, and §§2, 4, 5 and 6
> were re-verified against it on 2 September 2026 — if the app changes
> what it collects, this must change with it. A privacy policy that overstates
> or understates collection is worse than none, because it is enforceable.

---

## The short version

- **Your videos never leave your phone.** Analysis happens on your device. We
  never receive, store, or see your footage.
- **What we do receive are measurements** — joint angles and movement
  statistics — plus your account details and what you type into the app.
- **We don't sell your data, and we don't advertise.**
- **You can delete your account and everything in it from inside the app**, at
  any time, without contacting us.

---

## 1. Who we are

4Form AI is operated by Tyson Youm and Oscar Chuang.
There is no office and no postal correspondence — every route to us is by
email, and each address below reaches a person.
Questions: **privacy@4formai.com**

For UK/EU users, Tyson Youm and Oscar Chuang is the data controller for the information described
here.

## 2. What we collect

### Information you give us

| Data | Why | Kept |
|---|---|---|
| Email address | Sign-in, password reset, security notices | Until you delete your account |
| Password | Sign-in. Stored only as a bcrypt hash — we cannot read it | Until you delete your account |
| Name | Shown in the app | Until you delete your account |
| Date of birth | Checking you are old enough to use the app (see §9). Required on both ways of signing up, and kept afterwards rather than discarded once checked, so the check can be re-verified. We store the date only, never a time | Until you delete your account |
| If you sign in with Apple or Google: the account identifier that provider gives us, and the email address it tells us | Recognising you as the same person on your next sign-in, and letting support see which provider your account uses. With Apple this address may be a private relay address rather than your own | Until you delete your account |
| Sport, level, goals, injury concerns | Tailoring your coaching notes | Until you delete your account |
| Session titles | Labelling your own sessions | Until you delete your account |
| Messages to the AI coach | Answering them, and continuity between messages | Until you delete your account |
| Email address, if you join the waitlist on 4formai.com | Sending you one email when the TestFlight build opens | Until the build opens, or until you ask us to remove it |

### Information created when you analyse a clip

When you pick a training video, the app measures your body position **on your
device**. What is sent to us is the resulting numbers:

- joint angle ranges, averages, and variability
- left/right symmetry
- how much of the clip each joint spent outside its typical range
- clip length, frame count, and tracking quality
- the technique scores computed from the above

**The video itself is never uploaded.** It is copied into your app's private
storage so the skeleton overlay can replay it, and it stays there until you
delete the session or uninstall the app.

### Information collected automatically

- **Device IP address**, used transiently for rate limiting and abuse
  prevention. Not used to build a profile of you.
- **Error and diagnostic logs**. We deliberately exclude request bodies from
  logs, so passwords, reset tokens, and message contents are not captured.

### What we do **not** collect

- Your video footage
- Photos or media other than the clip you explicitly pick. If you set a
  profile photo, it is stored only on your device and is never uploaded;
  removing it, or deleting your account, deletes it from the device.
- Location
- Contacts, calendar, microphone, or camera
- Advertising identifiers
- Any biometric identifier used to identify *who you are* (see §3)

## 3. A note on what the measurements are, and are not

The app measures **how a body moves in a video** — angles between limbs over
time. It does not perform facial recognition, fingerprinting, or any form of
identification from your body. The measurements cannot be used to recognise you
in another video, and we do not attempt to.

Some jurisdictions (notably Illinois' BIPA, Texas' CUBI, and Washington's HB
1493) define "biometric identifier" broadly. Our position is that movement
measurements are not biometric identifiers, because they are not used, and are
not usable, to identify an individual. We state it plainly here so you can judge
for yourself.

## 4. Why we're allowed to use it (UK/EU legal bases)

| Purpose | Legal basis |
|---|---|
| Running your account, delivering analysis | Performance of a contract |
| Security, rate limiting, abuse prevention | Legitimate interests |
| Improving the product | Legitimate interests |
| Using what you tell us about your injuries, and any injury-related goal you pick, to shape your coaching notes | Your consent (Art. 6(1)(a)), **and** your explicit consent to the processing of health data (Art. 9(2)(a)) |
| Anything else we ask you about | Consent, which you may withdraw |

**On the injury information.** What you tell us about your knees, hips, lower
back, shoulders, elbows or ankles is information about your health, and so is
choosing "Return from injury" or "Stay injury-free" as a goal. UK/EU law treats
health data as a *special category*: an ordinary legal basis is not enough by
itself, and a second condition from Article 9 has to sit on top of it. The
condition we rely on is your explicit consent, Article 9(2)(a). It covers those
two items and nothing else in this policy — your measurements, scores and risk
flags are not health data in our view, for the reasons in §3.

Concretely, that consent is the answer you give during onboarding, at the step
that asks whether anything is giving you trouble. Choosing "None right now"
stores nothing at all. We do not infer injuries from your measurements, and no
other part of the app writes to that field. When it is set, it goes to Anthropic
along with your analysis (§5).

You can withdraw it. Deleting your account removes it immediately, from inside
the app, without contacting us (§8). The app does not yet have a screen that
clears the answer while keeping your account, so until it does, write to
privacy@4formai.com and we will clear it for you.

> **Note (delete before publishing).** The Article 9 row is honest about the
> condition we rely on and deliberately silent about the quality of the consent,
> because two things are open.
>
> First, the onboarding step is a **required** step: `onboarding.tsx` will not
> advance until something is picked (`canContinue`, step 3), and "None right
> now" is the only way past it without answering. That makes the answer a
> deliberate act, which is not the same as the separate, unbundled, expressly
> worded opt-in that Article 9(2)(a) is usually read to require. Nothing above
> claims such a screen was shown, because there isn't one.
>
> Second, withdrawal is account deletion or an email. `PATCH /api/profile`
> accepts `injuryConcerns`, but no screen in the app sends it — the profile
> screen edits name, sport, level and weekly goal only. Consent that is harder
> to withdraw than it was to give is weak consent.
>
> Both are product changes, not drafting changes. When the consent step and the
> clear-it control ship, the third paragraph shortens and this note goes.

## 5. Who else sees it

We do not sell your personal information. We do not share it for advertising.
We use a small number of processors, each doing one job:

| Processor | What they get | Why |
|---|---|---|
| Railway | Everything stored, as our infrastructure | Running the API |
| Supabase | The database contents | Storing your account and measurements |
| Anthropic (Claude) | Your measurements and scores, your sport, level, goals and injury concerns, the title you typed for the session, your coach messages, and the coaching notes we wrote for your two most recent sessions in the same sport | Writing your coaching notes and replying in chat |
| Resend | Your email address | Sending password resets and security notices |

**On Anthropic:** this happens in two places, and they send different things.

When a clip is analysed, we send the measurements and scores from that clip,
the sport and level on your profile, **the session title you typed**, your
stated goals, **your injury concerns** if you have given any, and **the
coaching notes we wrote for your two most recent completed sessions in the same
sport** — so the coach builds on what it already told you instead of repeating
it. When you write to the coach in chat, we send the last ten messages of that
conversation, your sport and level, and the title, scores, strengths and
improvements from your most recent measured session.

Your **video is not sent** — Anthropic receives numbers and text, never footage.
Your name, email address and date of birth are not sent either, and neither is
anything from your Apple or Google sign-in. Under Anthropic's commercial terms,
this data is not used to train their models.

We may also disclose information where legally required, or to protect the
rights and safety of our users.

## 6. Where it lives

4Form AI is operated from the **United States**. Your data is stored in
**Canada** (Supabase, `ca-central-1`). The other companies that handle it for us
are listed in §5, and some of them are in the United States.

If you are in the UK or EU, your data therefore moves between countries. We
have a data processing agreement with **each** of the four companies in §5 —
Railway, Supabase, Anthropic and Resend — and every one of them incorporates
the European Commission's **Standard Contractual Clauses**, and the UK addendum
to them where UK data is involved. If you would like a copy of those
arrangements, write to privacy@4formai.com and we will send them.

**There used to be a fifth name here.** The pose-tracking library that measures
your video was downloaded from jsDelivr, a free public CDN we had no contract
with, which meant your device's IP address went to a company we could make you
no promises about. We now serve that library from our own API instead, so the
only companies your device contacts are the four above.

> **Note (delete before publishing).** This section used to say the transfer
> relied on the European Commission's **adequacy decision for Canada**, and that
> no Standard Contractual Clauses were needed. That was removed on 2026-09-02,
> and it should not come back without advice.
>
> The reasoning was wrong in one specific way. The adequacy decision covers
> organisations **subject to PIPEDA** — that is, organisations operating
> commercially in Canada. 4Form AI is operated by two individuals in the United
> States who rent server capacity in Montreal, and renting capacity in a country
> does not make you subject to its privacy law. The storage location was never in
> doubt; the conclusion drawn from it was.
>
> What replaced it claims nothing about which legal mechanism applies. That is
> deliberate. The honest position is that the data moves, that named companies
> hold it, and that our agreements with them carry data-protection terms — all of
> which is true and checkable. A privacy policy does not have to adjudicate its
> own transfer basis, and one that asserts the wrong one is worse than one that
> does not assert.
>
> **All four DPAs are now in force**, as of 2026-09-02 — Supabase, Resend and
> Anthropic bind automatically on acceptance of their terms, and Railway's
> DocuSign was signed the same day. Each was read before this section was allowed
> to name them: all four incorporate the EU SCCs by reference, and all four carry
> a UK addendum. Modules One, Two and Three appear depending on the roles.
>
> Note what the sentence above claims and what it does not. It says our
> agreements *incorporate* the clauses, which is a fact anyone can check against
> the four published DPAs. It does not say the transfer is therefore lawful under
> Article 46, because the exporter here is a US controller caught by Article 3(2)
> rather than an EEA one, and whether SCCs are the right instrument in that
> position is genuinely unsettled. State what is in the agreements; do not
> adjudicate. That is the same discipline that removed the adequacy claim.
>
> **jsDelivr is gone from §5 as of 2 September 2026.** The pose runtime is now
> vendored and served by our own API — `artifacts/api-server/scripts/fetch-mediapipe.mjs`
> downloads the nine files at build time and verifies a SHA-384 for each one
> before writing it, and `src/routes/mediapipe.ts` serves them from
> `/assets/mediapipe/`. `artifacts/fourform-mobile/lib/poseTracker.ts` points at
> that path. So there is no fifth processor and no uncontracted transfer to
> disclose. **Still open:** the measurement WebView keeps
> `allowUniversalAccessFromFileURLs`, because a `file://` document fetching from
> `https://` is cross-origin however trustworthy the origin. Closing that means
> bundling all 22 MB into the app itself, which is an app-size decision rather
> than a privacy one — nothing in this document depends on it.

## 7. How long we keep it

Your data stays until you delete it. When you delete your account, your account
row — including your date of birth and any Apple or Google sign-in link — and
your profile, analyses, measurements, coaching notes and chat history are
removed. A copy can survive for a short time in our database provider's routine
backups, which are overwritten on a rolling schedule. No backup is kept for
longer than 30 days, so a deletion is complete everywhere within 30 days of your
request, and usually sooner. Anonymous, aggregated statistics that cannot
identify you may be retained.

> **Note (delete before publishing).** The 30 days above is a ceiling we can
> hold to on any Supabase plan, not the retention of the one we are on today,
> and it is written that way on purpose: a figure that is right for one plan
> becomes a misstatement the day the project is upgraded. Supabase's published
> limits are no automatic backups on Free, 7 days on Pro, 14 days on Team, up to
> 30 days on Enterprise, and a 28-day maximum window for the Point-in-Time
> Recovery add-on — supabase.com/docs/guides/platform/backups and
> supabase.com/pricing, both read 2 September 2026. See
> `docs/SUPABASE-MIGRATION.md` §7.
>
> **What remains:** the only Supabase arrangement that can exceed 30 days is a
> negotiated Enterprise retention. If you ever sign one, this sentence has to
> change with it.

## 8. Your choices and rights

**In the app, right now:**

- **Delete your account and all your data** — Profile → Delete account. Takes
  effect immediately and needs no email to us.
- **Delete a single session** — swipe it away in your sessions list.
- **Delete a clip** — it is a file on your device; deleting the session removes
  it.

**On request, at privacy@4formai.com:** access a copy of your data,
correct it, restrict or object to processing, withdraw a consent you have given
— including the injury information covered by §4, which we will clear for you —
or receive it in portable form. We respond within 30 days.

UK/EU users may complain to their supervisory authority (in the UK, the ICO).
California residents have rights under the CCPA/CPRA, including the right to
know, delete, and correct, and the right not to be discriminated against for
exercising them. **We do not sell or share personal information** as those
terms are defined by the CPRA.

## 9. Children

4Form AI is not directed at children under 13, and we do not knowingly collect
their information. If you believe a child under 13 has given us data, write to
privacy@4formai.com and we will delete it.

Users aged 13–17 should have a parent or guardian read this policy and the
Terms with them. See the Terms of Service for the age requirements that apply
to using the app.

## 10. Security

Passwords are hashed with bcrypt at cost 12 and are never stored, logged, or
transmitted in a readable form. Accounts lock after repeated failed sign-ins,
and you are emailed when that happens. Your session token is held in your
device's secure keychain. All traffic uses HTTPS. Resetting your password signs
out every existing session.

No system is perfectly secure, and we don't claim otherwise. If you find a
vulnerability, please write to security@4formai.com.

## 11. Changes

We will update the date at the top when this changes. For anything that
materially affects your rights, we will tell you in the app before it takes
effect.

## 12. Contact

**privacy@4formai.com** · Tyson Youm and Oscar Chuang
