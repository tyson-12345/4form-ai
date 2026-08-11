/**
 * Per-sport biomechanics literature, supplied to Claude as grounding for the
 * coaching write-up.
 *
 * Ported from Oscar's fork (`lib/ai/initialAnalysis.ts` `SPORT_RESEARCH`). It
 * is good work and it is orthogonal to the scoring disagreement: these
 * citations shape *how the numbers are explained*, never what the numbers are.
 * Scores continue to come from `lib/scoring.ts` alone.
 *
 * The citations are handed to the model as context for its own vocabulary and
 * emphasis. They are deliberately not surfaced in the UI as references — we
 * have not verified that the model attributes them correctly, and a
 * misattributed citation next to an injury readout is worse than none.
 */

export interface SportResearch {
  /** Literature on injury mechanisms for this sport. */
  injury: string;
  /** Literature on performance and efficiency for this sport. */
  performance: string;
  /** Which measured dimensions matter most, in plain language. */
  emphasis: string;
}

const RESEARCH: Record<string, SportResearch> = {
  running: {
    injury:
      "Heiderscheit et al. (2011, J Orthop Sports Phys Ther) on step rate and joint loading; Novacheck (1998, Gait Posture) on running injury biomechanics; van Gent et al. (2007, Br J Sports Med) on lower-limb running injuries",
    performance:
      "Moore (2016, Sports Med) on modifiable biomechanical factors in running economy; Saunders et al. (2004, Sports Med) on factors affecting running economy; Cavanagh & Williams (1982, Med Sci Sports Exerc) on stride length and oxygen uptake",
    emphasis:
      "Knee and hip angles through stance matter most. Left/right symmetry is a strong signal — asymmetry in a cyclic movement is more meaningful than in a one-off lift.",
  },
  weightlifting: {
    injury:
      "Escamilla et al. (2001, Med Sci Sports Exerc) on squat knee biomechanics; Schoenfeld (2010, J Strength Cond Res) on deep squat patellar tendon stress; Calhoon & Fry (1999, J Athl Train) on weightlifting injury rates",
    performance:
      "Kipp et al. (2011, J Strength Cond Res) on joint work in the clean; Suchomel et al. (2015, Sports Med) on weightlifting derivatives and power output",
    emphasis:
      "Depth (hip and knee range of motion) and consistency across repetitions matter most. Some left/right asymmetry is normal under load and should not be over-read.",
  },
  powerlifting: {
    injury:
      "Escamilla et al. (2001, Med Sci Sports Exerc) on squat knee biomechanics; Siewe et al. (2011, Int J Sports Med) on powerlifting injury rates and sites",
    performance:
      "Swinton et al. (2012, J Strength Cond Res) on deadlift kinematics; Kompf & Arandjelović (2016, Sports Med) on sticking points in maximal lifts",
    emphasis:
      "Consistency and joint position under load matter most. Mobility is often genuinely limited in trained powerlifters — a low mobility score is frequently a sport adaptation rather than a fault.",
  },
  basketball: {
    injury:
      "Hewett et al. (2005, Am J Sports Med) on landing mechanics and ACL risk; Padua et al. (2009, Am J Sports Med) on landing error scoring",
    performance:
      "Rojas et al. (2000, Ergonomics) on jump shot kinematics; Struzik et al. (2014, J Hum Kinet) on countermovement jump mechanics",
    emphasis:
      "Landing mechanics dominate. Knee angle at contact and left/right symmetry on landing are the highest-value observations.",
  },
  soccer: {
    injury:
      "Hewett et al. (2005, Am J Sports Med) on landing and cutting mechanics; Ekstrand et al. (2011, Br J Sports Med) on injury patterns in professional football",
    performance:
      "Lees et al. (2010, J Sports Sci) on the biomechanics of kicking; Nunome et al. (2006, Med Sci Sports Exerc) on instep kick mechanics",
    emphasis:
      "Hip range of motion and cutting/landing knee position matter most. Kicking is inherently one-sided — asymmetry is expected and should be read as dominance, not dysfunction.",
  },
  swimming: {
    injury:
      "Sein et al. (2010, Br J Sports Med) on swimmer's shoulder and training load; Wanivenhaus et al. (2012, Sports Health) on swimming injuries",
    performance:
      "Toussaint & Beek (1992, Sports Med) on propulsion and efficiency; Seifert et al. (2007, J Sports Sci) on stroke coordination",
    emphasis:
      "Shoulder and elbow range of motion dominate. Stroke-to-stroke consistency is a strong efficiency signal.",
  },
  cycling: {
    injury:
      "Bini et al. (2011, Sports Med) on knee joint loading and saddle position; Callaghan (2005, Phys Ther Sport) on cycling overuse injuries",
    performance:
      "Ericson (1986, Scand J Rehab Med) on muscular work at different loads; Bini & Diefenthaeler (2010, Sports Biomech) on pedalling kinematics",
    emphasis:
      "Knee angle through the pedal stroke and consistency matter most. Range of motion is constrained by the bike, so a low mobility score usually reflects fit rather than the athlete.",
  },
  tennis: {
    injury:
      "Elliott (2006, Br J Sports Med) on tennis stroke biomechanics and injury; Abrams et al. (2012, Br J Sports Med) on shoulder and elbow loading",
    performance:
      "Reid et al. (2013, Sports Biomech) on serve kinematics; Kovacs & Ellenbecker (2011, Sports Health) on the kinetic chain in serving",
    emphasis:
      "Shoulder and elbow range of motion dominate. Tennis is strongly one-sided — asymmetry is expected and is not itself a finding.",
  },
};

const DEFAULT_RESEARCH: SportResearch = {
  injury:
    "General movement-screening literature: Cook et al. (2014, Int J Sports Phys Ther) on functional movement assessment; Bahr & Krosshaug (2005, Br J Sports Med) on injury causation in sport",
  performance:
    "General motor-control literature: Schmidt & Lee on motor learning and performance; Bartlett (2007) on sports biomechanics and movement analysis",
  emphasis:
    "Weigh the measured dimensions evenly — there is no sport-specific profile for this activity, so do not assume which joint matters most.",
};

/**
 * Look up grounding for a sport. Falls back to general movement literature
 * rather than guessing, so an unrecognised sport gets honest generic framing
 * instead of citations for a different activity.
 *
 * The sport string is user-supplied, so it is lowercased and matched exactly —
 * never interpolated into the returned text.
 */
export function researchForSport(sport: string): SportResearch {
  return RESEARCH[sport.trim().toLowerCase()] ?? DEFAULT_RESEARCH;
}

/** Sports with a specific profile, for tests and diagnostics. */
export const SPORTS_WITH_RESEARCH: readonly string[] = Object.keys(RESEARCH);
