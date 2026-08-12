import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { REFERENCE_MODELS } from "@/lib/referenceModels";
import type { ProAthlete } from "@/lib/types";

const SPORT_COLORS: Record<string, string> = {
  golf: "#4ade80",
  basketball: "#f97316",
  fencing: "#a78bfa",
  tennis: "#facc15",
  gymnastics: "#f472b6",
  running: "#38bdf8",
};

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
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<ProAthlete | null>(null);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 + 84 : insets.bottom + 60;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    header: {
      paddingTop: topPad + 16,
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
    title: { fontSize: 28, fontFamily: "InstrumentSans_600SemiBold", color: colors.foreground },
    subtitle: { fontSize: 14, color: colors.mutedForeground, fontFamily: "InstrumentSans_400Regular", marginTop: 4 },
    proCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
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
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontSize: 20,
      fontFamily: "InstrumentSans_600SemiBold",
      color: "#fff",
    },
    proName: { fontSize: 16, fontFamily: "InstrumentSans_600SemiBold", color: colors.foreground },
    proSpecialty: { fontSize: 12, color: colors.mutedForeground, fontFamily: "InstrumentSans_400Regular", marginTop: 2 },
    sportBadge: {
      alignSelf: "flex-start",
      borderRadius: 20,
      paddingHorizontal: 8,
      paddingVertical: 2,
      marginTop: 4,
    },
    sportBadgeText: { fontSize: 10, fontFamily: "InstrumentSans_500Medium", textTransform: "capitalize" },
    similarityBadge: {
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 5,
      backgroundColor: colors.primary + "22",
      alignItems: "center",
    },
    similarityNum: { fontSize: 16, fontFamily: "InstrumentSans_600SemiBold", color: colors.primary },
    similarityLabel: { fontSize: 9, color: colors.primary, fontFamily: "InstrumentSans_400Regular" },
    comparePanel: {
      marginHorizontal: 20,
      marginBottom: 24,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.primary + "44",
    },
    panelTitle: { fontSize: 18, fontFamily: "InstrumentSans_600SemiBold", color: colors.foreground, marginBottom: 4 },
    panelSubtitle: { fontSize: 13, color: colors.mutedForeground, fontFamily: "InstrumentSans_400Regular", marginBottom: 16 },
    simBar: { marginBottom: 16 },
    simBarLabel: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
    simBarLabelText: { fontSize: 12, color: colors.mutedForeground, fontFamily: "InstrumentSans_400Regular" },
    simBarValue: { fontSize: 14, fontFamily: "InstrumentSans_600SemiBold", color: colors.primary },
    simBarBg: { height: 8, backgroundColor: colors.border, borderRadius: 4 },
    simBarFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
    keyAttrSection: { marginTop: 8 },
    keyAttrTitle: { fontSize: 13, fontFamily: "InstrumentSans_600SemiBold", color: colors.foreground, marginBottom: 8 },
    attrPill: {
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 5,
      backgroundColor: colors.muted,
      marginRight: 8,
      marginBottom: 8,
    },
    attrText: { fontSize: 12, color: colors.foreground, fontFamily: "InstrumentSans_400Regular" },
    closeBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginTop: 16,
      paddingVertical: 12,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
    },
    closeBtnText: { color: colors.mutedForeground, fontSize: 13, fontFamily: "InstrumentSans_400Regular" },
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
                <Text style={s.simBarValue}>{getSimilarityForAthlete(selected.id) ?? "—"}%</Text>
              </View>
              {getSimilarityForAthlete(selected.id) !== null && (
                <View style={s.simBarBg}>
                  <View style={[s.simBarFill, { width: `${getSimilarityForAthlete(selected.id)}%` as any }]} />
                </View>
              )}
              {getSimilarityForAthlete(selected.id) === null && (
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "InstrumentSans_400Regular" }}>
                  Measured comparison isn&apos;t available yet. The attributes below are what
                  this movement is judged on — use them as a checklist against your own clips.
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
              <Feather name="x" size={14} color={colors.mutedForeground} />
              <Text style={s.closeBtnText}>Close comparison</Text>
            </TouchableOpacity>
          </View>
        )}

        {REFERENCE_MODELS.map((pro) => {
          const sportColor = SPORT_COLORS[pro.sport] ?? colors.primary;
          const initials = pro.name.split(" ").map((n) => n[0]).join("").slice(0, 2);
          const similarity = getSimilarityForAthlete(pro.id);
          const isSelected = selected?.id === pro.id;

          return (
            <TouchableOpacity
              key={pro.id}
              style={[s.proCard, { borderColor: isSelected ? colors.primary + "88" : colors.border }]}
              activeOpacity={0.75}
              onPress={() => setSelected(isSelected ? null : pro)}
            >
              <View style={[s.avatar, { backgroundColor: sportColor + "33" }]}>
                <Text style={[s.avatarText, { color: sportColor }]}>{initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.proName}>{pro.name}</Text>
                <Text style={s.proSpecialty}>{pro.specialty}</Text>
                <View style={[s.sportBadge, { backgroundColor: sportColor + "22" }]}>
                  <Text style={[s.sportBadgeText, { color: sportColor }]}>{pro.sport}</Text>
                </View>
              </View>
              {similarity !== null ? (
                <View style={s.similarityBadge}>
                  <Text style={s.similarityNum}>{similarity}%</Text>
                  <Text style={s.similarityLabel}>match</Text>
                </View>
              ) : (
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
