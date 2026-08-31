# Sign in with Apple, and Google Sign-In

Built 2026-08-31. Email and password is unchanged and remains the primary
method; these are additional ways into the *same* account.

---

## What was built

| Piece | Where |
|---|---|
| Identity-token verification (JWKS, issuer, audience, expiry, nonce) | `api-server/src/lib/oauthProviders.ts` |
| Short-lived flow tokens for the two-step paths | `api-server/src/lib/oauthFlowTokens.ts` |
| The three endpoints | `api-server/src/routes/oauth.ts` |
| Shared password path (login + link challenge) | `api-server/src/lib/passwordAuth.ts` |
| `identities` table, nullable `users.password_hash` | migration `0008_social_identities.sql` |
| Provider flows on device | `lense-mobile/lib/socialAuth.ts` |
| Buttons | `lense-mobile/components/SocialSignIn.tsx` |
| The two continuation screens | `lense-mobile/app/auth/{complete-signup,link-account}.tsx` |

**No new backend dependency, and no Firebase.** `docs/FIREBASE-ASSESSMENT.md`
deferred this decision on the grounds that adopting Firebase Auth would replace
the lockout, progressive delay, timing equalisation, session revocation and hash
migration this codebase has invested most in. None of that was necessary:
verifying a provider's token is a JWKS fetch and a signature check, so the
server still issues its own JWT and every existing control applies unchanged.

---

## The flow

`POST /api/auth/oauth` is the single entry point, with three outcomes.

```
                    ┌─ 200  known identity ──────────► signed in
POST /auth/oauth ───┤
  provider          ├─ 428  verified, no account ────► /auth/oauth/complete
  identityToken     │       + registration token        (+ date of birth)
  nonce             │
  fullName?         └─ 409  address already taken ────► /auth/oauth/link
                            + link challenge             (+ that account's password)
```

### Why 409 is a challenge and not a silent link

Matching on email and attaching the identity is what most apps do, and it is an
account-takeover primitive whenever the match is wrong — a recycled domain, an
address a Workspace admin created, a provider asserting something it has not
verified. Asking for the password once converts the provider's *claim* into
something verified against what the real owner knows. It costs one screen, once.

### Why the birth date step exists

Neither provider returns a date of birth, and the age gate is a COPPA / GDPR
Art. 8 control that the server enforces (`safeBirthDate`). A federated signup
that skipped it would be the fastest way into the app, so it would become the
path an under-13 takes — the gate would still be drawn on the email screen while
nobody walked through it.

### Why an unverified provider email is refused outright

Linking on an unverified address is the takeover above. Registering on one
either collides with the `users.email` unique index or silently creates an
account under someone else's address. There is no safe third option, so the flow
stops and points the user at email and password. Near-unreachable in practice:
Apple always verifies, and so does Google for consumer accounts.

---

## The two security boundaries

**1. Flow tokens cannot authenticate.** A link challenge names the user it is a
challenge for and is handed to an unauthenticated caller. If it were also a
valid bearer token, triggering a collision would hand out a session for the
victim's account without the password the challenge exists to demand. Four
guards, asserted individually in `test/oauth-flow-token-isolation.test.ts`:

1. Signed with `HMAC(JWT_SECRET, "athleteai-oauth-flow-v1")`, so it does not
   verify under the session secret at all.
2. A different `issuer`, which `verifyToken` pins against.
3. A `purpose` claim, which `verifyToken` rejects outright.
4. The user id travels as `uid`, not `userId`, so it fails the session
   verifier's malformed-payload check even with the first three removed.

**2. The link endpoint is not a cheaper password oracle than login.** It shares
`lib/passwordAuth.ts` with `/auth/login` — same lockout counter, same
progressive delay, same timing equalisation, same response string — and has the
login endpoint's rate-limit budget. A second copy of that logic is how a rate
limit gets bypassed.

---

## Setup you have to do yourself

Neither can be finished from the repo: both need accounts and credentials that
only you can create, and both need a native build (Expo Go cannot do either).

### Apple

1. Apple Developer → Certificates, Identifiers & Profiles → Identifiers → the
   `com.athleteai.app` App ID → enable **Sign in with Apple**.
2. Set `APPLE_CLIENT_IDS=com.athleteai.app` on the API server.
3. `npx expo prebuild` then `npx expo run:ios` — `app.json` already sets
   `ios.usesAppleSignIn` and the `expo-apple-authentication` plugin.

Apple returns the user's **name only on the first authorization**, and their
email only then too. To re-test as a first-time user, revoke the app under
iOS Settings → your name → Sign in with Apple.

### Google

1. Google Cloud Console → APIs & Services → Credentials → create OAuth client
   IDs for **iOS**, **Android** (needs the signing certificate's SHA-1), and
   **Web**.
2. Set all three on the server as `GOOGLE_CLIENT_IDS=<ios>,<android>,<web>`, and
   on the app as `EXPO_PUBLIC_GOOGLE_{IOS,ANDROID,WEB}_CLIENT_ID`.
3. **Add the iOS reversed client ID as a URL scheme.** `expo-auth-session`
   redirects to `com.googleusercontent.apps.<id>:/oauthredirect`, which does not
   reach the app without it. In `app.json` → `expo.ios.infoPlist`:

   ```json
   "CFBundleURLTypes": [
     { "CFBundleURLSchemes": ["com.googleusercontent.apps.YOUR-IOS-CLIENT-ID"] }
   ]
   ```

   This is the step people miss; the symptom is a sign-in that completes in the
   browser and then never returns to the app.

### Store requirement

App Store Review Guideline 4.8 requires Sign in with Apple wherever another
third-party sign-in is offered. **Ship Apple in the same release as Google, or
before it** — Google alone is a rejection.

---

## What is not covered

- **Not verified end to end.** Everything above typechecks, and the server logic
  is unit tested, but no real Apple or Google token has been through it: that
  needs the credentials in the previous section. The first native build is the
  first real test.
- **The nonce is client-chosen.** It binds a token to *this* sign-in attempt, so
  a token captured from an earlier one is refused. It does not stop the holder
  of a token from using their own. The audience check is what carries the weight
  against cross-app replay; a server-issued nonce would close the rest, at the
  cost of per-attempt server state.
- **Email is still unconfigured.** `RESEND_API_KEY` and `MAIL_FROM` remain
  unset, so password reset still cannot complete — see `docs/SECURITY.md` →
  Known limitations. Federated sign-in does not change that, and it does not
  substitute for it: a password account whose owner forgets the password still
  has no way back in.
- **No account-settings UI for identities.** You can link a provider during
  sign-in, but there is no screen listing linked providers or unlinking one. The
  data model supports it (`identities`, one row per provider per user).
- **Passkeys** are not built. Deliberately: they are neither a compliance nor a
  conversion forcing function yet, and Apple plus Google covers both.

---

## Account deletion

`DELETE /api/profile/account` now accepts either a password *or* a fresh
identity token from a linked provider, because a federated-only account has no
password and both stores require in-app deletion to be possible. The identity
token is not enough on its own — it must belong to an identity already linked to
*that* account, or any valid Apple token would delete any account whose session
the caller held.
