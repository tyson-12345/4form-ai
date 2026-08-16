/**
 * Onboarding — five questions, each of which changes what we measure or how we
 * frame it. Nothing here is collected "for personalisation" in the abstract.
 *
 * Multi-select on sport, because most athletes cross-train and the previous
 * single-pick forced a lie. The first pick is stored as the primary sport
 * (that's what the profile column holds); the rest go in `goals` context.
 */

import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { Screen, Label, Chip, PrimaryButton, Chevron } from "@/components/caliper";
import { color, type as T, GUTTER } from "@/constants/caliper";
import { useAuth } from "@/lib/authContext";
import { SPORTS } from "@/constants/sports";
import { alert } from "@/lib/alert";

const LEVELS = [
  { key: "beginner", label: "Beginner", note: "New to structured training" },
  { key: "intermediate", label: "Intermediate", note: "Training consistently for a while" },
  { key: "advanced", label: "Advanced", note: "Competing or training seriously" },
  { key: "elite", label: "Elite", note: "Competing at a high level" },
] as const;

const GOALS = [
  "Move better",
  "Lift heavier",
  "Get faster",
  "Stay injury-free",
  "Return from injury",
  "Compete",
  "Build consistency",
  "Improve mobility",
];

const CONCERNS = [
  "Knees",
  "Hips",
  "Lower back",
  "Shoulders",
  "Elbows",
  "Ankles",
  "None right now",
];

const STEPS = [
  { label: "WHAT ARE WE MEASURING", title: "Pick the movements you train most." },
  { label: "HOW WE FRAME IT", title: "Where are you at?" },
  { label: "WHAT YOU'RE AFTER", title: "What are you training for?" },
  { label: "WHAT TO WATCH", title: "Anything giving you trouble?" },
  { label: "HOW OFTEN", title: "How many sessions a week?" },
] as const;

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { updateProfile } = useAuth();

  const [step, setStep] = useState(0);
  const [sports, setSports] = useState<string[]>([]);
  const [level, setLevel] = useState<string>("");
  const [goals, setGoals] = useState<string[]>([]);
  const [concerns, setConcerns] = useState<string[]>([]);
  const [weekly, setWeekly] = useState(3);
  const [saving, setSaving] = useState(false);

  const canContinue = useMemo(() => {
    if (step === 0) return sports.length > 0;
    if (step === 1) return !!level;
    if (step === 2) return goals.length > 0;
    if (step === 3) return concerns.length > 0;
    return true;
  }, [step, sports, level, goals, concerns]);

  function toggle(list: string[], setList: (v: string[]) => void, item: string, exclusive?: string) {
    if (exclusive && item === exclusive) {
      setList(list.includes(item) ? [] : [item]);
      return;
    }
    const next = list.includes(item)
      ? list.filter((x) => x !== item)
      : [...list.filter((x) => x !== exclusive), item];
    setList(next);
  }

  async function next() {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }

    setSaving(true);
    try {
      await updateProfile({
        // The profile holds one primary sport; the rest ride along as context
        // so Atlas knows the athlete cross-trains.
        sport: sports[0]!.toLowerCase(),
        level: level as "beginner",
        goals: sports.length > 1 ? [...goals, `Also trains: ${sports.slice(1).join(", ")}`] : goals,
        injuryConcerns: concerns.includes("None right now") ? [] : concerns,
        weeklyGoal: weekly,
      });
      router.replace("/(tabs)");
    } catch {
      alert("Couldn't save", "Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const current = STEPS[step]!;

  return (
    <Screen>
      {/* ── Progress ── */}
      <View style={[s.head, { paddingTop: insets.top + 14 }]}>
        <Pressable
          onPress={() => (step === 0 ? router.back() : setStep(step - 1))}
          style={s.backBtn}
          hitSlop={8}
        >
          <Chevron direction="left" tone={color.textPrimary} size={16} />
        </Pressable>

        <View style={s.segments}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={[
                s.segment,
                { backgroundColor: i <= step ? color.ink : color.ruleStrong },
              ]}
            />
          ))}
        </View>

        <Text style={[T.label, { letterSpacing: 1 }]}>
          {String(step + 1).padStart(2, "0")}/{String(STEPS.length).padStart(2, "0")}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 200 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingTop: 40 }}>
          <Label>{current.label}</Label>
          <Text style={[T.headline, { marginTop: 10 }]}>{current.title}</Text>
          <Text style={[T.body, s.sub]}>{subtitleFor(step)}</Text>
        </View>

        <View style={s.chips}>
          {step === 0 &&
            SPORTS.map((sport) => (
              <Chip
                key={sport}
                label={sport}
                selected={sports.includes(sport)}
                onPress={() => toggle(sports, setSports, sport)}
              />
            ))}

          {step === 1 &&
            LEVELS.map((l) => (
              <Pressable
                key={l.key}
                onPress={() => setLevel(l.key)}
                style={({ pressed }) => [
                  s.levelCard,
                  level === l.key && s.levelCardOn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text
                  style={[
                    T.cardTitle,
                    level === l.key && { color: color.onInk },
                  ]}
                >
                  {l.label}
                </Text>
                <Text
                  style={[
                    T.bodySmall,
                    { marginTop: 3 },
                    level === l.key && { color: color.onInkFaint },
                  ]}
                >
                  {l.note}
                </Text>
              </Pressable>
            ))}

          {step === 2 &&
            GOALS.map((goal) => (
              <Chip
                key={goal}
                label={goal}
                selected={goals.includes(goal)}
                onPress={() => toggle(goals, setGoals, goal)}
              />
            ))}

          {step === 3 &&
            CONCERNS.map((concern) => (
              <Chip
                key={concern}
                label={concern}
                selected={concerns.includes(concern)}
                onPress={() => toggle(concerns, setConcerns, concern, "None right now")}
              />
            ))}

          {step === 4 &&
            [2, 3, 4, 5, 6, 7].map((n) => (
              <Chip
                key={n}
                label={`${n} a week`}
                selected={weekly === n}
                onPress={() => setWeekly(n)}
              />
            ))}
        </View>
      </ScrollView>

      {/* ── Footer ── */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 24 }]}>
        <PrimaryButton
          label={
            saving ? "Saving…" : step === STEPS.length - 1 ? "Start measuring" : "Continue"
          }
          onPress={next}
          disabled={!canContinue || saving}
          trailingArrow
        />
        <Text style={s.summary}>{summaryFor(step, { sports, level, goals, concerns, weekly })}</Text>
      </View>
    </Screen>
  );
}

