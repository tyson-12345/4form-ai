/**
 * Compatibility shim: old colour keys → Caliper tokens.
 *
 * The app previously ran a two-theme Volt-on-Ink system via `useColors()`.
 * Caliper is a single light system, so this maps the old key names onto the new
 * palette. Screens that haven't been rewritten to use `constants/caliper`
 * directly still pick up the correct colours through this.
 *
 * This is a migration aid, not the destination — new code should import
 * `color` / `type` from `@/constants/caliper`. Once every screen has moved
 * over, delete this file and `constants/colors.ts` with it.
 */

import { color, radius } from "@/constants/caliper";

export function useColors() {
  return {
    // Brand
    volt: color.cobalt,
    ink: color.ink,
    primary: color.cobalt,
    primaryForeground: color.onCobalt,
    tint: color.cobalt,
    accent: color.cobalt,
    accentForeground: color.onCobalt,

    // Surfaces
    background: color.paper,
    foreground: color.textPrimary,
    text: color.textPrimary,
    card: color.card,
    cardForeground: color.textPrimary,
    surface1: color.paper,
    surface2: color.card,
    surface3: color.paperDeep,
    surface4: color.paperDeep,
    muted: color.paperDeep,
    secondary: color.paperDeep,
    secondaryForeground: color.textPrimary,
    input: color.card,

    // Text tiers
    mutedForeground: color.textMuted,
    textPrimary: color.textPrimary,
    textSecondary: color.textSecondary,
    textTertiary: color.textFaint,

    // Lines
    border: color.rule,
    borderStrong: color.ruleStrong,

    // Status. Note `warning` and `destructive` both resolve to rust: Caliper
    // has one alarm colour, and using it for two meanings is what dilutes it.
    success: color.cobalt,
    warning: color.rust,
    destructive: color.rust,
    destructiveForeground: color.onCobalt,
    energy: color.rust,

    radius: radius.card,
  };
}
