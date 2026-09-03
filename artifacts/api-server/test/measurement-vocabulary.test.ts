/**
 * The word "safe" may not appear in measurement vocabulary.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A band is a sport-typical joint-angle range. Calling the inside of one "safe"
 * turns a geometry reading into a medical-adjacent claim — that staying inside
 * will not hurt you, and that leaving it will — which is the exact claim every
 * coaching surface disclaims ("Not a medical assessment or an injury
 * prediction"). The rule and its reasoning live on `JointZones` in
 * src/lib/scoring.ts; this file is the standing guard for it.
 *
 * Static, like test/auth-messages.test.ts and test/oauth-messages.test.ts, and
 * for the same reason: it catches the word the moment it is written.
 *
 * ── Why the prompt is tested as if it were a rendered string ────────────────
 * `NARRATIVE_SYSTEM` is not shown to anyone, but the model reuses its prompt's
 * vocabulary in the summary, strengths, improvements and tips the athlete then
 * reads. A "safe range" in the prompt becomes a "safe range" on the analysis
 * screen without anyone editing a rendered string, so the prompt has to be held
 * to the same rule the screen is. It was written this way once already: the
 * measurements block was described to the model as time spent "outside its safe
 * range" while the screen beside it had already moved to band vocabulary.
 *
 * ── What is deliberately still allowed ──────────────────────────────────────
 * `RiskFinding.safeMin` / `safeMax` are published wire fields. Renaming them is
 * a breaking change across the OpenAPI spec, the generated client and both
 * sides of the app, so they keep a name the vocabulary no longer uses. This
 * file therefore checks prose, not identifiers.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const claudeSrc = readFileSync(join(SRC, "lib", "claude.ts"), "utf8");
const scoringSrc = readFileSync(join(SRC, "lib", "scoring.ts"), "utf8");

/** The narrative system prompt, as the model receives it. */
function narrativeSystemPrompt(): string {
  const start = claudeSrc.indexOf("const NARRATIVE_SYSTEM = `");
  expect(start, "NARRATIVE_SYSTEM was renamed; update this guard").toBeGreaterThan(-1);
  const body = claudeSrc.slice(start);
  const end = body.indexOf("`;\n");
  expect(end, "could not find the end of NARRATIVE_SYSTEM").toBeGreaterThan(-1);
  return body.slice(0, end);
}

/**
 * "safe" used as a judgement about a body position — the banned sense. Plain
 * `safeMin` / `safeUuid` style identifiers are not this, and neither is "the
 * safe answer" about which schema field to leave null.
 */
const SAFE_AS_A_VERDICT = /\bsafe\s+(band|range|position|angle|zone|limit)/i;

describe("measurement vocabulary", () => {
  it("never describes a band, range or position as 'safe' in the narrative prompt", () => {
    expect(narrativeSystemPrompt()).not.toMatch(SAFE_AS_A_VERDICT);
  });

  it("tells the model the measurement is time outside a band", () => {
    expect(narrativeSystemPrompt()).toMatch(/outside its band/);
  });

  it("forbids the model from calling a position safe or unsafe", () => {
    // The model echoes its prompt into copy the athlete reads, so the rule has
    // to be stated to it, not merely obeyed by the surrounding text.
    expect(narrativeSystemPrompt()).toMatch(/Never call a position, angle or movement "safe" or "unsafe"/);
  });

  it("captions findings for the model with band vocabulary", () => {
    // The measurements block the prompt builder assembles per finding.
    expect(claudeSrc).toMatch(/`band \$\{f\.safeMin\}–\$\{f\.safeMax\}°`/);
    expect(claudeSrc).not.toMatch(SAFE_AS_A_VERDICT);
  });

  it("keeps the reasoning recorded where the bands are defined", () => {
    // One load-bearing explanation, not a comment repeated at every call site.
    expect(scoringSrc).toMatch(/Why these are "bands" and never "safe"/);
  });

  it("still exposes the safeMin/safeMax wire fields under their published names", () => {
    // Deliberate: the vocabulary changed, the response shape did not.
    expect(scoringSrc).toMatch(/^\s*safeMin: number \| null;$/m);
    expect(scoringSrc).toMatch(/^\s*safeMax: number \| null;$/m);
  });
});
