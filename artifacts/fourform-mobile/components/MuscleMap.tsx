/**
 * The muscle map — a front and back anatomical figure with each muscle group
 * tinted by what the measured joints did in this clip.
 *
 * Two rules keep it honest:
 *
 *  1. Only muscles that cross a measured joint ever take colour. Chest,
 *     shoulders, abs and traps are drawn so the figure reads as a human, but
 *     they stay neutral — pose tracking measured nothing about them.
 *  2. Band colour outranks effort colour. A flagged knee's thigh is rust even
 *     if it also worked hard; "worked hard" never hides "worked wrong".
 *
 * Both views share one silhouette: filled torso and pelvis, limbs as
 * round-capped strokes, muscles as shapes on top. The base half of each figure
 * is authored once and the other half is mirrored, so left and right can never
 * drift apart anatomically.
 */

import React from "react";
import { View } from "react-native";
import Svg, { Path, Ellipse, Rect, Circle, G, Line } from "react-native-svg";

import { Text } from "@/components/caliper";
import { color, type as T } from "@/constants/caliper";
import type { MuscleGroup, MuscleLoad, MuscleState } from "@/utils/muscleLoad";

const INK_FAINT = color.inkWashSoft;
const INK_SOFT = color.inkWashStrong;
const OUTLINE = color.ruleStrong;

/**
 * ── Why this is not a traffic light ─────────────────────────────────────────
 * It used to be: `#E8A33D` for caution and `#D63A2F` for flagged, on the
 * argument that "amber = watch it, red = outside the band" is what everyone
 * already knows. Three things were wrong with it, and the 2026-08-26 audit
 * measured all three:
 *
 *  - **The amber was invisible.** `#E8A33D` on paper is **1.82:1** — under even
 *    the 3:1 WCAG asks of a graphic that carries meaning. The state it marked
 *    could not be seen.
 *  - **It invented a second red.** `caliper.ts` rule 2 keeps one alarm colour so
 *    that "something is wrong" reads as one thing; `#D63A2F` is a different red
 *    competing with rust, and `bandColor` says caution is deliberately *not*
 *    amber precisely so it cannot dilute the flag.
 *  - **The caption was already lying.** The analysis screen says "Rust means the
 *    joint a muscle crosses spent real time outside this sport's band" while
 *    this file painted `#D63A2F`.
 *
 * So the map now says what the system says: neutral ink for work done, one rust
 * at two strengths for the two degrees of wrong. The original objection — that
 * grey read as "inactive" — is answered by depth rather than hue: an unmeasured
 * group sits at 0.10, a worked one ramps from 0.15 to 0.65, which is a far wider
 * separation than the old grey-on-grey it was rejected for.
 *
 * Effort is ink and not cobalt for the same reason: rule 1 reserves cobalt for
 * the one next action and names "a score, a chart line, or a decorative accent"
 * as what it is never for. A muscle fill is a reading.
 */
/**
 * One colour, two strengths.
 *
 * The two cannot both clear 3:1 against the card *and* against each other —
 * that is arithmetic, not a preference, the same arithmetic that forced
 * `rustOnInk` to exist. At 0.4 caution separates from flagged (3.13:1) but
 * washes out against paper (1.87:1); at 0.7 it clears paper and collapses into
 * flagged (1.80:1).
 *
 * So severity is carried by alpha and legibility by an edge: every tinted shape
 * already takes the `OUTLINE` stroke, and the legend swatches now take it too,
 * which is what defines a pale caution tint against a white card. On the figure
 * itself these are large shapes, where 2.4:1 between the two reads clearly.
 */
const CAUTION_ALPHA = 0.55;
const FLAGGED_ALPHA = 1;

/** Colour for one muscle group. Flags outrank caution outranks effort. */
function fillFor(s: MuscleState): { fill: string; opacity: number; tinted: boolean } {
  if (s.lvl === 2) return { fill: color.rust, opacity: FLAGGED_ALPHA, tinted: true };
  if (s.lvl === 1) return { fill: color.rust, opacity: CAUTION_ALPHA, tinted: true };
  if (s.work > 0.12)
    return { fill: color.ink, opacity: 0.15 + 0.5 * Math.min(1, s.work), tinted: true };
  return { fill: INK_SOFT, opacity: 1, tinted: false };
}

function M({ d, state }: { d: string; state: MuscleState }) {
  const { fill, opacity, tinted } = fillFor(state);
  // Outline only what carries information. Stroking every neutral shape is
  // what made the first version read as messy.
  return (
    <Path
      d={d}
      fill={fill}
      fillOpacity={opacity}
      stroke={tinted ? OUTLINE : "none"}
      strokeWidth={tinted ? 0.4 : 0}
    />
  );
}

