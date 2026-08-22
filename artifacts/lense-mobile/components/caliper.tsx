/**
 * Caliper primitives.
 *
 * Everything the screens compose from. Keeping them here rather than inline in
 * each screen is what stops the system drifting — the ruler on Home and the
 * ruler on Analysis are the same component, so they cannot disagree.
 *
 * See constants/caliper.ts for the rules these encode (cobalt = next action,
 * rust = flag, mono = measured).
 */

import React from "react";
import {
  View,
  Text as RNText,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  type LayoutChangeEvent,
  type ViewStyle,
  type StyleProp,
  type TextStyle,
} from "react-native";
import Svg, { Line, Path, Circle, Polyline, Rect, Polygon } from "react-native-svg";
import { Image as ExpoImage } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, type as T, radius, GUTTER, TAB_BAR, font, delta } from "@/constants/caliper";
// Pure scale maths lives in utils/ so it can be tested without a React Native
// environment — the same reason flagSeverity and provenance live there.
import { bandScale } from "@/utils/bandScale";

// ─── Text ────────────────────────────────────────────────────────────────────

/**
 * Every piece of text in the app, with a bound on how far it scales.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * React Native's `<Text>` honours the system text size by default, and this app
 * had no bound on it anywhere: not one `maxFontSizeMultiplier`, not one
 * `allowFontScaling`. iOS's Larger Text runs to roughly 3.1x, and Caliper's
 * display styles are already 46–82pt with `lineHeight` set *below* `fontSize`
 * (`metricHeroXL` is 82/74). React Native scales `fontSize` but does not scale
 * `lineHeight`, so those styles clip as soon as they scale at all — and the
 * app is full of fixed-height furniture that a 3x label simply does not fit in.
 *
 * ── Why a wrapper and not a global default ──────────────────────────────────
 * The usual fix is `Text.defaultProps.maxFontSizeMultiplier = n` at app start.
 * React 19 removed `defaultProps` support for function components, and RN's
 * `Text` is a `forwardRef`, so that assignment is now silently ignored. A
 * wrapper is the only app-wide mechanism left.
 *
 * ── The caps ────────────────────────────────────────────────────────────────
 * Prose scales generously because that is what the setting is for. Display
 * numbers scale least: they are the largest things on screen already, and a
 * reader who needs bigger text needs the *labels* bigger, not a 250pt score.
 *
 *   scale="body"    2.0   prose, rows, buttons — the default
 *   scale="label"   1.8   small-caps labels and mono stamps
 *   scale="display" 1.3   screen titles, headlines, metric numbers
 *
 * The prop is `scale` rather than `role` because react-native's Text already
 * has a `role` prop (the ARIA one), and intersecting the two collapses to
 * `never`.
 *
 * Screens import `Text` from this module rather than from react-native. The
 * lint rule that would enforce that does not exist yet; the import is the
 * convention.
 */
const FONT_CAP = { body: 2.0, label: 1.8, display: 1.3 } as const;

export type TextScale = keyof typeof FONT_CAP;

export function Text({
  scale = "body",
  maxFontSizeMultiplier,
  ...rest
}: React.ComponentProps<typeof RNText> & { scale?: TextScale }) {
  return (
    <RNText maxFontSizeMultiplier={maxFontSizeMultiplier ?? FONT_CAP[scale]} {...rest} />
  );
}

// ─── Label ───────────────────────────────────────────────────────────────────

/** Small-caps mono section label: `FORM INDEX`, `WHAT THE TAPE SHOWS`. */
export function Label({
  children,
  tone = color.textFaint,
  style,
}: {
  children: React.ReactNode;
  tone?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text scale="label" style={[T.label, { color: tone }, style]}>
      {children}
    </Text>
  );
}

