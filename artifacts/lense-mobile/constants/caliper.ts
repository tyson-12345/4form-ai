/**
 * Caliper — the AthleteAI design system.
 *
 * "A measuring instrument, not a scoreboard."
 *
 * The rules that make this system cohere, in priority order:
 *
 *  1. **Cobalt is reserved for the next action.** One prescription per screen,
 *     at most. If cobalt appears twice, one of them is decoration and should be
 *     ink or paper instead. Cobalt is never used for a score, a chart line, or
 *     a decorative accent.
 *
 *  2. **Rust is the alarm colour, and nothing else.** A measured joint outside
 *     its band, a destructive action, a failed operation. These read as one
 *     meaning — "something here is wrong" — so they share one colour rather
 *     than inventing a second red that would compete with it.
 *
 *     What rust is still never used for is *emphasis*: an informational notice,
 *     a highlight, a decorative rule. If nothing is wrong, it is not rust.
 *
 *     (Until 2026-08-22 this rule read "reserved for flags, never for errors or
 *     destructive buttons" while six screens used it for exactly that. The rule
 *     lost — an app needs an alarm colour — so the rule now says what the app
 *     does, and the audit removed the genuinely decorative uses.)
 *
 *  3. **Anything measured is set in mono.** Angles, percentages, frame counts,
 *     dates, bands. If a number came from a measurement, it is JetBrains Mono.
 *     Prose is Instrument Sans. Statements are Bricolage Grotesque.
 *
 *  4. **Every number is shown against the band it came from.** A bare score is
 *     a scoreboard; a score with its range is an instrument reading.
 *
 * Single light theme. The previous Volt-on-Ink system had light and dark modes;
 * Caliper's paper is load-bearing (the whole system reads as a lab notebook),
 * so there is no dark variant to keep in step.
 */

// ─── Colour ──────────────────────────────────────────────────────────────────

