/**
 * Profile — who you are, what you've measured, and the controls.
 *
 * Includes in-app account deletion, which both app stores require of any app
 * that lets you create an account in-app. It is deliberately friction-heavy:
 * typed confirmation plus password re-entry, because it cannot be undone.
 */

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { Screen, Card, Label, Chip, Chevron, Avatar, PrimaryButton } from "@/components/caliper";
import { color, type as T, radius, GUTTER, TAB_BAR, font } from "@/constants/caliper";
import { PRIVACY_POLICY_URL, TERMS_URL, openLegal } from "@/constants/legal";
import { useAuth } from "@/lib/authContext";
import {
  analyses as analysesApi,
  profile as profileApi,
  type AnalysisRecord,
  type UsageRecord,
  ApiError,
} from "@/lib/api";
import { SPORTS, displaySport } from "@/constants/sports";

const LEVELS = ["Beginner", "Intermediate", "Advanced", "Elite"] as const;

type EditField = "name" | "sport" | "level" | "weeklyGoal" | null;

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, profile, subscription, logout, updateProfile } = useAuth();

  const [sessions, setSessions] = useState<AnalysisRecord[]>([]);
  const [usage, setUsage] = useState<UsageRecord | null>(null);
  const [edit, setEdit] = useState<EditField>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    const [list, u] = await Promise.allSettled([analysesApi.list(), analysesApi.usage()]);
    if (list.status === "fulfilled") setSessions(list.value.analyses);
    if (u.status === "fulfilled") setUsage(u.value);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const measured = sessions.filter(
    (a) => a.status === "complete" && a.analysisMethod === "pose-measured",
  );

  // Flags closed = sessions where an earlier improvement no longer appears.
  const flagsClosed = Math.max(
    0,
    new Set(
      sessions.flatMap((a) => (a.improvements ?? []).slice(0, 1)),
    ).size - (measured[0]?.improvements?.length ?? 0),
  );

  const displayName = profile?.name || user?.name || "Athlete";
  const tier = subscription?.tier ?? "free";

  function openEdit(field: Exclude<EditField, null>) {
    setEdit(field);
    setValue(
      field === "name"
        ? (profile?.name ?? "")
        : field === "sport"
          ? displaySport(profile?.sport)
          : field === "level"
            ? (profile?.level ?? "beginner")
            : String(profile?.weeklyGoal ?? 3),
    );
  }

  async function save(override?: string) {
    const next = (override ?? value).trim();
    if (!next || !edit) return;

    setSaving(true);
    try {
      if (edit === "name") await updateProfile({ name: next });
      else if (edit === "sport") await updateProfile({ sport: next.toLowerCase() });
      else if (edit === "level")
        await updateProfile({ level: next.toLowerCase() as "beginner" });
      else if (edit === "weeklyGoal") await updateProfile({ weeklyGoal: Number(next) });
      setEdit(null);
    } catch {
      Alert.alert("Couldn't save", "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 14,
          paddingBottom: TAB_BAR.clearance + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Identity ── */}
        <View style={s.identity}>
          <Avatar name={displayName} size={62} />
          <View style={{ flex: 1 }}>
            <Text style={[T.metricMedium, { fontSize: 24 }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[T.bodySmall, { marginTop: 2 }]} numberOfLines={1}>
              {user?.email}
            </Text>
          </View>
        </View>

        {/* ── Counts ── */}
        <View style={s.stats}>
          <Stat value={measured.length} label="MEASURED" />
          <Stat value={profile?.streakDays ?? 0} label="DAY STREAK" />
          <Stat value={flagsClosed} label="FLAGS CLOSED" tone={color.cobalt} />
        </View>

        {/* ── Training ── */}
        <View style={s.section}>
          <Label style={{ marginBottom: 10 }}>TRAINING</Label>
          <Card padded={false} style={{ paddingHorizontal: 18 }}>
            <Row label="Name" value={displayName} onPress={() => openEdit("name")} />
            <Row
              label="Sport"
              value={displaySport(profile?.sport) || "Not set"}
              onPress={() => openEdit("sport")}
            />
            <Row
              label="Level"
              value={cap(profile?.level ?? "beginner")}
              onPress={() => openEdit("level")}
            />
            <Row
              label="Weekly goal"
              value={`${profile?.weeklyGoal ?? 3} sessions`}
              onPress={() => openEdit("weeklyGoal")}
              last
            />
          </Card>
        </View>

        {/* ── Plan ── */}
        <Pressable
          onPress={() => router.push("/pricing")}
          style={({ pressed }) => [s.plan, pressed && { opacity: 0.9 }]}
        >
          <View style={{ flex: 1 }}>
            <Label tone={color.onInkFaint}>
              {tier.toUpperCase()} PLAN
              {usage && usage.limit !== -1 ? ` · ${usage.remaining} CLIPS LEFT` : ""}
            </Label>
            <Text style={[T.cardTitle, { color: color.onInk, marginTop: 6, fontSize: 18 }]}>
              Measure everything you train
            </Text>
          </View>
          <View style={s.planCta}>
            <Text style={[T.buttonSmall, { color: color.onCobalt }]}>Plans</Text>
          </View>
        </Pressable>

        {/* ── App ── */}
        <View style={s.section}>
          <Label style={{ marginBottom: 10 }}>APP</Label>
          <Card padded={false} style={{ paddingHorizontal: 18 }}>
            <Row
              label="How measurement works"
              onPress={() =>
                Alert.alert(
                  "How measurement works",
                  "We track 33 body landmarks in your clip using on-device pose detection, then measure the angle at each joint across evenly-spaced frames.\n\nScores are calculated from those angles — the same clip always produces the same numbers.\n\nWe only score what a single camera can actually measure: technique, balance, consistency and mobility. Things like power and speed need your body mass and the camera's distance, so we don't guess at them.",
                )
              }
            />
            <Row
              label="How your data is handled"
              onPress={() =>
                Alert.alert(
                  "Your data",
                  "Your videos never leave your device — only the measured joint angles are sent to our server.\n\nDeleting a session removes its clip from your phone. Deleting your account removes everything.",
                )
              }
            />
            {/* The hosted documents, not a summary of them. Both stores check
                that these are reachable from inside the app during review. */}
            <Row
              label="Privacy Policy"
              onPress={() => void openLegal(PRIVACY_POLICY_URL, "Privacy Policy")}
            />
            <Row
              label="Terms of Service"
              onPress={() => void openLegal(TERMS_URL, "Terms of Service")}
            />
            <Row
              label="Support"
              onPress={() => void Linking.openURL("mailto:support@athleteai.app")}
            />
            <Row label="Version" value="1.0.0" last />
          </Card>
        </View>

        {/* ── Account ── */}
        <View style={s.section}>
          <Label style={{ marginBottom: 10 }}>ACCOUNT</Label>
          <Card padded={false} style={{ paddingHorizontal: 18 }}>
            <Row
              label="Sign out"
              onPress={() =>
                Alert.alert("Sign out", "You can sign back in any time.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Sign out",
                    style: "destructive",
                    onPress: async () => {
                      await logout();
                      router.replace("/");
                    },
                  },
                ])
              }
            />
            <Row
              label="Delete account"
              tone={color.rust}
              onPress={() => setDeleteOpen(true)}
              last
            />
          </Card>
        </View>
      </ScrollView>

      {/* ── Edit sheet ── */}
      <Modal visible={edit !== null} animationType="slide" presentationStyle="pageSheet">
        <Screen>
          <View style={s.sheetHead}>
            <Pressable onPress={() => setEdit(null)} hitSlop={12}>
              <Text style={[T.buttonSmall, { color: color.textMuted }]}>Cancel</Text>
            </Pressable>
            <Label>{(edit ?? "").toUpperCase()}</Label>
            <View style={{ width: 48 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: GUTTER }} keyboardShouldPersistTaps="handled">
            {edit === "sport" && (
              <View style={s.chipWrap}>
                {SPORTS.map((sport) => (
                  <Chip
                    key={sport}
                    label={sport}
                    selected={value.toLowerCase() === sport.toLowerCase()}
                    onPress={() => {
                      setValue(sport);
                      void save(sport);
                    }}
                  />
                ))}
              </View>
            )}

            {edit === "level" && (
              <View style={s.chipWrap}>
                {LEVELS.map((level) => (
                  <Chip
                    key={level}
                    label={level}
                    selected={value.toLowerCase() === level.toLowerCase()}
                    onPress={() => {
                      setValue(level);
                      void save(level);
                    }}
                  />
                ))}
              </View>
            )}

            {edit === "weeklyGoal" && (
              <View style={s.chipWrap}>
                {[2, 3, 4, 5, 6, 7].map((n) => (
                  <Chip
                    key={n}
                    label={`${n} a week`}
                    selected={value === String(n)}
                    onPress={() => {
                      setValue(String(n));
                      void save(String(n));
                    }}
                  />
                ))}
              </View>
            )}

            {edit === "name" && (
              <>
                <TextInput
                  style={s.input}
                  value={value}
                  onChangeText={setValue}
                  placeholder="Your name"
                  placeholderTextColor={color.textGhost}
                  autoFocus
                  maxLength={80}
                  returnKeyType="done"
                  onSubmitEditing={() => save()}
                />
                <View style={{ marginTop: 24 }}>
                  <PrimaryButton
                    label={saving ? "Saving…" : "Save"}
                    onPress={() => save()}
                    disabled={saving || !value.trim()}
                  />
                </View>
              </>
            )}
          </ScrollView>
        </Screen>
      </Modal>

      <DeleteAccountSheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={async () => {
          await logout();
          router.replace("/");
        }}
      />
    </Screen>
  );
}

