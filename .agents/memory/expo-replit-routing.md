---
name: Expo + Replit routing / preview
description: How Expo Go vs the Replit web preview are routed, and how to make the Replit root preview show the Expo app.
---

# Expo + Replit routing / preview

**Expo Go (dev) is independent of `previewPath`/`paths`/`BASE_PATH`.**
Expo Go connects via the separate `expo.` subdomain (`$REPLIT_EXPO_DEV_DOMAIN`), driven by
`router = "expo-domain"` in the artifact.toml plus `EXPO_PACKAGER_PROXY_URL=$REPLIT_EXPO_DEV_DOMAIN`
in the dev script. The main-domain path proxy (which serves the web build by `previewPath`) is a
different channel.
**How to apply:** You can change an Expo artifact's `previewPath`/`paths` (e.g. move it to root `/`)
without breaking Expo Go. Verify with `curl https://$REPLIT_EXPO_DEV_DOMAIN/status` → 200.

**`BASE_PATH` only affects the production build/serve scripts, not `expo start` (dev).**
`scripts/build.js` and `server/serve.js` read `BASE_PATH`; the dev flow does not.

**Expo dev web emits root-absolute asset paths, so it only renders at `/`.**
The dev web HTML references `/node_modules/...` and `/_expo/...` (absolute). Behind a sub-path
prefix like `/fourform-mobile/`, those asset requests 404 and the page renders BLANK (white).
**Why:** this is the #1 cause of "Expo web preview is blank" — it's a path-prefix mismatch, not a
broken RN-web render. **How to apply:** to show the Expo app in the Replit web preview, set the
Expo artifact `previewPath = "/"` (and `BASE_PATH = "/"`). Then the root domain renders the same
app as Expo Go via react-native-web (minus native-only screens — see below).

**Native-only components don't render on web.** `react-native-webview` has no web implementation
(e.g. an in-app video/skeleton player screen will break on web); `expo-blur` degrades to a plain
translucent view. The main tab screens render fine; only those specific screens differ from Expo Go.

**Removing an artifact:** delete its `artifacts/<slug>/` directory — the platform auto-deregisters
the artifact and its workflow. A stale `[[ports]]` entry may linger in root `.replit` (harmless;
the path proxy routes by `previewPath`, not by those entries).