export const color = {
  /** App background — warm paper. */
  paper: "#EDECE7",
  /** Deeper paper, for surfaces recessed below the page. */
  paperDeep: "#DCDAD3",
  /** Raised card surface. */
  card: "#FFFFFF",

  /** Primary text and the dark furniture (tab bar, avatars, primary buttons). */
  ink: "#101312",

  /** Reserved: the one thing to do next. Never decorative. */
  cobalt: "#2436E8",
  /**
   * The alarm colour — a measured value outside its band, a destructive
   * action, a failure. Darkened from #C2542E on 2026-08-22: the original was
   * 3.86:1 on paper, so every "COULDN'T MEASURE" and every validation message
   * failed AA. This is 4.94:1 on paper and 5.84:1 on card, and reads as the
   * same rust.
   */
  rust: "#A84726",

  /**
   * The flag colour on ink surfaces — the analysis hero, the skeleton player.
   *
   * A single mid-tone rust cannot clear 4.5:1 on both paper and ink; that is
   * arithmetic, not a preference. #A84726 is 4.94:1 on paper and 3.20:1 on ink,
   * and the original #C2542E failed both (3.86 and 4.09). So the flag has a
   * dark-ground variant, exactly as `onInk` and `onCobalt` already do for text.
   * This is 5.15:1 on ink and reads as the same rust.
   *
   * Use `rust` on paper and card. Use this on ink.
   */
  rustOnInk: "#D2683F",

  /**
   * Text tiers, darkest to lightest. **Every tier meets WCAG AA (4.5:1) on
   * paper, card and paperDeep.** Do not lighten one without re-checking; the
   * harness in `e2e/audit.js` fails the build of trust if you do.
   *
   * ── Why there are four real steps and not six ────────────────────────────
   * The palette used to run to #8A8D89 (2.84:1 on paper) and #A0A39F (2.16:1).
   * Those were not a hierarchy, they were unreadable text — and they carried
   * every small-caps label, every mono stamp and every "not measured" dash in
   * the app, at 9–10px.
   *
   * Forced to 4.5:1, the bottom tiers converge: the lightest compliant grey on
   * this paper is about #676A66, and anything claiming to be lighter is either
   * the same colour or illegible. So the ladder is four separated steps
   * (15.8 / 7.7 / 6.0 / 4.6 on paper) and the finer distinctions the old tiers
   * pretended to make are carried where they belong — by size, weight and
   * case. `muted`, `faint` and `ghost` are kept as names because the call
   * sites read better for them, but they are deliberately close: the design
   * difference between them is not colour.
   *
   * Measured ratios (paper #EDECE7 / card #FFFFFF):
   *   textPrimary   15.80 / 18.68
   *   textBody       7.74 /  9.15
   *   textSecondary  5.96 /  7.05
   *   textMuted      5.23 /  6.19
   *   textFaint      4.85 /  5.73
   *   textGhost      4.57 /  5.40
   *
   * `paperDeep` is deliberately not in that list: it is a surface, not a text
   * ground — it backs progress tracks and badges, never prose. If that changes,
   * re-check, because none of the three light tiers clears 4.5:1 against it.
   */
  textPrimary: "#101312",
  textBody: "#454946",
  textSecondary: "#55595E",
  textMuted: "#5F625E",
  textFaint: "#646763",
  textGhost: "#686B67",

  /** On-dark text, for ink surfaces. */
  onInk: "#EDECE7",
  /**
   * The quiet tone on ink furniture — unselected tab glyphs, the joint chips on
   * the analysis hero.
   *
   * Was #75787A, chosen against solid ink (#101312), where it measures 4.20:1.
   * But the surface it actually sits on is the tab bar, and the tab bar is not
   * solid ink: it is ink at 0.82 over paper, which composites to rgb(56,58,56).
   * Against *that* the old value is **2.58:1** — under the 3:1 WCAG 1.4.11 asks
   * of a graphic that identifies a control, for the four controls the app is
   * navigated with. The audit measured it in the browser against the real
   * composited ground rather than against the colour the token was named for.
   *
   * #8A8D8F is 3.43:1 on the bar and 5.59:1 on solid ink, and is still visibly
   * the quiet tier beside `onInk`.
   */
  onInkMuted: "#8A8D8F",
  onInkFaint: "rgba(237,236,231,0.55)",

  /**
   * On-cobalt text. The muted and body tiers were 0.6 and 0.72 alpha, which
   * composite to 3.65:1 and 4.64:1 against cobalt — the first fails AA, and it
   * was carrying the "DO THIS NEXT" label on the prescription card. Raised so
   * both clear 4.5:1.
   */
  onCobalt: "#FFFFFF",
  onCobaltMuted: "rgba(255,255,255,0.78)",
  onCobaltBody: "rgba(255,255,255,0.86)",

  /** Hairlines and separators. */
  rule: "rgba(16,19,18,0.10)",
  ruleStrong: "rgba(16,19,18,0.16)",
  ruleFaint: "rgba(16,19,18,0.08)",
  tick: "rgba(16,19,18,0.28)",

  /** Translucent fills. */
  cobaltWash: "rgba(36,54,232,0.10)",
  cobaltWashFaint: "rgba(36,54,232,0.06)",
  inkWashOnDark: "rgba(237,236,231,0.14)",

  /**
   * Alarm washes, derived from `rust` (#A84726 = rgb(168,71,38)).
   *
   * These exist because they were previously written as literals at the call
   * site — and every one of those literals was `rgba(194,84,46,...)`, which is
   * the *pre-2026-08-22* rust (#C2542E) that this file replaced for failing
   * WCAG AA at 3.86:1. The token moved; five hand-written copies did not, so
   * FrequencyChip and the skeleton player kept painting the old colour.
   *
   * Naming them is the fix. A wash that is a token follows `rust` the next
   * time it moves; a wash that is a string in a StyleSheet does not.
   */
  rustWash: "rgba(168,71,38,0.12)",
  rustWashFaint: "rgba(168,71,38,0.08)",
  rustEdge: "rgba(168,71,38,0.40)",

  /** Neutral ink fills — badge grounds, chart tracks, skeleton blocks. */
  inkWash: "rgba(16,19,18,0.06)",
  inkWashFaint: "rgba(16,19,18,0.055)",
  inkWashSoft: "rgba(16,19,18,0.07)",
  /**
   * The firmest neutral fill. Added for the muscle map's unmeasured groups,
   * which need to sit a step above the silhouette without reading as tinted.
   * It was a literal in that file, which is how the map drifted out of the
   * system in the first place — see `rustWash` above for the same lesson.
   */
  inkWashStrong: "rgba(16,19,18,0.10)",

  /** Ink veils, for scrims laid over film and video. */
  inkVeil: "rgba(16,19,18,0.35)",
  inkVeilStrong: "rgba(16,19,18,0.75)",

  /** A badge sitting on the cobalt prescription card. */
  onCobaltWash: "rgba(255,255,255,0.18)",
} as const;

