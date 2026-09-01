/**
 * The screen behind a link that goes nowhere.
 *
 * Rewritten from the Expo template's unstyled version, which used raw
 * `fontSize: 20, fontWeight: "bold"` and the legacy `useColors` shim, so a bad
 * deep link dropped the athlete onto a screen that plainly belonged to a
 * different app. It is rare, but it is the first thing someone sees when a
 * shared link is wrong, and it should look like the rest of the product.
 */

import React from "react";
import {
  View,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AppMark,
  Label,
  PrimaryButton,
  Screen,
  Text,
} from "@/components/caliper";
import { type as T, GUTTER } from "@/constants/caliper";

export default function NotFoundScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <Screen>
      <View style={[s.wrap, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 32 }]}>
        <View style={s.mark}>
          <AppMark size={34} />
          <Label>4FORM AI</Label>
        </View>

        <Text scale="display" style={[T.headline, { marginTop: 28 }]}>
          There&apos;s nothing{"\n"}at this address.
        </Text>
        <Text style={[T.body, { marginTop: 12, maxWidth: 300 }]}>
          The link you followed points at a screen that doesn&apos;t exist. Your sessions and
          measurements are unaffected.
        </Text>

        <View style={{ flex: 1, minHeight: 24 }} />

        <PrimaryButton label="Go to Home" onPress={() => router.replace("/")} trailingArrow />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: GUTTER },
  mark: { flexDirection: "row", alignItems: "center", gap: 10 },
});
