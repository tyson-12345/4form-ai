/**
 * Analysis detail — the readout for one session.
 *
 * ── One honesty constraint shapes this screen ───────────────────────────────
 * The mockup's hero carries a waveform along the clip's timeline, and each flag
 * carries the timestamp that produced it. We measure per-joint statistics, not
 * a per-frame timeline, so a time-axis waveform here would be decoration drawn
 * to look like data — the exact failure this redesign is named after.
 *
 * Both keep their visual role, backed by measurements we actually have:
 *   - the hero strip shows one band per tracked joint, coloured by its reading
 *   - each flag's stamp is the extreme angle observed for that joint
 *
 * Same rhythm, same information density, nothing invented.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import Svg, { Defs, Pattern, Rect, Line, Circle } from "react-native-svg";

import {
  Screen,
  Card,
  Label,
  MetricBar,
  MetricBand,
  Prescription,
  FlagRow,
  Chevron,
  PlayGlyph,
} from "@/components/caliper";
import { color, type as T, radius, GUTTER, font, delta } from "@/constants/caliper";
import {
  analyses as analysesApi,
  type AnalysisRecord,
  type TipRecord,
  type RiskRecord,
} from "@/lib/api";
import { displaySport } from "@/constants/sports";

const HERO_H = 340;
const { width: SCREEN_W } = Dimensions.get("window");

/** Sub-scores in the order they're presented. Power/speed are excluded — they
 *  are structurally unmeasurable from 2D pose and would only ever read "—". */
const DIMENSIONS = [
  { key: "technique", label: "Technique" },
  { key: "balance", label: "Balance" },
  { key: "consistency", label: "Consistency" },
  { key: "mobility", label: "Mobility" },
] as const;

