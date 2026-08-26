/**
 * The instrument's readouts.
 *
 * Five scales at four sizes — hero, row, tile and evidence — all driven by one
 * shared `bandScale`, because when they each did their own arithmetic they
 * each carried the same pair of bugs. Every one of them builds a spoken
 * sentence for VoiceOver: an SVG that only draws is silent.
 */

import React from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Line, Path, Circle, Polyline, Rect } from "react-native-svg";

import { color, type as T, radius, font } from "@/constants/caliper";
// Pure scale maths lives in utils/ so it can be tested without a React Native
// environment — the same reason flagSeverity and provenance live there.
import { bandScale } from "@/utils/bandScale";
import { Text, Label } from "./text";

/**
 * A value shown against the band it came from — the system's core idea.
 *
 * Draws a tick ruler across `min..max`, shades the athlete's own band, and
 * marks the current reading. A bare number is a scoreboard; this is a reading.
 */
/** Ticks, baseline and axis numbers, below the marker label. */
const BAND_SCALE_HEIGHT = 44;

export function MetricBand({
  value,
  min = 40,
  max = 100,
  bandLow,
  bandHigh,
  reference,
  markerLabel = "TODAY",
  tickCount = 25,
  axisEvery = 20,
  axisCaption,
}: {
  value: number;
  min?: number;
  max?: number;
  bandLow?: number | null;
  bandHigh?: number | null;
  /**
   * A second, unlabelled value drawn as a plain grey stem — the previous
   * session. Deliberately quieter than the cobalt marker: it is context for
   * today's reading, not a second headline.
   */
  reference?: number | null;
  markerLabel?: string;
  tickCount?: number;
  /** Spacing of the numeric axis labels, in score units. */
  axisEvery?: number;
  /**
   * Replaces the intermediate axis ticks with a single centred caption, e.g.
   * "BAND 61–79". Used on the analysis screen, where the band itself is the
   * thing being explained and a full numeric axis would repeat it.
   */
  axisCaption?: string | null;
}) {
  const hasBand =
    bandLow !== null && bandLow !== undefined && bandHigh !== null && bandHigh !== undefined;
  const hasReference = reference !== null && reference !== undefined;

  /**
   * The window has to contain everything it is asked to draw.
   *
   * `min`/`max` are a *default* window, not a clamp. A value or a band outside
   * it means the default is wrong for this athlete, not that the reading should
   * be pinned to the edge — which is what used to happen: a Form Index of 22
   * against the 40–100 default rendered at exactly the same place as a 40, and
   * the caption underneath cheerfully read "BAND 22–93" while the scale was
   * incapable of drawing it. The band fill was worse: its width was computed
   * raw while its position was clamped, so it rendered 118% wide and ran 56px
   * off the side of the card and off the screen.
   *
   * Widening instead of clamping keeps rule 4 — every number is shown against
   * the band it came from — true for every input rather than most of them.
   */
  // Rounded outward to the axis step so the labels stay round numbers.
  const { from, to, ratio, pct, fillWidth } = bandScale(
    min,
    max,
    [value, bandLow, bandHigh, reference],
    axisEvery,
  );

  const axisTicks: number[] = [];
  for (let v = from; v <= to; v += axisEvery) axisTicks.push(v);

  /**
   * Keep the label inside the track while the stem stays on the true value.
   *
   * The label is 60 wide and was centred with `marginLeft: -30`, so a reading
   * at either end pushed it clean off the card. Near an edge it anchors to that
   * edge instead; everywhere else it stays centred on the stem.
   */
  /**
   * The scale is pushed down by however tall the marker label actually is.
   *
   * The label sat at `top: 0` with the ticks hard-coded to `top: 10`, which
   * clears a 10pt label and nothing else. At the larger system text sizes the
   * label grows and lands on top of the tick marks and the axis numbers. Its
   * height is measured rather than assumed, so the scale moves with it.
   */
  const [labelHeight, setLabelHeight] = React.useState(13);
  const scaleTop = labelHeight + 4;

  const at = ratio(value);
  const labelAnchor: ViewStyle =
    at < 12
      ? { left: 0, alignItems: "flex-start" }
      : at > 88
        ? { right: 0, alignItems: "flex-end" }
        : { left: pct(value), marginLeft: -30, alignItems: "center" };

  return (
    <View
      // Height comes from the same measurement as the scale offset: every child
      // here is absolutely positioned, so the wrap cannot size itself.
      style={[s.bandWrap, { height: scaleTop + BAND_SCALE_HEIGHT }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={describeBand({ value, from, to, bandLow, bandHigh, reference, markerLabel })}
    >
      <View style={[s.bandBaseline, { top: scaleTop + 12 }]} />

      {hasBand && (
        <View
          style={[
            s.bandFill,
            {
              top: scaleTop + 6,
              left: pct(bandLow),
              width: fillWidth(bandLow, bandHigh, 2),
            },
          ]}
        />
      )}

      <View style={[s.bandTicks, { top: scaleTop }]}>
        {Array.from({ length: tickCount }, (_, i) => (
          <View key={i} style={[s.bandTick, { height: i % 4 === 0 ? 16 : 9 }]} />
        ))}
      </View>

      {hasReference && (
        <View style={[s.bandReference, { top: scaleTop + 4, left: pct(reference) }]} />
      )}

      <View
        // Spans the tick band only. A 32pt stem hung down into the axis row and
        // struck through the "20", which is the number it is pointing at.
        style={[s.bandMarkerStem, s.bandStemAbs, { top: scaleTop - 3, left: pct(value) }]}
      />
      <View
        style={[[s.bandMarkerLabelWrap, labelAnchor], { pointerEvents: "none" }]}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          setLabelHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
        }}
      >
        <Text scale="label" style={s.bandMarkerLabel} numberOfLines={1}>
          {markerLabel}
        </Text>
      </View>

      <View style={s.bandAxis}>
        {axisCaption ? (
          <>
            <Text scale="label" style={s.bandEnd}>{from}</Text>
            <Text style={[s.bandEnd, { color: color.textFaint }]}>{axisCaption}</Text>
            <Text scale="label" style={s.bandEnd}>{to}</Text>
          </>
        ) : (
          axisTicks.map((v) => (
            <Text key={v} scale="label" style={s.bandEnd}>
              {v}
            </Text>
          ))
        )}
      </View>
    </View>
  );
}

