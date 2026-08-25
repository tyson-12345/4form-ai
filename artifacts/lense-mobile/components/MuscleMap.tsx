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

const INK_FAINT = "rgba(16,19,18,0.07)";
const INK_SOFT = "rgba(16,19,18,0.10)";
const OUTLINE = "rgba(16,19,18,0.16)";

/**
 * Traffic-light semantics, because that is what everyone already knows:
 * amber = watch it, red = outside the band. The first version used the app's
 * gray/rust band colours, and gray read as "inactive" rather than "caution".
 */
const CAUTION = "#E8A33D";
const FLAGGED = "#D63A2F";

/** Colour for one muscle group. Flags outrank caution outranks effort. */
function fillFor(s: MuscleState): { fill: string; opacity: number; tinted: boolean } {
  if (s.lvl === 2) return { fill: FLAGGED, opacity: 0.9, tinted: true };
  if (s.lvl === 1) return { fill: CAUTION, opacity: 0.85, tinted: true };
  if (s.work > 0.12)
    return { fill: color.cobalt, opacity: 0.15 + 0.5 * Math.min(1, s.work), tinted: true };
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
  const items: { swatch: string; opacity: number; label: string }[] = [
    { swatch: color.cobalt, opacity: 0.55, label: "WORKED" },
    { swatch: CAUTION, opacity: 0.85, label: "CAUTION" },
    { swatch: FLAGGED, opacity: 0.9, label: "FLAGGED" },
    { swatch: INK_SOFT, opacity: 1, label: "NOT MEASURED" },
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 14 }}>
      {items.map((it) => (
        <View key={it.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: it.swatch,
              opacity: it.opacity,
            }}
          />
          <Text style={[T.measuredSmall, { color: color.textMuted }]}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}
