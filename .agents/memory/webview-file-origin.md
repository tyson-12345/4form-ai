---
name: WebView file:// origin fix
description: Why react-native-webview must load HTML from disk (not inline) when it needs to access local files + CDN
---

## The rule
Never use `source={{ html: string }}` in react-native-webview when the page needs to either:
- Load `file://` URIs (local video, images, assets)
- Make fetch/XHR requests to external CDNs (MediaPipe WASM, etc.)

Instead, write the HTML string to `FileSystem.cacheDirectory` with expo-file-system, then load with `source={{ uri: fileUri }}`.

**Why:** `source={{ html }}` causes WKWebView/WebView to load the page with a null/opaque origin. A null origin blocks CORS on CDN responses AND blocks file:// cross-origin resource loads, even when `allowFileAccess`, `allowFileAccessFromFileURLs`, and `allowUniversalAccessFromFileURLs` are all set to true on the WebView.

**How to apply:**
- Whenever a WebView page must reach the internet (CDN, API) or read local files
- Write HTML to `(FileSystem.cacheDirectory ?? '') + 'mypage.html'`  
- Load with `source={{ uri: localHtmlPath }}`
- Keep WebView props: `allowFileAccess`, `allowFileAccessFromFileURLs`, `allowUniversalAccessFromFileURLs`, `originWhitelist={["*", "file://*"]}`

This pattern is used in `artifacts/fourform-mobile/app/analysis/skeleton/[id].tsx` for the MediaPipe pose-tracking WebView.

## SDK 54 expo-file-system breaking change
In SDK 54, `expo-file-system` removed `writeAsStringAsync` and `EncodingType` from its main entrypoint. They throw at runtime (not just warn). Always import from `"expo-file-system/legacy"` when using the classic API (writeAsStringAsync, readAsStringAsync, EncodingType, cacheDirectory, etc.).
