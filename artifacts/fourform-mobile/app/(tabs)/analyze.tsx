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
  StyleSheet,
  ScrollView,
  RefreshControl,
  TextInput,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as haptics from "@/lib/haptics";

import {
  Card,
  Chevron,
  Chip,
  Label,
  MiniBand,
  PrimaryButton,
  Screen,
  Sheet,
  Meter,
  EmptyState,
  Entering,
  TextField,
  UploadGlyph,
  StatusBarScrim,
  Text,
  Tappable,
} from "@/components/caliper";
import { color, type as T, radius, GUTTER, TAB_BAR, font } from "@/constants/caliper";
import { usualBand } from "@/utils/usualBand";
import { analyses as analysesApi, type AnalysisRecord, type UsageRecord } from "@/lib/api";
import { MIN_CLIP_SECONDS } from "@/lib/poseTracker";
import { deleteVideo } from "@/lib/videoStore";
import { useAuth } from "@/lib/authContext";
import { SPORTS } from "@/constants/sports";
import { SportScience } from "@/components/SportScience";
import { alert } from "@/lib/alert";

/**
 * Above this many, the segmented quota bar stops being readable and becomes a
 * proportional one instead.
 */
const MAX_QUOTA_SEGMENTS = 12;

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

  // The athlete's working band — same derivation as Home, so a row's mini
  // scale here and the hero scale there can never disagree.
  const scores = measured
    .filter((a) => a.analysisMethod === "pose-measured" && a.overallScore !== null)
    .map((a) => a.overallScore!);
  const band = usualBand(scores);
  const bestId =
    scores.length < 2
      ? null
      : measured
          .filter((a) => a.analysisMethod === "pose-measured" && a.overallScore !== null)
          .reduce((a, b) => (b.overallScore! > a.overallScore! ? b : a)).id;

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
    haptics.commit();

    // `usage` is null when the quota request failed. The guard used to be
    // skipped entirely in that case, so the athlete filmed, picked, waited
    // through a full frame-by-frame measurement, and *then* got a 403. The
    // server is still the authority; this only decides whether to spend a
    // minute of someone's time finding out.
    if (!usage) {
      alert(
        "We couldn't check your plan",
        "Your remaining clips for this month didn't load, so we can't tell whether this one is included. Check your connection and try again.",
        [{ text: "OK" }],
      );
      void load();
      return;
    }

    if (usage.limit !== -1 && usage.remaining <= 0) {
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
      {/*
        A FlatList rather than `.map()` inside a ScrollView.
        
        The session list is unbounded — it grows by one every time the athlete
        films a clip — and every row was being mounted eagerly, charts and all.
        The header below is everything that used to sit above the list; it is a
        single element rather than a component so it keeps its closure over
        `usage`, `measuring` and the handlers without prop-drilling.
      */}
      <FlatList<AnalysisRecord>
        data={measured}
        // Typed so `item` is an AnalysisRecord rather than any.
        keyExtractor={(item) => item.id}
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
        ListHeaderComponent={
          <>
        <View style={{ paddingHorizontal: GUTTER }}>
          <Text scale="display" style={T.screenTitle}>Sessions</Text>

          <View
            style={s.quotaRow}
            accessible
            accessibilityLabel={
              unlimited
                ? "Unlimited clips this month"
                : `${used} of ${limit} clips used this month`
            }
          >
            {unlimited ? (
              // Unlimited reads as a filled bar, not an empty one.
              <Meter value={1} tone={color.ink} height={6} style={{ width: 62 }} />
            ) : segments <= MAX_QUOTA_SEGMENTS ? (
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
            ) : (
              /* Beyond a dozen or so, one segment per clip is a row of
                 hairlines with 3pt gaps — unreadable, and it gets worse the
                 more generous the plan. A proportional bar says the same thing
                 at any limit. */
              <View style={s.quotaTrackFull}>
                <View
                  style={[
                    s.quotaProgress,
                    { width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%` },
                  ]}
                />
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
                    <Text
                      style={[T.label, { color: color.cobalt, marginTop: 3, letterSpacing: 0.8 }]}
                      accessibilityLiveRegion="polite"
                    >
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
          <Label style={{ marginBottom: 4 }}>MEASURED · {measured.length}</Label>
          </>
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: GUTTER }}>
            <MeasuredRow
              item={item}
              band={band}
              best={item.id === bestId}
              onPress={() => router.push(`/analysis/${item.id}`)}
              onDelete={() => {
                // Was `await`ed, so the confirmation dialog waited on the
                // Taptic Engine before opening. Feedback should never be on the
                // critical path of the thing it is acknowledging.
                haptics.warn();
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
          </View>
        )}
        ListEmptyComponent={
          loaded && measuring.length === 0 ? (
            <EmptyState
              glyph={<UploadGlyph tone={color.textFaint} size={30} />}
              title="No sessions yet"
              body="Add a clip and we'll track your joints frame by frame. Film side-on, whole body in frame, ten seconds or longer."
              style={{ paddingVertical: 28 }}
            />
          ) : null
        }
      />

      {/* ── Details sheet ── */}
      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="NEW SESSION">
        <Text scale="display" style={[T.headlineSmall, { marginBottom: 22 }]}>What are we measuring?</Text>

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

        {/* The science behind the pick, shown the moment a sport is chosen —
            the athlete sees what this sport's bands and tips are grounded in
            before the clip is measured against them. Picking the RIGHT sport
            matters: every band and every tip comes from this literature. */}
        {sport !== "" && (
          <>
            <Label style={{ marginTop: 26, marginBottom: 8 }}>
              THE SCIENCE · {sport.toUpperCase()}
            </Label>
            <SportScience sport={sport} />
          </>
        )}

        <TextField
          label="Label · optional"
          containerStyle={{ marginTop: 26 }}
          value={title}
          onChangeText={setTitle}
          placeholder={sport ? `e.g. ${exampleFor(sport)}` : "e.g. Morning session"}
          autoCapitalize="sentences"
          maxLength={120}
          returnKeyType="done"
          // Only submit when submitting would do something. Pressing done with
          // no sport chosen used to return silently, which reads as a dead key.
          onSubmitEditing={() => {
            if (sport) startMeasuring();
          }}
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
      </Sheet>
      {/* Paints over content that scrolls under the status bar. */}
      <StatusBarScrim />
    </Screen>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function MeasuredRow({
  item,
  band,
  best,
  onPress,
  onDelete,
}: {
  item: AnalysisRecord;
  /** The athlete's working band, for the row's mini scale. */
  band: { low: number; high: number } | null;
  /** True on the athlete's highest measured reading. */
  best: boolean;
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
        : `${item.sport.toUpperCase()}${best ? " · BEST" : ""}`;

  const noteTone = failed || unscored ? color.rust : legacy ? color.textFaint : color.textFaint;

  return (
    <Tappable
      onPress={onPress}
      onLongPress={onDelete}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${note.toLowerCase()}. ${
        item.overallScore === null ? "Not measured" : `Score ${Math.round(item.overallScore)}`
      }.`}
      // Long-press is the only way to delete and nothing on screen says so.
      // A custom action puts it in the rotor for VoiceOver users, and the
      // visible affordance is the explicit Delete control below.
      accessibilityHint="Double tap to open. Long press to delete."
      accessibilityActions={[{ name: "delete", label: "Delete session" }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "delete") onDelete();
      }}
      style={[s.row]}
    >
      {/*
        Both stamps take the type ladder unmodified. The month was overridden to
        `fontSize: 8` — below the 9px the system had already rejected as "below
        the floor for anything a user has to read", and this is a date, which is
        content. The `fontSize: 12` on the day was a no-op restating `measured`.

        The hierarchy between them is now carried the way `caliper.ts` says it
        should be: weight (monoBold against mono) and colour (textPrimary
        against textGhost), not a size step that costs legibility. "AUG" at 11px
        measures ~22pt in a 42pt tile.
      */}
      <View style={s.dateTile}>
        <Text style={T.measured}>{date.getDate()}</Text>
        <Text style={T.measuredSmall}>
          {date.toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={T.rowTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[T.measuredSmall, { color: noteTone, marginTop: 3 }]}>{note}</Text>
      </View>

      <View style={{ alignItems: "flex-end" }}>
        <Text style={[T.metricRow, item.overallScore === null && { color: color.textGhost }]}>
          {item.overallScore === null ? "–" : Math.round(item.overallScore)}
        </Text>
        <MiniBand
          value={item.analysisMethod === "pose-measured" ? item.overallScore : null}
          bandLow={band?.low ?? null}
          bandHigh={band?.high ?? null}
        />
      </View>
    </Tappable>
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
  quotaTrackFull: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.ruleStrong,
    overflow: "hidden",
  },
  quotaProgress: { height: 6, borderRadius: 3, backgroundColor: color.ink },
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

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
