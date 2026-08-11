import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PoseMetrics } from "./poseTracker";

/**
 * Where the API lives, resolved per platform.
 *
 * ── Why this is not just an env var ─────────────────────────────────────────
 * Requests must go through the proxy's `/api` path on the standard HTTPS port,
 * not to a non-standard port like `:8080` directly. Many cellular and
 * corporate networks silently block non-standard ports, which surfaces as a
 * request that hangs for the full timeout and then aborts — an "Aborted" error
 * with nothing useful in it, on the signup screen, only for some users, only
 * on some networks.
 *
 * Adopted from Oscar's fork, which diagnosed and fixed this. It is the single
 * clearest piece of field debugging in either codebase.
 */
function resolveApiUrl(): string {
  // Explicit configuration always wins. Set at dev-server startup to the
  // tunnel/proxy origin; in production, to the API's public origin.
  if (process.env.EXPO_PUBLIC_API_URL) {
    return `${process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, "")}/api`;
  }

  // On web with no override, use the page's own origin — same-origin, standard
  // port, and no CORS preflight.
  if (typeof window !== "undefined" && window.location) {
    const { protocol, hostname, port } = window.location;
    // Keep an explicit port when the page itself is served from one, otherwise
    // a dev server on :19006 would resolve to the wrong origin.
    const authority = port ? `${hostname}:${port}` : hostname;
    return `${protocol}//${authority}/api`;
  }

  // Native, unconfigured. Only reachable from a simulator on the same host —
  // a physical device needs EXPO_PUBLIC_API_URL set.
  return "http://localhost:3001/api";
}

const API_URL = resolveApiUrl();

const TOKEN_KEY = "auth_token";

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown when the request never reached the server (offline, DNS, timeout). */
export class NetworkError extends Error {
  constructor(message = "Can't reach the server. Check your connection.") {
    super(message);
    this.name = "NetworkError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 15000,
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers, signal: controller.signal });
  } catch (err) {
    // Distinguish "server said no" from "never got there" — the UI treats them
    // very differently (retry vs. sign out).
    if (err instanceof Error && err.name === "AbortError") {
      throw new NetworkError("That took too long. Please try again.");
    }
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    throw new ApiError(
      (body.error as string) ?? "Something went wrong. Please try again.",
      res.status,
      body.code as string | undefined,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const auth = {
  signup: (email: string, password: string, name: string) =>
    request<{ token: string; user: { id: string; email: string; name: string } }>(
      "/auth/signup",
      { method: "POST", body: JSON.stringify({ email, password, name }) },
    ),

  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string; name: string } }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    ),

  me: () =>
    request<{
      user: { id: string; email: string };
      profile: Profile | null;
      subscription: SubscriptionRecord | null;
    }>("/auth/me"),

  forgotPassword: (email: string) =>
    request<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    request<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),
};

// ─── Profile ─────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  userId: string;
  name: string;
  sport: string;
  level: "beginner" | "intermediate" | "advanced" | "elite";
  goals: string[];
  injuryConcerns: string[];
  weeklyGoal: number;
  weeklyProgress: number;
  streakDays: number;
}

export interface SubscriptionRecord {
  id: string;
  userId: string;
  tier: "free" | "pro" | "elite";
  status: string;
  currentPeriodEnd?: string;
}

export const profile = {
  get: () => request<{ profile: Profile; subscription: SubscriptionRecord }>("/profile"),

  update: (data: Partial<Omit<Profile, "id" | "userId">>) =>
    request<{ profile: Profile }>("/profile", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  /**
   * Permanently delete the account and all server-side data.
   *
   * Requires the current password — a stolen unlocked phone must not be able to
   * erase someone's history. Irreversible.
   */
  deleteAccount: (password: string) =>
    request<{ deleted: boolean }>("/profile/account", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    }),
};

// ─── Analyses ────────────────────────────────────────────────────────────────

/**
 * How an analysis's numbers were produced.
 *
 * - `pose-measured`      scores computed from measured joint angles
 * - `unscored`           the clip couldn't be tracked; no scores exist
 * - `legacy-unverified`  created before measurement existed — scores were
 *                        generated text, not measurements, and the UI labels
 *                        them as such rather than presenting them as data
 */
export type AnalysisMethod = "pose-measured" | "unscored" | "legacy-unverified";

