/**
 * Surfaces and screen furniture — the things content sits on or under.
 *
 * `Sheet` is the app's only modal. `FooterFade` and `StatusBarScrim` are the
 * scroll-edge treatments that let content pass under floating chrome without
 * a hard divider, and `useFooterClearance` measures that chrome rather than
 * guessing its height.
 */

import React from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  type LayoutChangeEvent,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, type as T, radius, GUTTER } from "@/constants/caliper";
import { useEntrance } from "@/lib/motion";
import Animated from "react-native-reanimated";
import { Text, Label } from "./text";
import { Tappable } from "./controls";

export function Card({
  children,
  style,
  padded = true,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  onPress?: () => void;
  /** Required in practice when pressable — an unnamed card is a mystery aloud. */
  accessibilityLabel?: string;
}) {
  const body = (
    <View style={[s.card, padded && s.cardPadded, style]}>{children}</View>
  );
  if (!onPress) return body;
  return (
    <Tappable onPress={onPress} accessibilityLabel={accessibilityLabel}>
      {body}
    </Tappable>
  );
}

/**
 * The paper ground every screen sits on. Nothing else.
 *
 * The docstring used to say "with the standard gutter", which it has never
 * applied — every screen pads its own scroll content by `GUTTER`, because the
 * gutter belongs to the *content* and the paper has to run full-bleed behind
 * the hero images and the status-bar scrim. Believing the docstring means
 * double-padding a screen by 22pt.
 */
export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[s.screen, style]}>{children}</View>;
}

/**
 * The bottom sheet used for every modal form in the app.
 *
 * ── What the four hand-rolled copies each got wrong ─────────────────────────
 * `analyze` had one and `profile` had three. Between them:
 *
 *  - **Three had no `onRequestClose`.** That is the Android hardware back
 *    button and the web Escape key. The worst offender was the delete-account
 *    sheet: the most dangerous screen in the app, and back did nothing.
 *  - **None wrapped its inputs in a `KeyboardAvoidingView`.** The name editor,
 *    the new-session title field and the delete-account confirmation all put
 *    their submit button under the keyboard on a short device.
 *  - **The header was duplicated with different padding** in the two files, so
 *    the same sheet sat 20pt lower depending on which screen opened it.
 *  - **State survived closing.** `DeleteAccountSheet` never cleared `password`
 *    or the typed "DELETE", so reopening it showed a pre-armed form with a
 *    password still in memory.
 *
 * The last one is structural rather than a habit: the body is not rendered at
 * all while the sheet is closed, so a closed sheet holds no state, runs no
 * effects and keeps no typed password in memory.
 *
 * **That only covers state declared inside the body.** A wrapper component that
 * holds state and *returns* a `Sheet` is not unmounted by this — the caller has
 * to stop rendering the wrapper. `profile.tsx` does exactly that for the
 * delete-account sheet, and the comment there explains why.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  /** Small-caps sheet title, e.g. "NEW SESSION". */
  title: string;
  children: React.ReactNode;
  /** Set false when the body manages its own scrolling. */
  scroll?: boolean;
}) {
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={{ padding: GUTTER, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    children
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <Screen>
        <View style={s.sheetHead}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={s.sheetCancel}
          >
            <Text style={[T.buttonSmall, { color: color.textMuted }]}>Cancel</Text>
          </Pressable>
          <Label>{title}</Label>
          {/* Balances the cancel control so the title stays optically centred. */}
          <View style={s.sheetCancel} />
        </View>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* Not rendered while closed: a hidden Modal still mounts its
              children, so an invisible sheet would keep running effects and
              holding whatever was last typed into it. */}
          {visible ? body : null}
        </KeyboardAvoidingView>
      </Screen>
    </Modal>
  );
}

/**
 * A placeholder block for a loading state.
 *
 * ── Why not a spinner ───────────────────────────────────────────────────────
 * The analysis screen and the pricing screen both showed a single centred
 * `ActivityIndicator` on an otherwise blank page. A dot in the middle of
 * nothing communicates "wait" and nothing else: it does not say how much is
 * coming, it does not hold the layout, and when the content lands the whole
 * page jumps.
 *
 * Blocks in the shape of the content that is loading answer all three. They are
 * deliberately static — a shimmer animation would be motion for its own sake on
 * a screen whose whole argument is that it does not decorate.
 */
