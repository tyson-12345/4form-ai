# Legal risk register

**Reviewed:** 12 August 2026 · **Not legal advice** — this is an engineer's
inventory of where this app could get sued, written so a lawyer can be pointed
at the real exposures rather than reading the whole codebase.

Ranked by expected cost, which is *likelihood × severity*, not severity alone.

Status: 🔴 open · 🟠 mitigated in code, needs a human step · 🟢 closed

---

## 1. 🟠 Injury claim — "the app told me to do it"

**The risk.** A user follows a drill, gets hurt, and sues. This is the highest-
severity exposure the app has, because the product's entire purpose is to tell
people how to move their bodies, and the users are disproportionately young.

**What has been done:**

- Disclaimers on the analysis screen and the skeleton overlay: *"not a medical
  assessment or an injury prediction."*
- A plain-language medical disclaimer at signup, above the fold, before the
  account exists.
- The model is instructed never to state or imply a probability of future
  injury, and never to diagnose (`NARRATIVE_SYSTEM` in `lib/claude.ts`).
- The chat coach refers pain to a physiotherapist instead of advising on it.
- Terms of Service §4 (not medical advice) and §7 (assumption of risk).
- Power and speed report "not measured" rather than a fabricated number — this
  matters legally as well as ethically, because a fabricated metric a user
  relied on is a much better claim against you than an honest gap.

**What remains:** a lawyer must review §7 and §8 of the Terms for your
jurisdiction. An assumption-of-risk clause against a **minor** is weak or void
almost everywhere — for 13–17s, the enforceable version is parental assent, and
the Terms are drafted to require it but the app does not currently verify it.
Decide with counsel whether that gap is acceptable or whether under-18 signup
needs a parental gate.

**Consider:** liability insurance before you take real user volume. It is the
only control here that actually pays a claim.

---

## 2. 🟢 Right of publicity / false endorsement — **closed 2026-08-12**

**What was there.** `lib/athleteData.ts` shipped six real, living professional
athletes by name — a golfer, a basketball player, a fencer, a tennis player, a
gymnast, and a sprinter — displayed as a product feature with a "similarity"
percentage against them. The Compare screen was ungated, and the same feature
was sold inside a $24.99/month tier.

**Why it was serious.** Two independent claims, either sufficient:

- **Right of publicity / NIL.** Commercial use of a living person's name
  without a licence. All six have active commercial licensing programmes and
  counsel who enforce them.
- **False endorsement**, Lanham Act §43(a). Presenting a named athlete as a
  feature implies association. Statutory damages, and it does not require the
  athlete to prove financial loss.

Being pre-revenue would not have helped. The tier had a price on it.