export interface AnalysisRecord {
  id: string;
  userId: string;
  title: string;
  sport: string;
  status: "pending" | "processing" | "complete" | "failed";
  analysisMethod: AnalysisMethod;
  videoUrl?: string;
  duration?: number;
  /** `null` means "not measured" — never render a null score as 0. */
  overallScore: number | null;
  techniqueScore: number | null;
  powerScore: number | null;
  balanceScore: number | null;
  consistencyScore: number | null;
  mobilityScore: number | null;
  speedScore: number | null;
  strengths: string[];
  improvements: string[];
  summary?: string | null;
  uploadedAt: string;
}

export interface TipRecord {
  id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  drill?: string;
}

export interface RiskRecord {
  id: string;
  joint: string;
  /** Share of tracked frames in the risk band — a measurement, not a forecast. */
  riskPercent: number;
  cautionPercent?: number | null;
  observedMin?: number | null;
  observedMax?: number | null;
  description: string;
  prevention: string;
}

export interface UsageRecord {
  tier: "free" | "pro" | "elite";
  /** `-1` means unlimited. */
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
}

export const analyses = {
  list: () => request<{ analyses: AnalysisRecord[] }>("/analyses"),

  usage: () => request<UsageRecord>("/analyses/usage"),

  create: (data: {
    title: string;
    sport: string;
    videoUrl?: string;
    duration?: number;
    poseMetrics?: PoseMetrics;
  }) =>
    request<{ analysis: AnalysisRecord }>(
      "/analyses",
      { method: "POST", body: JSON.stringify(data) },
      30000,
    ),

  get: (id: string) =>
    request<{ analysis: AnalysisRecord; tips: TipRecord[]; injuryRisks: RiskRecord[] }>(
      `/analyses/${id}`,
    ),

  delete: (id: string) => request<{ success: boolean }>(`/analyses/${id}`, { method: "DELETE" }),
};

// ─── Chat ────────────────────────────────────────────────────────────────────

export interface ChatRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  referencedAnalysisId?: string;
  createdAt: string;
}

export const chat = {
  history: () => request<{ messages: ChatRecord[] }>("/chat"),

  send: (content: string, referencedAnalysisId?: string) =>
    request<{ userMessage: ChatRecord; assistantMessage: ChatRecord }>(
      "/chat",
      { method: "POST", body: JSON.stringify({ content, referencedAnalysisId }) },
      45000, // coach replies involve model inference
    ),

  clear: () => request<{ success: boolean }>("/chat", { method: "DELETE" }),
};

// ─── Progress ────────────────────────────────────────────────────────────────

export interface ProgressRecord {
  id: string;
  date: string;
  overallScore: number;
  techniqueScore: number | null;
  powerScore: number | null;
  balanceScore: number | null;
  consistencyScore: number | null;
  mobilityScore: number | null;
  speedScore: number | null;
}

export const progress = {
  list: () => request<{ entries: ProgressRecord[] }>("/progress"),
};

// ─── Achievements ────────────────────────────────────────────────────────────

export interface AchievementRecord {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: number;
  total: number;
  unlocked: boolean;
  unlockedAt?: string;
}

export const achievements = {
  list: () => request<{ achievements: AchievementRecord[] }>("/achievements"),
};

// ─── Subscriptions ───────────────────────────────────────────────────────────

export interface Plan {
  id: "free" | "pro" | "elite";
  name: string;
  price: number;
  period: string | null;
  description: string;
  popular?: boolean;
  features: string[];
  limits: {
    analysesPerMonth: number;
    aiChat: boolean;
    proComparisons: boolean;
    priorityProcessing: boolean;
  };
}

export const subscriptions = {
  /**
   * `billingEnabled` reports whether in-app purchases actually work. When it is
   * false the pricing screen must not present a working buy button — tapping it
   * previously granted a paid tier with no payment taken.
   */
  plans: () => request<{ plans: Plan[]; billingEnabled: boolean }>("/subscriptions/plans"),

  current: () =>
    request<{ subscription: SubscriptionRecord | null; plan: Plan }>("/subscriptions/current"),

  /** Self-service downgrade to Free. */
  cancel: () =>
    request<{ subscription: SubscriptionRecord }>("/subscriptions/cancel", { method: "POST" }),

  /** Submit a store receipt for server-side verification. */
  verifyPurchase: (receipt: string, platform: "ios" | "android") =>
    request<{ subscription: SubscriptionRecord }>("/subscriptions/verify-purchase", {
      method: "POST",
      body: JSON.stringify({ receipt, platform }),
    }),

  /** Dev builds only; the server returns 404 unless explicitly enabled. */
  devSetTier: (tier: "free" | "pro" | "elite") =>
    request<{ subscription: SubscriptionRecord }>("/subscriptions/dev-set-tier", {
      method: "POST",
      body: JSON.stringify({ tier }),
    }),
};
