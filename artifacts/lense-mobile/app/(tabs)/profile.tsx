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
  StyleSheet,
  ScrollView,
  Platform,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Svg, { Path as SvgPath, Circle as SvgCircle } from "react-native-svg";

import {
  Avatar,
  Card,
  Chevron,
  Chip,
  Label,
  PrimaryButton,
  Screen,
  Sheet,
  StatusBarScrim,
  Text,
} from "@/components/caliper";
import { color, type as T, radius, GUTTER, TAB_BAR, font } from "@/constants/caliper";
import { PRIVACY_POLICY_URL, TERMS_URL, openLegal, openSupport } from "@/constants/legal";
import { useAuth } from "@/lib/authContext";
import {
  analyses as analysesApi,
  profile as profileApi,
  type AnalysisRecord,
  type UsageRecord,
  ApiError,
} from "@/lib/api";
import { SPORTS, displaySport } from "@/constants/sports";
import { closedFlagCount } from "@/utils/closedFlags";
import { alert } from "@/lib/alert";

const LEVELS = ["Beginner", "Intermediate", "Advanced", "Elite"] as const;

type EditField = "name" | "sport" | "level" | "weeklyGoal" | null;

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, profile, subscription, logout, updateProfile, avatarUri, setAvatarPhoto, removeAvatarPhoto } =
    useAuth();

  const [sessions, setSessions] = useState<AnalysisRecord[]>([]);
  const [usage, setUsage] = useState<UsageRecord | null>(null);
  const [edit, setEdit] = useState<EditField>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);

  /**
   * Pick a square-cropped photo from the library and store it on-device.
   * The photo never leaves the phone — see lib/avatarStore.ts.
   */
  async function choosePhoto() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        alert(
          "Photo access needed",
          "Allow photo access in Settings so you can pick a profile photo.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        // Web stores the photo as a data URI; native copies the file.
        base64: Platform.OS === "web",
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset?.uri) return;

      await setAvatarPhoto(asset.uri, asset.base64);
      setPhotoOpen(false);
    } catch {
      alert("Couldn't set that photo", "Please try a different image.");
    }
  }

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

  // One definition, shared with Progress — see utils/closedFlags. This used to
  // be computed inline here from unrelated quantities and reported 3 while
  // Progress, on the same account at the same moment, listed 1.
  const flagsClosed = closedFlagCount(sessions);

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
    // Chip taps called this with no in-flight guard, so a slow PATCH invited a
    // second tap and a second write.
    if (saving) return;

    setSaving(true);
    try {
      if (edit === "name") await updateProfile({ name: next });
      else if (edit === "sport") await updateProfile({ sport: next.toLowerCase() });
      else if (edit === "level")
        await updateProfile({ level: next.toLowerCase() as "beginner" });
      else if (edit === "weeklyGoal") await updateProfile({ weeklyGoal: Number(next) });
      setEdit(null);
    } catch {
      alert("Couldn't save", "Please try again.");
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
          <Pressable
            onPress={() => setPhotoOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            style={({ pressed }) => pressed && { opacity: 0.8 }}
          >
            <Avatar name={displayName} uri={avatarUri} size={62} />
            {/* The affordance that makes the avatar read as editable. */}
            <View style={s.avatarBadge}>
              <CameraGlyph />
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text scale="display" style={[T.metricMedium, { fontSize: 24 }]} numberOfLines={1}>
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
          accessibilityRole="button"
          accessibilityLabel={`${tier} plan. See plans.`}
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
                alert(
                  "How measurement works",
                  "We track 33 body landmarks in your clip using on-device pose detection, then measure the angle at each joint across evenly-spaced frames.\n\nScores are calculated from those angles, so the same clip always produces the same numbers.\n\nWe only score what a single camera can actually measure: technique, balance, consistency and mobility. Things like power and speed need your body mass and the camera's distance, so we don't guess at them.",
                )
              }
            />
            <Row
              label="How your data is handled"
              onPress={() =>
                alert(
                  "Your data",
                  "Your videos never leave your device. Only the measured joint angles are sent to our server.\n\nDeleting a session removes its clip from your phone. Deleting your account removes everything.",
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
              onPress={() => void openSupport()}
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
                alert("Sign out", "You can sign back in any time.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Sign out",
                    style: "destructive",
                    onPress: async () => {
                      await logout();
                      router.replace("/welcome");
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
      <Sheet
        visible={edit !== null}
        onClose={() => setEdit(null)}
        title={(edit ?? "").toUpperCase()}
      >
        {edit === "sport" && (
          <View style={s.chipWrap}>
            {SPORTS.map((sport) => (
              <Chip
                key={sport}
                label={sport}
                selected={value.toLowerCase() === sport.toLowerCase()}
                onPress={saving ? undefined : () => {
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
                onPress={saving ? undefined : () => {
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
                onPress={saving ? undefined : () => {
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
      </Sheet>

      {/* ── Photo sheet ── */}
      <Sheet
        visible={photoOpen}
        onClose={() => setPhotoOpen(false)}
        title="PROFILE PHOTO"
        scroll={false}
      >
        <View style={{ padding: GUTTER, alignItems: "center" }}>
          <Avatar name={displayName} uri={avatarUri} size={120} />
          <Text style={[T.bodySmall, { marginTop: 16, textAlign: "center", maxWidth: 280 }]}>
            Your photo stays on this phone. It&apos;s never uploaded.
          </Text>

          <View style={{ alignSelf: "stretch", marginTop: 28, gap: 10 }}>
            <PrimaryButton
              label={avatarUri ? "Choose a different photo" : "Choose a photo"}
              onPress={() => void choosePhoto()}
            />
            {avatarUri && (
              <PrimaryButton
                label="Remove photo"
                tone={color.card}
                labelTone={color.rust}
                onPress={() => {
                  void removeAvatarPhoto();
                  setPhotoOpen(false);
                }}
              />
            )}
          </View>
        </View>
      </Sheet>

      {/* Mounted only while open. The sheet holds a typed password and a typed
          confirmation in its own state, and a permanently-mounted component
          keeps both after it closes — reopening it showed a pre-armed form with
          the password still filled in. Unmounting is the guarantee; remembering
          to clear on close is not. */}
      {deleteOpen && (
        <DeleteAccountSheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
          onDeleted={async () => {
            // Deleting the account deletes everything — the device-local photo
            // included. Must run before logout clears the user id it is keyed by.
            await removeAvatarPhoto().catch(() => {});
            await logout();
            router.replace("/welcome");
          }}
        />
      )}
      {/* Paints over content that scrolls under the status bar. */}
      <StatusBarScrim />
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
    <Sheet visible={visible} onClose={onClose} title="DELETE ACCOUNT">
      <Text scale="display" style={T.headlineSmall}>This can&apos;t be undone.</Text>

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
        accessibilityLabel="Type DELETE to confirm"
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
        accessibilityLabel="Your password"
      />

      {error && (
        <Text
          style={[T.bodySmall, { color: color.rust, marginTop: 12 }]}
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
        >
          {error}
        </Text>
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
    </Sheet>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/** Small camera mark for the avatar's edit badge — drawn, not an icon font. */
function CameraGlyph() {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24">
      <SvgPath
        d="M4 8 h3 l2-2.5 h6 L17 8 h3 a1.5 1.5 0 0 1 1.5 1.5 v9 a1.5 1.5 0 0 1 -1.5 1.5 H4 a1.5 1.5 0 0 1 -1.5 -1.5 v-9 A1.5 1.5 0 0 1 4 8 Z"
        fill="none"
        stroke={color.onCobalt}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      <SvgCircle cx={12} cy={13.5} r={3.4} fill="none" stroke={color.onCobalt} strokeWidth={2.4} />
    </Svg>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    // Grouped: the number and its label are one fact, and read as two
    // disconnected nodes otherwise ("7" … "MEASURED").
    <View style={s.stat} accessible accessibilityLabel={`${value} ${label.toLowerCase()}`}>
      <Text scale="display" style={[T.metricMedium, tone ? { color: tone } : null]}>{value}</Text>
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
      // A non-pressable Row (the version line) is not a button and must not
      // announce as one.
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? (value ? `${label}, ${value}` : label) : undefined}
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
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.cobalt,
    borderWidth: 2,
    borderColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
  },
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
