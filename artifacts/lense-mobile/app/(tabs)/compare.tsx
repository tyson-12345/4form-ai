import React, { useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Chevron,
  CloseGlyph,
  Text,
} from "@/components/caliper";
import { color, radius, TAB_BAR, WEB_TOP_INSET } from "@/constants/caliper";
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

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: color.paper },
    scroll: { flex: 1 },
    header: {
      paddingTop: topPad + 16,
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
    title: { fontSize: 28, fontFamily: "InstrumentSans_600SemiBold", color: color.textPrimary },
    subtitle: { fontSize: 14, color: color.textMuted, fontFamily: "InstrumentSans_400Regular", marginTop: 4 },
    proCard: {
      backgroundColor: color.card,
      borderRadius: radius.card,
      padding: 16,
      marginHorizontal: 20,
      marginBottom: 12,
      borderWidth: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    avatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: color.ink,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontSize: 18,
      fontFamily: "InstrumentSans_600SemiBold",
      color: color.onInk,
    },
    proName: { fontSize: 16, fontFamily: "InstrumentSans_600SemiBold", color: color.textPrimary },
    proSpecialty: { fontSize: 12, color: color.textMuted, fontFamily: "InstrumentSans_400Regular", marginTop: 2 },
    sportBadge: {
      alignSelf: "flex-start",
      borderRadius: 20,
      backgroundColor: color.paperDeep,
      paddingHorizontal: 9,
      paddingVertical: 3,
      marginTop: 5,
    },
    sportBadgeText: {
      fontSize: 11,
      // textSecondary, not textMuted: paperDeep is the one surface where the
      // lighter tiers drop under 4.5:1 (see the ladder note in constants).
      color: color.textSecondary,
      fontFamily: "InstrumentSans_500Medium",
      textTransform: "capitalize",
    },
    similarityBadge: {
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 5,
      backgroundColor: color.cobalt + "22",
      alignItems: "center",
    },
    similarityNum: { fontSize: 16, fontFamily: "InstrumentSans_600SemiBold", color: color.cobalt },
    similarityLabel: { fontSize: 9, color: color.cobalt, fontFamily: "InstrumentSans_400Regular" },
    comparePanel: {
      marginHorizontal: 20,
      marginBottom: 24,
      backgroundColor: color.card,
      borderRadius: radius.card,
      padding: 20,
      borderWidth: 1,
      borderColor: color.cobalt + "44",
    },
    panelTitle: { fontSize: 18, fontFamily: "InstrumentSans_600SemiBold", color: color.textPrimary, marginBottom: 4 },
    panelSubtitle: { fontSize: 13, color: color.textMuted, fontFamily: "InstrumentSans_400Regular", marginBottom: 16 },
    simBar: { marginBottom: 16 },
    simBarLabel: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
    simBarLabelText: { fontSize: 12, color: color.textMuted, fontFamily: "InstrumentSans_400Regular" },
    simBarValue: { fontSize: 14, fontFamily: "InstrumentSans_600SemiBold", color: color.cobalt },
    simBarBg: { height: 8, backgroundColor: color.rule, borderRadius: 4 },
    simBarFill: { height: 8, borderRadius: 4, backgroundColor: color.cobalt },
    keyAttrSection: { marginTop: 8 },
    keyAttrTitle: { fontSize: 13, fontFamily: "InstrumentSans_600SemiBold", color: color.textPrimary, marginBottom: 8 },
    attrPill: {
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 5,
      backgroundColor: color.paperDeep,
      marginRight: 8,
      marginBottom: 8,
    },
    attrText: { fontSize: 12, color: color.textPrimary, fontFamily: "InstrumentSans_400Regular" },
    closeBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginTop: 16,
      paddingVertical: 12,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: color.rule,
    },
    closeBtnText: { color: color.textMuted, fontSize: 13, fontFamily: "InstrumentSans_400Regular" },
  });

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottomPad }}>
        <View style={s.header}>
          <Text style={s.title}>Compare</Text>
          <Text style={s.subtitle}>
            Reference technique models for each sport. Measured comparison against your own
            clips is still in development.
          </Text>
        </View>

        {selected && (
          <View style={s.comparePanel}>
            <Text style={s.panelTitle}>vs. {selected.name}</Text>
            <Text style={s.panelSubtitle}>{selected.specialty}</Text>

            <View style={s.simBar}>
              <View style={s.simBarLabel}>
                <Text style={s.simBarLabelText}>Overall Similarity</Text>
                <Text style={s.simBarValue}>{getSimilarityForAthlete(selected.id) ?? "–"}%</Text>
              </View>
              {getSimilarityForAthlete(selected.id) !== null && (
                <View style={s.simBarBg}>
                  <View style={[s.simBarFill, { width: `${getSimilarityForAthlete(selected.id)}%` as any }]} />
                </View>
              )}
              {getSimilarityForAthlete(selected.id) === null && (
                <Text style={{ color: color.textMuted, fontSize: 12, fontFamily: "InstrumentSans_400Regular" }}>
                  Measured comparison isn&apos;t available yet. The attributes below are what
                  this movement is judged on. Use them as a checklist against your own clips.
                </Text>
              )}
            </View>

            <View style={s.keyAttrSection}>
              <Text style={s.keyAttrTitle}>Key Attributes to Match</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {selected.keyAttributes.map((attr) => (
                  <View key={attr} style={s.attrPill}>
                    <Text style={s.attrText}>{attr}</Text>
                  </View>
                ))}
              </View>
            </View>

            <TouchableOpacity style={s.closeBtn} activeOpacity={0.7} onPress={() => setSelected(null)}>
              <CloseGlyph tone={color.textMuted} size={13} />
              <Text style={s.closeBtnText}>Close comparison</Text>
            </TouchableOpacity>
          </View>
        )}

        {REFERENCE_MODELS.map((pro) => {
          const initials = pro.name.split(" ").map((n) => n[0]).join("").slice(0, 2);
          const similarity = getSimilarityForAthlete(pro.id);
          const isSelected = selected?.id === pro.id;

          return (
            <TouchableOpacity
              key={pro.id}
              style={[s.proCard, { borderColor: isSelected ? color.cobalt + "88" : color.rule }]}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${pro.name}, ${pro.specialty}, ${pro.sport}`}
              onPress={() => setSelected(isSelected ? null : pro)}
            >
              <View style={s.avatar}>
                <Text style={s.avatarText}>{initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.proName}>{pro.name}</Text>
                <Text style={s.proSpecialty}>{pro.specialty}</Text>
                <View style={s.sportBadge}>
                  <Text style={s.sportBadgeText}>{pro.sport}</Text>
                </View>
              </View>
              {similarity !== null ? (
                <View style={s.similarityBadge}>
                  <Text style={s.similarityNum}>{similarity}%</Text>
                  <Text style={s.similarityLabel}>match</Text>
                </View>
              ) : (
                <Chevron />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
