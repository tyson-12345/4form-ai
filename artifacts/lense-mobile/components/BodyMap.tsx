/**
 * Body map — front and back, with the flagged joints marked.
 *
 * Replaces the fixed stick figure that used to sit above every analysis. That
 * one was hardcoded artwork with a single boolean behind it: any flag at all
 * turned one arm rust, always the same arm, so a flagged left knee highlighted
 * the right elbow.
 *
 * What lights up here is only ever a region centred on a joint the tracker
 * measured. It deliberately does not shade muscle groups — see the header of
 * `constants/bodyMap.ts` for why that line matters.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path, G, Defs, ClipPath } from "react-native-svg";

import { color, font } from "@/constants/caliper";
import {
  SILHOUETTE,
  VIEWBOX,
  FRONT_DETAIL,
  BACK_DETAIL,
  FRONT_REGIONS,
  BACK_REGIONS,
  type BodyRegion,
} from "@/constants/bodyMap";

interface FigureProps {
  detail: string[];
  regions: BodyRegion[];
  flagged: Set<string>;
  width: number;
  height: number;
  /** Clip paths are referenced by id, so the two figures must not collide. */
  uid: string;
}

function Figure({ detail, regions, flagged, width, height, uid }: FigureProps) {
  const clipId = `bodyclip-${uid}`;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}>
      <Defs>
        <ClipPath id={clipId}>
          <Path d={SILHOUETTE} />
        </ClipPath>
      </Defs>

      <Path
        d={SILHOUETTE}
        fill={color.onInk}
        fillOpacity={0.26}
        stroke={color.onInk}
        strokeOpacity={0.55}
        strokeWidth={1.1}
      />

      <G clipPath={`url(#${clipId})`}>
        {regions
          .filter((r) => flagged.has(r.joint))
          .map((r) => (
            <Path key={r.joint} d={r.d} fill={color.rust} fillOpacity={0.92} />
          ))}
      </G>

      <G clipPath={`url(#${clipId})`}>
        {detail.map((d, i) => (
          <Path
            key={i}
            d={d}
            fill="none"
            stroke={color.onInk}
            strokeOpacity={0.34}
            strokeWidth={0.9}
            strokeLinecap="round"
          />
        ))}
      </G>
    </Svg>
  );
}

export interface BodyMapProps {
  /** Joint labels to mark, e.g. "left knee". Anything unrecognised is ignored. */
  flagged: string[];
  /** Height of each figure; width follows from the viewBox ratio. */
  height?: number;
}

export function BodyMap({ flagged, height = 196 }: BodyMapProps) {
  const set = React.useMemo(
    () => new Set(flagged.map((j) => j.toLowerCase().trim())),
    [flagged],
  );
  const width = (height * VIEWBOX.width) / VIEWBOX.height;

  return (
    <View style={s.row}>
      <View style={s.col}>
        <Figure
          detail={FRONT_DETAIL}
          regions={FRONT_REGIONS}
          flagged={set}
          width={width}
          height={height}
          uid="front"
        />
        <Text style={s.caption}>FRONT</Text>
      </View>

      <View style={s.col}>
        <Figure
          detail={BACK_DETAIL}
          regions={BACK_REGIONS}
          flagged={set}
          width={width}
          height={height}
          uid="back"
        />
        <Text style={s.caption}>BACK</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 18 },
  col: { alignItems: "center", gap: 5 },
  caption: {
    fontFamily: font.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    color: color.onInkFaint,
  },
});
