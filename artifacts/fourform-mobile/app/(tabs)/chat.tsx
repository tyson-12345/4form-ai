/**
 * Coach — Atlas.
 *
 * Two things distinguish this from a generic chat:
 *
 *  1. **Evidence cards.** When Atlas cites a session, that session appears as a
 *     tappable card under the message. A claim about your movement always shows
 *     what it was drawn from.
 *
 *  2. **Prescriptions are cobalt.** A message that ends in a concrete next
 *     action is rendered as the cobalt card, not as prose — same treatment as
 *     the prescription on Home, so "the thing to do next" looks the same
 *     everywhere in the app.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  type ViewStyle,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as haptics from "@/lib/haptics";

import {
  Card,
  Chevron,
  Label,
  PlayGlyph,
  Screen,
  Text,
  SendGlyph,
  TrashGlyph,
  Tappable,
} from "@/components/caliper";
import { color, type as T, radius, GUTTER, TAB_BAR, font } from "@/constants/caliper";
import {
  chat as chatApi,
  analyses as analysesApi,
  subscriptions as subscriptionsApi,
  type ChatRecord,
  type AnalysisRecord,
  ApiError,
  NetworkError,
} from "@/lib/api";
import { useAuth } from "@/lib/authContext";
import { displaySport } from "@/constants/sports";
import { formatBiomechanicsTextSafe } from "../../utils/formatBiomechanics";
import { alert } from "@/lib/alert";

const STARTERS = [
  "What should I film next?",
  "Where am I losing most?",
  "Compare my last two sessions",
];

export default function CoachScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subscription } = useAuth();

  const [messages, setMessages] = useState<ChatRecord[]>([]);
  const [sessions, setSessions] = useState<AnalysisRecord[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [serverLocked, setServerLocked] = useState(false);

  /**
   * The composer is `multiline`, so on iOS the return key inserts a newline and
   * never closes the keyboard. Without an explicit way out, a focused composer
   * trapped the user: the only exits were sending a message or leaving the tab.
   * Tracking focus lets us show a Done affordance for exactly as long as the
   * keyboard is up.
   */
  const [inputFocused, setInputFocused] = useState(false);

  /**
   * The wall must come from the tier, not from a server error. GET /api/chat
   * is deliberately not tier-gated (history is the user's own data), so a free
   * user's history call succeeds — and keying `locked` off an UPGRADE_REQUIRED
   * from that call meant a free user saw the full chat UI, typed a message,
   * and only hit the paywall after the effort. The server still enforces on
   * POST; `serverLocked` catches the disagreement case where the client
   * believes a tier the server refuses.
   */
  const tier = subscription?.tier ?? "free";
  const locked = serverLocked || !(tier === "pro" || tier === "elite");

  /**
   * Whether purchases actually work right now. Drives the lock card's copy so
   * a free user is told "not on sale yet" before tapping through, not after.
   * Defaults to false (billing assumed on) so if the plans call fails we show
   * the normal upsell rather than wrongly announcing the store is closed.
   */
  const [billingOff, setBillingOff] = useState(false);
  useEffect(() => {
    if (!locked) return;
    let cancelled = false;
    subscriptionsApi
      .plans()
      .then(({ billingEnabled }) => {
        if (!cancelled) setBillingOff(!billingEnabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [locked]);

  const scrollRef = useRef<FlatList<ChatRecord>>(null);

  const load = useCallback(async () => {
    try {
      const [history, list] = await Promise.allSettled([
        chatApi.history(),
        analysesApi.list(),
      ]);
      if (history.status === "fulfilled") setMessages(history.value.messages);
      else if (history.reason instanceof ApiError && history.reason.code === "UPGRADE_REQUIRED") {
        setServerLocked(true);
      }
      if (list.status === "fulfilled") setSessions(list.value.analyses);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * Whether the reader is already at the live end of the transcript.
   *
   * Auto-scrolling unconditionally would yank someone out of the history they
   * scrolled up to read the moment a reply lands.
   *
   * Only the reader's *own* scrolling is allowed to change this. The list also
   * emits scroll events while it lays out, and one of those arrives at offset 0
   * with the full content height already measured — which reads exactly like
   * "the reader is at the top". Honouring it pinned the transcript to the top
   * and it never stuck to the end at all.
   *
   * `settled` gates those out: scroll positions only count as intent once the
   * transcript has been placed at its end for the first time. Deliberately not
   * keyed off `onScrollBeginDrag`, which is a touch concept — on the web build
   * a wheel never fires it, so the gate would never open.
   */
  const atEnd = useRef(true);
  const settled = useRef(false);

  /**
   * Stick to the end when the content grows.
   *
   * This was a `setTimeout(..., 80)` keyed on `messages.length`. Eighty
   * milliseconds is a guess about how long layout takes, and on this list it is
   * the wrong guess: a coach reply carries an evidence card and a prescription
   * bubble, which finish measuring after the timer has already fired against a
   * shorter content height. Opening the Coach tab landed the transcript 16px
   * short of the end every time, and any interaction afterwards silently
   * corrected it — which is exactly the signature of a race.
   *
   * Two mechanisms, because neither is sufficient alone:
   *
   *  - `onContentSizeChange` is the right hook and fires on native, but
   *    react-native-web's `FlatList` does not forward it, so on the audit
   *    surface it never runs.
   *  - A double `requestAnimationFrame` waits for a real committed paint rather
   *    than guessing at one. That is what the old 80ms was reaching for.
   *
   * Both call the same guarded function, so a duplicate is a no-op.
   */
  const stickToEnd = useCallback(() => {
    if (!atEnd.current) return;
    scrollRef.current?.scrollToEnd({ animated: true });
    settled.current = true;
  }, []);

  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(stickToEnd);
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [messages.length, sending, stickToEnd]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sending) return;

    setInput("");
    setSending(true);

    // Optimistic echo so the athlete's own message appears instantly.
    const pending: ChatRecord = {
      id: `pending-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, pending]);

    try {
      const { userMessage, assistantMessage } = await chatApi.send(content);
      setMessages((prev) => [...prev.filter((m) => m.id !== pending.id), userMessage, assistantMessage]);
    } catch (err) {
      if (err instanceof ApiError && err.code === "UPGRADE_REQUIRED") {
        setMessages((prev) => prev.filter((m) => m.id !== pending.id));
        setInput(content);
        setServerLocked(true);
        return;
      }

      /**
       * The coach failed, but the message did not.
       *
       * `POST /api/chat` writes the athlete's message *before* asking the coach
       * and deliberately keeps it on failure — "losing what someone typed is
       * worse than showing them an error" — then returns it on the 503 so the
       * client can keep showing it. This screen used to discard all of that: it
       * removed the optimistic bubble, put the text back in the composer, and
       * said "your message wasn't sent" about a message that had been stored.
       *
       * Three things were wrong with that. The sentence was untrue. The message
       * silently reappeared, unanswered, on the next load. And retyping it sent
       * a second copy — the exact duplication the server's design was avoiding.
       *
       * So: swap the optimistic bubble for the row the server actually stored,
       * leave the composer empty, and say what happened.
       */
      const stored =
        err instanceof ApiError && (err.body.userMessage as ChatRecord | undefined);
      if (stored) {
        setMessages((prev) => prev.map((m) => (m.id === pending.id ? stored : m)));
        alert(
          "Atlas couldn't reply",
          `${err instanceof ApiError ? err.message : ""} Your message is saved, so just ask again when you're ready.`.trim(),
        );
        return;
      }

      // Nothing was stored, so the optimistic echo has to go and the athlete
      // gets their words back.
      setMessages((prev) => prev.filter((m) => m.id !== pending.id));
      setInput(content);

      if (err instanceof NetworkError) {
        alert("Can't reach Atlas", err.message);
        return;
      }
      alert(
        "Atlas is unavailable",
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Your message wasn't sent. Try again in a moment.",
      );
    } finally {
      setSending(false);
    }
  }

  const measuredCount = sessions.filter(
    (a) => a.status === "complete" && a.analysisMethod === "pose-measured",
  ).length;

  // ── Paywalled ──
  if (locked) {
    return (
      <Screen>
        <View style={[s.head, { paddingTop: insets.top + 14 }]}>
          <View>
            <Text scale="display" style={T.screenTitle}>Atlas</Text>
            <Label style={{ marginTop: 2 }}>YOUR AI COACH</Label>
          </View>
        </View>

        <View style={s.lockWrap}>
          <Card>
            <Label>PRO</Label>
            <Text style={[T.cardTitle, { marginTop: 8, fontSize: 20 }]}>
              Atlas reads your whole history
            </Text>
            <Text style={[T.body, { marginTop: 10 }]}>
              Ask about any session and Atlas answers from your measurements: which joint,
              which angle, which clip. Included with Pro.
            </Text>
            {/* When billing is off, say so here — before the tap. The old card
                sent every free user to Pricing to discover that nothing can be
                purchased: a dead end walked in full, one screen at a time. */}
            {billingOff && (
              <Text style={[T.bodySmall, { marginTop: 8, color: color.textMuted }]}>
                Pro isn't on sale quite yet. Here's what it will include.
              </Text>
            )}
            <Tappable
              onPress={() => router.push("/pricing")}
              accessibilityRole="button"
              style={[s.lockCta]}
            >
              <Text style={[T.button, { color: color.onCobalt }]}>
                {billingOff ? "See what's coming" : "See plans"}
              </Text>
            </Tappable>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={[s.head, { paddingTop: insets.top + 14 }]}>
          <View style={{ flex: 1 }}>
            <Text scale="display" style={T.screenTitle}>Atlas</Text>
            <Label style={{ marginTop: 2 }}>
              {measuredCount > 0
                ? `READS ALL ${measuredCount} OF YOUR SESSIONS`
                : "YOUR AI COACH"}
            </Label>
          </View>
          {messages.length > 0 && (
            <Tappable
              onPress={() =>
                alert("Clear conversation", "This deletes your chat history with Atlas.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear",
                    style: "destructive",
                    onPress: async () => {
                      await chatApi.clear().catch(() => {});
                      setMessages([]);
                    },
                  },
                ])
              }
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Clear conversation"
              style={s.headBtn}
            >
              <TrashGlyph />
            </Tappable>
          )}
        </View>

        {/* ── Not a medical assessment ──
            Atlas prescribes exercise — sets, reps, drills — and this was the
            only coaching surface in the app carrying none of the wording
            signup and the analysis screen both carry. Same sentence as
            analysis/[id].tsx, deliberately: one claim, worded once.

            Above the transcript rather than under it. A disclaimer inside the
            list is a disclaimer that scrolls away with the conversation, and
            this list auto-scrolls to its end. */}
        <Text style={s.disclaimer}>
          Not a medical assessment or an injury prediction. See a professional about pain
          or injury.
        </Text>

        {/*
          A FlatList, because a transcript only grows. Every message was
          mounted eagerly, and a coach reply carries evidence cards and a
          prescription bubble — the heaviest rows in the app.

          Not `inverted`: this transcript reads top-down and the empty state and
          typing indicator belong at their natural ends. Sticking with the
          upright list keeps `scrollToEnd` as the "new message arrived"
          behaviour rather than inverting every offset in the file.
        */}
        <FlatList<ChatRecord>
          ref={scrollRef}
          data={loading ? [] : messages}
          keyExtractor={(msg) => msg.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
          // Dragging the transcript puts the keyboard away, which is the gesture
          // people already expect from every other chat app. Without this the
          // composer had no dismiss gesture at all.
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={stickToEnd}
          scrollEventThrottle={100}
          onScroll={(e) => {
            if (!settled.current) return;
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            // A generous threshold: "near the end" should survive the rubber
            // band and a half-finished momentum scroll.
            atEnd.current =
              contentOffset.y >= contentSize.height - layoutMeasurement.height - 48;
          }}
          renderItem={({ item: msg }) => (
            <Message
              message={msg}
              sessions={sessions}
              onOpenSession={(id) => router.push(`/analysis/${id}`)}
            />
          )}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={{ marginTop: 40 }} color={color.textFaint} />
            ) : (
              <View style={s.empty}>
                <Text scale="display" style={[T.headlineSmall, { textAlign: "center" }]}>
                  Ask about any session.
                </Text>
                <Text style={[T.body, { textAlign: "center", marginTop: 10 }]}>
                  {measuredCount > 0
                    ? "Atlas has your measurements: joint angles, bands, and every flag."
                    : "Measure a clip first and Atlas will have something to work from."}
                </Text>
              </View>
            )
          }
          ListFooterComponent={
            sending ? (
              <View style={s.typing}>
                <ActivityIndicator size="small" color={color.textFaint} accessibilityLabel="Atlas is replying" />
                <Text style={[T.bodySmall, { marginLeft: 8 }]}>Atlas is reading your sessions…</Text>
              </View>
            ) : null
          }
        />

        {messages.length === 0 && !loading && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // A horizontal ScrollView stretches its children to the container's
            // height by default, which turned these pills into full-height
            // capsules. `alignItems: center` sizes them to their content.
            contentContainerStyle={{
              paddingHorizontal: GUTTER,
              gap: 8,
              paddingBottom: 12,
              alignItems: "center",
            }}
            style={{ flexGrow: 0 }}
          >
            {STARTERS.map((starter) => (
              <Tappable
                key={starter}
                onPress={() => send(starter)}
                // Had a role but no name, so VoiceOver announced four
                // identical unlabelled buttons.
                accessibilityLabel={starter}
                style={s.starter}
              >
                <Text style={[T.message, { fontSize: 13 }]}>{starter}</Text>
              </Tappable>
            ))}
          </ScrollView>
        )}

        {/*
          A multiline field has no return-key dismiss, so give the keyboard an
          explicit exit. Shown only while focused, and only where a software
          keyboard exists: on the web build `Keyboard.dismiss()` is a no-op, so
          this was a button that appeared on focus and did nothing.

          Absolutely positioned, so appearing does not reflow the transcript.
          In flow it shortened the list by its own height at the moment of
          focus, which pushed the reader further from the end than they were
          before they tapped the composer.

          `minTarget` rather than `hitSlop`: the label alone measured 60x30, and
          hitSlop does not exist on web and is invisible to the audit — the same
          argument `Tappable`'s own docblock makes.
        */}
        {inputFocused && Platform.OS !== "web" && (
          <Tappable
            onPress={() => Keyboard.dismiss()}
            minTarget
            accessibilityRole="button"
            accessibilityLabel="Dismiss keyboard"
            style={s.dismissBar}
          >
            <Text style={[T.bodySmall, { color: color.textMuted }]}>Done</Text>
          </Tappable>
        )}

        {/* The tab bar floats at a fixed offset from the screen bottom, so the
            composer clears its top edge rather than the safe-area inset. */}
        <View
          style={[
            s.composer,
            { paddingBottom: TAB_BAR.clearance + 14 },
          ]}
        >
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="Ask about any session…"
            placeholderTextColor={color.textGhost}
            multiline
            maxLength={2000}
            editable={!sending}
          />
          <Tappable
            onPress={() => send()}
            disabled={!input.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !input.trim() || sending }}
            // The dim comes from Tappable too: an opacity set here is composed
            // before the press style and was being overwritten by it, so the
            // send button looked ready with an empty composer.
            style={s.sendBtn}
          >
            <SendGlyph />
          </Tappable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ─── Message ─────────────────────────────────────────────────────────────────

