/**
 * Per-sport joint risk profiles — which measured positions are worth flagging,
 * for whom.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The tracker used to classify every clip against one hardcoded set of bands:
 * any knee past 175° or elbow past 160° was flagged, regardless of sport. That
 * treats "the limb is straight" as inherently risky — but a locked elbow is
 * *required* technique overhead in weightlifting, a straight arm is the
 * efficient way to hang in climbing, and a straight leg between reps is just
 * standing. A flag that fires on correct technique teaches the athlete to
 * ignore flags.
 *
 * Each sport now gets its own zones, derived from that sport's published
 * injury patterns (the `basis` strings). Two principles decide the numbers:
 *
 *  1. **A flag must map to a documented mechanism in this sport.** Cycling
 *     keeps a knee-extension flag because sustained extension means the saddle
 *     is too high — a measured, literature-backed overuse mechanism (Bini
 *     2011). Basketball gets none, because a per-frame angle cannot tell a
 *     stiff-knee landing (the real ACL mechanism, Hewett 2005) from standing
 *     between plays — that guidance belongs in the narrative, not in a
 *     time-in-position statistic that would penalise standing still.
 *
 *  2. **Time-in-position must mean something.** A boxer's guard is bent, so
 *     frames at full elbow extension are punches — brief and meaningful, so a
 *     caution zone is honest. A swimmer's streamline is straight limbs held
 *     for lengths at a time — flagging it would measure the sport, not a fault.
 *
 * The zones are the classification bands only. What the athlete reads about
 * them is written server-side, grounded in `sportResearch.ts` — angles are the
 * measurement, not the whole story.
 *
 * ── Provenance ──────────────────────────────────────────────────────────────
 * The active profile (id, version, zones) is embedded into the metrics the
 * tracker reports, and stored with the analysis. A stored finding is therefore
 * always read against the bands it was classified with, even after this file
 * changes. Bump `RISK_PROFILE_VERSION` when any zone changes.
 */

import { canonicalSport } from "./sports";

/**
 * Classification zones for one joint kind, in degrees of included angle
 * (180° = fully straight).
 *
 * A frame is `risk` at or below `loRisk` / at or above `hiRisk`, `caution` at
 * or below `loWarn` / at or above `hiWarn`, otherwise within range. `-1`
 * disables the low side (no angle is ≤ -1); `999` disables the high side.
 */
export interface JointZones {
  loRisk: number;
  loWarn: number;
  hiWarn: number;
  hiRisk: number;
}

/** Zones are symmetric left/right; the tracker applies them to both sides. */
export interface RiskZones {
  knee: JointZones;
  hip: JointZones;
  elbow: JointZones;
}

export interface SportRiskProfile {
  /** Canonical lowercased sport, or "generic". */
  id: string;
  zones: RiskZones;
  /**
   * The injury literature the zones are derived from. Short citations only —
   * the full grounding lives server-side in sportResearch.ts. Shown nowhere
   * yet; carried so a zone choice is never an unattributed opinion.
   */
  basis: string;
}

/** Bump when any profile's zones change, so stored metrics say which era they used. */
export const RISK_PROFILE_VERSION = 1;

/** No flags on this side of the range. */
const NONE_LO = -1;
const NONE_HI = 999;

/** A joint kind with no flags at all — nothing this joint does is a finding. */
const UNFLAGGED: JointZones = { loRisk: NONE_LO, loWarn: NONE_LO, hiWarn: NONE_HI, hiRisk: NONE_HI };

/**
 * The bands that shipped before profiles existed, kept verbatim. Clips whose
 * metrics carry no profile were classified against these — the server uses the
 * same constants to caption legacy findings honestly.
 */
export const LEGACY_ZONES: RiskZones = {
  knee: { loRisk: 70, loWarn: 90, hiWarn: 175, hiRisk: 178 },
  hip: { loRisk: 55, loWarn: 80, hiWarn: NONE_HI, hiRisk: NONE_HI },
  elbow: { loRisk: NONE_LO, loWarn: NONE_LO, hiWarn: 160, hiRisk: 172 },
};

/**
 * Unknown movement ("Other", or a sport string we don't recognise).
 *
 * Deliberately conservative: deep flexion gets a mild note, full extension
 * gets nothing — a straight limb is not a finding without sport context.
 */