/** A muscle drawn for scale only — nothing measured crosses it. */
function N({ d }: { d: string }) {
  return <Path d={d} fill={INK_SOFT} fillOpacity={0.5} />;
}

/** Head, neck, torso, pelvis, limbs — the body the muscles sit on. */
function Silhouette() {
  return (
    <G>
      <Ellipse cx={60} cy={13} rx={9} ry={10.5} fill={INK_FAINT} />
      <Rect x={55.5} y={22} width={9} height={9} fill={INK_FAINT} />
      <Path
        d="M38,34 L82,34 Q81,58 75,78 Q77,92 78,102 L42,102 Q43,92 45,78 Q39,58 38,34 Z"
        fill={INK_FAINT}
      />
      <Path d="M42,102 L78,102 L60,116 Z" fill={INK_FAINT} />
      {/* Arms and legs as round-capped strokes; widths follow segment girth. */}
      <Path d="M36,39 L28,76" stroke={INK_FAINT} strokeWidth={12} strokeLinecap="round" />
      <Path d="M28,76 L24,104" stroke={INK_FAINT} strokeWidth={9.5} strokeLinecap="round" />
      <Circle cx={23.5} cy={108} r={3.2} fill={INK_FAINT} />
      <Path d="M84,39 L92,76" stroke={INK_FAINT} strokeWidth={12} strokeLinecap="round" />
      <Path d="M92,76 L96,104" stroke={INK_FAINT} strokeWidth={9.5} strokeLinecap="round" />
      <Circle cx={96.5} cy={108} r={3.2} fill={INK_FAINT} />
      <Path d="M51,104 L49,150" stroke={INK_FAINT} strokeWidth={16} strokeLinecap="round" />
      <Path d="M49,150 L50,194" stroke={INK_FAINT} strokeWidth={11} strokeLinecap="round" />
      <Path d="M50,196 L44,202" stroke={INK_FAINT} strokeWidth={6} strokeLinecap="round" />
      <Path d="M69,104 L71,150" stroke={INK_FAINT} strokeWidth={16} strokeLinecap="round" />
      <Path d="M71,150 L70,194" stroke={INK_FAINT} strokeWidth={11} strokeLinecap="round" />
      <Path d="M70,196 L76,202" stroke={INK_FAINT} strokeWidth={6} strokeLinecap="round" />
    </G>
  );
}

/**
 * One half of the front view: the athlete's arm and leg muscles for `side`.
 * Rendered twice — once as authored, once mirrored about x=60.
 */
function FrontHalf({ side }: { side: Record<MuscleGroup, MuscleState> }) {
  return (
    <G>
      {/* Shoulder cap — drawn, never coloured: no measured joint crosses it. */}
      <N d="M37,35 Q29,36 27,45 Q27,52 31,53 Q37,51 39,42 Q39,36 37,35 Z" />
      <N d="M58,38 Q46,39 42,46 Q40,55 47,59 Q55,62 58,60 Z" />
      <M d="M31,56 Q27,60 26,70 Q26,77 29,78 Q33,75 34,65 Q34,58 31,56 Z" state={side.biceps} />
      <M d="M27,80 Q24,88 23,98 Q23,103 26,104 Q29,101 30,92 Q31,84 29,79 Q28,78 27,80 Z" state={side.forearms} />
      <M d="M48,94 Q52,103 58,108 L58,97 Q53,93 48,94 Z" state={side.hipFlexors} />
      <M d="M45,100 Q40,116 41,132 Q42,144 47,148 Q52,146 53,132 Q54,114 51,102 Q48,98 45,100 Z" state={side.quads} />
      <M d="M47,156 Q45,168 46,182 Q47,190 50,191 Q52,186 51,172 Q51,160 49,154 Q48,152 47,156 Z" state={side.calves} />
    </G>
  );
}

/** One half of the back view, same mirroring scheme. */
function BackHalf({ side }: { side: Record<MuscleGroup, MuscleState> }) {
  return (
    <G>
      <N d="M37,35 Q29,36 27,45 Q27,52 31,53 Q37,51 39,42 Q39,36 37,35 Z" />
      {/* Lats: drawn for the back's shape; the hip rows carry the colour. */}
      <N d="M56,50 Q48,50 45,58 Q43,68 47,76 Q52,80 56,78 Z" />
      <M d="M31,56 Q27,62 27,72 Q28,78 31,79 Q34,75 34,64 Q34,58 31,56 Z" state={side.triceps} />
      <M d="M27,80 Q24,88 23,98 Q23,103 26,104 Q29,101 30,92 Q31,84 29,79 Q28,78 27,80 Z" state={side.forearms} />
      <M d="M46,100 Q42,108 44,118 Q48,124 55,122 Q58,116 57,106 Q54,99 49,98 Q47,98 46,100 Z" state={side.glutes} />
      <M d="M45,126 Q42,138 44,150 Q46,157 50,156 Q53,152 53,138 Q53,130 50,124 Q47,122 45,126 Z" state={side.hamstrings} />
      <M d="M46,160 Q43,170 45,182 Q47,189 50,188 Q53,182 52,170 Q51,161 49,158 Q47,157 46,160 Z" state={side.calves} />
    </G>
  );
}

