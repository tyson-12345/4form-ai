/**
 * Landing — the first screen, and the promise.
 *
 * The old copy led with "Elite coaching. Powered by AI." and claimed
 * "biomechanics analysis, personalized coaching, and injury prevention in
 * seconds". Two problems: it sold the model rather than the measurement, and
 * "injury prevention" is a claim the product cannot support.
 *
 * Caliper's promise is narrower and true — we measure your joints and show you
 * the numbers. That is also the more interesting claim.
 */

import React, { useEffect } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Svg, { Line, Circle } from "react-native-svg";

import { Screen, Label, PrimaryButton, Chip } from "@/components/caliper";
import { color, type as T, radius, GUTTER, font } from "@/constants/caliper";
import { useAuth } from "@/lib/authContext";
import { SPORTS } from "@/constants/sports";

/** A representative slice of the catalogue — the full list lives in onboarding. */
const SHOWCASE = SPORTS.slice(0, 8);

export default function LandingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAuthenticated, profile } = useAuth();

  // Already signed in — go straight to the instrument panel. Onboarding is only
  // for accounts that haven't picked a sport yet.
  useEffect(() => {
    if (!isAuthenticated) return;
    router.replace(profile?.sport ? "/(tabs)" : "/onboarding");
  }, [isAuthenticated, profile?.sport, router]);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 28,
          paddingHorizontal: GUTTER,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Label>ATHLETE AI</Label>

        <Text style={[T.headline, s.headline]}>
          Your technique,{"\n"}measured.
        </Text>

        <Text style={[T.body, s.sub]}>
          Film a set. We track your joints frame by frame and show you the angles — with the
          range each one should sit in. Same clip, same numbers, every time.
        </Text>

        <MeasureMark />

        <View style={s.chips}>
          {SHOWCASE.map((sport) => (
            <Chip key={sport} label={sport} />
          ))}
          <Chip label={`+${SPORTS.length - SHOWCASE.length} more`} />
        </View>

        <View style={s.points}>
          {[
            ["Measured, not guessed", "Joint angles from your own video, not an estimate from a text description."],
            ["Shown against a band", "Every number arrives with the range it came from, so you know what it means."],
            ["Flags carry evidence", "A flagged joint always shows the angle that produced it."],
          ].map(([title, body]) => (
            <View key={title} style={s.point}>
              <Text style={T.rowTitle}>{title}</Text>
              <Text style={[T.bodySmall, { marginTop: 3 }]}>{body}</Text>
            </View>
          ))}
        </View>

        <View style={{ flex: 1, minHeight: 24 }} />

        <PrimaryButton
          label="Start measuring"
          onPress={() => router.push("/auth/signup")}
          trailingArrow
        />

        <View style={{ height: 10 }} />

        <PrimaryButton
          label="Sign in"
          onPress={() => router.push("/auth/login")}
          tone={color.card}
          labelTone={color.textPrimary}
        />

        <Text style={s.footnote}>Free to start. No card required.</Text>
      </ScrollView>
    </Screen>
  );
}

/**
 * The mark: a caliper measuring a joint angle.
 *
 * Says what the product does in one glyph — the cobalt arc is the reading, and
 * it's the only cobalt on the screen until the primary button.
 */
function MeasureMark() {
  return (
    <View style={s.mark}>
      <Svg width={200} height={120} viewBox="0 0 200 120">
        {/* limb */}
        <Line x1={30} y1={20} x2={92} y2={70} stroke={color.ink} strokeWidth={2.5} strokeLinecap="round" />
        <Line x1={92} y1={70} x2={170} y2={58} stroke={color.ink} strokeWidth={2.5} strokeLinecap="round" />
        {/* joint */}
        <Circle cx={92} cy={70} r={6} fill={color.ink} />
        <Circle cx={30} cy={20} r={4} fill={color.ink} opacity={0.35} />
        <Circle cx={170} cy={58} r={4} fill={color.ink} opacity={0.35} />
        {/* the reading */}
        <Circle
          cx={92}
          cy={70}
          r={30}
          stroke={color.cobalt}
          strokeWidth={2}
          fill="none"
          strokeDasharray="47 200"
          strokeDashoffset={-6}
        />
      </Svg>
      <Text style={[T.measured, { color: color.cobalt, marginTop: -18 }]}>142°</Text>
    </View>
  );
}

const s = StyleSheet.create({
  headline: { marginTop: 12 },
  sub: { marginTop: 14, maxWidth: 320 },
  mark: { alignItems: "center", marginTop: 18, marginBottom: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  points: { marginTop: 28, gap: 16 },
  point: {
    borderLeftWidth: 2,
    borderLeftColor: color.ruleStrong,
    paddingLeft: 14,
  },
  footnote: {
    textAlign: "center",
    marginTop: 14,
    fontFamily: font.body,
    fontSize: 12,
    color: color.textFaint,
  },
});
