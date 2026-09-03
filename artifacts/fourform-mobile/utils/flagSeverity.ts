/**
 * How often a joint sat outside its band, as a word.
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

export function flagSeverity(riskPercent: number, cautionPercent = 0): FlagSeverity {
  // A NaN compares false in both directions, so an unguarded malformed reading
  // falls past every threshold onto "BRIEFLY" — the bottom of the ladder, which
  // reads as reassurance we have not earned. A negative percentage is equally
  // impossible. Both become the faintest *stated* severity rather than silence.
  if (!Number.isFinite(riskPercent) || riskPercent < 0) return "ONCE";
  const caution = Number.isFinite(cautionPercent) && cautionPercent > 0 ? cautionPercent : 0;

  // The stamp answers "how much of the clip was this joint out of its range?",
  // so it counts caution frames as well as risk ones.
  //
  // Previously it read `riskPercent` alone, while `deriveRiskFindings` keeps a
  // finding whenever *either* band was entered (`risk === 0 && caution === 0`
  // is the only skip). A joint that spent a third of the clip in caution and
  // never reached the risk band therefore arrived here as 0 and stamped
  // "ONCE" — describing a single excursion into a band it never entered, on a
  // row whose text describes a real and sustained one.
  //
  // Colour still keys on `riskPercent` alone via `isAlarming`, so a caution-only
  // finding is described honestly without being painted as an alarm.
  const outOfRange = riskPercent + caution;

  if (outOfRange <= 0) return "ONCE";
  if (outOfRange >= 25) return "OFTEN";
  if (outOfRange >= FLAG_ALARM_THRESHOLD) return "SOMETIMES";
  return "BRIEFLY";
}

/** True when this flag should be drawn in the alarm colour. */
export function isAlarming(riskPercent: number): boolean {
  return Number.isFinite(riskPercent) && riskPercent >= FLAG_ALARM_THRESHOLD;
}
