/**
 * Local parsing for the API's date-only strings.
 *
 * ── Why this is a module and not inline in the screen ───────────────────────
 * The API records progress entries as bare `YYYY-MM-DD` strings. The
 * ECMAScript spec parses a date-only string as **UTC midnight**, so
 * `new Date("2026-08-16")` is 16 Aug 00:00 UTC — which `toLocaleDateString`
 * then renders as **15 Aug** in every timezone west of Greenwich. A session
 * measured today stamps as yesterday, and nothing looks wrong from a machine
 * in the UK.
 *
 * Full ISO timestamps (`uploadedAt` and friends) do not have this problem:
 * they name an instant, and rendering an instant in local time is correct.
 * Only date-only strings — which name a calendar day, not an instant — need
 * this. `utils/age.ts` guards the same trap in the opposite direction, where
 * `toISOString()` would shift a birth date west of Greenwich.
 */

/**
 * Parse `YYYY-MM-DD` as midnight in the device's timezone, so the calendar
 * day the server recorded is the calendar day the user sees.
 *
 * Anything that is not a bare date-only string falls through to native `Date`
 * parsing: a full timestamp already parses correctly, and display code would
 * rather show a best-effort date than crash the screen over a format change.
 */
export function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
