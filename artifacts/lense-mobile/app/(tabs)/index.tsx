/**
 * Home — the instrument panel.
 *
 * One reading (Form Index, always shown against the band it came from), one
 * prescription, and the recent record. Nothing else competes.
 *
 * Sport-agnostic by construction: every string that could name a sport is read
 * from the athlete's own sessions rather than hardcoded, so a boxer and a
 * swimmer get the same screen with their own vocabulary.
 */

import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";

import {
  Screen,
  Card,
  Label,
  MetricBand,
  Prescription,
  Avatar,
  Chevron,
  ReferenceRow,
} from "@/components/caliper";
import { color, type as T, GUTTER, TAB_BAR, delta, stampDate, stampDay } from "@/constants/caliper";
import { useAuth } from "@/lib/authContext";
import { analyses as analysesApi, type AnalysisRecord } from "@/lib/api";
import { provenance } from "@/utils/provenance";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, user, avatarUri } = useAuth();

  const [list, setList] = useState<AnalysisRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const { analyses } = await analysesApi.list();
      setList(analyses);
    } catch {
      /* offline — keep whatever we already have */
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // ── Derivations ──
  // Only measured sessions contribute. A legacy or unscored analysis has no
  // measurement behind its number, so including it would corrupt the band.
  const measuredSessions = useMemo(
    () =>
      list.filter(
        (a) =>
          a.status === "complete" &&
          a.analysisMethod === "pose-measured" &&
          a.overallScore !== null,
      ),
    [list],
  );

  const latest = measuredSessions[0];
  const previous = measuredSessions[1];

  const scores = measuredSessions.map((a) => a.overallScore!);
  const band = useMemo(() => {
    // The athlete's own working range across their measured history. With fewer
    // than three sessions there isn't a band yet — showing one would imply more
    // certainty than two readings support.
    if (scores.length < 3) return null;
    return { low: Math.min(...scores), high: Math.max(...scores) };
  }, [scores]);

  const change = latest && previous ? latest.overallScore! - previous.overallScore! : null;

  /**
   * The athlete's highest measured reading. Shown as a reference mark under the
   * band, so today's number is always read against their own ceiling rather
   * than an abstract 100.
   */
  const best = useMemo(() => {
    if (measuredSessions.length < 2) return null;
    return measuredSessions.reduce((a, b) => (b.overallScore! > a.overallScore! ? b : a));
  }, [measuredSessions]);

  /**
   * How many frames the reading was computed from. This is the credibility of
   * the number — a Form Index off 148 frames means something a 12-frame one
   * does not — so it sits beside the metric rather than buried in a detail view.
   */
  const provenanceStamp = provenance(latest?.poseMetrics);

  const headline = useMemo(() => buildHeadline(latest, measuredSessions.length), [latest, measuredSessions.length]);

  const prescription = useMemo(() => {
    if (!latest) return null;
    const first = latest.improvements?.[0];
    if (!first) return null;
    return { text: first, why: `From ${latest.title}` };
  }, [latest]);

  const recent = list.slice(0, 4);
  const displayName = profile?.name || user?.name || "Athlete";

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
        {/* ── Header ── */}
        <View style={s.header}>
          <View style={{ flex: 1, paddingRight: 14 }}>
            <Label>
              {stampDate(new Date())}
              {measuredSessions.length > 0 ? ` · SESSION ${measuredSessions.length}` : ""}
            </Label>
            <Text style={[T.screenTitle, s.headline]}>{headline}</Text>
          </View>
          <Pressable onPress={() => router.push("/(tabs)/profile")}>
            <Avatar name={displayName} uri={avatarUri} />
          </Pressable>
        </View>

        {/* ── Form Index ── */}
        {latest ? (
          <Card style={s.block}>
            {/* Label left, provenance right — the reading and what it was
                measured from, on one line. */}
            <View style={s.metricHead}>
              <Label>FORM INDEX</Label>
              {provenanceStamp !== null && (
                <Text style={T.measuredSmall}>{provenanceStamp}</Text>
              )}
            </View>

            <View style={s.metricRow}>
              <Text style={T.metricHeroXL}>{Math.round(latest.overallScore!)}</Text>
              {change !== null && delta(change) && (
                <Text style={[T.measured, { fontSize: 13, color: color.cobalt }]}>
                  {delta(change)}
                </Text>
              )}
            </View>

            <MetricBand
              value={latest.overallScore!}
              bandLow={band?.low ?? null}
              bandHigh={band?.high ?? null}
              reference={previous?.overallScore ?? null}
            />

            <ReferenceRow
              items={[
                {
                  label: "YOUR BAND",
                  value: band
                    ? `${Math.round(band.low)} – ${Math.round(band.high)}`
                    : null,
                },
                {
                  label: "PREVIOUS",
                  value: previous
                    ? `${Math.round(previous.overallScore!)} · ${stampDay(previous.uploadedAt)}`
                    : null,
                },
                {
                  label: "BEST",
                  value:
                    best && best.id !== latest.id
                      ? `${Math.round(best.overallScore!)} · ${stampDay(best.uploadedAt)}`
                      : null,
                },
              ]}
            />
          </Card>
        ) : (
          <Card style={s.block}>
            <Label>FORM INDEX</Label>
            <Text style={[T.metricHero, { color: color.textGhost, marginTop: 2 }]}>–</Text>
            <Text style={[T.body, { marginTop: 8 }]}>
              {loaded
                ? "Film a clip and we'll measure your joint angles frame by frame. Your Form Index is calculated from those measurements, so it means the same thing every time."
                : "Loading your sessions…"}
            </Text>
          </Card>
        )}

        {/* ── The one next action ── */}
        {prescription && (
          <View style={s.block}>
            <Prescription
              text={prescription.text}
              why={prescription.why}
              actionLabel="Open"
              onPress={() => latest && router.push(`/analysis/${latest.id}`)}
            />
          </View>
        )}

        {/* ── Record ── */}
        {recent.length > 0 && (
          <View style={[s.block, { marginTop: 22 }]}>
            <View style={s.sectionHead}>
              <Label>LAST {recent.length === 1 ? "SESSION" : `${recent.length} SESSIONS`}</Label>
              <Pressable onPress={() => router.push("/(tabs)/analyze")}>
                <Text style={[T.buttonSmall, { color: color.cobalt }]}>All</Text>
              </Pressable>
            </View>

            {recent.map((item, i) => (
              <SessionRow
                key={item.id}
                item={item}
                first={i === 0}
                onPress={() => router.push(`/analysis/${item.id}`)}
              />
            ))}
          </View>
        )}

        {loaded && list.length === 0 && (
          <Card style={[s.block, { marginTop: 12 }]}>
            <Text style={T.cardTitle}>Nothing measured yet</Text>
            <Text style={[T.body, { marginTop: 6 }]}>
              Tap the blue button below to add your first clip. Film side-on, whole body in
              frame, ten seconds or longer.
            </Text>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function SessionRow({
  item,
  first,
  onPress,
}: {
  item: AnalysisRecord;
  first: boolean;
  onPress: () => void;
}) {
  const processing = item.status === "processing" || item.status === "pending";
  const note = processing
    ? "Measuring…"
    : item.status === "failed"
      ? "Couldn't measure"
      : item.analysisMethod === "unscored"
        ? "Not trackable"
        : item.sport;

  return (
    <Pressable
      onPress={processing ? undefined : onPress}
      style={({ pressed }) => [s.row, first && { borderTopWidth: 0 }, pressed && { opacity: 0.7 }]}
    >
      <Text style={[T.measuredSmall, { width: 36 }]}>
        {new Date(item.uploadedAt)
          .toLocaleDateString("en-GB", { weekday: "short" })
          .toUpperCase()}
      </Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={T.rowTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[T.rowSubtitle, { marginTop: 1, textTransform: "capitalize" }]}>{note}</Text>
      </View>
      <Text style={T.metricRow}>
        {item.overallScore === null ? "–" : Math.round(item.overallScore)}
      </Text>
      <Chevron />
    </Pressable>
  );
}

// ─── Copy ────────────────────────────────────────────────────────────────────

/**
 * A headline that says something true about the athlete's own data.
 *
 * Deliberately not motivational filler — the design's premise is an instrument,
 * so the headline reports rather than cheers.
 */
function buildHeadline(latest: AnalysisRecord | undefined, count: number): string {
  if (!latest) return "Measure your first session.";

  if (latest.status === "processing" || latest.status === "pending") {
    return "Measuring your latest clip.";
  }
  if (latest.analysisMethod === "unscored") {
    return "That clip wasn't trackable.";
  }
  if (latest.improvements?.[0]) {
    // The model already writes these grounded in measurements; the first one
    // is the highest-signal thing to surface.
    return latest.improvements[0].length <= 62
      ? latest.improvements[0]
      : "Your latest session is measured.";
  }
  if (count === 1) return "First session on the board.";
  return "Your latest session is measured.";
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    paddingHorizontal: GUTTER,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  headline: { marginTop: 8, maxWidth: 280 },
  block: { marginHorizontal: GUTTER, marginTop: 22 },
  metricHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metricRow: { flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 4 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: color.rule,
  },
});