function Message({
  message,
  sessions,
  onOpenSession,
}: {
  message: ChatRecord;
  sessions: AnalysisRecord[];
  onOpenSession: (id: string) => void;
}) {
  const isUser = message.role === "user";

  /**
   * Long-press to copy, with something to show for it.
   *
   * `Clipboard.setStringAsync` was called bare: no haptic, no confirmation, no
   * change on screen. The athlete long-pressed a message and, as far as the
   * interface was concerned, nothing happened — the copy either worked or did
   * not and there was no way to tell.
   *
   * The bubbles also carried no accessibility information at all. A `Pressable`
   * with no role announces every message in the conversation as a button, so
   * VoiceOver read a transcript as a list of fourteen unlabelled controls. They
   * are text; copying is an *action on* that text, which is what
   * `accessibilityActions` is for.
   */
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void Clipboard.setStringAsync(message.content);
    haptics.select();
    setCopied(true);
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [message.content]);

  const copyProps = {
    onLongPress: copy,
    // A message is text that can be copied, not a button. On iOS `role="text"`
    // plus a named action is exactly that: VoiceOver reads the message rather
    // than announcing "button", and Copy appears in the actions rotor.
    //
    // react-native-web drops this role (it is an iOS concept, not a valid ARIA
    // role), and gives every Pressable `cursor: pointer` regardless — so on the
    // browser build a message bubble advertised itself as clickable while a
    // plain click did nothing. The cursor override below keeps the web surface
    // honest about that.
    accessibilityRole: "text" as const,
    accessibilityActions: [{ name: "copy", label: "Copy message" }],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
      if (e.nativeEvent.actionName === "copy") copy();
    },
  };

  if (isUser) {
    return (
      <View style={{ alignItems: "flex-end" }}>
        <Tappable {...copyProps} style={[s.userBubble, s.textCursor]}>
          <Text style={[T.message, { color: color.onInk }]}>{message.content}</Text>
        </Tappable>
        {copied && <Label style={{ marginTop: 4, marginBottom: 2 }}>COPIED</Label>}
      </View>
    );
  }

  // Atlas writes like a clinician if left alone; translate the jargon down to
  // language an amateur can act on. Markdown-safe so code spans and links in a
  // reply survive intact. Applied at render only — the stored message keeps
  // the original wording, so this stays reversible and copy still yields it.
  const spoken = formatBiomechanicsTextSafe(message.content);

  // Split a trailing prescription off the body so it can wear cobalt.
  const { body, prescription } = splitPrescription(spoken);
  const cited = findCitedSession(message.content, sessions);

  return (
    <View style={{ marginBottom: 14 }}>
      <Tappable {...copyProps} style={[s.coachBubble, s.textCursor]}>
        <Text style={T.message}>{body}</Text>

        {cited && (
          <Tappable
            onPress={() => onOpenSession(cited.id)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${cited.title}, the session this refers to`}
            style={[s.evidence]}
          >
            <View style={s.evidenceGlyph}>
              <PlayGlyph size={13} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={T.rowTitle} numberOfLines={1}>
                {cited.title}
              </Text>
              <Text style={[T.measuredSmall, { marginTop: 2 }]}>
                {displaySport(cited.sport).toUpperCase()}
                {cited.overallScore !== null ? ` · ${Math.round(cited.overallScore)}` : ""}
                {" · THE EVIDENCE"}
              </Text>
            </View>
            <Chevron />
          </Tappable>
        )}
      </Tappable>

      {prescription && (
        <View style={s.prescriptionBubble}>
          {/* The shared `Prescription` component's default label, spelled out
              because this bubble is a hand-rolled copy of it rather than the
              component. It read "PRESCRIPTION" — a regulated word to stamp on
              exercise a language model just wrote, and the only place in the
              app that said it. */}
          <Label tone={color.onCobaltMuted}>DO THIS NEXT</Label>
          <Text style={[T.prescriptionSmall, { marginTop: 6 }]}>{prescription}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Peel a closing instruction off the end of a coach reply.
 *
 * Atlas is prompted to end with one concrete action; rendering that as the
 * cobalt card makes "the next thing to do" look identical across the app.
 * Falls back to leaving the message whole when the shape isn't there — never
 * invents a prescription.
 */
function splitPrescription(text: string): { body: string; prescription: string | null } {
  const paragraphs = text.trim().split(/\n{2,}/);
  if (paragraphs.length < 2) return { body: text.trim(), prescription: null };

  const last = paragraphs[paragraphs.length - 1]!.trim();
  const looksActionable =
    last.length <= 220 &&
    /\b(\d+\s*[×x]\s*\d+|sets?|reps?|before|after|today|this week|try|start|add|hold|drill)\b/i.test(
      last,
    );

  if (!looksActionable) return { body: text.trim(), prescription: null };
  return { body: paragraphs.slice(0, -1).join("\n\n").trim(), prescription: last };
}

/** Find a session the reply names, so we can attach it as evidence. */
function findCitedSession(
  text: string,
  sessions: AnalysisRecord[],
): AnalysisRecord | undefined {
  const haystack = text.toLowerCase();
  return sessions
    .filter((sn) => sn.status === "complete" && sn.title.length >= 4)
    .find((sn) => haystack.includes(sn.title.toLowerCase()));
}

// ─── Glyphs ──────────────────────────────────────────────────────────────────

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  head: {
    paddingHorizontal: GUTTER,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  /**
   * Web only. A Pressable that exists purely for long-press should not show a
   * pointer cursor: on a browser that reads as "click me", and clicking does
   * nothing. Ignored on native, where there is no cursor.
   */
  textCursor: { cursor: "text" } as unknown as ViewStyle,

  headBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.card,
    alignItems: "center",
    justifyContent: "center",
  },

  empty: { paddingTop: 60, paddingHorizontal: 12 },

  // Italic bodySmall, matching the same line on the analysis screen.
  disclaimer: {
    ...T.bodySmall,
    fontStyle: "italic",
    paddingHorizontal: GUTTER,
    paddingBottom: 12,
  },

  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "78%",
    backgroundColor: color.ink,
    borderRadius: 22,
    borderBottomRightRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 14,
  },
  coachBubble: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    backgroundColor: color.card,
    borderRadius: 22,
    borderBottomLeftRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  prescriptionBubble: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    backgroundColor: color.cobalt,
    borderRadius: 22,
    borderBottomLeftRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 8,
  },

  evidence: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: color.rule,
  },
  evidenceGlyph: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
  },

  typing: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },

  starter: {
    backgroundColor: color.card,
    borderRadius: radius.pill,
    paddingHorizontal: 15,
    paddingVertical: 9,
    // 39pt before; a suggestion chip is a real target like any other.
    minHeight: 44,
    justifyContent: "center",
  },

  /** Floats over the transcript's last few pixels rather than displacing them. */
  dismissBar: {
    position: "absolute",
    right: GUTTER,
    bottom: TAB_BAR.clearance + 14 + 62,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: color.card,
    zIndex: 3,
  },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: GUTTER,
    paddingTop: 8,
  },
  input: {
    flex: 1,
    backgroundColor: color.card,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    maxHeight: 120,
    fontFamily: font.body,
    fontSize: 14,
    color: color.textPrimary,
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: color.ink,
    alignItems: "center",
    justifyContent: "center",
  },

  lockWrap: { paddingHorizontal: GUTTER, paddingTop: 20 },
  lockCta: {
    marginTop: 20,
    backgroundColor: color.cobalt,
    borderRadius: radius.pill,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
});
