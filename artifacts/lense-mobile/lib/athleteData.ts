import type {
  AthleteProfile,
  VideoAnalysis,
  ProgressEntry,
  Achievement,
  ProAthlete,
  ChatMessage,
} from "./types";

export const MOCK_ANALYSES: VideoAnalysis[] = [
  {
    id: "an-001",
    title: "Deadlift — 180kg",
    sport: "weightlifting",
    uploadedAt: "2026-05-28T14:30:00Z",
    duration: 12,
    thumbnailUrl: "",
    scores: {
      overall: 78,
      technique: 72,
      power: 91,
      balance: 68,
      consistency: 74,
      mobility: 65,
      speed: 82,
    },
    strengths: [
      "Excellent hip hinge mechanics at lockout",
      "Strong lat engagement throughout the lift",
      "Consistent bar path — minimal horizontal deviation",
    ],
    improvements: [
      "Hips rise too fast off the floor — creates early back rounding",
      "Ankle dorsiflexion limited — affecting initial pull position",
      "Breath timing inconsistent — brace earlier",
    ],
    tips: [
      {
        id: "t1",
        category: "technique",
        severity: "warning",
        title: "Hip Rise Timing",
        description:
          "Your hips are rising faster than your shoulders off the floor. This shifts load onto your lower back and increases spinal shear forces.",
        drill:
          "Pause deadlift: 3 sets × 3 reps with 2-second pause at knee level. Focus on maintaining hip height relative to shoulders.",
      },
      {
        id: "t2",
        category: "injury-risk",
        severity: "warning",
        title: "Lumbar Flexion Under Load",
        description:
          "Detected ~18° of lumbar flexion at heaviest loads. Optimal is under 10°. Continued progression at this pattern elevates disc herniation risk.",
        drill: "Romanian deadlifts 3×8 at 60% to reinforce neutral spine mechanics before increasing load.",
      },
      {
        id: "t3",
        category: "mobility",
        severity: "info",
        title: "Ankle Dorsiflexion",
        description: "Limited ankle mobility is causing forward knee cave at the start. Improve to allow deeper initial position.",
        drill: "90-second wall ankle stretches daily. Banded ankle mobilization before training.",
      },
      {
        id: "t4",
        category: "strength",
        severity: "info",
        title: "Strong Posterior Chain",
        description: "Glute and hamstring activation metrics are excellent. Your lockout is clean and powerful.",
      },
    ],
    injuryRisks: [
      { joint: "Lumbar Spine", risk: 62, description: "Flexion under load detected", prevention: "Reduce load 10%, focus on bracing protocol" },
      { joint: "Left Knee", risk: 28, description: "Slight valgus at pull initiation", prevention: "Glute activation drills pre-workout" },
      { joint: "Right Wrist", risk: 15, description: "Minor hyperextension in hook grip", prevention: "Wrist wraps for max efforts" },
    ],
    frames: [],
  },
  {
    id: "an-002",
    title: "Basketball — Jump Shot",
    sport: "basketball",
    uploadedAt: "2026-05-25T10:15:00Z",
    duration: 8,
    thumbnailUrl: "",
    scores: {
      overall: 84,
      technique: 88,
      power: 79,
      balance: 91,
      consistency: 82,
      mobility: 86,
      speed: 77,
    },
    strengths: [
      "Perfect elbow alignment under the ball",
      "Follow-through wrist snap is textbook",
      "Consistent release point across all 5 attempts",
    ],
    improvements: [
      "Jump is slightly biased left — causes off-center landing",
      "Guide hand leaves ball 0.15s too early in arc",
      "Hip rotation slightly ahead of shoulder rotation",
    ],
    tips: [
      {
        id: "t5",
        category: "technique",
        severity: "info",
        title: "Jump Alignment",
        description: "You're jumping 8° left of center. This affects balance on landing and can decrease accuracy on contested shots.",
        drill: "Shoot 50 shots with alignment tape on floor. Focus on straight vertical jump.",
      },
      {
        id: "t6",
        category: "technique",
        severity: "warning",
        title: "Guide Hand Release",
        description: "Guide hand is releasing too early, slightly affecting ball spin axis.",
        drill: "One-hand form shooting at 5 feet daily — 100 reps. Build muscle memory for the shooting hand.",
      },
    ],
    injuryRisks: [
      { joint: "Left Ankle", risk: 22, description: "Off-center landing pattern", prevention: "Balance board training, single-leg landing drills" },
      { joint: "Right Shoulder", risk: 18, description: "Minor impingement position at release peak", prevention: "Rotator cuff strengthening 3×/week" },
    ],
    frames: [],
  },
  {
    id: "an-003",
    title: "Sprint Start — 40m",
    sport: "running",
    uploadedAt: "2026-05-20T08:00:00Z",
    duration: 6,
    thumbnailUrl: "",
    scores: {
      overall: 71,
      technique: 68,
      power: 85,
      balance: 74,
      consistency: 66,
      mobility: 72,
      speed: 88,
    },
    strengths: [
      "Explosive first-step power — top 15% for your weight class",
      "Arm drive is strong and symmetrical",
    ],
    improvements: [
      "Forward lean angle is 5° less than optimal at drive phase",
      "Left leg stride length 4% shorter than right — asymmetry detected",
      "Head position too high at start — increases air resistance",
    ],
    tips: [
      {
        id: "t7",
        category: "technique",
        severity: "warning",
        title: "Drive Phase Lean",
        description: "Your body angle at 10m is 78° when optimal is 72-74°. You're transitioning to upright running too early, losing acceleration.",
        drill: "Wall drives: lean against wall at 45° and practice high-knee drive for 3 × 30 seconds.",
      },
      {
        id: "t8",
        category: "technique",
        severity: "warning",
        title: "Stride Asymmetry",
        description: "Left stride is consistently shorter. Often caused by hip flexor tightness or weak left glute.",
        drill: "Single-leg bounding drills. Hip flexor stretching routine after every session.",
      },
    ],
    injuryRisks: [
      { joint: "Left Hip Flexor", risk: 45, description: "Asymmetric loading pattern", prevention: "Hip flexor mobility work, strengthen left glute" },
      { joint: "Achilles (both)", risk: 30, description: "High sprint volume without adequate base", prevention: "Eccentric heel drops 3×15 daily" },
    ],
    frames: [],
    comparedTo: "Usain Bolt Sprint Mechanics",
    similarityScore: 63,
  },
  {
    id: "an-004",
    title: "Golf Swing — Driver",
    sport: "golf",
    uploadedAt: "2026-05-15T16:45:00Z",
    duration: 4,
    thumbnailUrl: "",
    scores: {
      overall: 69,
      technique: 65,
      power: 78,
      balance: 71,
      consistency: 64,
      mobility: 70,
      speed: 75,
    },
    strengths: [
      "Club head speed is above average — strong hip rotation",
      "Address position and stance width are solid",
    ],
    improvements: [
      "Early extension in downswing — hips thrusting toward ball",
      "Casting the club — losing wrist lag 30° early",
      "Reverse pivot — weight not fully loading to trail side on backswing",
    ],
    tips: [
      {
        id: "t9",
        category: "technique",
        severity: "critical",
        title: "Early Extension",
        description: "Your hips are thrusting toward the ball during the downswing, causing you to lose your spine angle. This is the #1 cause of thin shots and power loss.",
        drill: "Swing with your back against a wall. If your hips touch the wall during downswing, you're early extending. Perform 50 slow-motion swings daily.",
      },
      {
        id: "t10",
        category: "technique",
        severity: "warning",
        title: "Wrist Lag",
        description: "You're releasing the angle between your lead arm and the club too early (casting). This costs significant club head speed.",
        drill: "Slow-motion swings focusing on maintaining wrist angle to impact. Use a tour striker impact bag.",
      },
    ],
    injuryRisks: [
      { joint: "Lower Back", risk: 55, description: "Spine angle loss under rotational load", prevention: "Core anti-rotation exercises, reduce round frequency" },
      { joint: "Lead Elbow", risk: 35, description: "Early release creates hyperextension stress", prevention: "Golfer's elbow prevention routine" },
    ],
    frames: [],
  },
];

