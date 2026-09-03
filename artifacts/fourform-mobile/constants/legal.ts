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
 * and behaves incorrectly. Nothing here invents a domain, and the UI says so
 * plainly rather than opening the wrong thing.
 *
 * ── Why the API origin is nonetheless allowed to answer ─────────────────────
 * There is exactly one host this build already demonstrably belongs to: the API
 * it talks to. `EXPO_PUBLIC_API_URL` must be set for the app to function at
 * all, and the API server serves both documents itself, at `<origin>/privacy`
 * and `<origin>/terms` (api-server routes/legalPages.ts). Pointing the legal
 * rows at that origin is therefore not the athleteai.app mistake repeated — it
 * is not a guess about who owns a domain, it is the domain whose server is
 * already holding this app's sessions and this app's data.
 *
 * That derivation is guarded, and each guard is there for a reason:
 *
 *  1. An explicit `EXPO_PUBLIC_LEGAL_BASE_URL` always wins. A marketing domain
 *     is normally where these documents live for a reader, and the API origin
 *     is the fallback, not the preference.
 *
 *  2. Only a public `https://` origin is derived from. `lib/api.ts`'s
 *     `resolveApiUrl` accepts `http://localhost:3000` and `http://192.168.1.x`
 *     as ordinary dev values — it only rejects cleartext in release builds —
 *     so the API variable is very often a laptop. A LAN address in a store
 *     listing is not a broken link, it is a link that resolves to whatever
 *     device happens to hold that address on the reviewer's network, and it is
 *     unreachable from anywhere else. Nothing that could be a dev machine is
 *     allowed to become a published URL.
 *
 *  3. The value must be a bare origin with no path. `resolveApiUrl` treats
 *     `EXPO_PUBLIC_API_URL` as an origin and appends `/api` to it; the legal
 *     pages sit at the root, not under `/api`. Anything carrying a path is a
 *     value we do not understand, and the correct response to that is to
 *     derive nothing.
 *
 *  4. `legalLinksConfigured()` keeps reporting the derived truth. A dev build
 *     with only a localhost API still answers false, so nothing claims a link
 *     that would 404 in review.
 *
 * ── Before launch ───────────────────────────────────────────────────────────
 * Set `EXPO_PUBLIC_SUPPORT_EMAIL`, and set `EXPO_PUBLIC_LEGAL_BASE_URL` if the
 * documents should be read somewhere other than the API's own origin. Both
 * stores check the privacy URL during review, and a 404 — or a page belonging
 * to someone else — is a rejection.
 *
 * The document text is written and ready to publish:
 *   docs/PRIVACY-POLICY.md    → <base>/privacy
 *   docs/TERMS-OF-SERVICE.md  → <base>/terms
 */

import { Linking } from "react-native";

// The cross-platform wrapper, not react-native's Alert. react-native-web's
// Alert is a silent no-op, so on the browser build every one of the four
// dialogs below did nothing at all — no message, no error, no clue. That is the
// same defect that once shipped a dead Sign out button, and it was still live
// on the three controls both app stores check during review: Privacy Policy,
// Terms of Service and Support.
import { alert } from "@/lib/alert";

/**
 * An origin we are willing to publish a link to without having been told to.
 *
 * Read it as four separate refusals rather than one pattern:
 *
 *  - `https:` only. `http://` is a dev value here by construction — release
 *    builds already throw on a cleartext API origin (lib/api.ts) — so an
 *    `http` origin can only mean a laptop or a tunnel, never a store listing.
 *  - Not `.local` or `.localhost`, which are names for "this network".
 *  - A dotted name whose last label is alphabetic, which excludes bare
 *    `localhost` (no dot) and every IPv4 literal (`…1.10` ends in digits).
 *    The dev values `resolveApiUrl` is documented to accept are exactly these.
 *  - No port and no path. A public API on a non-standard port is the failure
 *    `lib/api.ts`'s header describes at length, and a path means the variable
 *    is not the origin this code assumes it is. Either way: derive nothing and
 *    say so, rather than compose a URL out of a value we did not understand.
 *
 * Deliberately no `g` flag — a global regex carries `lastIndex` between calls
 * and would start answering false on alternate invocations.
 */
const PUBLIC_HTTPS_ORIGIN =
  /^https:\/\/(?!.*\.local(?:host)?$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * The legal base, from an explicit setting or else from the API origin.
 *
 * Exported as a pure function of its two inputs so the guards above can be
 * tested without a build's environment: the module-level constants below are
 * fixed at import time, which makes them impossible to exercise for anything
 * but the one configuration the test runner happened to start with.
 *
 * Returns null when neither source yields something publishable — which is a
 * result, not a failure, and every caller already handles it.
 */
export function resolveLegalBaseUrl(
  explicitBase: string | undefined,
  apiUrl: string | undefined,
): string | null {
  // Trailing slashes are stripped from both sources: `<base>/privacy` is built
  // by concatenation below, and `https://host//privacy` is a different path on
  // some servers and an ugly one on all of them.
  const explicit = explicitBase?.trim().replace(/\/+$/, "");
  // Whatever was set explicitly is honoured as-is, without the origin check.
  // Someone who names a host on purpose has said which host they mean; that is
  // the case the athleteai.app incident was about, and it is not this code's
  // place to second-guess it.
  if (explicit) return explicit;

  const apiOrigin = apiUrl?.trim().replace(/\/+$/, "");
  if (apiOrigin && PUBLIC_HTTPS_ORIGIN.test(apiOrigin)) return apiOrigin;

  return null;
}

/** Null until a domain is configured or derivable. Never guesses one. */
export const LEGAL_BASE_URL: string | null = resolveLegalBaseUrl(
  process.env.EXPO_PUBLIC_LEGAL_BASE_URL,
  process.env.EXPO_PUBLIC_API_URL,
);

export const PRIVACY_POLICY_URL: string | null = LEGAL_BASE_URL
  ? `${LEGAL_BASE_URL}/privacy`
  : null;

export const TERMS_URL: string | null = LEGAL_BASE_URL
  ? `${LEGAL_BASE_URL}/terms`
  : null;

/** Null until configured, for the same reason. */
export const SUPPORT_EMAIL: string | null =
  process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || null;

/**
 * True when the legal URLs are ready for a store submission.
 *
 * Reads the resolved value rather than the environment, so a build whose only
 * API origin is a laptop reports false — the same answer it gave before the
 * derivation existed, and the honest one: those links would 404 in review.
 */
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
    alert(
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
    alert(
      `Couldn't open ${label}`,
      `Please visit ${url} in your browser.`,
      [{ text: "OK" }],
    );
  }
}

/** Open a support mail composer, or explain that support isn't set up yet. */
export async function openSupport(): Promise<void> {
  if (!SUPPORT_EMAIL) {
    alert(
      "Support isn't set up yet",
      "We don't have a support address configured. Please try again after the next update.",
      [{ text: "OK" }],
    );
    return;
  }
  await Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {
    alert("Couldn't open mail", `Write to ${SUPPORT_EMAIL}.`, [{ text: "OK" }]);
  });
}