/**
 * Semantic band colours for a measured value.
 *
 * Index matches the pose tracker's risk level: 0 within range, 1 caution,
 * 2 outside band. Only level 2 gets rust — caution is ink, because an amber
 * tier would compete with the flag colour and dilute rule 2.
 */
export const bandColor = [color.ink, color.textFaint, color.rust] as const;

// ─── Type ────────────────────────────────────────────────────────────────────

/**
 * Font families, mapped to the loaded @expo-google-fonts names.
 *
 * `display` — Bricolage Grotesque. Statements: screen titles, big numbers.
 * `body`    — Instrument Sans. Everything read as prose.
 * `mono`    — JetBrains Mono. Everything measured, plus small caps labels.
 */
export const font = {
  display: "BricolageGrotesque_800ExtraBold",
  displaySemi: "BricolageGrotesque_600SemiBold",
  displayMedium: "BricolageGrotesque_500Medium",

  body: "InstrumentSans_400Regular",
  bodyMedium: "InstrumentSans_500Medium",
  bodySemi: "InstrumentSans_600SemiBold",

  mono: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_700Bold",
} as const;

/**
 * Type scale. Each entry is a complete text style — the design specifies
 * letter-spacing per size and Bricolage is tightly tracked at display sizes,
 * so sizes and tracking travel together rather than being composed ad hoc.
 */
export const type = {
  /** Screen title — "Sessions", "Progress". */
  screenTitle: {
    fontFamily: font.display,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -1,
    color: color.textPrimary,
  },
  /** Editorial headline — onboarding, pricing. */
  headline: {
    fontFamily: font.display,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -1.3,
    color: color.textPrimary,
  },
  /** Home's contextual headline. */
  headlineSmall: {
    fontFamily: font.display,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.8,
    color: color.textPrimary,
  },
  /**
   * The Form Index on Home — the single largest thing in the app.
   *
   * Deliberately outsized: it is the one number the whole product exists to
   * produce, and at this scale the band scale beneath it reads as an axis
   * rather than as decoration.
   */
  metricHeroXL: {
    fontFamily: font.display,
    fontSize: 82,
    lineHeight: 74,
    letterSpacing: -4,
    color: color.textPrimary,
  },
  /** The hero measurement — Form Index. */
  metricHero: {
    fontFamily: font.display,
    fontSize: 54,
    lineHeight: 54,
    letterSpacing: -2.5,
    color: color.textPrimary,
  },
  metricLarge: {
    fontFamily: font.display,
    fontSize: 46,
    lineHeight: 46,
    letterSpacing: -2,
    color: color.textPrimary,
  },
  metricMedium: {
    fontFamily: font.display,
    fontSize: 26,
    lineHeight: 28,
    letterSpacing: -1,
    color: color.textPrimary,
  },
  /** Per-row score in a list. */
  metricRow: {
    fontFamily: font.display,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.5,
    color: color.textPrimary,
  },
  /** Prescription copy — the cobalt card. */
  prescription: {
    fontFamily: font.displaySemi,
    fontSize: 19,
    lineHeight: 25,
    letterSpacing: -0.3,
    color: color.onCobalt,
  },
  prescriptionSmall: {
    fontFamily: font.displaySemi,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: color.onCobalt,
  },
  /** Card / row heading. */
  cardTitle: {
    fontFamily: font.displaySemi,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: color.textPrimary,
  },
  /** Body prose. */
  body: {
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 22,
    color: color.textSecondary,
  },
  bodySmall: {
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.textMuted,
  },
  /** List row title. */
  rowTitle: {
    fontFamily: font.bodySemi,
    fontSize: 14,
    lineHeight: 18,
    color: color.textPrimary,
  },
  rowSubtitle: {
    fontFamily: font.body,
    fontSize: 12,
    lineHeight: 16,
    color: color.textFaint,
  },
  /** Chat and long-form reading. */
  message: {
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 21,
    color: color.textPrimary,
  },
  /**
   * Small-caps section label — "FORM INDEX", "WHAT THE TAPE SHOWS".
   *
   * 11px, not 10. Small caps in mono with 1.6 tracking already reads smaller
   * than its nominal size, and at 10px against the (now compliant, therefore
   * darker) faint tier it was the smallest text in the app carrying real
   * meaning. The extra pixel costs nothing in layout and is the difference
   * between "quiet" and "squinting".
   */
  label: {
    fontFamily: font.monoBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.6,
    color: color.textFaint,
  },
  labelTight: {
    fontFamily: font.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    color: color.textFaint,
  },
  /** A measured value. */
  measured: {
    fontFamily: font.monoBold,
    fontSize: 12,
    lineHeight: 15,
    color: color.textPrimary,
  },
  /**
   * The smallest measured stamp — provenance lines, axis ends, weekday marks.
   *
   * Was 9px. Nine-pixel type is below the floor for anything a user has to
   * read, and this style carries the frame counts and the "not measured" dash,
   * which are content rather than decoration.
   */
  measuredSmall: {
    fontFamily: font.mono,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1,
    color: color.textGhost,
  },
  /** Button label. */
  button: {
    fontFamily: font.bodySemi,
    fontSize: 16,
    lineHeight: 20,
  },
  buttonSmall: {
    fontFamily: font.bodySemi,
    fontSize: 13,
    lineHeight: 16,
  },
  /** Chip label — sits between row text and button text. */
  chip: {
    fontFamily: font.bodyMedium,
    fontSize: 14,
    lineHeight: 18,
  },
} as const;

