/**
 * Things the interface says back.
 *
 * `Prescription` is the app's one cobalt element and there is at most one per
 * screen — it is the single next action, and a second one would mean neither
 * is the next action.
 */

import React, { useEffect } from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { color, type as T, radius, font, GUTTER, motion } from "@/constants/caliper";
import { SETTLE, timing, useEntrance, useMotionEnabled } from "@/lib/motion";
import { Text, Label } from "./text";
import { Tappable } from "./controls";
import { Arrow, Check } from "./glyphs";

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
    <Tappable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `${label}: ${text}` : undefined}
      style={s.prescription}
    >
      <View style={{ flex: 1 }}>
        <Label tone={color.onCobaltMuted}>{label}</Label>
        {/* Capped in the compact form. This renders in a dock floating over the
            analysis screen, and at the larger system text sizes an uncapped
            seven-line prescription covered more than half the viewport. The
            full text is one tap away. */}
        <Text
          scale="display"
          style={[compact ? T.prescriptionSmall : T.prescription, { marginTop: 7 }]}
          numberOfLines={compact ? 3 : undefined}
        >
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
    </Tappable>
  );
}

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


// ─── Empty and transient states ──────────────────────────────────────────────

/**
 * Nothing here yet, and what to do about it.
 *
 * Four screens hand-rolled one, and Home's was the telling case: it shared a
 * single card with its *loading* state, so "we are fetching your sessions" and
 * "you have no sessions" were the same rectangle with different words in it.
 * An empty state is a screen's first impression for every new account, and it
 * was the least designed thing in the app.
 *
 * The glyph is optional and the action is optional, because an empty state
 * with nothing to do is a report, not a dead end — Progress genuinely has
 * nothing to offer until three sessions exist, and saying so plainly beats
 * inventing a button.
 */
export function EmptyState({
  title,
  body,
  glyph,
  action,
  style,
}: {
  title: string;
  body: string;
  glyph?: React.ReactNode;
  action?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
}) {
  const entrance = useEntrance();

  return (
    <Animated.View style={[s.empty, style, entrance]}>
      {!!glyph && <View style={s.emptyGlyph}>{glyph}</View>}
      <Text scale="display" style={[T.headlineSmall, { textAlign: "center" }]}>
        {title}
      </Text>
      <Text style={[T.body, { textAlign: "center", marginTop: 10, maxWidth: 320 }]}>{body}</Text>
      {!!action && (
        <Tappable onPress={action.onPress} accessibilityLabel={action.label} style={s.emptyAction}>
          <Text style={[T.buttonSmall, { color: color.onInk }]}>{action.label}</Text>
          <Arrow tone={color.onInk} size={14} />
        </Tappable>
      )}
    </Animated.View>
  );
}

/**
 * A short confirmation that something happened.
 *
 * ── Why not an Alert ───────────────────────────────────────────────────────
 * Because most of what this replaces was *nothing at all*. Saving a profile
 * field, copying a coach reply, removing a photo — all of them succeeded in
 * silence, and the only feedback vocabulary the app had was `lib/alert.ts`,
 * which stops the world and demands a tap to dismiss. A modal dialog for "that
 * worked" is the interface asking to be acknowledged for doing its job.
 *
 * Sits above the tab bar rather than below the status bar: this confirms
 * something the user's thumb just did, and that is where their attention is.
 */
export function Toast({
  message,
  visible,
  onHide,
  tone = "neutral",
  bottomInset = 0,
}: {
  message: string;
  visible: boolean;
  /** Called once the dwell has elapsed, so the owner can clear its state. */
  onHide: () => void;
  tone?: "neutral" | "alarm";
  /** Space to clear — the tab bar, a dock, the home indicator. */
  bottomInset?: number;
}) {
  const motionOn = useMotionEnabled();
  const shown = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      shown.value = motionOn ? withTiming(0, timing(motion.quick)) : 0;
      return;
    }
    shown.value = motionOn ? withSpring(1, SETTLE) : 1;
    const timer = setTimeout(onHide, 2400);
    return () => clearTimeout(timer);
  }, [visible, motionOn, shown, onHide]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * 12 }],
  }));

  // Unmounted while hidden so it can never intercept a touch it cannot be seen
  // to own — the same reason Sheet does not render its body while closed.
  if (!visible) return null;

  return (
    <Animated.View
      style={[s.toast, { bottom: bottomInset + 16, pointerEvents: "none" }, style]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      {tone === "neutral" && <Check tone={color.onInk} size={14} />}
      <Text style={[T.buttonSmall, { color: tone === "alarm" ? color.rustOnInk : color.onInk, flex: 1 }]}>
        {message}
      </Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  empty: { alignItems: "center", paddingHorizontal: GUTTER, paddingVertical: 40 },
  emptyGlyph: { marginBottom: 18, opacity: 0.9 },
  emptyAction: {
    marginTop: 22,
    backgroundColor: color.ink,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  toast: {
    position: "absolute",
    left: GUTTER,
    right: GUTTER,
    backgroundColor: color.ink,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    zIndex: 20,
  },

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
  // Wide enough for SOMETIMES, the longest stamp, at this size — 56 wrapped it
  // to "SOMETIME\nS" on every caution-band flag.

  flagStamp: { width: 72, paddingTop: 2, fontSize: 10, letterSpacing: 0.6 },

  flagText: {
    flex: 1,
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 20,
    color: color.textPrimary,
  },

  // Chips
  // minHeight, not padding: the chip must clear 44pt for a fingertip, but it
  // must also grow rather than clip when the label wraps or the system text
  // size is turned up. Padding alone did neither — chips were 40pt and mono
  // chips 27pt.
  //
  // `pressed: { opacity: 0.82 }` used to live here — the last survivor of the
  // seven drifted press opacities that `motion.press` replaced. Nothing
  // referenced it; a dead style is an invitation to use it again.

});
