import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { auth, profile as profileApi, setToken, clearToken, getToken, ApiError, type Profile, type SubscriptionRecord } from "./api";

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
}

interface AuthActions {
  login: (email: string, password: string) => Promise<void>;
  /** `dateOfBirth` is `YYYY-MM-DD`; the server enforces the minimum age. */
  signup: (email: string, password: string, name: string, dateOfBirth: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: Partial<Omit<Profile, "id" | "userId">>) => Promise<void>;
}

const AuthContext = createContext<AuthState & AuthActions>({
  user: null,
  profile: null,
  subscription: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  signup: async () => {},
  logout: async () => {},
  refreshProfile: async () => {},
  updateProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userProfile, setUserProfile] = useState<Profile | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Tracks whether a saved token exists — stays true even when the server is
  // unreachable, so navigation isn't blocked while offline/server is down.
  const [hasStoredToken, setHasStoredToken] = useState(false);

  useEffect(() => {
    restoreSession();
  }, []);

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

  async function login(email: string, password: string) {
    const { token, user: u } = await auth.login(email, password);
    await setToken(token);
    setHasStoredToken(true);
    const { profile: p, subscription: s } = await profileApi.get();
    setUser(u);
    setUserProfile(p);
    setSubscription(s);
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

  return (
    <AuthContext.Provider
      value={{
        user,
        profile: userProfile,
        subscription,
        isLoading,
        isAuthenticated: !!user || hasStoredToken,
        login,
        signup,
        logout,
        refreshProfile,
        updateProfile,
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
