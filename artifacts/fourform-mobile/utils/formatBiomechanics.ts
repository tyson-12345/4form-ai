/**
 * Plain-English translation of biomechanics jargon.
 *
 * Claude writes like a clinician when left alone — "excessive knee valgus with
 * concurrent anterior pelvic tilt" is accurate and useless to a 15-year-old.
 * This maps the vocabulary down to language an amateur athlete can act on,
 * after the fact, so the prompt does not have to carry a glossary.
 *
 * Ported from Oscar's fork (`utils/formatBiomechanics.ts`). Two changes:
 *
 *  1. The markdown-safe variant here uses the same single-pass span algorithm
 *     as the plain one. Oscar's `formatBiomechanicsTextSafe` falls back to
 *     sequential `.replace()` calls, which re-translates its own output — the
 *     exact double-translation bug his single-pass rewrite fixed for the other
 *     variant. See `translateSpans` for why one pass is required.
 *
 *  2. Capitalisation is only applied when the segment actually starts the
 *     string, so translating the tail of a markdown-split message no longer
 *     upper-cases text mid-sentence.
 */

/**
 * Ordered jargon → plain English. **Order is significant**: the most specific
 * pattern must come first, because the first match at a given position wins.
 * "hamstring tendinopathy" has to precede the bare "tendinopathy" family, and
 * "hip flexion" has to precede "flexion".
 */
