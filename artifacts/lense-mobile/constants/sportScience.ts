/**
 * The sport science library — three short, sourced reads per sport: what gets
 * injured, how the literature says to prevent it, and what good form actually
 * is. Shown on the category screen when a sport is picked.
 *
 * ── Sourcing rules ────────────────────────────────────────────────────────────
 * Every `source` is a real, checkable citation. Most come from the same curated
 * literature the server hands Claude (`api-server/src/lib/sportResearch.ts`);
 * the prevention entries add landmark trials (FIFA 11+, Nordic hamstring,
 * step-rate retraining) that are canonical in their fields. Summaries are ours,
 * written from what those papers are known for — a static screen, no model in
 * the loop, so the misattribution worry that kept citations out of the coaching
 * prose does not apply here.
 *
 * `query` links to a PubMed *search*, never a hardcoded article id. A search
 * always lands somewhere honest; a fabricated id would not.
 */

export interface SportArticle {
  kind: "injuries" | "prevention" | "form";
  title: string;
  body: string;
  /** Author–year–journal citation(s). Real papers only. */
  source: string;
  /** PubMed search term for the "read the research" link. */
  query: string;
}

type Library = Record<string, [SportArticle, SportArticle, SportArticle]>;

const LIB: Library = {
  running: [
    {
      kind: "injuries",
      title: "Where runners get hurt",
      body: "Most running injuries are overuse at the knee, shin and Achilles, and most trace back to load rising faster than tissue adapts. Overstriding — landing with the knee nearly straight, far ahead of the body — concentrates that load at the knee.",
      source: "van Gent et al., 2007, Br J Sports Med; Novacheck, 1998, Gait Posture",
      query: "running lower limb overuse injuries review",
    },
    {
      kind: "prevention",
      title: "Cadence is the cheapest fix",
      body: "Raising step rate by 5–10% at the same speed shortens the stride and measurably drops the load on the knee and hip each step. Pair it with unhurried weekly mileage increases: sudden spikes in training load are the best-documented injury trigger.",
      source: "Heiderscheit et al., 2011, J Orthop Sports Phys Ther; Gabbett, 2016, Br J Sports Med",
      query: "step rate manipulation running joint loading",
    },
    {
      kind: "form",
      title: "What good running form is",
      body: "Land with the foot closer under the hips, knee slightly bent, at a comfortably quick cadence. Deep knee bend in the swing phase is normal mechanics, not a fault — the economical stride is compact and symmetric rather than long.",
      source: "Moore, 2016, Sports Med; Saunders et al., 2004, Sports Med",
      query: "running economy biomechanics modifiable factors",
    },
  ],
  weightlifting: [
    {
      kind: "injuries",
      title: "Where lifters get hurt",
      body: "Injury rates in weightlifting are lower than most team sports; what does occur clusters at the low back, shoulder and knee, usually from technique breaking down under maximal load rather than from depth itself.",
      source: "Calhoon & Fry, 1999, J Athl Train",
      query: "weightlifting injury rates olympic lifters",
    },
    {
      kind: "prevention",
      title: "Depth is not the enemy",
      body: "Deep squats are well tolerated by trained lifters — the knee adapts to the load it is given time to adapt to. Prevention is progression: earn depth and load gradually, and keep the bar path and torso angle consistent rep to rep.",
      source: "Hartmann et al., 2013, Sports Med",
      query: "deep squat knee joint loading review",
    },
    {
      kind: "form",
      title: "What a good squat actually is",
      body: "Hips and knees bend together, heels stay down, and the torso angle is held rather than collapsing forward. Elbows locked overhead in the snatch and jerk are required technique. Consistency across reps is the marker that separates practice from grinding.",
      source: "Escamilla et al., 2001, Med Sci Sports Exerc; Kipp et al., 2011, J Strength Cond Res",
      query: "squat biomechanics knee technique",
    },
  ],
  crossfit: [
    {
      kind: "injuries",
      title: "Where CrossFit athletes get hurt",
      body: "The documented pattern is shoulder injuries in the gymnastic movements and low-back injuries in the lifting movements, with overall rates comparable to recreational lifting rather than to contact sport.",
      source: "Weisenthal et al., 2014, Orthop J Sports Med",
      query: "crossfit injury rates patterns",
    },
    {
      kind: "prevention",
      title: "Fatigue is the variable to manage",
      body: "Most flagged reps arrive late in a workout, when form degrades under fatigue. Cap technical lifts before failure, scale gymnastic volume to current shoulder capacity, and treat sudden weekly load jumps as the risk they are.",
      source: "Weisenthal et al., 2014, Orthop J Sports Med; Gabbett, 2016, Br J Sports Med",
      query: "crossfit injury prevention training load",
    },
    {
      kind: "form",
      title: "What good form is under the clock",
      body: "The same positions as weightlifting — depth with a held torso angle, locked elbows overhead — kept identical while breathing hard. The rep that counts is the last one looking like the first one.",
      source: "Hartmann et al., 2013, Sports Med; Suchomel et al., 2015, Sports Med",
      query: "weightlifting derivatives technique power",
    },
  ],
  boxing: [
    {
      kind: "injuries",
      title: "Where boxers get hurt",
      body: "Five years of national-squad surveillance puts the hand and wrist first — the joints pose tracking cannot see. What it can see: punches repeatedly snapped to a fully locked elbow, which loads the joint at its end range.",
      source: "Loosemore et al., 2015, Br J Sports Med",
      query: "boxing injuries surveillance hand wrist",
    },
    {
      kind: "prevention",
      title: "Protect the hands, spare the elbow",
      body: "Careful wrapping and glove habits address the dominant injuries. For the elbow, finish punches just short of lockout — full snap adds no meaningful reach and hands the joint the deceleration work the muscles should do.",
      source: "Loosemore et al., 2015, Br J Sports Med",
      query: "boxing hand wrist injury prevention",
    },
    {
      kind: "form",
      title: "What a good punch looks like",
      body: "Power comes up the chain — hips rotate, shoulder follows, arm extends last and stops just before lock. The guard keeps elbows bent by design, so long stretches at full extension in a clip usually mean overreaching.",
      source: "Dinu & Louis, 2020, Front Sports Act Living",
      query: "punch kinematics effective mass boxing",
    },
  ],
  "martial arts": [
    {
      kind: "injuries",
      title: "Where martial artists get hurt",
      body: "Injury patterns differ sharply by style — striking arts load the limbs, throwing arts the neck and shoulder — but across styles, most time-loss injuries come from sparring intensity rather than technique practice.",
      source: "Zetaruk et al., 2005, Br J Sports Med",
      query: "martial arts injuries comparison styles",
    },
    {
      kind: "prevention",
      title: "Control the finish, control the risk",
      body: "Kicks and strikes snapped to a hard-locked knee or elbow are the repeatable pattern worth changing: finish with a soft joint. Graduated sparring intensity is the other documented lever.",
      source: "Zetaruk et al., 2005, Br J Sports Med",
      query: "martial arts injury prevention sparring",
    },
    {
      kind: "form",
      title: "What good technique shares across styles",
      body: "Deep stances are technique, not faults. Good strikes rotate from the hips with the limb decelerating before end range — range of motion with control at the finish is the shared signature of clean technique.",
      source: "Falco et al., 2009, J Biomech",
      query: "taekwondo kick kinematics impact",
    },
  ],
  gymnastics: [
    {
      kind: "injuries",
      title: "Where gymnasts get hurt",
      body: "Gymnastics carries one of the highest injury rates of any sport, led by the ankle on landings and — uniquely among tracked sports — the elbow, because the arms bear full body weight on locked joints.",
      source: "Caine & Nassar, 2005, Med Sport Sci; Westermann et al., 2015, Sports Health",
      query: "gymnastics injury epidemiology",
    },
    {
      kind: "prevention",
      title: "Land soft, load the elbow deliberately",
      body: "Stick landings with bent knees absorbing over distance, and build weight-bearing elbow work gradually — a locked or hyperextended elbow under body weight is the documented mechanism behind gymnasts' elbow injuries.",
      source: "Westermann et al., 2015, Sports Health",
      query: "gymnastics elbow injury prevention landing",
    },
    {
      kind: "form",
      title: "What good form is on tracked joints",
      body: "Deep hip and knee flexion is vocabulary, not a fault. On the arms, good form means a strong but not hyperextended elbow under load, and landings where the knees visibly give on contact.",
      source: "Prassas et al., 2006, Sports Biomech",
      query: "gymnastics biomechanics review",
    },
  ],
  basketball: [
    {
      kind: "injuries",
      title: "Where basketball players get hurt",
      body: "The season-ender is the ACL, and its documented mechanism is a stiff, near-straight-knee landing, often with the knee caving inward. Ankle sprains are the volume injury.",
      source: "Hewett et al., 2005, Am J Sports Med",
      query: "basketball ACL landing mechanics",
    },
    {
      kind: "prevention",
      title: "Neuromuscular training works",
      body: "Structured jump-landing programs — practising soft, bent-knee landings with the knee tracking over the toes — measurably reduce ACL injury risk in jumping athletes. Ten focused minutes in warm-up is the documented dose.",
      source: "Hewett et al., 2005, Am J Sports Med; Padua et al., 2009, Am J Sports Med",
      query: "ACL injury prevention neuromuscular training jumping",
    },
    {
      kind: "form",
      title: "What a good landing looks like",
      body: "Bend at the knee and hip on contact, knees over toes, weight even between feet. Check the overlay at ground contact: the frame that matters is the first one after landing, and both knees should be visibly bent in it.",
      source: "Padua et al., 2009, Am J Sports Med; Struzik et al., 2014, J Hum Kinet",
      query: "landing error scoring system jump",
    },
  ],
  soccer: [
    {
      kind: "injuries",
      title: "Where footballers get hurt",
      body: "Hamstring strains lead professional football's injury tables, followed by groin, knee and ankle. The knee's worst case — the ACL — comes from cutting and landing with a straight, inward-caving knee.",
      source: "Ekstrand et al., 2011, Br J Sports Med; Hewett et al., 2005, Am J Sports Med",
      query: "soccer injuries epidemiology professional",
    },
    {
      kind: "prevention",
      title: "The programs with trial evidence",
      body: "The FIFA 11+ warm-up cut injuries by roughly a third in a randomised trial, and Nordic hamstring exercise programs reduced hamstring strains by more than half. Few sports have prevention evidence this direct.",
      source: "Soligard et al., 2008, BMJ; Petersen et al., 2011, Am J Sports Med",
      query: "FIFA 11+ injury prevention randomised",
    },
    {
      kind: "form",
      title: "What good mechanics look like",
      body: "Cut and land on a bent knee that tracks over the toes. The kicking leg folding deep in the backswing is technique; asymmetry between kicking and plant leg is dominance, not dysfunction.",
      source: "Lees et al., 2010, J Sports Sci",
      query: "soccer kicking biomechanics",
    },
  ],
  tennis: [
    {
      kind: "injuries",
      title: "Where tennis players get hurt",
      body: "The shoulder and elbow carry tennis's signature overuse injuries — tennis elbow is a load-volume story, not a single bad position. The knee and trunk matter mostly as the base the arm swings from.",
      source: "Abrams et al., 2012, Br J Sports Med; Pluim et al., 2006, Br J Sports Med",
      query: "tennis injuries shoulder elbow epidemiology",
    },
    {
      kind: "prevention",
      title: "Condition the whole chain",
      body: "Serve load should be built gradually, and the documented protective factor is a conditioned kinetic chain — legs and trunk doing their share so the elbow does not absorb what the hips skipped.",
      source: "Kovacs & Ellenbecker, 2011, Sports Health",
      query: "tennis serve kinetic chain injury",
    },
    {
      kind: "form",
      title: "What a good serve actually is",
      body: "Legs drive first, trunk rotates, and the arm reaches near-full extension at contact — that straight arm is textbook, not a fault. Energy flows up the chain in order; a serve that starts at the shoulder ends at the physio.",
      source: "Elliott, 2006, Br J Sports Med; Reid et al., 2013, Sports Biomech",
      query: "tennis serve kinematics biomechanics",
    },
  ],
  golf: [
    {
      kind: "injuries",
      title: "Where golfers get hurt",
      body: "Low back first, then elbow and wrist — all overuse patterns that accumulate over swing volume rather than arriving in one bad swing. A single clip cannot see them building.",
      source: "McHardy et al., 2006, Sports Med",
      query: "golf injuries low back review",
    },
    {
      kind: "prevention",
      title: "Volume and trunk rotation are the levers",
      body: "Manage practice-ball volume the way runners manage mileage, and keep the trunk rotating freely — a stiff mid-back sends rotation the low back was never meant to supply.",
      source: "McHardy et al., 2006, Sports Med; Gabbett, 2016, Br J Sports Med",
      query: "golf low back injury prevention swing",
    },
    {
      kind: "form",
      title: "What a good swing shares",
      body: "A straight lead arm through impact is textbook. What distinguishes good swings in the literature is consistency of rotation and tempo, swing to swing — not any single position held harder.",
      source: "Hume et al., 2005, Sports Med",
      query: "golf swing biomechanics drive distance",
    },
  ],
  swimming: [
    {
      kind: "injuries",
      title: "Where swimmers get hurt",
      body: "Swimmer's shoulder dominates, and the strongest documented association is training volume — metres per week — rather than any single stroke flaw. The joints pose tracking follows are not where swimming hurts.",
      source: "Sein et al., 2010, Br J Sports Med; Wanivenhaus et al., 2012, Sports Health",
      query: "swimmer shoulder training volume",
    },
    {
      kind: "prevention",
      title: "Meter discipline over everything",
      body: "Build weekly volume gradually, rotate stroke loads, and keep the rotator cuff conditioned. Dryland shoulder work earns its place in the literature as the counterweight to high metreage.",
      source: "Sein et al., 2010, Br J Sports Med",
      query: "swimming shoulder injury prevention",
    },
    {
      kind: "form",
      title: "What efficient swimming looks like",
      body: "Long, straight lines: streamline with locked elbows is required technique, never a fault. Stroke-to-stroke consistency is the efficiency signal — the best swimmers repeat themselves almost exactly.",
      source: "Toussaint & Beek, 1992, Sports Med; Seifert et al., 2007, J Sports Sci",
      query: "swimming stroke efficiency coordination",
    },
  ],
  cycling: [
    {
      kind: "injuries",
      title: "Where cyclists get hurt",
      body: "Overuse knee pain leads, and it is usually a bike-fit finding wearing an injury costume: a saddle too high extends the knee past its happy range at the bottom of every stroke, too low compresses it.",
      source: "Bini et al., 2011, Sports Med; Callaghan, 2005, Phys Ther Sport",
      query: "cycling knee overuse saddle height",
    },
    {
      kind: "prevention",
      title: "Fit the bike before treating the knee",
      body: "The literature's target is 25–30° of knee bend at the bottom of the pedal stroke. Sustained readings outside that band in a clip are a fit prompt, not a training fault — move the saddle, not the athlete.",
      source: "Bini et al., 2011, Sports Med",
      query: "bicycle saddle position knee injury biomechanics",
    },
    {
      kind: "form",
      title: "What a good pedal stroke is",
      body: "A stable pelvis, knees tracking straight ahead, and the same knee angle window at the bottom of every stroke. Range of motion is set by the machine — consistency within it is what the rider controls.",
      source: "Bini & Diefenthaeler, 2010, Sports Biomech",
      query: "pedalling kinematics cycling technique",
    },
  ],
  rowing: [
    {
      kind: "injuries",
      title: "Where rowers get hurt",
      body: "Low back at the catch, rib stress from volume, knee third. All are invisible to joint-angle tracking of a single stroke — they accumulate across thousands of them.",
      source: "Wilson et al., 2010, Br J Sports Med; Hickey et al., 1997, Med Sci Sports Exerc",
      query: "rowing injuries surveillance low back",
    },
    {
      kind: "prevention",
      title: "Sequence and volume",
      body: "Legs, then back, then arms — a catch where the back opens early moves load to the spine. Manage weekly volume increases the way the surveillance data says injuries actually arrive: gradually.",
      source: "Wilson et al., 2010, Br J Sports Med; Soper & Hume, 2004, Sports Med",
      query: "rowing technique low back injury prevention",
    },
    {
      kind: "form",
      title: "What a good stroke is",
      body: "Full compression at the catch — deep knees and hips are the stroke, not a fault — then legs drive before the back swings and the arms finish. Stroke-to-stroke consistency is the highest-value measurable.",
      source: "Soper & Hume, 2004, Sports Med",
      query: "rowing stroke biomechanics efficiency",
    },
  ],
  volleyball: [
    {
      kind: "injuries",
      title: "Where volleyball players get hurt",
      body: "Ankle sprains at the net are the acute injury; jumper's knee is the chronic one, and it tracks jump volume — patellar tendons keep count even when nobody else does.",
      source: "Verhagen et al., 2004, Br J Sports Med; Lian et al., 2005, Am J Sports Med",
      query: "volleyball injuries jumpers knee prevalence",
    },
    {
      kind: "prevention",
      title: "Balance training and jump budgets",
      body: "Proprioceptive balance-board programs cut ankle sprain recurrence in volleyball in a randomised trial. For the knee: count jumps the way runners count miles, and land bent — the tendon logs every stiff landing.",
      source: "Verhagen et al., 2004, Am J Sports Med; Visnes & Bahr, 2007, Br J Sports Med",
      query: "volleyball ankle sprain balance board prevention",
    },
    {
      kind: "form",
      title: "What a good spike and landing look like",
      body: "Approach fast, jump off both feet, arm fully extended at contact — that straight arm is technique. Then the part that keeps seasons alive: land on two bent knees, not one straight one.",
      source: "Wagner et al., 2009, J Sports Sci Med",
      query: "volleyball spike biomechanics landing",
    },
  ],
  baseball: [
    {
      kind: "injuries",
      title: "Where baseball players get hurt",
      body: "The pitching elbow is the headline: valgus stress near ball release loads the UCL hardest, and that frontal-plane force is invisible to a side-on camera. Shoulder overuse follows close behind.",
      source: "Fleisig et al., 1995, Am J Sports Med; Conte et al., 2001, Am J Sports Med",
      query: "baseball pitching elbow UCL kinetics",
    },
    {
      kind: "prevention",
      title: "Pitch counts are the evidence",
      body: "Young pitchers who pitch more months per year and more pitches per outing get injured more — the dose-response is documented. Rest is not lost development; it is the documented protective factor.",
      source: "Fleisig et al., 2011, Am J Sports Med",
      query: "youth baseball pitch count injury risk",
    },
    {
      kind: "form",
      title: "What a good pitch shares",
      body: "Power climbs the chain — stride, hip rotation, trunk, then arm — with the elbow finishing just short of dead straight. Repeatedly snapping to full extension at release is the side-on-visible pattern worth a caution.",
      source: "Seroyer et al., 2010, Sports Health",
      query: "pitching kinetic chain biomechanics",
    },
  ],
  "track & field": [
    {
      kind: "injuries",
      title: "Where track athletes get hurt",
      body: "Championship surveillance is unambiguous: the hamstring strain is the discipline's dominant injury, concentrated in the sprints. It happens in late swing, as the muscle brakes the flying leg.",
      source: "Edouard et al., 2015, Br J Sports Med",
      query: "athletics championship injuries hamstring",
    },
    {
      kind: "prevention",
      title: "Eccentric hamstring work",
      body: "Nordic hamstring programs more than halved hamstring strains in trials — the muscle is trained to do the exact braking job that injures it. Sprint loads still need building gradually.",
      source: "Petersen et al., 2011, Am J Sports Med",
      query: "nordic hamstring exercise prevention sprint",
    },
    {
      kind: "form",
      title: "What good sprint mechanics are",
      body: "High heel recovery — deep knee flexion in swing — is normal sprint mechanics, not a fault. Good acceleration is a forward lean with force driven back into the track, and symmetry between legs is the signal worth watching.",
      source: "Bezodis et al., 2019, Sports Biomech",
      query: "sprint acceleration biomechanics technique",
    },
  ],
  skiing: [
    {
      kind: "injuries",
      title: "Where skiers get hurt",
      body: "The knee, overwhelmingly, and the ACL specifically. World Cup video analysis shows the mechanisms feature an extended outside knee at the moment of load — the straight leg is the vulnerable leg.",
      source: "Bere et al., 2011, Am J Sports Med; Flørenes et al., 2009, Br J Sports Med",
      query: "alpine skiing ACL injury mechanisms",
    },
    {
      kind: "prevention",
      title: "Stay flexed, stay strong",
      body: "Keep the knees bent through turns rather than bracing on a straight leg, and build the leg strength that keeps that position available deep into a tired afternoon — most injuries arrive on tired legs.",
      source: "Bere et al., 2011, Am J Sports Med",
      query: "skiing injury prevention knee",
    },
    {
      kind: "form",
      title: "What good skiing position is",
      body: "A deep tuck is deliberate, never a fault. Good turning form keeps both knees flexed and driving — knee-angle discipline through the turn is the highest-value thing a clip can show.",
      source: "Supej, 2010, J Sports Sci",
      query: "alpine skiing turn mechanics energy",
    },
  ],
  climbing: [
    {
      kind: "injuries",
      title: "Where climbers get hurt",
      body: "Fingers first — pulley strains from crimping — then shoulders. Both are beyond what pose tracking sees. Acute injuries in roped climbing are rarer than the overuse the fingers quietly accumulate.",
      source: "Schöffl et al., 2010, Wilderness Environ Med",
      query: "rock climbing finger pulley injuries",
    },
    {
      kind: "prevention",
      title: "Finger load is a training variable",
      body: "Build crimp strength slowly across seasons, favour open-hand grips when a hold allows, and treat sudden increases in board or campus volume as the documented risk they are.",
      source: "Schöffl et al., 2010, Wilderness Environ Med",
      query: "climbing injury prevention finger training",
    },
    {
      kind: "form",
      title: "What efficient climbing looks like",
      body: "Straight-arm hanging is efficiency, never a fault — bent arms burn out, skeletons hang free. Deep hip flexion in high steps and drop knees is vocabulary. Quiet feet and a still core are what the physiology rewards.",
      source: "Watts, 2004, Br J Sports Med",
      query: "rock climbing physiology technique",
    },
  ],
  dance: [
    {
      kind: "injuries",
      title: "Where dancers get hurt",
      body: "Lower-limb and back overuse dominates — injuries accumulated across training hours rather than caused by single movements. The systematic review evidence points at load, floors and schedules more than technique.",
      source: "Hincapié et al., 2008, Arch Phys Med Rehabil",
      query: "dance musculoskeletal injury review",
    },
    {
      kind: "prevention",
      title: "Schedule is the treatment",
      body: "Distribute rehearsal load, protect recovery days, and progress new choreography gradually. Extreme range is the art form; the literature's lever is how fast you accumulate hours in it, not the range itself.",
      source: "Hincapié et al., 2008, Arch Phys Med Rehabil",
      query: "dancer injury prevention training load",
    },
    {
      kind: "form",
      title: "What good technique means here",
      body: "Deep plié and open hip lines are vocabulary, not faults — a flag on range alone usually means the sport profile, not the dancer, is wrong. Alignment through the range, knee over foot, is the coaching-relevant signal.",
      source: "Krasnow et al., 2011, J Dance Med Sci",
      query: "dance biomechanics alignment technique",
    },
  ],
  fencing: [
    {
      kind: "injuries",
      title: "Where fencers get hurt",
      body: "Time-loss injuries are rare; when they come, they are lower-limb strains with the knee first — the front knee absorbs every lunge. Five years of US surveillance ranks fencing among the safer combat sports.",
      source: "Harmer, 2008, Clin J Sport Med",
      query: "fencing injuries surveillance",
    },
    {
      kind: "prevention",
      title: "Strengthen the lunge you already do",
      body: "Single-leg strength and controlled deceleration work for the front leg, plus attention to the asymmetry fencing builds by design — train the trailing side enough that dominance does not become imbalance.",
      source: "Turner et al., 2014, J Strength Cond Res",
      query: "fencing lunge physical demands conditioning",
    },
    {
      kind: "form",
      title: "What a good lunge is",
      body: "Deep front knee tracking over the foot, extended weapon arm, and a controlled return — the lunge is the sport's core action and never a fault in itself. Watch the front knee's line, not its depth.",
      source: "Turner et al., 2014, J Strength Cond Res",
      query: "fencing lunge biomechanics",
    },
  ],
};