/**
 * What a screen reader hears instead of the drawing.
 *
 * The band *is* the product's output, so leaving it as an unlabelled pile of
 * SVG made the one thing the app exists to say invisible to anyone using
 * VoiceOver.
 */
function describeBand({
  value,
  from,
  to,
  bandLow,
  bandHigh,
  reference,
  markerLabel,
}: {
  value: number;
  from: number;
  to: number;
  bandLow?: number | null;
  bandHigh?: number | null;
  reference?: number | null;
  markerLabel: string;
}): string {
  const parts = [`${markerLabel.toLowerCase()}: ${Math.round(value)} on a scale of ${from} to ${to}`];
  if (bandLow != null && bandHigh != null) {
    parts.push(`your usual range is ${Math.round(bandLow)} to ${Math.round(bandHigh)}`);
    if (value < bandLow) parts.push("below your usual range");
    else if (value > bandHigh) parts.push("above your usual range");
    else parts.push("inside your usual range");
  }
  if (reference != null) parts.push(`previous session ${Math.round(reference)}`);
  return parts.join(". ") + ".";
}

/**
 * The band scale at list-row size: a hairline with the athlete's band washed
 * in and a marker for this row's reading. The redesign's rule taken to its
 * smallest case — even a number in a list row sits against its band.
 *
 * Renders nothing when the value is null (an unmeasured session has no
 * position on the scale) — never a marker at zero.
 */
