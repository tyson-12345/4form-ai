/**
 * Haptics, as a vocabulary rather than a library call.
 *
 * ── What was wrong ─────────────────────────────────────────────────────────
 * The app fired haptics in exactly two places, and both were on *long-press
 * discovery* — the moment you find out an action exists. Not one **commit**
 * had any: not sign-in, not starting a measurement, not the moment a
 * measurement finishes and the report appears, not confirming a delete, not a
 * plan change, not sending a message to the coach, not a single one of
 * onboarding's five screens of selections.
 *
 * That is backwards. Apple's rule is that feedback belongs on the causal event
 * and should be reserved for meaningful moments — commit, success, error,
 * snap. Discovery is the one place it is *least* needed.
 *
 * ── Why a wrapper ──────────────────────────────────────────────────────────
 * Two reasons beyond naming.
 *
 * First, these are fire-and-forget. One of the two existing call sites did
 * `await Haptics.impactAsync(...)` immediately before opening a confirmation
 * alert, so a tick of haptic latency sat between the user's finger and the
 * dialog. Nothing here returns a promise, so nothing here can be awaited.
 *
 * Second, `expo-haptics` has no web implementation and warns when called. The
 * web build is a development and audit surface for this app, and a console
 * full of haptics warnings buries real findings.
 */

import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/** react-native-web has no Taptic Engine; calling through only produces warnings. */
const supported = Platform.OS === "ios" || Platform.OS === "android";

function fire(run: () => Promise<void>): void {
  if (!supported) return;
  // Swallowed deliberately: a device with haptics disabled, or a simulator
  // without the hardware, rejects. Feedback failing is never worth an error.
  void run().catch(() => {});
}

/**
 * A control was pushed. The lightest mark in the vocabulary.
 *
 * Deliberately *not* wired to every button: a tap on every control is the
 * over-feedback Apple warns trains people to ignore all of it. Reserved for
 * controls whose effect is not otherwise visible.
 */
export function tap(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A choice changed — a chip, a tab, a segment. The detent. */
export function select(): void {
  fire(() => Haptics.selectionAsync());
}

/** An action was committed: a form submitted, a measurement started, a plan changed. */
export function commit(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/**
 * Something the user was waiting for completed.
 *
 * The measurement finishing is the moment this product exists to produce, and
 * until now it arrived in silence.
 */
export function success(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** A destructive action is armed, or a value needs attention before it can proceed. */
export function warn(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/** An operation failed. Pairs with an on-screen message; never the only signal. */
export function fail(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
