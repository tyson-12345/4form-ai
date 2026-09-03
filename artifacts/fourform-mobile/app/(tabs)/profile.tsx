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
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";

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
  CameraGlyph,
  Toast,
  Entering,
  TextField,
  Tappable,
} from "@/components/caliper";
import { color, type as T, radius, GUTTER, TAB_BAR, font } from "@/constants/caliper";
import { PRIVACY_POLICY_URL, TERMS_URL, openLegal, openSupport } from "@/constants/legal";
import { useAuth } from "@/lib/authContext";
import {
  analyses as analysesApi,
  profile as profileApi,
  type AnalysisRecord,
  type DeleteAccountProof,
  type UsageRecord,
  ApiError,
} from "@/lib/api";
import { SocialSignIn } from "@/components/SocialSignIn";
import { clearAllVideos } from "@/lib/videoStore";
import { SPORTS, displaySport } from "@/constants/sports";
// The same joints onboarding offers, from onboarding's own list — see the note
// there. The screen where you withdraw a concern must offer exactly the ones
// you were offered when you gave it.
import { CONCERN_JOINTS } from "@/app/onboarding";
import { closedFlagCount } from "@/utils/closedFlags";
import { alert } from "@/lib/alert";

const LEVELS = ["Beginner", "Intermediate", "Advanced", "Elite"] as const;

type EditField = "name" | "sport" | "level" | "weeklyGoal" | "injuryConcerns" | null;

