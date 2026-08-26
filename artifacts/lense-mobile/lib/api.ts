import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
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

/**
 * Refuse to ship a build that talks to the API over cleartext.
 *
 * Every request carries the bearer token, so a plain-http origin puts the whole
 * session on the wire in the clear. `__DEV__` builds are exempt — localhost and
 * LAN dev servers are http by design — but a release build with an http origin
 * is a misconfiguration that must not reach a user, and failing at startup is
 * the only way to be sure it doesn't.
 */
if (!__DEV__ && API_URL.startsWith("http://")) {
  throw new Error(
    "EXPO_PUBLIC_API_URL must use https in a release build; the bearer token " +
      "would otherwise be sent in cleartext.",
  );
}

const TOKEN_KEY = "auth_token";

/**
 * Session token storage.
 *
 * ── Why not AsyncStorage ────────────────────────────────────────────────────
 * AsyncStorage writes plaintext to the app's sandbox: an unencrypted SQLite
 * file on Android, an unencrypted file on iOS. Anything with filesystem access
 * — a jailbroken or rooted device, an unencrypted local backup, a forensic
 * extraction — can read it. The token here is a 7-day JWT that grants complete
 * access to the account, so that is the whole session sitting in cleartext.
 *
 * SecureStore puts it in the iOS Keychain and, on Android, in a Keystore-backed
 * EncryptedSharedPreferences. `WHEN_UNLOCKED_THIS_DEVICE_ONLY` additionally
 * keeps it out of iCloud Keychain sync and encrypted backups — a session token
 * should not survive onto a different device.
 *
 * ── Web ─────────────────────────────────────────────────────────────────────
 * SecureStore has no web implementation, so web falls back to AsyncStorage
 * (localStorage underneath). That is a real downgrade — XSS on web reads the
 * token — but it is the only option short of moving to httpOnly cookies, which
 * the native app cannot use. Native is the shipping target; web is the dev
 * surface.
 */
const useSecureStore = Platform.OS !== "web";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function getToken(): Promise<string | null> {
  if (!useSecureStore) return AsyncStorage.getItem(TOKEN_KEY);

  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY, SECURE_OPTIONS);
    if (token) return token;

    // One-time migration for sessions written by a build that used
    // AsyncStorage. Move it across, then delete the plaintext copy — leaving it
    // behind would defeat the point of the change.
    const legacy = await AsyncStorage.getItem(TOKEN_KEY);
    if (legacy) {
      await SecureStore.setItemAsync(TOKEN_KEY, legacy, SECURE_OPTIONS);
      await AsyncStorage.removeItem(TOKEN_KEY);
      return legacy;
    }
    return null;
  } catch {
    // A SecureStore failure must read as "not signed in" rather than crash the
    // app on launch. The user signs in again; nothing is lost but convenience.
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  if (!useSecureStore) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token, SECURE_OPTIONS);
}

export async function clearToken(): Promise<void> {
  // Clear both stores unconditionally. Sign-out must not depend on which
  // backend happened to hold the token, or a stale plaintext copy survives.
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  if (useSecureStore) {
    await SecureStore.deleteItemAsync(TOKEN_KEY, SECURE_OPTIONS).catch(() => {});
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    /**
     * The parsed error body.
     *
     * Kept because some failures carry state the caller needs, not just a
     * sentence to show. `POST /api/chat` is the case that forced it: when the
     * coach cannot answer, the server deliberately *keeps* the athlete's
     * message and returns it as `userMessage` so the client can leave it in
     * the transcript instead of re-sending it. Discarding the body meant the
     * app told the athlete "your message wasn't sent" about a message that had
     * been sent and stored.
     */
    public body: Record<string, unknown> = {},
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
    // A gateway or proxy error (502/503 while the API restarts, a captive
    // portal, an HTML error page) has no JSON body, so `body.error` is empty
    // and the athlete used to get the generic "Something went wrong" for what
    // is really a connectivity problem. Say what actually happened.
    const fallback =
      res.status >= 502 && res.status <= 504
        ? "The server is briefly unreachable. Give it a moment and try again."
        : "Something went wrong. Please try again.";
    throw new ApiError(
      (body.error as string) ?? fallback,
      res.status,
      body.code as string | undefined,
      body,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const auth = {
  /** `dateOfBirth` is `YYYY-MM-DD`; the server enforces the minimum age. */
  signup: (email: string, password: string, name: string, dateOfBirth: string) =>
    request<{ token: string; user: { id: string; email: string; name: string } }>(
      "/auth/signup",
      { method: "POST", body: JSON.stringify({ email, password, name, dateOfBirth }) },
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
  /**
   * Present only when the measured movement contradicted the sport picked for
   * this clip. Absent or null means "not assessed" — which covers every clip
   * measured before this check existed, and every clip the coach declined to
   * judge. That is not the same as a verdict that the sport was right.
   */
  sportMismatch?: {
    suggestedSport: string;
    confidence: "medium" | "high";
    message: string;
  } | null;
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
  /**
   * The raw pose measurements the scores were computed from.
   *
   * The client reads the provenance fields ("148 FRAMES MEASURED" next to a
   * reading — what separates an instrument from a scoreboard) and, since the
   * muscle map, the per-joint statistics and band time that tint the body
   * figure. Typed to what is read; the payload carries more.
   *
   * Null for legacy or unscored analyses.
   */
  poseMetrics?: {
    frameCount?: number;
    trackingQuality?: number;
    durationSec?: number;
    /** Server-derived at scoring time; null when the movement didn't repeat. */
    detectedReps?: number | null;
    /** Per-joint angle statistics, keyed leftKnee … rightElbow. */
    joints?: Partial<Record<string, { min: number; max: number; mean: number; stdDev: number }>>;
    /** Frames each joint spent in the caution and risk bands. */
    riskFrames?: Partial<Record<string, { caution: number; risk: number }>>;
  } | null;
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
  /**
   * The caution boundaries this finding was classified against — the sport's
   * safe band, attached by the server from the profile stored with the
   * analysis. `null` on a side that sport leaves unflagged.
   */
  safeMin?: number | null;
  safeMax?: number | null;
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
  /**
   * False when the features behind this plan are not built. Such a plan must
   * never be shown with a working purchase button, regardless of
   * `billingEnabled` — see PLANS in the server's entitlementService.
   */
  available: boolean;
  unavailableReason?: string;
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
