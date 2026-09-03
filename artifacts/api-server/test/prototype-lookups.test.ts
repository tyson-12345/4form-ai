/**
 * Lookup tables indexed by something the request supplied.
 *
 * The failure is always the same shape: a plain object literal answers
 * `table["constructor"]` with a function and `table["__proto__"]` with an
 * object, so a `?? DEFAULT` fallback — which only guards null and undefined —
 * never fires, and the caller is handed something of the wrong type that it
 * then treats as a hit. `routes/waitlist.ts` hit it first and turned a one-word
 * body into a 500 and a Sentry event; `lib/sportResearch.ts` had the same
 * defect and is covered here.
 *
 * Both keys are reachable: `safeText(1, 40)` in routes/analyses.ts accepts
 * "constructor" and "__proto__" as ordinary words, and `.toLowerCase()` leaves
 * them exactly as they are.
 */

import { describe, it, expect } from "vitest";

import { researchForSport, SPORTS_WITH_RESEARCH } from "../src/lib/sportResearch.js";

/** Every field the prompt builder in lib/claude.ts reads off the result. */
function assertUsableResearch(value: unknown): void {
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  const research = value as Record<string, unknown>;
  expect(typeof research.injury).toBe("string");
  expect(typeof research.performance).toBe("string");
  expect(typeof research.emphasis).toBe("string");
}

describe("researchForSport", () => {
  it.each(["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"])(
    "falls back to the default for the inherited member %s",
    (sport) => {
      const result = researchForSport(sport);
      assertUsableResearch(result);
      // Not merely usable — it must be the *generic* profile, not a prototype
      // member that happened to survive the type assertions.
      expect(result.emphasis).toContain("no sport-specific profile");
    },
  );

  it("treats those names the same however they are cased or padded", () => {
    // `.trim().toLowerCase()` is all that stands between the request body and
    // the lookup, so the mixed-case spellings reach it intact too.
    for (const sport of ["  CONSTRUCTOR  ", "__PROTO__", " ToString "]) {
      expect(researchForSport(sport).emphasis).toContain("no sport-specific profile");
    }
  });

  it("still returns the real profile for a sport that has one", () => {
    const running = researchForSport("Running ");
    assertUsableResearch(running);
    expect(running.emphasis).not.toContain("no sport-specific profile");
    expect(running.injury).toContain("Heiderscheit");
  });

  it("offers no inherited member as a known sport", () => {
    // SPORTS_WITH_RESEARCH is interpolated into the prompt as the list Claude
    // may suggest from, and is matched against in analysisService.ts.
    for (const name of ["constructor", "__proto__", "toString", "valueOf"]) {
      expect(SPORTS_WITH_RESEARCH).not.toContain(name);
    }
    expect(SPORTS_WITH_RESEARCH.length).toBeGreaterThan(0);
  });
});
