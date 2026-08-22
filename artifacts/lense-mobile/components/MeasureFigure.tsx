/**
 * The measure figure — a side-profile athlete drawn in the instrument's own
 * language, with the measured joints as nodes and the flagged ones marked.
 *
 * ── Why a profile line figure, not an anatomy chart ─────────────────────────
 * Two figures came before this. A stick figure whose one dynamic element was a
 * boolean (any flag lit the same arm), then a front-and-back anatomical body
 * map with musculature. The second was honest — only measured joints
 * responded to data — but it spoke the wrong language: a medical-poster
 * drawing, greyed and shrunk into a hero it was never designed for, showing
 * two views of a body the camera never saw from the front.
 *
 * This figure is drawn the way the athlete was told to film: side-on. It uses
 * the same vocabulary as the landing screen's caliper mark — thin ink
 * strokes, joint dots, one measuring arc — so the app opens and closes on the
 * same idea. Left/right collapse in profile, so flagged joints say which side
 * in words, which is how the flag list below names them anyway.
 *
 * ── What responds to data ───────────────────────────────────────────────────
 * Only the three joint pairs the tracker measures: elbow, hip, knee. A
 * measured joint carries a quiet ring; a flagged joint turns rust, gains the
 * measuring arc, and is labelled with its side and its observed range — the
 * evidence, on the figure, in the same type it appears everywhere else.
 * Head, spine, and feet are furniture: nothing measures them, nothing lights
 * them.
 */
/*
 * Every flag mark in this figure uses `rustOnInk`, not `rust`: this component
 * only ever draws on the analysis screen's ink hero, and the paper rust is
 * 3.2:1 against that ground.
 */

import React from "react";
import {
  View,
  StyleSheet,
} from "react-native";
import { Text } from "@/components/caliper";
import Svg, { Circle, Path } from "react-native-svg";

import { color, font } from "@/constants/caliper";
import { isAlarming } from "@/utils/flagSeverity";

/** Minimal slice of a risk record the figure needs. */
export interface FigureFinding {
  joint: string;
  riskPercent: number;
  observedMin?: number | null;
  observedMax?: number | null;
}

// ─── Geometry ────────────────────────────────────────────────────────────────
// A quarter-squat ready position, facing right: hips back, torso hinged
// forward, arm reaching forward for counterbalance. Proportions follow a
// ~7.5-head adult figure; hand-tuned against the rendered hero.

const VB = { w: 220, h: 260 };

/** Skeleton keypoints the strokes are built between. */
const K = {
  headC: { x: 122, y: 34 },
  neckTop: { x: 116, y: 47 },
  shoulder: { x: 110, y: 58 },
  elbow: { x: 138, y: 84 },
  wrist: { x: 160, y: 106 },
  hip: { x: 92, y: 122 },
  knee: { x: 128, y: 168 },
  ankle: { x: 118, y: 218 },
} as const;

/** The body as ink strokes. */
const LIMBS = [
  `M${K.neckTop.x} ${K.neckTop.y} C114 51 112 54 ${K.shoulder.x} ${K.shoulder.y}`, // neck
  `M${K.shoulder.x} ${K.shoulder.y} C102 80 96 100 ${K.hip.x} ${K.hip.y}`, // torso, hinged forward
  `M${K.shoulder.x} 60 C120 68 130 76 ${K.elbow.x} ${K.elbow.y}`, // upper arm
  `M${K.elbow.x} ${K.elbow.y} C145 92 153 99 ${K.wrist.x} ${K.wrist.y}`, // forearm
  `M${K.hip.x} ${K.hip.y} C104 138 118 154 ${K.knee.x} ${K.knee.y}`, // thigh
  `M${K.knee.x} ${K.knee.y} C125 185 121 202 ${K.ankle.x} ${K.ankle.y}`, // shin
  `M110 222 C120 224 134 224 148 221`, // foot, heel to toe
];

/** Joints the tracker measures, in profile. */
const NODES = {
  elbow: K.elbow,
  hip: K.hip,
  knee: K.knee,
} as const;

type NodeKey = keyof typeof NODES;

/** Where each node's label sits, and how it aligns. */
const LABEL_ANCHOR: Record<NodeKey, { dx: number; dy: number; align: "left" | "right" }> = {
  elbow: { dx: 16, dy: -14, align: "left" },
  hip: { dx: -16, dy: -6, align: "right" },
  knee: { dx: 16, dy: -2, align: "left" },
};

/** The measuring arc, echoing the landing mark, drawn around a flagged node. */
function arcPath(cx: number, cy: number, r: number): string {
  // A 100° sweep opening down-right, like a caliper reading the joint.
  const start = { x: cx + r * Math.cos(0.25 * Math.PI), y: cy + r * Math.sin(0.25 * Math.PI) };
  const end = { x: cx + r * Math.cos(0.8 * Math.PI), y: cy + r * Math.sin(0.8 * Math.PI) };
  return `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`;
}

// ─── Data mapping ────────────────────────────────────────────────────────────

function nodeFor(jointLabel: string): { node: NodeKey; side: "left" | "right" } | null {
  const j = jointLabel.toLowerCase();
  const side: "left" | "right" = j.includes("right") ? "right" : "left";
  if (j.includes("knee")) return { node: "knee", side };
  if (j.includes("hip")) return { node: "hip", side };
  if (j.includes("elbow")) return { node: "elbow", side };
  return null;
}