export function MiniBand({
  value,
  min = 40,
  max = 100,
  bandLow,
  bandHigh,
  width = 34,
}: {
  value: number | null;
  min?: number;
  max?: number;
  bandLow?: number | null;
  bandHigh?: number | null;
  width?: number;
}) {
  if (value === null) return null;
  const { pct, fillWidth } = bandScale(min, max, [value, bandLow, bandHigh]);
  const hasBand = bandLow != null && bandHigh != null;

  return (
    <View
      style={[s.miniBand, { width }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        hasBand
          ? `${Math.round(value)}, against your usual ${Math.round(bandLow!)} to ${Math.round(bandHigh!)}`
          : `${Math.round(value)}`
      }
    >
      {hasBand && (
        <View
          style={[
            s.miniBandFill,
            { left: pct(bandLow), width: fillWidth(bandLow, bandHigh, 4) },
          ]}
        />
      )}
      <View style={[s.miniBandMarker, { left: pct(value) }]} />
    </View>
  );
}

/**
 * The band scale at tile size: baseline, band wash, one marker stem. Sits
 * under a sub-score or a live joint reading so even the smallest number is an
 * instrument reading rather than a bare figure.
 */
export function MicroAxis({
  value,
  min = 40,
  max = 100,
  bandLow,
  bandHigh,
  tone = color.ink,
}: {
  value: number;
  min?: number;
  max?: number;
  bandLow?: number | null;
  bandHigh?: number | null;
  /**
   * Marker colour — ink for a reading, rust for a flagged one.
   *
   * The default was cobalt, which this comment never listed and rule 1
   * forbids. The skeleton player always passed a tone and was correct; the
   * analysis screen omits it, so its four sub-score tiles each drew a cobalt
   * marker.
   */
  tone?: string;
}) {
  const { pct, fillWidth } = bandScale(min, max, [value, bandLow, bandHigh]);
  const hasBand = bandLow != null && bandHigh != null;

  return (
    <View
      style={s.microAxis}
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        hasBand
          ? `${Math.round(value)}, against your usual ${Math.round(bandLow!)} to ${Math.round(bandHigh!)}`
          : `${Math.round(value)}`
      }
    >
      <View style={s.microAxisBase} />
      {hasBand && (
        <View
          style={[
            s.microAxisFill,
            { left: pct(bandLow), width: fillWidth(bandLow, bandHigh, 4) },
          ]}
        />
      )}
      <View style={[s.microAxisMarker, { left: pct(value), backgroundColor: tone }]} />
    </View>
  );
}

/**
 * How often a finding occurred, as the evidence card's leading chip: rust wash
 * when the finding is alarming, ink wash otherwise. The word comes from
 * utils/flagSeverity so the chip and the prose can never disagree.
 */
