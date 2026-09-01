/**
 * Native Apple and Google sign-in, reduced to one shape the rest of the app
 * can hold: a provider name, an identity token, and the nonce that token is
 * bound to.
 *
 * Nothing here decides anything. The token is a sealed claim from Apple or
 * Google that only the server can open — the client cannot check the signature,
 * the audience, or the expiry, and must not pretend to. Its whole job is to
 * obtain the token and hand it over.
 *
 * ── The nonce ───────────────────────────────────────────────────────────────
 * We generate a random value per attempt and send it two ways: to the provider,
 * which binds it into the token it mints, and to our server, which checks the
 * token carries it. A token captured from an earlier attempt therefore no
 * longer matches.
 *
 * The two providers bind it differently and the server knows which is which:
 * Apple hashes it (the token carries SHA-256 of what we sent), Google echoes it
 * verbatim. Sending the *raw* value in both cases is deliberate — the server
 * applies the right encoding, so this file never has to.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";

// Lets the Google flow close its browser tab and hand control back to the app.
WebBrowser.maybeCompleteAuthSession();

export type SocialProvider = "apple" | "google";

/** Everything the server needs from a completed provider sign-in. */
export interface SocialCredential {
  provider: SocialProvider;
  identityToken: string;
  /**
   * Omitted when the provider flow did not produce one. The server then skips
   * the nonce check rather than failing — sending an empty string instead would
   * be rejected by its schema and break every sign-in.
   */
  nonce?: string;
  /**
   * Display name, when the provider gave us one.
   *
   * Apple returns this to the device on the user's *first* authorization only,
   * and never again — not on any later sign-in and not in the token. If the
   * account is not created on that first pass the name is simply gone, which is
   * why it is threaded all the way through to account creation rather than
   * being fetched later.
   */
  fullName?: string;
}

/**
 * The user backed out. Not an error: it is the ordinary outcome of tapping the
 * button and changing your mind, and showing an error message for it would be
 * telling someone off for using the cancel button.
 */
export class SocialAuthCancelled extends Error {
  constructor() {
    super("Sign-in cancelled");
    this.name = "SocialAuthCancelled";
  }
}

/** The provider flow failed for a reason worth showing. */
export class SocialAuthFailed extends Error {
  constructor(message = "That sign-in didn't complete. Please try again.") {
    super(message);
    this.name = "SocialAuthFailed";
  }
}

/** 32 URL-safe bytes. Matches the server's `^[A-Za-z0-9_-]{16,256}$`. */
function makeNonce(): string {
  const bytes = Crypto.getRandomBytes(32);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─── Apple ───────────────────────────────────────────────────────────────────

/**
 * Whether the Sign in with Apple button should be drawn at all.
 *
 * iOS only, and only where the OS supports it. Drawing an Apple button on
 * Android is a button that cannot work.
 */
export async function isAppleAuthAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function signInWithApple(): Promise<SocialCredential> {
  const nonce = makeNonce();

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      // Apple hashes this before putting it in the token. We send the raw value
      // to our server, which hashes it the same way to compare.
      nonce,
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ERR_REQUEST_CANCELED"
    ) {
      throw new SocialAuthCancelled();
    }
    throw new SocialAuthFailed();
  }

  if (!credential.identityToken) {
    // Apple returned without the one thing the flow exists to produce.
    throw new SocialAuthFailed();
  }

  const given = credential.fullName?.givenName ?? "";
  const family = credential.fullName?.familyName ?? "";
  const fullName = `${given} ${family}`.trim();

  return {
    provider: "apple",
    identityToken: credential.identityToken,
    nonce,
    ...(fullName ? { fullName } : {}),
  };
}

// ─── Google ──────────────────────────────────────────────────────────────────

/**
 * Client IDs, from the environment, falling back to `app.json` →
 * `expo.extra.google`.
 *
 * Google issues a separate client ID per platform and rejects a request that
 * uses the wrong one, so all three are configured and the SDK picks.
 *
 * These are public identifiers, not secrets — they appear in the authorization
 * URL of every sign-in — so committing them is fine and `EXPO_PUBLIC_` inlining
 * them into the bundle is fine. The environment is the primary source only
 * because it lets a build be pointed at a different Google project without
 * editing a checked-in file.
 */
interface GoogleConfig {
  iosClientId?: string;
  androidClientId?: string;
  webClientId?: string;
}

function googleConfig(): GoogleConfig {
  const extra = (Constants.expoConfig?.extra?.google ?? {}) as GoogleConfig;
  // `||` not `??`: an empty string in app.json is a placeholder, not a value.
  return {
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || extra.iosClientId || undefined,
    androidClientId:
      process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || extra.androidClientId || undefined,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || extra.webClientId || undefined,
  };
}

/**
 * True when this build has a client ID for the platform it is running on.
 *
 * Checked before the button is drawn. A "Continue with Google" button in a
 * build with no client ID fails *after* the user has been through Google's
 * whole consent screen, which reads as a broken app rather than a missing
 * setting.
 */
export function isGoogleAuthConfigured(): boolean {
  const config = googleConfig();
  if (Platform.OS === "ios") return Boolean(config.iosClientId);
  if (Platform.OS === "android") return Boolean(config.androidClientId);
  return Boolean(config.webClientId);
}

/**
 * The Google flow, as a hook.
 *
 * It has to be one: `expo-auth-session` needs the request object built during
 * render so it can be resumed when the browser hands control back, which a
 * plain async function cannot do.
 *
 * Returns `promptAsync`, which resolves to a credential, or throws
 * `SocialAuthCancelled` when the user dismisses the sheet.
 */
export function useGoogleAuth(): {
  ready: boolean;
  signIn: () => Promise<SocialCredential>;
} {
  const config = googleConfig();
  const [request, , promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: config.iosClientId,
    androidClientId: config.androidClientId,
    webClientId: config.webClientId,
  });

  async function signIn(): Promise<SocialCredential> {
    if (!request) throw new SocialAuthFailed();

    const result = await promptAsync();

    if (result.type === "cancel" || result.type === "dismiss") {
      throw new SocialAuthCancelled();
    }
    if (result.type !== "success") {
      throw new SocialAuthFailed();
    }

    const identityToken = result.params?.id_token;
    if (!identityToken) throw new SocialAuthFailed();

    /**
     * The nonce `expo-auth-session` generated for this request, which it put in
     * the authorization URL and which Google therefore echoed into the token.
     *
     * Read from the request rather than generated here: generating our own and
     * failing to get it into the URL would mean sending the server a nonce the
     * token does not carry, and every Google sign-in would be rejected. If the
     * library did not set one, we send none and the server skips that check —
     * the audience check, which is the one that stops cross-app token replay,
     * is unaffected either way.
     */
    const nonce = request.nonce;

    return { provider: "google", identityToken, ...(nonce ? { nonce } : {}) };
  }

  return { ready: Boolean(request), signIn };
}
