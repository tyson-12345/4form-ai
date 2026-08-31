/**
 * The "or continue with" block on the sign-in and sign-up screens.
 *
 * ── Why this is not in components/caliper ───────────────────────────────────
 * Caliper holds primitives — things three unrelated screens compose from. This
 * is one feature's control, used by two screens that are really the same
 * screen, and it carries provider branding rules that have nothing to do with
 * the design system. Putting it in the barrel would present it as a system
 * choice when it is a feature choice.
 *
 * ── Why neither button is cobalt ────────────────────────────────────────────
 * Cobalt marks the single next action on a screen, and on both screens that is
 * already spoken for by "Sign in" / "Create account". A second cobalt control
 * here would make the screen ask two questions at once. These are alternates,
 * so they read as alternates: ink for Apple, a ruled paper surface for Google —
 * which is also what each provider's own brand guidance asks for.
 */

import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { Tappable, Text } from "@/components/caliper";
import { color, type as T, radius } from "@/constants/caliper";
import {
  isAppleAuthAvailable,
  isGoogleAuthConfigured,
  signInWithApple,
  useGoogleAuth,
  SocialAuthCancelled,
  type SocialCredential,
} from "@/lib/socialAuth";

interface Props {
  /**
   * Called with a completed provider credential. The caller decides what
   * happens next — the three outcomes differ per screen.
   */
  onCredential: (credential: SocialCredential) => void | Promise<void>;
  /** Something the caller is doing with a credential we already handed it. */
  busy?: boolean;
  /** Surfaced by the caller in its own error slot, so there is one per screen. */
  onError: (message: string) => void;
  /** Cleared by the caller when a provider flow starts. */
  onStart?: () => void;
}

export function SocialSignIn({ onCredential, busy = false, onError, onStart }: Props) {
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [pending, setPending] = useState<"apple" | "google" | null>(null);
  const google = useGoogleAuth();
  const googleAvailable = isGoogleAuthConfigured();

  useEffect(() => {
    let cancelled = false;
    isAppleAuthAvailable().then((ok) => {
      if (!cancelled) setAppleAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to offer on this platform or in this build: draw nothing at all
  // rather than an empty divider promising options that do not exist.
  if (!appleAvailable && !googleAvailable) return null;

  const blocked = busy || pending !== null;

  async function run(provider: "apple" | "google", flow: () => Promise<SocialCredential>) {
    if (blocked) return;
    onStart?.();
    setPending(provider);
    try {
      await onCredential(await flow());
    } catch (err) {
      // Backing out of the provider sheet is not a failure — it is the cancel
      // button working. Telling someone off for using it would be a bug.
      if (!(err instanceof SocialAuthCancelled)) {
        onError(
          err instanceof Error && err.message
            ? err.message
            : "That sign-in didn't complete. Please try again.",
        );
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <View>
      {/* `aria-hidden`, not the platform-specific pair: React Native maps it to
          accessibilityElementsHidden on iOS and importantForAccessibility on
          Android, and to the real attribute on web. The platform props are
          native-only and React Web passes them straight through to the DOM,
          where they are not valid attributes and log an error on every render. */}
      <View style={s.divider} aria-hidden>
        <View style={s.rule} />
        <Text style={T.label}>OR</Text>
        <View style={s.rule} />
      </View>

      {appleAvailable && (
        <Tappable
          onPress={() => run("apple", signInWithApple)}
          disabled={blocked}
          haptic="commit"
          accessibilityLabel="Continue with Apple"
          accessibilityState={{ disabled: blocked, busy: pending === "apple" }}
          style={[s.button, { backgroundColor: color.ink }]}
        >
          {pending === "apple" ? (
            <ActivityIndicator size="small" color={color.onInk} />
          ) : (
            <AppleMark tone={color.onInk} />
          )}
          <Text style={[T.button, { color: color.onInk }]}>Continue with Apple</Text>
        </Tappable>
      )}

      {googleAvailable && (
        <Tappable
          onPress={() => run("google", google.signIn)}
          disabled={blocked || !google.ready}
          haptic="commit"
          accessibilityLabel="Continue with Google"
          accessibilityState={{ disabled: blocked || !google.ready, busy: pending === "google" }}
          style={[s.button, s.googleButton, appleAvailable && { marginTop: 12 }]}
        >
          {pending === "google" ? (
            <ActivityIndicator size="small" color={color.textPrimary} />
          ) : (
            <GoogleMark />
          )}
          <Text style={[T.button, { color: color.textPrimary }]}>Continue with Google</Text>
        </Tappable>
      )}
    </View>
  );
}

// ─── Provider marks ──────────────────────────────────────────────────────────

/**
 * Both providers require their own mark on the button and forbid a substitute,
 * so these are drawn rather than picked from the app's icon set. They are inert
 * artwork: hidden from the accessibility tree, because the button beside them
 * already says what it does and a screen reader announcing "Apple logo,
 * Continue with Apple" says it twice.
 */
function AppleMark({ tone }: { tone: string }) {
  return (
    <Svg width={17} height={20} viewBox="0 0 17 20" aria-hidden>
      <Path
        fill={tone}
        d="M14.02 10.61c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.18-1.72-1.35-.14-2.64.8-3.33.8-.69 0-1.75-.78-2.87-.76-1.48.02-2.84.86-3.6 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.25 2.74 2.2 1.1-.04 1.51-.71 2.84-.71 1.33 0 1.7.71 2.86.69 1.18-.02 1.93-1.08 2.65-2.14.83-1.23 1.18-2.42 1.2-2.48-.03-.01-2.3-.88-2.32-3.51zM11.85 3.9c.6-.74 1.01-1.75.9-2.77-.87.04-1.93.58-2.56 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.58-1.22z"
      />
    </Svg>
  );
}

function GoogleMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48" aria-hidden>
      <Path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <Path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <Path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z" />
      <Path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </Svg>
  );
}

const s = StyleSheet.create({
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 26,
    marginBottom: 20,
  },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.rule },
  button: {
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  googleButton: {
    backgroundColor: color.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.ruleStrong,
  },
});

/** Re-exported so screens do not need a second import for the credential type. */
export type { SocialCredential };
