import React, { useRef, useState } from "react";
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

import {
  BackButton,
  Label,
  PrimaryButton,
  Meter,
  TextField,
  Tappable,
  Screen,
  Text,
} from "@/components/caliper";
import { color, type as T, radius, GUTTER, font } from "@/constants/caliper";
import { useAuth } from "@/lib/authContext";
import { ApiError, NetworkError } from "@/lib/api";
import { SocialSignIn } from "@/components/SocialSignIn";
import { useSocialSignIn } from "@/lib/useSocialSignIn";
import * as haptics from "@/lib/haptics";
import { PRIVACY_POLICY_URL, TERMS_URL, openLegal } from "@/constants/legal";
// Date maths lives in utils/ so it can be tested — this screen cannot be, and
// a bug here either admits an under-13 or silently blocks a legitimate signup.
import {
  birthDateMessage,
  birthDateProblem,
  isOldEnough,
  parseBirthDate,
  toIsoDate,
} from "@/utils/age";
import { MIN_PASSWORD_LENGTH } from "@/constants/auth";


export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signup } = useAuth();
  const handleSocialCredential = useSocialSignIn();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dobDay, setDobDay] = useState("");
  const [dobMonth, setDobMonth] = useState("");
  const [dobYear, setDobYear] = useState("");

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const dobDayRef = useRef<TextInput>(null);
  const dobMonthRef = useRef<TextInput>(null);
  const dobYearRef = useRef<TextInput>(null);

  const longEnough = password.length >= MIN_PASSWORD_LENGTH;

  const birthDate = parseBirthDate(dobDay, dobMonth, dobYear);
  const oldEnough = isOldEnough(birthDate);
  // Why it is wrong, not just that it is. "31 February" used to be reported as
  // "you need to be at least 13", which sent a 26-year-old off to argue with
  // the wrong field. `incomplete` is deliberately not shown: flagging someone
  // halfway through typing their birth year is just noise.
  const dobProblem = birthDateProblem(dobDay, dobMonth, dobYear);
  const dobInvalid = dobProblem !== null && dobProblem !== "incomplete";

  const canSubmit =
    name.trim().length > 0 && email.trim().length > 0 && longEnough && oldEnough && !busy;

  async function submit() {
    if (!canSubmit || !birthDate) return;
    setBusy(true);
    setError(null);
    try {
      await signup(email.trim(), password, name.trim(), toIsoDate(birthDate));
      haptics.success();
      router.replace("/onboarding");
    } catch (err) {
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
          <Label>GET STARTED</Label>
          <Text scale="display" style={[T.headline, { marginTop: 10 }]}>Create your{"\n"}account.</Text>

          <TextField
            label="Name"
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError(null);
            }}
            placeholder="Your name"
            autoCapitalize="words"
            autoComplete="name"
            maxLength={80}
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            containerStyle={{ marginTop: 30 }}
          />

          <TextField
            inputRef={emailRef}
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
            onSubmitEditing={() => dobDayRef.current?.focus()}
            containerStyle={{ marginTop: 18 }}
          />

          {/* ── Date of birth ──
              A neutral age screen: it asks for a date rather than "are you 13?",
              which is the form regulators expect and which a child cannot pass
              by tapping yes. The server re-checks it — see safeBirthDate in the
              API's lib/validate.ts — because this field is a courtesy to the
              user, not the control. */}
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
              // Advancing was automatic but going back was not, so correcting a
              // typo in DD meant reaching for the field with a fingertip.
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
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </View>
          <Text
            style={[T.bodySmall, { marginTop: 8, color: dobInvalid ? color.rust : color.textFaint }]}
            // Announced when it changes, rather than sitting there silently for
            // anyone not looking at that part of the screen.
            accessibilityLiveRegion={dobInvalid ? "polite" : "none"}
          >
            {birthDateMessage(dobInvalid ? dobProblem : null)}
          </Text>

          <TextField
            inputRef={passwordRef}
            label="Password"
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
            containerStyle={{ marginTop: 18 }}
          />

          {/*
            Ink when the password is long enough, not cobalt. A strength meter
            is a score, and rule 1 names "a score" as one of the three things
            cobalt is never for. Rust still marks too-short, because that is the
            alarm meaning and this is the one place on the screen something can
            be wrong.
          */}
          {password.length > 0 && (
            <View style={s.strength}>
              <Meter
                value={Math.min(1, password.length / 16)}
                tone={longEnough ? color.ink : color.rust}
                height={3}
                label={`Password strength: ${
                  longEnough ? (password.length >= 16 ? "strong" : "good") : "too short"
                }`}
                style={{ flex: 1 }}
              />
              <Text style={[T.measuredSmall, { color: longEnough ? color.ink : color.rust }]}>
                {longEnough
                  ? password.length >= 16
                    ? "STRONG"
                    : "GOOD"
                  : `${MIN_PASSWORD_LENGTH - password.length} MORE`}
              </Text>
            </View>
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

          {/* Above the assent text, so the terms below cover both ways of
              creating an account rather than only the form. */}
          <SocialSignIn
            onCredential={handleSocialCredential}
            busy={busy}
            onStart={() => setError(null)}
            onError={setError}
          />

          {/* ── Assent ──
              Placed immediately below the button, not in a settings screen. Two
              reasons, and both matter: the stores expect Terms and Privacy to be
              reachable at the point of account creation, and terms a user was
              never shown are far harder to enforce — which is precisely the
              clauses that limit liability for a training app. */}
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

          <Text style={s.legal}>
            AthleteAI measures how you move. It is not medical advice and does not diagnose
            injuries. See a professional about pain or injury.
          </Text>

          <Tappable
            onPress={() => router.replace("/auth/login")}
            accessibilityRole="link"
            accessibilityLabel="Sign in to an existing account"
            style={{ marginTop: 16, alignItems: "center", justifyContent: "center", minHeight: 44 }}
          >
            <Text style={[T.bodySmall, { textAlign: "center" }]}>
              Already have an account?{" "}
              <Text style={{ color: color.textPrimary }}>Sign in</Text>
            </Text>
          </Tappable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const s = StyleSheet.create({
  legal: {
    fontFamily: font.body,
    // 12/17 was the smallest prose in the app, and it is the sentence that
    // carries the terms someone is agreeing to. The extra leading also gives
    // the two inline links a little more to aim at — WCAG 2.5.8 exempts
    // in-sentence targets from the 44pt minimum, but "exempt" is not "easy".
    fontSize: 13,
    lineHeight: 21,
    color: color.textFaint,
    textAlign: "center",
    marginTop: 16,
  },
  legalLink: { color: color.textPrimary, textDecorationLine: "underline" },
  dobRow: { flexDirection: "row", gap: 10 },
  // minWidth 0 matters on web: an <input> has an intrinsic ~20-character
  // minimum width, and a flex item never shrinks below min-content without
  // it — the three fields overflowed the screen on any phone-width browser,
  // pushing YYYY out of view entirely. No effect on native.
  dobPart: { flex: 1, minWidth: 0, textAlign: "center" },
  dobYear: { flex: 1.6, minWidth: 0, textAlign: "center" },
  // A transparent border is always present, so turning the error on changes the
  // colour and nothing else. Adding `borderWidth: 1` only when invalid grew the
  // field by 2pt and nudged everything below it the moment validation fired.
  inputBordered: { borderWidth: 1, borderColor: "transparent" },
  inputError: { borderColor: color.rust },
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
  strength: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
});
