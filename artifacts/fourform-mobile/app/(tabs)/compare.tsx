/**
 * Compare — reference technique models.
 *
 * ── Why this file changed shape ────────────────────────────────────────────
 * It was the one screen entirely off the design system. It called
 * `StyleSheet.create` inside the component body, so every style object in it
 * was rebuilt on every render; it hard-coded `fontFamily: "InstrumentSans_*"`
 * eighteen times instead of taking the type scale; it sat on a 20pt gutter
 * while every other screen uses 22; it built colours by string concatenation
 * (`color.cobalt + "88"`); and it re-implemented Screen, Card, Avatar, three
 * chip variants, a meter, a close button and seven text styles that the system
 * already exports. It also held the app's only two `TouchableOpacity`.
 *
 * None of that was visible as a bug, which is exactly why it survived: the
 * screen is hidden from the tab bar and reachable by URL only, so it drifted
 * where nobody was looking.
 */

import React, { useState } from "react";
import { View, StyleSheet, ScrollView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Avatar,
  Card,
  Chevron,
  Chip,
  CloseGlyph,
  Entering,
  Label,
  Meter,
  Screen,
  Tappable,
  Text,
} from "@/components/caliper";
import { color, type as T, radius, GUTTER, TAB_BAR, WEB_TOP_INSET } from "@/constants/caliper";
import { REFERENCE_MODELS } from "@/lib/referenceModels";
import type { ProAthlete } from "@/lib/types";

/**
 * Reference-model avatars are ink on paper, not a per-sport colour.
 *
 * This screen used to assign each sport a saturated hue — mint, orange, violet,
 * yellow, pink, sky — six accent colours on one screen in a system whose first
 * rule is that cobalt appears at most once and means "the next action". The
 * sport is already written next to every avatar; the colour was decoration
 * carrying no information, and it made the one screen that is not yet built
 * the most colourful in the app.
 */

/**
 * Similarity against a reference model.
 *
 * Always `null` today, because nothing computes it. This previously returned
 * hard-coded constants (63 and 71) looked up from the mock fixture set, so two
 * of the six cards displayed a confident "Overall Similarity 71%" that was not
 * derived from the user's clip, their measurements, or anything else — the same
 * number for every user, forever.
 *
 * Presenting a fabricated number as a measurement is the one thing this app is
 * built not to do (see the scoring engine, where power and speed are `null`
 * rather than guessed). Returning null routes every card to the honest
 * "not measured yet" state below.
 *
 * When a real comparison ships, implement it here against the athlete's actual
 * `poseMetrics` and the reference model's joint-angle envelope.
 */
function getSimilarityForAthlete(_proId: string): number | null {
  return null;
}
export default function CompareScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<ProAthlete | null>(null);

  // Web reports zero safe-area insets, so a bare `insets.top` puts the title
  // flush against the top of the browser viewport. The fallback is the height
  // of a typical status bar plus notch, not a number picked to look right on
  // one screenshot.
  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top;
  // TAB_BAR.clearance, not a hand-picked number: the floating bar needs
  // 62 + 26 + 12 = 100, and 60 left the last card sitting under it.
  const bottomPad = TAB_BAR.clearance + insets.bottom;

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad }}
      >
        <View style={s.header}>
          <Text scale="display" style={T.screenTitle}>Compare</Text>
          <Text style={[T.body, { marginTop: 10 }]}>
            Reference technique models for each sport. Measured comparison against your own
            clips is still in development.
          </Text>
        </View>

        {selected && (
          <Entering style={s.block}>
            <Card>
              <Text scale="display" style={T.cardTitle}>vs. {selected.name}</Text>
              <Text style={[T.bodySmall, { marginTop: 4 }]}>{selected.specialty}</Text>

              <View style={s.simHead}>
                <Label>OVERALL SIMILARITY</Label>
                <Text style={T.measured}>
                  {getSimilarityForAthlete(selected.id) ?? "–"}%
                </Text>
              </View>

              {getSimilarityForAthlete(selected.id) !== null ? (
                <Meter
                  value={(getSimilarityForAthlete(selected.id) ?? 0) / 100}
                  tone={color.ink}
                  label={`Similarity to ${selected.name}`}
                  style={{ marginTop: 10 }}
                />
              ) : (
                <Text style={[T.bodySmall, { marginTop: 8 }]}>
                  Measured comparison isn&apos;t available yet. The attributes below are what
                  this movement is judged on. Use them as a checklist against your own clips.
                </Text>
              )}

              <Label style={{ marginTop: 22 }}>KEY ATTRIBUTES TO MATCH</Label>
              <View style={s.attrs}>
                {selected.keyAttributes.map((attr) => (
                  <Chip key={attr} label={attr} />
                ))}
              </View>

              <Tappable
                onPress={() => setSelected(null)}
                accessibilityLabel="Close comparison"
                style={s.close}
              >
                <CloseGlyph tone={color.textMuted} size={13} />
                <Text style={[T.buttonSmall, { color: color.textMuted }]}>Close comparison</Text>
              </Tappable>
            </Card>
          </Entering>
        )}

        <View style={s.block}>
          {REFERENCE_MODELS.map((pro, i) => {
            const similarity = getSimilarityForAthlete(pro.id);
            const isSelected = selected?.id === pro.id;

            return (
              <Entering key={pro.id} index={i}>
                <Tappable
                  onPress={() => setSelected(isSelected ? null : pro)}
                  haptic="select"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${pro.name}, ${pro.specialty}, ${pro.sport}`}
                  style={[s.proCard, isSelected && s.proCardOn]}
                >
                  <Avatar name={pro.name} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={T.rowTitle}>{pro.name}</Text>
                    <Text style={[T.rowSubtitle, { marginTop: 2 }]}>{pro.specialty}</Text>
                    <Label style={{ marginTop: 6 }}>{pro.sport.toUpperCase()}</Label>
                  </View>
                  {similarity !== null ? (
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={T.metricRow}>{similarity}%</Text>
                      <Label>MATCH</Label>
                    </View>
                  ) : (
                    <Chevron />
                  )}
                </Tappable>
              </Entering>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: GUTTER, paddingBottom: 20 },
  block: { paddingHorizontal: GUTTER },
  simHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 22,
  },
  attrs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  close: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
  },
  proCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: color.card,
    borderRadius: radius.cardSmall,
    borderWidth: 1,
    borderColor: color.rule,
    padding: 14,
    marginBottom: 10,
  },
  proCardOn: { borderColor: color.ink },
});
