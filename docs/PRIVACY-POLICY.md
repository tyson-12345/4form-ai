# 4Form AI Privacy Policy

**Effective:** 2 September 2026
**Last updated:** 2 September 2026

> **Publishing note (delete this block before publishing).**
> Both app stores require this to be reachable at a **public HTTPS URL** before
> review, and the same URL goes in App Store Connect, Play Console, and the
> app's Profile screen. Replace every `[BRACKETED]` value. The factual claims
> below were verified against the code on 12 August 2026 — if the app changes
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
Questions: **[privacy@yourdomain.com]**

For UK/EU users, Tyson Youm and Oscar Chuang is the data controller for the information described
here.

## 2. What we collect

### Information you give us

| Data | Why | Kept |
|---|---|---|
| Email address | Sign-in, password reset, security notices | Until you delete your account |
| Password | Sign-in. Stored only as a bcrypt hash — we cannot read it | Until you delete your account |
| Name | Shown in the app | Until you delete your account |
| Sport, level, goals, injury concerns | Tailoring your coaching notes | Until you delete your account |
| Session titles | Labelling your own sessions | Until you delete your account |
| Messages to the AI coach | Answering them, and continuity between messages | Until you delete your account |
| Email address, if you join the waitlist on 4formai.com | Sending you one email when the TestFlight build opens | Until the build opens, or until you ask us to remove it |

### Information created when you analyse a clip

When you pick a training video, the app measures your body position **on your
device**. What is sent to us is the resulting numbers:

- joint angle ranges, averages, and variability
- left/right symmetry
- how much of the clip each joint spent outside its typical safe range
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
| Anything else we ask you about | Consent, which you may withdraw |

## 5. Who else sees it

We do not sell your personal information. We do not share it for advertising.
We use a small number of processors, each doing one job:

| Processor | What they get | Why |
|---|---|---|
| Railway | Everything stored, as our infrastructure | Running the API |
| Supabase | The database contents | Storing your account and measurements |
| Anthropic (Claude) | Your measurements, sport, level, goals, and coach messages | Writing your coaching notes and replying in chat |
| Resend | Your email address | Sending password resets and security notices |
| jsDelivr (CDN) | Your device's IP address | Delivering the on-device pose-tracking library |

**On Anthropic:** your measurements and messages are sent to generate coaching
text. Your **video is not sent** — Anthropic receives numbers and text, never
footage. Under Anthropic's commercial terms, this data is not used to train
their models.

We may also disclose information where legally required, or to protect the
rights and safety of our users.

## 6. Where it lives

Data is stored in **Canada** (Supabase, `ca-central-1`).

If you are in the UK or EU, this transfer relies on the European Commission's
**adequacy decision for Canada**, which recognises Canadian commercial privacy
law as providing equivalent protection. No Standard Contractual Clauses are
required for it.

> **Note (delete before publishing).** The adequacy decision covers organisations
> subject to Canada's PIPEDA. It is the reason this transfer is straightforward
> — a US region would have meant relying on the Data Privacy Framework or SCCs
> instead. Worth keeping in mind before moving regions.
>
> Your other processors are separate transfers with their own bases, and are
> listed in §5.

## 7. How long we keep it

Your data stays until you delete it. When you delete your account, your account
row, profile, analyses, measurements, coaching notes, and chat history are
removed. Backups roll off within [30] days. Anonymous, aggregated statistics
that cannot identify you may be retained.

## 8. Your choices and rights

**In the app, right now:**

- **Delete your account and all your data** — Profile → Delete account. Takes
  effect immediately and needs no email to us.
- **Delete a single session** — swipe it away in your sessions list.
- **Delete a clip** — it is a file on your device; deleting the session removes
  it.

**On request, at [privacy@yourdomain.com]:** access a copy of your data,
correct it, restrict or object to processing, or receive it in portable form.
We respond within 30 days.

UK/EU users may complain to their supervisory authority (in the UK, the ICO).
California residents have rights under the CCPA/CPRA, including the right to
know, delete, and correct, and the right not to be discriminated against for
exercising them. **We do not sell or share personal information** as those
terms are defined by the CPRA.

## 9. Children

4Form AI is not directed at children under 13, and we do not knowingly collect
their information. If you believe a child under 13 has given us data, write to
[privacy@yourdomain.com] and we will delete it.

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
vulnerability, please write to [security@yourdomain.com].

## 11. Changes

We will update the date at the top when this changes. For anything that
materially affects your rights, we will tell you in the app before it takes
effect.

## 12. Contact

**[privacy@yourdomain.com]** · Tyson Youm and Oscar Chuang