// ─── Delete account ──────────────────────────────────────────────────────────

function DeleteAccountSheet({
  visible,
  onClose,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armed = confirm.trim().toUpperCase() === "DELETE" && password.length > 0;

  async function run() {
    setWorking(true);
    setError(null);
    try {
      await profileApi.deleteAccount(password);
      onDeleted();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "That password doesn't match."
          : "We couldn't delete your account. Please try again.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <Screen>
        <View style={s.sheetHead}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[T.buttonSmall, { color: color.textMuted }]}>Cancel</Text>
          </Pressable>
          <Label>DELETE ACCOUNT</Label>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: GUTTER }} keyboardShouldPersistTaps="handled">
          <Text style={T.headlineSmall}>This can't be undone.</Text>

          <Text style={[T.body, { marginTop: 14 }]}>
            Deleting your account permanently removes your measurements, sessions, coaching
            notes, progress history, and chat with Atlas. Clips stored on this phone are
            removed too.
          </Text>

          <Label style={{ marginTop: 28, marginBottom: 8 }}>TYPE DELETE TO CONFIRM</Label>
          <TextInput
            style={s.input}
            value={confirm}
            onChangeText={setConfirm}
            placeholder="DELETE"
            placeholderTextColor={color.textGhost}
            autoCapitalize="characters"
            autoCorrect={false}
          />

          <Label style={{ marginTop: 20, marginBottom: 8 }}>YOUR PASSWORD</Label>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={color.textGhost}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
          />

          {error && (
            <Text style={[T.bodySmall, { color: color.rust, marginTop: 12 }]}>{error}</Text>
          )}

          <View style={{ marginTop: 28 }}>
            <PrimaryButton
              label={working ? "Deleting…" : "Delete my account"}
              onPress={run}
              disabled={!armed || working}
              tone={color.rust}
              labelTone={color.onCobalt}
            />
          </View>

          {working && <ActivityIndicator style={{ marginTop: 16 }} color={color.rust} />}
        </ScrollView>
      </Screen>
    </Modal>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Stat({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <View style={s.stat}>
      <Text style={[T.metricMedium, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={[T.measuredSmall, { marginTop: 3, letterSpacing: 1.2 }]}>{label}</Text>
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
  last = false,
  tone,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
  tone?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [s.row, last && { borderBottomWidth: 0 }, pressed && { opacity: 0.6 }]}
    >
      <Text style={[T.rowTitle, { flex: 1, fontSize: 15 }, tone ? { color: tone } : null]}>
        {label}
      </Text>
      {value && <Text style={[T.measured, { fontSize: 11, color: color.textMuted }]}>{value}</Text>}
      {onPress && <Chevron />}
    </Pressable>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  identity: { paddingHorizontal: GUTTER, flexDirection: "row", alignItems: "center", gap: 16 },
  stats: { flexDirection: "row", gap: 10, paddingHorizontal: GUTTER, paddingTop: 20 },
  stat: { flex: 1, backgroundColor: color.card, borderRadius: radius.tile, padding: 14 },

  section: { paddingHorizontal: GUTTER, paddingTop: 22 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: color.ruleFaint,
  },

  plan: {
    marginHorizontal: GUTTER,
    marginTop: 18,
    backgroundColor: color.ink,
    borderRadius: radius.card,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  planCta: {
    backgroundColor: color.cobalt,
    borderRadius: radius.pill,
    paddingHorizontal: 15,
    paddingVertical: 9,
  },

  sheetHead: {
    paddingHorizontal: GUTTER,
    paddingTop: 20,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: {
    backgroundColor: color.card,
    borderRadius: radius.cardSmall,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontFamily: font.body,
    fontSize: 15,
    color: color.textPrimary,
  },
});
