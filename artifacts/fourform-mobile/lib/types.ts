export type Sport =
  | "fencing"
  | "weightlifting"
  | "basketball"
  | "volleyball"
  | "golf"
  | "tennis"
  | "baseball"
  | "soccer"
  | "swimming"
  | "running"
  | "gymnastics"
  | "other";

export type SubscriptionTier = "free" | "pro" | "elite";

export interface JointAngle {
  joint: string;
  angle: number;
  optimal: number;
  status: "good" | "warning" | "danger";
}

export interface PoseKeypoint {
  x: number;
  y: number;
  confidence: number;
  name: string;
}

export interface AnalysisFrame {
  timestamp: number;
  keypoints: PoseKeypoint[];
  jointAngles: JointAngle[];
}

export interface CoachingTip {
  id: string;
  category: "technique" | "injury-risk" | "strength" | "mobility" | "timing";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  drill?: string;
}

export interface PerformanceScores {
  overall: number;
  technique: number;
  power: number;
  balance: number;
  consistency: number;
  mobility: number;
  speed: number;
}

export interface InjuryRisk {
  joint: string;
  risk: number;
  description: string;
  prevention: string;
}

export interface VideoAnalysis {
  id: string;
  title: string;
  sport: Sport;
  uploadedAt: string;
  duration: number;
  thumbnailUrl: string;
  scores: PerformanceScores;
  tips: CoachingTip[];
  injuryRisks: InjuryRisk[];
  frames: AnalysisFrame[];
  comparedTo?: string;
  similarityScore?: number;
  strengths: string[];
  improvements: string[];
}

export interface ProgressEntry {
  date: string;
  scores: PerformanceScores;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt: string | null;
  progress: number;
  total: number;
}

export interface AthleteProfile {
  id: string;
  name: string;
  email: string;
  sport: Sport;
  level: "beginner" | "intermediate" | "advanced" | "elite";
  tier: SubscriptionTier;
  joinedAt: string;
  analyses: VideoAnalysis[];
  progressHistory: ProgressEntry[];
  achievements: Achievement[];
  weeklyGoal: number;
  weeklyProgress: number;
  streakDays: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  referencedAnalysis?: string;
}

export interface ProAthlete {
  id: string;
  name: string;
  sport: Sport;
  specialty: string;
  imageUrl: string;
  keyAttributes: string[];
}
