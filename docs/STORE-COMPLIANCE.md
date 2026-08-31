# App Store & Play Store compliance

Everything the two review processes ask for, with the answers already worked
out. Verified against the code on 12 August 2026.

**Status:** the code-side work is done. What remains needs an account you have
to be logged into — see the checklist at the end.

---

## 1. Permissions — what the app actually uses

This was audited and corrected on 2026-08-12. The app previously requested five
permissions it never used.

| Permission | Used? | Status |
|---|---|---|
| Photo library (read) | **Yes** — you pick a video to measure | Requested |
| Camera | No — the app never records | **Removed** |
| Microphone | No — no audio is ever captured | **Removed** |
| Photo library (write) | No — nothing is saved to your library | **Removed** |
| Location | No — `expo-location` was a dependency but unused | **Dependency removed** |
| External storage (legacy Android) | No | **Blocked** |

Over-requesting is not a harmless default. It gets builds rejected ("your app
requests camera access but does not appear to use the camera"), it forces you
to declare collection you don't do in the data-safety form, and it costs you
installs at the permission prompt.

The remaining Android permission is `READ_MEDIA_VIDEO` only. Camera, mic,
storage, and location are listed under `blockedPermissions` in `app.json` so
they cannot creep back in through a library's manifest merge.

### The usage string

Apple rejects generic purpose strings. The current one says what is read, why,
and — the part that matters here — what does *not* happen to it:

> AthleteAI reads the training video you pick so it can measure your joint
> angles frame by frame on this device. Your video is analysed on your phone and
> is never uploaded to our servers — only the resulting angle measurements are
> sent, never the footage.

---

## 2. Apple — App Privacy ("nutrition label")

App Store Connect → App Privacy. Answer exactly this:

**Data used to track you:** None.
**Data linked to you:**

| Category | Item | Purpose |
|---|---|---|
| Contact Info | Email Address | App Functionality |
| User Content | Other User Content — movement measurements, session titles, coach messages | App Functionality |
| Identifiers | User ID | App Functionality |

**Data not linked to you:**

| Category | Item | Purpose |
|---|---|---|
| Diagnostics | Crash Data, Performance Data | App Functionality |

**Do not declare:** Photos or Videos (the footage never leaves the device),
Location, Contacts, Health & Fitness, Sensitive Info, Browsing History,
Purchases (until billing ships), Advertising Data.

> **Health & Fitness is the one to get right.** The app measures movement, not
> health metrics — no heart rate, no steps, no workouts written to HealthKit,
> no HealthKit integration at all. Declaring it invites the health-app review
> track and the extra scrutiny that comes with it.

---

## 3. Google Play — Data safety

Play Console → App content → Data safety.

**Does your app collect or share any of the required user data types?** Yes.
**Is all of the user data collected encrypted in transit?** Yes.
**Do you provide a way for users to request that their data is deleted?** Yes —
in-app account deletion, plus an email route. Provide the deletion URL.

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Personal info → Email address | Yes | No | Required | Account management |
| Personal info → Name | Yes | No | Required | App functionality |
| App activity → Other user-generated content | Yes | No | Required | App functionality |
| App info & performance → Crash logs | Yes | No | Required | App functionality |
| App info & performance → Diagnostics | Yes | No | Required | App functionality |

**Do not declare:** Photos and videos, Location, Health and fitness, Financial
info, Contacts, Messages, Calendar.

> Play treats "shared" as *transferred to a third party*. Processors acting on
> your instructions — hosting, database, model provider, mail — are **not**
> sharing under Play's definition. They are still disclosed in the privacy
> policy, which is where they belong.

---

## 4. Health-adjacent review risk

The app displays injury-risk readings. That is the single most likely reason
for a rejection or a demand for extra documentation, and the mitigation is to
never imply diagnosis or prediction.

**What is already in the code and must stay:**

- The disclaimer under the flags on the analysis screen:
  *"These describe joint positions measured from your video. They are not a
  medical assessment or an injury prediction."*
- The model is instructed, in `NARRATIVE_SYSTEM`, to never state or imply a
  probability of future injury and never to diagnose.
- The chat coach is instructed to refer pain to a physiotherapist rather than
  advise on it.
- Power and speed read "not measured" rather than being fabricated.

**Language to avoid everywhere — app, store listing, screenshots, website:**

| Don't write | Write instead |
|---|---|
| "injury risk of 34%" | "this joint spent time outside its usual range" |
| "prevents injury" | "helps you see positions that put stress on a joint" |
| "diagnose" / "diagnosis" | "measure" / "reading" |
| "medical-grade" | (nothing — never claim this) |
| "treatment" / "rehab plan" | "drills" / "training suggestions" |
| "clinically proven" | (nothing, unless you have the trial) |

**If a reviewer asks whether this is a medical device:** it measures joint
angles from video and reports them. It does not diagnose, treat, cure, or
prevent disease, and it makes no claim to. That places it outside the FDA's
device definition and in the "general wellness" category — but if you ever add
a claim that it *detects* or *prevents* an injury, that stops being true.

---

## 5. Age rating

- **Apple:** 4+. No objectionable content. If you keep the AI coach — and you
  should — answer the "unrestricted web access" question as **No**; the chat is
  scoped to coaching and cannot browse.
- **Google Play:** complete the IARC questionnaire. Expect "Everyone".
- **Both:** the app is 13+ by Terms, not by rating. The rating describes
  content; the Terms set the contractual minimum age.

---

## 6. Sign in with Apple — Guideline 4.8

Added 2026-08-31. Google Sign-In is now offered, which makes **Sign in with
Apple mandatory** rather than optional: 4.8 requires an equivalent
privacy-preserving login option wherever a third-party one is offered, and
Apple's is the one that qualifies. Both are built — `docs/FEDERATED-SIGN-IN.md`.

The operational constraint: **ship Apple in the same release as Google, or
before it.** A build offering Google alone is a rejection. Concretely, set
`APPLE_CLIENT_IDS` on the server and enable the App ID capability *before*
setting `GOOGLE_CLIENT_IDS` — the app hides a provider's button when its client
ID is unset, so the order the two are configured in is the order they ship in.

4.8 also requires the option to limit data collection to name and email and to
let the user keep their address private. Sign in with Apple does both by design
(Private Relay), and the app stores only what Apple returns — see the
`identities` table. Note that this makes the **Data safety and App Privacy
answers in §2 and §3 still correct**: no new category is collected, and the
provider is a processor for authentication only.

---

## 7. Account deletion

Both stores require it, and it is **done** — `DELETE /profile/account`, wired to
Profile → Delete account.

Apple additionally requires the deletion path to be reachable *in the app*, not
only via a website. It is. Play requires a **publicly reachable web URL**
describing the process, even for in-app deletion — create that page and put it
in the Data safety form.

Re-authentication accepts a password **or** a fresh identity token from a linked
provider, because an account created through Apple or Google has no password —
without that, those users could not delete their account and the requirement
would be failed for exactly the users 4.8 asks you to support.

---

## 8. What's left, and why I couldn't do it

Each of these needs a logged-in account:

- [ ] **Host the privacy policy** at a public HTTPS URL. Content is written
      (`docs/PRIVACY-POLICY.md`) — fill the bracketed values and publish.
- [ ] **Host the terms** (`docs/TERMS-OF-SERVICE.md`), same treatment.
- [ ] **Create an account-deletion info page** for Play's Data safety form.
- [ ] **Fill the App Privacy questionnaire** using §2 above.
- [ ] **Fill the Data safety form** using §3 above.
- [ ] **Add both URLs** to App Store Connect, Play Console, and the app's
      Profile screen.
- [ ] **Screenshots and listing copy** — check them against the language table
      in §4 before uploading.
- [ ] **`icon-store.png`** into App Store Connect by hand (already generated).
