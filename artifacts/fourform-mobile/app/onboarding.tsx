/**
 * Onboarding — five questions, each of which changes what we measure or how we
 * frame it. Nothing here is collected "for personalisation" in the abstract.
 *
 * Multi-select on sport, because most athletes cross-train and the previous
 * single-pick forced a lie. The first pick is stored as the primary sport
 * (that's what the profile column holds); the rest go in `goals` context.
 */

import React, { useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import {
  BackButton,
  Chip,
  FooterFade,
  Label,
  PrimaryButton,
  Screen,
  Text,
  useFooterClearance,
  Tappable,
} from "@/components/caliper";
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

/**
 * The joints an athlete can flag as giving them trouble.
 *
 * This is health data — GDPR Art. 9 special category — so it is the one list in
 * onboarding that is exported rather than kept local. Profile imports it for
 * the row that edits and clears these, and Art. 7(3) requires withdrawal to be
 * as easy as consent: the screen where you take a concern back has to offer
 * exactly the joints you were offered when you gave it. Two copies of this
 * array would drift, and the half that drifts is the half that can no longer
 * un-say something.
 *
 * (Its natural home is `constants/`, next to SPORTS. Left here for now because
 * onboarding is where it is answered.)
 */
export const CONCERN_JOINTS: readonly string[] = [
  "Knees",
  "Hips",
  "Lower back",
  "Shoulders",
  "Elbows",
  "Ankles",
];

/**
 * The affirmative "nothing to report" answer, stored as an empty list.
 *
 * Distinct from skipping the step: this one is an answer. Both end up storing
 * nothing, which is the point — declining to answer must cost the athlete
 * exactly as much as answering.
 */
export const CONCERN_NONE = "None right now";

const CONCERNS: string[] = [...CONCERN_JOINTS, CONCERN_NONE];

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

  const [footerClearance, onFooterLayout] = useFooterClearance({ gap: 20, fallback: 150 });

  const canContinue = useMemo(() => {
    if (step === 0) return sports.length > 0;
    if (step === 1) return !!level;
    if (step === 2) return goals.length > 0;
    // Steps 3 and 4 never block. Step 3 used to: it required a concern to be
    // picked, which made answering a question about your body the only way into
    // the app — and consent you cannot decline is not consent (GDPR Art. 7(4),
    // and these joints are Art. 9 health data). It is skippable now, and the
    // button below reads "Skip" while nothing is picked so the way past it is
    // visible rather than something you have to work out.
    return true;
  }, [step, sports, level, goals]);

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
        // Skipped and "None right now" both store nothing. The athlete can
        // change or clear this later from Profile → Injury concerns.
        injuryConcerns: concerns.includes(CONCERN_NONE) ? [] : concerns,
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
        <BackButton
          onPress={() => (step === 0 ? router.back() : setStep(step - 1))}
          label={step === 0 ? "Back" : `Back to step ${step}`}
        />

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
        // Measured, not a guessed 200: the footer carries a summary line that
        // reads "8 picked · Squat, Deadlift, …" and wraps to several lines as
        // soon as someone picks a few sports, which pushed the last chips
        // underneath it and out of reach.
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: footerClearance }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingTop: 40 }}>
          <Label>{current.label}</Label>
          <Text scale="display" style={[T.headline, { marginTop: 10 }]}>{current.title}</Text>
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
              <Tappable
                key={l.key}
                onPress={() => setLevel(l.key)}
                style={[s.levelCard,
                  level === l.key && s.levelCardOn]}
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
              </Tappable>
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
                onPress={() => toggle(concerns, setConcerns, concern, CONCERN_NONE)}
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
      <View
        style={[s.footer, { paddingBottom: insets.bottom + 24 }]}
        onLayout={onFooterLayout}
      >
        {/* Chips used to be cut in half against the footer's hard top edge. */}
        <FooterFade />
        <PrimaryButton
          // "Skip" on the health-data step while nothing is picked. An enabled
          // "Continue" is not enough on its own: it looks identical to a step
          // you have simply not finished yet, so the athlete still reads the
          // question as something they owe us.
          label={
            saving
              ? "Saving…"
              : step === 3 && concerns.length === 0
                ? "Skip"
                : step === STEPS.length - 1
                  ? "Start measuring"
                  : "Continue"
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
      return "Your coaching is framed around your sport. Pick as many as you train. You can change this later.";
    case 1:
      return "This only changes how we phrase feedback. The measurements are the same either way.";
    case 2:
      return "Atlas uses this to decide which measurement matters most to you.";
    // The only question here that asks about the athlete's body rather than
    // their training, which makes it health data under GDPR Art. 9 and the one
    // step that has to say what it is for before it is answered: who sees it,
    // that it is optional, and that it can be taken back.
    case 3:
      return "We'll watch these joints more closely and flag them earlier, and Atlas sees them so it can coach around them. This one's optional — skip it if you'd rather not say, and change or clear it any time in Profile.";
    default:
      return "Used for your weekly target. Nothing is locked. Measure whenever you train.";
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
    // Not "Pick at least one" any more — the footer line was the last place
    // still telling the athlete this was required.
    return state.concerns.length ? state.concerns.join(", ") : "Optional · nothing recorded";
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
    // Full bleed, then padded in. Inset by GUTTER on each side, the paper fill
    // stopped short of the screen edge and scrolling chips stayed visible in
    // the two margins beside it.
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: GUTTER,
    paddingTop: 14,
    backgroundColor: color.paper,
  },
  summary: { ...T.bodySmall, textAlign: "center", marginTop: 14, color: color.textFaint },
});
