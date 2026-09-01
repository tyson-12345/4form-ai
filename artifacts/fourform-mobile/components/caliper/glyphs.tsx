/**
 * Glyphs.
 *
 * Every mark in the app is drawn here as SVG rather than pulled from an icon
 * font. That is why there is no `@expo/vector-icons` dependency and no literal
 * "✕" or "⤢" characters left in the screens: a drawn glyph takes a tone and a
 * size from the system, and a character takes whatever the font decides.
 */

import React from "react";
import { View } from "react-native";
import Svg, { Line, Path, Circle, Polyline, Rect, Polygon } from "react-native-svg";

import { color } from "@/constants/caliper";

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

/**
 * Send. Points up rather than right — the composer sits at the foot of the
 * transcript, so "up" is where the message is going.
 */
export function SendGlyph({ tone = color.onInk, size = 17 }: { tone?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 19V5" stroke={tone} strokeWidth={2} strokeLinecap="round" />
      <Polyline
        points="5 12 12 5 19 12"
        stroke={tone}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function TrashGlyph({ tone = color.textMuted, size = 16 }: { tone?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6h18" stroke={tone} strokeWidth={2} strokeLinecap="round" />
      <Path
        d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
        stroke={tone}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        stroke={tone}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function CameraGlyph({ tone = color.onCobalt, size = 11 }: { tone?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M4 8 h3 l2-2.5 h6 L17 8 h3 a1.5 1.5 0 0 1 1.5 1.5 v9 a1.5 1.5 0 0 1 -1.5 1.5 H4 a1.5 1.5 0 0 1 -1.5 -1.5 v-9 A1.5 1.5 0 0 1 4 8 Z"
        fill="none"
        stroke={tone}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={13.5} r={3.4} fill="none" stroke={tone} strokeWidth={2.4} />
    </Svg>
  );
}