/** A measured value in mono. */
export function Measured({
  children,
  tone = color.textPrimary,
  size = 12,
  style,
}: {
  children: React.ReactNode;
  tone?: string;
  size?: number;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text scale="label" style={[T.measured, { color: tone, fontSize: size }, style]}>
      {children}
    </Text>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
  padded = true,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View style={[s.card, padded && s.cardPadded, style]}>{children}</View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => (pressed ? s.pressed : undefined)}
    >
      {body}
    </Pressable>
  );
}

// ─── App mark ────────────────────────────────────────────────────────────────

/**
 * The Caliper mark — an "A" whose crossbar is the live measurement.
 *
 * Same geometry as the app icon (`scripts/generate-icons.py`, which is the
 * source of truth for the rasters). Kept here as well so the mark can appear
 * *inside* the app without shipping a bitmap: at these sizes a PNG would either
 * be soft or oversized, and the whole mark is two strokes.
 *
 * The crossbar is the only cobalt in the mark, which is the same rule the rest
 * of the system runs on — cobalt means "the measurement", never decoration.
 *
 * Optical compensation matches the design: below ~40px the strokes thicken and
 * the apex drops, so the crossbar keeps its own row of pixels rather than
 * merging into the legs.
 */
export function AppMark({
  size = 44,
  field = color.ink,
  letter = color.paper,
  bar = color.cobalt,
  rounded = true,
}: {
  size?: number;
  /** `null` renders the mark alone, with no field behind it. */
  field?: string | null;
  letter?: string;
  bar?: string;
  rounded?: boolean;
}) {
  // Two optical sizes, matching the design's ladder. Interpolating between them
  // would smooth away a deliberate step.
  const small = size < 40;
  const apexY = small ? 50 : 44;
  const legBottom = small ? 126 : 128;
  const letterW = small ? 22 : 14;
  const barX1 = small ? 66 : 64;
  const barX2 = small ? 102 : 104;
  const barW = small ? 18 : 12;

  return (
    <View
      style={[
        { width: size, height: size, alignItems: "center", justifyContent: "center" },
        field !== null && {
          backgroundColor: field,
          borderRadius: rounded ? size * 0.226 : 0,
        },
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 168 168">
        <Path
          d={`M 50 ${legBottom} L 84 ${apexY} L 118 ${legBottom}`}
          stroke={letter}
          strokeWidth={letterW}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Line
          x1={barX1}
          y1={100}
          x2={barX2}
          y2={100}
          stroke={bar}
          strokeWidth={barW}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

// ─── Metric band (the ruler) ─────────────────────────────────────────────────

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
        style={[s.bandMarkerLabelWrap, labelAnchor]}
        pointerEvents="none"
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

// ─── Mini band (row-scale ruler) ─────────────────────────────────────────────

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

// ─── Micro axis (tile-scale ruler) ───────────────────────────────────────────

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
  tone = color.cobalt,
}: {
  value: number;
  min?: number;
  max?: number;
  bandLow?: number | null;
  bandHigh?: number | null;
  /** Marker colour — ink for live readings, rust for a flagged one. */
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

// ─── Frequency chip ──────────────────────────────────────────────────────────

/**
 * How often a finding occurred, as the evidence card's leading chip: rust wash
 * when the finding is alarming, ink wash otherwise. The word comes from
 * utils/flagSeverity so the chip and the prose can never disagree.
 */
export function FrequencyChip({ label, alarming }: { label: string; alarming: boolean }) {
  return (
    <View style={[s.freqChip, { backgroundColor: alarming ? "rgba(194,84,46,0.12)" : "rgba(16,19,18,0.06)" }]}>
      <Text
        style={[
          T.label,
          { fontSize: 9, letterSpacing: 1, color: alarming ? color.rust : color.textMuted },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

// ─── Range ruler (observed vs safe band) ─────────────────────────────────────

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

// ─── Reference row (band / previous / best) ──────────────────────────────────

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

// ─── Metric bar (per-dimension) ──────────────────────────────────────────────

/**
 * One measured dimension with its value and a proportional bar.
 *
 * `value === null` renders "not measured" rather than an empty bar, so an
 * unmeasurable dimension never reads as a score of zero.
 */
export function MetricBar({
  name,
  value,
  tone = color.ink,
  deltaValue = null,
}: {
  name: string;
  value: number | null;
  tone?: string;
  /** Signed change against the previous session; hidden when null or zero. */
  deltaValue?: number | null;
}) {
  const unmeasured = value === null;
  const deltaText = unmeasured ? null : delta(deltaValue);
  return (
    <View>
      <View style={s.metricBarHead}>
        <Text style={[T.labelTight, { color: color.textMuted }]}>{name.toUpperCase()}</Text>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 7 }}>
          {deltaText && (
            <Text
              style={[
                T.measured,
                {
                  fontSize: 10,
                  color: (deltaValue ?? 0) > 0 ? color.cobalt : color.textFaint,
                },
              ]}
            >
              {deltaText}
            </Text>
          )}
          <Text
            style={[
              T.measured,
              { fontSize: 11, color: unmeasured ? color.textGhost : color.textPrimary },
            ]}
          >
            {unmeasured ? "NOT MEASURED" : Math.round(value)}
          </Text>
        </View>
      </View>
      <View style={s.metricBarTrack}>
        {!unmeasured && (
          <View
            style={[
              s.metricBarFill,
              { width: `${Math.max(0, Math.min(100, value))}%` as `${number}%`, backgroundColor: tone },
            ]}
          />
        )}
      </View>
    </View>
  );
}

// ─── Prescription (the one cobalt element) ───────────────────────────────────

/**
 * The next action. At most one per screen — cobalt earns its meaning by being
 * the only thing wearing it.
 */
export function Prescription({
  label = "DO THIS NEXT",
  text,
  why,
  actionLabel = "Start",
  onPress,
  compact = false,
}: {
  label?: string;
  text: string;
  why?: string;
  actionLabel?: string;
  onPress?: () => void;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `${label}: ${text}` : undefined}
      style={({ pressed }) => [s.prescription, pressed && s.pressed]}
    >
      <View style={{ flex: 1 }}>
        <Label tone={color.onCobaltMuted}>{label}</Label>
        {/* Capped in the compact form. This renders in a dock floating over the
            analysis screen, and at the larger system text sizes an uncapped
            seven-line prescription covered more than half the viewport. The
            full text is one tap away. */}
        <Text
          scale="display"
          style={[compact ? T.prescriptionSmall : T.prescription, { marginTop: 7 }]}
          numberOfLines={compact ? 3 : undefined}
        >
          {text}
        </Text>
        {why && !compact && (
          <View style={s.prescriptionFoot}>
            <Text style={s.prescriptionWhy} numberOfLines={2}>
              {why}
            </Text>
            <View style={s.prescriptionCta}>
              <Text style={[T.buttonSmall, { color: color.cobalt }]}>{actionLabel}</Text>
              <Arrow tone={color.cobalt} size={13} />
            </View>
          </View>
        )}
      </View>
      {compact && (
        <View style={s.prescriptionRound}>
          <Arrow tone={color.cobalt} size={16} />
        </View>
      )}
    </Pressable>
  );
}

// ─── Flag row ────────────────────────────────────────────────────────────────

/**
 * A finding with the timestamp that produced it. The stamp is the point: a
 * claim about the athlete's movement always carries its evidence.
 */
export function FlagRow({
  stamp,
  text,
  tone = color.rust,
  first = false,
}: {
  stamp: string;
  text: string;
  tone?: string;
  first?: boolean;
}) {
  return (
    <View style={[s.flagRow, first && { borderTopWidth: 0 }]}>
      <Text style={[T.measured, s.flagStamp, { color: tone }]}>{stamp}</Text>
      <Text style={s.flagText}>{text}</Text>
    </View>
  );
}

// ─── Chip ────────────────────────────────────────────────────────────────────

export function Chip({
  label,
  selected = false,
  onPress,
  tone,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      // Without the role a screen reader reads a chip as plain text, and
      // without the state it cannot tell a chosen sport from an unchosen one —
      // which is the entire interaction on the onboarding screens.
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !onPress }}
      style={({ pressed }) => [
        s.chip,
        selected ? s.chipSelected : s.chipIdle,
        tone ? { backgroundColor: tone } : null,
        pressed && s.pressed,
      ]}
    >
      <Text style={[T.chip, { color: selected ? color.onInk : color.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Mono chip used for metric filters on Progress. */
export function MonoChip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !onPress }}
      style={({ pressed }) => [
        s.monoChip,
        { backgroundColor: selected ? color.ink : color.card },
        pressed && s.pressed,
      ]}
    >
      <Text
        style={[
          T.label,
          { letterSpacing: 1, color: selected ? color.onInk : color.textFaint },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  tone = color.ink,
  labelTone = color.onInk,
  trailingArrow = false,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  tone?: string;
  labelTone?: string;
  trailingArrow?: boolean;
}) {
  return (
    <Pressable
      // `disabled` rather than swapping onPress for undefined: the old form
      // dimmed the button to 0.4 but left it focusable and announced as
      // enabled, so a keyboard or VoiceOver user could tab to the app's main
      // button, activate it, and get nothing.
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        s.primaryBtn,
        { backgroundColor: tone, opacity: disabled ? 0.4 : 1 },
        pressed && !disabled && s.pressed,
      ]}
    >
      <Text style={[T.button, { color: labelTone }]}>{label}</Text>
      {trailingArrow && <Arrow tone={labelTone} size={16} />}
    </Pressable>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

export function Arrow({ tone = color.ink, size = 16 }: { tone?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h13" stroke={tone} strokeWidth={2.3} strokeLinecap="round" />
      <Polyline
        points="12 5 19 12 12 19"
        stroke={tone}
        strokeWidth={2.3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function Chevron({
  tone = color.textGhost,
  size = 15,
  direction = "right",
}: {
  tone?: string;
  size?: number;
  direction?: "right" | "left" | "up" | "down";
}) {
  const points =
    direction === "left"
      ? "15 18 9 12 15 6"
      : direction === "up"
        ? "18 15 12 9 6 15"
        : direction === "down"
          ? "6 9 12 15 18 9"
          : "9 18 15 12 9 6";
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline
        points={points}
        stroke={tone}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function Check({ tone = color.cobalt, size = 15 }: { tone?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline
        points="20 6 9 17 4 12"
        stroke={tone}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** Tab bar glyphs. */
export function TabIcon({
  name,
  tone,
  size = 21,
}: {
  name: "home" | "progress" | "coach" | "profile";
  tone: string;
  size?: number;
}) {
  const common = {
    stroke: tone,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === "home" && (
        <>
          <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...common} />
          <Path d="M9 22V12h6v10" {...common} />
        </>
      )}
      {name === "progress" && (
        <>
          <Path d="M23 6l-9.5 9.5-5-5L1 18" {...common} />
          <Path d="M17 6h6v6" {...common} />
        </>
      )}
      {name === "coach" && (
        <Path
          d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"
          {...common}
        />
      )}
      {name === "profile" && (
        <>
          <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" {...common} />
          <Circle cx="12" cy="7" r="4" {...common} />
        </>
      )}
    </Svg>
  );
}

/**
 * Close mark.
 *
 * Drawn rather than the literal "✕" character, which pricing used at 15px: that
 * codepoint has no consistent weight, size or baseline across platforms and it
 * sat next to a set of hand-drawn SVG glyphs that all agree with each other.
 */
/**
 * The circular back control, shared by every screen that has one.
 *
 * There were five hand-rolled copies of this — signup, login, forgot-password,
 * reset-password and onboarding — each a 34pt `Pressable` with a chevron, no
 * role and no label, so it announced as nothing and was the smallest control
 * on screens whose only other control is a full-width button. One component
 * means fixing it once.
 */
export function BackButton({
  onPress,
  label = "Back",
  tone = color.textPrimary,
}: {
  onPress: () => void;
  label?: string;
  tone?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      style={({ pressed }) => [s.backButton, pressed && s.pressed]}
    >
      <Chevron direction="left" tone={tone} size={16} />
    </Pressable>
  );
}

/**
 * Alert mark — a failed measurement, a state that needs attention.
 *
 * Replaces `@expo/vector-icons`' Feather "alert-circle" on the measure screen,
 * which was the only icon-font glyph left in an app whose marks are all drawn
 * SVG at matched weights.
 */
export function AlertGlyph({ tone = color.rust, size = 38 }: { tone?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9.2} stroke={tone} strokeWidth={1.9} fill="none" />
      <Line x1={12} y1={7.4} x2={12} y2={13} stroke={tone} strokeWidth={1.9} strokeLinecap="round" />
      <Circle cx={12} cy={16.4} r={1.1} fill={tone} />
    </Svg>
  );
}

export function CloseGlyph({ tone = color.textPrimary, size = 15 }: { tone?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={5} y1={5} x2={19} y2={19} stroke={tone} strokeWidth={2.4} strokeLinecap="round" />
      <Line x1={19} y1={5} x2={5} y2={19} stroke={tone} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

/**
 * Expand / collapse mark, for the skeleton screen's orientation toggle.
 *
 * That control was the literal "⤢" character rendered at **9px** in a 34pt
 * button — effectively invisible, and the only way to get the player into
 * landscape.
 */
export function ExpandGlyph({ tone = color.textSecondary, size = 16 }: { tone?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline points="14 4 20 4 20 10" stroke={tone} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Polyline points="10 20 4 20 4 14" stroke={tone} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Line x1={20} y1={4} x2={13} y2={11} stroke={tone} strokeWidth={2.2} strokeLinecap="round" />
      <Line x1={4} y1={20} x2={11} y2={13} stroke={tone} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function PlusGlyph({ tone = color.onCobalt, size = 20 }: { tone?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14" stroke={tone} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M5 12h14" stroke={tone} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function UploadGlyph({ tone = color.cobalt, size = 22 }: { tone?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
        stroke={tone}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points="17 8 12 3 7 8"
        stroke={tone}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path d="M12 3v12" stroke={tone} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function PlayGlyph({ tone = color.ink, size = 14 }: { tone?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points="5 3 19 12 5 21 5 3" fill={tone} />
    </Svg>
  );
}

// ─── Sparkline ───────────────────────────────────────────────────────────────

/**
 * Progress trend. Ink line, cobalt endpoint — the endpoint is "where you are
 * now", which is the actionable part.
 */
export function Sparkline({
  values,
  // A default that fitted one screen. Callers should measure and pass a width
  // — both do now — but if one forgets, 100% of whatever holds it is a far
  // better guess than a fixed 306 that overflows every phone under ~390pt.
  width,
  height = 132,
  bandLow,
  bandHigh,
}: {
  values: number[];
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
      <Circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r={10} fill={color.cobalt} fillOpacity={0.16} />
      <Circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r={5} fill={color.cobalt} />
    </Svg>
    </View>
  );
}

// ─── Screen scaffolding ──────────────────────────────────────────────────────

/** Paper background with the standard gutter. */
export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[s.screen, style]}>{children}</View>;
}

/**
 * The bottom sheet used for every modal form in the app.
 *
 * ── What the four hand-rolled copies each got wrong ─────────────────────────
 * `analyze` had one and `profile` had three. Between them:
 *
 *  - **Three had no `onRequestClose`.** That is the Android hardware back
 *    button and the web Escape key. The worst offender was the delete-account
 *    sheet: the most dangerous screen in the app, and back did nothing.
 *  - **None wrapped its inputs in a `KeyboardAvoidingView`.** The name editor,
 *    the new-session title field and the delete-account confirmation all put
 *    their submit button under the keyboard on a short device.
 *  - **The header was duplicated with different padding** in the two files, so
 *    the same sheet sat 20pt lower depending on which screen opened it.
 *  - **State survived closing.** `DeleteAccountSheet` never cleared `password`
 *    or the typed "DELETE", so reopening it showed a pre-armed form with a
 *    password still in memory.
 *
 * The last one is structural rather than a habit: the body is not rendered at
 * all while the sheet is closed, so a closed sheet holds no state, runs no
 * effects and keeps no typed password in memory.
 *
 * **That only covers state declared inside the body.** A wrapper component that
 * holds state and *returns* a `Sheet` is not unmounted by this — the caller has
 * to stop rendering the wrapper. `profile.tsx` does exactly that for the
 * delete-account sheet, and the comment there explains why.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  /** Small-caps sheet title, e.g. "NEW SESSION". */
  title: string;
  children: React.ReactNode;
  /** Set false when the body manages its own scrolling. */
  scroll?: boolean;
}) {
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={{ padding: GUTTER, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    children
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <Screen>
        <View style={s.sheetHead}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={s.sheetCancel}
          >
            <Text style={[T.buttonSmall, { color: color.textMuted }]}>Cancel</Text>
          </Pressable>
          <Label>{title}</Label>
          {/* Balances the cancel control so the title stays optically centred. */}
          <View style={s.sheetCancel} />
        </View>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* Not rendered while closed: a hidden Modal still mounts its
              children, so an invisible sheet would keep running effects and
              holding whatever was last typed into it. */}
          {visible ? body : null}
        </KeyboardAvoidingView>
      </Screen>
    </Modal>
  );
}

/**
 * A placeholder block for a loading state.
 *
 * ── Why not a spinner ───────────────────────────────────────────────────────
 * The analysis screen and the pricing screen both showed a single centred
 * `ActivityIndicator` on an otherwise blank page. A dot in the middle of
 * nothing communicates "wait" and nothing else: it does not say how much is
 * coming, it does not hold the layout, and when the content lands the whole
 * page jumps.
 *
 * Blocks in the shape of the content that is loading answer all three. They are
 * deliberately static — a shimmer animation would be motion for its own sake on
 * a screen whose whole argument is that it does not decorate.
 */
export function SkeletonBlock({
  height,
  width = "100%",
  style,
}: {
  height: number;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[s.skeleton, { height, width }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/**
 * An opaque strip behind the status bar, with a short fade below it.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * Every scrolling screen here runs its content to the top edge, so text passes
 * under the status bar as you scroll. That is ordinary iOS behaviour and most
 * apps live with it — but Caliper's paper is light and its status bar is dark,
 * so a headline scrolling past renders dark-on-dark straight through the clock.
 * Both become unreadable at once. On the welcome screen the word "measured."
 * sits directly behind the time.
 *
 * The strip is paper, the same colour as the page, so it is invisible until
 * something scrolls beneath it. The fade below keeps the edge from reading as
 * a hard line across the screen.
 *
 * Only needed on screens whose scroll view reaches the top edge. Screens with a
 * fixed header outside the scroll view (auth, pricing, onboarding, chat) do not
 * need it.
 */
export function StatusBarScrim() {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={[s.statusScrim, { height: insets.top }]}>
      <View style={{ flex: 1, backgroundColor: color.paper }} />
      <FooterFade height={14} bands={6} from="bottom" />
    </View>
  );
}

/**
 * The paper fade that sits above a floating footer.
 *
 * A dock or a footer bar that floats over a scroll view slices the content at
 * its top edge: a line of prose is cut in half mid-stroke and the page looks
 * broken rather than layered. A short gradient from transparent to paper lets
 * the text dissolve into the footer instead.
 *
 * Rendered *behind* the footer's own content and above the scroll view, so it
 * never intercepts a touch.
 */
export function FooterFade({
  height = 28,
  bands = 8,
  tone = color.paper,
  from = "top",
}: {
  height?: number;
  bands?: number;
  /** The surface being faded into. Paper by default; ink for the dark hero. */
  tone?: string;
  /** "top" fades content into a footer below; "bottom" into a header above. */
  from?: "top" | "bottom";
}) {
  /**
   * Drawn as a short opacity ramp rather than with `expo-linear-gradient`.
   *
   * The gradient version crashed the app on device:
   *
   *     View config getter callback for component
   *     `ViewManagerAdapter_ExpoLinearGradient` must be a function
   *
   * `expo-linear-gradient` is declared in package.json but had never been
   * imported by any screen, so its native view manager was never linked into
   * the iOS build. react-native-web implements it in JavaScript, which is why
   * the browser build rendered it perfectly and the simulator did not.
   *
   * Taking a native dependency — and a 30-45 minute rebuild — for a 28pt
   * cosmetic fade is the wrong trade. Eight stacked bands are indistinguishable
   * at this size and need nothing native.
   */
  return (
    <View
      pointerEvents="none"
      style={[s.footerFade, from === "top" ? { height, top: -height } : { height, bottom: 0 }]}
    >
      {Array.from({ length: bands }, (_, i) => {
        // Ease in, so the far end of the ramp is imperceptible rather than a
        // visible first step.
        const step = Math.pow((i + 1) / bands, 2);
        return (
          <View
            key={i}
            style={{
              height: height / bands,
              backgroundColor: tone,
              opacity: from === "top" ? step : 1 - step + 1 / bands,
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * Reserve exactly as much room as a floating footer actually occupies.
 *
 * ── Why this is a hook and not a constant ───────────────────────────────────
 * Screens with an absolutely-positioned footer used to reserve a hand-picked
 * number at the end of their scroll: `paddingBottom: 200` on onboarding,
 * `insets.bottom + 120` on the analysis screen. Both were measured once, by
 * eye, against one example of the footer's content.
 *
 * Then the content grew. The analysis dock holds a `Prescription` whose text
 * wraps; with a three-line drill it renders **164pt tall against 120pt of
 * reserved space**, and the last line of the last drill sits under it with no
 * scroll left to recover — permanently unreadable. Onboarding's footer carries
 * a summary line that reads "8 picked · Squat, Deadlift, …" and wraps past its
 * 200pt allowance the moment someone picks a few sports.
 *
 * A number cannot track content it has never seen. Measuring can.
 *
 *   const [clearance, onFooterLayout] = useFooterClearance();
 *   <ScrollView contentContainerStyle={{ paddingBottom: clearance }} />
 *   <View style={s.dock} onLayout={onFooterLayout} />
 *
 * `gap` is the breathing room between the last content and the footer's top
 * edge. `fallback` is used before the first layout pass so the first frame is
 * not visibly short.
 */
export function useFooterClearance(
  { gap = 16, fallback = 120 }: { gap?: number; fallback?: number } = {},
): [number, (e: LayoutChangeEvent) => void] {
  const [height, setHeight] = React.useState<number | null>(null);

  const onLayout = React.useCallback((e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    // Only commit real changes: re-setting an identical height on every layout
    // pass would re-render the screen forever.
    setHeight((prev) => (prev === null || Math.abs(prev - next) > 1 ? next : prev));
  }, []);

  return [(height ?? fallback) + gap, onLayout];
}

/** Avatar: the athlete's photo when one is set, their initials otherwise. */
export function Avatar({ name, uri, size = 40 }: { name: string; uri?: string | null; size?: number }) {
  const round = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <ExpoImage
        source={{ uri }}
        style={[s.avatar, round]}
        contentFit="cover"
        transition={120}
        accessibilityLabel={`${name}'s profile photo`}
      />
    );
  }

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <View style={[s.avatar, round]}>
      <Text style={[T.measured, { color: color.onInk, fontSize: size * 0.3 }]}>{initials}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },

  card: { backgroundColor: color.card, borderRadius: radius.card },
  cardPadded: { padding: 20 },

  pressed: { opacity: 0.82 },

  footerFade: { position: "absolute", left: 0, right: 0 },
  statusScrim: { position: "absolute", left: 0, right: 0, top: 0, zIndex: 5 },

  skeleton: { backgroundColor: "rgba(16,19,18,0.055)", borderRadius: 12 },

  sheetHead: {
    paddingHorizontal: GUTTER,
    paddingTop: 20,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetCancel: { minWidth: 56, minHeight: 44, justifyContent: "center" },

  backButton: {
    // 44: the platform minimum, met by the control itself rather than by
    // hitSlop. hitSlop still helps on device, but it does not exist on the web
    // build and it is invisible to any audit that measures what is rendered.
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.card,
    alignItems: "center",
    justifyContent: "center",
  },

  // Band
  // minHeight, not height: the marker label and the axis numbers both scale
  // with the system text size, and a fixed 52 made them collide with the ticks.
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
    backgroundColor: "rgba(16,19,18,0.32)",
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
    backgroundColor: "rgba(16,19,18,0.12)",
    borderRadius: 1,
    marginTop: 4,
  },
  miniBandFill: {
    position: "absolute",
    top: 0,
    height: 2,
    backgroundColor: "rgba(36,54,232,0.28)",
    borderRadius: 1,
  },
  miniBandMarker: {
    position: "absolute",
    top: -1.5,
    width: 2,
    height: 5,
    marginLeft: -1,
    backgroundColor: color.cobalt,
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
    backgroundColor: "rgba(16,19,18,0.14)",
  },
  microAxisFill: {
    position: "absolute",
    top: 1,
    height: 7,
    backgroundColor: color.cobaltWash,
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
  rangeRulerBand: {
    position: "absolute",
    top: 6,
    height: 11,
    backgroundColor: color.cobaltWash,
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
  metricBarHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  metricBarTrack: { height: 3, backgroundColor: color.rule, borderRadius: 2 },
  metricBarFill: { height: 3, borderRadius: 2 },

  // Prescription
  prescription: {
    backgroundColor: color.cobalt,
    borderRadius: radius.card,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  prescriptionFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    gap: 12,
  },
  prescriptionWhy: {
    flex: 1,
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.onCobaltBody,
  },
  prescriptionCta: {
    backgroundColor: color.card,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  prescriptionRound: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: color.card,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  // Flags
  flagRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: color.rule,
  },
  // Wide enough for SOMETIMES, the longest stamp, at this size — 56 wrapped it
  // to "SOMETIME\nS" on every caution-band flag.
  flagStamp: { width: 72, paddingTop: 2, fontSize: 10, letterSpacing: 0.6 },
  flagText: {
    flex: 1,
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.textPrimary,
  },

  // Chips
  // minHeight, not padding: the chip must clear 44pt for a fingertip, but it
  // must also grow rather than clip when the label wraps or the system text
  // size is turned up. Padding alone did neither — chips were 40pt and mono
  // chips 27pt.
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: "center",
  },
  chipIdle: { backgroundColor: color.card },
  chipSelected: { backgroundColor: color.ink },
  monoChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minHeight: 44,
    justifyContent: "center",
  },

  // Buttons
  primaryBtn: {
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  avatar: { backgroundColor: color.ink, alignItems: "center", justifyContent: "center" },
});

export { GUTTER, TAB_BAR };
export { bandScale } from "@/utils/bandScale";
