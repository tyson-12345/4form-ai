import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { Screen, Label, PrimaryButton, Chevron } from "@/components/caliper";
import { color, type as T, radius, GUTTER, font } from "@/constants/caliper";
import { useAuth } from "@/lib/authContext";
import { ApiError, NetworkError } from "@/lib/api";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
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
      router.replace("/");
    } catch (err) {
      // The server returns one message for every credential failure — unknown
      // email, wrong password, locked account. Surface it verbatim; adding our
      // own detail here would undo that.
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
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Chevron direction="left" tone={color.textPrimary} size={16} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Label>WELCOME BACK</Label>
          <Text style={[T.headline, { marginTop: 10 }]}>Sign in.</Text>

          <Label style={{ marginTop: 34, marginBottom: 8 }}>EMAIL</Label>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
            }}
            placeholder="you@example.com"
            placeholderTextColor={color.textGhost}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />

          <Label style={{ marginTop: 18, marginBottom: 8 }}>PASSWORD</Label>
          <View style={s.passwordWrap}>
            <TextInput
              ref={passwordRef}
              style={[s.input, { flex: 1, paddingRight: 60 }]}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setError(null);
              }}
              placeholder="Your password"
              placeholderTextColor={color.textGhost}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Pressable onPress={() => setShow(!show)} style={s.reveal} hitSlop={8}>
              <Text style={[T.buttonSmall, { color: color.textMuted }]}>
                {show ? "Hide" : "Show"}
              </Text>
            </Pressable>
          </View>

          {error && <Text style={s.error}>{error}</Text>}

          <View style={{ marginTop: 28 }}>
            <PrimaryButton
              label={busy ? "Signing in…" : "Sign in"}
              onPress={submit}
              disabled={!canSubmit}
            />
          </View>

          <Pressable
            onPress={() => router.push("/auth/forgot-password")}
            style={{ marginTop: 20, alignItems: "center" }}
            hitSlop={8}
          >
            <Text style={[T.buttonSmall, { color: color.cobalt }]}>Forgot your password?</Text>
          </Pressable>

          <Pressable
            onPress={() => router.replace("/auth/signup")}
            style={{ marginTop: 24, alignItems: "center" }}
            hitSlop={8}
          >
            <Text style={[T.bodySmall, { textAlign: "center" }]}>
              New here? <Text style={{ color: color.textPrimary }}>Create an account</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export const s = StyleSheet.create({
  head: { paddingHorizontal: GUTTER, paddingBottom: 10 },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.card,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    backgroundColor: color.card,
    borderRadius: radius.cardSmall,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontFamily: font.body,
    fontSize: 15,
    color: color.textPrimary,
  },
  passwordWrap: { position: "relative", justifyContent: "center" },
  reveal: { position: "absolute", right: 16 },
  error: {
    marginTop: 14,
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.rust,
  },
});
