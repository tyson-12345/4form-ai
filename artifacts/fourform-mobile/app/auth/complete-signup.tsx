/**
 * The date-of-birth step for an account created through Apple or Google.
 *
 * ── Why this screen has to exist ────────────────────────────────────────────
 * Neither provider tells us a date of birth, and the age gate is not optional:
 * COPPA applies under 13 and GDPR Art. 8 sets a 13–16 consent floor, so an
 * account cannot be created without one (the server refuses — see
 * `safeBirthDate` in the API's lib/validate.ts).
 *
 * The tempting alternative is to skip the gate when a provider vouched for the
 * user. That does not follow: Apple and Google have verified an email address,
 * not an age. And a federated signup that skipped the question would be the
 * fastest path into the app, so it would become the path an under-13 takes —
 * the gate would still be drawn on the email screen while nobody walked through
 * it.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { BackButton, Label, PrimaryButton, Screen, Text, TextField } from "@/components/caliper";
import { color, type as T, radius, GUTTER, font } from "@/constants/caliper";
import { useAuth } from "@/lib/authContext";
import { ApiError, NetworkError } from "@/lib/api";
import { takeOAuth, type PendingRegistration } from "@/lib/oauthHandoff";
import { PRIVACY_POLICY_URL, TERMS_URL, openLegal } from "@/constants/legal";
import {
  birthDateMessage,
  birthDateProblem,
  isOldEnough,
  parseBirthDate,
  toIsoDate,
} from "@/utils/age";
import * as haptics from "@/lib/haptics";

export default function CompleteSignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { completeOAuthSignup } = useAuth();

  const [pending] = useState<PendingRegistration | null>(() => takeOAuth("registration"));

  /**
   * Apple gives a name only on the very first authorization and never again, so
   * when it arrives it is prefilled here and this is the last chance to keep
   * it. Google supplies none, and the field starts empty.
   */
  const [name, setName] = useState(pending?.suggestedName ?? "");
  const [dobDay, setDobDay] = useState("");
  const [dobMonth, setDobMonth] = useState("");
  const [dobYear, setDobYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dobDayRef = useRef<TextInput>(null);
  const dobMonthRef = useRef<TextInput>(null);
  const dobYearRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!pending) router.replace("/auth/signup");
  }, [pending, router]);

  if (!pending) return null;

  const birthDate = parseBirthDate(dobDay, dobMonth, dobYear);
  const oldEnough = isOldEnough(birthDate);
  const dobProblem = birthDateProblem(dobDay, dobMonth, dobYear);
  const dobInvalid = dobProblem !== null && dobProblem !== "incomplete";

  const canSubmit = name.trim().length > 0 && oldEnough && !busy;

  async function submit() {
    if (!canSubmit || !birthDate) return;
    setBusy(true);
    setError(null);
    try {
      await completeOAuthSignup(pending!.token, toIsoDate(birthDate), name.trim());
      haptics.success();
      router.replace("/onboarding");
    } catch (err) {
      haptics.fail();
      setError(
        err instanceof NetworkError || err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.head, { paddingTop: insets.top + 14 }]}>
          <BackButton onPress={() => router.replace("/auth/signup")} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Label>ALMOST THERE</Label>
          <Text scale="display" style={[T.headline, { marginTop: 10 }]}>
            Finish your{"\n"}account.
          </Text>

          <Text style={[T.body, { marginTop: 16, color: color.textBody }]}>
            Signing in as {pending.email}. We just need two things your provider doesn&apos;t
            share.
          </Text>

          <TextField
            label="Name"
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError(null);
            }}
            placeholder="What should we call you?"
            autoCapitalize="words"
            autoComplete="name"
            returnKeyType="next"
            onSubmitEditing={() => dobDayRef.current?.focus()}
            containerStyle={{ marginTop: 28 }}
          />

          {/* Identical to the email signup's date field, deliberately: this is
              the same control performing the same legal function, and two
              age gates that behave differently is how one of them drifts. */}
          <Label style={{ marginTop: 18, marginBottom: 8 }}>DATE OF BIRTH</Label>
          <View style={s.dobRow} accessibilityLabel="Date of birth, day month year">
            <TextInput
              ref={dobDayRef}
              accessibilityLabel="Day of birth"
              style={[s.input, s.inputBordered, s.dobPart, dobInvalid && s.inputError]}
              value={dobDay}
              onChangeText={(v) => {
                const digits = v.replace(/\D/g, "").slice(0, 2);
                setDobDay(digits);
                setError(null);
                if (digits.length === 2) dobMonthRef.current?.focus();
              }}
              placeholder="DD"
              placeholderTextColor={color.textGhost}
              keyboardType="number-pad"
              maxLength={2}
              returnKeyType="next"
            />
            <TextInput
              ref={dobMonthRef}
              accessibilityLabel="Month of birth"
              style={[s.input, s.inputBordered, s.dobPart, dobInvalid && s.inputError]}
              value={dobMonth}
              onChangeText={(v) => {
                const digits = v.replace(/\D/g, "").slice(0, 2);
                setDobMonth(digits);
                setError(null);
                if (digits.length === 2) dobYearRef.current?.focus();
              }}
              onKeyPress={(e) => {
                if (e.nativeEvent.key === "Backspace" && dobMonth.length === 0) {
                  dobDayRef.current?.focus();
                }
              }}
              placeholder="MM"
              placeholderTextColor={color.textGhost}
              keyboardType="number-pad"
              maxLength={2}
              returnKeyType="next"
            />
            <TextInput
              ref={dobYearRef}
              accessibilityLabel="Year of birth"
              style={[s.input, s.inputBordered, s.dobYear, dobInvalid && s.inputError]}
              value={dobYear}
              onChangeText={(v) => {
                setDobYear(v.replace(/\D/g, "").slice(0, 4));
                setError(null);
              }}
              onKeyPress={(e) => {
                if (e.nativeEvent.key === "Backspace" && dobYear.length === 0) {
                  dobMonthRef.current?.focus();
                }
              }}
              placeholder="YYYY"
              placeholderTextColor={color.textGhost}
              keyboardType="number-pad"
              maxLength={4}
              returnKeyType="go"
              onSubmitEditing={submit}
            />
          </View>
          <Text
            style={[T.bodySmall, { marginTop: 8, color: dobInvalid ? color.rust : color.textFaint }]}
            accessibilityLiveRegion={dobInvalid ? "polite" : "none"}
          >
            {birthDateMessage(dobInvalid ? dobProblem : null)}
          </Text>

          {!!error && (
            <Text style={s.error} accessibilityLiveRegion="assertive" accessibilityRole="alert">
              {error}
            </Text>
          )}

          <View style={{ marginTop: 28 }}>
            <PrimaryButton
              label="Create account"
              loading={busy}
              onPress={submit}
              disabled={!canSubmit}
              trailingArrow
            />
          </View>

          {/* The same assent the email signup shows, at the same moment — this
              is also an account being created, and terms nobody was shown are
              the ones that do not hold. */}
          <Text style={s.legal}>
            By creating an account you agree to our{" "}
            <Text
              style={s.legalLink}
              accessibilityRole="link"
              onPress={() => void openLegal(TERMS_URL, "Terms of Service")}
            >
              Terms of Service
            </Text>{" "}
            and{" "}
            <Text
              style={s.legalLink}
              accessibilityRole="link"
              onPress={() => void openLegal(PRIVACY_POLICY_URL, "Privacy Policy")}
            >
              Privacy Policy
            </Text>
            . You must be at least 13 years old.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: GUTTER, paddingBottom: 10 },
  dobRow: { flexDirection: "row", gap: 10 },
  dobPart: { flex: 1, minWidth: 0, textAlign: "center" },
  dobYear: { flex: 1.6, minWidth: 0, textAlign: "center" },
  inputBordered: { borderWidth: 1, borderColor: "transparent" },
  inputError: { borderColor: color.rust },
  input: {
    backgroundColor: color.card,
    borderRadius: radius.cardSmall,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontFamily: font.body,
    fontSize: 15,
    color: color.textPrimary,
  },
  error: {
    marginTop: 14,
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.rust,
  },
  legal: {
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 21,
    color: color.textFaint,
    textAlign: "center",
    marginTop: 16,
  },
  legalLink: { color: color.textPrimary, textDecorationLine: "underline" },
});
