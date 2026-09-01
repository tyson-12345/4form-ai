/**
 * Controls — everything a finger lands on.
 */

import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
  type TextInputProps,
  type TextStyle,
  type AccessibilityRole,
} from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { color, type as T, radius, font, motion } from "@/constants/caliper";
import { SETTLE, usePressResponse, useMotionEnabled } from "@/lib/motion";
import * as haptics from "@/lib/haptics";
import { Text, Label } from "./text";
import { Arrow, Chevron } from "./glyphs";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Inset of the indicator from the control's edge. */
const SEGMENT_PAD = 3;

// ─── The press response ──────────────────────────────────────────────────────

/**
 * Every control in the app that is not already a `PrimaryButton` or a `Chip`.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * 28 of the app's 51 pressables had no pressed state at all — including all
 * four tabs and the cobalt capture disc, the single most-tapped control in the
 * product. The 23 that did have one had drifted to seven different opacity
 * values, because "dim it a bit on press" is the sort of thing everyone
 * reimplements slightly differently.
 *
 * One component fixes both halves. It also fixes something neither half had:
 * the response is a **scale as well as an opacity**, and it fires on press-in
 * rather than on release. Apple's first rule of fluid interfaces is that the
 * moment lag appears, directness "falls off a cliff" — a control that waits
 * for touch-up to acknowledge a touch reads as dead, however fast the action
 * behind it is.
 *
 * ── On hit targets ─────────────────────────────────────────────────────────
 * `hitSlop` is accepted but is not the answer. This app deliberately meets 44pt
 * with real geometry, because hitSlop does not exist on the web build and is
 * invisible to any audit that measures what is rendered. Pass `minTarget` to
 * get the padding instead.
 */
