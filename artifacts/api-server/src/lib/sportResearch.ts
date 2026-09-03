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

/**
 * The per-sport table, keyed by the lowercased sport string.
 *
 * A null-prototype object, because a plain one answers `RESEARCH["constructor"]`
 * with a function and `RESEARCH["__proto__"]` with an object — and the `??
 * DEFAULT_RESEARCH` fallback in `researchForSport` only guards null. `sport` is
 * request-derived: `safeText(1, 40)` in routes/analyses.ts accepts both words
 * and `.toLowerCase()` leaves them intact, so any authenticated caller could
 * post `{"sport":"constructor"}` and have the prompt builder handed something
 * with no `injury`, `performance` or `emphasis` field at all.
 *
 * Same fix, and the same reason, as `RETURN_TO` in routes/waitlist.ts.
 */
const RESEARCH: Record<string, SportResearch> = Object.assign(Object.create(null) as Record<string, SportResearch>, {
  running: {
    injury:
      "Heiderscheit et al. (2011, J Orthop Sports Phys Ther) on step rate and joint loading; Novacheck (1998, Gait Posture) on running injury biomechanics; van Gent et al. (2007, Br J Sports Med) on lower-limb running injuries",
    performance:
      "Moore (2016, Sports Med) on modifiable biomechanical factors in running economy; Saunders et al. (2004, Sports Med) on factors affecting running economy; Cavanagh & Williams (1982, Med Sci Sports Exerc) on stride length and oxygen uptake",
    emphasis:
      "Knee and hip angles through stance matter most. Left/right symmetry is a strong signal: asymmetry in a cyclic movement is more meaningful than in a one-off lift. Deep knee flexion in swing is normal stride mechanics, not a fault; a knee flagged for sustained full extension suggests overstriding, which responds to a higher step rate.",
  },
  weightlifting: {
    injury:
      "Escamilla et al. (2001, Med Sci Sports Exerc) on squat knee biomechanics; Hartmann et al. (2013, Sports Med) on joint loading through deep squats; Calhoon & Fry (1999, J Athl Train) on weightlifting injury rates",
    performance:
      "Kipp et al. (2011, J Strength Cond Res) on joint work in the clean; Suchomel et al. (2015, Sports Med) on weightlifting derivatives and power output",
    emphasis:
      "Depth (hip and knee range of motion) and consistency across repetitions matter most. Deep squatting is well tolerated by trained lifters and is not itself an injury signal. Fully locked elbows overhead are required technique, never a fault. Some left/right asymmetry is normal under load and should not be over-read.",
  },
  powerlifting: {
    injury:
      "Escamilla et al. (2001, Med Sci Sports Exerc) on squat knee biomechanics; Siewe et al. (2011, Int J Sports Med) on powerlifting injury rates and sites",
    performance:
      "Swinton et al. (2012, J Strength Cond Res) on deadlift kinematics; Kompf & Arandjelović (2016, Sports Med) on sticking points in maximal lifts",
    emphasis:
      "Consistency and joint position under load matter most. Mobility is often genuinely limited in trained powerlifters; a low mobility score is frequently a sport adaptation rather than a fault.",
  },
  basketball: {
    injury:
      "Hewett et al. (2005, Am J Sports Med) on landing mechanics and ACL risk; Padua et al. (2009, Am J Sports Med) on landing error scoring",
    performance:
      "Rojas et al. (2000, Ergonomics) on jump shot kinematics; Struzik et al. (2014, J Hum Kinet) on countermovement jump mechanics",
    emphasis:
      "Landing mechanics dominate: the documented ACL mechanism is a stiff, near-straight-knee landing. A time-in-position statistic cannot separate landings from standing between plays, so no extension flag is raised — instead, coach the athlete to check knee bend at ground contact on the overlay. Left/right symmetry on landing is the other high-value observation.",
  },
  soccer: {
    injury:
      "Hewett et al. (2005, Am J Sports Med) on landing and cutting mechanics; Ekstrand et al. (2011, Br J Sports Med) on injury patterns in professional football",
    performance:
      "Lees et al. (2010, J Sports Sci) on the biomechanics of kicking; Nunome et al. (2006, Med Sci Sports Exerc) on instep kick mechanics",
    emphasis:
      "Hip range of motion and cutting/landing knee position matter most. The kicking backswing folds the knee hard — that is technique, not a fault. Hamstring and groin strains, football's dominant injuries, are not measurable from joint angles. Kicking is inherently one-sided; asymmetry is expected and should be read as dominance, not dysfunction.",
  },
  swimming: {
    injury:
      "Sein et al. (2010, Br J Sports Med) on swimmer's shoulder and training load; Wanivenhaus et al. (2012, Sports Health) on swimming injuries",
    performance:
      "Toussaint & Beek (1992, Sports Med) on propulsion and efficiency; Seifert et al. (2007, J Sports Sci) on stroke coordination",
    emphasis:
      "Straight limbs in streamline are required technique, never a fault. Swimming's dominant injury site — the shoulder — is not a joint we track, so keep injury framing modest and explicit about that limit. Stroke-to-stroke consistency is the strongest efficiency signal we can measure.",
  },
  cycling: {
    injury:
      "Bini et al. (2011, Sports Med) on knee joint loading and saddle position; Callaghan (2005, Phys Ther Sport) on cycling overuse injuries",
    performance:
      "Ericson (1986, Scand J Rehab Med) on muscular work at different loads; Bini & Diefenthaeler (2010, Sports Biomech) on pedalling kinematics",
    emphasis:
      "Knee flags here are bike-fit findings, not effort findings: sustained extension past the band means the saddle is likely too high (the literature recommends 25–30° of knee flexion at bottom dead centre), and deep flexion means it is likely too low, raising patellofemoral load. Range of motion is constrained by the bike, so a low mobility score usually reflects fit rather than the athlete.",
  },
  tennis: {
    injury:
      "Elliott (2006, Br J Sports Med) on tennis stroke biomechanics and injury; Abrams et al. (2012, Br J Sports Med) on shoulder and elbow loading; Pluim et al. (2006, Br J Sports Med) on tennis injuries",
    performance:
      "Reid et al. (2013, Sports Biomech) on serve kinematics; Kovacs & Ellenbecker (2011, Sports Health) on the kinetic chain in serving",
    emphasis:
      "Shoulder and elbow range of motion dominate. A near-fully extended arm at serve contact is textbook technique, not a fault — tennis elbow is an overuse pattern, not a position. Tennis is strongly one-sided; asymmetry is expected and is not itself a finding.",
  },
  crossfit: {
    injury:
      "Weisenthal et al. (2014, Orthop J Sports Med) on CrossFit injury rates and patterns — shoulder in gymnastic movements, low back in lifting movements; Hartmann et al. (2013, Sports Med) on deep-squat joint loading",
    performance:
      "Suchomel et al. (2015, Sports Med) on weightlifting derivatives; Kipp et al. (2011, J Strength Cond Res) on joint work in the clean",
    emphasis:
      "Treat like weightlifting for measured joints: deep squats and locked elbows overhead are the work, not faults. The documented injury sites (shoulder, low back) are not joints we track — say so rather than overreading knee and elbow readings.",
  },
  boxing: {
    injury:
      "Loosemore et al. (2015, Br J Sports Med) five-year GB boxing surveillance — hand and wrist injuries dominate; Zetaruk et al. (2005, Br J Sports Med) on martial arts injuries",
    performance:
      "Dinu & Louis (2020, Front Sports Act Living) on punch kinematics and effective mass",
    emphasis:
      "The guard keeps elbows bent, so time at full elbow extension reflects punches snapped to lockout — coach toward finishing punches just short of a locked elbow. Boxing's most-injured sites (hand, wrist) are not joints we track; be explicit about that limit.",
  },
  "martial arts": {
    injury:
      "Zetaruk et al. (2005, Br J Sports Med) comparing injury patterns across martial arts styles",
    performance:
      "Falco et al. (2009, J Biomech) on taekwondo kick kinematics and impact",
    emphasis:
      "Deep stances are technique, not faults. Repeated kicks and strikes snapped to a fully locked knee or elbow are the flag-worthy pattern — coach a soft finish rather than less range.",
  },
  gymnastics: {
    injury:
      "Caine & Nassar (2005, Med Sport Sci) on gymnastics injury epidemiology; Westermann et al. (2015, Sports Health) on NCAA gymnastics injuries",
    performance:
      "Prassas et al. (2006, Sports Biomech) review of gymnastics biomechanics",
    emphasis:
      "Gymnastics is the one tracked sport where a straight elbow genuinely matters: the arms bear weight, and loading a locked or hyperextended elbow is the documented mechanism behind gymnasts' elbow injuries. Deep hip and knee flexion are vocabulary, not faults.",
  },
  golf: {
    injury:
      "McHardy et al. (2006, Sports Med) on golf injuries — low back, elbow and wrist overuse dominate",
    performance:
      "Hume et al. (2005, Sports Med) on the role of biomechanics in maximising golf drive distance",
    emphasis:
      "A straight lead arm through the swing is textbook technique, never a fault. Golf's injuries are overuse patterns at the low back, elbow and wrist that accumulate over volume — a single clip cannot see them, so keep injury framing modest. Rotation consistency is the highest-value observation.",
  },
  rowing: {
    injury:
      "Wilson et al. (2010, Br J Sports Med) on rowing injury surveillance — low back, rib and knee dominate; Hickey et al. (1997, Med Sci Sports Exerc) on injuries in elite rowers",
    performance:
      "Kleshnev (2016) on rowing biomechanics and stroke efficiency; Soper & Hume (2004, Sports Med) on rowing technique and performance",
    emphasis:
      "The catch compresses knees and hips fully every stroke — deep flexion is the stroke, not a fault. Rowing's dominant injury sites (low back at the catch, rib stress) are not visible to joint-angle tracking; be explicit about that. Stroke-to-stroke consistency is the highest-value signal.",
  },
  volleyball: {
    injury:
      "Lian et al. (2005, Am J Sports Med) on jumper's knee prevalence in elite sport; Verhagen et al. (2004, Br J Sports Med) on volleyball injuries",
    performance:
      "Wagner et al. (2009, J Sports Sci Med) on spike biomechanics",
    emphasis:
      "Jumper's knee is a jump-volume story, not a single-frame position — a clip cannot diagnose it, so frame knee observations as landing-mechanics coaching (land soft, bend on contact). A fully extended arm at spike contact is technique, not a fault.",
  },
  baseball: {
    injury:
      "Fleisig et al. (1995, Am J Sports Med) on pitching kinetics — elbow valgus and extension loads near release; Conte et al. (2001, Am J Sports Med) on professional baseball injuries",
    performance:
      "Seroyer et al. (2010, Sports Health) on the kinetic chain in pitching",
    emphasis:
      "Pitching loads the elbow hardest just short of full extension; repeatedly snapping to a dead-straight arm is worth a caution. The UCL's valgus mechanism is frontal-plane and invisible to a side-on camera — never claim to have measured it.",
  },
  "track & field": {
    injury:
      "Edouard et al. (2015, Br J Sports Med) on championship athletics injury surveillance — hamstring strain is the dominant injury",
    performance:
      "Bezodis et al. (2019, Sports Biomech) on sprint acceleration mechanics",
    emphasis:
      "Events differ too much for one template — say which observations generalise. Deep knee flexion in sprint swing is normal mechanics. Hamstring strain, the discipline's top injury, is not measurable from joint angles; do not imply otherwise.",
  },
  skiing: {
    injury:
      "Bere et al. (2011, Am J Sports Med) on ACL injury mechanisms in World Cup alpine skiing; Flørenes et al. (2009, Br J Sports Med) on World Cup injury surveillance",
    performance:
      "Supej (2010, J Sports Sci) on differential mechanical energy in alpine skiing",
    emphasis:
      "A deep tuck is deliberate position, not a fault. Sustained straight-leg skiing is the pattern worth coaching against — documented ACL mechanisms feature an extended outside knee. Knee angle discipline through turns is the highest-value observation.",
  },
  climbing: {
    injury:
      "Schöffl et al. (2010, Wilderness Environ Med) on injury and fatality risk in rock and ice climbing — finger and shoulder injuries dominate",
    performance:
      "Watts (2004, Br J Sports Med) on the physiology of difficult rock climbing",
    emphasis:
      "Straight-arm hanging is efficient technique, never a fault — do not coach against extended elbows. Deep hip and knee flexion (high steps, drop knees) are vocabulary. The sport's dominant injury sites (fingers, shoulders) are beyond pose tracking; say so plainly.",
  },
  dance: {
    injury:
      "Hincapié et al. (2008, Arch Phys Med Rehabil) systematic review of musculoskeletal injury in dancers — lower-extremity and back overuse dominate",
    performance:
      "Krasnow et al. (2011, J Dance Med Sci) on biomechanics research in dance",
    emphasis:
      "Extreme range is the art form: deep plié and open hip lines are vocabulary, not faults. Dance injuries are overuse accumulated across training hours, which one clip cannot see — frame observations as load-management prompts, not alarms.",
  },
  fencing: {
    injury:
      "Harmer (2008, Clin J Sport Med) five-year US fencing surveillance — time-loss injuries are rare, mostly lower-limb strains, knee first",
    performance:
      "Turner et al. (2014, J Strength Cond Res) on physical demands and lunge mechanics in fencing",
    emphasis:
      "The lunge — deep front knee, extended weapon arm — is the sport's core action and never a fault in itself. Knee position and left/right loading through repeated lunges are the highest-value observations; fencing is inherently asymmetric, so read asymmetry as dominance, not dysfunction.",
  },
});

const DEFAULT_RESEARCH: SportResearch = {
  injury:
    "General movement-screening literature: Cook et al. (2014, Int J Sports Phys Ther) on functional movement assessment; Bahr & Krosshaug (2005, Br J Sports Med) on injury causation in sport",
  performance:
    "General motor-control literature: Schmidt & Lee on motor learning and performance; Bartlett (2007) on sports biomechanics and movement analysis",
  emphasis:
    "Weigh the measured dimensions evenly; there is no sport-specific profile for this activity, so do not assume which joint matters most.",
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
