/**
 * What the athlete sees when the app has crashed.
 *
 * ── Why this was rewritten ──────────────────────────────────────────────────
 * This was the Expo template's fallback, styled with raw `fontSize`/`fontWeight`
 * values and the legacy `useColors` shim: a bold 28pt system-font heading, a
 * shadowed rounded-rect button, nothing from Caliper. It is a screen nobody
 * plans to show and everybody eventually sees, and it looked like a different
 * application — which, at exactly the moment a user's trust is lowest, reads as
 * "this thing is broken" rather than "this thing handled a problem".
 *
 * The developer-only error detail is kept as-is in spirit: it is genuinely
 * useful, and it is gated behind `__DEV__` so it never reaches a user.
 */

import { reloadAppAsync } from "expo";
import React, { useState } from "react";
import {
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AppMark,
  Label,
  PrimaryButton,
  Screen,
  Sheet,
  Text,
  Tappable,
} from "@/components/caliper";
import { color, type as T, radius, GUTTER } from "@/constants/caliper";

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
};

export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const insets = useSafeAreaInsets();
  const [detailOpen, setDetailOpen] = useState(false);

  async function restart() {
    try {
      await reloadAppAsync();
    } catch {
      // reloadAppAsync is unavailable in some runtimes; falling back to the
      // boundary's own reset is better than a button that does nothing.
      resetError();
    }
  }

  const monoFont = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

  return (
    <Screen>
      <View style={[s.wrap, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 32 }]}>
        <View style={s.mark}>
          <AppMark size={34} />
          <Label>ATHLETE AI</Label>
        </View>

        <Text scale="display" style={[T.headline, { marginTop: 28 }]}>Something went{"\n"}wrong.</Text>
        <Text style={[T.body, { marginTop: 12, maxWidth: 310 }]}>
          The app hit a problem and stopped. Nothing you have measured is lost — your sessions
          and scores are stored on our servers, and your clips are still on this phone.
        </Text>

        <View style={{ flex: 1, minHeight: 24 }} />

        <PrimaryButton label="Reload the app" onPress={() => void restart()} trailingArrow />

        {__DEV__ ? (
          <Tappable
            onPress={() => setDetailOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="View error details"
            style={s.detailLink}
          >
            <Text style={[T.buttonSmall, { color: color.textMuted }]}>
              Developer details
            </Text>
          </Tappable>
        ) : null}
      </View>

      {__DEV__ && detailOpen ? (
        <Sheet visible onClose={() => setDetailOpen(false)} title="ERROR DETAILS">
          <View style={s.trace}>
            <Text style={[s.traceText, { fontFamily: monoFont }]} selectable>
              {`Error: ${error.message}${error.stack ? `\n\nStack Trace:\n${error.stack}` : ""}`}
            </Text>
          </View>
        </Sheet>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: GUTTER },
  mark: { flexDirection: "row", alignItems: "center", gap: 10 },
  detailLink: {
    marginTop: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  trace: {
    backgroundColor: color.card,
    borderRadius: radius.cardSmall,
    padding: 16,
  },
  traceText: { fontSize: 12, lineHeight: 18, color: color.textPrimary },
});
