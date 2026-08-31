import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  auth,
  oauth,
  profile as profileApi,
  setToken,
  clearToken,
  getToken,
  ApiError,
  type AuthSuccess,
  type Profile,
  type SubscriptionRecord,
} from "./api";
import { loadAvatar, removeAvatar, saveAvatar } from "./avatarStore";
import { clearOAuth } from "./oauthHandoff";

interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  user: AuthUser | null;
  profile: Profile | null;
  subscription: SubscriptionRecord | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Device-local profile photo URI, or null. Never leaves the device. */
  avatarUri: string | null;
}

interface AuthActions {
  login: (email: string, password: string) => Promise<void>;
  /** `dateOfBirth` is `YYYY-MM-DD`; the server enforces the minimum age. */
  signup: (email: string, password: string, name: string, dateOfBirth: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Take up a session the server has already issued.
   *
   * The federated flows finish in three different places — signed straight in,
   * after a birth date, after a password proof — and every one of them ends
   * with the same token and the same need to load the profile behind it. This
   * is that shared tail, exposed so a screen that holds a fresh `AuthSuccess`
   * does not have to reimplement it.
   */
  adoptSession: (result: AuthSuccess) => Promise<void>;
  /** Redeem a registration token together with the birth date the provider withheld. */
  completeOAuthSignup: (registration: string, dateOfBirth: string, name: string) => Promise<void>;
  /** Redeem a link challenge with the existing account's password. */
  linkOAuthIdentity: (challenge: string, password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: Partial<Omit<Profile, "id" | "userId">>) => Promise<void>;
  /** Persist a picked photo (base64 required on web) and update every screen. */
  setAvatarPhoto: (pickedUri: string, base64?: string | null) => Promise<void>;
  removeAvatarPhoto: () => Promise<void>;
}

const AuthContext = createContext<AuthState & AuthActions>({
  user: null,
  profile: null,
  subscription: null,
  isLoading: true,
  isAuthenticated: false,
  avatarUri: null,
  login: async () => {},
  signup: async () => {},
  logout: async () => {},
  adoptSession: async () => {},
  completeOAuthSignup: async () => {},
  linkOAuthIdentity: async () => {},
  refreshProfile: async () => {},
  updateProfile: async () => {},
  setAvatarPhoto: async () => {},
  removeAvatarPhoto: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userProfile, setUserProfile] = useState<Profile | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  // Tracks whether a saved token exists — stays true even when the server is
  // unreachable, so navigation isn't blocked while offline/server is down.
  const [hasStoredToken, setHasStoredToken] = useState(false);

  useEffect(() => {
    restoreSession();
  }, []);

  // The photo is device-local state keyed by user id, so it follows the
  // signed-in user rather than the session: load on sign-in, drop on
  // sign-out, and never show one account's photo to another.
  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setAvatarUri(null);
      return;
    }
    loadAvatar(user.id)
      .then((uri) => {
        if (!cancelled) setAvatarUri(uri);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  async function restoreSession() {
    try {
      const token = await getToken();
      if (!token) return;
      setHasStoredToken(true);
      const { user: u, profile: p, subscription: s } = await auth.me();
      setUser({ id: u.id, email: u.email, name: p?.name ?? "" });
      setUserProfile(p);
      setSubscription(s);
    } catch (err) {
      // Only log out the user when the server explicitly rejects the token.
      // Network errors (server down, no internet) leave the session intact.
      if (err instanceof ApiError && err.status === 401) {
        await clearToken();
        setHasStoredToken(false);
      }
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Store the token, then load the profile behind it.
   *
   * The order matters: `profileApi.get()` is an authenticated call, so the
   * token has to be persisted before it runs, not after.
   */
  async function adoptSession(result: AuthSuccess) {
    await setToken(result.token);
    setHasStoredToken(true);
    const { profile: p, subscription: s } = await profileApi.get();
    setUser({ id: result.user.id, email: result.user.email, name: p?.name ?? result.user.name ?? "" });
    setUserProfile(p);
    setSubscription(s);
  }

  async function login(email: string, password: string) {
    await adoptSession(await auth.login(email, password));
  }

  async function completeOAuthSignup(registration: string, dateOfBirth: string, name: string) {
    await adoptSession(await oauth.complete(registration, dateOfBirth, name));
  }

  async function linkOAuthIdentity(challenge: string, password: string) {
    await adoptSession(await oauth.link(challenge, password));
  }

  async function signup(email: string, password: string, name: string, dateOfBirth: string) {
    const { token, user: u } = await auth.signup(email, password, name, dateOfBirth);
    await setToken(token);
    setHasStoredToken(true);
    const { profile: p, subscription: s } = await profileApi.get();
    setUser({ ...u, name });
    setUserProfile(p);
    setSubscription(s);
  }

  async function logout() {
    // Drop any half-finished federated flow. Its token is single-use and tied
    // to the session being ended; leaving it would offer the next person at
    // this device a link challenge for the account that just signed out.
    clearOAuth();
    await clearToken();
    setHasStoredToken(false);
    setUser(null);
    setUserProfile(null);
    setSubscription(null);
  }

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const { profile: p, subscription: s } = await profileApi.get();
    setUserProfile(p);
    setSubscription(s);
  }, [user]);

  const updateProfile = useCallback(
    async (data: Partial<Omit<Profile, "id" | "userId">>) => {
      const { profile: p } = await profileApi.update(data);
      setUserProfile(p);
      if (data.name && user) setUser((prev) => prev ? { ...prev, name: data.name! } : prev);
    },
    [user]
  );

  const setAvatarPhoto = useCallback(
    async (pickedUri: string, base64?: string | null) => {
      if (!user) return;
      const durable = await saveAvatar(user.id, pickedUri, base64);
      setAvatarUri(durable);
    },
    [user],
  );

  const removeAvatarPhoto = useCallback(async () => {
    if (!user) return;
    await removeAvatar(user.id);
    setAvatarUri(null);
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile: userProfile,
        subscription,
        isLoading,
        isAuthenticated: !!user || hasStoredToken,
        avatarUri,
        login,
        signup,
        logout,
        adoptSession,
        completeOAuthSignup,
        linkOAuthIdentity,
        refreshProfile,
        updateProfile,
        setAvatarPhoto,
        removeAvatarPhoto,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useTier() {
  const { subscription } = useAuth();
  return subscription?.tier ?? "free";
}

export function useCanAccessFeature(feature: "aiChat" | "proComparisons" | "unlimitedAnalyses") {
  const tier = useTier();
  if (feature === "aiChat") return tier === "pro" || tier === "elite";
  if (feature === "proComparisons") return tier === "elite";
  if (feature === "unlimitedAnalyses") return tier === "pro" || tier === "elite";
  return false;
}
