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
import { PRIVACY_POLICY_URL, TERMS_URL, openLegal } from "@/constants/legal";
// Date maths lives in utils/ so it can be tested — this screen cannot be, and
// a bug here either admits an under-13 or silently blocks a legitimate signup.
import { MINIMUM_AGE_YEARS, isOldEnough, parseBirthDate, toIsoDate } from "@/utils/age";
import { MIN_PASSWORD_LENGTH } from "@/constants/auth";


export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signup } = useAuth();

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
  const dobComplete = dobDay.length > 0 && dobMonth.length > 0 && dobYear.length === 4;
  const oldEnough = isOldEnough(birthDate);
  // Only complain once they've finished typing — flagging "too young" while
  // someone is halfway through their birth year is just noise.
  const dobInvalid = dobComplete && !oldEnough;

  const canSubmit =
    name.trim().length > 0 && email.trim().length > 0 && longEnough && oldEnough && !busy;

  async function submit() {
    if (!canSubmit || !birthDate) return;
    setBusy(true);
    setError(null);
    try {
      await signup(email.trim(), password, name.trim(), toIsoDate(birthDate));
      router.replace("/onboarding");
    } catch (err) {
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
          <Label>GET STARTED</Label>
          <Text style={[T.headline, { marginTop: 10 }]}>Create your{"\n"}account.</Text>

          <Label style={{ marginTop: 30, marginBottom: 8 }}>NAME</Label>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError(null);
            }}
            placeholder="Your name"
            placeholderTextColor={color.textGhost}
            autoCapitalize="words"
            autoComplete="name"
            maxLength={80}
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
          />

          <Label style={{ marginTop: 18, marginBottom: 8 }}>EMAIL</Label>
          <TextInput
            ref={emailRef}
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
            onSubmitEditing={() => dobDayRef.current?.focus()}
          />

          {/* ── Date of birth ──
              A neutral age screen: it asks for a date rather than "are you 13?",
              which is the form regulators expect and which a child cannot pass
              by tapping yes. The server re-checks it — see safeBirthDate in the
              API's lib/validate.ts — because this field is a courtesy to the
              user, not the control. */}
          <Label style={{ marginTop: 18, marginBottom: 8 }}>DATE OF BIRTH</Label>
          <View style={s.dobRow}>
            <TextInput
              ref={dobDayRef}
              style={[s.input, s.dobPart, dobInvalid && s.inputError]}
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
              style={[s.input, s.dobPart, dobInvalid && s.inputError]}
              value={dobMonth}
              onChangeText={(v) => {
                const digits = v.replace(/\D/g, "").slice(0, 2);
                setDobMonth(digits);
                setError(null);
                if (digits.length === 2) dobYearRef.current?.focus();
              }}
              placeholder="MM"
              placeholderTextColor={color.textGhost}
              keyboardType="number-pad"
              maxLength={2}
              returnKeyType="next"
            />
            <TextInput
              ref={dobYearRef}
              style={[s.input, s.dobYear, dobInvalid && s.inputError]}
              value={dobYear}
              onChangeText={(v) => {
                setDobYear(v.replace(/\D/g, "").slice(0, 4));
                setError(null);
              }}
              placeholder="YYYY"
              placeholderTextColor={color.textGhost}
              keyboardType="number-pad"
              maxLength={4}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </View>
          <Text style={[T.bodySmall, { marginTop: 8, color: dobInvalid ? color.rust : color.textFaint }]}>
            {dobInvalid
              ? `You need to be at least ${MINIMUM_AGE_YEARS} to use AthleteAI.`
              : `You need to be at least ${MINIMUM_AGE_YEARS}. We use this to check your age, nothing else.`}
          </Text>

          <Label style={{ marginTop: 18, marginBottom: 8 }}>PASSWORD</Label>
          <View style={s.passwordWrap}>
            <TextInput
              ref={passwordRef}
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
            <Pressable onPress={() => setShow(!show)} style={s.reveal} hitSlop={8}>
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
                      width: `${Math.min(100, (password.length / 16) * 100)}%` as `${number}%`,
                      backgroundColor: longEnough ? color.cobalt : color.rust,
                    },
                  ]}
                />
              </View>
              <Text style={[T.measuredSmall, { color: longEnough ? color.cobalt : color.rust }]}>
                {longEnough
                  ? password.length >= 16
                    ? "STRONG"
                    : "GOOD"
                  : `${MIN_PASSWORD_LENGTH - password.length} MORE`}
              </Text>
            </View>
          )}

          {error && <Text style={s.error}>{error}</Text>}

          <View style={{ marginTop: 28 }}>
            <PrimaryButton
              label={busy ? "Creating…" : "Create account"}
              onPress={submit}
              disabled={!canSubmit}
              trailingArrow
            />
          </View>

          {/* ── Assent ──
              Placed immediately below the button, not in a settings screen. Two
              reasons, and both matter: the stores expect Terms and Privacy to be
              reachable at the point of account creation, and terms a user was
              never shown are far harder to enforce — which is precisely the
              clauses that limit liability for a training app. */}
          <Text style={s.legal}>
            By creating an account you agree to our{" "}
            <Text style={s.legalLink} onPress={() => void openLegal(TERMS_URL, "Terms of Service")}>
              Terms of Service
            </Text>{" "}
            and{" "}
            <Text
              style={s.legalLink}
              onPress={() => void openLegal(PRIVACY_POLICY_URL, "Privacy Policy")}
            >
              Privacy Policy
            </Text>
            . You must be at least 13 years old.
          </Text>

          <Text style={s.legal}>
            AthleteAI measures how you move. It is not medical advice and does not diagnose
            injuries — see a professional about pain or injury.
          </Text>

          <Pressable
            onPress={() => router.replace("/auth/login")}
            style={{ marginTop: 24, alignItems: "center" }}
            hitSlop={8}
          >
            <Text style={[T.bodySmall, { textAlign: "center" }]}>
              Already have an account?{" "}
              <Text style={{ color: color.textPrimary }}>Sign in</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const s = StyleSheet.create({
  legal: {
    fontFamily: font.body,
    fontSize: 12,
    lineHeight: 17,
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
  inputError: { borderWidth: 1, borderColor: color.rust },
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
  strength: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  strengthTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: color.rule },
  strengthFill: { height: 3, borderRadius: 2 },
  error: {
    marginTop: 14,
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.rust,
  },
});
