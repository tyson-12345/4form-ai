/**
 * Date-of-birth parsing and age calculation for the signup age gate.
 *
 * ── Why this is a module and not inline in the screen ───────────────────────
 * It was inline. Two reasons it moved:
 *
 *  1. A bug here fails in one of two bad directions — let an under-13 create an
 *     account (a COPPA problem), or refuse a legitimate 14-year-old on their
 *     birthday (a user who simply cannot sign up and will never tell you why).
 *     Neither is visible from looking at the screen.
 *  2. Date arithmetic has more edge cases than it looks: month lengths, leap
 *     years, and the "birthday hasn't happened yet this year" off-by-one. Those
 *     want a test file, and the screen cannot have one without a React Native
 *     test harness.
 *
 * The server re-checks all of this (`safeBirthDate` in the API's
 * `lib/validate.ts`). This is the courtesy layer — it exists so the user gets
 * immediate feedback, not so the rule is enforced.
 */

/** Kept in step with `MINIMUM_AGE_YEARS` in the API's lib/validate.ts. */
export const MINIMUM_AGE_YEARS = 13;

/**
 * Whole years elapsed between `birth` and `now`.
 *
 * Counts the birthday itself: someone born on 15 June 2010 is 13 on 15 June
 * 2023, not 14. The `monthDelta` check is what stops a December signup being
 * credited with a birthday that falls the following June.
 */
export function ageInYears(birth: Date, now = new Date()): number {
  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/**
 * Parse typed `DD`, `MM`, `YYYY` parts into a real date.
 *
 * Returns `null` for anything incomplete, impossible, or in the future.
 *
 * The round-trip check is the important part. `new Date(2010, 1, 31)` does not
 * fail on 31 February — it silently rolls over to 3 March. Without verifying
 * that the constructed date still has the day, month, and year that went in, a
 * typo becomes a different valid date, and the age gate then judges a date the
 * user never entered.
 */
export function parseBirthDate(day: string, month: string, year: string): Date | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);

  if (!d || !m || !y || year.length !== 4) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const parsed = new Date(y, m - 1, d);
  if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) {
    return null;
  }
  if (parsed.getTime() > Date.now()) return null;

  return parsed;
}

/**
 * Format a parsed date as `YYYY-MM-DD` for the API.
 *
 * Built from local date parts rather than `toISOString()`. That converts to UTC
 * and can shift the date back a day for anyone west of Greenwich — which, on or
 * near a birthday, is exactly the difference between passing and failing the
 * age check.
 */
export function toIsoDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** True when the parsed date clears the age floor. */
export function isOldEnough(birth: Date | null, now = new Date()): boolean {
  return birth !== null && ageInYears(birth, now) >= MINIMUM_AGE_YEARS;
}