// ─── Space and shape ─────────────────────────────────────────────────────────

/** Screen gutter. Every screen uses this; nothing sits closer to the edge. */
export const GUTTER = 22;

/**
 * Stand-in for the top safe-area inset on the web build.
 *
 * `react-native-safe-area-context` reports zero insets in a browser, so a
 * screen that pads by `insets.top` puts its title flush against the top of the
 * viewport. Two screens carried a bare `Platform.OS === "web" ? 67 : insets.top`
 * with no explanation of where 67 came from.
 *
 * This is the height of a status bar plus a notch on a modern iPhone, which is
 * what the layout is really compensating for. The browser build is a
 * development surface, so an approximation is the right answer — but a named
 * approximation, not a magic number.
 */
export const WEB_TOP_INSET = 59;

export const radius = {
  /** Primary content cards. */
  card: 26,
  /** Nested / secondary cards. */
  cardSmall: 22,
  /** Tiles and thumbnails. */
  tile: 20,
  /** Small square icon holders. */
  icon: 13,
  /** Pills, chips, buttons. */
  pill: 999,
  /** The floating tab bar. */
  tabBar: 31,
} as const;

export const shadow = {
  /**
   * The floating tab bar's lift.
   *
   * These are the native iOS shadow properties and are *not* deprecated there;
   * `elevation` is the Android equivalent. Keep them.
   */
  tabBar: {
    shadowColor: "#101312",
    shadowOpacity: 0.28,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  /**
   * The same lift for the web build.
   *
   * react-native-web deprecates the `shadow*` props in favour of `boxShadow`
   * and warns once per style — which is noise on the surface the invariant
   * harness runs on, and noise there buries real findings.
   *
   * A separate token rather than a `Platform.select` because this file is
   * deliberately free of imports: it holds plain values so the node-environment
   * tests can read it without a React Native runtime. The call site picks.
   */
  tabBarWeb: { boxShadow: "0px 14px 30px rgba(16,19,18,0.28)" },
  /** Cards do not float — they sit on the paper. Kept for parity only. */
  none: {},
} as const;

/** Tab bar geometry, shared by the bar itself and every screen's bottom padding. */
export const TAB_BAR = {
  height: 62,
  bottomInset: 26,
  /** Total vertical space a scroll view must clear at the bottom. */
  clearance: 62 + 26 + 12,
} as const;

// ─── Motion ──────────────────────────────────────────────────────────────────

/**
 * The instrument's motion scale.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Until now the system had colour, type, radius and shadow scales but no
 * motion scale, and the result was exactly what a missing scale always
 * produces: seven different values for one idea. Press feedback was written as
 * a raw opacity at each call site and drifted to 0.6, 0.7, 0.75, 0.8, 0.82,
 * 0.85 and 0.9 — while 28 of the app's 51 controls got no feedback at all,
 * including every tab and the capture disc.
 *
 * ── The character ──────────────────────────────────────────────────────────
 * Caliper's argument is precision, so its motion is a caliper's detent rather
 * than a spring toy: critically damped, short, and always doing a job. Nothing
 * here loops, floats, shimmers or pulses. `SkeletonBlock` already refuses a
 * shimmer on the grounds that this app does not decorate, and that rule holds
 * for everything below.
 *
 * Overshoot is allowed in exactly one place — `spring.carry` — and only when
 * the user's own flick supplied the momentum. A menu that merely appeared has
 * no momentum to express, so it settles.
 *
 * Durations are milliseconds.
 */
export const motion = {
  /** Press response. Anything slower stops reading as "the control reacted". */
  instant: 90,
  /** Chips, tabs, toggles, small state swaps. */
  quick: 180,
  /** Card and content entrances, sheet bodies. */
  standard: 260,
  /** The hero reading settling onto its band — the one place we linger. */
  deliberate: 420,

  /**
   * Spring configs in Reanimated's `{ duration, dampingRatio }` form rather
   * than `{ mass, stiffness, damping }`.
   *
   * That is deliberate: the two-parameter form is the same model Apple's
   * designers use (damping ratio + response), so these values can be read
   * against Apple's published table instead of being reverse-engineered from
   * physics constants. `dampingRatio: 1` is critically damped — it reaches the
   * target and stops.
   */
  spring: {
    /** The default. Reaches the target and stops. */
    settle: { duration: 350, dampingRatio: 1 },
    /** The system's only bounce, for gesture-carried momentum. */
    carry: { duration: 400, dampingRatio: 0.8 },
  },

  /**
   * The single press treatment, replacing the seven that drifted.
   *
   * Scale *and* opacity: opacity alone reads as a control dimming, scale reads
   * as a control being pushed. 0.97 is small enough to survive on a 44pt
   * target without looking like a toy and large enough to be felt.
   */
  press: {
    scale: 0.97,
    opacity: 0.9,
    /**
     * What an unavailable control looks like.
     *
     * A token because it has to be applied *inside* the press response. The
     * press style is composed last in `Tappable` so a caller cannot break the
     * one press treatment — but that also meant a caller's own `opacity` was
     * silently overwritten by the press style's `opacity: 1`. Every disabled
     * `PrimaryButton` in the app was therefore drawn at full strength: the
     * delete-account confirm looked armed before anything had been typed, and
     * the chat send button looked ready with an empty composer.
     */
    disabled: 0.4,
  },
} as const;

// ─── Formatting helpers ──────────────────────────────────────────────────────

/**
 * Render a measured value, or the explicit "not measured" mark.
 *
 * A null score means the dimension could not be measured — never zero. The em
 * dash (en dash, not em) is the system's single, consistent way of saying so.
 */
export function measured(value: number | null | undefined, suffix = ""): string {
  return value === null || value === undefined ? "–" : `${Math.round(value)}${suffix}`;
}

/** Signed delta against a previous session, e.g. `+6` / `−3`. */
export function delta(value: number | null | undefined): string | null {
  if (value === null || value === undefined || value === 0) return null;
  // U+2212 minus, not a hyphen — it aligns with digits in mono.
  return value > 0 ? `+${Math.round(value)}` : `−${Math.abs(Math.round(value))}`;
}

/** `MON 10 AUG` — the mono date stamp used across headers. */
export function stampDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d
    .toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })
    .toUpperCase()
    .replace(/,/g, "");
}

/**
 * `08 AUG` — the short stamp used in reference marks.
 *
 * Weekday is dropped here: in a reference row the date is identifying a
 * session, not telling you what day it is, and the weekday costs width that
 * the three-column row does not have.
 */
export function stampDay(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
    .toUpperCase()
    .replace(/,/g, "");
}

/** `01:12` — a timestamp within a clip. */
export function stampTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
