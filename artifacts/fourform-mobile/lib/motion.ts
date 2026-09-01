/**
 * Motion, and the contract that makes it safe.
 *
 * ── The rule this file exists to enforce ───────────────────────────────────
 * **Reduced motion removes the transition, never the content.**
 *
 * The usual way to animate an entrance is to start a value at 0, render
 * `opacity: value`, and raise it in an effect. That pattern has one bad
 * failure mode: if the effect does not run, or runs after a reduced-motion
 * bail-out, the element stays at opacity 0 and the content is simply gone. A
 * user who turned on Reduce Motion to make software *more* usable would get an
 * app with missing screens.
 *
 * Three independent things stop that happening here, and any one of them is
 * sufficient:
 *
 *  1. **Reanimated snaps rather than animates.** Every config below carries
 *     `reduceMotion: ReduceMotion.System`. Reanimated reads the OS setting
 *     natively and synchronously, so with Reduce Motion on it jumps the value
 *     straight to its target instead of interpolating.
 *  2. **The target is always the visible state.** Entrances animate *to*
 *     opacity 1, never away from it. Snapping to the target therefore always
 *     lands on "fully visible", by construction.
 *  3. **The initial value is resolved before first paint.** The OS setting is
 *     read once at module load into a cache (below), so a component that
 *     mounts with Reduce Motion on starts at its resting style rather than
 *     starting hidden and flashing.
 *
 * ── Character ──────────────────────────────────────────────────────────────
 * All timing and spring values come from `motion` in `constants/caliper.ts`.
 * Nothing in this file invents a duration.
 */

import { useEffect, useState } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type WithTimingConfig,
  type WithSpringConfig,
} from "react-native-reanimated";

import { motion } from "@/constants/caliper";

// ─── The OS setting ──────────────────────────────────────────────────────────

/**
 * Reduce Motion, cached at module load.
 *
 * `AccessibilityInfo.isReduceMotionEnabled()` is promise-only — there is no
 * synchronous read — so a hook that awaited it per mount would render one
 * frame of "motion is on" before correcting itself. Reading once here, at
 * import time, means the answer is almost always settled by the time anything
 * mounts: this module is imported during bundle evaluation, and the app does
 * not paint until `useFonts` resolves.
 */
let reduceMotion = false;
const listeners = new Set<(v: boolean) => void>();

function publish(value: boolean) {
  if (value === reduceMotion) return;
  reduceMotion = value;
  listeners.forEach((fn) => fn(value));
}

AccessibilityInfo.isReduceMotionEnabled()
  .then(publish)
  // A platform without the API (or a web build that throws) means we cannot
  // know. Defaulting to "motion allowed" is right: Reanimated's own
  // ReduceMotion.System still honours the real setting natively, so this
  // fallback only affects the initial value, never the animation itself.
  .catch(() => {});

AccessibilityInfo.addEventListener("reduceMotionChanged", publish);

/**
 * `true` when the interface may animate.
 *
 * Prefer the hooks below to reading this directly — they already apply it.
 * Reach for it when a component needs to choose between two *renderings*
 * rather than two timings.
 */