export const MOCK_PROGRESS: ProgressEntry[] = [
  { date: "2026-01-15", scores: { overall: 58, technique: 52, power: 70, balance: 55, consistency: 48, mobility: 60, speed: 65 } },
  { date: "2026-02-01", scores: { overall: 61, technique: 56, power: 73, balance: 58, consistency: 54, mobility: 62, speed: 67 } },
  { date: "2026-02-15", scores: { overall: 64, technique: 60, power: 75, balance: 62, consistency: 58, mobility: 64, speed: 70 } },
  { date: "2026-03-01", scores: { overall: 67, technique: 63, power: 78, balance: 65, consistency: 62, mobility: 67, speed: 74 } },
  { date: "2026-03-15", scores: { overall: 70, technique: 66, power: 80, balance: 68, consistency: 65, mobility: 69, speed: 76 } },
  { date: "2026-04-01", scores: { overall: 72, technique: 68, power: 83, balance: 71, consistency: 68, mobility: 70, speed: 79 } },
  { date: "2026-04-15", scores: { overall: 74, technique: 70, power: 85, balance: 72, consistency: 70, mobility: 72, speed: 81 } },
  { date: "2026-05-01", scores: { overall: 76, technique: 74, power: 87, balance: 75, consistency: 73, mobility: 74, speed: 83 } },
  { date: "2026-05-15", scores: { overall: 78, technique: 76, power: 88, balance: 77, consistency: 75, mobility: 76, speed: 85 } },
  { date: "2026-06-01", scores: { overall: 81, technique: 79, power: 91, balance: 80, consistency: 78, mobility: 78, speed: 87 } },
];

