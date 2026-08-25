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
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";

import {
  Avatar,
  Card,
  Chevron,
  Label,
  MetricBand,
  MiniBand,
  Prescription,
  ReferenceRow,
  Screen,
  NoReading,
  SkeletonBlock,
  Entering,
  StatusBarScrim,
  Text,
  Tappable,
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
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    try {
      const { analyses } = await analysesApi.list();
      setList(analyses);
      setStale(false);
    } catch {
      // Keeping the last-known sessions is right — a blank screen would be
      // worse. Doing it *silently* was not: the athlete had no way to tell a
      // screen that failed to refresh from one that is up to date, on the
      // screen whose entire job is reporting the current reading.
      setStale(true);
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
        {stale && (
          <View style={s.staleBar}>
            <Text style={[T.bodySmall, { color: color.textSecondary, flex: 1 }]}>
              {list.length > 0
                ? "Showing your last saved sessions. We couldn't reach the server."
                : "We couldn't reach the server, so your sessions haven't loaded."}
            </Text>
            <Tappable
              onPress={() => void load()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading your sessions"
              style={s.retryBtn}
            >
              <Text style={[T.buttonSmall, { color: color.cobalt }]}>Retry</Text>
            </Tappable>
          </View>
        )}

        {/* ── Header ── */}
        <View style={s.header}>
          <View style={{ flex: 1, paddingRight: 14 }}>
            <Label>
              {stampDate(new Date())}
              {measuredSessions.length > 0 ? ` · SESSION ${measuredSessions.length}` : ""}
            </Label>
            <Text scale="display" style={[T.screenTitle, s.headline]}>{headline}</Text>
          </View>
          <Tappable
            onPress={() => router.push("/(tabs)/profile")}
            accessibilityRole="button"
            accessibilityLabel={`Profile, ${displayName}`}
            // The avatar is 40; the target around it is 44. Padded rather than
            // hitSlopped so the web build gets it too.
            style={s.avatarTarget}
          >
            <Avatar name={displayName} uri={avatarUri} />
          </Tappable>
        </View>

        {/* ── Form Index ── */}
        <Entering index={0}>
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
              <Text scale="display" style={T.metricHeroXL}>{Math.round(latest.overallScore!)}</Text>
              {/* Neutral, not cobalt. This pill rendered every delta in cobalt
                  regardless of sign, so a 71-point collapse arrived in the
                  colour the system reserves for "the one thing to do next".
                  A delta is a measurement, not an action and not an alarm: it
                  reads in mono with its sign, and the instrument does not
                  cheer. Progress follows the same rule. */}
              {change !== null && delta(change) && (
                <View style={s.deltaPill}>
                  <Text style={[T.measured, { fontSize: 11, color: color.textSecondary }]}>
                    {delta(change)} VS LAST
                  </Text>
                </View>
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
            {loaded ? (
              <>
                <NoReading style={{ marginTop: 10 }} />
                <Text style={[T.body, { marginTop: 10 }]}>
                  Film a clip and we&apos;ll measure your joint angles frame by frame. Your Form
                  Index is calculated from those measurements, so it means the same thing every
                  time.
                </Text>
              </>
            ) : (
              /*
                Loading and empty used to share this card, so "we are fetching
                your sessions" and "you have measured nothing" were the same
                rectangle with different words in it. Blocks in the shape of the
                reading say which one it is without reading a word.
              */
              <>
                <SkeletonBlock height={30} width="34%" style={{ marginTop: 12 }} />
                <SkeletonBlock height={15} style={{ marginTop: 18 }} />
                <SkeletonBlock height={15} width="88%" style={{ marginTop: 8 }} />
                <SkeletonBlock height={15} width="64%" style={{ marginTop: 8 }} />
              </>
            )}
          </Card>
        )}

        </Entering>

        {/* ── The one next action ── */}
        {prescription && (
          <Entering index={1} style={s.block}>
            <Prescription
              text={prescription.text}
              why={prescription.why}
              actionLabel="Open"
              onPress={() => latest && router.push(`/analysis/${latest.id}`)}
            />
          </Entering>
        )}

        {/* ── Record ── */}
        {recent.length > 0 && (
          <Entering index={2} style={[s.block, { marginTop: 22 }]}>
            <View style={s.sectionHead}>
              <Label>LAST {recent.length === 1 ? "SESSION" : `${recent.length} SESSIONS`}</Label>
              <Tappable
                onPress={() => router.push("/(tabs)/analyze")}
                accessibilityRole="link"
                accessibilityLabel="See all sessions"
                // Real padding, not hitSlop: hitSlop does nothing on the web
                // build, so the control was genuinely 16x16 there. The negative
                // margin keeps the label optically aligned with the heading.
                style={s.allLink}
              >
                <Text style={[T.buttonSmall, { color: color.cobalt }]}>All</Text>
              </Tappable>
            </View>

            {recent.map((item, i) => (
              <SessionRow
                key={item.id}
                item={item}
                first={i === 0}
                band={band}
                onPress={() => router.push(`/analysis/${item.id}`)}
              />
            ))}
          </Entering>
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
      {/* Paints over content that scrolls under the status bar. */}
      <StatusBarScrim />
    </Screen>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function SessionRow({
  item,
  first,
  band,
  onPress,
}: {
  item: AnalysisRecord;
  first: boolean;
  /** The athlete's working band, so each row's score sits against it. */
  band: { low: number; high: number } | null;
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
    <Tappable
      // `disabled`, not a missing handler. With onPress undefined the row still
      // ran its pressed style, so a measuring session gave tap feedback and
      // then did nothing — a control that looks alive and is not.
      disabled={processing}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: processing }}
      accessibilityLabel={
        processing
          ? `${item.title}, still measuring`
          : `${item.title}, ${note}, score ${item.overallScore === null ? "not measured" : Math.round(item.overallScore)}`
      }
      style={[s.row, first && { borderTopWidth: 0 }]}
    >
      {/* minWidth, not width: a fixed box broke "SAT" onto two lines as soon
          as the system text size went up. */}
      <Text style={[T.measuredSmall, { minWidth: 36 }]} numberOfLines={1}>
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
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[T.metricRow, item.overallScore === null && { color: color.textGhost }]}>
          {item.overallScore === null ? "–" : Math.round(item.overallScore)}
        </Text>
        <MiniBand
          value={item.overallScore}
          bandLow={band?.low ?? null}
          bandHigh={band?.high ?? null}
        />
      </View>
      <Chevron />
    </Tappable>
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
  staleBar: {
    marginHorizontal: GUTTER,
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: color.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  header: {
    paddingHorizontal: GUTTER,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  headline: { marginTop: 8, maxWidth: 280 },
  block: { marginHorizontal: GUTTER, marginTop: 22 },
  metricHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // Wraps rather than colliding: at large system text sizes "FORM INDEX" and
    // "96 FRAMES MEASURED" ran into each other and off the card.
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 4,
  },
  metricRow: { flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 4 },
  deltaPill: {
    backgroundColor: "rgba(16,19,18,0.06)",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  retryBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingLeft: 10,
  },
  avatarTarget: { minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  allLink: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 12,
    marginRight: -12,
  },
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
