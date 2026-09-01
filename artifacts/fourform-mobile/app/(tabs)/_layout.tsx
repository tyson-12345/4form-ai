/**
 * Caliper tab bar.
 *
 * A floating ink pill, inset from the screen edges, with the capture action as
 * a cobalt disc at its centre. It sits *over* content rather than docking to the
 * bottom edge — every screen reserves TAB_BAR.clearance at the end of its
 * scroll so nothing is ever trapped underneath.
 *
 * Built as a custom bar rather than styling the default one: the design's
 * inset-pill geometry and centred action disc don't map onto the stock tab bar's
 * full-bleed layout, and fighting it produced a bar that shifted between iOS and
 * Android.
 *
 * ── Why the bar is a material and not a colour ─────────────────────────────
 * It floats over content by design, but it used to be opaque, so content did
 * not pass *under* it — it simply stopped existing at the bar's top edge. A
 * translucent bar says "this is above your work"; an opaque one says "the page
 * ends here", which is a lie about a scroll view that continues behind it.
 *
 * The ink is kept at high opacity over the blur rather than being thinned out.
 * Caliper's bar is ink furniture, not glass, and a bar you can read the page
 * through is a different design. What the blur buys is the inch of content
 * visible at the bar's edge as it scrolls past, which is the part that tells
 * you the page continues.
 *
 * `expo-blur` ships a web implementation (backdrop-filter) and is compiled into
 * the iOS binary, so this is safe on both surfaces — checked, because a
 * decorative `expo-linear-gradient` that was *not* in the binary once took the
 * whole app down on device while rendering fine on web.
 */

import { Redirect, Tabs } from "expo-router";
import React, { useState } from "react";
import { View, StyleSheet, Platform, type LayoutChangeEvent } from "react-native";
import { BlurView } from "expo-blur";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { color, radius, shadow, GUTTER, TAB_BAR } from "@/constants/caliper";
import { TabIcon, PlusGlyph, Tappable } from "@/components/caliper";
import { SETTLE, useMotionEnabled } from "@/lib/motion";
import { useAuth } from "@/lib/authContext";

/**
 * Route name → glyph and spoken label.
 *
 * The label used to be `route.name`, so VoiceOver announced the tabs as
 * "index", "progress", "chat", "profile" — the router's internal names, read
 * aloud to a user. The titles exist on the `<Tabs.Screen>` entries below but a
 * custom `tabBar` never receives them, so they live here instead.
 */
const TABS = {
  index: { glyph: "home", label: "Home" },
  progress: { glyph: "progress", label: "Progress" },
  chat: { glyph: "coach", label: "Coach" },
  profile: { glyph: "profile", label: "Profile" },
} as const;

/** Horizontal padding inside the pill, needed to place the indicator in pixels. */
const BAR_PAD = 8;

/**
 * Minimal shape of what the tab navigator hands a custom `tabBar`.
 *
 * Declared locally rather than importing `BottomTabBarProps`, because
 * `@react-navigation/bottom-tabs` is a transitive dependency of expo-router and
 * isn't in this package's dependency list — importing its types would mean
 * depending on a package we don't declare.
 */
interface TabBarProps {
  state: {
    index: number;
    routes: { key: string; name: string }[];
  };
  navigation: {
    emit(event: {
      type: "tabPress";
      target: string;
      canPreventDefault: true;
    }): { defaultPrevented: boolean };
    navigate(name: string): void;
  };
}

