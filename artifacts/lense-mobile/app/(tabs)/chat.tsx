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
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Svg, { Path, Polyline } from "react-native-svg";

import { Screen, Label, Card, Chevron, PlayGlyph } from "@/components/caliper";
import { color, type as T, radius, GUTTER, TAB_BAR, font } from "@/constants/caliper";
import {
  chat as chatApi,
  analyses as analysesApi,
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

  const scrollRef = useRef<ScrollView>(null);

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

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [messages.length, sending]);

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
      setMessages((prev) => prev.filter((m) => m.id !== pending.id));
      setInput(content);

      if (err instanceof ApiError && err.code === "UPGRADE_REQUIRED") {
        setServerLocked(true);
        return;
      }
      if (err instanceof NetworkError) {
        alert("Can't reach Atlas", err.message);
        return;
      }
      alert(
        "Atlas is unavailable",
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Your message wasn't sent — try again in a moment.",
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
            <Text style={T.screenTitle}>Atlas</Text>
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
              Ask about any session and Atlas answers from your measurements — which joint,
              which angle, which clip. Included with Pro.
            </Text>
            <Pressable
              onPress={() => router.push("/pricing")}
              style={({ pressed }) => [s.lockCta, pressed && { opacity: 0.85 }]}
            >
              <Text style={[T.button, { color: color.onCobalt }]}>See plans</Text>
            </Pressable>
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
            <Text style={T.screenTitle}>Atlas</Text>
            <Label style={{ marginTop: 2 }}>
              {measuredCount > 0
                ? `READS ALL ${measuredCount} OF YOUR SESSIONS`
                : "YOUR AI COACH"}
            </Label>
          </View>
          {messages.length > 0 && (
            <Pressable
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
              style={s.headBtn}
            >
              <TrashGlyph />
            </Pressable>
          )}
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={color.textFaint} />
          ) : messages.length === 0 ? (
            <View style={s.empty}>
              <Text style={[T.headlineSmall, { textAlign: "center" }]}>
                Ask about any session.
              </Text>
              <Text style={[T.body, { textAlign: "center", marginTop: 10 }]}>
                {measuredCount > 0
                  ? "Atlas has your measurements — joint angles, bands, and every flag."
                  : "Measure a clip first and Atlas will have something to work from."}
              </Text>
            </View>
          ) : (
            messages.map((msg) => (
              <Message
                key={msg.id}
                message={msg}
                sessions={sessions}
                onOpenSession={(id) => router.push(`/analysis/${id}`)}
              />
            ))
          )}

          {sending && (
            <View style={s.typing}>
              <ActivityIndicator size="small" color={color.textFaint} />
              <Text style={[T.bodySmall, { marginLeft: 8 }]}>Atlas is reading your sessions…</Text>
            </View>
          )}
        </ScrollView>

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
              <Pressable
                key={starter}
                onPress={() => send(starter)}
                style={({ pressed }) => [s.starter, pressed && { opacity: 0.8 }]}
              >
                <Text style={[T.message, { fontSize: 13 }]}>{starter}</Text>
              </Pressable>
            ))}
          </ScrollView>
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
            placeholder="Ask about any session…"
            placeholderTextColor={color.textGhost}
            multiline
            maxLength={2000}
            editable={!sending}
          />
          <Pressable
            onPress={() => send()}
            disabled={!input.trim() || sending}
            style={({ pressed }) => [
              s.sendBtn,
              { opacity: !input.trim() || sending ? 0.35 : pressed ? 0.85 : 1 },
            ]}
          >
            <SendGlyph />
          </Pressable>
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

  if (isUser) {
    return (
      <Pressable
        onLongPress={() => void Clipboard.setStringAsync(message.content)}
        style={s.userBubble}
      >
        <Text style={[T.message, { color: color.onInk }]}>{message.content}</Text>
      </Pressable>
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
      <Pressable
        onLongPress={() => void Clipboard.setStringAsync(message.content)}
        style={s.coachBubble}
      >
        <Text style={T.message}>{body}</Text>

        {cited && (
          <Pressable
            onPress={() => onOpenSession(cited.id)}
            style={({ pressed }) => [s.evidence, pressed && { opacity: 0.8 }]}
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
          </Pressable>
        )}
      </Pressable>

      {prescription && (
        <View style={s.prescriptionBubble}>
          <Label tone={color.onCobaltMuted}>PRESCRIPTION</Label>
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

function SendGlyph() {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
      <Path d="M12 19V5" stroke={color.onInk} strokeWidth={2} strokeLinecap="round" />
      <Polyline
        points="5 12 12 5 19 12"
        stroke={color.onInk}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function TrashGlyph() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6h18" stroke={color.textMuted} strokeWidth={2} strokeLinecap="round" />
      <Path
        d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
        stroke={color.textMuted}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        stroke={color.textMuted}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  head: {
    paddingHorizontal: GUTTER,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.card,
    alignItems: "center",
    justifyContent: "center",
  },

  empty: { paddingTop: 60, paddingHorizontal: 12 },

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
