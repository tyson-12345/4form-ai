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

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import {
  Check,
  Chevron,
  CloseGlyph,
  Label,
  PrimaryButton,
  Screen,
  SkeletonBlock,
  Text,
} from "@/components/caliper";
import { color, type as T, radius, GUTTER } from "@/constants/caliper";
import { useAuth } from "@/lib/authContext";
import { subscriptions, type Plan } from "@/lib/api";
import { alert } from "@/lib/alert";

export default function PricingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subscription, refreshProfile } = useAuth();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(false);

  const currentTier = subscription?.tier ?? "free";

  /**
   * The plans request used to end in `.catch(() => {})`.
   *
   * When it failed, `loading` cleared with an empty `plans`, every card was
   * conditional on a plan existing, and the screen rendered its headline and
   * literally nothing else — a blank page presented as a successful load, with
   * no error, no retry and no way to tell the difference from "we have no
   * plans". A swallowed rejection is not error handling.
   */
  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    subscriptions
      .plans()
      .then((r) => {
        setPlans(r.plans);
        setBillingEnabled(r.billingEnabled);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      alert("Couldn't switch plans", "Please try again in a moment.");
    } finally {
      setWorking(false);
    }
  }

  function attemptBuy(plan: Plan) {
    // Never grant a tier client-side. When billing ships this launches the
    // native purchase sheet and posts the receipt to /subscriptions/verify-purchase.
    //
    // `plan.available` is checked separately from `billingEnabled`: the first
    // means "the features exist", the second means "we can take money". A plan
    // must satisfy both, and the message says which one is missing rather than
    // implying it's only a payments delay.
    if (!plan.available) {
      alert(
        `${plan.name} isn't ready`,
        plan.unavailableReason ??
          `${plan.name} is still in development. We're not selling it until the features behind it are real.`,
        [{ text: "Got it" }],
      );
      return;
    }

    alert(
      "Not available yet",
      `${plan.name} isn't available to buy yet. We're still setting up payments. Nothing has been charged and your plan hasn't changed.`,
      [{ text: "Got it" }],
    );
  }

  if (loading) {
    return (
      <Screen>
        <View style={[s.head, { paddingTop: insets.top + 14 }]}>
          <Pressable
            onPress={() => router.back()}
            style={s.closeBtn}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <CloseGlyph />
          </Pressable>
        </View>
        {/* A skeleton rather than a bare spinner on an empty page: the shape of
            what is coming is more reassuring than a dot, and it stops the
            layout jumping when the cards land. */}
        <View style={{ paddingHorizontal: GUTTER }}>
          <SkeletonBlock height={38} width="82%" />
          <SkeletonBlock height={38} width="54%" style={{ marginTop: 8 }} />
          <SkeletonBlock height={210} style={{ marginTop: 28, borderRadius: 28 }} />
          <SkeletonBlock height={120} style={{ marginTop: 14, borderRadius: 28 }} />
        </View>
      </Screen>
    );
  }

  if (failed || plans.length === 0) {
    return (
      <Screen>
        <View style={[s.head, { paddingTop: insets.top + 14 }]}>
          <Pressable
            onPress={() => router.back()}
            style={s.closeBtn}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <CloseGlyph />
          </Pressable>
        </View>
        <View style={s.centre}>
          <Text style={[T.cardTitle, { textAlign: "center" }]}>
            We couldn&apos;t load the plans
          </Text>
          <Text style={[T.body, { textAlign: "center", marginTop: 8, maxWidth: 300 }]}>
            Your current plan hasn&apos;t changed and nothing has been charged.
          </Text>
          <View style={{ alignSelf: "stretch", marginTop: 24, gap: 10 }}>
            <PrimaryButton label="Try again" onPress={load} />
            <PrimaryButton
              label="Close"
              tone={color.card}
              labelTone={color.textPrimary}
              onPress={() => router.back()}
            />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={[s.head, { paddingTop: insets.top + 14 }]}>
        <Pressable
          onPress={() => router.back()}
          style={s.closeBtn}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          {/* The SVG mark, not a literal "✕" character: the glyph set exists,
              and a text ✕ renders at a different weight and baseline on every
              platform. */}
          <CloseGlyph />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text scale="display" style={T.headline}>
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
                accessibilityRole="button"
                // Dimmed but deliberately still pressable: tapping explains
                // that nothing can be bought yet, which is more useful than an
                // inert control. Announced as such rather than as disabled.
                accessibilityLabel={
                  billingEnabled ? "Start free week" : "Coming soon. Not available to buy yet."
                }
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

        {/* ── Elite ──
            Not purchasable: the comparison feature behind it isn't built. The
            card is deliberately inert and shows no price — a price next to a
            tappable card reads as "for sale", and selling an unbuilt feature is
            what the plan audit removed. See PLANS in entitlementService. */}
        {elite && !elite.available && (
          <View style={s.plainCard}>
            <View style={s.plainHead}>
              <Label>ELITE</Label>
              <Text style={[T.measured, { fontSize: 11, color: color.textMuted }]}>
                IN DEVELOPMENT
              </Text>
            </View>
            <Text style={[T.body, { marginTop: 10 }]}>
              {elite.unavailableReason ??
                "Elite is still in development. We're not selling it until the features behind it are real."}
            </Text>
          </View>
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
              <Pressable
                onPress={downgrade}
                disabled={working}
                accessibilityRole="button"
                accessibilityLabel="Switch to the free plan"
                accessibilityState={{ disabled: working, busy: working }}
                style={s.downgrade}
              >
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
            : "When plans go on sale, purchases will be handled entirely by the App Store or Google Play. AthleteAI will never see or store your card details."}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: GUTTER, paddingBottom: 14, alignItems: "flex-end" },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  closeBtn: {
    // Matches BackButton and the analysis hero controls.
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.card,
    alignItems: "center",
    justifyContent: "center",
  },

  notice: {
    backgroundColor: color.card,
    borderRadius: radius.cardSmall,
    padding: 14,
    marginTop: 20,
    borderLeftWidth: 3,
    // Ink, not rust. Nothing is wrong here — this notice is telling you that
    // billing is not switched on yet. Rust is the alarm colour, and spending it
    // on an informational aside is exactly the dilution rule 2 guards against.
    borderLeftColor: color.ink,
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
    marginTop: 10,
    // A 16pt-tall row is not a target, and this one changes the user's plan.
    minHeight: 44,
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