const MIRROR = "translate(120, 0) scale(-1, 1)";

function Figure({
  label,
  children,
  leftLetter,
  rightLetter,
}: {
  label: string;
  children: React.ReactNode;
  leftLetter: string;
  rightLetter: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Svg viewBox="0 0 120 215" style={{ width: "100%", aspectRatio: 120 / 215 }}>
        {children}
      </Svg>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignSelf: "stretch", paddingHorizontal: 18 }}>
        <Text style={[T.measuredSmall, { color: color.textFaint }]}>{leftLetter}</Text>
        <Text style={[T.measuredSmall, { color: color.textFaint }]}>{rightLetter}</Text>
      </View>
      <Text style={[T.measuredSmall, { marginTop: 4, color: color.textMuted }]}>{label}</Text>
    </View>
  );
}

export function MuscleMap({ load }: { load: MuscleLoad }) {
  // Lower back is one structure; it wears the worse of the two hip readings.
  const lowerBack: MuscleState =
    load.left.lowerBack.lvl >= load.right.lowerBack.lvl &&
    load.left.lowerBack.work >= load.right.lowerBack.work
      ? load.left.lowerBack
      : load.right.lowerBack.lvl > load.left.lowerBack.lvl
        ? load.right.lowerBack
        : load.left.lowerBack.work >= load.right.lowerBack.work
          ? load.left.lowerBack
          : load.right.lowerBack;

  return (
    <View style={{ flexDirection: "row", gap: 18, marginTop: 14 }}>
      {/* Front: the athlete faces you, so their right arm is on your left. */}
      <Figure label="FRONT" leftLetter="R" rightLetter="L">
        <Silhouette />
        <FrontHalf side={load.right} />
        <G transform={MIRROR}>
          <FrontHalf side={load.left} />
        </G>
        {/* Abs — centre column, drawn once, never coloured. */}
        <Path d="M54,64 Q60,62 66,64 L65,88 Q60,91 55,88 Z" fill={INK_SOFT} fillOpacity={0.5} />
        <Line x1={55} y1={72} x2={65} y2={72} stroke={OUTLINE} strokeWidth={0.4} />
        <Line x1={55} y1={80} x2={65} y2={80} stroke={OUTLINE} strokeWidth={0.4} />
      </Figure>

      {/* Back: seen from behind, their left is on your left. */}
      <Figure label="BACK" leftLetter="L" rightLetter="R">
        <Silhouette />
        <BackHalf side={load.left} />
        <G transform={MIRROR}>
          <BackHalf side={load.right} />
        </G>
        <Path d="M60,26 L47,38 L60,48 L73,38 Z" fill={INK_SOFT} fillOpacity={0.5} />
        <M d="M54,80 L66,80 L64,98 Q60,100 56,98 Z" state={lowerBack} />
      </Figure>
    </View>
  );
}

/** The colour key. Rendered by the analysis screen under the map. */
export function MuscleMapLegend() {
  /**
   * Fill and edge are separate here, where on the figure they are not.
   *
   * A swatch is 14pt of colour on a white card, so the palest of them —
   * caution at 0.55 rust — measures 2.4:1 against the card and cannot be
   * trusted to define its own shape. Ringing it in the *same colour at full
   * strength* gives it a 5.8:1 edge and says what the tint means: the same
   * alarm, less of it. The neutral swatches keep the hairline the map uses.
   */
  const items: { fill: string; edge: string; label: string }[] = [
    { fill: "rgba(16,19,18,0.55)", edge: color.ink, label: "WORKED" },
    { fill: "rgba(168,71,38,0.55)", edge: color.rust, label: "CAUTION" },
    { fill: color.rust, edge: color.rust, label: "FLAGGED" },
    { fill: INK_SOFT, edge: OUTLINE, label: "NOT MEASURED" },
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 14 }}>
      {items.map((it) => (
        <View key={it.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {/* 14, not 10: a 10pt dot is too small to carry a tonal distinction. */}
          <View
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: it.fill,
              borderWidth: 1,
              borderColor: it.edge,
            }}
          />
          <Text style={[T.measuredSmall, { color: color.textMuted }]}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}
