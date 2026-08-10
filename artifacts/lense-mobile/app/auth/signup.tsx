import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/authContext";

/**
 * Kept in step with `safePassword` in the API's lib/validate.ts. Length is the
 * single biggest factor in real-world resistance, so we ask for length rather
 * than character-class rules people work around with "Password1!".
 */
const MIN_PASSWORD_LENGTH = 12;

export default function SignupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signup } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<"name" | "email" | "password" | null>(null);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  async function handleSignup() {
    // Must match `safePassword` on the server (min 12). A lower bar here would
    // let the user submit and get back only a generic validation error, with no
    // way to tell what was wrong.
    if (!name.trim() || !email.trim() || password.length < MIN_PASSWORD_LENGTH) return;
    setError(null);
    setLoading(true);
    try {
      await signup(email.trim(), password, name.trim());
      router.replace("/onboarding");
    } catch (e: any) {
      setError(e.message ?? "Sign up failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    name.trim().length > 0 && email.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH;

  const passwordStrength =
    password.length === 0
      ? null
      : password.length < MIN_PASSWORD_LENGTH
        ? "weak"
        : password.length < 16
          ? "good"
          : "strong";
  const strengthColor = passwordStrength === "weak" ? colors.destructive : passwordStrength === "good" ? colors.warning : colors.success;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: {
      flex: 1, paddingHorizontal: 24,
      paddingTop: topPad + 24, paddingBottom: bottomPad + 24,
    },
    backBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 32 },
    backText: { color: colors.mutedForeground, fontSize: 14, fontFamily: "Inter_400Regular" },
    logo: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 32 },
    logoIcon: {
      width: 40, height: 40, borderRadius: 12,
      backgroundColor: colors.primary + "22",
      borderWidth: 1.5, borderColor: colors.primary + "44",
      alignItems: "center", justifyContent: "center",
    },
    logoText: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.foreground },
    heading: { fontSize: 28, fontFamily: "Archivo_800ExtraBold", color: colors.foreground, marginBottom: 8, letterSpacing: -0.5 },
    subheading: { fontSize: 15, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginBottom: 32 },
    label: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground, marginBottom: 6 },
    inputWrap: {
      flexDirection: "row", alignItems: "center",
      backgroundColor: colors.card, borderRadius: 12,
      borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)",
      marginBottom: 16, paddingHorizontal: 14,
    },
    inputWrapFocused: { borderColor: colors.primary },
    input: {
      flex: 1, paddingVertical: 14,
      color: colors.foreground, fontSize: 15, fontFamily: "Inter_400Regular",
    },
    eyeBtn: { padding: 4 },
    strengthRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -10, marginBottom: 16 },
    strengthBar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.border },
    strengthFill: { height: 3, borderRadius: 2 },
    strengthText: { fontSize: 11, fontFamily: "Inter_500Medium" },
    errorBox: {
      backgroundColor: "#ff444422", borderRadius: 10,
      borderWidth: 1, borderColor: "#ff4444",
      paddingHorizontal: 14, paddingVertical: 10,
      marginBottom: 16, flexDirection: "row", alignItems: "center", gap: 8,
    },
    errorText: { color: "#ff6666", fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
    primaryBtn: {
      backgroundColor: colors.primary, borderRadius: 14,
      paddingVertical: 16, alignItems: "center", justifyContent: "center",
      flexDirection: "row", gap: 8, marginTop: 8,
    },
    primaryBtnDisabled: { opacity: 0.6 },
    primaryBtnText: { color: colors.primaryForeground, fontSize: 16, fontFamily: "Inter_700Bold" },
    loginRow: { flexDirection: "row", justifyContent: "center", marginTop: 24, gap: 4 },
    loginText: { color: colors.mutedForeground, fontSize: 14, fontFamily: "Inter_400Regular" },
    loginLink: { color: colors.primary, fontSize: 14, fontFamily: "Inter_600SemiBold" },
    terms: {
      textAlign: "center", fontSize: 11,
      color: colors.mutedForeground, fontFamily: "Inter_400Regular",
      marginTop: 16, lineHeight: 16,
    },
  });

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>

        <View style={s.logo}>
          <View style={s.logoIcon}>
            <Feather name="zap" size={20} color={colors.primary} />
          </View>
          <Text style={s.logoText}>AthleteAI</Text>
        </View>

        <Text style={s.heading}>Create account</Text>
        <Text style={s.subheading}>Start your AI-powered training journey</Text>

        {error && (
          <View style={s.errorBox}>
            <Feather name="alert-circle" size={14} color="#ff6666" />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <Text style={s.label}>Full name</Text>
        <View style={[s.inputWrap, focusedField === "name" && s.inputWrapFocused]}>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="Alex Rivera"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            autoComplete="name"
            returnKeyType="next"
            onFocus={() => setFocusedField("name")}
            onBlur={() => setFocusedField(null)}
            onSubmitEditing={() => emailRef.current?.focus()}
          />
        </View>

        <Text style={s.label}>Email</Text>
        <View style={[s.inputWrap, focusedField === "email" && s.inputWrapFocused]}>
          <TextInput
            ref={emailRef}
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            returnKeyType="next"
            onFocus={() => setFocusedField("email")}
            onBlur={() => setFocusedField(null)}
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
        </View>

        <Text style={s.label}>Password</Text>
        <View style={[s.inputWrap, focusedField === "password" && s.inputWrapFocused]}>
          <TextInput
            ref={passwordRef}
            style={s.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry={!showPassword}
            autoComplete="new-password"
            returnKeyType="go"
            onFocus={() => setFocusedField("password")}
            onBlur={() => setFocusedField(null)}
            onSubmitEditing={handleSignup}
          />
          <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
            <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Password strength indicator */}
        {passwordStrength && (
          <View style={s.strengthRow}>
            <View style={s.strengthBar}>
              <View style={[s.strengthFill, {
                width: passwordStrength === "weak" ? "33%" : passwordStrength === "good" ? "66%" : "100%",
                backgroundColor: strengthColor,
              }]} />
            </View>
            <Text style={[s.strengthText, { color: strengthColor }]}>
              {passwordStrength === "weak"
                ? `At least ${MIN_PASSWORD_LENGTH} characters`
                : passwordStrength === "good"
                  ? "Good"
                  : "Strong"}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[s.primaryBtn, (!canSubmit || loading) && s.primaryBtnDisabled]}
          onPress={handleSignup}
          disabled={!canSubmit || loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="user-plus" size={18} color={colors.primaryForeground} />
              <Text style={s.primaryBtnText}>Create Account</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={s.loginRow}>
          <Text style={s.loginText}>Already have an account?</Text>
          <TouchableOpacity onPress={() => router.push("/auth/login")}>
            <Text style={s.loginLink}>Sign in</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.terms}>
          By creating an account you agree to our Terms of Service and Privacy Policy.{"\n"}
          Free to start · No credit card required.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
