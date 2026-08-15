/**
 * `/` — a dispatcher, not a screen.
 *
 * Routes by auth state and renders nothing itself:
 *
 *   signed in, sport chosen  → the instrument panel `/(tabs)`
 *   signed in, no sport yet  → `/onboarding`
 *   signed out               → `/welcome`
 *
 * Two defects died here:
 *
 * 1. **Sign out looked broken.** The landing screen used to live at `/`,
 *    which `(tabs)/index` also matches. `router.replace("/")` from inside
 *    the tab navigator resolved to the tabs' own index, so signing out
 *    dropped the signed-out user back on Home. `/` is now owned by this one
 *    file and always resolves the same way.
 *
 * 2. **The landing flash on relaunch.** The old landing screen rendered
 *    first and *then* redirected signed-in users from a useEffect, so every
 *    warm start flashed marketing at an authenticated athlete. A Redirect
 *    resolves during render — nothing paints first.
 *
 * `AuthGate` in the root layout holds rendering until the stored session is
 * restored, so `isAuthenticated` is settled by the time this runs.
 */

import { Redirect } from "expo-router";
import { useAuth } from "@/lib/authContext";

export default function Index() {
  const { isAuthenticated, profile } = useAuth();

  if (!isAuthenticated) return <Redirect href="/welcome" />;
  return <Redirect href={profile?.sport ? "/(tabs)" : "/onboarding"} />;
}
