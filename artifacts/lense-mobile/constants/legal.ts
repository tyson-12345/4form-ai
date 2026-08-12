/**
 * Where the legal documents live, and the standard way to open them.
 *
 * One module rather than URLs inlined at each call site: these appear at signup,
 * in Profile, and in the store listings, and a stale copy in one place is the
 * kind of thing nobody notices until it matters.
 *
 * ── Before launch ───────────────────────────────────────────────────────────
 * Both URLs must resolve to publicly reachable HTTPS pages. Apple and Google
 * check them during review, and a 404 is a rejection. The document text is
 * written and ready to publish:
 *
 *   docs/PRIVACY-POLICY.md    → PRIVACY_POLICY_URL
 *   docs/TERMS-OF-SERVICE.md  → TERMS_URL
 *
 * Override per-environment with EXPO_PUBLIC_LEGAL_BASE_URL if the docs are
 * hosted somewhere other than the marketing site.
 */

import { Linking, Alert } from "react-native";

const BASE = (process.env.EXPO_PUBLIC_LEGAL_BASE_URL ?? "https://athleteai.app").replace(
  /\/+$/,
  "",
);

export const PRIVACY_POLICY_URL = `${BASE}/privacy`;
export const TERMS_URL = `${BASE}/terms`;
export const SUPPORT_EMAIL = "support@athleteai.app";

/**
 * Open a legal document in the system browser.
 *
 * Failure is surfaced rather than swallowed: silently doing nothing when a user
 * taps "Privacy Policy" is indistinguishable from a broken app, and these are
 * exactly the links a reviewer will tap.
 */
export async function openLegal(url: string, label: string): Promise<void> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error("unsupported");
    await Linking.openURL(url);
  } catch {
    Alert.alert(
      `Couldn't open ${label}`,
      `Please visit ${url} in your browser.`,
      [{ text: "OK" }],
    );
  }
}
