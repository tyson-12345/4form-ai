/**
 * Claude integration.
 *
 * ── Division of responsibility ──────────────────────────────────────────────
 * Claude does **not** produce scores, joint angles, or risk percentages. Those
 * are measured by MediaPipe in the client and computed deterministically in
 * lib/scoring.ts. Claude's only job here is to *explain* numbers that already
 * exist — turning "left knee spent 18% of frames below 70°" into coaching a
 * 15-year-old can act on.
 *
 * This split is the whole point. Previously Claude was handed a sport name and
 * the user's title and asked to invent an entire biomechanical assessment, so
 * the app displayed confident numbers with nothing behind them and gave a
 * different answer every time the same clip was uploaded.
 *
 * Output shape is enforced with structured outputs rather than parsed out of
 * prose with regexes, so a malformed response is impossible by construction.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { logger } from "./logger.js";
import {
  JOINT_LABELS,
  type PoseMetrics,
  type RiskFinding,
  type Scores,
} from "./scoring.js";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxRetries: 3,
});

/** Current Sonnet-tier model. */
const MODEL = "claude-sonnet-5";

/**
 * Whether written coaching output is available.
 *
 * Callers check this so a missing key degrades a feature rather than failing a
 * request — measurement and scoring never touch Claude.
 */
export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Thrown when a narrative was requested but Claude isn't available. */
export class CoachUnavailableError extends Error {
  constructor(message = "Coaching write-up is unavailable") {
    super(message);
    this.name = "CoachUnavailableError";
  }
}

// ─── Coaching narrative ──────────────────────────────────────────────────────

const NarrativeSchema = z.object({
  strengths: z
    .array(z.string().max(300))
    .min(1)
    .max(4)
    .describe("Specific things the measurements show the athlete doing well."),
  improvements: z
    .array(z.string().max(300))
    .min(1)
    .max(4)
    .describe("Specific, actionable changes justified by the measurements."),
  tips: z
    .array(
      z.object({
        category: z.enum(["technique", "injury-risk", "mobility", "strength", "conditioning"]),
        severity: z.enum(["info", "warning", "critical"]),
        title: z.string().max(80),
        description: z.string().max(600),
        drill: z.string().max(400).describe("A named drill with sets, reps, and a coaching cue."),
      }),
    )
    .min(1)
    .max(5),
  riskExplanations: z
    .array(
      z.object({
        joint: z.string().max(40),
        description: z.string().max(500).describe("What the measured pattern means, mechanically."),
        prevention: z.string().max(400).describe("A specific prevention exercise or cue."),
      }),
    )
    .max(4),
  summary: z
    .string()
    .max(800)
    .describe("2-3 sentence plain-language readout of the session for the athlete."),
});

export type Narrative = z.infer<typeof NarrativeSchema>;

const NARRATIVE_SYSTEM = `You are a sports biomechanics coach writing up a movement analysis for an amateur athlete.

You will be given REAL measurements taken from pose tracking of the athlete's video: joint angle ranges, left/right symmetry, and how much of the clip each joint spent outside safe ranges. Scores have already been computed from those measurements.

Hard rules:
- Ground every statement in the measurements you are given. Cite specific numbers ("your left knee reached 62° at its deepest").
- Never invent a measurement you were not given. If something was not measured, do not discuss it as though it was.
- Never state or imply a probability of future injury. You may describe what a joint position stresses mechanically.
- Do not diagnose. You are describing movement, not medical conditions.
- Write for a motivated teenager or adult amateur: direct, concrete, no jargon without a plain-language gloss.
- Every tip must name a real drill with sets, reps, and one coaching cue.

If the measurements are limited (few joints tracked, short clip), say so plainly in the summary rather than padding with generic advice.`;

export async function generateNarrative(input: {
  sport: string;
  title: string;
  level: string;
  metrics: PoseMetrics;
  scores: Scores;
  riskFindings: RiskFinding[];
  goals?: string[];
  injuryConcerns?: string[];
}): Promise<Narrative> {
  if (!claudeConfigured()) throw new CoachUnavailableError();

  const prompt = buildNarrativePrompt(input);

  const message = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: NARRATIVE_SYSTEM,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: zodOutputFormat(NarrativeSchema),
    },
    messages: [{ role: "user", content: prompt }],
  });

  if (message.stop_reason === "refusal") {
    logger.error({ event: "claude_refusal" }, "Claude declined the analysis request");
    throw new Error("Analysis could not be generated");
  }

  if (!message.parsed_output) {
    logger.error(
      { stopReason: message.stop_reason, event: "claude_unparsed" },
      "Structured output missing from Claude response",
    );
    throw new Error("Analysis could not be generated");
  }

  return message.parsed_output;
}

