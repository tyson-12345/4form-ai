import { describe, it, expect } from "vitest";
import {
  TERM_MAP,
  formatBiomechanicsText,
  formatBiomechanicsTextSafe,
} from "./formatBiomechanics";

describe("formatBiomechanicsText", () => {
  it("translates a single term", () => {
    expect(formatBiomechanicsText("knee valgus was present")).toBe(
      "Knee caving inward was present",
    );
  });

  it("prefers the more specific term when two could match", () => {
    // "hip flexion" must win over the bare "flexion" rule.
    expect(formatBiomechanicsText("your hip flexion is limited")).toBe(
      "Your hip bending forward is limited",
    );
  });

  it("translates several distinct terms in one string", () => {
    const out = formatBiomechanicsText("your eccentric control and dorsiflexion both improved");
    expect(out).toContain("controlled lowering");
    expect(out).toContain("ankle flexibility");
  });

  it("capitalises the first character", () => {
    expect(formatBiomechanicsText("valgus at the knee")).toMatch(/^Inward angle/);
  });

  it("leaves text with no jargon alone apart from capitalisation", () => {
    expect(formatBiomechanicsText("your left knee looked strong")).toBe(
      "Your left knee looked strong",
    );
  });

  it("returns falsy input unchanged", () => {
    expect(formatBiomechanicsText("")).toBe("");
  });

  /**
   * The regression the single-pass rewrite exists to prevent: a sequential
   * `.replace()` loop feeds each rule the previous rule's output, so a
   * replacement containing a translatable word gets rewritten again.
   */
  it("does not re-translate its own output", () => {
    // "lumbar flexion" → "lower back rounding". A second pass over that result
    // must not then act on anything inside the replacement.
    const out = formatBiomechanicsText("lumbar flexion under load");
    expect(out).toBe("Lower back rounding under load");
  });

  it("does not cascade when a replacement contains a mapped word", () => {
    // "thoracic extension" → "upper back opening up". If the generic
    // "extension" → "straightening" rule ran over that output, the phrase
    // would be corrupted.
    const out = formatBiomechanicsText("thoracic extension improved");
    expect(out).toBe("Upper back opening up improved");
    expect(out).not.toContain("straightening");
  });

  it("translates each occurrence when a term repeats", () => {
    const out = formatBiomechanicsText("valgus early, valgus late");
    expect(out).toBe("Inward angle early, inward angle late");
  });
});

describe("formatBiomechanicsTextSafe", () => {
  it("translates ordinary prose exactly like the plain variant", () => {
    const input = "knee valgus was present";
    expect(formatBiomechanicsTextSafe(input)).toBe(formatBiomechanicsText(input));
  });

  it("leaves a URL inside a markdown link untouched", () => {
    const input = "See [the drill](https://example.com/flexion-guide) for detail";
    const out = formatBiomechanicsTextSafe(input);
    expect(out).toContain("https://example.com/flexion-guide");
    expect(out).not.toContain("https://example.com/bending-guide");
  });

  it("still translates the visible label of a markdown link", () => {
    const out = formatBiomechanicsTextSafe("[fix knee valgus](https://example.com/a)");
    expect(out).toContain("knee caving inward");
    expect(out).toContain("https://example.com/a");
  });

  it("leaves inline code spans untouched", () => {
    const out = formatBiomechanicsTextSafe("call `computeFlexion()` first");
    expect(out).toContain("`computeFlexion()`");
  });

  it("leaves fenced code blocks untouched", () => {
    const input = "Try:\n```\nconst flexion = 90;\n```\nthen review";
    expect(formatBiomechanicsTextSafe(input)).toContain("const flexion = 90;");
  });

  it("leaves autolinks untouched", () => {
    const out = formatBiomechanicsTextSafe("see <https://example.com/pronation>");
    expect(out).toContain("https://example.com/pronation");
  });

  /**
   * Capitalising every unprotected run would upper-case text that merely
   * continues a sentence after a code span.
   */
  it("only capitalises the segment that starts the message", () => {
    const out = formatBiomechanicsTextSafe("run `x` then valgus appears");
    expect(out).toContain("then inward angle appears");
    expect(out).not.toContain("Then inward angle");
  });

  it("does not re-translate its own output", () => {
    expect(formatBiomechanicsTextSafe("thoracic extension improved")).toBe(
      "Upper back opening up improved",
    );
  });

  it("returns falsy input unchanged", () => {
    expect(formatBiomechanicsTextSafe("")).toBe("");
  });
});

describe("TERM_MAP integrity", () => {
  it("uses global regexes so every occurrence is translated", () => {
    const nonGlobal = TERM_MAP.filter(([pattern]) => !pattern.global);
    expect(nonGlobal.map(([p]) => p.source)).toEqual([]);
  });

  it("orders compound terms before the generic term they contain", () => {
    // If "flexion" were listed before "hip flexion", the specific rule could
    // never win. Assert the ordering the table depends on.
    const indexOf = (source: string) =>
      TERM_MAP.findIndex(([p]) => p.source === source);

    expect(indexOf("hip flexion")).toBeLessThan(indexOf("flexion"));
    expect(indexOf("lumbar flexion")).toBeLessThan(indexOf("flexion"));
    expect(indexOf("knee valgus")).toBeLessThan(indexOf("valgus"));
    expect(indexOf("thoracic extension")).toBeLessThan(indexOf("extension"));
  });
});

// ─── Coaching text is translated everywhere it is shown ─────────────────────

describe("plain-language guarantee", () => {
  /**
   * The prompt asks the model for plain language, and that is the primary
   * control. This translator is the safety net for the generation that ignores
   * it — and a safety net wired into one screen and not the other is worse than
   * none, because the gap is invisible until a user hits it.
   *
   * Chat has always translated. The analysis screen — which carries the summary,
   * the flags, the strengths and every drill — did not, until 2026-08-12.
   */
  const clinical = [
    ["knee valgus", "knee caving inward"],
    ["lumbar flexion", "lower back rounding"],
    ["ankle dorsiflexion", "ankle flexibility"],
    ["anterior pelvic tilt", "pelvis tilting forward"],
    ["scapular winging", "shoulder blade sticking out"],
    ["eccentric", "controlled lowering"],
    ["proprioception", "body position awareness"],
  ] as const;

  it.each(clinical)("turns %s into something an amateur understands", (jargon, plain) => {
    expect(formatBiomechanicsText(`Watch your ${jargon} on the way up.`)).toContain(plain);
  });

  it("leaves already-plain coaching untouched", () => {
    // The common case once the prompt is doing its job: nothing to translate,
    // and the translator must not mangle it.
    const written = "Sit back into your hips at the bottom and keep your chest tall.";
    expect(formatBiomechanicsText(written)).toBe(written);
  });

  it("does not reintroduce jargon by translating its own output", () => {
    // "lumbar flexion" → "lower back rounding" must not then have "flexion"
    // re-matched inside the replacement. This is the single-pass guarantee.
    const out = formatBiomechanicsText("lumbar flexion and hip flexion");
    expect(out).toBe("Lower back rounding and hip bending forward");
    expect(out).not.toContain("flexion");
  });
});