function subtitleFor(step: number): string {
  switch (step) {
    // The measurement is the same instrument for every sport — what your
    // sport changes is the coaching: what Atlas emphasises and the vocabulary
    // it uses. Say that, rather than promising a per-sport joint model the
    // engine does not have.
    case 0:
      return "Your coaching is framed around your sport. Pick as many as you train — you can change this later.";
    case 1:
      return "This only changes how we phrase feedback. The measurements are the same either way.";
    case 2:
      return "Atlas uses this to decide which measurement matters most to you.";
    case 3:
      return "We'll watch these joints more closely and flag them earlier.";
    default:
      return "Used for your weekly target. Nothing is locked — measure whenever you train.";
  }
}

function summaryFor(
  step: number,
  state: { sports: string[]; level: string; goals: string[]; concerns: string[]; weekly: number },
): string {
  if (step === 0) {
    if (state.sports.length === 0) return "Pick at least one";
    return `${state.sports.length} picked · ${state.sports.join(", ")}`;
  }
  if (step === 1) return state.level ? cap(state.level) : "Pick your level";
  if (step === 2) {
    return state.goals.length ? `${state.goals.length} picked` : "Pick at least one";
  }
  if (step === 3) {
    return state.concerns.length ? state.concerns.join(", ") : "Pick at least one";
  }
  return `${state.weekly} sessions a week`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const s = StyleSheet.create({
  head: {
    paddingHorizontal: GUTTER,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.card,
    alignItems: "center",
    justifyContent: "center",
  },
  segments: { flex: 1, flexDirection: "row", gap: 4 },
  segment: { flex: 1, height: 3, borderRadius: 2 },

  sub: { marginTop: 12, maxWidth: 310 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 30 },

  levelCard: {
    width: "100%",
    backgroundColor: color.card,
    borderRadius: 20,
    padding: 16,
  },
  levelCardOn: { backgroundColor: color.ink },

  footer: {
    position: "absolute",
    left: GUTTER,
    right: GUTTER,
    bottom: 0,
    paddingTop: 14,
    backgroundColor: color.paper,
  },
  summary: {
    textAlign: "center",
    marginTop: 14,
    fontFamily: "InstrumentSans_400Regular",
    fontSize: 13,
    color: color.textFaint,
  },
});