export function Tappable({
  children,
  onPress,
  onLongPress,
  disabled = false,
  haptic,
  minTarget = false,
  dim,
  style,
  accessibilityRole = "button",
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  hitSlop,
  testID,
  accessibilityActions,
  onAccessibilityAction,
}: {
  /** Optional: an overlay hit-target legitimately has no children. */
  children?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Fires on commit, not on press-in — the haptic marks the action, not the touch. */
  haptic?: "tap" | "select" | "commit";
  /** Pads the control out to 44pt rather than relying on hitSlop. */
  minTarget?: boolean;
  /**
   * Resting opacity, for a control that is deliberately quiet while still
   * being pressable — the "Coming soon" plan button, which explains itself on
   * tap. A disabled control does not need this: it dims to
   * `motion.press.disabled` on its own.
   *
   * Set here rather than in the caller's `style` because the press response is
   * composed last and would overwrite it.
   */
  dim?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: { selected?: boolean; disabled?: boolean; busy?: boolean; expanded?: boolean };
  hitSlop?: number;
  testID?: string;
  /** Rotor actions, e.g. the swipe-to-delete on a session row. */
  accessibilityActions?: readonly { name: string; label?: string }[];
  onAccessibilityAction?: (e: { nativeEvent: { actionName: string } }) => void;
}) {
  const interactive = !disabled && (!!onPress || !!onLongPress);
  // Only an *explicitly* disabled control dims. A `Tappable` with no handler is
  // also treated as disabled below, but that is decoration — a heading, a
  // wrapper — and dimming it would be wrong.
  const press = usePressResponse(!disabled, dim ?? (disabled ? motion.press.disabled : 1));

  return (
    <AnimatedPressable
      onPress={
        onPress
          ? () => {
              if (haptic) haptics[haptic]();
              onPress();
            }
          : undefined
      }
      onLongPress={onLongPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={disabled || (!onPress && !onLongPress)}
      hitSlop={hitSlop}
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, ...accessibilityState }}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      style={[
        // Explicit, because Reanimated's animated wrapper drops the
        // `cursor: pointer` that react-native-web's bare Pressable sets. That
        // is not only a web-cursor nicety: `e2e/audit.js` identifies a
        // pressable *by* that cursor, so without it every migrated control
        // became invisible to the harness's 44pt target and missing-role
        // checks — a green audit that had quietly stopped looking.
        interactive && s.interactive,
        minTarget && s.minTarget,
        style,
        press.style,
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * A round icon control, 44pt by construction.
 *
 * Generalises `BackButton`, which four screens had already re-implemented as a
 * local `headBtn` / `closeBtn` / `headerBtn` / `heroBtn` — one of them with a
 * comment reading "Matches BackButton", which is the clearest possible sign
 * that the primitive was missing rather than unwanted.
 */
export function IconButton({
  children,
  onPress,
  label,
  tone = color.card,
  disabled = false,
  haptic,
  style,
}: {
  children: React.ReactNode;
  onPress: () => void;
  /** Spoken label. Required — an icon with no name is a mystery to VoiceOver. */
  label: string;
  tone?: string;
  disabled?: boolean;
  haptic?: "tap" | "select" | "commit";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Tappable
      onPress={onPress}
      disabled={disabled}
      haptic={haptic}
      accessibilityLabel={label}
      style={[s.iconButton, { backgroundColor: tone }, style]}
    >
      {children}
    </Tappable>
  );
}

/**
 * A pill. Interactive when given an `onPress`, a plain label when not.
 *
 * ── Why the two shapes ─────────────────────────────────────────────────────
 * This used to render a `Tappable` either way, and `Tappable` treats a handler-
 * less control as genuinely disabled — correct for a control, wrong for a
 * label. Two screens use chips as decoration: the welcome screen shows eight
 * sports plus a "+13 more" tag to say what the app covers, and Compare tags a
 * reference athlete's attributes. Both rendered as `<button aria-disabled>`,
 * so the landing screen announced **nine dimmed buttons** to a screen reader
 * before it announced either of its two real actions.
 *
 * A chip that cannot be pressed is not a broken button, it is a word.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  tone,
}: {
  label: string;
  selected?: boolean;
  /** Omit to render a non-interactive label rather than a disabled control. */
  onPress?: () => void;
  tone?: string;
}) {
  const style = [
    s.chip,
    selected ? s.chipSelected : s.chipIdle,
    tone ? { backgroundColor: tone } : null,
  ];
  const body = (
    <Text style={[T.chip, { color: selected ? color.onInk : color.textPrimary }]}>
      {label}
    </Text>
  );

  if (!onPress) return <View style={style}>{body}</View>;

  return (
    <Tappable
      onPress={onPress}
      // Selection is the entire interaction on onboarding's five screens, and
      // it happened in silence. `select` is the detent.
      haptic={selected ? undefined : "select"}
      // Without the role a screen reader reads a chip as plain text, and
      // without the state it cannot tell a chosen sport from an unchosen one.
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={style}
    >
      {body}
    </Tappable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  tone = color.ink,
  labelTone = color.onInk,
  trailingArrow = false,
  haptic = "commit",
  style,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /**
   * In flight.
   *
   * Every submitting screen used to signal this by rewriting the label —
   * "Sign in" became "Signing in…" — which moves the button's width, says
   * nothing to a screen reader, and leaves the control looking pressable
   * throughout. A spinner beside a steady label says the same thing without
   * any of that.
   */
  loading?: boolean;
  tone?: string;
  labelTone?: string;
  trailingArrow?: boolean;
  /** Pass `undefined` to stay silent — a secondary action need not be felt. */
  haptic?: "tap" | "select" | "commit";
  style?: StyleProp<ViewStyle>;
}) {
  const blocked = disabled || loading;

  return (
    <Tappable
      // `disabled` rather than swapping onPress for undefined: the old form
      // dimmed the button to 0.4 but left it focusable and announced as
      // enabled, so a keyboard or VoiceOver user could tab to the app's main
      // button, activate it, and get nothing.
      disabled={blocked}
      onPress={onPress}
      haptic={haptic}
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      // No `opacity` here: `Tappable` applies the disabled dim inside the press
      // response, which is the only place it survives.
      style={[s.primaryBtn, { backgroundColor: tone }, style]}
    >
      {loading && <ActivityIndicator size="small" color={labelTone} />}
      <Text style={[T.button, { color: labelTone }]}>{label}</Text>
      {trailingArrow && !loading && <Arrow tone={labelTone} size={16} />}
    </Tappable>
  );
}

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
    <IconButton onPress={onPress} label={label} style={s.backButton}>
      <Chevron direction="left" tone={tone} size={17} />
    </IconButton>
  );
}

// ─── Fields ──────────────────────────────────────────────────────────────────

/**
 * A text field.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The same eight-line style block was copy-pasted into seven screens, the
 * password-reveal control into three (byte-identical, *including its code
 * comment*), and the inline error style into four. That is the signature of a
 * missing primitive rather than seven considered decisions.
 *
 * More importantly, none of the seven had a **focus state**. The entire app
 * contained two `onFocus` handlers, so every field in it looked exactly the
 * same whether the keyboard was pointed at it or not. On a screen with three
 * fields that is a real question the interface refused to answer.
 *
 * ── Why the focus ring is ink and not cobalt ───────────────────────────────
 * Cobalt is reserved for the next action, at most once per screen, and a
 * focused field is not an action — it is where you are. The system already has
 * a signal for that: `Chip` and `MonoChip` both go ink when selected. A focused
 * field goes ink for the same reason, and the rule survives.
 *
 * The resting border is transparent rather than absent, so focusing a field
 * does not move the layout by 1.5pt.
 */
