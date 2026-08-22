/**
 * Reset password — redeem a token and set a new password.
 *
 * Reachable two ways: from the emailed link (`/reset-password?token=…`, handled
 * by expo-router's deep linking) or by pasting the code manually, which is the
 * fallback when the link opens in a browser instead of the app.
 */

import React, { useState } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  BackButton,
  Check,
  Label,
  PrimaryButton,
  Screen,
  Text,
} from "@/components/caliper";
import { color, type as T, radius, GUTTER, font } from "@/constants/caliper";
import { auth, ApiError, NetworkError } from "@/lib/api";
import { MIN_PASSWORD_LENGTH } from "@/constants/auth";

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();

  const [token, setToken] = useState(params.token ?? "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const longEnough = password.length >= MIN_PASSWORD_LENGTH;
  const canSubmit = token.trim().length >= 20 && longEnough && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await auth.resetPassword(token.trim(), password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof NetworkError
          ? err.message
          : err instanceof ApiError
            ? err.message
            : "We couldn't reset your password. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ padding: GUTTER, paddingTop: insets.top + 60 }}>
          <View style={s.doneGlyph}>
            <Check tone={color.cobalt} size={22} />
          </View>
          <Text scale="display" style={[T.headline, { marginTop: 20 }]}>Password reset.</Text>
          <Text style={[T.body, { marginTop: 14 }]}>
            Your password has been changed and any sign-in lock has been cleared. You can sign
            in now.
          </Text>
          <View style={{ marginTop: 30 }}>
            <PrimaryButton label="Sign in" onPress={() => router.replace("/auth/login")} />
          </View>
        </ScrollView>
      </Screen>
    );
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
        >
          <Label>RESET</Label>
          <Text scale="display" style={[T.headline, { marginTop: 10 }]}>Set a new password.</Text>

          {!params.token && (
            <>
              <Label style={{ marginTop: 30, marginBottom: 8 }}>RESET CODE</Label>
              <TextInput
                style={s.input}
                value={token}
                onChangeText={(v) => {
                  setToken(v);
                  setError(null);
                }}
                placeholder="Paste the code from your email"
                placeholderTextColor={color.textGhost}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          )}

          <Label style={{ marginTop: 20, marginBottom: 8 }}>NEW PASSWORD</Label>
          <View style={s.passwordWrap}>
            <TextInput
              style={[s.input, { paddingRight: 60 }]}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setError(null);
              }}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              placeholderTextColor={color.textGhost}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Pressable
              onPress={() => setShow(!show)}
              style={s.reveal}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={show ? "Hide password" : "Show password"}
              accessibilityState={{ selected: show }}
            >
              <Text style={[T.buttonSmall, { color: color.textMuted }]}>
                {show ? "Hide" : "Show"}
              </Text>
            </Pressable>
          </View>

          {password.length > 0 && (
            <View style={s.strength}>
              <View style={s.strengthTrack}>
                <View
                  style={[
                    s.strengthFill,
                    {
                      width: `${Math.min(100, (password.length / 16) * 100)}%`,
                      backgroundColor: longEnough ? color.cobalt : color.rust,
                    },
                  ]}
                />
              </View>
              <Text style={[T.measuredSmall, { color: longEnough ? color.cobalt : color.rust }]}>
                {longEnough ? "GOOD" : `${MIN_PASSWORD_LENGTH - password.length} MORE`}
              </Text>
            </View>
          )}

          {error && <Text style={s.error}>{error}</Text>}

          <View style={{ marginTop: 28 }}>
            <PrimaryButton
              label={busy ? "Resetting…" : "Reset password"}
              onPress={submit}
              disabled={!canSubmit}
            />
          </View>

          <Text style={[T.bodySmall, { marginTop: 18, textAlign: "center" }]}>
            Reset links expire 30 minutes after they're sent and work once.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: GUTTER, paddingBottom: 10 },
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
  reveal: {
    position: "absolute",
    right: 8,
    paddingHorizontal: 8,
    // The label alone was a 34x16 target inside the field.
    minHeight: 44,
    justifyContent: "center",
  },
  strength: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  strengthTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: color.rule },
  strengthFill: { height: 3, borderRadius: 2 },
  doneGlyph: {
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