export const TERM_MAP: Array<[RegExp, string]> = [
  // ── Injury / pathology (specific first) ──
  [/proximal hamstring tendinopathy/gi, "hamstring tendon irritation near the hip"],
  [/hamstring tendinopathy/gi, "hamstring tendon irritation"],
  [/patellar tendinopathy/gi, "kneecap tendon irritation"],
  [/patella tendinopathy/gi, "kneecap tendon irritation"],
  [/achilles tendinopathy/gi, "Achilles tendon irritation"],
  [/iliotibial band syndrome/gi, "outer knee and hip friction syndrome"],
  [/\bIT band syndrome\b/gi, "outer knee and hip friction syndrome"],
  [/medial tibial stress syndrome/gi, "shin splints"],
  [/plantar fasciitis/gi, "heel and arch pain"],
  [/stress fracture/gi, "bone stress injury"],
  [/labral tear/gi, "hip socket cartilage tear"],

  // ── Knee ──
  [/knee valgus/gi, "knee caving inward"],
  [/knee varus/gi, "knee bowing outward"],
  [/valgus collapse/gi, "knee caving inward"],
  [/patellofemoral/gi, "kneecap"],
  [/tibiofemoral/gi, "knee joint"],

  // ── Lower leg / foot ──
  [/tibial torsion/gi, "shin bone twist"],
  [/pes planus/gi, "flat foot"],
  [/pes cavus/gi, "high arch foot"],
  [/calcaneus/gi, "heel bone"],
  [/metatarsal/gi, "foot bone"],
  [/tibia/gi, "shin bone"],
  [/fibula/gi, "lower leg bone"],
  [/femur/gi, "thigh bone"],

  // ── Lumbar / spine ──
  [/lumbar flexion/gi, "lower back rounding"],
  [/lumbar hyperextension/gi, "lower back arching too much"],
  [/lumbar lordosis/gi, "lower back curve"],
  [/lumbar/gi, "lower back"],
  [/thoracic kyphosis/gi, "upper back rounding"],
  [/thoracic extension/gi, "upper back opening up"],
  [/thoracic/gi, "upper back"],
  [/cervical/gi, "neck"],
  [/sacroiliac/gi, "pelvis joint"],
  [/sacrum/gi, "base of spine"],
  [/coccyx/gi, "tailbone"],
  [/erector spinae/gi, "spinal support muscles"],

  // ── Pelvis ──
  [/anterior pelvic tilt/gi, "pelvis tilting forward"],
  [/posterior pelvic tilt/gi, "pelvis tucking under"],
  [/pelvic obliquity/gi, "pelvis tilting sideways"],
  [/pelvic rotation/gi, "pelvis rotating"],

  // ── Hip ──
  [/hip flexion/gi, "hip bending forward"],
  [/hip extension/gi, "hips opening back"],
  [/hip abduction/gi, "leg moving out to the side"],
  [/hip adduction/gi, "leg crossing inward"],
  [/hip drop/gi, "hip dipping to one side"],
  [/iliopsoas/gi, "deep hip-bending muscle"],
  [/iliotibial band/gi, "outer hip-to-knee band"],
  [/\bIT band\b/gi, "outer hip-to-knee band"],
  [/piriformis/gi, "deep hip rotator muscle"],
  [/gluteus maximus/gi, "large buttock muscle"],
  [/gluteus medius/gi, "side buttock muscle"],
  [/gluteus minimus/gi, "deep buttock muscle"],
  [/\bglutes?\b/gi, "buttock muscles"],
  [/Q-angle/gi, "knee tracking angle"],

  // ── Shoulder ──
  [/shoulder impingement/gi, "shoulder pinching"],
  [/shoulder protraction/gi, "shoulders rounding forward"],
  [/shoulder retraction/gi, "shoulders pulling back"],
  [/shoulder elevation/gi, "shoulders shrugging up"],
  [/scapular winging/gi, "shoulder blade sticking out"],
  [/glenohumeral joint/gi, "shoulder joint"],
  [/glenohumeral/gi, "shoulder joint"],
  [/rotator cuff/gi, "shoulder stabilizer muscles"],
  [/supraspinatus/gi, "top shoulder muscle"],
  [/infraspinatus/gi, "rear shoulder muscle"],
  [/acromion/gi, "shoulder tip bone"],
  [/\bscapula\b/gi, "shoulder blade"],
  [/clavicle/gi, "collarbone"],

  // ── Trunk / back muscles ──
  [/latissimus dorsi/gi, "large back muscle"],
  [/rhomboids?/gi, "upper back muscles between shoulder blades"],
  [/trapezius/gi, "upper back and neck muscle"],
  [/trunk lateral flexion/gi, "side bending"],

  // ── Elbow / wrist ──
  [/elbow valgus/gi, "elbow flaring out"],
  [/wrist extension/gi, "wrist bending back"],
  [/wrist flexion/gi, "wrist bending forward"],

  // ── Leg muscles ──
  [/quadriceps/gi, "front of thigh muscle"],
  [/\bquads?\b/gi, "front of thigh muscle"],
  [/gastrocnemius/gi, "calf muscle"],
  [/soleus/gi, "deep calf muscle"],
  [/pectorals?/gi, "chest muscles"],
  [/\bpecs?\b/gi, "chest muscles"],
  [/deltoid/gi, "shoulder muscle"],
  [/biceps/gi, "front upper arm muscle"],
  [/triceps/gi, "back of upper arm muscle"],

  // ── Movement direction (specific before generic) ──
  [/ankle dorsiflexion/gi, "ankle flexibility"],
  [/ankle plantar flexion/gi, "ankle pointing"],
  [/excessive forward lean/gi, "leaning too far forward"],
  [/forward head posture/gi, "head jutting forward"],
  [/lateral flexion/gi, "side bending"],
  [/internal rotation/gi, "inward rotation"],
  [/external rotation/gi, "outward rotation"],
  [/foot eversion/gi, "foot rolling inward"],
  [/foot inversion/gi, "foot rolling outward"],

  // ── General anatomical direction ──
  [/\bproximal\b/gi, "closer to the body"],
  [/\bdistal\b/gi, "farther from the body"],
  [/\banterior\b/gi, "front-side"],
  [/\bposterior\b/gi, "back-side"],
  [/\bmedial\b/gi, "inner side"],
  [/\blateral\b/gi, "outer side"],
  [/ipsilateral/gi, "same side"],
  [/contralateral/gi, "opposite side"],

  // ── Abbreviations ──
  [/\bROM\b/g, "range of motion"],
  [/\bGRF\b/g, "impact force"],
  [/\bCOM\b/g, "body's balance point"],

  // ── Generic movement terms (after compounds) ──
  [/dorsiflexion/gi, "ankle flexibility"],
  [/plantar flexion/gi, "ankle pointing"],
  [/plantarflexion/gi, "ankle pointing"],
  [/pronation/gi, "foot rolling inward"],
  [/supination/gi, "foot rolling outward"],
  [/abduction/gi, "moving out to the side"],
  [/adduction/gi, "moving inward"],
  [/flexion/gi, "bending"],
  [/hyperextension/gi, "overextending"],
  [/extension/gi, "straightening"],
  [/valgus/gi, "inward angle"],
  [/varus/gi, "outward angle"],

  // ── Muscle contraction types ──
  [/eccentric/gi, "controlled lowering"],
  [/concentric/gi, "pushing phase"],
  [/isometric/gi, "held position"],
  [/plyometric/gi, "explosive jump training"],

  // ── General medical/science vocab ──
  [/proprioception/gi, "body position awareness"],
  [/proprioceptive/gi, "body-awareness"],
  [/neuromuscular/gi, "muscle control"],
  [/musculoskeletal/gi, "muscle and joint"],
  [/biomechanical/gi, "movement"],
  [/biomechanics/gi, "movement mechanics"],
  [/kinetic chain/gi, "movement chain"],
  [/deceleration/gi, "controlled stopping"],
  [/ground reaction force/gi, "impact force"],
  [/center of (mass|gravity)/gi, "body's balance point"],
  [/stride length/gi, "step distance"],
  [/cadence/gi, "step rate"],
];