function CaliperTabBar({ state, navigation }: TabBarProps) {
  const motionOn = useMotionEnabled();
  const [barWidth, setBarWidth] = useState(0);

  const slots = state.routes.filter((route) => route.name !== "compare");
  const activeSlot = slots.findIndex(
    (route) => state.routes.findIndex((r) => r.key === route.key) === state.index,
  );

  const slotWidth = barWidth > 0 ? (barWidth - BAR_PAD * 2) / slots.length : 0;
  const indicator = useSharedValue(0);

  React.useEffect(() => {
    if (activeSlot < 0) return;
    indicator.value = motionOn ? withSpring(activeSlot, SETTLE) : activeSlot;
  }, [activeSlot, motionOn, indicator]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: BAR_PAD + indicator.value * slotWidth }],
    width: slotWidth,
  }));

  // The capture slot carries its own cobalt disc; a wash behind it would read
  // as two overlapping selections.
  const captureFocused = slots[activeSlot]?.name === "analyze";

  return (
    <View
      style={[s.bar, { pointerEvents: "box-none" }]}
      accessibilityRole="tablist"
      onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}
    >
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      {/* The ink that makes it Caliper furniture rather than glass. */}
      <View style={[s.barTint, { pointerEvents: "none" }]} />

      {slotWidth > 0 && !captureFocused && (
        <Animated.View style={[s.indicator, indicatorStyle, { pointerEvents: "none" }]} />
      )}

      {slots.map((route) => {
        const index = state.routes.findIndex((r) => r.key === route.key);
        const focused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        if (route.name === "analyze") {
          return (
            <Tappable
              key={route.key}
              onPress={onPress}
              // The measurement is the commit this whole product is built
              // around. It got no acknowledgement of any kind before.
              haptic="commit"
              style={s.slot}
              accessibilityLabel="Measure a new clip"
            >
              <View style={s.action}>
                <PlusGlyph />
              </View>
            </Tappable>
          );
        }

        const tab = TABS[route.name as keyof typeof TABS];
        if (!tab) return null;

        return (
          <Tappable
            key={route.key}
            onPress={onPress}
            haptic={focused ? undefined : "select"}
            style={s.slot}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
          >
            <TabIcon
              name={tab.glyph}
              tone={focused ? color.onInk : color.onInkMuted}
            />
          </Tappable>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  const { isAuthenticated } = useAuth();

  // The whole tab group is signed-in territory. Guarding here rather than in
  // each screen means sign out (or a deep link while signed out) can never
  // strand someone inside the shell — the moment the session clears, this
  // layout re-renders and hands them to the welcome screen.
  if (!isAuthenticated) return <Redirect href="/welcome" />;

  return (
    <Tabs
      tabBar={(props) => <CaliperTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.paper },
        // No animation, deliberately. A fade was tried and reverted: iOS's own
        // UITabBarController does not animate between tabs — switching tabs in
        // Mail or Fitness is an instant cut — so fading content in is less
        // native, not more. It also introduces a failure mode, because a fade
        // that does not finish leaves a whole screen sitting at opacity 0.
        //
        // The motion a tab switch actually wants is on the bar, where the
        // selection indicator slides between slots. That is feedback about the
        // control you touched; animating the content would be decoration.
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="progress" options={{ title: "Progress" }} />
      <Tabs.Screen name="analyze" options={{ title: "Measure" }} />
      <Tabs.Screen name="chat" options={{ title: "Coach" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
      {/* Pro-athlete comparison is Elite-only and not yet built out; keep the
          route reachable by URL but off the bar. */}
      <Tabs.Screen name="compare" options={{ href: null }} />
    </Tabs>
  );
}

const s = StyleSheet.create({
  bar: {
    position: "absolute",
    left: GUTTER,
    right: GUTTER,
    bottom: TAB_BAR.bottomInset,
    height: TAB_BAR.height,
    borderRadius: radius.tabBar,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: BAR_PAD,
    // Clips the blur to the pill. Without it the blur renders as a rectangle
    // behind rounded furniture.
    overflow: "hidden",
    ...(Platform.OS === "web" ? shadow.tabBarWeb : shadow.tabBar),
  },
  /**
   * 0.82, not 1.0. Enough ink that the bar still reads as the app's dark
   * furniture, little enough that content is visibly present behind its edge
   * as it scrolls past.
   */
  barTint: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(16,19,18,0.82)" },
  /** The selected tab's ground. Paper-toned wash, since cobalt is spoken for. */
  indicator: {
    position: "absolute",
    top: 8,
    bottom: 8,
    borderRadius: radius.icon,
    backgroundColor: color.inkWashOnDark,
  },
  slot: { flex: 1, alignItems: "center", justifyContent: "center", height: "100%" },
  action: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: color.cobalt,
    alignItems: "center",
    justifyContent: "center",
  },
});
