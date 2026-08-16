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
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import Svg, { Defs, Pattern, Rect } from "react-native-svg";

import {
  Screen,
  Card,
  Label,
  MetricBand,
  MicroAxis,
  FrequencyChip,
  RangeRuler,
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
import { flagSeverity, isAlarming } from "@/utils/flagSeverity";
// Safety net for the coaching text. The prompt already asks for plain
// language, but that is an instruction, not a guarantee — one generation that
// says "valgus" reaches a 15-year-old otherwise. Chat has always done this;
// this screen carries most of the words and did not.
import { formatBiomechanicsText } from "@/utils/formatBiomechanics";
import { provenance } from "@/utils/provenance";
import { MeasureFigure } from "@/components/MeasureFigure";

const HERO_H = 340;

/**
 * Sub-scores in the order they're presented.
 *
 * These four are the whole set. Power and speed are not "missing" — Tyson and
 * Oscar agreed on 2026-08-12 to drop them outright rather than report them as
 * unmeasured, because they cannot be derived from a single 2D camera without
 * body mass and camera distance. Oscar's fork estimated them anyway and gave
 * them 25% of the overall score; that is the disagreement this settles.
 */
const DIMENSIONS = [
  { key: "technique", label: "Technique" },
  { key: "balance", label: "Balance" },
  { key: "consistency", label: "Consistency" },
  { key: "mobility", label: "Mobility" },
] as const;

export default function AnalysisDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  // Read live rather than at module load: a width captured once at import
  // survives rotation and split view as a stale number, and the hero is laid
  // out against it.
  const { width: screenW } = useWindowDimensions();
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

  /**
   * Per-dimension bands, same derivation as the overall band: the athlete's
   * own range across measured history, absent until three readings exist. Each
   * sub-score tile plots its value against its own dimension's band — a
   * technique reading against the technique range, never the overall one.
   */
  const dimensionBands = useMemo(() => {
    const measured = history.filter(
      (a) => a.status === "complete" && a.analysisMethod === "pose-measured",
    );
    const bands: Record<string, { low: number; high: number } | null> = {};
    for (const d of DIMENSIONS) {
      const values = measured
        .map((a) => (a as unknown as Record<string, number | null>)[`${d.key}Score`])
        .filter((v): v is number => v !== null && v !== undefined);
      bands[d.key] =
        values.length < 3 ? null : { low: Math.min(...values), high: Math.max(...values) };
    }
    return bands;
  }, [history]);

  /**
   * Poll while the write-up is still being generated — with a spine.
   *
   * Quick polls while the result is genuinely imminent, then a slower cadence,
   * then stop: an analysis wedged in `processing` used to poll every three
   * seconds for as long as the screen stayed open, forever. After ~5 minutes
   * the realistic outcomes are "the server marked it failed" or "it is stuck",
   * and neither is improved by another thousand requests. `stalled` lets the
   * copy say so honestly.
   */
  const [stalled, setStalled] = useState(false);
  // Measurements persist first and flip status to "complete"; the coaching
  // prose lands seconds later. Keep the (bounded) poll alive through that gap
  // or the athlete is stranded on fallback text until they reopen the screen.
  const awaitingNarrative =
    analysis?.status === "complete" &&
    analysis.analysisMethod === "pose-measured" &&
    !analysis.summary;
  useEffect(() => {
    if (!analysis || analysis.status === "failed") return;
    if (analysis.status === "complete" && !awaitingNarrative) return;

    let polls = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      polls += 1;
      if (polls > 60) {
        // ~5 minutes on the schedule below.
        setStalled(true);
        return;
      }
      void load();
      timer = setTimeout(tick, polls < 20 ? 3000 : 8000);
    };
    timer = setTimeout(tick, 3000);
    return () => clearTimeout(timer);
  }, [analysis?.status, awaitingNarrative, load]);

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

  /**
   * The previous measured session, for the "vs last time" deltas on the
   * sub-score bars. History arrives newest-first; the previous session is the
   * first measured one that isn't this clip.
   */
  const previous = history.find(
    (a) =>
      a.id !== analysis.id &&
      a.status === "complete" &&
      a.analysisMethod === "pose-measured" &&
      new Date(a.uploadedAt) < new Date(analysis.uploadedAt),
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ── */}
        <Pressable onPress={() => router.push(`/analysis/skeleton/${analysis.id}`)}>
          <View style={s.hero}>
            <FilmBackdrop width={screenW} />
            <View style={s.heroScrim} />

            {/* Above the scrim: it is there to protect the footer text, and
                dimming the one element carrying data is the wrong trade. */}
            <View style={s.heroBody} pointerEvents="none">
              <MeasureFigure findings={risks} height={168} />
            </View>

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
                measurements. Re-upload the clip for a real reading.
              </Text>
            </View>
          )}

          <View style={s.indexHead}>
            <Label>FORM INDEX</Label>
            <Text style={T.measuredSmall}>
              {(measured && provenance(analysis.poseMetrics)) || "NOT MEASURED"}
            </Text>
          </View>

          <View style={s.indexRow}>
            <Text
              style={[
                T.metricLarge,
                analysis.overallScore === null && { color: color.textGhost },
              ]}
            >
              {analysis.overallScore === null ? "–" : Math.round(analysis.overallScore)}
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
            <View style={s.tiles}>
              {DIMENSIONS.map((d) => {
                const value =
                  (analysis as unknown as Record<string, number | null>)[`${d.key}Score`] ?? null;
                const prev = previous
                  ? ((previous as unknown as Record<string, number | null>)[`${d.key}Score`] ??
                    null)
                  : null;
                return (
                  <SubScoreTile
                    key={d.key}
                    name={d.label}
                    value={value}
                    band={dimensionBands[d.key] ?? null}
                    // The change since last session — context the athlete had
                    // to hold in their head before. Only shown when both clips
                    // actually measured the dimension.
                    deltaValue={value !== null && prev !== null ? value - prev : null}
                  />
                );
              })}
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
            <Text style={T.body}>{formatBiomechanicsText(analysis.summary)}</Text>
          </View>
        )}

        {processing && !stalled && (
          <View style={s.section}>
            <View style={s.processingRow}>
              <ActivityIndicator size="small" color={color.cobalt} />
              <Text style={[T.bodySmall, { flex: 1 }]}>
                Writing up your coaching notes. Your measurements are already saved.
              </Text>
            </View>
          </View>
        )}

        {processing && stalled && (
          <View style={s.section}>
            <Text style={T.bodySmall}>
              This is taking longer than it should. Your measurements are saved. Come back
              to this session in a little while for the coaching notes.
            </Text>
          </View>
        )}

        {/* ── Findings — evidence cards ── */}
        {risks.length > 0 && (
          <View style={s.section}>
            <Label style={{ marginBottom: 10 }}>FINDINGS · WHAT THE TAPE SHOWS</Label>
            {risks.map((risk) => (
              <FindingCard key={risk.id} risk={risk} />
            ))}
            <Text style={[T.bodySmall, { marginTop: 12, fontStyle: "italic" }]}>
              Measured joint positions from your video, read against bands for your sport — not
              a medical assessment or an injury prediction.
            </Text>
          </View>
        )}

        {/* ── Strengths ── */}
        {analysis.strengths?.length > 0 && (
          <View style={s.section}>
            <Label style={{ marginBottom: 6 }}>HOLDING UP WELL</Label>
            {analysis.strengths.map((text, i) => (
              <FlagRow
                key={i}
                first={i === 0}
                stamp="✓"
                tone={color.cobalt}
                text={formatBiomechanicsText(text)}
              />
            ))}
          </View>
        )}

        {/* ── Drills ── */}
        {tips.length > 1 && (
          <View style={s.section}>
            <Label style={{ marginBottom: 10 }}>DRILLS</Label>
            {tips.slice(1).map((tip) => (
              <Card key={tip.id} style={s.tipCard}>
                <Text style={T.rowTitle}>{formatBiomechanicsText(tip.title)}</Text>
                <Text style={[T.bodySmall, { marginTop: 5 }]}>
                  {formatBiomechanicsText(tip.description)}
                </Text>
                {tip.drill && (
                  <View style={s.drill}>
                    <Label tone={color.textFaint}>DRILL</Label>
                    <Text style={[T.bodySmall, { color: color.textPrimary, marginTop: 4 }]}>
                      {formatBiomechanicsText(tip.drill)}
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
function FilmBackdrop({ width }: { width: number }) {
  return (
    <Svg width={width} height={HERO_H} style={StyleSheet.absoluteFill}>
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
      <Rect width={width} height={HERO_H} fill="url(#film)" />
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
                backgroundColor: isAlarming(risk.riskPercent) ? color.rust : color.onInkMuted,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

// ─── Sub-score tile ──────────────────────────────────────────────────────────

/**
 * One measured dimension as a tile: value, delta, and a micro band axis so
 * even the smallest number sits against the athlete's own range for that
 * dimension. `value === null` renders "not measured" rather than an axis with
 * no marker — an unmeasured dimension has no position on the scale.
 */
function SubScoreTile({
  name,
  value,
  band,
  deltaValue,
}: {
  name: string;
  value: number | null;
  band: { low: number; high: number } | null;
  deltaValue: number | null;
}) {
  const deltaText = value === null ? null : delta(deltaValue);
  return (
    <View style={s.tile}>
      <Text style={[T.labelTight, { color: color.textMuted }]}>{name.toUpperCase()}</Text>
      <View style={s.tileRow}>
        <Text style={[T.metricMedium, value === null && { color: color.textGhost }]}>
          {value === null ? "–" : Math.round(value)}
        </Text>
        {deltaText && (
          <Text
            style={[
              T.measured,
              { fontSize: 10, color: (deltaValue ?? 0) > 0 ? color.cobalt : color.textFaint },
            ]}
          >
            {deltaText}
          </Text>
        )}
      </View>
      {value === null ? (
        <Text style={[T.measuredSmall, { marginTop: 10 }]}>NOT MEASURED</Text>
      ) : (
        <MicroAxis value={value} bandLow={band?.low ?? null} bandHigh={band?.high ?? null} />
      )}
    </View>
  );
}

// ─── Finding card ────────────────────────────────────────────────────────────

/**
 * One finding as an evidence card: how often it happened, which joint, and the
 * observed range drawn against the sport's safe band — the claim and its
 * measurement on one axis. Prose readouts used to carry this alone; the card
 * makes the evidence visible without the athlete holding numbers in their head.
 */
function FindingCard({ risk }: { risk: RiskRecord }) {
  const alarming = isAlarming(risk.riskPercent);
  const hasRange = risk.observedMin != null && risk.observedMax != null;
  const hasBand = risk.safeMin != null || risk.safeMax != null;
  const tone = alarming ? color.rust : color.textMuted;

  return (
    <Card style={s.findingCard}>
      <View style={s.findingHead}>
        <FrequencyChip
          label={flagSeverity(risk.riskPercent, risk.cautionPercent ?? 0)}
          alarming={alarming}
        />
        <Text style={[T.measured, { flex: 1, fontSize: 11, letterSpacing: 0.6 }]}>
          {risk.joint.toUpperCase()}
        </Text>
        {hasRange && (
          <Text style={[T.measured, { color: tone }]}>
            {Math.round(risk.observedMin!)}–{Math.round(risk.observedMax!)}°
          </Text>
        )}
      </View>

      {hasRange && (
        <>
          <RangeRuler
            observedMin={risk.observedMin!}
            observedMax={risk.observedMax!}
            safeMin={risk.safeMin ?? null}
            safeMax={risk.safeMax ?? null}
            alarming={alarming}
          />
          <View style={s.findingAxis}>
            <Text style={T.measuredSmall}>
              {risk.safeMin != null && risk.safeMax != null
                ? `SAFE BAND ${Math.round(risk.safeMin)}–${Math.round(risk.safeMax)}°`
                : risk.safeMax != null
                  ? `SAFE UP TO ${Math.round(risk.safeMax)}°`
                  : risk.safeMin != null
                    ? `SAFE FROM ${Math.round(risk.safeMin)}°`
                    : hasBand
                      ? ""
                      : "NO BAND FOR THIS SPORT"}
            </Text>
            <Text style={[T.measuredSmall, { color: tone }]}>
              OBSERVED {Math.round(risk.observedMin!)}–{Math.round(risk.observedMax!)}°
            </Text>
          </View>
        </>
      )}

      <Text style={[T.body, { fontSize: 13.5, lineHeight: 19, color: color.textPrimary, marginTop: 12 }]}>
        {formatBiomechanicsText(risk.description)}
      </Text>
      {risk.prevention ? (
        <Text style={[T.bodySmall, { marginTop: 6 }]}>
          {formatBiomechanicsText(risk.prevention)}
        </Text>
      ) : null}
    </Card>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// The provenance stamp is shared with Home — see utils/provenance.ts.

// flagSeverity / isAlarming live in utils/ so the thresholds can be tested —
// see utils/flagSeverity.ts for why the stamp is a word rather than an angle.

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
  // Sized and placed to clear the footer block entirely — at HERO_H 340 the
  // sport line starts near y=205, and the figures plus caption end by ~176.
  heroBody: { position: "absolute", left: 0, right: 0, top: 14, alignItems: "center" },
  heroFoot: { position: "absolute", left: GUTTER, right: GUTTER, bottom: 26 },
  heroCta: { marginTop: 12, opacity: 0.6 },

  strip: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 22, marginTop: 14 },
  stripBar: { flex: 1, borderRadius: 1, maxWidth: 26 },

  indexCard: { marginHorizontal: GUTTER, marginTop: -16 },
  indexHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  indexRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 2 },
  tiles: { marginTop: 20, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    width: "48.5%",
    backgroundColor: color.paper,
    borderRadius: 16,
    padding: 12,
  },
  tileRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 },

  findingCard: { marginBottom: 10, padding: 16, borderRadius: radius.cardSmall },
  findingHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  findingAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
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