**Fixed.** Replaced with unnamed reference technique models ("Tour-level driver
swing"). The coaching point survives; the exposure does not.

**Keep it closed:** named athletes may only return under a signed licence. This
includes screenshots, marketing copy, and App Store listings — not just code.

---

## 3. 🟢 Selling features that don't exist — **closed 2026-08-12**

**What was there.** The Elite tier at $24.99/month advertised "Pro athlete
comparisons", "Side-by-side technique analysis", "Advanced biomechanics report",
and "Custom training programs". None existed. The comparison screen rendered
fixed numbers from a mock fixture. Pro advertised "Priority processing", which
no code path reads.

**Exposure:** consumer-protection statutes (FTC Act §5, state UDAP laws, the
UK CPUTR), plus chargebacks and store removal. Deceptive-pricing claims are
attractive to plaintiffs because the deception is provable from the app itself.

**Fixed.** Elite is no longer purchasable; every unbuilt claim is removed from
the catalog; a server-side check refuses to honour a receipt for a withdrawn
tier; four tests pin the invariant so a regression fails CI rather than
shipping.

---

## 4. 🟠 Children's privacy — COPPA / GDPR Article 8

**The risk.** COPPA applies to under-13s and carries per-violation penalties.
GDPR Article 8 sets the digital-consent floor at 13–16 depending on member
state. A movement-analysis app aimed at improving sport technique will attract
minors whether or not it targets them.

**What has been done:**

- Terms set a floor of 13 and require parental assent for 13–17.
- The signup screen states the age requirement before an account is created.
- The app does not collect location, contacts, or advertising identifiers, and
  serves no ads — which removes the most common COPPA aggravators.
- Video never leaves the device, so the most sensitive data a minor could
  provide is never received.

**What remains:** there is **no age gate**. Nothing stops an under-13 signing
up. Options, in increasing order of cost: a self-declared date-of-birth field at
signup that blocks under-13s (cheap, and it is what most apps do); a neutral
age screen; or full verifiable parental consent (expensive, and only necessary
if you decide to serve under-13s deliberately).

**Recommendation:** add the date-of-birth gate before launch. It is an hour of
work and it converts an unbounded regulatory exposure into a documented control.

---

## 5. 🟠 Biometric-privacy statutes (BIPA and relatives)

**The risk.** Illinois' BIPA is the one that matters: it carries a **private
right of action** with $1,000–$5,000 per violation and has produced nine-figure
settlements. Texas (CUBI) and Washington also have statutes, enforced by the
state rather than by class action.

**The analysis.** BIPA covers a "biometric identifier" — retina, iris,
fingerprint, voiceprint, or hand/face geometry — used to identify a person.
This app measures **joint angles over time**, does not perform facial
recognition, and never attempts to identify anyone from their body. The video
is processed on-device and never transmitted. That is a genuinely strong
position, and materially stronger than it would be if footage were uploaded.

**Why it is 🟠 and not 🟢:** "face geometry" is one MediaPipe landmark set away.
The pose model tracks 33 landmarks including facial points. If any future
feature retains or transmits those, or uses them to match one clip to another,
the analysis changes.

**What has been done:** the privacy policy states the position explicitly, in
§3, rather than staying silent about it.

**What remains:** a lawyer should confirm the position before Illinois users are
onboarded at scale. Do not describe the app as using "biometrics" in marketing —
it is not accurate here, and it is an admission.

---

## 6. 🟠 Health-claim / medical-device positioning

**The risk.** Claiming to detect, prevent, or treat injury moves the product
from "general wellness" toward an FDA device classification, and invites
scrutiny under health-claim rules.

**What has been done:** the model is instructed not to predict injury; the UI
frames readings as measurements; `docs/STORE-COMPLIANCE.md` §4 carries a
language table for marketing copy.

**What remains:** the discipline is ongoing, and the risk is in copy you write
later. "Prevents injuries" in a single App Store screenshot undoes the care
taken everywhere else.

---

## 7. 🟠 Data-protection compliance (GDPR / UK GDPR / CCPA)

**What has been done:** privacy policy drafted with legal bases, retention,
processors, and rights; in-app account deletion that actually deletes; no sale
or sharing of personal information; data minimisation is architectural rather
than promised, since video never leaves the device.

**What remains:**

- Publish the policy at a public URL (§ store compliance).
- Sign **Data Processing Agreements** with each processor — hosting, database,
  Anthropic, mail. Most offer a click-through DPA.
- If you have EU users and no EU establishment, assess whether an **Article 27
  representative** is required.
- Keep a short Record of Processing Activities. For an app this size it is a
  one-page document, and not having one is its own finding in an audit.

---

## 8. 🟢 Prompt injection into the coaching model

Untrusted user text — sport, session title, goals, injury concerns — is wrapped
in explicit delimiters before reaching the model (`lib/promptSafety.ts`), and
measured values are passed unwrapped so the model can distinguish our data from
the user's. Model output that round-trips through the database is re-wrapped
rather than trusted. This is better handled than most production apps.

---

## 9. ⚪️ Not yet applicable

- **PCI DSS** — never applicable if payments stay with Apple and Google. Do not
  take card details directly; it is the single largest compliance burden you can
  volunteer for.
- **Accessibility (ADA / EAA)** — worth a pass before launch. The EAA applies to
  consumer apps in the EU from June 2025.
- **Export control / sanctions** — standard app-store screening covers it.

---

## Priority before launch

1. ✅ **Arbitration clause removed** (2026-08-12). It was unenforceable against
   EU/UK consumers and weakened §8's severability. See the note in Terms §14
   before anyone reinstates it.
2. ✅ **Age gate** shipped at signup — under-13 refused server-side (§4).
3. 🔴 **Publish** the privacy policy and terms; the URLs are already read from
   `constants/legal.ts` and just need to resolve.
4. 🔴 **Sign DPAs** with all four processors.
5. 🟠 **Lawyer review** of Terms §7 (assumption of risk) and §8 (liability cap).
   Deferred by decision on 2026-08-12 — these are the clauses that carry the
   injury-claim exposure in §1, so this remains the largest untreated item.
6. 🟠 **Liability insurance** quote before real volume. It is the only control
   on this list that actually pays a claim.
