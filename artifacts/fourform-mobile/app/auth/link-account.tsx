/**
 * Challenge-on-collision: the screen where a provider sign-in meets an address
 * that already has an account.
 *
 * The user proves the existing account's password once. From then on either
 * credential opens the account and this screen is never seen again.
 *
 * ── Why the app asks at all ─────────────────────────────────────────────────
 * Every other option is worse. Linking silently on a matching email would mean
 * that anyone who can get a provider to assert an address — a recycled domain,
 * an unverified Workspace account — inherits the account behind it. Refusing
 * outright would strand the real owner with two accounts and no way to merge
 * them. One password, once, is the smallest thing that distinguishes the owner
 * from a coincidence.
 */

import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { BackButton, Label, PrimaryButton, Screen, Tappable, Text, TextField } from "@/components/caliper";
import { color, type as T, GUTTER, font } from "@/constants/caliper";
import { useAuth } from "@/lib/authContext";
import { ApiError, NetworkError } from "@/lib/api";
import { takeOAuth, type PendingLink } from "@/lib/oauthHandoff";
import * as haptics from "@/lib/haptics";

export default function LinkAccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { linkOAuthIdentity } = useAuth();

  // Read once, on mount. `takeOAuth` clears the slot, so re-reading on every
  // render would find nothing the second time and bounce a working screen.
  const [pending] = useState<PendingLink | null>(() => takeOAuth("link"));

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);

  useEffect(() => {
    // No challenge — a refresh on web, or someone who navigated here directly.
    // There is nothing to finish, so send them back to the start rather than
    // showing a form that cannot succeed.
    if (!pending) router.replace("/auth/login");
  }, [pending, router]);

  if (!pending) return null;

  const canSubmit = password.length > 0 && !busy;

  async function submit() {
    if (!canSubmit || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError(null);
    try {
      await linkOAuthIdentity(pending!.token, password);
      haptics.success();
      router.replace("/");
    } catch (err) {
      haptics.fail();
      // The server answers a wrong password here exactly as it answers one on
      // the sign-in screen — same string, same timing. Show it verbatim.
      setError(
        err instanceof NetworkError || err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
      // The challenge is single-use only on success; a wrong password may be
      // retried until it expires, so the guard is released here and not above.
      submitted.current = false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.head, { paddingTop: insets.top + 14 }]}>
          <BackButton onPress={() => router.replace("/auth/login")} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Label>ONE LAST STEP</Label>
          <Text scale="display" style={[T.headline, { marginTop: 10 }]}>
            Connect your{"\n"}account.
          </Text>

          <Text style={[T.body, { marginTop: 16, color: color.textBody }]}>
            {pending.email} already has a 4Form AI account. Enter its password once and
            we&apos;ll connect the two — after this you can sign in either way.
          </Text>

          <TextField
            label="Password"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setError(null);
            }}
            placeholder="Your password"
            secure
            autoCapitalize="none"
            autoComplete="current-password"
            autoFocus
            returnKeyType="go"
            onSubmitEditing={submit}
            containerStyle={{ marginTop: 28 }}
          />

          {!!error && (
            <Text style={s.error} accessibilityLiveRegion="assertive" accessibilityRole="alert">
              {error}
            </Text>
          )}

          <View style={{ marginTop: 28 }}>
            <PrimaryButton label="Connect accounts" loading={busy} onPress={submit} disabled={!canSubmit} />
          </View>

          {/* The way out for someone who does not know the password. A reset
              works normally here: it proves the same mailbox this sign-in was
              already asserting, so it reaches the same account. */}
          <Tappable
            onPress={() => router.replace("/auth/forgot-password")}
            accessibilityRole="link"
            accessibilityLabel="Forgot your password?"
            style={{ marginTop: 12, alignItems: "center", justifyContent: "center", minHeight: 44 }}
          >
            <Text style={[T.buttonSmall, { color: color.cobalt }]}>Forgot your password?</Text>
          </Tappable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: GUTTER, paddingBottom: 10 },
  error: {
    marginTop: 14,
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.rust,
  },
});
