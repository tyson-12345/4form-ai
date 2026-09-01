import React, { useRef, useState } from "react";
import { View, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import {
  BackButton,
  Label,
  PrimaryButton,
  Screen,
  Tappable,
  Text,
  TextField,
} from "@/components/caliper";
import { color, type as T, GUTTER, font } from "@/constants/caliper";
import { useAuth } from "@/lib/authContext";
import { ApiError, NetworkError } from "@/lib/api";
import { SocialSignIn } from "@/components/SocialSignIn";
import { useSocialSignIn } from "@/lib/useSocialSignIn";
import * as haptics from "@/lib/haptics";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login } = useAuth();
  const handleSocialCredential = useSocialSignIn();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordRef = useRef<TextInput>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      haptics.success();
      router.replace("/");
    } catch (err) {
      // The server returns one message for every credential failure — unknown
      // email, wrong password, locked account. Surface it verbatim; adding our
      // own detail here would undo that.
      haptics.fail();
      setError(
        err instanceof NetworkError
          ? err.message
          : err instanceof ApiError
            ? err.message
            : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[s.head, { paddingTop: insets.top + 14 }]}>
          <BackButton onPress={() => router.back()} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Label>WELCOME BACK</Label>
          <Text scale="display" style={[T.headline, { marginTop: 10 }]}>Sign in.</Text>

          <TextField
            label="Email"
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
            }}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            containerStyle={{ marginTop: 34 }}
          />

          <TextField
            inputRef={passwordRef}
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
            returnKeyType="go"
            onSubmitEditing={submit}
            containerStyle={{ marginTop: 18 }}
          />

          {/*
            Announced, not just shown. signup.tsx already did this; the other
            three auth screens rendered their failure as ordinary text, so a
            VoiceOver user submitted the form and heard nothing back.
          */}
          {!!error && (
            <Text style={s.error} accessibilityLiveRegion="assertive" accessibilityRole="alert">
              {error}
            </Text>
          )}

          <View style={{ marginTop: 28 }}>
            <PrimaryButton
              label="Sign in"
              loading={busy}
              onPress={submit}
              disabled={!canSubmit}
            />
          </View>

          <Tappable
            onPress={() => router.push("/auth/forgot-password")}
            accessibilityRole="link"
            accessibilityLabel="Forgot your password?"
            // A centred label is a 16pt-tall target without a minHeight.
            style={{ marginTop: 12, alignItems: "center", justifyContent: "center", minHeight: 44 }}
          >
            <Text style={[T.buttonSmall, { color: color.cobalt }]}>Forgot your password?</Text>
          </Tappable>

          {/* Placed after the password controls, not between them: these are
              alternatives to the form above, and the form's own sub-action
              ("Forgot your password?") belongs with the form. */}
          <SocialSignIn
            onCredential={handleSocialCredential}
            busy={busy}
            onStart={() => setError(null)}
            onError={setError}
          />

          <Tappable
            onPress={() => router.replace("/auth/signup")}
            accessibilityRole="link"
            accessibilityLabel="Create an account"
            style={{ marginTop: 16, alignItems: "center", justifyContent: "center", minHeight: 44 }}
          >
            <Text style={[T.bodySmall, { textAlign: "center" }]}>
              New here? <Text style={{ color: color.textPrimary }}>Create an account</Text>
            </Text>
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
