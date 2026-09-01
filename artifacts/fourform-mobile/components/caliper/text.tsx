/**
 * Type primitives.
 *
 * Screens import `Text` from Caliper rather than from react-native, because
 * this is where the Dynamic Type cap lives — `Text.defaultProps` stopped
 * working under React 19, so the cap has to travel with a component.
 */

import React from "react";
import { Text as RNText, type StyleProp, type TextStyle } from "react-native";

import { color, type as T } from "@/constants/caliper";

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
