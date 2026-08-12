/**
 * How often a joint sat outside its safe range, as a word.
 *
 * ── Why words instead of the angle range ────────────────────────────────────
 * The analysis screen used to stamp each flag with the raw measurement
 * (`62–104°`). Two problems: it is the least readable thing on the screen for
 * someone who does not already know what a good number looks like, and a range
 * is two numbers with no reference — it never actually answers the question the
 * athlete is asking, which is "was that bad?".
 *
 * The angles are still measured, still stored, and still what the coaching notes
 * reason from. They are just no longer the headline, and the exact figures stay
 * available on the skeleton overlay for anyone who wants them.
 *
 * ── Thresholds ──────────────────────────────────────────────────────────────
 * 10% is where a flag already turns from grey to rust elsewhere on the screen,
 * so the wording changes at the same point the colour does. 25% is a second
 * step so a joint that is out of range for a quarter of the clip does not read
 * the same as one at 11%.
 */

export type FlagSeverity = "OFTEN" | "SOMETIMES" | "BRIEFLY" | "ONCE";

/** The percentage at which a flag is also shown in the alarm colour. */
export const FLAG_ALARM_THRESHOLD = 10;

export function flagSeverity(riskPercent: number): FlagSeverity {
  // Guard against a malformed or absent measurement reading as "OFTEN". A NaN
  // comparison is false in both directions, so without this it would fall
  // through to the bottom of the ladder rather than the top — but being
  // explicit is cheaper than relying on that.
  if (!Number.isFinite(riskPercent) || riskPercent <= 0) return "ONCE";
  if (riskPercent >= 25) return "OFTEN";
  if (riskPercent >= FLAG_ALARM_THRESHOLD) return "SOMETIMES";
  return "BRIEFLY";
}

/** True when this flag should be drawn in the alarm colour. */
export function isAlarming(riskPercent: number): boolean {
  return Number.isFinite(riskPercent) && riskPercent >= FLAG_ALARM_THRESHOLD;
}