const GENERIC: SportRiskProfile = {
  id: "generic",
  zones: {
    knee: { loRisk: 55, loWarn: 75, hiWarn: NONE_HI, hiRisk: NONE_HI },
    hip: { loRisk: 50, loWarn: 70, hiWarn: NONE_HI, hiRisk: NONE_HI },
    elbow: UNFLAGGED,
  },
  basis:
    "Cook et al. 2014 (Int J Sports Phys Ther) functional movement screening; " +
    "Bahr & Krosshaug 2005 (Br J Sports Med) injury causation",
};

const PROFILES: Record<string, SportRiskProfile> = {
  weightlifting: {
    id: "weightlifting",
    zones: {
      // Deep squatting is the sport, and depth itself is not the documented
      // hazard (loading the knee is well tolerated through full flexion in
      // trained lifters). Only extreme collapse is noted. Lockout overhead is
      // required technique, so elbows carry no flags at all.
      knee: { loRisk: 40, loWarn: 55, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 40, loWarn: 55, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis:
      "Hartmann et al. 2013 (Sports Med) deep-squat joint loading; " +
      "Calhoon & Fry 1999 (J Athl Train) weightlifting injury sites",
  },
  running: {
    id: "running",
    zones: {
      // Swing-phase heel lift brings the knee near full flexion every stride,
      // so the low zones sit far below the generic ones. Sustained full
      // extension is the overstride signal — caution, never alarm.
      knee: { loRisk: 25, loWarn: 35, hiWarn: 178, hiRisk: NONE_HI },
      hip: { loRisk: 55, loWarn: 75, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis:
      "van Gent et al. 2007 (Br J Sports Med) lower-limb running injuries; " +
      "Heiderscheit et al. 2011 (JOSPT) step rate and joint loading",
  },
  crossfit: {
    id: "crossfit",
    zones: {
      // Olympic-lift ranges: deep squats and overhead lockout are the work.
      knee: { loRisk: 40, loWarn: 55, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 40, loWarn: 55, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis:
      "Weisenthal et al. 2014 (Orthop J Sports Med) CrossFit injury patterns; " +
      "Hartmann et al. 2013 (Sports Med) deep-squat joint loading",
  },
  boxing: {
    id: "boxing",
    zones: {
      // The guard is bent, so extended-elbow frames are punches. Repeatedly
      // snapping punches to full lockout is the mechanism coaches train out;
      // it earns a caution band. Hands and wrists — boxing's dominant injury
      // site — are not joints we track, and the narrative says so.
      knee: { loRisk: 55, loWarn: 75, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 50, loWarn: 70, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: { loRisk: NONE_LO, loWarn: NONE_LO, hiWarn: 170, hiRisk: 178 },
    },
    basis:
      "Loosemore et al. 2015 (Br J Sports Med) GB boxing injury surveillance; " +
      "Zetaruk et al. 2005 (Br J Sports Med) martial arts injuries",
  },
  "martial arts": {
    id: "martial arts",
    zones: {
      // Deep stances are technique; snapping kicks and strikes to full
      // lockout are the flag-worthy pattern.
      knee: { loRisk: 30, loWarn: 45, hiWarn: 178, hiRisk: NONE_HI },
      hip: { loRisk: 30, loWarn: 45, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: { loRisk: NONE_LO, loWarn: NONE_LO, hiWarn: 170, hiRisk: 178 },
    },
    basis: "Zetaruk et al. 2005 (Br J Sports Med) injuries across martial arts styles",
  },
  gymnastics: {
    id: "gymnastics",
    zones: {
      // The one sport where a straight elbow genuinely earns a flag: the arm
      // bears bodyweight, and loading a locked or hyperextended elbow is the
      // documented mechanism behind young gymnasts' elbow injuries.
      knee: { loRisk: 35, loWarn: 50, hiWarn: 178, hiRisk: NONE_HI },
      hip: { loRisk: 25, loWarn: 40, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: { loRisk: NONE_LO, loWarn: NONE_LO, hiWarn: 172, hiRisk: 178 },
    },
    basis:
      "Caine & Nassar 2005 (Med Sport Sci) gymnastics injury epidemiology; " +
      "Westermann et al. 2015 (Sports Health) NCAA gymnastics injuries",
  },
  basketball: {
    id: "basketball",
    zones: {
      // No extension flags: a frame cannot tell a stiff-knee landing — the
      // real, documented ACL mechanism — from standing between plays, and a
      // time-in-position statistic would mostly measure standing. Landing
      // mechanics are addressed in the narrative instead.
      knee: { loRisk: 45, loWarn: 60, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 45, loWarn: 65, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis:
      "Hewett et al. 2005 (Am J Sports Med) landing mechanics and ACL risk; " +
      "Drakos et al. 2010 (Sports Health) NBA injury epidemiology",
  },
  soccer: {
    id: "soccer",
    zones: {
      // The kicking backswing folds the knee hard — normal. Hamstring and
      // groin, soccer's dominant sites, are not measurable from joint angles.
      knee: { loRisk: 30, loWarn: 40, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 50, loWarn: 70, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis: "Ekstrand et al. 2011 (Br J Sports Med) injury patterns in professional football",
  },
  tennis: {
    id: "tennis",
    zones: {
      // The serve extends the arm near-fully by design; tennis elbow is a
      // gripping/loading overuse pattern, not a position our angle can catch.
      knee: { loRisk: 50, loWarn: 70, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 50, loWarn: 70, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis:
      "Abrams et al. 2012 (Br J Sports Med) shoulder and elbow loading in tennis; " +
      "Pluim et al. 2006 (Br J Sports Med) tennis injuries review",
  },
  golf: {
    id: "golf",
    zones: {
      // A straight lead arm through the swing is textbook. Golf's injuries
      // (low back, elbow tendinopathy) are overuse, not joint-position events.
      knee: { loRisk: 55, loWarn: 75, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 50, loWarn: 70, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis: "McHardy et al. 2006 (Sports Med) golf injuries review",
  },
  swimming: {
    id: "swimming",
    zones: {
      // Streamline is straight limbs held deliberately — extension flags would
      // measure the sport itself. The shoulder, swimming's dominant injury
      // site, is not a joint we track; the narrative is explicit about that.
      knee: { loRisk: 40, loWarn: 55, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 45, loWarn: 65, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis:
      "Sein et al. 2010 (Br J Sports Med) swimmer's shoulder; " +
      "Wanivenhaus et al. 2012 (Sports Health) swimming injuries",
  },
  cycling: {
    id: "cycling",
    zones: {
      // Both knee zones are bike-fit findings, not effort findings: sustained
      // extension past ~160° means the saddle is too high (the review
      // literature recommends 25–30° of knee flexion at bottom dead centre),
      // and deep flexion means it is too low, which raises patellofemoral
      // load. The steady riding posture makes time-in-position meaningful.
      knee: { loRisk: 50, loWarn: 65, hiWarn: 160, hiRisk: 170 },
      hip: { loRisk: 25, loWarn: 35, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis:
      "Bini et al. 2011 (Sports Med) saddle height, knee injury risk and performance; " +
      "Clarsen et al. 2010 (Am J Sports Med) overuse injuries in pro cycling",
  },
  rowing: {
    id: "rowing",
    zones: {
      // The catch compresses knees and hips fully every stroke — that is the
      // stroke, not a fault. Rowing's real sites (low back at the catch, rib
      // stress) are not visible to a joint-angle tracker; the narrative owns
      // that caveat.
      knee: { loRisk: 25, loWarn: 35, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 20, loWarn: 30, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis: "Wilson et al. 2010 (Br J Sports Med) rowing injury surveillance",
  },
  volleyball: {
    id: "volleyball",
    zones: {
      // Same landing logic as basketball: the spike-approach jump volume that
      // drives jumper's knee is a load story, not a per-frame position.
      knee: { loRisk: 45, loWarn: 60, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 45, loWarn: 65, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis:
      "Lian et al. 2005 (Am J Sports Med) jumper's knee prevalence; " +
      "Verhagen et al. 2004 (Br J Sports Med) volleyball injuries",
  },
  baseball: {
    id: "baseball",
    zones: {
      // Pitching loads the elbow hardest just short of full extension; a clip
      // that repeatedly snaps to a dead-straight arm earns a caution. Valgus
      // torque — the UCL mechanism itself — is frontal-plane and beyond a
      // side-on camera, which the narrative states.
      knee: { loRisk: 50, loWarn: 70, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 45, loWarn: 65, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: { loRisk: NONE_LO, loWarn: NONE_LO, hiWarn: 174, hiRisk: 179 },
    },
    basis: "Fleisig et al. 1995 (Am J Sports Med) kinetics of baseball pitching",
  },
  "track & field": {
    id: "track & field",
    zones: {
      // Heterogeneous events; running-compatible knee range so sprint swing
      // never false-flags. Hamstring strains — the discipline's top injury —
      // are not an angle statistic.
      knee: { loRisk: 25, loWarn: 35, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 45, loWarn: 65, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis: "Edouard et al. 2015 (Br J Sports Med) championship athletics injury surveillance",
  },
  skiing: {
    id: "skiing",
    zones: {
      // A tuck is deep flexion held on purpose. Skiing straight-legged is a
      // recognised fault pattern and the extended knee features in documented
      // ACL mechanisms, so sustained extension earns a caution.
      knee: { loRisk: 45, loWarn: 60, hiWarn: 175, hiRisk: NONE_HI },
      hip: { loRisk: 30, loWarn: 45, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis:
      "Bere et al. 2011 (Am J Sports Med) ACL mechanisms in World Cup alpine skiing; " +
      "Flørenes et al. 2009 (Br J Sports Med) World Cup injury surveillance",
  },
  climbing: {
    id: "climbing",
    zones: {
      // Straight-arm hanging is taught as the efficient position — flagging it
      // would penalise good technique. High steps and drop knees fold the
      // lower body deeply by design. Fingers, the sport's dominant site, are
      // beyond pose tracking.
      knee: { loRisk: 30, loWarn: 45, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 25, loWarn: 40, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis: "Schöffl et al. 2010 (Wilderness Environ Med) climbing injury risk evaluation",
  },
  dance: {
    id: "dance",
    zones: {
      // Grand plié and extreme hip range are vocabulary, not faults. Lower-
      // extremity overuse dominates the literature; it accumulates over hours
      // of training, which a single clip cannot see — narrative territory.
      knee: { loRisk: 35, loWarn: 50, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 25, loWarn: 40, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis: "Hincapié et al. 2008 (Arch Phys Med Rehabil) dance injury systematic review",
  },
  fencing: {
    id: "fencing",
    zones: {
      // The lunge — deep front knee, extended weapon arm — is the sport's
      // core action. Time-loss injuries are rare and mostly lower-limb
      // strains, so only unusually deep collapse is noted.
      knee: { loRisk: 55, loWarn: 70, hiWarn: NONE_HI, hiRisk: NONE_HI },
      hip: { loRisk: 40, loWarn: 60, hiWarn: NONE_HI, hiRisk: NONE_HI },
      elbow: UNFLAGGED,
    },
    basis: "Harmer 2008 (Clin J Sport Med) five-year US fencing injury surveillance",
  },
};

/**
 * The profile for a sport string as the athlete typed or picked it.
 *
 * Matches through the canonical sport list, so casing and storage format
 * cannot split one sport into two profiles. Unknown sports get the generic
 * profile rather than a guess.
 */
export function profileForSport(sport: string | null | undefined): SportRiskProfile {
  const canonical = canonicalSport(sport);
  if (!canonical) return GENERIC;
  return PROFILES[canonical.toLowerCase()] ?? GENERIC;
}

/** Joint kind ("knee") from a tracker joint key ("leftKnee"). */
export function jointKind(key: string): keyof RiskZones {
  const k = key.toLowerCase();
  if (k.includes("knee")) return "knee";
  if (k.includes("hip")) return "hip";
  return "elbow";
}

/**
 * The safe band implied by a set of zones, for display: `[low, high]`, either
 * end `null` when that side is unflagged. `null` entirely when the joint has
 * no flags at all — an unflagged joint has no band to show.
 */
export function safeBand(zones: JointZones): { low: number | null; high: number | null } | null {
  const low = zones.loWarn >= 0 ? zones.loWarn : null;
  const high = zones.hiWarn <= 360 ? zones.hiWarn : null;
  if (low === null && high === null) return null;
  return { low, high };
}

/** Profiles keyed by sport, for tests and diagnostics. */
export const SPORTS_WITH_PROFILES: readonly string[] = Object.keys(PROFILES);
