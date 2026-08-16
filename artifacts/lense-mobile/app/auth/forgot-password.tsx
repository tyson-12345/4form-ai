/**
 * Forgot password — request a reset link.
 *
 * The server responds identically whether or not the address is registered, and
 * so does this screen: on success it always shows the same confirmation. Showing
 * "no account with that email" here would undo the server's non-enumeration.
 */

import React, { useState } from "react";
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

import { Screen, Label, PrimaryButton, Chevron, Check } from "@/components/caliper";
import { color, type as T, radius, GUTTER, font } from "@/constants/caliper";
import { auth, NetworkError } from "@/lib/api";

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      // Only a transport failure is worth reporting — a rejected address must
      // look identical to an accepted one.
      setError(
        err instanceof NetworkError
          ? err.message
          : "We couldn't send that right now. Please try again.",
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
        >
          {sent ? (
            <View style={{ paddingTop: 20 }}>
              <View style={s.sentGlyph}>
                <Check tone={color.cobalt} size={22} />
              </View>
              <Text style={[T.headline, { marginTop: 20 }]}>Check your email.</Text>
              <Text style={[T.body, { marginTop: 14 }]}>
                If that email is registered, you will receive a reset link. It expires in 30
                minutes and can only be used once.
              </Text>
              <Text style={[T.bodySmall, { marginTop: 16 }]}>
                Nothing arrived? Check spam, then try again, and make sure you used the address
                you signed up with.
              </Text>

              <View style={{ marginTop: 30 }}>
                <PrimaryButton label="Back to sign in" onPress={() => router.replace("/auth/login")} />
              </View>

              <Pressable
                onPress={() => router.push("/auth/reset-password")}
                style={{ marginTop: 20, alignItems: "center" }}
                hitSlop={8}
              >
                <Text style={[T.buttonSmall, { color: color.cobalt }]}>
                  I already have a reset code
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Label>RESET</Label>
              <Text style={[T.headline, { marginTop: 10 }]}>
                Forgot your{"\n"}password?
              </Text>
              <Text style={[T.body, { marginTop: 14 }]}>
                Enter the email you signed up with and we'll send you a link to set a new one.
              </Text>

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
                autoFocus
                returnKeyType="go"
                onSubmitEditing={submit}
              />

              {error && <Text style={s.error}>{error}</Text>}

              <View style={{ marginTop: 28 }}>
                <PrimaryButton
                  label={busy ? "Sending…" : "Send reset link"}
                  onPress={submit}
                  disabled={!email.trim() || busy}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const s = StyleSheet.create({
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
  sentGlyph: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: color.cobaltWash,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    marginTop: 14,
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.rust,
  },
});