export function FrequencyChip({ label, alarming }: { label: string; alarming: boolean }) {
  return (
    <View style={[s.freqChip, { backgroundColor: alarming ? color.rustWash : color.inkWash }]}>
      <Text
        style={[
          T.label,
          { letterSpacing: 1, color: alarming ? color.rust : color.textMuted },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * The evidence card's ruler: the joint's safe band as a cobalt wash, the
 * observed range as a line with end stems. One glance answers "how far outside
 * the band did it actually go?" — the claim and its evidence on one axis.
 *
 * The domain is fitted to the data with padding rather than fixed 0–180, so a
 * 10° excursion is visible rather than a sliver.
 */
export function RangeRuler({
  observedMin,
  observedMax,
  safeMin,
  safeMax,
  alarming,
}: {
  observedMin: number;
  observedMax: number;
  safeMin: number | null;
  safeMax: number | null;
  alarming: boolean;
}) {
  const PAD = 14;
  const lo = Math.max(0, Math.min(observedMin, safeMin ?? observedMin) - PAD);
  const hi = Math.min(185, Math.max(observedMax, safeMax ?? observedMax) + PAD);
  const span = Math.max(1, hi - lo);
  const pct = (v: number): `${number}%` =>
    `${Math.min(100, Math.max(0, ((v - lo) / span) * 100))}%`;

  const tone = alarming ? color.rust : color.textFaint;
  const bandLeft = safeMin ?? lo;
  const bandRight = safeMax ?? hi;

  /**
   * Clamped, like every other fill in this file.
   *
   * `hi` is capped at 185 but `bandRight` is not, so a band whose upper bound
   * sits above that cap would render wider than its own track. It cannot happen
   * today — `safeBandOf` on the server maps the profiles' 999 "no upper flag"
   * sentinel to null before it ships — but that is a guarantee two modules away
   * from here, and the same unclamped shape is what put a 118%-wide fill on the
   * home screen.
   */
  const ratio = (v: number) => Math.min(100, Math.max(0, ((v - lo) / span) * 100));
  const bandWidth = `${Math.max(
    2,
    Math.min(100 - ratio(bandLeft), ratio(bandRight) - ratio(bandLeft)),
  )}%` as `${number}%`;

  const description =
    `Observed ${Math.round(observedMin)} to ${Math.round(observedMax)} degrees` +
    (safeMin !== null && safeMax !== null
      ? `, against a safe band of ${Math.round(safeMin)} to ${Math.round(safeMax)}`
      : safeMax !== null
        ? `, safe up to ${Math.round(safeMax)}`
        : safeMin !== null
          ? `, safe from ${Math.round(safeMin)}`
          : ", with no band for this sport") +
    (alarming ? ". Outside the band." : ".");

  return (
    <View
      style={s.rangeRuler}
      accessible
      accessibilityRole="image"
      accessibilityLabel={description}
    >
      <View style={s.rangeRulerBase} />
      {(safeMin !== null || safeMax !== null) && (
        <View style={[s.rangeRulerBand, { left: pct(bandLeft), width: bandWidth }]} />
      )}
      <View
        style={[
          s.rangeRulerObserved,
          {
            left: pct(observedMin),
            width: `${Math.max(1, ((observedMax - observedMin) / span) * 100)}%` as `${number}%`,
            backgroundColor: tone,
          },
        ]}
      />
      <View style={[s.rangeRulerStem, { left: pct(observedMin), backgroundColor: tone }]} />
      <View style={[s.rangeRulerStem, { left: pct(observedMax), backgroundColor: tone }]} />
    </View>
  );
}

/**
 * The stats that give a reading its context, under the band scale.
 *
 * A bare number is a scoreboard. This row is what makes the hero metric an
 * instrument reading — it always answers "compared to what?". Entries whose
 * value is null are dropped rather than shown as "—", because an absent
 * comparison is not a measurement of nothing.
 */
export function ReferenceRow({
  items,
}: {
  items: { label: string; value: string | null }[];
}) {
  const present = items.filter((i) => i.value !== null);
  if (present.length === 0) return null;

  return (
    <View style={s.referenceRow}>
      {present.map((item) => (
        <View key={item.label} style={s.referenceItem}>
          <Text scale="label" style={s.referenceLabel}>
            {item.label}
          </Text>
          <Text scale="label" style={s.referenceValue}>
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Progress trend. Ink line, and an endpoint marking "where you are now".
 *
 * The endpoint used to be cobalt unconditionally. That is fine on the one hero
 * trend and wrong on the four sub-metric tiles beneath it, which render the
 * same component — five cobalt endpoints on one screen, against rule 1's "if
 * cobalt appears twice, one of them is decoration". `tone` now defaults to ink
 * and the hero passes cobalt, so the reservation survives repetition.
 */
export function Sparkline({
  values,
  tone = color.ink,
  // A default that fitted one screen. Callers should measure and pass a width
  // — both do now — but if one forgets, 100% of whatever holds it is a far
  // better guess than a fixed 306 that overflows every phone under ~390pt.
  width,
  height = 132,
  bandLow,
  bandHigh,
}: {
  values: number[];
  /** Endpoint marker. Cobalt only on a screen's single hero trend. */
  tone?: string;
  width?: number;
  height?: number;
  bandLow?: number | null;
  bandHigh?: number | null;
}) {
  // Nothing to draw, and nothing to draw it in.
  if (values.length < 2 || !width || width <= 0) {
    return <View style={{ width: width ?? "100%", height, justifyContent: "center" }} />;
  }

  const lo = Math.min(...values, bandLow ?? Infinity);
  const hi = Math.max(...values, bandHigh ?? -Infinity);
  const span = Math.max(1, hi - lo);
  const pad = 12;

  /**
   * The horizontal inset exists because the last point carries a marker.
   *
   * `x` used to run flush from 0 to `width`, while the final reading is drawn
   * as a 10pt halo around a 5pt dot — so half of that halo sat outside the SVG
   * and was clipped by its own viewport, on every sparkline in the app. The
   * clipped dot is the most recent session, the one the eye goes to first.
   */
  const xPad = 11;
  const x = (i: number) => xPad + (i / (values.length - 1)) * Math.max(1, width - xPad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);

  const d = values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const bandTop = bandHigh != null ? y(bandHigh) : null;
  const bandBottom = bandLow != null ? y(bandLow) : null;

  // What VoiceOver hears instead of the line. A trend drawn as pure SVG is
  // silent, and the trend is most of what this screen is for.
  const first = values[0]!;
  const last = values.at(-1)!;
  const move = Math.round(last - first);
  const description =
    `Trend across ${values.length} sessions. ` +
    `From ${Math.round(first)} to ${Math.round(last)}, ` +
    (move === 0 ? "no overall change" : move > 0 ? `up ${move}` : `down ${Math.abs(move)}`) +
    (bandLow != null && bandHigh != null
      ? `. Your usual range is ${Math.round(bandLow)} to ${Math.round(bandHigh)}.`
      : ".");

  return (
    // The accessibility props sit on a wrapping View, not on <Svg>:
    // react-native-svg forwards unknown props to the DOM node on web, and
    // `accessible={true}` on an <svg> element is a React DOM warning.
    <View accessible accessibilityRole="image" accessibilityLabel={description}>
    <Svg width={width} height={height}>
      {[0.08, 0.4, 0.72].map((f, i) => (
        <Line
          key={i}
          x1={0}
          y1={height * f}
          x2={width}
          y2={height * f}
          stroke={color.ink}
          strokeOpacity={0.08}
        />
      ))}
      {bandTop !== null && bandBottom !== null && (
        <Rect
          x={0}
          y={bandTop}
          width={width}
          height={Math.max(2, bandBottom - bandTop)}
          fill={color.cobalt}
          fillOpacity={0.06}
        />
      )}
      <Path d={d} fill="none" stroke={color.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r={10} fill={tone} fillOpacity={0.16} />
      <Circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r={5} fill={tone} />
    </Svg>
    </View>
  );
}

/**
 * The hero slot when there is no reading yet.
 *
 * Home and Progress both drew a bare en dash at the hero type size — 46 to 82px
 * of Bricolage ExtraBold. At that weight an en dash is not a mark meaning
 * "nothing was measured", it is a solid grey slab that reads as redacted text.
 *
 * The dash is right; the size and the silence were not. This keeps the system's
 * single "not measured" mark, drops it to a size where it reads as punctuation,
 * and says out loud what it means — in mono, because the absence of a
 * measurement is still a statement about a measurement.
 */
export function NoReading({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 10 }, style]}>
      <Text scale="display" style={[T.metricMedium, { color: color.textGhost }]}>
        –
      </Text>
      <Text style={[T.measuredSmall, { color: color.textFaint }]}>NOT MEASURED</Text>
    </View>
  );
}

const s = StyleSheet.create({
  bandWrap: { marginTop: 28, minHeight: 58, position: "relative" },

  bandBaseline: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 22,
    height: 1,
    backgroundColor: color.ruleStrong,
  },

  bandFill: {
    position: "absolute",
    top: 16,
    height: 13,
    backgroundColor: color.cobaltWash,
    borderRadius: 3,
  },

  bandTicks: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },

  bandTick: { width: 1, backgroundColor: color.tick },
  /** The previous session — grey, unlabelled, deliberately quieter than TODAY. */

  bandReference: {
    position: "absolute",
    top: 14,
    width: 2,
    height: 18,
    marginLeft: -1,
    backgroundColor: color.tick,
  },
  // Wide enough for "THIS CLIP", the longest marker label — 44 wrapped it.
  /**
   * The label rides above the stem but is anchored, not centred, near the ends
   * of the track — a centred 60-wide label at 0% hung 30px off the card.
   */
  // 72, not 60: "THIS CLIP" at 10px mono with 1pt tracking overran a 60pt box
  // and rendered as "THIS CL…".

  bandMarkerLabelWrap: { position: "absolute", top: 0, width: 72 },
  /** The stem marks the true value and is never nudged to fit the label. */

  bandStemAbs: { position: "absolute", marginLeft: -1.5 },

  bandMarkerStem: { width: 3, height: 26, backgroundColor: color.cobalt, borderRadius: 2 },

  bandMarkerLabel: {
    fontFamily: font.monoBold,
    fontSize: 10,
    letterSpacing: 1,
    color: color.cobalt,
  },

  bandAxis: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  bandEnd: {
    fontFamily: font.mono,
    fontSize: 11,
    color: color.textGhost,
  },

  referenceRow: {
    flexDirection: "row",
    // Wraps. At large system text sizes three fixed columns ran past the card
    // and clipped "BEST" to "BE"; wrapping stacks them instead of hiding them.
    flexWrap: "wrap",
    gap: 22,
    rowGap: 14,
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: color.ruleFaint,
  },

  referenceItem: { flexShrink: 1 },

  referenceLabel: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    color: color.textGhost,
  },

  referenceValue: {
    fontFamily: font.monoBold,
    fontSize: 12,
    color: color.textPrimary,
    marginTop: 3,
  },

  // Mini band (row scale)

  miniBand: {
    height: 2,
    backgroundColor: color.inkWashStrong,
    borderRadius: 1,
    marginTop: 4,
  },

  // Ink, not cobalt. This scale is drawn once per list row — twelve times on a
  // full Sessions screen — and rule 1's test for decoration is that cobalt
  // appears more than once. A row scale is a reading, not a prescription.
  miniBandFill: {
    position: "absolute",
    top: 0,
    height: 2,
    backgroundColor: color.tick,
    borderRadius: 1,
  },

  miniBandMarker: {
    position: "absolute",
    top: -1.5,
    width: 2,
    height: 5,
    marginLeft: -1,
    backgroundColor: color.ink,
    borderRadius: 1,
  },

  // Micro axis (tile scale)

  microAxis: { height: 10, marginTop: 8, position: "relative" },

  microAxisBase: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 4,
    height: 1,
    backgroundColor: color.ruleStrong,
  },

  microAxisFill: {
    position: "absolute",
    top: 1,
    height: 7,
    backgroundColor: color.inkWashStrong,
    borderRadius: 2,
  },

  microAxisMarker: {
    position: "absolute",
    top: 0,
    width: 2,
    height: 9,
    marginLeft: -1,
    borderRadius: 1,
  },

  // Frequency chip

  freqChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },

  // Range ruler (observed vs safe band)

  rangeRuler: { height: 24, marginTop: 14, position: "relative" },

  rangeRulerBase: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 11,
    height: 1,
    backgroundColor: color.ruleStrong,
  },

  // The safe band on an evidence card. Ink, because a finding list draws one
  // of these per flagged joint — up to six on an analysis — and cobalt that
  // repeats six times is no longer reserved for anything.
  rangeRulerBand: {
    position: "absolute",
    top: 6,
    height: 11,
    backgroundColor: color.inkWashStrong,
    borderRadius: 3,
  },

  rangeRulerObserved: {
    position: "absolute",
    top: 11,
    height: 2,
    borderRadius: 1,
  },

  rangeRulerStem: {
    position: "absolute",
    top: 7,
    width: 2,
    height: 10,
    marginLeft: -1,
    borderRadius: 1,
  },

  // Metric bar
});
