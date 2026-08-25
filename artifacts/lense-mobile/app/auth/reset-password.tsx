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
  Meter,
  TextField,
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
            <TextField
              label="Reset code"
              value={token}
              onChangeText={(v) => {
                setToken(v);
                setError(null);
              }}
              placeholder="Paste the code from your email"
              autoCapitalize="none"
              autoCorrect={false}
              containerStyle={{ marginTop: 30 }}
            />
          )}

          <TextField
            label="New password"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setError(null);
            }}
            error={error}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            secure
            autoCapitalize="none"
            autoComplete="new-password"
            returnKeyType="go"
            onSubmitEditing={submit}
            containerStyle={{ marginTop: 20 }}
          />

          {password.length > 0 && (
            <View style={s.strength}>
              <Meter
                value={Math.min(1, password.length / 16)}
                tone={longEnough ? color.cobalt : color.rust}
                height={3}
                label={`Password strength: ${longEnough ? "good" : "too short"}`}
                style={{ flex: 1 }}
              />
              <Text style={[T.measuredSmall, { color: longEnough ? color.cobalt : color.rust }]}>
                {longEnough ? "GOOD" : `${MIN_PASSWORD_LENGTH - password.length} MORE`}
              </Text>
            </View>
          )}

          <View style={{ marginTop: 28 }}>
            <PrimaryButton
              label="Reset password"
              loading={busy}
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
  strength: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  doneGlyph: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: color.cobaltWash,
    alignItems: "center",
    justifyContent: "center",
  },
});