export const MOCK_ACHIEVEMENTS: Achievement[] = [
  { id: "ach-1", title: "First Analysis", description: "Upload and analyze your first video", icon: "🎬", unlockedAt: "2026-01-15", progress: 1, total: 1 },
  { id: "ach-2", title: "Consistency King", description: "Maintain a 7-day training streak", icon: "🔥", unlockedAt: "2026-02-10", progress: 7, total: 7 },
  { id: "ach-3", title: "Power House", description: "Score 90+ on Power", icon: "⚡", unlockedAt: "2026-05-28", progress: 91, total: 90 },
  { id: "ach-4", title: "10 Analyses", description: "Complete 10 video analyses", icon: "📊", unlockedAt: "2026-04-20", progress: 10, total: 10 },
  { id: "ach-5", title: "Technique Master", description: "Score 80+ on Technique", icon: "🎯", unlockedAt: null, progress: 79, total: 80 },
  { id: "ach-6", title: "30-Day Streak", description: "Train 30 consecutive days", icon: "🏆", unlockedAt: null, progress: 14, total: 30 },
  { id: "ach-7", title: "Pro Comparison", description: "Complete your first pro athlete comparison", icon: "🌟", unlockedAt: "2026-05-20", progress: 1, total: 1 },
  { id: "ach-8", title: "Multi-Sport", description: "Analyze 3 different sports", icon: "🏅", unlockedAt: "2026-04-15", progress: 3, total: 3 },
];

export const MOCK_ATHLETE: AthleteProfile = {
  id: "athlete-001",
  name: "Alex Rivera",
  email: "alex@example.com",
  sport: "weightlifting",
  level: "advanced",
  tier: "pro",
  joinedAt: "2026-01-10",
  analyses: MOCK_ANALYSES,
  progressHistory: MOCK_PROGRESS,
  achievements: MOCK_ACHIEVEMENTS,
  weeklyGoal: 4,
  weeklyProgress: 3,
  streakDays: 14,
};

/**
 * Reference technique models — the movement patterns a comparison would be
 * measured against.
 *
 * ── Why there are no real athletes here ─────────────────────────────────────
 * This list previously named six real, living professional athletes (a golfer,
 * a basketball player, a fencer, a tennis player, a gymnast, and a sprinter)
 * and displayed a "similarity" percentage against them. Removed on 2026-08-12
 * for two independent reasons, either of which is disqualifying:
 *
 *  1. **Right of publicity / NIL.** Using a living person's name to promote or
 *     sell a product requires a license. This was attached to a $24.99/month
 *     tier, which is squarely commercial use and forecloses most defences.
 *  2. **False endorsement** (Lanham Act §43(a)). Presenting a named athlete as
 *     a feature implies they are associated with the app. They are not.
 *
 * Named athletes may only return here under a signed licence. Describing the
 * *technique* is not restricted — an anonymous "tour-level driver swing" makes
 * the same coaching point and carries no exposure, which is what these are.
 */