export function TextField({
  label,
  value,
  onChangeText,
  error,
  secure = false,
  inputRef,
  style,
  containerStyle,
  ...input
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  /** Shown beneath the field, announced assertively, and turns the border rust. */
  error?: string | null;
  /** Adds the reveal control the auth screens each used to hand-roll. */
  secure?: boolean;
  /** For the return-key focus chain between fields. */
  inputRef?: React.RefObject<TextInput | null>;
  /** Applies to the input itself, so it is a text style, not a view style. */
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
} & Omit<TextInputProps, "value" | "onChangeText" | "style" | "secureTextEntry">) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const motionOn = useMotionEnabled();

  /**
   * The ring fades rather than changing colour.
   *
   * The first version interpolated `borderColor` by building an `rgba()`
   * string inside the worklet. It produced float channel values —
   * `rgba(15.998, 18.99, 17.99, 0.999)` — which the style parser drops on the
   * floor without complaining, so the ring silently never appeared. Opacity is
   * a number, needs no parsing, and runs on the compositor.
   *
   * Rust wins over ink: a field can be focused *and* wrong at once, and
   * "wrong" is the more urgent of the two things to say.
   */
  const ring = useSharedValue(0);
  const visible = !!error || focused;

  React.useEffect(() => {
    const to = visible ? 1 : 0;
    ring.value = motionOn ? withSpring(to, SETTLE) : to;
  }, [visible, motionOn, ring]);

  const borderStyle = useAnimatedStyle(() => ({ opacity: ring.value }));

  return (
    <View style={containerStyle}>
      <Label style={{ marginBottom: 8 }}>{label.toUpperCase()}</Label>

      <View style={s.fieldWrap}>
        <Animated.View
          style={[
            s.fieldBorder,
            { borderColor: error ? color.rust : color.ink, pointerEvents: "none" },
            borderStyle,
          ]}
        />
        <TextInput
          {...input}
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          secureTextEntry={secure && !revealed}
          placeholderTextColor={color.textGhost}
          // There is no `htmlFor` in React Native, so the visible label has to
          // be spoken by the field itself or VoiceOver announces an unnamed
          // text box.
          accessibilityLabel={input.accessibilityLabel ?? label}
          style={[s.field, secure && s.fieldSecure, style]}
        />
        {secure && (
          <Tappable
            onPress={() => setRevealed((r) => !r)}
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            accessibilityState={{ selected: revealed }}
            style={s.reveal}
          >
            <Text style={[T.buttonSmall, { color: color.textMuted }]}>
              {revealed ? "Hide" : "Show"}
            </Text>
          </Tappable>
        )}
      </View>

      {!!error && (
        <Text
          style={s.fieldError}
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      )}
    </View>
  );
}

// ─── Meters ──────────────────────────────────────────────────────────────────

/**
 * A track and a fill, interpolated.
 *
 * Five screens drew their own: the monthly quota, the measurement progress
 * bar, two password-strength meters and the similarity bar. The measurement
 * one mattered most and was the worst — it is the app's longest wait, roughly
 * a minute of frame-by-frame pose tracking, and its width was bound straight
 * to React state, so it *jumped* between readings instead of advancing.
 *
 * Interpolating is not decoration here. A bar that jumps reads as a process
 * that stalled and lurched; a bar that moves reads as a process that is
 * running. Same data, and only one of them is honest about it.
 */
export function Meter({
  value,
  tone = color.ink,
  height = 6,
  track = color.inkWash,
  label,
  style,
}: {
  /** 0–1. Values outside are clamped rather than allowed to overrun the track. */
  value: number;
  tone?: string;
  height?: number;
  track?: string;
  /** Spoken description. Without it a progress bar is silent to VoiceOver. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const motionOn = useMotionEnabled();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const progress = useSharedValue(clamped);

  React.useEffect(() => {
    progress.value = motionOn ? withSpring(clamped, SETTLE) : clamped;
  }, [clamped, motionOn, progress]);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View
      style={[s.meterTrack, { height, borderRadius: height / 2, backgroundColor: track }, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <Animated.View
        style={[s.meterFill, { height, borderRadius: height / 2, backgroundColor: tone }, fill]}
      />
    </View>
  );
}

// ─── Segmented control ───────────────────────────────────────────────────────

/**
 * A small set of mutually exclusive options with a moving indicator.
 *
 * Progress hand-rolled this for its 12W / ALL range switch, and gave the
 * options `accessibilityRole="tab"` without a `tablist` around them — which
 * announces two orphaned tabs rather than a two-option control.
 */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  track = color.card,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  /** Names the control itself, e.g. "Time range". */
  label: string;
  track?: string;
}) {
  return (
    <View
      style={[s.segmented, { backgroundColor: track }]}
      accessibilityRole="tablist"
      accessibilityLabel={label}
    >
      {options.map((o) => (
        <Segment
          key={o.value}
          label={o.label}
          selected={o.value === value}
          onPress={() => onChange(o.value)}
        />
      ))}
    </View>
  );
}

