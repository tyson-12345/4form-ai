/**
 * Server-side request validation.
 *
 * Two rules this module enforces everywhere:
 *
 *  1. **The server never trusts the client.** Every field is length- and
 *     format-checked here even when the mobile app already checks it. The app
 *     is just one caller; curl is another.
 *
 *  2. **Errors are generic to the client, specific to the log.** Telling a
 *     caller *which* field failed is a free oracle — it maps out our schema and,
 *     on auth routes, distinguishes "no such user" from "wrong password". The
 *     client gets one flat message; the detail goes to the server log where we
 *     can actually act on it.
 */

import { z } from "zod";
import type { Response } from "express";
import { logger } from "./logger.js";
import { sanitizeText, sanitizeMultiline, normalizeEmail, looksLikeInjection } from "./sanitize.js";

/** The only validation message any client ever sees. */
export const GENERIC_VALIDATION_ERROR = "Invalid request. Please check your input and try again.";

// ─── Reusable sanitizing primitives ──────────────────────────────────────────
// Order matters: sanitize first, then length-check, so a string padded with
// markup cannot slip past a max() that was measured before stripping.

/** Single-line user text: tags stripped, whitespace collapsed, bounded length. */
export function safeText(min: number, max: number) {
  return z
    .string()
    .max(max * 4, "too long pre-sanitization")
    .transform(sanitizeText)
    .refine((v) => v.length >= min && v.length <= max);
}

/** Multi-line user text: paragraph breaks preserved, bounded length. */
export function safeMultiline(min: number, max: number) {
  return z
    .string()
    .max(max * 4, "too long pre-sanitization")
    .transform(sanitizeMultiline)
    .refine((v) => v.length >= min && v.length <= max);
}

/** Email: normalized to a canonical lowercase form, then format-checked. */
export const safeEmail = z
  .string()
  .max(320)
  .transform(normalizeEmail)
  .pipe(z.string().email().max(254));

/**
 * Password. Bounded at 200 to stop bcrypt CPU-exhaustion via huge inputs, and
 * at 12 minimum because length dominates complexity for real-world resistance.
 *
 * NOTE: the value is deliberately *not* sanitized — stripping characters from a
 * password would silently change it and break login for anyone using markup
 * characters in an otherwise strong passphrase.
 */
export const safePassword = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(200);

/** UUID path/body parameters. */
export const safeUuid = z.string().uuid();

// ─── Age gate ────────────────────────────────────────────────────────────────

/** Minimum age to hold an account. See docs/LEGAL-RISK.md §4. */
export const MINIMUM_AGE_YEARS = 13;

/** Whole years elapsed between `birthDate` and `now`, calendar-correct. */
export function ageInYears(birthDate: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birthDate.getUTCMonth();
  // Not yet had this year's birthday.
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    age--;
  }
  return age;
}

/**
 * Date of birth as `YYYY-MM-DD`, accepted only if it clears the age floor.
 *
 * ── Why the check is here and not only in the app ───────────────────────────
 * The client shows a date picker and refuses to submit an under-13 date. That
 * is a courtesy to the user, not a control: the app is one caller and curl is
 * another. This is the check that actually holds.
 *
 * Rejects future dates and implausible ones (>120 years) as well, so a garbage
 * value cannot pass the age test by being absurd in the useful direction.
 */
export const safeBirthDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
  .transform((value) => new Date(`${value}T00:00:00Z`))
  .refine((d) => d.getTime() <= Date.now())
  .refine((d) => ageInYears(d) <= 120)
  .refine((d) => ageInYears(d) >= MINIMUM_AGE_YEARS);

// ─── Parse helper ────────────────────────────────────────────────────────────

/**
 * Validate `body` against `schema`.
 *
 * On success returns the parsed value. On failure it writes a 400 with the
 * generic message, logs the specific field errors, and returns `undefined` —
 * so callers do `const data = parseOrReject(...); if (!data) return;`.
 */
export function parseOrReject<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
  res: Response,
  context: { route: string; ip?: string; userId?: string },
): z.infer<T> | undefined {
  const result = schema.safeParse(body);

  if (result.success) return result.data;

  // Field paths and codes only — never the offending values, which may contain
  // passwords or other secrets the caller submitted.
  const issues = result.error.issues.map((i) => ({
    path: i.path.join("."),
    code: i.code,
  }));

  logger.warn(
    { ...context, issues, event: "validation_failure" },
    "Request failed schema validation",
  );

  flagSuspiciousInput(body, context);

  res.status(400).json({ error: GENERIC_VALIDATION_ERROR });
  return undefined;
}

/**
 * Log when a payload contains markup or SQL-ish patterns. The request is still
 * sanitized and served normally — this exists purely so probing shows up in the
 * logs as a distinct signal rather than blending into ordinary 400s.
 */
export function flagSuspiciousInput(
  body: unknown,
  context: { route: string; ip?: string; userId?: string },
): void {
  if (typeof body !== "object" || body === null) return;

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    // Never inspect or log credential fields.
    if (/password|token|secret/i.test(key)) continue;
    if (typeof value === "string" && looksLikeInjection(value)) {
      logger.warn(
        { ...context, field: key, event: "suspicious_input" },
        "Input matched an injection heuristic",
      );
      return;
    }
  }
}