function buildNarrativePrompt(input: {
  sport: string;
  title: string;
  level: string;
  metrics: PoseMetrics;
  scores: Scores;
  riskFindings: RiskFinding[];
  goals?: string[];
  injuryConcerns?: string[];
}): string {
  const { sport, title, level, metrics, scores, riskFindings } = input;

  const lines: string[] = [
    `Sport: ${sport}`,
    `Session: "${title}"`,
    `Athlete level: ${level}`,
    `Clip length: ${metrics.durationSec.toFixed(1)}s`,
    `Frames analysed: ${metrics.frameCount} (tracking quality ${(metrics.trackingQuality * 100).toFixed(0)}%)`,
    "",
    "MEASURED JOINT ANGLES (degrees):",
  ];

  for (const [key, stats] of Object.entries(metrics.joints)) {
    if (!stats) continue;
    const label = JOINT_LABELS[key as keyof typeof JOINT_LABELS] ?? key;
    lines.push(
      `  ${label}: range ${Math.round(stats.min)}–${Math.round(stats.max)}°, ` +
        `mean ${Math.round(stats.mean)}°, variability ${Math.round(stats.stdDev)}°`,
    );
  }

  lines.push("", "COMPUTED SCORES (0-100, null = not measurable from 2D pose):");
  for (const [key, value] of Object.entries(scores)) {
    lines.push(`  ${key}: ${value === null ? "not measured" : value}`);
  }

  if (riskFindings.length > 0) {
    lines.push("", "TIME SPENT IN HIGH-STRAIN JOINT POSITIONS:");
    for (const f of riskFindings) {
      lines.push(
        `  ${JOINT_LABELS[f.joint]}: ${f.riskPercent}% of frames in the risk band, ` +
          `${f.cautionPercent}% in the caution band (observed ${f.observedMin}–${f.observedMax}°)`,
      );
    }
  } else {
    lines.push("", "No joint spent measurable time outside its safe range.");
  }

  if (input.goals?.length) lines.push("", `Athlete's stated goals: ${input.goals.join(", ")}`);
  if (input.injuryConcerns?.length) {
    lines.push(`Existing injury concerns: ${input.injuryConcerns.join(", ")}`);
  }

  lines.push(
    "",
    "Write the coaching analysis. Reference the numbers above directly.",
    "Note: power and speed are listed as 'not measured' because they cannot be derived from 2D joint angles. Do not comment on them as if they were measured.",
  );

  return lines.join("\n");
}

// ─── AI coach chat ───────────────────────────────────────────────────────────

const CHAT_SYSTEM = `You are Atlas, the AI coach inside AthleteAI. You help amateur athletes improve technique and train safely.

You have access to the athlete's most recent movement analysis, which is based on real pose-tracking measurements of a video they uploaded.

How you work:
- Reference their actual numbers when relevant ("your balance score of 72 came from a 14° difference between your knees").
- Scores marked "not measured" were not measurable from 2D video — say so if asked, don't speculate.
- Be direct and encouraging, but never downplay something that could cause injury.
- End with one concrete thing they can do today.
- Keep it to 2-3 short paragraphs unless they ask for depth.
- You are not a doctor. For pain, persistent or sharp, tell them to see a physio — don't diagnose.`;

export async function chatWithCoach(
  messages: { role: "user" | "assistant"; content: string }[],
  context?: {
    sport?: string;
    level?: string;
    recentAnalysis?: {
      title: string;
      scores: Record<string, number | null>;
      strengths: string[];
      improvements: string[];
    };
  },
): Promise<string> {
  let system = CHAT_SYSTEM;

  if (context) {
    system += `\n\nAthlete context:\n- Sport: ${context.sport || "not set"}\n- Level: ${context.level || "not set"}`;

    if (context.recentAnalysis) {
      const { title, scores, strengths, improvements } = context.recentAnalysis;
      const scoreLines = Object.entries(scores)
        .map(([k, v]) => `  - ${k}: ${v === null ? "not measured" : Math.round(v)}/100`)
        .join("\n");
      system += `\n\nMost recent analysis: "${title}"\nScores:\n${scoreLines}`;
      if (strengths.length) system += `\nStrengths: ${strengths.slice(0, 3).join("; ")}`;
      if (improvements.length) system += `\nTo improve: ${improvements.slice(0, 3).join("; ")}`;
    }
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    // Chat is interactive, so trade a little depth for latency.
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    messages,
  });

  if (response.stop_reason === "refusal") {
    return "I can't help with that one. Ask me about your technique, training, or analysis results and I'll dig in.";
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) throw new Error("Empty response from coach");
  return text;
}