interface Span {
  start: number;
  end: number;
  replacement: string;
  priority: number;
}

/**
 * Translate in a single pass over the original string.
 *
 * Running the patterns sequentially with `.replace()` would let each rule see
 * the *previous* rule's output, so translations cascade: "lumbar flexion"
 * becomes "lower back rounding", and a later rule matching inside that
 * replacement mangles it further. Collecting non-overlapping spans against the
 * untouched input and splicing once makes every replacement independent.
 *
 * Overlaps resolve by earliest start, then by position in TERM_MAP — which is
 * what makes the specific-before-generic ordering in the table meaningful.
 */
function translateSpans(raw: string): string {
  const spans: Span[] = [];

  for (let i = 0; i < TERM_MAP.length; i++) {
    const [pattern, replacement] = TERM_MAP[i]!;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw)) !== null) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        replacement,
        priority: i,
      });
      if (!pattern.global) break;
      // Zero-length matches would loop forever.
      if (match[0].length === 0) pattern.lastIndex++;
    }
  }

  spans.sort((a, b) => a.start - b.start || a.priority - b.priority);

  let result = "";
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // overlapped by an earlier winner
    result += raw.slice(cursor, span.start) + span.replacement;
    cursor = span.end;
  }
  return result + raw.slice(cursor);
}

function capitalizeFirst(text: string): string {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Translate plain text. Use `formatBiomechanicsTextSafe` for markdown. */
export function formatBiomechanicsText(raw: string): string {
  if (!raw) return raw;
  return capitalizeFirst(translateSpans(raw));
}

/**
 * Segments that must survive untranslated, in priority order:
 *   1. Fenced code block  (``` or ~~~)
 *   2. Inline code span   (`…`)
 *   3. Markdown link URL  (the `](url)` portion of `[text](url)`)
 *   4. Autolink           (`<scheme://…>`)
 *
 * Without this, a URL containing "flexion" gets rewritten and the link breaks.
 */
const PROTECTED_RE =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]+`|\]\([^)]*\)|<[a-z][a-z0-9+\-.]*:\/\/[^>]*>)/gi;

/**
 * Markdown-safe translation: rewrites prose and link labels, leaves code spans
 * and URLs exactly as written.
 */
export function formatBiomechanicsTextSafe(raw: string): string {
  if (!raw) return raw;

  // `split` with a capturing group interleaves the parts:
  // [unprotected, protected, unprotected, protected, …]
  const parts = raw.split(PROTECTED_RE);

  const translated = parts.map((part, i) => {
    if (i % 2 !== 0) return part; // protected — pass through verbatim
    const out = translateSpans(part ?? "");
    // Only the segment that actually begins the message gets capitalised;
    // capitalising every unprotected run would upper-case text that continues
    // a sentence after an inline code span.
    return i === 0 ? capitalizeFirst(out) : out;
  });

  return translated.join("");
}
