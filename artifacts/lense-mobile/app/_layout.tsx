import {
  BricolageGrotesque_500Medium,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/bricolage-grotesque";
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
} from "@expo-google-fonts/instrument-sans";
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/lib/authContext";
import { color } from "@/constants/caliper";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

/**
 * Holds the launch until the app can show a real screen.
 *
 * This used to hide the splash as soon as the fonts resolved and then render a
 * full-screen spinner while the session was restored — so a cold start was
 * splash, hard cut to a lone spinner on paper, hard cut to content. Three
 * states to say one thing.
 *
 * Now the splash stays up until fonts *and* session are both ready, and there
 * is exactly one transition: the system's own splash dismissal, straight onto
 * the first screen. Nothing else is faster than not showing an intermediate
 * state at all.
 *
 * The two waits also overlap now rather than running in series: the provider
 * mounts and starts restoring the session while the fonts are still
 * downloading, because the old `return null` on the whole tree meant nothing
 * below it had mounted to start.
 */
function AuthGate({ children, fontsReady }: { children: React.ReactNode; fontsReady: boolean }) {
  const { isLoading } = useAuth();
  const ready = fontsReady && !isLoading;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.paper },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="onboarding" />
      {/*
        Both of these are reached from the other by `router.replace()`, which
        without this animates as a forward push in both directions — so going
        "back" to sign in slid in from the right exactly as going forward to
        sign up did. `pop` makes the replace read as the reversal it is.
      */}
      <Stack.Screen name="auth/login" options={{ animationTypeForReplace: "pop" }} />
      <Stack.Screen name="auth/signup" options={{ animationTypeForReplace: "pop" }} />
      <Stack.Screen name="auth/forgot-password" options={{ presentation: "modal" }} />
      <Stack.Screen name="auth/reset-password" options={{ presentation: "modal" }} />
      <Stack.Screen name="pricing" options={{ presentation: "modal" }} />
      <Stack.Screen name="(tabs)" />
      {/* Analysis screens carry their own headers so the hero can bleed to the
          top edge — a stack header would cut the film strip in half. */}
      <Stack.Screen name="analysis/[id]" />
      <Stack.Screen name="analysis/measure" options={{ gestureEnabled: false }} />
      <Stack.Screen
        name="analysis/skeleton/[id]"
        options={{ presentation: "fullScreenModal" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_500Medium,
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_800ExtraBold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  // A font CDN failure degrades to system faces rather than hanging on the
  // splash forever, which is why fontError counts as ready.
  const fontsReady = fontsLoaded || !!fontError;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.paper }}>
              {/* Caliper is a single light system — paper is load-bearing, so
                  the status bar is always dark-on-light. */}
              <StatusBar style="dark" />
              <AuthGate fontsReady={fontsReady}>
                <RootLayoutNav />
              </AuthGate>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
