/**
 * Plans.
 *
 * Two constraints this screen has to satisfy at once:
 *
 *  - The design gives Pro the cobalt card, which is correct: on this screen the
 *    upgrade *is* the next action.
 *  - Purchases don't work yet. The previous build showed real prices, claimed
 *    payments were "processed by Apple App Store or Google Play", and then
 *    granted the tier with no payment. So the buy state is driven by the
 *    server's `billingEnabled`, and every claim about billing is written in the
 *    future tense until it's true.
 */

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { Screen, Label, Check, Chevron } from "@/components/caliper";
import { color, type as T, radius, GUTTER } from "@/constants/caliper";
import { useAuth } from "@/lib/authContext";
import { subscriptions, type Plan } from "@/lib/api";

export default function PricingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subscription, refreshProfile } = useAuth();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const currentTier = subscription?.tier ?? "free";

  useEffect(() => {
    subscriptions
      .plans()
      .then((r) => {
        setPlans(r.plans);
        setBillingEnabled(r.billingEnabled);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const pro = plans.find((p) => p.id === "pro");
  const free = plans.find((p) => p.id === "free");
  const elite = plans.find((p) => p.id === "elite");

  async function downgrade() {
    setWorking(true);
    try {
      await subscriptions.cancel();
      await refreshProfile();
      router.back();
    } catch {
      Alert.alert("Couldn't switch plans", "Please try again in a moment.");
    } finally {
      setWorking(false);
    }
  }

  function attemptBuy(plan: Plan) {
    // Never grant a tier client-side. When billing ships this launches the
    // native purchase sheet and posts the receipt to /subscriptions/verify-purchase.
    Alert.alert(
      "Not available yet",
      `${plan.name} isn't available to buy yet — we're still setting up payments. Nothing has been charged and your plan hasn't changed.`,
      [{ text: "Got it" }],
    );
  }

  if (loading) {
    return (
      <Screen style={{ alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={color.cobalt} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={[s.head, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={() => router.back()} style={s.closeBtn} hitSlop={10}>
          <Text style={s.closeGlyph}>✕</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={T.headline}>
          {free ? `${free.limits.analysesPerMonth} clips a month is a warm-up.` : "Measure more."}
        </Text>
        <Text style={[T.body, { marginTop: 12, maxWidth: 310 }]}>
          Pro measures every session you film and lets Atlas read your whole history, not just
          the last clip.
        </Text>

        {!billingEnabled && (
          <View style={s.notice}>
            <Text style={[T.bodySmall, { color: color.textPrimary }]}>
              Paid plans aren&apos;t on sale yet. You can see what&apos;s coming, but nothing
              can be purchased or charged right now.
            </Text>
          </View>
        )}

        {/* ── Pro: the next action, so it wears cobalt ── */}
        {pro && (
          <View style={s.proCard}>
            <View style={s.proHead}>
              <View>
                <Label tone={color.onCobaltMuted}>PRO</Label>
                <View style={s.priceRow}>
                  <Text style={s.price}>${pro.price.toFixed(2)}</Text>
                  <Text style={[T.measured, { color: color.onCobaltMuted, fontSize: 11 }]}>
                    /MO
                  </Text>
                </View>
              </View>
              {currentTier === "pro" && (
                <View style={s.badge}>
                  <Text style={[T.label, { color: color.onCobalt, letterSpacing: 1 }]}>
                    CURRENT
                  </Text>
                </View>
              )}
            </View>

            <View style={{ gap: 10, marginTop: 20 }}>
              {pro.features.map((feature) => (
                <View key={feature} style={s.featureRow}>
                  <Check tone={color.onCobalt} />
                  <Text style={[T.message, { color: color.onCobalt, flex: 1 }]}>{feature}</Text>
                </View>
              ))}
            </View>

            {currentTier !== "pro" && (
              <Pressable
                onPress={() => attemptBuy(pro)}
                style={({ pressed }) => [
                  s.proCta,
                  { opacity: billingEnabled ? (pressed ? 0.9 : 1) : 0.55 },
                ]}
              >
                <Text style={[T.button, { color: color.cobalt }]}>
                  {billingEnabled ? "Start free week" : "Coming soon"}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── Elite ── */}
        {elite && (
          <Pressable
            onPress={() => (currentTier === "elite" ? undefined : attemptBuy(elite))}
            style={({ pressed }) => [s.plainCard, pressed && { opacity: 0.9 }]}
          >
            <View style={s.plainHead}>
              <Label>
                ELITE{currentTier === "elite" ? " · CURRENT" : ""}
              </Label>
              <Text style={[T.measured, { fontSize: 11 }]}>
                ${elite.price.toFixed(2)}/MO
              </Text>
            </View>
            <Text style={[T.body, { marginTop: 10 }]}>
              Everything in Pro, plus side-by-side comparison against reference technique and
              an advanced biomechanics report.
            </Text>
          </Pressable>
        )}

        {/* ── Free ── */}
        {free && (
          <View style={s.plainCard}>
            <View style={s.plainHead}>
              <Label>
                FREE{currentTier === "free" ? " · CURRENT" : ""}
              </Label>
              <Text style={[T.measured, { fontSize: 11 }]}>
                {free.limits.analysesPerMonth} CLIPS / MO
              </Text>
            </View>
            <Text style={[T.body, { marginTop: 10 }]}>
              Measurement, flags and history stay yours. Everything you&apos;ve already measured
              keeps working.
            </Text>

            {currentTier !== "free" && (
              <Pressable onPress={downgrade} disabled={working} style={s.downgrade}>
                <Text style={[T.buttonSmall, { color: color.textMuted }]}>
                  {working ? "Switching…" : "Switch to Free"}
                </Text>
                <Chevron />
              </Pressable>
            )}
          </View>
        )}

        <Text style={s.footnote}>
          {billingEnabled
            ? "Cancel any time in Settings. Your measured sessions stay readable on the free plan."
            : "When plans go on sale, purchases will be handled entirely by the App Store or Google Play — AthleteAI will never see or store your card details."}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: GUTTER, paddingBottom: 14, alignItems: "flex-end" },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.card,
    alignItems: "center",
    justifyContent: "center",
  },
  closeGlyph: { fontSize: 15, color: color.textPrimary, lineHeight: 18 },

  notice: {
    backgroundColor: color.card,
    borderRadius: radius.cardSmall,
    padding: 14,
    marginTop: 20,
    borderLeftWidth: 3,
    borderLeftColor: color.rust,
  },

  proCard: {
    backgroundColor: color.cobalt,
    borderRadius: 28,
    padding: 22,
    marginTop: 24,
  },
  proHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 6 },
  price: {
    fontFamily: "BricolageGrotesque_800ExtraBold",
    fontSize: 40,
    lineHeight: 42,
    letterSpacing: -1.8,
    color: color.onCobalt,
  },
  badge: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  proCta: {
    backgroundColor: color.card,
    borderRadius: radius.pill,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 22,
  },

  plainCard: {
    backgroundColor: color.card,
    borderRadius: 28,
    padding: 20,
    marginTop: 14,
  },
  plainHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  downgrade: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 14,
  },

  footnote: {
    textAlign: "center",
    marginTop: 26,
    fontFamily: "InstrumentSans_400Regular",
    fontSize: 12,
    lineHeight: 18,
    color: color.textFaint,
  },
});
