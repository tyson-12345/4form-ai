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
import {
  SECURITY_PREAMBLE,
  wrapUntrusted,
  wrapUntrustedList,
} from "./promptSafety.js";
import { researchForSport } from "./sportResearch.js";

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
    .describe(
      "What the athlete is doing well, in plain language they'd recognise. No degrees, no anatomy jargon.",
    ),
  improvements: z
    .array(z.string().max(300))
    .min(1)
    .max(4)
    .describe(
      "Changes to make, written as instructions the athlete can act on next rep. " +
        "The FIRST item must be the single highest-priority fix. No degrees, no anatomy jargon.",
    ),
  tips: z
    .array(
      z.object({
        category: z.enum(["technique", "injury-risk", "mobility", "strength", "conditioning"]),
        severity: z.enum(["info", "warning", "critical"]),
        title: z.string().max(80).describe("Plain-language, action-oriented. Not a diagnosis label."),
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
        description: z
          .string()
          .max(500)
          .describe(
            "What this movement pattern puts stress on, in everyday words. " +
              "Describe the position, not the measurement. Never predict injury.",
          ),
        prevention: z.string().max(400).describe("A specific prevention exercise or cue."),
      }),
    )
    .max(4),
  summary: z
    .string()
    .max(800)
    .describe(
      "2-3 sentences the athlete reads first. What went well, the one thing to fix, and why it matters " +
        "to how they move. Conversational: no numbers, no jargon.",
    ),
});

export type Narrative = z.infer<typeof NarrativeSchema>;

const NARRATIVE_SYSTEM = `You are a great coach talking to an amateur athlete about the clip they just filmed. Think of the tone as a coach standing next to them at practice, not a clinician writing a report.

You will be given REAL measurements taken from pose tracking of their video: joint angle ranges, left/right symmetry, and how much of the clip each joint spent outside its safe range. Scores have already been computed from those measurements. The measurements are your evidence; they are NOT your vocabulary.

── How to write ──
- **Lead with what to do, not what was measured.** "Sit back into your hips more at the bottom" beats "your hip flexion measured 84°".
- **Do not put degrees, percentages, or measurement numbers in your text.** The app already shows the numbers next to your words; repeating them makes the writing read like a lab result. Describe what the number *means* instead: "your left knee dips a lot further than your right" rather than "a 14° left-right difference".
- **Never use an em dash (—) anywhere in your writing.** Use a period, a comma, or a colon instead.
- **No anatomy words a 15-year-old wouldn't use.** Say "knee caving inward", not "valgus". "Lower back rounding", not "lumbar flexion". "Ankle flexibility", not "dorsiflexion". If you catch yourself writing a Latin word, replace it.
- **Be concrete and physical.** The athlete should be able to picture the fix and try it on their next rep. Reference what they'd feel or see: where the weight is, what's moving too early, what to keep still.
- Short sentences. Second person. Encouraging but never vague: "good depth" is useless, "you're getting low enough, the issue is what your knees do on the way up" is coaching.

── Priority ──
Put the single most important change FIRST in the improvements list. If they only fix one thing this week, that's the one. Do not bury it.

── Hard rules ──
- Ground every statement in the measurements you were given. You may describe them in plain words, but never invent one.
- If something was not measured, do not discuss it as though it was.
- Never state or imply a probability of future injury. You may say a position puts stress somewhere.
- Do not diagnose. You are describing movement, not medical conditions.
- Every tip must name a real drill with sets, reps, and one coaching cue.

If the measurements are limited (few joints tracked, short clip), say so plainly in the summary and keep the advice narrow rather than padding it with generic tips.
${SECURITY_PREAMBLE}`;

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

  // `sport`, `title`, `goals` and `injuryConcerns` are free text typed by the
  // user and are wrapped as untrusted. Everything else on this prompt —
  // angles, scores, risk bands, joint labels — is measured or computed by us
  // and is left unwrapped so the model can tell our data from theirs.
  const research = researchForSport(sport);

  const lines: string[] = [
    `Sport: ${wrapUntrusted(sport)}`,
    `Session: ${wrapUntrusted(title)}`,
    `Athlete level: ${wrapUntrusted(level)}`,
    `Clip length: ${metrics.durationSec.toFixed(1)}s`,
    `Frames analysed: ${metrics.frameCount} (tracking quality ${(metrics.trackingQuality * 100).toFixed(0)}%)`,
    metrics.detectedReps != null
      ? `Repetitions detected: ${metrics.detectedReps}`
      : "Repetitions: none detected. A single rep, a hold, or a non-repeating movement.",
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

  // Only the dimensions we actually measure are sent.
  //
  // Power and speed were previously included as "not measured", along with a
  // note telling the model not to comment on them. That put the words in front
  // of it and then asked it not to think about them — which is a worse prompt
  // than simply not mentioning them. Tyson and Oscar agreed on 2026-08-12 to
  // drop both dimensions entirely rather than report or estimate them, so they
  // are filtered here at the source.
  //
  // The `power`/`speed` fields remain `null` in the API response and the
  // database columns still exist; removing those is a breaking change and is
  // tracked separately.
  lines.push("", "COMPUTED SCORES (0-100):");
  for (const [key, value] of Object.entries(scores)) {
    if (value === null) continue;
    lines.push(`  ${key}: ${value}`);
  }

  if (riskFindings.length > 0) {
    lines.push(
      "",
      "TIME SPENT OUTSIDE THE SPORT'S CLASSIFICATION BANDS:",
      `  (bands are specific to ${metrics.riskProfile ? "this sport's risk profile" : "the legacy generic profile"} — a position outside its band is a flagged position for this sport, not a universal fault)`,
    );
    for (const f of riskFindings) {
      const band =
        f.safeMin !== null && f.safeMax !== null
          ? `band ${f.safeMin}–${f.safeMax}°`
          : f.safeMax !== null
            ? `band up to ${f.safeMax}°`
            : f.safeMin !== null
              ? `band from ${f.safeMin}°`
              : "band open";
      lines.push(
        `  ${JOINT_LABELS[f.joint]}: ${f.riskPercent}% of frames in the risk band, ` +
          `${f.cautionPercent}% in the caution band (observed ${f.observedMin}–${f.observedMax}°, ${band})`,
      );
    }
  } else {
    lines.push("", "No joint spent measurable time outside this sport's classification bands.");
  }

  if (input.goals?.length) {
    lines.push("", `Athlete's stated goals: ${wrapUntrustedList(input.goals)}`);
  }
  if (input.injuryConcerns?.length) {
    lines.push(`Existing injury concerns: ${wrapUntrustedList(input.injuryConcerns)}`);
  }

  // Sport-specific grounding, so the write-up uses the vocabulary and emphasis
  // of the sport rather than generic movement advice. Selected by exact match
  // on a lowercased sport name — the user's string is never interpolated here.
  lines.push(
    "",
    "SPORT CONTEXT (for your framing and emphasis, not a source of numbers):",
    `  What matters most: ${research.emphasis}`,
    `  Injury literature: ${research.injury}`,
    `  Performance literature: ${research.performance}`,
    "  Use this to decide what to emphasise and what vocabulary to use. Do not cite these",
    "  papers to the athlete by name, and do not let them override what the measurements show.",
  );

  lines.push(
    "",
    "Write the coaching analysis.",
    "The numbers above are your evidence: read them, reason from them, then write what they MEAN for how this athlete moves. Do not quote the numbers back; the app displays them alongside your words.",
    "Only the dimensions listed above were measured. Do not introduce or estimate any other dimension.",
  );

  return lines.join("\n");
}