export function SkeletonBlock({
  height,
  width = "100%",
  style,
}: {
  height: number;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[s.skeleton, { height, width }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/**
 * An opaque strip behind the status bar, with a short fade below it.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * Every scrolling screen here runs its content to the top edge, so text passes
 * under the status bar as you scroll. That is ordinary iOS behaviour and most
 * apps live with it — but Caliper's paper is light and its status bar is dark,
 * so a headline scrolling past renders dark-on-dark straight through the clock.
 * Both become unreadable at once. On the welcome screen the word "measured."
 * sits directly behind the time.
 *
 * The strip is paper, the same colour as the page, so it is invisible until
 * something scrolls beneath it. The fade below keeps the edge from reading as
 * a hard line across the screen.
 *
 * Only needed on screens whose scroll view reaches the top edge. Screens with a
 * fixed header outside the scroll view (auth, pricing, onboarding, chat) do not
 * need it.
 */
export function StatusBarScrim() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[[s.statusScrim, { height: insets.top }], { pointerEvents: "none" }]}>
      <View style={{ flex: 1, backgroundColor: color.paper }} />
      <FooterFade height={14} bands={6} from="bottom" />
    </View>
  );
}

/**
 * The paper fade that sits above a floating footer.
 *
 * A dock or a footer bar that floats over a scroll view slices the content at
 * its top edge: a line of prose is cut in half mid-stroke and the page looks
 * broken rather than layered. A short gradient from transparent to paper lets
 * the text dissolve into the footer instead.
 *
 * Rendered *behind* the footer's own content and above the scroll view, so it
 * never intercepts a touch.
 */
