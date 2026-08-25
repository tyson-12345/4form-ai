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
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Svg, { Defs, Pattern, Rect } from "react-native-svg";

import {
  Card,
  Chevron,
  FlagRow,
  FooterFade,
  Entering,
  FrequencyChip,
  Label,
  MetricBand,
  MicroAxis,
  PlayGlyph,
  Prescription,
  PrimaryButton,
  RangeRuler,
  Screen,
  SkeletonBlock,
  Text,
  useFooterClearance,
  Tappable,
} from "@/components/caliper";
import { color, type as T, radius, GUTTER, font, delta } from "@/constants/caliper";
import {
  analyses as analysesApi,
  ApiError,
  type AnalysisRecord,
  type TipRecord,
  type RiskRecord,
} from "@/lib/api";
import { displaySport } from "@/constants/sports";
import { deleteVideo, resolveVideo } from "@/lib/videoStore";
import { alert } from "@/lib/alert";
import { flagSeverity, isAlarming } from "@/utils/flagSeverity";
import { MuscleMap, MuscleMapLegend } from "@/components/MuscleMap";
import { deriveMuscleLoad } from "@/utils/muscleLoad";
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

  // The dock's real height, measured — see useFooterClearance. A fixed 120 left
  // the last drill line permanently under a 164pt dock.
  const [dockClearance, onDockLayout] = useFooterClearance({ gap: 16, fallback: 140 });

  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  const [tips, setTips] = useState<TipRecord[]>([]);
  const [risks, setRisks] = useState<RiskRecord[]>([]);
  // "missing" is kept apart from "error": a session that is gone will never
  // come back, so a "Try again" button on it is one that cannot work.
  const [state, setState] = useState<"loading" | "ready" | "error" | "missing">("loading");
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
    } catch (err) {
      setState(err instanceof ApiError && err.status === 404 ? "missing" : "error");
    }
  }, [id]);

  // Refetch on every focus, not just mount. The athlete can delete a session
  // from this same screen, or measure a new clip, and come back — a band drawn
  // from the history as it stood at first mount would quietly plot this clip
  // against a range that no longer exists.
  useFocusEffect(
    useCallback(() => {
      void load();
      void analysesApi
        .list()
        .then(({ analyses }) => setHistory(analyses))
        .catch(() => {
          /* band is optional context — a failure here must not blank the screen */
        });
    }, [load]),
  );

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

  /**
   * Re-run this clip under the sport the coach thinks it actually is. The
   * video never left the device, so "upload it again" is unnecessary — resolve
   * the stored file and walk back into the measure flow with the corrected
   * sport. A missing file (reinstall, cleared storage) degrades to an honest
   * explanation instead of a broken push. Declared before the early returns:
   * hooks must run on every render.
   */
  const remeasureAs = useCallback(
    async (suggestedSport: string) => {
      if (!analysis) return;
      const video = await resolveVideo(analysis.id);
      if (video.status !== "ready") {
        alert(
          "This clip isn't on this phone anymore",
          "Videos stay on your device, not our servers, and this one is gone — likely a reinstall or cleared storage. Film or upload it again from Analyze.",
        );
        return;
      }
      router.push({
        pathname: "/analysis/measure",
        params: { uri: video.uri, sport: suggestedSport.toLowerCase(), title: analysis.title },
      });
    },
    [analysis, router],
  );

  if (state === "loading") {
    return (
      <Screen>
        {/* Shaped like the screen that is coming — hero, index card, prose —
            rather than a spinner alone on paper. */}
        <SkeletonBlock height={HERO_H} style={{ borderRadius: 0 }} />
        <View style={{ paddingHorizontal: GUTTER }}>
          <SkeletonBlock height={188} style={{ marginTop: -16, borderRadius: 26 }} />
          <SkeletonBlock height={13} width="34%" style={{ marginTop: 28 }} />
          <SkeletonBlock height={15} style={{ marginTop: 12 }} />
          <SkeletonBlock height={15} style={{ marginTop: 8 }} />
          <SkeletonBlock height={15} width="72%" style={{ marginTop: 8 }} />
        </View>
      </Screen>
    );
  }

  if (state === "missing") {
    return (
      <Screen style={s.centre}>
        <Text scale="display" style={[T.cardTitle, { textAlign: "center" }]}>
          This session is no longer here
        </Text>
        <Text style={[T.body, { textAlign: "center", marginTop: 8, maxWidth: 300 }]}>
          It was deleted, or this link points at a session that belongs to another account.
        </Text>
        <View style={{ alignSelf: "stretch", marginTop: 24 }}>
          <PrimaryButton
            label="Back to your sessions"
            onPress={() => router.replace("/(tabs)/analyze")}
          />
        </View>
      </Screen>
    );
  }

  if (state === "error" || !analysis) {
    return (
      <Screen style={s.centre}>
        <Text scale="display" style={[T.cardTitle, { textAlign: "center" }]}>
          We couldn&apos;t load this session
        </Text>
        <Text style={[T.body, { textAlign: "center", marginTop: 8, maxWidth: 300 }]}>
          Your measurements are safe. This is usually a connection problem.
        </Text>
        {/* The only option here used to be "Go back", so a dropped request
            meant leaving the screen and finding the session again. A retry is
            the obvious recovery and it was missing. */}
        <View style={{ alignSelf: "stretch", marginTop: 24, gap: 10 }}>
          <PrimaryButton
            label="Try again"
            onPress={() => {
              setState("loading");
              void load();
            }}
          />
          <PrimaryButton
            label="Go back"
            tone={color.card}
            labelTone={color.textPrimary}
            onPress={() => router.back()}
          />
        </View>
      </Screen>
    );
  }

  const measured = analysis.analysisMethod === "pose-measured";
  const legacy = analysis.analysisMethod === "legacy-unverified";
  const processing = analysis.status === "processing" || analysis.status === "pending";

  // Muscle-group tints for the muscle map. Cheap pure derivation, recomputed
  // per render rather than memoised: the input is a small stats object.
  const muscleLoad = analysis.poseMetrics?.joints
    ? deriveMuscleLoad({
        frameCount: analysis.poseMetrics.frameCount ?? 0,
        joints: analysis.poseMetrics.joints,
        riskFrames: analysis.poseMetrics.riskFrames,
      })
    : null;

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
      {/* The root layout sets a dark status bar, which is right for Caliper's
          paper and invisible against this screen's ink hero. */}
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + (prescription ? dockClearance : 24),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ──
            The whole hero used to be one Pressable with the back button nested
            inside it. On the web build the inner click bubbled, so tapping back
            went back *and* pushed the skeleton screen. The tappable area is now
            a sibling of the controls rather than their ancestor, so the two
            cannot both fire. */}
        <View style={s.hero}>
          <FilmBackdrop width={screenW} />
          <View style={s.heroScrim} />

          {/* Above the scrim: it is there to protect the footer text, and
              dimming the one element carrying data is the wrong trade. */}
          <View style={[s.heroBody, { pointerEvents: "none" }]}>
            <MeasureFigure findings={risks} height={168} />
          </View>

          {/* The open-skeleton target: everything below the top controls. */}
          <Tappable
            onPress={() => router.push(`/analysis/skeleton/${analysis.id}`)}
            accessibilityRole="button"
            accessibilityLabel="Open the skeleton overlay for this clip"
            style={[StyleSheet.absoluteFill, { top: insets.top + 52 }]}
          />

          <View style={[s.heroTop, { top: insets.top + 6 }]}>
            <Tappable
              onPress={() => router.back()}
              style={s.heroBtn}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Chevron direction="left" tone={color.onInk} size={16} />
            </Tappable>
            {/* This was a bare View styled exactly like the back button next to
                it — same size, same fill, same radius — holding a play glyph
                and doing nothing at all. Playback lives on the skeleton screen,
                so it now says so and goes there. */}
            <Tappable
              onPress={() => router.push(`/analysis/skeleton/${analysis.id}`)}
              style={s.heroBtn}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Play this clip with the skeleton overlay"
            >
              <PlayGlyph tone={color.onInk} size={13} />
            </Tappable>
          </View>

          <View style={[s.heroFoot, { pointerEvents: "none" }]}>
            {/* Ink scrim directly above the footer text. At large system text
                sizes the footer grows upward into the skeleton figure and the
                two drew over each other; the figure now dissolves into ink
                instead of crossing the words. */}
            <FooterFade height={64} tone={color.ink} />
              <Label tone="rgba(237,236,231,0.6)">
                {displaySport(analysis.sport).toUpperCase()}
                {" · "}
                {new Date(analysis.uploadedAt)
                  .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                  .toUpperCase()}
                {analysis.duration ? ` · ${analysis.duration.toFixed(1)}S` : ""}
              </Label>
              <Text scale="display" style={[T.headlineSmall, { color: color.onInk, marginTop: 6 }]}>
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

        {/* ── Wrong sport ──
            Sits above the scores because it changes how to read them: every band
            this clip was judged against belongs to the sport that was picked, so
            if that pick was wrong the numbers below are measured against the
            wrong ruler. Written as a question, not a correction: the sport is
            chosen per clip and training outside your sport is a legitimate,
            supported thing to do. */}
        {analysis.sportMismatch && (
          <View style={s.section}>
            <View style={s.mismatchNote}>
              <Label style={{ color: color.cobalt }}>CHECK THE SPORT</Label>
              <Text style={[T.body, { marginTop: 8 }]}>{analysis.sportMismatch.message}</Text>
              <Text style={[T.bodySmall, { marginTop: 10, color: color.textMuted }]}>
                Scored against {displaySport(analysis.sport) || analysis.sport}. Re-measuring
                creates a new session and uses one analysis from your monthly allowance.
              </Text>
              {/* The instruction used to end here, telling the athlete to
                  re-upload with no way to do it — a dead end walked in full.
                  The clip is still on the device; offer the action itself. */}
              <Tappable
                onPress={() => void remeasureAs(analysis.sportMismatch!.suggestedSport)}
                style={[s.mismatchCta]}
              >
                <Text style={[T.buttonSmall, { color: color.onCobalt }]}>
                  Measure again as{" "}
                  {displaySport(analysis.sportMismatch.suggestedSport) ||
                    analysis.sportMismatch.suggestedSport}
                </Text>
              </Tappable>
            </View>
          </View>
        )}

        {/* ── Form Index ── */}
        <Entering index={0}>
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
              scale="display" style={[
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
        </Entering>

        {/* ── Muscle load ──
            The measured joints, drawn on a body. A joint is moved by the
            muscles that cross it, so each measured joint tints its muscle
            groups: knees the thigh and calf, hips the glutes and lower back,
            elbows the arm. Inference from measurement, and labelled as such —
            the untinted muscles are the ones nothing measured crosses. */}
        {measured && muscleLoad?.assessed && (
          <View style={s.section}>
            <Card>
              <View style={s.indexHead}>
                <Label>MUSCLE LOAD</Label>
                <Text style={T.measuredSmall}>FROM MEASURED JOINTS</Text>
              </View>
              <MuscleMap load={muscleLoad} />
              <MuscleMapLegend />
              <Text style={[T.bodySmall, { marginTop: 12, color: color.textMuted }]}>
                Tint depth is how far each joint travelled. Rust means the joint a muscle
                crosses spent real time outside this sport's band.
              </Text>
            </Card>
          </View>
        )}

        {/* ── Summary ── */}
        {analysis.summary && (
          <Entering index={1} style={s.section}>
            <Label style={{ marginBottom: 8 }}>READOUT</Label>
            <Text style={T.body}>{formatBiomechanicsText(analysis.summary)}</Text>
          </Entering>
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
          <Entering index={2} style={s.section}>
            <Label style={{ marginBottom: 10 }}>FINDINGS · WHAT THE TAPE SHOWS</Label>
            {risks.map((risk) => (
              <FindingCard key={risk.id} risk={risk} />
            ))}
            <Text style={[T.bodySmall, { marginTop: 12, fontStyle: "italic" }]}>
              Measured joint positions from your video, read against bands for your sport — not
              a medical assessment or an injury prediction.
            </Text>
          </Entering>
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

        {/* ── Remove ──
            Deleting a session was long-press-only on the Sessions list: no
            affordance, no hint, and unreachable for anyone using VoiceOver or
            switch control. The list keeps the shortcut; this is the path a user
            can actually find. */}
        <View style={s.section}>
          <Tappable
            onPress={() =>
              alert(analysis.title, "Delete this session and its clip?", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      await analysesApi.delete(analysis.id);
                      await deleteVideo(analysis.id);
                      router.back();
                    } catch {
                      alert("Couldn't delete", "Please try again.");
                    }
                  },
                },
              ])
            }
            accessibilityRole="button"
            accessibilityLabel="Delete this session"
            style={[s.deleteRow]}
          >
            <Text style={[T.rowTitle, { color: color.rust }]}>Delete this session</Text>
          </Tappable>
          <Text style={[T.bodySmall, { marginTop: 8 }]}>
            Removes the measurements, the coaching notes, and the clip stored on this phone.
            Your monthly quota is not refunded.
          </Text>
        </View>

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
        <View style={[s.dock, { paddingBottom: insets.bottom + 12 }]} onLayout={onDockLayout}>
          {/* Content used to be sliced dead flat at the dock's top edge. */}
          <FooterFade />
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
                backgroundColor: isAlarming(risk.riskPercent) ? color.rustOnInk : color.onInkMuted,
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
        <Text scale="display" style={[T.metricMedium, value === null && { color: color.textGhost }]}>
          {value === null ? "–" : Math.round(value)}
        </Text>
        {/* Neutral, matching Home and Progress. This was the third delta
            rendering in the app and the last one still painting a change in the
            colour reserved for the next action. */}
        {deltaText && (
          <Text style={[T.measured, { fontSize: 11, color: color.textSecondary }]}>
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
    // 34 before. hitSlop carried the touch target on native, but not on web,
    // and this is the only way off the screen.
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.inkWashOnDark,
    alignItems: "center",
    justifyContent: "center",
  },
  // Sized and placed to clear the footer block entirely — at HERO_H 340 the
  // sport line starts near y=205, and the figures plus caption end by ~176.
  heroBody: { position: "absolute", left: 0, right: 0, top: 14, alignItems: "center" },
  // Full bleed, then padded in, so the ink scrim above it reaches both screen
  // edges. Inset by GUTTER the fade stopped short and the figure stayed visible
  // in the two margins.
  heroFoot: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 26,
    paddingHorizontal: GUTTER,
  },
  heroCta: { marginTop: 12, opacity: 0.6 },

  strip: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 22, marginTop: 14 },
  stripBar: { flex: 1, borderRadius: 1, maxWidth: 26 },

  indexCard: { marginHorizontal: GUTTER, marginTop: -16 },
  indexHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 4,
  },
  indexRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 2 },
  tiles: { marginTop: 20, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    width: "48.5%",
    backgroundColor: color.paper,
    borderRadius: 16,
    padding: 12,
  },
  tileRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },

  findingCard: { marginBottom: 10, padding: 16, borderRadius: radius.cardSmall },
  findingHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  findingAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    columnGap: 10,
    marginTop: 4,
  },
  legacyNote: {
    backgroundColor: color.rustWashFaint,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },

  // Cobalt, not rust: this is a "check this" prompt, not a finding about the
  // athlete's movement, and it should not compete with a flagged joint.
  mismatchNote: {
    backgroundColor: "rgba(36,54,232,0.07)",
    borderLeftWidth: 3,
    borderLeftColor: color.cobalt,
    borderRadius: 0,
    padding: 14,
  },
  mismatchCta: {
    marginTop: 12,
    alignSelf: "flex-start",
    backgroundColor: color.cobalt,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },

  section: { paddingHorizontal: GUTTER, paddingTop: 24 },
  deleteRow: {
    minHeight: 44,
    justifyContent: "center",
    borderTopWidth: 1,
    borderTopColor: color.rule,
    paddingTop: 16,
  },
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
    backgroundColor: color.paper,
  },
});