/** Honest generic entries for "Other" and anything unrecognised. */
const GENERIC: [SportArticle, SportArticle, SportArticle] = [
  {
    kind: "injuries",
    title: "How sports injuries actually happen",
    body: "Across sports, injuries need a mechanism, a vulnerable tissue, and a load history that set both up. Most 'sudden' injuries are the visible end of an accumulation the weeks before.",
    source: "Bahr & Krosshaug, 2005, Br J Sports Med",
    query: "sports injury causation mechanisms",
  },
  {
    kind: "prevention",
    title: "The one lever that generalises",
    body: "Training load that rises gradually. Sharp spikes against recent baseline are the best-documented injury trigger across sports — the ratio of this week to the last month matters more than the raw number.",
    source: "Gabbett, 2016, Br J Sports Med",
    query: "acute chronic workload ratio injury",
  },
  {
    kind: "form",
    title: "What movement screening can and can't say",
    body: "Screens and angle measurements describe how you move, not your fate. Use them to find asymmetries and positions worth coaching, and treat any single reading as a prompt, never a verdict.",
    source: "Cook et al., 2014, Int J Sports Phys Ther",
    query: "functional movement screen assessment",
  },
];

/** Powerlifting shares weightlifting's evidence base with its own injury survey. */
LIB["powerlifting"] = [
  {
    kind: "injuries",
    title: "Where powerlifters get hurt",
    body: "Shoulder, low back and knee, at rates comparable to other strength sports — and mostly overuse rather than acute. Limited mobility in trained powerlifters is often adaptation, not pathology.",
    source: "Siewe et al., 2011, Int J Sports Med",
    query: "powerlifting injuries rates sites",
  },
  LIB["weightlifting"][1],
  {
    kind: "form",
    title: "What good lifting form is",
    body: "Bar over mid-foot, joints stacked, and the same positions rep after rep — consistency under load is the marker. A sticking point is a leverage problem to train, not a form emergency.",
    source: "Swinton et al., 2012, J Strength Cond Res; Kompf & Arandjelović, 2016, Sports Med",
    query: "deadlift squat kinematics sticking point",
  },
];

/**
 * The three reads for a sport, or honest generic guidance when we have no
 * profile. Lowercased exact match, same convention as the risk profiles.
 */
export function scienceForSport(sport: string | null | undefined): [SportArticle, SportArticle, SportArticle] {
  if (!sport) return GENERIC;
  return LIB[sport.trim().toLowerCase()] ?? GENERIC;
}

/** PubMed search URL for an article's query. A search, never a fabricated id. */
export function pubmedUrl(article: SportArticle): string {
  return "https://pubmed.ncbi.nlm.nih.gov/?term=" + encodeURIComponent(article.query);
}
