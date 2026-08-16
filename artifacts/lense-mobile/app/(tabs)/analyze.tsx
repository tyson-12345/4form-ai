/**
 * Sessions — the record, and the way in.
 *
 * Splits work-in-progress ("MEASURING") from finished work ("MEASURED") so the
 * athlete can see the instrument is running rather than wondering whether the
 * upload took. The quota reads as segments rather than a number alone, because
 * "2 left" is a more useful shape than "3/5".
 */

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  RefreshControl,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import {
  Screen,
  Card,
  Label,
  Chip,
  Chevron,
  UploadGlyph,
  PrimaryButton,
} from "@/components/caliper";
import { color, type as T, radius, GUTTER, TAB_BAR, font } from "@/constants/caliper";
import { analyses as analysesApi, type AnalysisRecord, type UsageRecord } from "@/lib/api";
import { MIN_CLIP_SECONDS } from "@/lib/poseTracker";
import { deleteVideo } from "@/lib/videoStore";
import { useAuth } from "@/lib/authContext";
import { SPORTS } from "@/constants/sports";
import { alert } from "@/lib/alert";

export default function SessionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();

  const [list, setList] = useState<AnalysisRecord[]>([]);
  const [usage, setUsage] = useState<UsageRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState("");

  const load = useCallback(async () => {
    const [listResult, usageResult] = await Promise.allSettled([
      analysesApi.list(),
      analysesApi.usage(),
    ]);
    if (listResult.status === "fulfilled") setList(listResult.value.analyses);
    if (usageResult.status === "fulfilled") setUsage(usageResult.value);
    setLoaded(true);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Poll only while something is actually being measured.
  const measuring = list.filter((a) => a.status === "processing" || a.status === "pending");
  const measured = list.filter((a) => a.status === "complete" || a.status === "failed");

  useFocusEffect(
    useCallback(() => {
      if (measuring.length === 0) return;
      const id = setInterval(load, 4000);
      return () => clearInterval(id);
    }, [measuring.length, load]),
  );

  async function pickClip() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        alert(
          "Photo access needed",
          "Allow photo and video access in Settings so we can read the clip you want measured.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "videos",
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      const uri = asset?.uri;
      if (!uri) return;

      // Refuse clips that cannot mathematically clear the server's
      // 20-tracked-frame floor. Without this gate a 2-second clip ran the
      // whole measurement, failed, and got a message blaming lighting and
      // camera angle for what was a length problem. The picker reports
      // duration in milliseconds.
      const durationSec = asset.duration != null ? asset.duration / 1000 : null;
      if (durationSec !== null && durationSec < MIN_CLIP_SECONDS) {
        alert(
          "That clip is too short",
          `We need at least ${MIN_CLIP_SECONDS} seconds of footage to measure joint angles. ` +
            "Aim for ten seconds or more of the movement.",
        );
        return;
      }

      setPendingUri(uri);
      setTitle("");
      setSport(profile?.sport ?? "");
      setPickerOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const iCloud = /3164|PHPhotos|could not be completed/i.test(message);
      alert(
        "Couldn't open that clip",
        iCloud
          ? "This video is still in iCloud. Open it in Photos, let it download fully, then try again."
          : "Something went wrong reading that file. Try a different clip.",
      );
    }
  }

  function startMeasuring() {
    if (!sport || !pendingUri) return;

    if (usage && usage.limit !== -1 && usage.remaining <= 0) {
      setPickerOpen(false);
      alert(
        "Monthly limit reached",
        `Your plan measures ${usage.limit} clips a month. Your next ${usage.limit} unlock on ${new Date(usage.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.`,
        [
          { text: "Not now", style: "cancel" },
          { text: "See plans", onPress: () => router.push("/pricing") },
        ],
      );
      return;
    }

    setPickerOpen(false);
    router.push({
      pathname: "/analysis/measure",
      params: { uri: pendingUri, sport: sport.toLowerCase(), title: title.trim() },
    });
  }

  const limit = usage?.limit ?? 3;
  const used = usage?.used ?? 0;
  const unlimited = limit === -1;
  const segments = unlimited ? 0 : limit;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 14,
          paddingBottom: TAB_BAR.clearance + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={color.textFaint}
          />
        }
      >
        <View style={{ paddingHorizontal: GUTTER }}>
          <Text style={T.screenTitle}>Sessions</Text>

          <View style={s.quotaRow}>
            {unlimited ? (
              <View style={s.quotaTrackFull} />
            ) : (
              <View style={s.quotaTrack}>
                {Array.from({ length: segments }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      s.quotaSegment,
                      { backgroundColor: i < used ? color.ink : color.ruleStrong },
                    ]}
                  />
                ))}
              </View>
            )}
            <Text style={[T.label, { letterSpacing: 1 }]}>
              {unlimited ? "UNLIMITED" : `${used} / ${limit} THIS MONTH`}
            </Text>
          </View>
        </View>

        {/* ── Add a clip ── */}
        <Card style={s.addCard} onPress={pickClip}>
          <View style={s.addIcon}>
            <UploadGlyph />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={T.cardTitle}>Add a clip</Text>
            <Text style={[T.bodySmall, { marginTop: 3 }]}>
              Side-on, whole body in frame, 10s or longer.
            </Text>
          </View>
          <Chevron />
        </Card>

        {/* ── In progress ── */}
        {measuring.length > 0 && (
          <View style={s.section}>
            <Label style={{ marginBottom: 10 }}>MEASURING · {measuring.length}</Label>
            {measuring.map((item) => (
              <Card key={item.id} style={s.measuringCard} padded={false}>
                <View style={s.measuringInner}>
                  <View style={s.measuringGlyph}>
                    <View style={[s.bar, { height: 8 }]} />
                    <View style={[s.bar, { height: 14 }]} />
                    <View style={[s.bar, { height: 6 }]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={T.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={[T.label, { color: color.cobalt, marginTop: 3, letterSpacing: 0.8 }]}>
                      TRACKING JOINTS
                    </Text>
                  </View>
                  <ActivityIndicator size="small" color={color.cobalt} />
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* ── Measured ── */}
        <View style={s.section}>
          <Label style={{ marginBottom: 4 }}>MEASURED · {measured.length}</Label>

          {measured.map((item) => (
            <MeasuredRow
              key={item.id}
              item={item}
              onPress={() => router.push(`/analysis/${item.id}`)}
              onDelete={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                alert(item.title, "Delete this session and its clip?", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      try {
                        await analysesApi.delete(item.id);
                        await deleteVideo(item.id);
                        setList((prev) => prev.filter((a) => a.id !== item.id));
                        void load();
                      } catch {
                        alert("Couldn't delete", "Please try again.");
                      }
                    },
                  },
                ]);
              }}
            />
          ))}

          {loaded && measured.length === 0 && measuring.length === 0 && (
            <Text style={[T.body, { marginTop: 10 }]}>
              Nothing measured yet. Add a clip above and we'll track your joints frame by
              frame.
            </Text>
          )}
        </View>
      </ScrollView>

      {/* ── Details sheet ── */}
      <Modal visible={pickerOpen} animationType="slide" presentationStyle="pageSheet">
        <Screen>
          <View style={[s.sheetHead, { paddingTop: 20 }]}>
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={12}>
              <Text style={[T.buttonSmall, { color: color.textMuted }]}>Cancel</Text>
            </Pressable>
            <Label>NEW SESSION</Label>
            <View style={{ width: 48 }} />
          </View>

          <ScrollView
            contentContainerStyle={{ padding: GUTTER, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[T.headlineSmall, { marginBottom: 22 }]}>
              What are we measuring?
            </Text>

            <Label style={{ marginBottom: 8 }}>SPORT</Label>
            <View style={s.chipWrap}>
              {SPORTS.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={sport.toLowerCase() === option.toLowerCase()}
                  onPress={() => setSport(option)}
                />
              ))}
            </View>

            <Label style={{ marginTop: 26, marginBottom: 8 }}>LABEL · OPTIONAL</Label>
            <TextInput
              style={s.input}
              value={title}
              onChangeText={setTitle}
              placeholder={sport ? `e.g. ${exampleFor(sport)}` : "e.g. Morning session"}
              placeholderTextColor={color.textGhost}
              autoCapitalize="sentences"
              maxLength={120}
              returnKeyType="done"
              onSubmitEditing={startMeasuring}
            />

            <View style={{ marginTop: 30 }}>
              <PrimaryButton
                label="Measure this clip"
                onPress={startMeasuring}
                disabled={!sport}
                trailingArrow
              />
              <Text style={[T.bodySmall, { textAlign: "center", marginTop: 14 }]}>
                {sport
                  ? "We'll step through the clip and measure your joint angles. Takes about a minute."
                  : "Pick a sport to continue."}
              </Text>
            </View>
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function MeasuredRow({
  item,
  onPress,
  onDelete,
}: {
  item: AnalysisRecord;
  onPress: () => void;
  onDelete: () => void;
}) {
  const date = new Date(item.uploadedAt);
  const failed = item.status === "failed";
  const unscored = item.analysisMethod === "unscored";
  const legacy = item.analysisMethod === "legacy-unverified";

  const note = failed
    ? "COULDN'T MEASURE"
    : unscored
      ? "NOT TRACKABLE"
      : legacy
        ? "UNVERIFIED"
        : item.sport.toUpperCase();

  const noteTone = failed || unscored ? color.rust : legacy ? color.textFaint : color.textFaint;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onDelete}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
    >
      <View style={s.dateTile}>
        <Text style={[T.measured, { fontSize: 12 }]}>{date.getDate()}</Text>
        <Text style={[T.measuredSmall, { fontSize: 8, letterSpacing: 0.8 }]}>
          {date.toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={T.rowTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[T.measuredSmall, { color: noteTone, marginTop: 3 }]}>{note}</Text>
      </View>

      <Text style={[T.metricRow, item.overallScore === null && { color: color.textGhost }]}>
        {item.overallScore === null ? "–" : Math.round(item.overallScore)}
      </Text>
    </Pressable>
  );
}

