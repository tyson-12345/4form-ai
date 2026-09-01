/**
 * Auth rules the UI needs to mirror.
 *
 * These are **copies of the server's rules**, kept only so a form can give
 * immediate feedback. The server is what enforces them — see `safePassword` and
 * `safeBirthDate` in the API's `lib/validate.ts`. A client check is a courtesy
 * to the user; anything that matters is re-checked on the other side, because
 * the app is one caller and curl is another.
 *
 * They live here rather than inline because the same numbers were duplicated
 * across the signup screen, the reset screen, and the server-rendered reset
 * page. Three copies of a rule is three chances for one to drift and start
 * telling users something the server disagrees with.
 */

/**
 * Minimum password length. Mirrors `MIN_PASSWORD_LENGTH` in the API.
 *
 * Lowered from 12 to 8 on 2026-08-12. There are deliberately **no composition
 * rules** — no required symbol, digit, or mixed case. NIST SP 800-63B advises
 * against them: they reliably produce "Password1!" rather than more entropy,
 * and they make a password harder to remember without making it harder to
 * guess. Length is the only requirement.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Minimum age to hold an account. Mirrors `MINIMUM_AGE_YEARS` in the API. */
export const MINIMUM_AGE_YEARS = 13;