export function FooterFade({
  height = 28,
  bands = 8,
  tone = color.paper,
  from = "top",
}: {
  height?: number;
  bands?: number;
  /** The surface being faded into. Paper by default; ink for the dark hero. */
  tone?: string;
  /** "top" fades content into a footer below; "bottom" into a header above. */
  from?: "top" | "bottom";
}) {
  /**
   * Drawn as a short opacity ramp rather than with `expo-linear-gradient`.
   *
   * The gradient version crashed the app on device:
   *
   *     View config getter callback for component
   *     `ViewManagerAdapter_ExpoLinearGradient` must be a function
   *
   * `expo-linear-gradient` is declared in package.json but had never been
   * imported by any screen, so its native view manager was never linked into
   * the iOS build. react-native-web implements it in JavaScript, which is why
   * the browser build rendered it perfectly and the simulator did not.
   *
   * Taking a native dependency — and a 30-45 minute rebuild — for a 28pt
   * cosmetic fade is the wrong trade. Eight stacked bands are indistinguishable
   * at this size and need nothing native.
   */
  return (
    <View
      style={[[s.footerFade, from === "top" ? { height, top: -height } : { height, bottom: 0 }], { pointerEvents: "none" }]}
    >
      {Array.from({ length: bands }, (_, i) => {
        // Ease in, so the far end of the ramp is imperceptible rather than a
        // visible first step.
        const step = Math.pow((i + 1) / bands, 2);
        return (
          <View
            key={i}
            style={{
              height: height / bands,
              backgroundColor: tone,
              opacity: from === "top" ? step : 1 - step + 1 / bands,
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * Reserve exactly as much room as a floating footer actually occupies.
 *
 * ── Why this is a hook and not a constant ───────────────────────────────────
 * Screens with an absolutely-positioned footer used to reserve a hand-picked
 * number at the end of their scroll: `paddingBottom: 200` on onboarding,
 * `insets.bottom + 120` on the analysis screen. Both were measured once, by
 * eye, against one example of the footer's content.
 *
 * Then the content grew. The analysis dock holds a `Prescription` whose text
 * wraps; with a three-line drill it renders **164pt tall against 120pt of
 * reserved space**, and the last line of the last drill sits under it with no
 * scroll left to recover — permanently unreadable. Onboarding's footer carries
 * a summary line that reads "8 picked · Squat, Deadlift, …" and wraps past its
 * 200pt allowance the moment someone picks a few sports.
 *
 * A number cannot track content it has never seen. Measuring can.
 *
 *   const [clearance, onFooterLayout] = useFooterClearance();
 *   <ScrollView contentContainerStyle={{ paddingBottom: clearance }} />
 *   <View style={s.dock} onLayout={onFooterLayout} />
 *
 * `gap` is the breathing room between the last content and the footer's top
 * edge. `fallback` is used before the first layout pass so the first frame is
 * not visibly short.
 */
export function useFooterClearance(
  { gap = 16, fallback = 120 }: { gap?: number; fallback?: number } = {},
): [number, (e: LayoutChangeEvent) => void] {
  const [height, setHeight] = React.useState<number | null>(null);

  const onLayout = React.useCallback((e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    // Only commit real changes: re-setting an identical height on every layout
    // pass would re-render the screen forever.
    setHeight((prev) => (prev === null || Math.abs(prev - next) > 1 ? next : prev));
  }, []);

  return [(height ?? fallback) + gap, onLayout];
}

/** Avatar: the athlete's photo when one is set, their initials otherwise. */
export function Avatar({ name, uri, size = 40 }: { name: string; uri?: string | null; size?: number }) {
  const round = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return (
      <ExpoImage
        source={{ uri }}
        style={[s.avatar, round]}
        contentFit="cover"
        transition={120}
        accessibilityLabel={`${name}'s profile photo`}
      />
    );
  }

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <View style={[s.avatar, round]}>
      <Text style={[T.measured, { color: color.onInk, fontSize: size * 0.3 }]}>{initials}</Text>
    </View>
  );
}


// ─── Structure ───────────────────────────────────────────────────────────────

/**
 * A screen's top block: a stamp or label, a title, and at most one action.
 *
 * Twelve screens defined their own. Four of the twelve — the auth screens —
 * were byte-identical to each other, and the rest disagreed only on
 * `paddingBottom` and `alignItems`, which is not a design decision anyone made
 * so much as a value nobody copied consistently.
 */
export function ScreenHeader({
  label,
  title,
  leading,
  trailing,
  style,
}: {
  /** Small-caps line above the title — a date stamp, a step count, a section. */
  label?: string;
  title?: string;
  /** Usually a BackButton. */
  leading?: React.ReactNode;
  /** At most one control. Two actions in a header means neither is primary. */
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.header, style]}>
      {!!leading && <View style={s.headerLeading}>{leading}</View>}
      <View style={s.headerBody}>
        {!!label && <Label>{label}</Label>}
        {!!title && (
          <Text scale="display" style={[T.screenTitle, label ? { marginTop: 6 } : null]}>
            {title}
          </Text>
        )}
      </View>
      {!!trailing && <View style={s.headerTrailing}>{trailing}</View>}
    </View>
  );
}

/**
 * A hairline-separated row.
 *
 * Three screens had their own row component and five more had a bare style
 * block, between them using four different vertical paddings (11, 12, 13, 15)
 * and two different rule colours for what is visibly one thing. This is 13 and
 * `color.rule`, and it clears 44pt by construction rather than by luck.
 */
export function ListRow({
  children,
  first = false,
  style,
}: {
  children: React.ReactNode;
  /** Drops the top rule, so a list does not open with a floating line. */
  first?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.listRow, first && s.listRowFirst, style]}>{children}</View>
  );
}

/**
 * A card-sized cell in a small-multiples grid.
 *
 * Four of these existed at three widths (48.5%, 31.5%, flex) and three radii.
 * `columns` replaces the magic percentages: the gap is subtracted here rather
 * than being absorbed into a hand-tuned fraction, which is why those fractions
 * were 48.5 and 31.5 rather than 50 and 33.3 in the first place.
 */
export function Tile({
  children,
  columns = 2,
  gap = 10,
  tone = color.card,
  style,
}: {
  children: React.ReactNode;
  columns?: 2 | 3;
  gap?: number;
  tone?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      // The outer view is layout only — width and gutter. The tone belongs on
      // the inner surface, which is the thing with a radius and a shadow.
      style={[s.tile, { width: `${100 / columns}%`, paddingHorizontal: gap / 2 }, style]}
    >
      <View style={[s.tileInner, { backgroundColor: tone }]}>{children}</View>
    </View>
  );
}

/**
 * Content that settles in on first paint.
 *
 * A thin wrapper so a screen can stagger its sections without importing
 * Reanimated. Under Reduce Motion this renders at rest on its first frame —
 * see `lib/motion.ts` for why that is structural rather than remembered.
 */
export function Entering({
  children,
  index = 0,
  style,
}: {
  children: React.ReactNode;
  /** Position among siblings, for a stagger. */
  index?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const entrance = useEntrance(index);
  return <Animated.View style={[style, entrance]}>{children}</Animated.View>;
}

const s = StyleSheet.create({
  header: {
    paddingHorizontal: GUTTER,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  headerLeading: { paddingTop: 2 },
  headerBody: { flex: 1 },
  headerTrailing: { paddingTop: 2 },

  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: color.rule,
  },
  listRowFirst: { borderTopWidth: 0 },

  tile: { marginBottom: 10 },
  tileInner: {
    borderRadius: radius.tile,
    padding: 14,
  },

  screen: { flex: 1, backgroundColor: color.paper },


  card: { backgroundColor: color.card, borderRadius: radius.card },

  cardPadded: { padding: 20 },



  footerFade: { position: "absolute", left: 0, right: 0 },

  statusScrim: { position: "absolute", left: 0, right: 0, top: 0, zIndex: 5 },


  skeleton: { backgroundColor: color.inkWashFaint, borderRadius: 12 },


  sheetHead: {
    paddingHorizontal: GUTTER,
    paddingTop: 20,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  sheetCancel: { minWidth: 56, minHeight: 44, justifyContent: "center" },


  avatar: { backgroundColor: color.ink, alignItems: "center", justifyContent: "center" },
});
