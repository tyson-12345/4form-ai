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
  Text,
  StyleSheet,
  Pressable,
  type ViewStyle,
  type StyleProp,
  type TextStyle,
} from "react-native";
import Svg, { Line, Path, Circle, Polyline, Rect, Polygon } from "react-native-svg";
import { color, type as T, radius, GUTTER, TAB_BAR, font } from "@/constants/caliper";

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
  return <Text style={[T.label, { color: tone }, style]}>{children}</Text>;
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
    <Text style={[T.measured, { color: tone, fontSize: size }, style]}>{children}</Text>
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
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? s.pressed : undefined)}>
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
  const span = Math.max(1, max - min);
  // Typed as a percentage template literal so it satisfies RN's DimensionValue.
  const pct = (v: number): `${number}%` =>
    `${Math.min(100, Math.max(0, ((v - min) / span) * 100))}%`;

  const hasBand =
    bandLow !== null && bandLow !== undefined && bandHigh !== null && bandHigh !== undefined;
  const hasReference = reference !== null && reference !== undefined;

  // 40 · 60 · 80 · 100 — laid out with space-between rather than positioned,
  // so the first and last labels sit flush with the ends of the scale.
  const axisTicks: number[] = [];
  for (let v = min; v <= max; v += axisEvery) axisTicks.push(v);

  return (
    <View style={s.bandWrap}>
      <View style={s.bandBaseline} />

      {hasBand && (
        <View
          style={[
            s.bandFill,
            {
              left: pct(bandLow),
              width: `${Math.max(2, ((bandHigh - bandLow) / span) * 100)}%` as `${number}%`,
            },
          ]}
        />
      )}

      <View style={s.bandTicks}>
        {Array.from({ length: tickCount }, (_, i) => (
          <View key={i} style={[s.bandTick, { height: i % 4 === 0 ? 16 : 9 }]} />
        ))}
      </View>

      {hasReference && <View style={[s.bandReference, { left: pct(reference) }]} />}

      <View style={[s.bandMarker, { left: pct(value) }]}>
        <Text style={s.bandMarkerLabel}>{markerLabel}</Text>
        <View style={s.bandMarkerStem} />
      </View>

      <View style={s.bandAxis}>
        {axisCaption ? (
          <>
            <Text style={s.bandEnd}>{min}</Text>
            <Text style={[s.bandEnd, { color: color.textFaint }]}>{axisCaption}</Text>
            <Text style={s.bandEnd}>{max}</Text>
          </>
        ) : (
          axisTicks.map((v) => (
            <Text key={v} style={s.bandEnd}>
              {v}
            </Text>
          ))
        )}
      </View>
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
        <View key={item.label}>
          <Text style={s.referenceLabel}>{item.label}</Text>
          <Text style={s.referenceValue}>{item.value}</Text>
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
}: {
  name: string;
  value: number | null;
  tone?: string;
}) {
  const unmeasured = value === null;
  return (
    <View>
      <View style={s.metricBarHead}>
        <Text style={[T.labelTight, { color: color.textMuted }]}>{name.toUpperCase()}</Text>
        <Text
          style={[
            T.measured,
            { fontSize: 11, color: unmeasured ? color.textGhost : color.textPrimary },
          ]}
        >
          {unmeasured ? "NOT MEASURED" : Math.round(value)}
        </Text>
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
      style={({ pressed }) => [s.prescription, pressed && s.pressed]}
    >
      <View style={{ flex: 1 }}>
        <Label tone={color.onCobaltMuted}>{label}</Label>
        <Text style={[compact ? T.prescriptionSmall : T.prescription, { marginTop: 7 }]}>
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
      onPress={disabled ? undefined : onPress}
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
  width = 306,
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
  if (values.length < 2) {
    return <View style={{ width, height, justifyContent: "center" }} />;
  }

  const lo = Math.min(...values, bandLow ?? Infinity);
  const hi = Math.max(...values, bandHigh ?? -Infinity);
  const span = Math.max(1, hi - lo);
  const pad = 12;

  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);

  const d = values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const bandTop = bandHigh != null ? y(bandHigh) : null;
  const bandBottom = bandLow != null ? y(bandLow) : null;

  return (
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

/** Avatar showing the athlete's initials. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
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

  // Band
  bandWrap: { marginTop: 24, height: 52, position: "relative" },
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
  bandMarker: {
    position: "absolute",
    top: 0,
    alignItems: "center",
    gap: 3,
    marginLeft: -22,
    width: 44,
  },
  bandMarkerStem: { width: 3, height: 32, backgroundColor: color.cobalt, borderRadius: 2 },
  bandMarkerLabel: {
    fontFamily: font.monoBold,
    fontSize: 9,
    letterSpacing: 1,
    color: color.cobalt,
  },
  bandAxis: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  bandEnd: {
    fontFamily: font.mono,
    fontSize: 9,
    color: color.textGhost,
  },
  referenceRow: {
    flexDirection: "row",
    gap: 22,
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: color.ruleFaint,
  },
  referenceLabel: {
    fontFamily: font.mono,
    fontSize: 9,
    letterSpacing: 1.2,
    color: color.textGhost,
  },
  referenceValue: {
    fontFamily: font.monoBold,
    fontSize: 12,
    color: color.textPrimary,
    marginTop: 3,
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
  flagStamp: { width: 56, paddingTop: 2, fontSize: 10, letterSpacing: 0.6 },
  flagText: {
    flex: 1,
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.textPrimary,
  },

  // Chips
  chip: { borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 11 },
  chipIdle: { backgroundColor: color.card },
  chipSelected: { backgroundColor: color.ink },
  monoChip: { borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: 7 },

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