/** A label suggestion that fits the chosen sport, so the hint never says "round 4" to a swimmer. */
function exampleFor(sport: string): string {
  const key = sport.toLowerCase();
  if (key.includes("weight") || key.includes("crossfit")) return "Back squat 3×5";
  if (key.includes("run")) return "400m repeats";
  if (key.includes("swim")) return "Freestyle 100m";
  if (key.includes("box") || key.includes("martial")) return "Heavy bag, 3 rounds";
  if (key.includes("golf")) return "Driver, range session";
  if (key.includes("tennis")) return "Serve practice";
  if (key.includes("basketball")) return "Jump shot form";
  if (key.includes("soccer") || key.includes("football")) return "Shooting drill";
  if (key.includes("gymnastic")) return "Handstand holds";
  return "Morning session";
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  quotaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  quotaTrack: { flex: 1, flexDirection: "row", gap: 3 },
  quotaTrackFull: { flex: 1, height: 6, borderRadius: 3, backgroundColor: color.ink },
  quotaSegment: { flex: 1, height: 6, borderRadius: 3 },

  addCard: {
    marginHorizontal: GUTTER,
    marginTop: 20,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  addIcon: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
  },

  section: { paddingHorizontal: GUTTER, paddingTop: 24 },

  measuringCard: { marginBottom: 8, borderRadius: radius.cardSmall },
  measuringInner: {
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  measuringGlyph: {
    width: 40,
    height: 40,
    borderRadius: radius.icon,
    backgroundColor: color.paper,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 2,
    paddingBottom: 12,
  },
  bar: { width: 3, backgroundColor: color.cobalt, borderRadius: 1 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
  },
  dateTile: {
    width: 42,
    height: 42,
    borderRadius: radius.icon,
    backgroundColor: color.card,
    alignItems: "center",
    justifyContent: "center",
  },

  sheetHead: {
    paddingHorizontal: GUTTER,
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