interface NodeState {
  flagged: boolean;
  sides: Set<"left" | "right">;
  /** The worst finding on this node, for the evidence label. */
  worst: FigureFinding | null;
}

function deriveNodeStates(findings: FigureFinding[]): Record<NodeKey, NodeState> {
  const states: Record<NodeKey, NodeState> = {
    elbow: { flagged: false, sides: new Set(), worst: null },
    hip: { flagged: false, sides: new Set(), worst: null },
    knee: { flagged: false, sides: new Set(), worst: null },
  };

  for (const f of findings) {
    // Only alarming findings mark the body. A caution-only flag is reported in
    // the list below; painting it here would spend the app's one alarm colour
    // on something that never left the caution band.
    if (!isAlarming(f.riskPercent)) continue;
    const target = nodeFor(f.joint);
    if (!target) continue;
    const state = states[target.node];
    state.flagged = true;
    state.sides.add(target.side);
    if (!state.worst || f.riskPercent > state.worst.riskPercent) state.worst = f;
  }
  return states;
}

function labelFor(node: NodeKey, state: NodeState): string {
  const name = node.toUpperCase();
  if (state.sides.size === 2) return `BOTH ${name}S`;
  const side = state.sides.has("right") ? "RIGHT" : "LEFT";
  return `${side} ${name}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface MeasureFigureProps {
  /** Risk findings for this clip; only alarming ones mark the figure. */
  findings: FigureFinding[];
  height?: number;
}

/**
 * Room either side of the figure for the joint labels — without it the label
 * text hits the container edge and wraps mid-word.
 */
const LABEL_GUTTER = 74;

export function MeasureFigure({ findings, height = 190 }: MeasureFigureProps) {
  const scale = height / VB.h;
  const width = VB.w * scale;
  const states = deriveNodeStates(findings);

  // The single worst finding carries its observed range on the figure.
  const worstNode = (Object.keys(NODES) as NodeKey[])
    .filter((k) => states[k].worst)
    .sort((a, b) => (states[b].worst?.riskPercent ?? 0) - (states[a].worst?.riskPercent ?? 0))[0];

  return (
    <View style={{ width: width + LABEL_GUTTER * 2, height }}>
      <Svg
        width={width}
        height={height}
        viewBox={`0 0 ${VB.w} ${VB.h}`}
        style={{ marginLeft: LABEL_GUTTER }}
      >
        {/* Furniture: head and strokes. Nothing here responds to data. */}
        <Circle
          cx={K.headC.x}
          cy={K.headC.y}
          r={13}
          stroke={color.onInk}
          strokeWidth={4.5}
          fill="none"
          opacity={0.92}
        />
        {LIMBS.map((d) => (
          <Path
            key={d}
            d={d}
            stroke={color.onInk}
            strokeWidth={4.5}
            strokeLinecap="round"
            fill="none"
            opacity={0.92}
          />
        ))}

        {/* Measured joints. */}
        {(Object.keys(NODES) as NodeKey[]).map((key) => {
          const { x, y } = NODES[key];
          const flagged = states[key].flagged;
          return (
            <React.Fragment key={key}>
              {/* Punch the node out of the limb line so it reads as a joint. */}
              <Circle cx={x} cy={y} r={7.5} fill={color.ink} />
              <Circle cx={x} cy={y} r={5} fill={flagged ? color.rustOnInk : color.onInk} />
              <Circle
                cx={x}
                cy={y}
                r={11}
                stroke={flagged ? color.rustOnInk : color.onInk}
                strokeWidth={flagged ? 2.2 : 1.2}
                opacity={flagged ? 0.95 : 0.4}
                fill="none"
              />
              {flagged && (
                <Path
                  d={arcPath(x, y, 18)}
                  stroke={color.rustOnInk}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  fill="none"
                />
              )}
            </React.Fragment>
          );
        })}
      </Svg>

      {/* Labels live outside the Svg so they use the app's real type styles. */}
      {(Object.keys(NODES) as NodeKey[]).map((key) => {
        const state = states[key];
        if (!state.flagged) return null;
        const { x, y } = NODES[key];
        const anchor = LABEL_ANCHOR[key];
        const showRange =
          key === worstNode &&
          state.worst?.observedMin != null &&
          state.worst?.observedMax != null;

        const px = (x + anchor.dx) * scale + LABEL_GUTTER;
        const py = (y + anchor.dy) * scale;

        return (
          <View
            key={key}
            style={[
              s.label,
              anchor.align === "left"
                ? { left: px, alignItems: "flex-start" }
                : { right: width + LABEL_GUTTER * 2 - px, alignItems: "flex-end" },
              { top: py },
            ]}
            pointerEvents="none"
          >
            <Text style={s.labelText} numberOfLines={1}>
              {labelFor(key, state)}
            </Text>
            {showRange && (
              <Text style={s.rangeText}>
                {Math.round(state.worst!.observedMin!)}–{Math.round(state.worst!.observedMax!)}°
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  label: { position: "absolute" },
  labelText: {
    fontFamily: font.mono,
    fontSize: 9,
    letterSpacing: 1.2,
    color: color.rustOnInk,
  },
  rangeText: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 0.4,
    color: color.rustOnInk,
    marginTop: 2,
    opacity: 0.85,
  },
});
