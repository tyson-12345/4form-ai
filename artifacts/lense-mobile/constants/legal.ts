/**
 * Where the legal documents live, and the standard way to open them.
 *
 * One module rather than URLs inlined at each call site: these appear at signup,
 * in Profile, and in the store listings, and a stale copy in one place is the
 * kind of thing nobody notices until it matters.
 *
 * ── Why there is no default domain ──────────────────────────────────────────
 * This used to fall back to `https://athleteai.app`. On 2026-08-12 that domain
 * turned out to belong to **someone else** — it is registered at Porkbun with
 * Google Workspace mail already on it. So the app was linking users to a
 * stranger's site for its privacy policy, and offering a "Support" button that
 * opened a mail composer addressed to a stranger's mailbox.
 *
 * A default that is silently wrong is worse than no default: it looks configured
 * and behaves incorrectly. Everything below is now unset until someone sets it,
 * and the UI says so plainly rather than opening the wrong thing.
 *
 * ── Before launch ───────────────────────────────────────────────────────────
 * Set `EXPO_PUBLIC_LEGAL_BASE_URL` and `EXPO_PUBLIC_SUPPORT_EMAIL` to a domain
 * you actually control. Both stores check the privacy URL during review, and a
 * 404 — or a page belonging to someone else — is a rejection.
 *
 * The document text is written and ready to publish:
 *   docs/PRIVACY-POLICY.md    → <base>/privacy
 *   docs/TERMS-OF-SERVICE.md  → <base>/terms
 */

import { Linking, Alert } from "react-native";

const RAW_BASE = process.env.EXPO_PUBLIC_LEGAL_BASE_URL?.trim();

/** Null until a domain is configured. Never guesses. */
export const LEGAL_BASE_URL: string | null = RAW_BASE
  ? RAW_BASE.replace(/\/+$/, "")
  : null;

export const PRIVACY_POLICY_URL: string | null = LEGAL_BASE_URL
  ? `${LEGAL_BASE_URL}/privacy`
  : null;

export const TERMS_URL: string | null = LEGAL_BASE_URL
  ? `${LEGAL_BASE_URL}/terms`
  : null;

/** Null until configured, for the same reason. */
export const SUPPORT_EMAIL: string | null =
  process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || null;

/** True when the legal URLs are ready for a store submission. */
export function legalLinksConfigured(): boolean {
  return LEGAL_BASE_URL !== null;
}

/**
 * Open a legal document in the system browser.
 *
 * Three outcomes, and none of them is "open something misleading":
 *  - configured and openable → opens
 *  - not configured          → says so, rather than following a wrong link
 *  - configured but fails    → shows the URL so the user can reach it manually
 */
export async function openLegal(
  url: string | null,
  label: string,
): Promise<void> {
  if (!url) {
    Alert.alert(
      `${label} isn't published yet`,
      `We're getting ${label.toLowerCase()} online. Until then, contact us and we'll send it to you directly.`,
      [{ text: "OK" }],
    );
    return;
  }

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

/** Open a support mail composer, or explain that support isn't set up yet. */
export async function openSupport(): Promise<void> {
  if (!SUPPORT_EMAIL) {
    Alert.alert(
      "Support isn't set up yet",
      "We don't have a support address configured. Please try again after the next update.",
      [{ text: "OK" }],
    );
    return;
  }
  await Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {
    Alert.alert("Couldn't open mail", `Write to ${SUPPORT_EMAIL}.`, [{ text: "OK" }]);
  });
}