/** What the confirmation calls each field. Spoken as well as shown. */
const LABELS: Record<Exclude<EditField, null>, string> = {
  name: "Name",
  sport: "Sport",
  level: "Level",
  weeklyGoal: "Weekly goal",
  injuryConcerns: "Injury concerns",
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, profile, subscription, logout, updateProfile, avatarUri, setAvatarPhoto, removeAvatarPhoto } =
    useAuth();

  const [sessions, setSessions] = useState<AnalysisRecord[]>([]);
  const [usage, setUsage] = useState<UsageRecord | null>(null);
  const [edit, setEdit] = useState<EditField>(null);
  const [value, setValue] = useState("");
  /** Injury concerns are multi-select, so they need a list, not `value`. */
  const [concerns, setConcerns] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

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

  /**
   * The joints offered in the concerns sheet: the current list, plus anything
   * already stored that is no longer on it. A stored value with no chip could
   * not be seen and could not be taken off — and would be dropped silently by
   * the next save of a different concern, which is the account quietly editing
   * the athlete's health record on their behalf.
   */
  const concernOptions = [
    ...CONCERN_JOINTS,
    ...concerns.filter((c) => !CONCERN_JOINTS.includes(c)),
  ];

  const displayName = profile?.name || user?.name || "Athlete";
  const tier = subscription?.tier ?? "free";

  function openEdit(field: Exclude<EditField, null>) {
    setEdit(field);

    if (field === "injuryConcerns") {
      setConcerns(profile?.injuryConcerns ?? []);
      return;
    }

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
      // Saving used to succeed in complete silence: the sheet closed and
      // nothing else happened, so "saved" and "quietly failed and closed
      // anyway" looked identical.
      setEdit(null);
      setSaved(LABELS[edit] ?? "Saved");
    } catch {
      alert("Couldn't save", "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Injury concerns save on their own path rather than through `save()` above,
   * because that function refuses an empty value — and empty is the entire
   * point of this one.
   *
   * These joints are special-category health data (GDPR Art. 9(2)(a)), and
   * Art. 7(3) requires withdrawing that consent to be as easy as giving it.
   * Onboarding has always collected them and `PATCH /api/profile` has always
   * accepted them, but no screen ever sent the field — so until this row
   * existed, the only way to take back something you said about your knees was
   * to delete the entire account. That is not "as easy".
   */
  async function saveConcerns(next: string[]) {
    if (saving) return;

    setSaving(true);
    try {
      await updateProfile({ injuryConcerns: next });
      setEdit(null);
      setSaved(LABELS.injuryConcerns);
    } catch {
      alert("Couldn't save", "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Toast
        message={saved ? `${saved} updated` : ""}
        visible={!!saved}
        onHide={() => setSaved(null)}
        bottomInset={TAB_BAR.clearance + insets.bottom}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 14,
          paddingBottom: TAB_BAR.clearance + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Identity ── */}
        <View style={s.identity}>
          <Tappable
            onPress={() => setPhotoOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"

          >
            <Avatar name={displayName} uri={avatarUri} size={62} />
            {/* The affordance that makes the avatar read as editable. */}
            <View style={s.avatarBadge}>
              <CameraGlyph />
            </View>
          </Tappable>
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
        <Entering index={1} style={s.section}>
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
            />
            {/* The withdrawal control for the health data onboarding collects.
                It sits in TRAINING rather than under a privacy heading on
                purpose: this is where you already come to change what the
                coaching is built on, and consent you have to go hunting for is
                not meaningfully withdrawable. */}
            <Row
              label="Injury concerns"
              value={concernSummary(profile?.injuryConcerns)}
              onPress={() => openEdit("injuryConcerns")}
              last
            />
          </Card>
        </Entering>

        {/* ── Plan ── */}
        <Tappable
          onPress={() => router.push("/pricing")}
          accessibilityRole="button"
          accessibilityLabel={`${tier} plan. See plans.`}
          style={[s.plan]}
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
        </Tappable>

        {/* ── App ── */}
        <Entering index={2} style={s.section}>
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
        </Entering>

        {/* ── Account ── */}
        <Entering index={3} style={s.section}>
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
        </Entering>
      </ScrollView>

      {/* ── Edit sheet ── */}
      <Sheet
        visible={edit !== null}
        onClose={() => setEdit(null)}
        // The field's own name, not the state key: upper-casing the key gave
        // "WEEKLYGOAL", and would have given "INJURYCONCERNS".
        title={edit ? LABELS[edit].toUpperCase() : ""}
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

        {edit === "injuryConcerns" && (
          <>
            <Text style={T.body}>
              Anything giving you trouble? We watch these joints more closely and flag
              them earlier, and Atlas sees them so it can coach around them.
            </Text>
            <Text style={[T.bodySmall, { marginTop: 10, marginBottom: 20 }]}>
              Leave none selected and we hold nothing here.
            </Text>

            <View style={s.chipWrap}>
              {concernOptions.map((joint) => (
                <Chip
                  key={joint}
                  label={joint}
                  selected={concerns.includes(joint)}
                  onPress={saving ? undefined : () =>
                    setConcerns(
                      concerns.includes(joint)
                        ? concerns.filter((c) => c !== joint)
                        : [...concerns, joint],
                    )
                  }
                />
              ))}
            </View>

            <View style={{ marginTop: 24 }}>
              {/* Never disabled on an empty selection — that is the withdrawal,
                  and a greyed-out button would be the same dead end as the
                  onboarding step that would not let you past without an answer.
                  The label says which of the two things it is about to do. */}
              <PrimaryButton
                label={saving ? "Saving…" : concerns.length ? "Save" : "Clear and save"}
                onPress={() => void saveConcerns(concerns)}
                disabled={saving}
              />
            </View>
          </>
        )}

        {edit === "name" && (
          <>
            <TextField
              label="Name"
              value={value}
              onChangeText={setValue}
              placeholder="Your name"
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
            // and every stored clip included. Must run before logout clears the
            // user id the avatar is keyed by.
            //
            // The clips were the omission: the sheet's own copy two screens down
            // says "Clips stored on this phone are removed too", and until this
            // line existed that was simply untrue. Video of the user's body is
            // the most personal thing this app holds, and it was surviving the
            // deletion that had just told them it was gone.
            await removeAvatarPhoto().catch(() => {});
            await clearAllVideos().catch(() => {});
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
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Which proof this account can actually offer.
   *
   * An account created through Sign in with Apple or Google has no password —
   * `users.password_hash` is NULL — so asking it for one produces a form that
   * can never be satisfied. That is what shipped: the sheet armed only on a
   * typed password and sent a password-only body, so every federated user was
   * structurally unable to delete their account. Both stores require in-app
   * deletion for any app offering in-app sign-up, and the server had
   * implemented the provider-token proof for exactly this case — the client
   * simply never used it.
   *
   * `hasPassword` arrives with `GET /auth/me`, so it is undefined until the
   * first refresh lands. Undefined is treated as "ask for a password", which is
   * the safe default: it is right for every password account, and a federated
   * user in that window sees the provider button as soon as the refresh
   * completes rather than a broken form forever.
   */
  const usesPassword = user?.hasPassword !== false;

  const confirmed = confirm.trim().toUpperCase() === "DELETE";
  const armed = confirmed && (usesPassword ? password.length > 0 : true);

  async function run(proof: DeleteAccountProof) {
    setWorking(true);
    setError(null);
    try {
      await profileApi.deleteAccount(proof);
      onDeleted();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? usesPassword
            ? "That password doesn't match."
            : "We couldn't confirm that sign-in. Please try again."
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

      <TextField
        label="Type DELETE to confirm"
        containerStyle={{ marginTop: 28 }}
        value={confirm}
        onChangeText={setConfirm}
        placeholder="DELETE"
        autoCapitalize="characters"
        autoCorrect={false}
      />

      {usesPassword ? (
        <TextField
          label="Your password"
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          secure
          autoCapitalize="none"
          autoComplete="current-password"
          containerStyle={{ marginTop: 20 }}
        />
      ) : (
        <Text style={[T.bodySmall, { marginTop: 20, color: color.onInkMuted }]}>
          Your account signs in with Apple or Google, so there is no password to
          type. Confirm below by signing in with the same provider.
        </Text>
      )}

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
        {usesPassword ? (
          <PrimaryButton
            label={working ? "Deleting…" : "Delete my account"}
            onPress={() => run({ password })}
            disabled={!armed || working}
            tone={color.rust}
            labelTone={color.onCobalt}
          />
        ) : (
          /**
           * The provider button *is* the confirm button here: completing the
           * sign-in produces the proof and the deletion runs on the credential.
           * Held back until DELETE is typed so the provider sheet cannot be the
           * first thing that happens.
           */
          confirmed && (
            <SocialSignIn
              busy={working}
              onStart={() => setError(null)}
              onError={(message) => setError(message)}
              onCredential={(credential) =>
                run({
                  provider: credential.provider,
                  identityToken: credential.identityToken,
                })
              }
            />
          )
        )}
      </View>

      {working && <ActivityIndicator style={{ marginTop: 16 }} color={color.rust} />}
    </Sheet>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/** Small camera mark for the avatar's edit badge — drawn, not an icon font. */
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
  const body = (
    <>
      <Text style={[T.rowTitle, { flex: 1, fontSize: 15 }, tone ? { color: tone } : null]}>
        {label}
      </Text>
      {value && <Text style={[T.measured, { fontSize: 11, color: color.textMuted }]}>{value}</Text>}
      {onPress && <Chevron />}
    </>
  );
  const style = [s.row, last && { borderBottomWidth: 0 }];

  /**
   * A row with nothing to do is a line of information, not a dead control.
   *
   * It used to render as `<Tappable disabled>` with the role stripped, which
   * announced correctly but is still a *disabled control* to everything that
   * styles one — so once the disabled dim started working, the version number
   * faded to 40%. "Version 1.0.0" is not unavailable; it is just a fact.
   */
  if (!onPress) return <View style={style}>{body}</View>;

  return (
    <Tappable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={style}
    >
      {body}
    </Tappable>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What the row shows for the stored concerns.
 *
 * A row value sits on one line beside its label and does not wrap, so all six
 * joints spelled out would shove "Injury concerns" off its own row. Up to two
 * are named; beyond that it counts, and the sheet says which. "None" is a real
 * state and reads as one — not an empty column that looks like a value failed
 * to load.
 */
function concernSummary(list: string[] | undefined): string {
  if (!list || list.length === 0) return "None";
  if (list.length <= 2) return list.join(", ");
  return `${list.length} areas`;
}

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
});
