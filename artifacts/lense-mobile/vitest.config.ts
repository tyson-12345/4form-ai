import { defineConfig } from "vitest/config";

/**
 * Tests for pure logic in `utils/` only.
 *
 * This package has no React Native test harness — component tests would need
 * jest-expo and a native module mock layer, which is a separate piece of work.
 * Restricting the include to `utils/` keeps this runnable today and honest
 * about what it covers: dependency-free functions, not screens.
 *
 * ── How to get coverage of screen logic anyway ──────────────────────────────
 * Extract it. The rule of thumb used here: **if getting it wrong would be
 * invisible on screen, it does not belong in the screen.**
 *
 * Two examples added on 2026-08-12, both previously inline in a component and
 * therefore untestable:
 *
 *   utils/age.ts           the signup age gate. A bug admits an under-13 or
 *                          silently blocks a legitimate 14-year-old on their
 *                          birthday — neither is visible from looking at it.
 *                          `new Date(2010, 1, 31)` rolls over to 3 March rather
 *                          than failing, so a typo becomes a different valid
 *                          date. 22 tests.
 *
 *   utils/flagSeverity.ts  the OFTEN/SOMETIMES/BRIEFLY thresholds, which must
 *                          agree with the alarm colour used beside them. 8 tests.
 *
 * A real harness for the screens themselves is still worth doing; this is how to
 * cover the parts that matter until then.
 *
 * ── Why `lib/` is included too, from 2026-08-13 ─────────────────────────────
 * `lib/poseTracker.ts` builds the tracker's browser JS inside a template
 * string. TypeScript never parses that code — it is a string until a WebView
 * evaluates it on a phone — so a syntax error in it typechecks clean, ships,
 * and fails silently at measurement time. `lib/poseTracker.test.ts` parses the
 * emitted script so that blind spot is covered by CI rather than by a user
 * filming a squat.
 */
export default defineConfig({
  test: {
    include: ["utils/**/*.test.ts", "lib/**/*.test.ts"],
    environment: "node",
  },
});