/**
 * One option.
 *
 * ── Why this cross-fades instead of sliding ────────────────────────────────
 * The first version was the obvious one: a single ink pill absolutely
 * positioned behind the row, sliding to the selected segment. It looked right,
 * and it was wrong twice.
 *
 * The selected label is `onInk` — near-white — and its *DOM* background was the
 * white track, because the ink pill was a sibling painted underneath rather
 * than an ancestor. Measured honestly that is 1.18:1, and `e2e/audit.js` said
 * so. It reads fine only because a second element happens to be painted in
 * between, which means the legibility of the app's text depends on paint order
 * rather than on the colours involved. That is not a contrast ratio, it is a
 * coincidence — and this is a design system whose text tiers each carry their
 * measured ratio in a comment.
 *
 * Animating each segment's own background colour puts the ink where the text
 * actually sits, so the contrast is real, checkable, and cannot be broken by a
 * z-index. The motion becomes a cross-fade rather than a slide. That is the
 * trade, taken deliberately: a slide the audit cannot verify is worth less than
 * a fade it can.
 */
function Segment({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const motionOn = useMotionEnabled();
  const on = useSharedValue(selected ? 1 : 0);

  React.useEffect(() => {
    const to = selected ? 1 : 0;
    on.value = motionOn ? withSpring(to, SETTLE) : to;
  }, [selected, motionOn, on]);

  const fill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], ["rgba(16,19,18,0)", color.ink]),
  }));

  return (
    <Tappable
      onPress={onPress}
      haptic={selected ? undefined : "select"}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={s.segment}
    >
      <Animated.View style={[s.segmentFill, fill]}>
        <Text
          style={[
            T.label,
            { letterSpacing: 1, color: selected ? color.onInk : color.textFaint },
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </Tappable>
  );
}

const s = StyleSheet.create({
  interactive: { cursor: "pointer" },

  /** 44pt, met by real padding rather than hitSlop — see Tappable's docblock. */
  minTarget: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },

  fieldWrap: { position: "relative", justifyContent: "center" },
  field: {
    backgroundColor: color.card,
    borderRadius: radius.cardSmall,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontFamily: font.body,
    fontSize: 15,
    color: color.textPrimary,
  },
  /** Room for the reveal control, so a long password does not run under it. */
  fieldSecure: { paddingRight: 66 },
  /**
   * The ring is a sibling overlay rather than a border on the input itself:
   * animating `borderColor` on a TextInput re-lays-out the text on some
   * platforms, and an overlay cannot.
   */
  fieldBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.cardSmall,
    borderWidth: 1.5,
    zIndex: 1,
  },
  reveal: {
    position: "absolute",
    right: 8,
    paddingHorizontal: 8,
    // The label alone was a 34x16 target inside the field.
    minHeight: 44,
    justifyContent: "center",
    zIndex: 2,
  },
  fieldError: {
    marginTop: 10,
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.rust,
  },

  meterTrack: { overflow: "hidden", width: "100%" },
  meterFill: { position: "absolute", left: 0, top: 0 },

  segmented: {
    flexDirection: "row",
    borderRadius: radius.pill,
    padding: SEGMENT_PAD,
    position: "relative",
    // Without this the segments stretch to the tallest thing in the parent
    // row, which is how the old hand-rolled toggle ended up taller than its
    // own container.
    alignSelf: "flex-start",
  },
  // 44, not 38. A range switch is a real target, and the harness said so:
  // "tap-target | 12W | 51x38".
  segment: { minHeight: 44, justifyContent: "center" },
  /** The painted ground. Must be the label's ancestor — see Segment's docblock. */
  segmentFill: {
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },

  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },

  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: "center",
  },

  chipIdle: { backgroundColor: color.card },

  chipSelected: { backgroundColor: color.ink },

  primaryBtn: {
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },


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


});
