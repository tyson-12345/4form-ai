import { describe, it, expect } from "vitest";
import {
  sanitizeText,
  sanitizeMultiline,
  normalizeEmail,
  looksLikeInjection,
} from "./sanitize.js";

const NUL = String.fromCharCode(0);
const BELL = String.fromCharCode(7);
const ZWSP = "​";
const RTL_OVERRIDE = "‮";

describe("sanitizeText", () => {
  it("removes a script element together with its body", () => {
    // Stripping only the tags would leave `alert(1)` behind as innocent-looking
    // text that a future HTML surface could re-interpret.
    expect(sanitizeText("<script>alert(1)</script>Hello")).toBe("Hello");
  });

  it("removes a style element together with its body", () => {
    expect(sanitizeText("<style>body{display:none}</style>Visible")).toBe("Visible");
  });

  it("removes an unclosed script tag at end of input", () => {
    expect(sanitizeText("safe<script>alert(1)")).toBe("safe");
  });

  it("strips ordinary markup but keeps the text", () => {
    expect(sanitizeText("<b>Bold</b> and <i>italic</i>")).toBe("Bold and italic");
  });

  it("strips event-handler attributes with their tag", () => {
    expect(sanitizeText('<img src=x onerror="alert(1)">')).toBe("");
  });

  it("strips dangerous URL schemes", () => {
    expect(sanitizeText("javascript:alert(1)")).toBe("alert(1)");
    expect(sanitizeText("JaVaScRiPt : alert(1)")).toBe("alert(1)");
    expect(sanitizeText("vbscript:msgbox")).toBe("msgbox");
  });

  it("removes control characters", () => {
    expect(sanitizeText(`Foo${NUL}${BELL}Bar`)).toBe("FooBar");
  });

  it("removes zero-width and bidi-override characters", () => {
    expect(sanitizeText(`a${ZWSP}b`)).toBe("ab");
    expect(sanitizeText(`safe${RTL_OVERRIDE}txet`)).toBe("safetxet");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeText("  spaced    out  ")).toBe("spaced out");
  });

  it("collapses newlines to single spaces", () => {
    expect(sanitizeText("line1\nline2")).toBe("line1 line2");
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeText("Deadlift 180kg — PR attempt!")).toBe("Deadlift 180kg — PR attempt!");
  });

  it("is idempotent", () => {
    const once = sanitizeText("<b>x</b><script>y</script>");
    expect(sanitizeText(once)).toBe(once);
  });
});

describe("sanitizeMultiline", () => {
  it("preserves single newlines", () => {
    expect(sanitizeMultiline("line1\nline2")).toBe("line1\nline2");
  });

  it("collapses runs of 3+ newlines to a paragraph break", () => {
    expect(sanitizeMultiline("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("normalizes CRLF", () => {
    expect(sanitizeMultiline("a\r\nb")).toBe("a\nb");
  });

  it("still removes scripts", () => {
    expect(sanitizeMultiline("hi\n<script>bad()</script>\nthere")).toBe("hi\n\nthere");
  });

  it("trims trailing whitespace on each line", () => {
    expect(sanitizeMultiline("a   \n   b")).toBe("a\nb");
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Foo@Example.COM ")).toBe("foo@example.com");
  });

  it("removes internal whitespace", () => {
    expect(normalizeEmail("foo @example.com")).toBe("foo@example.com");
  });

  it("maps case variants to one identity", () => {
    // Two spellings must resolve to one account, or the uniqueness constraint
    // can be bypassed by changing capitalisation.
    expect(normalizeEmail("A@B.com")).toBe(normalizeEmail("a@b.COM"));
  });

  it("strips zero-width characters used to forge lookalike addresses", () => {
    expect(normalizeEmail(`foo${ZWSP}@example.com`)).toBe("foo@example.com");
  });
});

describe("looksLikeInjection", () => {
  it.each([
    ["<script>x</script>", "script tag"],
    ["<iframe src=evil>", "iframe"],
    ["javascript:void(0)", "js scheme"],
    ['<img onerror="x">', "event handler"],
    ["1 UNION SELECT password FROM users", "sql union"],
    ["; DROP TABLE users", "sql drop"],
  ])("flags %s (%s)", (input) => {
    expect(looksLikeInjection(input)).toBe(true);
  });

  it.each([
    "Deadlift 180kg",
    "My knee hurts when I squat < 90 degrees",
    "a > b",
    "email me at foo@bar.com",
  ])("does not flag ordinary text: %s", (input) => {
    expect(looksLikeInjection(input)).toBe(false);
  });
});