export function useMotionEnabled(): boolean {
  const [enabled, setEnabled] = useState(!reduceMotion);

  useEffect(() => {
    const listener = (v: boolean) => setEnabled(!v);
    listeners.add(listener);
    // Re-sync in case the module-load promise resolved between render and
    // effect.
    setEnabled(!reduceMotion);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return enabled;
}

// ─── Configs ─────────────────────────────────────────────────────────────────

/**
 * The system's entrance curve.
 *
 * Decelerating: fast at the start, settling at the end. Content should arrive
 * as though it were already on its way, not as though it were being pushed.
 */
const ENTER_EASING = Easing.bezier(0.2, 0, 0, 1);

/** Timing config for a given duration, reduced-motion aware. */
export function timing(duration: number): WithTimingConfig {
  return { duration, easing: ENTER_EASING, reduceMotion: ReduceMotion.System };
}

/** The default spring: critically damped, reaches its target and stops. */
export const SETTLE: WithSpringConfig = {
  ...motion.spring.settle,
  reduceMotion: ReduceMotion.System,
};

/** The system's only bounce. Use after a flick, never for an appearance. */
export const CARRY: WithSpringConfig = {
  ...motion.spring.carry,
  reduceMotion: ReduceMotion.System,
};

// ─── Entrance ────────────────────────────────────────────────────────────────

/**
 * Is the app in front of a human right now?
 *
 * An entrance that starts while the app is backgrounded never runs — there are
 * no frames to run it in — so the content stays at its start value until
 * something re-triggers it. Coming back to a screen with a blank section on it
 * is a worse outcome than skipping a fade nobody was there to see.
 *
 * So: if we are not visible at mount, land at rest immediately. The user
 * returns to content that has already arrived, which is what they wanted from
 * the animation anyway.
 */
function visibleNow(): boolean {
  if (typeof document !== "undefined" && typeof document.visibilityState === "string") {
    return document.visibilityState !== "hidden";
  }
  return AppState.currentState === "active";
}

/** How far content travels on entry. Small on purpose — this is orientation, not spectacle. */
const RISE = 8;
/** Gap between staggered siblings. */
const STAGGER_STEP = 45;
/**
 * Stagger is capped so a long list's last row is not held back by its
 * position. Past this many steps every item shares the final delay.
 */
const MAX_STAGGER_INDEX = 6;

/**
 * A content entrance: an 8pt rise and a fade, optionally staggered.
 *
 * Returns a style. Under Reduce Motion the shared value is created at its
 * resting value and Reanimated snaps rather than animates, so the element is
 * fully visible on its first frame.
 *
 * @param index Position among siblings, for a stagger. Omit for no stagger.
 */
export function useEntrance(index = 0) {
  const motionOn = useMotionEnabled();
  const animate = motionOn && visibleNow();
  // Starts at rest when we are not going to animate, so there is no hidden
  // first frame to get stuck on.
  const progress = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(
      Math.min(index, MAX_STAGGER_INDEX) * STAGGER_STEP,
      withTiming(1, timing(motion.standard)),
    );
  }, [animate, index, progress]);

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * RISE }],
  }));
}

// ─── Press ───────────────────────────────────────────────────────────────────

/**
 * The one press response in the system.
 *
 * Fires on press-**in**, not on release: Apple's first rule of fluid interfaces
 * is that the moment lag appears, directness "falls off a cliff". A control
 * that waits for touch-up to acknowledge a touch reads as dead.
 *
 * Scale *and* opacity together — opacity alone reads as a control dimming,
 * scale reads as a control being pushed.
 */
export function usePressResponse(enabled = true, base = 1) {
  const pressed = useSharedValue(0);

  /**
   * `base` is the control's resting opacity — 1 normally, lower when it is
   * disabled or deliberately dimmed.
   *
   * It has to be applied here rather than by the caller. This style is composed
   * last so that nothing can override the single press treatment, which also
   * means it overrode any `opacity` the caller set. Folding the resting value
   * in keeps both properties: the press response is still the last word, and a
   * disabled control still looks disabled.
   */
  const style = useAnimatedStyle(() => ({
    opacity: base * (1 - pressed.value * (1 - motion.press.opacity)),
    transform: [{ scale: 1 - pressed.value * (1 - motion.press.scale) }],
  }));

  const onPressIn = () => {
    if (!enabled) return;
    pressed.value = withTiming(1, timing(motion.instant));
  };

  const onPressOut = () => {
    if (!enabled) return;
    // Springs back rather than timing back: the release is the moment the
    // control returns to rest, and a spring settles more naturally than a
    // linear return. Critically damped, so it does not overshoot into a wobble.
    pressed.value = withSpring(0, SETTLE);
  };

  return { style, onPressIn, onPressOut };
}