export default function AnalysisDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  const [tips, setTips] = useState<TipRecord[]>([]);
  const [risks, setRisks] = useState<RiskRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  /**
   * The athlete's other measured sessions, used only to derive the band this
   * clip is plotted against. Loaded separately and allowed to fail: without it
   * the ruler still renders, just without a shaded band.
   */
  const [history, setHistory] = useState<AnalysisRecord[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const result = await analysesApi.get(id);
      setAnalysis(result.analysis);
      setTips(result.tips);
      setRisks(result.injuryRisks);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void analysesApi
      .list()
      .then(({ analyses }) => setHistory(analyses))
      .catch(() => {
        /* band is optional context — a failure here must not blank the screen */
      });
  }, []);

  /**
   * The athlete's working range across their measured history — the same
   * derivation Home uses, so the two screens cannot disagree about the band.
   * Fewer than three readings is not a band.
   */
  const band = useMemo(() => {
    const scores = history
      .filter(
        (a) =>
          a.status === "complete" &&
          a.analysisMethod === "pose-measured" &&
          a.overallScore !== null,
      )
      .map((a) => a.overallScore!);
    if (scores.length < 3) return null;
    return { low: Math.min(...scores), high: Math.max(...scores) };
  }, [history]);

  // Poll while the write-up is still being generated.
  useEffect(() => {
    if (!analysis || analysis.status === "complete" || analysis.status === "failed") return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [analysis, load]);

  if (state === "loading") {
    return (
      <Screen style={s.centre}>
        <ActivityIndicator color={color.cobalt} />
      </Screen>
    );
  }

  if (state === "error" || !analysis) {
    return (
      <Screen style={s.centre}>
        <Text style={T.cardTitle}>We couldn't load this session</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={[T.buttonSmall, { color: color.cobalt }]}>Go back</Text>
        </Pressable>
      </Screen>
    );
  }

  const measured = analysis.analysisMethod === "pose-measured";
  const legacy = analysis.analysisMethod === "legacy-unverified";
  const processing = analysis.status === "processing" || analysis.status === "pending";

  const prescription = tips[0] ?? null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ── */}
        <Pressable onPress={() => router.push(`/analysis/skeleton/${analysis.id}`)}>
          <View style={s.hero}>
            <FilmBackdrop />
            <SkeletonMark flagged={risks.length > 0} />

            <View style={s.heroScrim} />

            <View style={[s.heroTop, { top: insets.top + 6 }]}>
              <Pressable onPress={() => router.back()} style={s.heroBtn} hitSlop={8}>
                <Chevron direction="left" tone={color.onInk} size={16} />
              </Pressable>
              <View style={s.heroBtn}>
                <PlayGlyph tone={color.onInk} size={13} />
              </View>
            </View>

            <View style={s.heroFoot}>
              <Label tone="rgba(237,236,231,0.6)">
                {displaySport(analysis.sport).toUpperCase()}
                {" · "}
                {new Date(analysis.uploadedAt)
                  .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                  .toUpperCase()}
                {analysis.duration ? ` · ${analysis.duration.toFixed(1)}S` : ""}
              </Label>
              <Text style={[T.headlineSmall, { color: color.onInk, marginTop: 6 }]}>
                {analysis.title}
              </Text>

              {/* One band per tracked joint — real readings, not a fake timeline. */}
              {risks.length > 0 && <JointStrip risks={risks} />}

              <View style={s.heroCta}>
                <Text style={[T.measuredSmall, { color: color.onInk }]}>
                  TAP TO OPEN SKELETON OVERLAY
                </Text>
              </View>
            </View>
          </View>
        </Pressable>

        {/* ── Form Index ── */}
        <Card style={s.indexCard}>
          {legacy && (
            <View style={s.legacyNote}>
              <Text style={[T.bodySmall, { color: color.rust }]}>
                This session predates pose measurement. Its numbers were generated text, not
                measurements — re-upload the clip for a real reading.
              </Text>
            </View>
          )}

          <View style={s.indexHead}>
            <Label>FORM INDEX</Label>
            <Text style={T.measuredSmall}>
              {measured ? `${frameCount(analysis)} FRAMES MEASURED` : "NOT MEASURED"}
            </Text>
          </View>

          <View style={s.indexRow}>
            <Text
              style={[
                T.metricLarge,
                analysis.overallScore === null && { color: color.textGhost },
              ]}
            >
              {analysis.overallScore === null ? "—" : Math.round(analysis.overallScore)}
            </Text>
          </View>

          {/* The same ruler as Home, so a reading means the same thing on both
              screens. Captioned with the band rather than a numeric axis —
              here the band is what's being explained. */}
          {analysis.overallScore !== null && (
            <MetricBand
              value={analysis.overallScore}
              bandLow={band?.low ?? null}
              bandHigh={band?.high ?? null}
              markerLabel="THIS CLIP"
              axisCaption={
                band ? `BAND ${Math.round(band.low)}–${Math.round(band.high)}` : null
              }
            />
          )}

          {measured && (
            <View style={s.bars}>
              {DIMENSIONS.map((d) => (
                <MetricBar
                  key={d.key}
                  name={d.label}
                  value={
                    (analysis as unknown as Record<string, number | null>)[`${d.key}Score`] ??
                    null
                  }
                />
              ))}
            </View>
          )}

          {analysis.analysisMethod === "unscored" && (
            <Text style={[T.body, { marginTop: 14 }]}>
              We couldn't track your body reliably enough in this clip to measure joint
              angles, so there are no scores. Film side-on, whole body in frame, in good
              light, with the camera steady.
            </Text>
          )}
        </Card>

        {/* ── Summary ── */}
        {analysis.summary && (
          <View style={s.section}>
            <Label style={{ marginBottom: 8 }}>READOUT</Label>
            <Text style={T.body}>{analysis.summary}</Text>
          </View>
        )}

        {processing && (
          <View style={s.section}>
            <View style={s.processingRow}>
              <ActivityIndicator size="small" color={color.cobalt} />
              <Text style={[T.bodySmall, { flex: 1 }]}>
                Writing up your coaching notes. Your measurements are already saved.
              </Text>
            </View>
          </View>
        )}

        {/* ── Flags ── */}
        {risks.length > 0 && (
          <View style={s.section}>
            <Label style={{ marginBottom: 6 }}>WHAT THE TAPE SHOWS</Label>
            {risks.map((risk, i) => (
              <FlagRow
                key={risk.id}
                first={i === 0}
                stamp={flagStamp(risk)}
                tone={risk.riskPercent >= 10 ? color.rust : color.textFaint}
                text={risk.description}
              />
            ))}
            <Text style={[T.bodySmall, { marginTop: 12, fontStyle: "italic" }]}>
              These describe joint positions measured from your video. They are not a medical
              assessment or an injury prediction.
            </Text>
          </View>
        )}

        {/* ── Strengths ── */}
        {analysis.strengths?.length > 0 && (
          <View style={s.section}>
            <Label style={{ marginBottom: 6 }}>HOLDING UP WELL</Label>
            {analysis.strengths.map((text, i) => (
              <FlagRow key={i} first={i === 0} stamp="✓" tone={color.cobalt} text={text} />
            ))}
          </View>
        )}

        {/* ── Drills ── */}
        {tips.length > 1 && (
          <View style={s.section}>
            <Label style={{ marginBottom: 10 }}>DRILLS</Label>
            {tips.slice(1).map((tip) => (
              <Card key={tip.id} style={s.tipCard}>
                <Text style={T.rowTitle}>{tip.title}</Text>
                <Text style={[T.bodySmall, { marginTop: 5 }]}>{tip.description}</Text>
                {tip.drill && (
                  <View style={s.drill}>
                    <Label tone={color.textFaint}>DRILL</Label>
                    <Text style={[T.bodySmall, { color: color.textPrimary, marginTop: 4 }]}>
                      {tip.drill}
                    </Text>
                  </View>
                )}
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── The one next action ── */}
      {prescription && (
        <View style={[s.dock, { paddingBottom: insets.bottom + 12 }]}>
          <Prescription
            compact
            text={prescription.drill || prescription.title}
            onPress={() => router.push("/(tabs)/chat")}
          />
        </View>
      )}
    </Screen>
  );
}

// ─── Hero pieces ─────────────────────────────────────────────────────────────

/** Diagonal film-strip texture — the dark ground the reading sits on. */
function FilmBackdrop() {
  return (
    <Svg width={SCREEN_W} height={HERO_H} style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern
          id="film"
          width={8}
          height={8}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(35)"
        >
          <Rect width={8} height={8} fill="#16191A" />
          <Rect width={4} height={8} fill="#1C1F21" />
        </Pattern>
      </Defs>
      <Rect width={SCREEN_W} height={HERO_H} fill="url(#film)" />
    </Svg>
  );
}

/** A stylised figure. Marks a flagged limb in rust when the session has flags. */
function SkeletonMark({ flagged }: { flagged: boolean }) {
  const bone = { stroke: color.onInk, strokeOpacity: 0.55, strokeWidth: 2 };
  const cx = SCREEN_W / 2 - 27;
  return (
    <Svg width={SCREEN_W} height={HERO_H} style={StyleSheet.absoluteFill}>
      <Circle cx={cx} cy={104} r={14} {...bone} fill="none" />
      <Line x1={cx} y1={118} x2={cx} y2={190} {...bone} />
      <Line x1={cx} y1={136} x2={cx - 36} y2={172} {...bone} />
      <Line
        x1={cx}
        y1={136}
        x2={cx + 46}
        y2={160}
        stroke={flagged ? color.rust : color.onInk}
        strokeOpacity={flagged ? 1 : 0.55}
        strokeWidth={flagged ? 2.5 : 2}
      />
      <Line x1={cx} y1={190} x2={cx - 26} y2={252} {...bone} />
      <Line x1={cx} y1={190} x2={cx + 34} y2={248} {...bone} />
      {flagged && (
        <Circle cx={cx + 46} cy={160} r={24} stroke={color.rust} strokeWidth={2} fill="none" />
      )}
    </Svg>
  );
}

/**
 * One bar per tracked joint, height and colour from that joint's reading.
 *
 * Replaces the mockup's timeline waveform, which we have no per-frame data to
 * fill honestly.
 */
function JointStrip({ risks }: { risks: RiskRecord[] }) {
  return (
    <View style={s.strip}>
      {risks.map((risk) => {
        const severity = Math.min(1, risk.riskPercent / 40);
        return (
          <View
            key={risk.id}
            style={[
              s.stripBar,
              {
                height: 6 + severity * 16,
                backgroundColor: risk.riskPercent >= 10 ? color.rust : color.onInkMuted,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function frameCount(analysis: AnalysisRecord): number {
  const metrics = (analysis as unknown as { poseMetrics?: { frameCount?: number } }).poseMetrics;
  return metrics?.frameCount ?? 0;
}

/**
 * How often this joint sat outside its safe range, as a word.
 *
 * This used to print the raw angle range (`62–104°`). Two problems with that:
 * it is the least readable thing on the screen for someone who doesn't already
 * know what a good number looks like, and — because a range is two numbers with
 * no reference — it does not actually tell them whether it was bad. "OFTEN"
 * answers the question the athlete is asking.
 *
 * The underlying angles are still measured, still stored, and still what the
 * coaching notes reason from; they are just no longer the headline. The exact
 * figures remain available on the skeleton overlay screen for anyone who wants
 * them.
 *
 * Thresholds match the bands the risk engine already uses: 10% is where a flag
 * turns from grey to rust elsewhere on this screen, so the wording changes at
 * the same point the colour does.
 */
function flagStamp(risk: RiskRecord): string {
  const pct = risk.riskPercent;
  if (pct >= 25) return "OFTEN";
  if (pct >= 10) return "SOMETIMES";
  if (pct > 0) return "BRIEFLY";
  return "ONCE";
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  centre: { alignItems: "center", justifyContent: "center", padding: 32 },

  hero: { height: HERO_H, backgroundColor: color.ink, overflow: "hidden" },
  heroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(16,19,18,0.35)" },
  heroTop: {
    position: "absolute",
    left: GUTTER,
    right: GUTTER,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.inkWashOnDark,
    alignItems: "center",
    justifyContent: "center",
  },
  heroFoot: { position: "absolute", left: GUTTER, right: GUTTER, bottom: 26 },
  heroCta: { marginTop: 12, opacity: 0.6 },

  strip: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 22, marginTop: 14 },
  stripBar: { flex: 1, borderRadius: 1, maxWidth: 26 },

  indexCard: { marginHorizontal: GUTTER, marginTop: -16 },
  indexHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  indexRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 2 },
  bars: { marginTop: 18, gap: 11 },
  legacyNote: {
    backgroundColor: "rgba(194,84,46,0.08)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },

  section: { paddingHorizontal: GUTTER, paddingTop: 24 },
  processingRow: { flexDirection: "row", alignItems: "center", gap: 12 },

  tipCard: { marginBottom: 10, padding: 16, borderRadius: radius.cardSmall },
  drill: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: color.rule,
  },

  dock: {
    position: "absolute",
    left: GUTTER,
    right: GUTTER,
    bottom: 0,
    paddingTop: 8,
  },
});
