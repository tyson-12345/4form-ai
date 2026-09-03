/**
 * What the landing page is allowed to say it measures.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The page shipped with a "TORSO LEAN" readout — its own band, its own flag,
 * its own evidence ruler — and an "ANKLE 112°" tag under the skeleton overlay.
 * The pose tracker computes neither. It measures exactly six angles (knee, hip
 * and elbow, left and right; see `JOINT_KEYS` in `poseTracker.ts`), and there
 * is no trunk or ankle angle anywhere in the codebase. Both numbers were
 * invented by a designer filling a layout, and both survived review because
 * nothing in the suite reads the page's copy against the product.
 *
 * That is the worst class of bug this page can carry. Everything else here is
 * marketing that oversells; an angle with a joint name and a degree sign next
 * to it is a claim about what the software does, and it was false. So this file
 * derives the vocabulary from `JOINT_LABELS` — the same constant the prompts
 * and the app's own UI label findings with — rather than restating it. Teach
 * the tracker a seventh joint and the page may name it the same day; until
 * then it may not.
 *
 * ── The second half ─────────────────────────────────────────────────────────
 * The card headed "WHAT WE WON'T SAY" — the page's own honesty statement —
 * used to say clips stay on your device "unless you send one for measurement",
 * describing an upload path that has never existed and that the Privacy Policy,
 * the Terms and our stated BIPA position all deny. Getting that backwards in
 * the honesty card is worse than not having the card, so the two legal
 * documents are imported here and the page is asserted against them. Three
 * statements of one fact cannot drift apart quietly.
 */

import { describe, it, expect } from "vitest";

import landingHtml from "../src/pages/landing.html";
import privacyMarkdown from "../../../docs/PRIVACY-POLICY.md";
import termsMarkdown from "../../../docs/TERMS-OF-SERVICE.md";
import { JOINT_LABELS } from "../src/lib/scoring.js";

/**
 * The joint kinds the tracker actually produces an angle for: knee, hip, elbow.
 *
 * Derived from `JOINT_LABELS` rather than written out, so this test cannot say
 * one thing while the scoring module says another. The side is dropped because
 * the page speaks about joints generically ("KNEE 86°"), not per limb.
 */
const MEASURED = new Set(Object.values(JOINT_LABELS).map((l) => l.replace(/^(left|right) /, "")));

/**
 * Joints and body segments a 2D pose tracker could plausibly be *claimed* to
 * report. The page is allowed to name the ones in `MEASURED`; naming any other
 * one is the regression this file exists to catch.
 *
 * "back" is deliberately absent: it is a lift name on this page ("Back squat")
 * and a direction ("sit back into the hip"), never a reading. The figure's own
 * SVG does draw an ankle, a shoulder and a torso — drawing a limb is honest,
 * putting a number on it is not — which is why this reads the page's copy and
 * not its markup.
 */
const POSE_VOCABULARY = [
  "knee",
  "hip",
  "elbow",
  "ankle",
  "shoulder",
  "wrist",
  "torso",
  "trunk",
  "spine",
  "lumbar",
  "thoracic",
  "cervical",
  "neck",
  "pelvis",
  "scapula",
  "patella",
  "femur",
  "tibia",
  "heel",
  "toe",
  "shin",
  "thigh",
  "forearm",
];

/**
 * The page as a reader sees it: comments, then the stylesheet, then the scripts,
 * then the tags.
 *
 * The order is load-bearing and was found the hard way. One of the head
 * comments explains the CSP by quoting `<script>` in prose, so stripping script
 * blocks first eats that comment's terminator and the next `-->` is 1,800 lines
 * away — which silently deleted a quarter of the page, including every readout
 * this file is here to check. A test that reads nothing passes everything.
 */
function visibleCopy(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

/** Whole-word, case-insensitive, singular or plural. "chip" is not a hip. */
const mentions = (text: string, word: string): boolean =>
  new RegExp(`\\b${word}s?\\b`, "i").test(text);

describe("the joints the landing page claims", () => {
  it("names no joint the pose tracker cannot measure", () => {
    const copy = visibleCopy(landingHtml);
    const unbacked = POSE_VOCABULARY.filter((w) => !MEASURED.has(w) && mentions(copy, w));

    expect(unbacked, "the page names joints the tracker never measures").toEqual([]);
  });

  it("still names the three it can, so a broken read cannot pass this file", () => {
    // The guard on the guard. `visibleCopy` returning an empty string would
    // satisfy every other assertion here, and that is exactly the failure the
    // comment-stripping order caused once already.
    const copy = visibleCopy(landingHtml);

    for (const joint of MEASURED) {
      expect(copy, `the page no longer mentions the ${joint}`).toMatch(
        new RegExp(`\\b${joint}\\b`, "i"),
      );
    }
  });

  it("prints no angle against a joint that produces none", () => {
    // "ANKLE 112°" was the shipped defect, in exactly this shape: a joint name,
    // a number, a degree sign, in a row of tags that were otherwise real.
    const readings = [...landingHtml.matchAll(/([A-Za-z]+)\s*\d+\s*(?:&deg;|&#176;|°)/g)];
    expect(readings.length, "no angle readings found — has the panel moved?").toBeGreaterThan(0);

    const named = readings
      .map((m) => (m[1] ?? "").toLowerCase())
      .filter((word) => POSE_VOCABULARY.includes(word));

    expect([...new Set(named)].filter((word) => !MEASURED.has(word))).toEqual([]);
  });

  it("labels every live readout with a joint, or with no joint at all", () => {
    const labels = [...landingHtml.matchAll(/<span class="readout__label">([^<]+)<\/span>/g)].map(
      (m) => m[1] ?? "",
    );
    expect(labels.length, "the measurement panel has no labelled readouts").toBeGreaterThan(0);

    // A label naming no joint is fine — "FORM INDEX" is a score, not a reading.
    // A label naming one has to name a real one.
    for (const label of labels) {
      const named = POSE_VOCABULARY.filter((w) => mentions(label, w));
      expect(named.filter((w) => !MEASURED.has(w)), `readout label "${label}"`).toEqual([]);
    }
  });
});

describe("the landing page's honesty card", () => {
  /** The card headed "WHAT WE WON'T SAY", body copy only. */
  const card = /WHAT WE WON&rsquo;T SAY<\/span>\s*<p class="body body--lead">([\s\S]*?)<\/p>/.exec(
    landingHtml,
  )?.[1];

  it("is still on the page", () => {
    expect(card, "the honesty card is gone, or its markup changed").toBeDefined();
  });

  it("says measurement happens on the device and clips are never uploaded", () => {
    expect(card).toMatch(/on your device/i);
    expect(card).toMatch(/never uploaded/i);
  });

  it("attaches no condition to that promise", () => {
    // The exact shipped wording was "unless you send one for measurement" — an
    // upload path that does not exist in the app and never has. A conditional
    // is the shape the mistake takes, so the conditional is what is banned.
    expect(card).not.toMatch(/\bunless\b/i);
    expect(card).not.toMatch(/\bsend (one|it|a clip|us)\b/i);
  });

  it("says the same thing the Privacy Policy and the Terms say", () => {
    // Imported, not paraphrased. If a future edit softens either document, this
    // fails and someone has to decide which of the three is wrong — which is
    // the whole point of pinning them together.
    expect(privacyMarkdown).toMatch(/videos never leave your phone/i);
    expect(privacyMarkdown).toMatch(/the video itself is never uploaded/i);
    expect(termsMarkdown).toMatch(/videos stay on your device/i);
  });
});