export const PRO_ATHLETES: ProAthlete[] = [
  { id: "ref-golf-drive", name: "Tour-level driver swing", sport: "golf", specialty: "Driver Swing", imageUrl: "", keyAttributes: ["Club head speed", "Hip rotation", "Lag maintenance", "Follow-through"] },
  { id: "ref-bball-jumper", name: "Elite jump shot", sport: "basketball", specialty: "Jump Shot", imageUrl: "", keyAttributes: ["Release point", "Wrist snap", "Balance", "Arc consistency"] },
  { id: "ref-fencing-fleche", name: "International fleche attack", sport: "fencing", specialty: "Fleche Attack", imageUrl: "", keyAttributes: ["Explosive lunge", "Blade control", "Footwork speed", "Recovery"] },
  { id: "ref-tennis-groundstroke", name: "Tour-level groundstroke", sport: "tennis", specialty: "Baseline Groundstroke", imageUrl: "", keyAttributes: ["Topspin rotation", "Footwork", "Recovery position", "Follow-through"] },
  { id: "ref-gym-tumbling", name: "Elite floor tumbling pass", sport: "gymnastics", specialty: "Floor Tumbling", imageUrl: "", keyAttributes: ["Air awareness", "Rotation speed", "Stick landing", "Body position"] },
  { id: "ref-sprint-mechanics", name: "World-class sprint mechanics", sport: "running", specialty: "Sprint Mechanics", imageUrl: "", keyAttributes: ["Stride length", "Ground contact", "Arm drive", "Lean angle"] },
];

export const MOCK_CHAT: ChatMessage[] = [
  {
    id: "msg-1",
    role: "assistant",
    content: "Hey Alex! I've reviewed your last 4 analyses. Your power output has improved significantly (+18% over 5 months) — great work on that. Your biggest opportunity right now is technique refinement, particularly your hip mechanics in the deadlift. Want me to walk you through a specific drill protocol?",
    timestamp: "2026-06-01T09:00:00Z",
  },
  {
    id: "msg-2",
    role: "user",
    content: "Yeah, my lower back has been feeling tight after heavy sessions. Is my form causing that?",
    timestamp: "2026-06-01T09:01:00Z",
  },
  {
    id: "msg-3",
    role: "assistant",
    content: "Most likely yes. Looking at your deadlift analysis (an-001), I detected 18° of lumbar flexion under load — anything over 10° consistently creates disc compression stress over time.\n\nHere's what I recommend:\n\nImmediate (this week):\n• Drop load by 10-15% and focus on bracing protocol\n• Spend 10 min on McGill Big 3 before every session\n\nNext 2-4 weeks:\n• Romanian deadlifts 3×8 at 60% of your 1RM\n• Hip hinge with dowel on spine\n\nUpload a new video in 3 weeks. I'll compare the lumbar angle directly against today's baseline.",
    timestamp: "2026-06-01T09:01:30Z",
    referencedAnalysis: "an-001",
  },
  {
    id: "msg-4",
    role: "user",
    content: "How does my basketball form compare to Curry's?",
    timestamp: "2026-06-01T09:03:00Z",
  },
  {
    id: "msg-5",
    role: "assistant",
    content: "Based on your jump shot analysis, you're actually closer than you might think!\n\nSimilarities with Curry:\n✓ Elbow alignment — nearly identical\n✓ Release height — both at peak jump\n✓ Follow-through wrist snap within 5°\n\nKey differences:\n✗ Jump drifts 8° left (Curry: near-perfect vertical)\n✗ Guide hand releases 0.15s too early\n✗ Hip-shoulder separation timing off by ~45ms\n\nOverall similarity: 71% — which is quite high. Address the jump alignment and you could push this to 78%+.",
    timestamp: "2026-06-01T09:03:45Z",
    referencedAnalysis: "an-002",
  },
];
