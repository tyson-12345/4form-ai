/**
 * Progress — the trend, against the band.
 *
 * Same rule as everywhere else: a number is shown with the range it sits in.
 * The sparkline carries the athlete's working band as a cobalt wash so a rising
 * line is read relative to their own history, not an absolute scale.
 */

import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";

import { Screen, Card, Label, Sparkline, MonoChip, Check } from "@/components/caliper";
import { color, type as T, GUTTER, TAB_BAR, delta } from "@/constants/caliper";
import { progress as progressApi, analyses as analysesApi, type ProgressRecord, type AnalysisRecord } from "@/lib/api";

type Range = "12W" | "ALL";

/** Sub-scores that can actually be measured from 2D pose. */
const METRICS = [
  { key: "overallScore", label: "OVERALL" },
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
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("overallScore");
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
  const series = useMemo(() => {
    const sorted = [...entries].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    const cutoff = Date.now() - 12 * 7 * 24 * 60 * 60 * 1000;
    const scoped = range === "12W" ? sorted.filter((e) => new Date(e.date).getTime() >= cutoff) : sorted;

    return scoped
      .map((e) => ({
        date: e.date,
        value: (e as unknown as Record<string, number | null>)[metric],
      }))
      .filter((p): p is { date: string; value: number } => typeof p.value === "number");
  }, [entries, range, metric]);

  const values = series.map((p) => p.value);
  const current = values.at(-1) ?? null;
  const first = values[0] ?? null;
  const change = current !== null && first !== null && values.length > 1 ? current - first : null;
  const best = values.length > 0 ? Math.max(...values) : null;
  const bestEntry = best !== null ? series.find((p) => p.value === best) : undefined;

  const band = useMemo(() => {
    if (values.length < 3) return null;
    const sorted = [...values].sort((a, b) => a - b);
    // Interquartile band — the range the athlete typically operates in, rather
    // than min/max, which one bad clip would blow open.
    const q = (f: number) => sorted[Math.floor((sorted.length - 1) * f)]!;
    return { low: q(0.25), high: q(0.75) };
  }, [values]);

  // ── This week ──
  const week = useMemo(() => buildWeek(sessions), [sessions]);
  const weekDone = week.filter((d) => d.measured).length;

  // ── Closed flags: joints that were flagged before and no longer are ──
  const closed = useMemo(() => buildClosedFlags(sessions), [sessions]);

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
          <Text style={T.screenTitle}>Progress</Text>
          <View style={s.toggle}>
            {(["12W", "ALL"] as const).map((r) => (
              <Pressable
                key={r}
                onPress={() => setRange(r)}
                style={[s.toggleItem, range === r && s.toggleItemOn]}
              >
                <Text
                  style={[
                    T.label,
                    { letterSpacing: 1, color: range === r ? color.onInk : color.textFaint },
                  ]}
                >
                  {r}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Trend ── */}
        <Card style={s.block}>
          <View style={s.trendHead}>
            <View>
              <Label>
                {METRICS.find((m) => m.key === metric)?.label} ·{" "}
                {range === "12W" ? "12 WEEKS" : "ALL TIME"}
              </Label>
              <View style={s.trendRow}>
                <Text style={[T.metricLarge, current === null && { color: color.textGhost }]}>
                  {current === null ? "—" : Math.round(current)}
                </Text>
                {change !== null && delta(change) && (
                  <Text style={[T.measured, { color: color.cobalt }]}>{delta(change)}</Text>
                )}
              </View>
            </View>
            {best !== null && (
              <View style={{ alignItems: "flex-end" }}>
                <Label>BEST</Label>
                <Text style={[T.measured, { marginTop: 3 }]}>
                  {Math.round(best)}
                  {bestEntry
                    ? ` · ${new Date(bestEntry.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase()}`
                    : ""}
                </Text>
              </View>
            )}
          </View>

          {values.length >= 2 ? (
            <View style={{ marginTop: 16 }}>
              <Sparkline
                values={values}
                bandLow={band?.low ?? null}
                bandHigh={band?.high ?? null}
              />
              <View style={s.axis}>
                <Text style={T.measuredSmall}>
                  {series[0] &&
                    new Date(series[0].date)
                      .toLocaleDateString("en-GB", { month: "short" })
                      .toUpperCase()}
                </Text>
                <Text style={T.measuredSmall}>
                  {series.at(-1) &&
                    new Date(series.at(-1)!.date)
                      .toLocaleDateString("en-GB", { month: "short" })
                      .toUpperCase()}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={[T.body, { marginTop: 14 }]}>
              {loaded
                ? "Measure two or more sessions and your trend appears here."
                : "Loading…"}
            </Text>
          )}
        </Card>

        {/* ── Metric selector ── */}
        <View style={s.chips}>
          {METRICS.map((m) => (
            <MonoChip
              key={m.key}
              label={m.label}
              selected={metric === m.key}
              onPress={() => setMetric(m.key)}
            />
          ))}
        </View>

        {/* ── This week ── */}
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
                <Text style={T.measuredSmall}>{flag.when}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
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

/** Mon–Sun of the current week, marked where a session was measured. */
function buildWeek(sessions: AnalysisRecord[]): WeekDay[] {
  const today = new Date();
  const dayOfWeek = (today.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(today);
  monday.setDate(today.getDate() - dayOfWeek);
  monday.setHours(0, 0, 0, 0);

  const measuredDays = new Set(
    sessions
      .filter((a) => a.status === "complete")
      .map((a) => new Date(a.uploadedAt).toDateString()),
  );

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en-GB", { weekday: "narrow" }).toUpperCase(),
      measured: measuredDays.has(d.toDateString()),
      isToday: d.toDateString() === today.toDateString(),
    };
  });
}

interface ClosedFlag {
  joint: string;
  when: string;
}

/**
 * A joint that was flagged in an earlier session and wasn't in the most recent
 * one. Real progress, derived from the record rather than asserted.
 *
 * Needs at least two measured sessions; with one there is nothing to compare.
 */
function buildClosedFlags(sessions: AnalysisRecord[]): ClosedFlag[] {
  const measured = sessions
    .filter((a) => a.status === "complete" && a.analysisMethod === "pose-measured")
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  if (measured.length < 2) return [];

  // The detail payload holds the per-joint flags; the list payload doesn't, so
  // this uses the improvement text as the observable proxy for "was flagged".
  const latest = measured[0]!;
  const earlier = measured.slice(1, 5);

  const latestText = (latest.improvements ?? []).join(" ").toLowerCase();
  const JOINTS = ["left knee", "right knee", "left hip", "right hip", "left elbow", "right elbow"];

  const closed: ClosedFlag[] = [];
  for (const joint of JOINTS) {
    const wasFlagged = earlier.find((a) =>
      (a.improvements ?? []).join(" ").toLowerCase().includes(joint),
    );
    if (wasFlagged && !latestText.includes(joint)) {
      closed.push({
        joint: joint.replace(/\b\w/g, (c) => c.toUpperCase()),
        when: new Date(latest.uploadedAt)
          .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
          .toUpperCase(),
      });
    }
  }
  return closed.slice(0, 4);
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  head: {
    paddingHorizontal: GUTTER,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggle: { flexDirection: "row", backgroundColor: color.card, borderRadius: 999, padding: 3 },
  toggleItem: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  toggleItemOn: { backgroundColor: color.ink },

  block: { marginHorizontal: GUTTER, marginTop: 18 },
  trendHead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  trendRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 2 },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },

  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    paddingHorizontal: GUTTER,
    paddingTop: 14,
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