// ─── AI coach chat ───────────────────────────────────────────────────────────

const CHAT_SYSTEM = `You are Atlas, the AI coach inside AthleteAI. You help amateur athletes improve technique and train safely.

You have access to the athlete's most recent movement analysis, which is based on real pose-tracking measurements of a video they uploaded.

How you talk:
- Like a coach at practice, not a report. Plain words, short sentences, second person.
- **Lead with what to do.** The fix comes first; the reason comes second, if it helps.
- **Keep the numbers out of it unless they ask.** You can see their scores and angles, and you should reason from them, but say "your left knee is dipping further than your right" rather than reciting the measurement. If they ask for the numbers directly, give them.
- Never use an em dash (—) anywhere in your writing. Use a period, a comma, or a colon instead.
- No anatomy jargon. "Knee caving inward", not "valgus". "Lower back rounding", not "lumbar flexion". If a Latin word appears in your draft, swap it for what it looks like.
- Scores marked "not measured" were not measurable from 2D video; say so if asked, don't speculate.
- Be direct and encouraging, but never downplay something that could cause injury.
- End with one concrete thing they can do today.
- 2-3 short paragraphs unless they ask for depth.
- You are not a doctor. For pain, persistent or sharp, tell them to see a physio; don't diagnose.
${SECURITY_PREAMBLE}`;

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
    // Everything the athlete typed — sport, level, the session title — is
    // wrapped. This block is appended to the *system* prompt, which is the
    // most valuable place for an injected instruction to land, so the
    // delimiters matter more here than anywhere else in the app.
    system +=
      `\n\nAthlete context:` +
      `\n- Sport: ${context.sport ? wrapUntrusted(context.sport) : "not set"}` +
      `\n- Level: ${context.level ? wrapUntrusted(context.level) : "not set"}`;

    if (context.recentAnalysis) {
      const { title, scores, strengths, improvements } = context.recentAnalysis;
      const scoreLines = Object.entries(scores)
        .map(([k, v]) => `  - ${k}: ${v === null ? "not measured" : Math.round(v)}/100`)
        .join("\n");
      system += `\n\nMost recent analysis: ${wrapUntrusted(title)}\nScores:\n${scoreLines}`;
      // Strengths and improvements are Claude's own prior output, not the
      // athlete's text, but they are still model-generated and round-trip
      // through the database — wrap them rather than trust the round trip.
      if (strengths.length) {
        system += `\nStrengths: ${wrapUntrustedList(strengths.slice(0, 3))}`;
      }
      if (improvements.length) {
        system += `\nTo improve: ${wrapUntrustedList(improvements.slice(0, 3))}`;
      }
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
