import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth, useTier } from "@/lib/authContext";
import { subscriptions, type Plan } from "@/lib/api";

export default function PricingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const currentTier = useTier();

  const [plans, setPlans] = useState<Plan[]>([]);
  /**
   * Whether purchases actually work. Reported by the server, not assumed here.
   *
   * This screen used to show real prices, claim payments were "processed by
   * Apple App Store or Google Play", and then grant the tier without charging
   * anything — a paywall anyone could walk through, and a false statement about
   * billing. Until a payment provider is wired up, the buttons say so.
   */
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    subscriptions
      .plans()
      .then((r) => {
        setPlans(r.plans);
        setBillingEnabled(r.billingEnabled);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
      });
  }, []);

  async function handleSelectPlan(plan: Plan) {
    if (plan.id === currentTier) return;

    // Downgrading is free and instant — it only ever removes entitlements.
    if (plan.id === "free") {
      setWorking("free");
      try {
        await subscriptions.cancel();
        await refreshProfile();
        router.back();
      } catch {
        Alert.alert("Couldn't switch plans", "Please try again in a moment.");
      } finally {
        setWorking(null);
      }
      return;
    }

    if (!billingEnabled) {
      Alert.alert(
        "Not available yet",
        `${plan.name} isn't available to buy yet — we're still setting up payments. ` +
          "Nothing has been charged and your plan hasn't changed.",
        [{ text: "Got it" }],
      );
      return;
    }

    // With billing configured this launches the native purchase sheet and
    // submits the resulting receipt to /subscriptions/verify-purchase, which
    // sets the tier from the *verified* product. See docs/BILLING.md.
    Alert.alert(
      "Purchases coming soon",
      "In-app purchases are being finalised. Nothing has been charged.",
      [{ text: "OK" }],
    );
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: topPad + 16,
      paddingHorizontal: 20,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    closeBtn: { padding: 4 },
    headerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    scroll: { flex: 1 },
    scrollContent: { padding: 20, paddingBottom: bottomPad + 24 },
    heroText: {
      fontSize: 26,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      textAlign: "center",
      marginBottom: 8,
    },
    heroSub: {
      fontSize: 14,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      textAlign: "center",
      marginBottom: 28,
    },
    planCard: {
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 20,
      marginBottom: 16,
      position: "relative",
      overflow: "hidden",
    },
    planCardPopular: {
      borderColor: colors.primary,
    },
    popularBadge: {
      position: "absolute",
      top: 12,
      right: 12,
      backgroundColor: colors.primary,
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    popularBadgeText: {
      color: colors.primaryForeground,
      fontSize: 10,
      fontFamily: "Inter_700Bold",
      letterSpacing: 0.5,
    },
    currentBadge: {
      position: "absolute",
      top: 12,
      right: 12,
      backgroundColor: colors.success + "22",
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.success,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    currentBadgeText: {
      color: colors.success,
      fontSize: 10,
      fontFamily: "Inter_700Bold",
    },
    planName: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground },
    planDesc: { fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 2 },
    priceRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 14, marginBottom: 16, gap: 2 },
    priceDollar: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 4 },
    priceAmount: { fontSize: 36, fontFamily: "Inter_700Bold", color: colors.foreground },
    pricePeriod: { fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginBottom: 6 },
    featureRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      marginBottom: 8,
    },
    featureText: { fontSize: 13, color: colors.foreground, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },
    selectBtn: {
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 6,
      marginTop: 4,
    },
    selectBtnPrimary: { backgroundColor: colors.primary },
    selectBtnOutline: { borderWidth: 1.5, borderColor: colors.border },
    selectBtnCurrent: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.success },
    selectBtnDisabled: { backgroundColor: colors.surface3, borderWidth: 1, borderColor: colors.border },
    selectBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    selectBtnTextPrimary: { color: colors.primaryForeground },
    selectBtnTextOutline: { color: colors.foreground },
    selectBtnTextCurrent: { color: colors.success },
    selectBtnTextDisabled: { color: colors.mutedForeground },
    notice: {
      flexDirection: "row",
      gap: 10,
      alignItems: "flex-start",
      backgroundColor: colors.warning + "18",
      borderWidth: 1,
      borderColor: colors.warning + "44",
      borderRadius: 12,
      padding: 14,
      marginBottom: 20,
    },
    noticeText: {
      flex: 1,
      fontSize: 12.5,
      lineHeight: 18,
      color: colors.foreground,
      fontFamily: "Inter_400Regular",
    },
    faq: {
      marginTop: 8,
      padding: 16,
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    faqTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 12 },
    faqItem: { marginBottom: 10 },
    faqQ: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 2 },
    faqA: { fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular", lineHeight: 17 },
  });

  if (loading) {
    return (
      <View style={[s.container, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.closeBtn} onPress={() => router.back()}>
          <Feather name="x" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Choose Your Plan</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={s.heroText}>Unlock Your{"\n"}Full Potential</Text>
        <Text style={s.heroSub}>Elite AI coaching, unlimited analyses,{"\n"}and injury prevention — all in one app.</Text>

        {!billingEnabled && (
          <View style={s.notice}>
            <Feather name="info" size={16} color={colors.warning} style={{ marginTop: 1 }} />
            <Text style={s.noticeText}>
              Paid plans aren&apos;t available to buy yet — we&apos;re still setting up payments.
              You can browse what&apos;s coming, but nothing can be purchased or charged right now.
            </Text>
          </View>
        )}

        {plans.map((plan) => {
          const isCurrent = plan.id === currentTier;
          const isPopular = !!plan.popular;
          const isWorking = working === plan.id;
          const isPaidAndUnavailable = plan.price > 0 && !billingEnabled;

          return (
            <View key={plan.id} style={[s.planCard, isPopular && s.planCardPopular]}>
              {isPopular && !isCurrent && (
                <View style={s.popularBadge}>
                  <Text style={s.popularBadgeText}>MOST POPULAR</Text>
                </View>
              )}
              {isCurrent && (
                <View style={s.currentBadge}>
                  <Text style={s.currentBadgeText}>CURRENT</Text>
                </View>
              )}

              <Text style={s.planName}>{plan.name}</Text>
              <Text style={s.planDesc}>{plan.description}</Text>

              <View style={s.priceRow}>
                {plan.price > 0 && <Text style={s.priceDollar}>$</Text>}
                <Text style={s.priceAmount}>{plan.price === 0 ? "Free" : plan.price.toFixed(2)}</Text>
                {plan.period && <Text style={s.pricePeriod}>/{plan.period}</Text>}
              </View>

              <View style={s.divider} />

              {plan.features.map((f) => (
                <View key={f} style={s.featureRow}>
                  <Feather name="check-circle" size={15} color={colors.success} style={{ marginTop: 1 }} />
                  <Text style={s.featureText}>{f}</Text>
                </View>
              ))}

              <TouchableOpacity
                style={[
                  s.selectBtn,
                  isCurrent
                    ? s.selectBtnCurrent
                    : isPaidAndUnavailable
                      ? s.selectBtnDisabled
                      : isPopular
                        ? s.selectBtnPrimary
                        : s.selectBtnOutline,
                ]}
                onPress={() => handleSelectPlan(plan)}
                disabled={isCurrent || !!working}
                activeOpacity={0.85}
              >
                {isWorking ? (
                  <ActivityIndicator
                    color={isPopular ? colors.primaryForeground : colors.primary}
                    size="small"
                  />
                ) : (
                  <>
                    {isCurrent && <Feather name="check" size={16} color={colors.success} />}
                    <Text
                      style={[
                        s.selectBtnText,
                        isCurrent
                          ? s.selectBtnTextCurrent
                          : isPaidAndUnavailable
                            ? s.selectBtnTextDisabled
                            : isPopular
                              ? s.selectBtnTextPrimary
                              : s.selectBtnTextOutline,
                      ]}
                    >
                      {isCurrent
                        ? "Current plan"
                        : plan.price === 0
                          ? "Switch to Free"
                          : isPaidAndUnavailable
                            ? "Coming soon"
                            : `Get ${plan.name}`}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          );
        })}

        <View style={s.faq}>
          <Text style={s.faqTitle}>Frequently Asked Questions</Text>
          {[
            // These answers describe how billing will work once it ships. They
            // previously stated as fact that payments were already being
            // processed through the App Store, while no payment path existed.
            {
              q: "Can I buy a plan right now?",
              a: billingEnabled
                ? "Yes. Purchases go through the App Store or Google Play, and you can cancel anytime from your store account."
                : "Not yet. Paid plans are still being set up, so nothing can be purchased or charged today. Everything on the Free plan works normally.",
            },
            {
              q: "How will payments be handled?",
              a: "When paid plans launch, purchases will be handled entirely by the App Store or Google Play. AthleteAI will never see or store your card details.",
            },
            {
              q: "What happens to my analyses if I switch to Free?",
              a: "Your existing analyses stay accessible. You just won't be able to create new ones beyond the Free plan's monthly limit.",
            },
            {
              q: "How is my technique actually scored?",
              a: "We track your joints frame by frame in the video and measure real angles — range of motion, left/right symmetry, and time spent in high-strain positions. Scores are calculated from those measurements, so the same clip always scores the same.",
            },
          ].map(({ q, a }) => (
            <View key={q} style={s.faqItem}>
              <Text style={s.faqQ}>{q}</Text>
              <Text style={s.faqA}>{a}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
