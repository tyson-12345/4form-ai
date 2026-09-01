# Running the mobile app

Two ways, and which one you can use depends on what you need to test.

---

## ⚠️ The repository path must not contain spaces

**This is not a preference. The iOS build fails outright.**

The project lived at `~/ai exercise coach/` until 2026-08-12 and the build could
not complete. The failure surfaces as a CocoaPods script phase dying with:

```
bash: /Users/tysonyoum/ai: No such file or directory
```

**Why.** `expo-constants` installs a build phase that runs:

```sh
bash -l -c "$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh"
```

`$PODS_TARGET_SRCROOT` expands in the *outer* shell, and the result is then
handed to a second shell as a single string — which re-splits it on whitespace.
A path containing spaces is torn apart at the space. The quoting is wrong in the
upstream script, so there is nothing to fix on our side.

The directory is now `~/ACTIVE/ai-exercise-coach/`. **If you clone this fresh, put it
somewhere without spaces**, or you will lose an hour to a failure that looks
like a missing file.

After moving an existing checkout, the old absolute paths are baked into the
build output — clear them:

```bash
cd artifacts/fourform-mobile
rm -rf ios/build ios/Pods ios/Podfile.lock
cd ios && pod install
```

---

## Option 1 — Expo Go (fast, limited)

```bash
pnpm --filter @workspace/fourform-mobile run dev
```

Scan the QR code with Expo Go. Starts in seconds, reloads on save.

**What does not work here:** anything needing a native module Expo Go does not
bundle. That is why `react-native-keyboard-controller` was removed — its
presence in the root layout broke the app in Expo Go entirely. It is also why
`@sentry/react-native` has not been added: it would break Expo Go the same way.

Good for UI work. Not good for anything touching native capability.

---

## Option 2 — Native simulator build (slow, complete)

Needed for native modules, and for anything you want to behave like a real
build.

```bash
cd artifacts/fourform-mobile
pnpm exec expo prebuild --platform ios --no-install   # generates ios/
cd ios && pod install
xcodebuild -workspace 4FormAI.xcworkspace -scheme 4FormAI \
  -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=<UDID>' \
  -derivedDataPath ./build build
```

Get a UDID with `xcrun simctl list devices available`. Boot it with
`xcrun simctl boot <UDID>`.

Then install and launch:

```bash
xcrun simctl install <UDID> ios/build/Build/Products/Debug-iphonesimulator/4FormAI.app
xcrun simctl launch <UDID> com.fourformai.app
```

**Budget 30–45 minutes for the first build.** It compiles Hermes and ~105 pods
from source. Later builds are incremental and much faster.

`ios/` is gitignored — it is generated output (~1.8GB) and regenerating it is a
single command.

---

## Pointing the app at a backend

`EXPO_PUBLIC_API_URL` decides which API the app talks to.

| Target | Value |
|---|---|
| Production (default in `eas.json`) | `https://athleteai-production-0b7f.up.railway.app` |
| Local API | your machine's LAN IP, **not** `localhost` — a simulator resolves that to itself |

Release builds refuse a plain-`http://` origin (`lib/api.ts`). Every request
carries the bearer token, so a cleartext origin would put the whole session on
the wire. `__DEV__` builds are exempt because local dev servers are http.

---

## What to check when it launches

The first screen is the landing/auth flow. A quick pass that exercises the parts
most likely to be broken:

1. **Sign up** — the date-of-birth field is the age gate. A date under 13 is
   refused by the server, not just the form.
2. **Terms and Privacy links** at signup — these currently say "isn't published
   yet" rather than opening anything. They stay inert until
   `EXPO_PUBLIC_LEGAL_BASE_URL` is set — now that `4formai.com` exists, publish
   the documents and set it. They used to point at `athleteai.app`, a domain
   someone else owns.
3. **Profile → Support** — same, deliberately inert until configured.
4. **Analyze tab** — picking a clip needs photo-library permission. The
   simulator has no photos by default; drag an image or video onto the simulator
   window to seed the library.
5. **Pricing** — Elite must show "IN DEVELOPMENT" with no price, and Pro must
   show "Coming soon" rather than a working buy button.
