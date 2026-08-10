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
 */

import { Tabs } from "expo-router";
import React from "react";
import { View, Pressable, StyleSheet } from "react-native";

import { color, radius, shadow, GUTTER, TAB_BAR } from "@/constants/caliper";
import { TabIcon, PlusGlyph } from "@/components/caliper";

/** Route name → glyph. `analyze` is the centre action and is handled separately. */
const GLYPH = {
  index: "home",
  progress: "progress",
  chat: "coach",
  profile: "profile",
} as const;

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
  return (
    <View style={s.bar} pointerEvents="box-none">
      {state.routes
        .filter((route) => route.name !== "compare")
        .map((route) => {
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
              <Pressable
                key={route.key}
                onPress={onPress}
                style={s.slot}
                accessibilityRole="button"
                accessibilityLabel="Measure a new clip"
              >
                <View style={s.action}>
                  <PlusGlyph />
                </View>
              </Pressable>
            );
          }

          const glyph = GLYPH[route.name as keyof typeof GLYPH];
          if (!glyph) return null;

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={s.slot}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={route.name}
            >
              <TabIcon
                name={glyph}
                tone={focused ? color.onInk : color.onInkMuted}
              />
            </Pressable>
          );
        })}
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CaliperTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.paper },
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
    backgroundColor: color.ink,
    borderRadius: radius.tabBar,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    ...shadow.tabBar,
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
