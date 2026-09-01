/**
 * Progress — the trend, against the band.
 *
 * Same rule as everywhere else: a number is shown with the range it sits in.
 * The sparkline carries the athlete's working band as a cobalt wash so a rising
 * line is read relative to their own history, not an absolute scale.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";

import {
  Card,
  Check,
  Label,
  Screen,
  SkeletonBlock,
  Segmented,
  Entering,
  NoReading,
  Sparkline,
  StatusBarScrim,
  Text,
} from "@/components/caliper";
import { color, type as T, GUTTER, TAB_BAR, delta } from "@/constants/caliper";
import { usualBand } from "@/utils/usualBand";
import { progress as progressApi, analyses as analysesApi, type ProgressRecord, type AnalysisRecord } from "@/lib/api";
import { parseLocalDate } from "@/utils/localDate";
import { closedFlags } from "@/utils/closedFlags";

type Range = "12W" | "ALL";

/** Tile padding, shared with the sparkline's width maths so the two agree. */
const TILE_PADDING = 14;

/**
 * Sub-scores that can actually be measured from 2D pose, shown as small
 * multiples under the overall trend. The redesign replaces the metric filter
 * with four always-visible tiles: comparing dimensions is the point, and a
 * filter only ever showed one at a time.
 */
const SUB_METRICS = [
  { key: "techniqueScore", label: "TECHNIQUE" },
  { key: "balanceScore", label: "BALANCE" },
  { key: "consistencyScore", label: "CONSISTENCY" },
  { key: "mobilityScore", label: "MOBILITY" },
] as const;

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();

  const [entries, setEntries] = useState<ProgressRecord[]>([]);
  const [sessions, setSessions] = useState<AnalysisRecord[]>([]);
  const [range, setRange] = useState<Range>("12W");
  const [trendWidth, setTrendWidth] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [p, a] = await Promise.allSettled([progressApi.list(), analysesApi.list()]);
    if (p.status === "fulfilled") setEntries(p.value.entries);
    if (a.status === "fulfilled") setSessions(a.value.analyses);
    setLoaded(true);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // ── Series ──
  const scoped = useMemo(() => {
    const sorted = [...entries].sort(
      (a, b) => parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime(),
    );
    const cutoff = Date.now() - 12 * 7 * 24 * 60 * 60 * 1000;
    return range === "12W" ? sorted.filter((e) => parseLocalDate(e.date).getTime() >= cutoff) : sorted;
  }, [entries, range]);

  const seriesFor = useCallback(
    (key: string) =>
      scoped
        .map((e) => ({
          date: e.date,
          value: (e as unknown as Record<string, number | null>)[key],
        }))
        .filter((p): p is { date: string; value: number } => typeof p.value === "number"),
    [scoped],
  );

  const series = useMemo(() => seriesFor("overallScore"), [seriesFor]);

  const values = series.map((p) => p.value);
  const current = values.at(-1) ?? null;
  const first = values[0] ?? null;
  const change = current !== null && first !== null && values.length > 1 ? current - first : null;
  const best = values.length > 0 ? Math.max(...values) : null;
  const bestEntry = best !== null ? series.find((p) => p.value === best) : undefined;

  // This screen already argued for an interquartile band over min/max. The
  // argument was right and the other three screens never followed it, so the
  // maths moved to utils/usualBand where all four share it — and gained the
  // interpolation this floor-indexed version was missing at small n.
  const band = useMemo(() => usualBand(values), [values]);

  // ── This week ──
  const week = useMemo(() => buildWeek(sessions), [sessions]);
  const weekDone = week.filter((d) => d.measured).length;

  // ── Closed flags: joints that were flagged before and no longer are ──
  // Shared with Profile so the two screens cannot disagree — see
  // utils/closedFlags.
  const closed = useMemo(() => closedFlags(sessions), [sessions]);

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
        <View style={s.head}>
          <Text scale="display" style={T.screenTitle}>Progress</Text>
          {/*
            Was two hand-rolled pills whose selected state was taller than the
            container holding it, and which announced as two loose tabs with no
            tablist around them.
          */}
          <Segmented
            label="Time range"
            value={range}
            onChange={setRange}
            options={[
              { value: "12W" as Range, label: "12W" },
              { value: "ALL" as Range, label: "ALL" },
            ]}
          />
        </View>

        {/* ── Trend ── */}
        <Entering index={0}>
        <Card style={s.block}>
          <View style={s.trendHead}>
            <View>
              <Label>OVERALL · {range === "12W" ? "12 WEEKS" : "ALL TIME"}</Label>
              <View style={s.trendRow}>
                {current === null ? (
                  <NoReading />
                ) : (
                  <Text scale="display" style={T.metricLarge}>
                    {Math.round(current)}
                  </Text>
                )}
                {/* Neutral: this rendered every delta cobalt, so a decline
                    arrived in the colour reserved for the next action. Same
                    rule as Home. */}
                {change !== null && delta(change) && (
                  <Text style={[T.measured, { color: color.textSecondary }]}>{delta(change)}</Text>
                )}
              </View>
            </View>
            {best !== null && (
              <View style={{ alignItems: "flex-end" }}>
                <Label>BEST</Label>
                <Text style={[T.measured, { marginTop: 3 }]}>
                  {Math.round(best)}
                  {bestEntry
                    ? ` · ${parseLocalDate(bestEntry.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase()}`
                    : ""}
                </Text>
              </View>
            )}
          </View>

          {values.length >= 2 ? (
            <View
              style={{ marginTop: 16 }}
              // Measured, not the component's 306pt default. The trend card
              // never passed a width, so on anything narrower than about 390pt
              // the chart was wider than the card holding it — 70pt of overflow
              // at 320. Card has no overflow:hidden, so it simply spilled.
              onLayout={(e) => {
                const w = Math.round(e.nativeEvent.layout.width);
                setTrendWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
              }}
            >
              {trendWidth > 0 && (
              <Sparkline
                values={values}
                width={trendWidth}
                // This screen's one hero instrument, so it carries the reserved
                // colour. The four sub-metric tiles below take Sparkline's ink
                // default: five cobalt endpoints on one screen would make the
                // reservation meaningless.
                tone={color.cobalt}
                bandLow={band?.low ?? null}
                bandHigh={band?.high ?? null}
              />
              )}
              <View style={s.axis}>
                <Text style={T.measuredSmall}>
                  {series[0] &&
                    parseLocalDate(series[0].date)
                      .toLocaleDateString("en-GB", { month: "short" })
                      .toUpperCase()}
                </Text>
                <Text style={T.measuredSmall}>
                  {series.at(-1) &&
                    parseLocalDate(series.at(-1)!.date)
                      .toLocaleDateString("en-GB", { month: "short" })
                      .toUpperCase()}
                </Text>
              </View>
              {/* The band is the idea this screen is built on, and it is absent
                  until the third reading. Saying so is better than a chart that
                  silently lacks its most important feature. */}
              {!band && (
                <Text style={[T.bodySmall, { marginTop: 12 }]}>
                  One more measured session and your band appears here: the range you
                  usually work in, drawn behind the line.
                </Text>
              )}
            </View>
          ) : !loaded ? (
            <View style={{ marginTop: 16 }}>
              <SkeletonBlock height={72} />
            </View>
          ) : (
            <ProgressStages measured={values.length} />
          )}
        </Card>
        </Entering>

        {/* ── Small multiples — every dimension, side by side ──
            Hidden until there is something to put in them. With no sessions the
            grid rendered four tiles all reading "–  NOT MEASURED", which looks
            like four broken charts rather than an empty screen. */}
        {values.length > 0 && (
          <View style={s.tiles}>
            {SUB_METRICS.map((m) => (
              <SparkTile
                key={m.key}
                label={m.label}
                points={seriesFor(m.key).map((p) => p.value)}
              />
            ))}
          </View>
        )}

        {/* ── This week ── */}
        <Entering index={2}>
        <Card style={s.block}>
          <View style={s.weekHead}>
            <Text style={T.cardTitle}>This week</Text>
            <Text style={[T.label, { letterSpacing: 1 }]}>{weekDone} MEASURED</Text>
          </View>
          <View style={s.weekRow}>
            {week.map((d) => (
              <View key={d.key} style={{ alignItems: "center", gap: 8 }}>
                <View
                  style={[
                    s.weekTick,
                    {
                      height: d.measured ? 34 : 12,
                      backgroundColor: d.measured
                        ? color.ink
                        : d.isToday
                          ? color.cobalt
                          : color.ruleStrong,
                    },
                  ]}
                />
                <Text
                  style={[
                    T.measuredSmall,
                    { color: d.isToday ? color.cobalt : color.textGhost },
                  ]}
                >
                  {d.label}
                </Text>
              </View>
            ))}
          </View>
        </Card>
        </Entering>

        {/* ── Closed flags ── */}
        {closed.length > 0 && (
          <View style={s.section}>
            <Label style={{ marginBottom: 6 }}>CLOSED FLAGS</Label>
            {closed.map((flag, i) => (
              <View key={flag.joint} style={[s.closedRow, i === 0 && { borderTopWidth: 0 }]}>
                <Check />
                <Text style={[T.rowTitle, { flex: 1 }]}>
                  {flag.joint} back inside its range
                </Text>
                <Text style={T.measuredSmall}>
                  {flag.closedAt
                    .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                    .toUpperCase()}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      {/* Paints over content that scrolls under the status bar. */}
      <StatusBarScrim />
    </Screen>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

/**
 * What Progress shows before it has enough readings to show anything.
 *
 * This screen needs two sessions for a trend and three before the
 * interquartile band — its central idea — appears at all. A new athlete
 * therefore met an empty panel and four charts reading "NOT MEASURED", with
 * nothing to say when that would change. That is the documented weak spot on
 * this screen, and it is a design problem rather than a bug: the fix is to make
 * the wait legible, not to invent a trend from one point.
 */
function ProgressStages({ measured }: { measured: number }) {
  const stages = [
    { at: 1, label: "Your first reading" },
    { at: 2, label: "The trend line" },
    { at: 3, label: "Your band: the range you usually work in" },
  ];

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={T.body}>
        {measured === 0
          ? "Nothing measured yet. Each session you film adds a point here."
          : "One session measured. Here's what appears as you add more."}
      </Text>

      <View style={{ marginTop: 18, gap: 12 }}>
        {stages.map((stage) => {
          const done = measured >= stage.at;
          return (
            <View key={stage.at} style={s.stageRow}>
              <View style={[s.stageDot, done && { backgroundColor: color.ink }]} />
              <Text
                style={[
                  T.rowTitle,
                  { flex: 1, color: done ? color.textPrimary : color.textMuted },
                ]}
              >
                {stage.label}
              </Text>
              <Text style={T.measuredSmall}>
                {done ? "READY" : `${stage.at} ${stage.at === 1 ? "SESSION" : "SESSIONS"}`}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Spark tile ──────────────────────────────────────────────────────────────

/**
 * One dimension as a small multiple: label, latest value, change across the
 * scoped window, and the trend line. Fewer than two points renders the label
 * with an en dash — a tile that vanished would make the grid lie about which
 * dimensions exist.
 */
function SparkTile({
  label,
  points,
}: {
  label: string;
  points: number[];
}) {
  const current = points.at(-1) ?? null;
  const first = points[0] ?? null;
  const change =
    current !== null && first !== null && points.length > 1 ? current - first : null;

  /**
   * The sparkline is sized from the tile's measured inner width.
   *
   * It used to be handed `(screenW - GUTTER * 2 - 8) / 2 - 28`, which models a
   * 50% column while the tile is actually 48.5% — so the line ran wider than
   * its own tile at every viewport and the final point's dot was clipped by the
   * SVG bounds. That dot is the most recent reading, the one that matters most.
   */
  const [innerWidth, setInnerWidth] = useState(0);

  return (
    <View
      style={s.tile}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width) - TILE_PADDING * 2;
        setInnerWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
      }}
    >
      <View style={s.tileHead}>
        <Text scale="label" style={[T.labelTight, { color: color.textMuted, flexShrink: 1 }]}>
          {label}
        </Text>
        {change !== null && delta(change) && (
          <Text style={[T.measured, { fontSize: 11, color: color.textSecondary }]}>
            {delta(change)}
          </Text>
        )}
      </View>
      <Text scale="display" style={[T.metricMedium, current === null && { color: color.textGhost }, { marginTop: 3 }]}>
        {current === null ? "–" : Math.round(current)}
      </Text>
      {points.length >= 2 && innerWidth > 0 ? (
        <View style={{ marginTop: 6 }}>
          <Sparkline values={points} width={innerWidth} height={30} />
        </View>
      ) : points.length >= 2 ? (
        // Before the first layout pass. Reserve the height so the tile does not
        // jump when the line appears.
        <View style={{ marginTop: 6, height: 30 }} />
      ) : (
        <Text style={[T.measuredSmall, { marginTop: 10 }]}>
          {points.length === 1 ? "ONE READING" : "NOT MEASURED"}
        </Text>
      )}
    </View>
  );
}

// ─── Derivations ─────────────────────────────────────────────────────────────

interface WeekDay {
  /** Stable unique key — the narrow weekday labels repeat (M T W T F S S). */
  key: string;
  label: string;
  measured: boolean;
  isToday: boolean;
}

/**
 * Mon–Sun of the current week, marked where a session was actually measured.
 *
 * Two corrections, both of which made the strip say something untrue:
 *
 *  - It counted every `complete` session, including ones whose method is
 *    `unscored` — a clip the app explicitly could not measure. So "4 MEASURED"
 *    could include a session whose own row reads "NOT TRACKABLE". Every other
 *    derivation on Home and Progress filters to `pose-measured`; this one did
 *    not, and it is the number the athlete reads as their week.
 *
 *  - The key came from `d.toISOString().slice(0, 10)` on a local-midnight date,
 *    which lands on the previous day for anyone east of UTC. `localDayKey`
 *    formats the local date instead — the same reason `utils/localDate` exists.
 */
function buildWeek(sessions: AnalysisRecord[]): WeekDay[] {
  const today = new Date();
  const dayOfWeek = (today.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(today);
  monday.setDate(today.getDate() - dayOfWeek);
  monday.setHours(0, 0, 0, 0);

  const measuredDays = new Set(
    sessions
      .filter((a) => a.status === "complete" && a.analysisMethod === "pose-measured")
      .map((a) => new Date(a.uploadedAt).toDateString()),
  );

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      key: localDayKey(d),
      label: d.toLocaleDateString("en-GB", { weekday: "narrow" }).toUpperCase(),
      measured: measuredDays.has(d.toDateString()),
      isToday: d.toDateString() === today.toDateString(),
    };
  });
}

/** `YYYY-MM-DD` for a date, read in the local zone rather than UTC. */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  head: {
    paddingHorizontal: GUTTER,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  block: { marginHorizontal: GUTTER, marginTop: 18 },

  stageRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.ruleStrong,
  },
  trendHead: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    // Wraps: at large system text sizes the BEST column ran off the card.
    flexWrap: "wrap",
    columnGap: 16,
    rowGap: 10,
  },
  trendRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 2 },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },

  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: GUTTER,
    paddingTop: 14,
  },
  tile: {
    width: "48.5%",
    backgroundColor: color.card,
    borderRadius: 20,
    padding: TILE_PADDING,
  },
  tileHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    // The label and its delta ran into each other at large text sizes
    // ("TECHNIQUE-53"), and the longest label broke mid-word. Wrapping puts the
    // delta on its own line instead of jamming it against the label.
    flexWrap: "wrap",
    columnGap: 8,
  },

  weekHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  weekRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  weekTick: { width: 2, borderRadius: 1 },

  section: { paddingHorizontal: GUTTER, paddingTop: 24 },
  closedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: color.rule,
  },
});
