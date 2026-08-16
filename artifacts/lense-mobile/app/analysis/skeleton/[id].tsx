/**
 * Review — interactive playback of a clip with the pose skeleton drawn over
 * it, plus live joint angles. The last screen migrated to Caliper: it was
 * still on the pre-Caliper theme shim, visibly out of step with the rest.
 *
 * This screen is for *looking*; the numbers that drive scoring were already
 * captured during the measurement step (app/analysis/measure.tsx). Nothing here
 * writes to the server.
 *
 * ── What Caliper changes here ───────────────────────────────────────────────
 *  - Every live reading sits on a micro band axis, against the safe band for
 *    the *athlete's sport* — the same zones the tracker classifies with, read
 *    from the same module, so the tile and the overlay cannot disagree.
 *  - Peak-position cards carry the OUTSIDE BAND / CAUTION chip and the peak
 *    angle in mono, matching the analysis screen's evidence cards.
 *
 * ── Earlier fixes preserved ─────────────────────────────────────────────────
 *  - Clips resolve through `videoStore` (documentDirectory, not the
 *    OS-evictable cache) — why the overlay used to die days after upload.
 *  - A missing clip says so, with a way forward, instead of a black WebView.
 *  - The tracker markup is shared with the measurement step, so the angle
 *    maths and risk zones cannot drift between this screen and the score.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  StyleSheet,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import * as ScreenOrientation from "expo-screen-orientation";
import * as FileSystem from "expo-file-system/legacy";

import { Screen, Label, Card, Chevron, MicroAxis, PrimaryButton } from "@/components/caliper";
import { color, type as T, radius, GUTTER, bandColor } from "@/constants/caliper";
import { profileForSport, jointKind, safeBand } from "@/constants/riskProfiles";
import { displaySport } from "@/constants/sports";
import { analyses as analysesApi } from "@/lib/api";
import { buildPoseHtml, type JointKey, type PoseMessage } from "@/lib/poseTracker";
import { resolveVideo, stageForWebView } from "@/lib/videoStore";

// Band colours come from the design system so the overlay, the angle tiles
// and the analysis screen cannot disagree about what "flagged" looks like.
const RISK_COLORS = bandColor;

type JointAngles = Record<JointKey, number>;
type RiskMap = Record<JointKey, number>;

/** Is angle `a` a worse pattern than `b` for this joint? */
function moreExtreme(key: string, a: number, b: number): boolean {
  if (key.includes("Knee")) return Math.abs(a - 130) > Math.abs(b - 130);
  if (key.includes("Hip")) return a < b;
  return a > b;
}

/**
 * Plain-language explanation for a flagged joint at its worst observed angle.
 *
 * These only fire for positions the *sport's own profile* flagged, so the copy
 * is band-relative: it describes the position against what this sport expects,
 * and never claims a straight or deep joint is universally dangerous — for
 * most sports those positions are correct technique and are never flagged.
 */
function jointInsight(key: string, deg: number): { title: string; body: string } {
  const side = key.startsWith("left") ? "Left" : "Right";
  if (key.includes("Knee")) {
    if (deg <= 95) {
      return {
        title: `${side} knee: deeper than your sport's band`,
        body: "The knee folded further than the band for your sport expects. If that depth is intentional, own it with control — slow the descent and keep the knee tracking over the toes.",
      };
    }
    return {
      title: `${side} knee: held near full extension`,
      body: "The knee sat near full extension for longer than your sport's band expects. For this sport that pattern is worth coaching — soften the knee slightly through the loaded part of the movement.",
    };
  }
  if (key.includes("Hip")) {
    return {
      title: `${side} hip: deeper hinge than your sport's band`,
      body: "The hips folded further than the band for your sport expects, which is where the lower back tends to round. Brace your core and hinge from the hips rather than collapsing the torso.",
    };
  }
  if (key.includes("Elbow")) {
    return {
      title: `${side} elbow: snapped to full extension`,
      body: "The arm reached a fully locked position under speed or load — the pattern your sport's band flags. Finish just short of lockout so the muscles absorb the last few degrees instead of the joint.",
    };
  }
  // A joint this build doesn't know by name. Describe the reading without
  // guessing the anatomy — the old fallthrough confidently explained an
  // "elbow" for anything unrecognised, which becomes a lie the day a
  // shoulder or ankle joins the tracker.
  return {
    title: `${side} joint: extreme position`,
    body: `This joint reached ${Math.round(deg)}° during the clip, the most extreme position we measured for it. Review the frame on the player above to see the position it describes.`,
  };
}

export default function SkeletonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const webviewRef = useRef<WebView>(null);

  const [sport, setSport] = useState("");
  const [title, setTitle] = useState("");
  const [angles, setAngles] = useState<JointAngles | null>(null);
  const [risk, setRisk] = useState<RiskMap | null>(null);
  const [maxLvl, setMaxLvl] = useState(0);
  const [peak, setPeak] = useState<Record<string, { lvl: number; deg: number }>>({});
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [modelReady, setModelReady] = useState(false);

  type Stage =
    | { kind: "loading" }
    | { kind: "ready"; htmlUri: string }
    | { kind: "missing" }
    | { kind: "error"; message: string };

  const [stage, setStage] = useState<Stage>({ kind: "loading" });

  const isLandscape = screenW > screenH;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  // ── Load the clip and build the tracker document ──
  useEffect(() => {
    let cancelled = false;
    setStage({ kind: "loading" });

    (async () => {
      if (!id) return;

      // Await the sport before building the tracker document: the risk zones
      // baked into it are sport-specific, and racing the fetch would classify
      // the clip against the generic profile whenever the network lost.
      let clipSport = "";
      try {
        const { analysis } = await analysesApi.get(id);
        clipSport = analysis.sport;
        if (!cancelled) setTitle(analysis.title);
      } catch {
        /* generic profile — still a working overlay */
      }
      if (cancelled) return;
      setSport(clipSport);

      // resolveVideo touches native-only file APIs; on web (where clips are
      // never stored) it throws rather than returning "missing". Same outcome
      // either way: there is no clip on this device to play.
      let resolution: Awaited<ReturnType<typeof resolveVideo>>;
      try {
        resolution = await resolveVideo(id);
      } catch {
        if (!cancelled) setStage({ kind: "missing" });
        return;
      }
      if (cancelled) return;

      if (resolution.status === "missing") {
        setStage({ kind: "missing" });
        return;
      }

      try {
        const staged = await stageForWebView(resolution.uri);
        const htmlPath = `${FileSystem.cacheDirectory}pose-review.html`;
        await FileSystem.writeAsStringAsync(
          htmlPath,
          buildPoseHtml({ videoUri: staged, mode: "interactive", sport: clipSport }),
          { encoding: FileSystem.EncodingType.UTF8 },
        );
        if (!cancelled) setStage({ kind: "ready", htmlUri: htmlPath });
      } catch {
        if (!cancelled) {
          setStage({ kind: "error", message: "Couldn't prepare this clip for playback." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // ── Orientation ──
  async function toggleOrientation() {
    try {
      if (isLandscape) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
      }
    } catch {
      /* orientation lock is best-effort */
    }
  }
  useEffect(() => () => void ScreenOrientation.unlockAsync().catch(() => {}), []);

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    let msg: PoseMessage;
    try {
      msg = JSON.parse(event.nativeEvent.data) as PoseMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "meta":
        if (msg.vw > 0 && msg.vh > 0) setVideoAspect(msg.vw / msg.vh);
        break;

      case "ready":
        setModelReady(true);
        break;

      case "error":
        setStage({ kind: "error", message: msg.message });
        break;

      case "angles": {
        setAngles(msg.data);
        setRisk(msg.risk);
        setMaxLvl(msg.maxLvl);
        setModelReady(true);

        // Keep the worst position seen for each joint across the whole review,
        // so the summary reflects the peak pattern rather than the last frame.
        setPeak((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const key of Object.keys(msg.risk) as JointKey[]) {
            const lvl = msg.risk[key];
            const deg = msg.data[key];
            // null-check, not falsiness: 0° is a real reading — the fully
            // closed joint, the most extreme measurement there is — and the
            // old `!deg` silently dropped it as missing.
            if (lvl < 1 || deg == null || !Number.isFinite(deg)) continue;
            const cur = next[key];
            if (!cur || lvl > cur.lvl || (lvl === cur.lvl && moreExtreme(key, deg, cur.deg))) {
              next[key] = { lvl, deg };
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        break;
      }
    }
  }, []);

  const angleCards = angles
    ? ([
        { label: "L KNEE", deg: angles.leftKnee, key: "leftKnee" },
        { label: "R KNEE", deg: angles.rightKnee, key: "rightKnee" },
        { label: "L HIP", deg: angles.leftHip, key: "leftHip" },
        { label: "R HIP", deg: angles.rightHip, key: "rightHip" },
        { label: "L ELBOW", deg: angles.leftElbow, key: "leftElbow" },
        { label: "R ELBOW", deg: angles.rightElbow, key: "rightElbow" },
      ] as const)
    : [];

  const insights = Object.entries(peak)
    .filter(([, v]) => v.lvl >= 1)
    .sort((a, b) => b[1].lvl - a[1].lvl)
    .map(([key, v]) => ({ key, lvl: v.lvl, deg: v.deg, ...jointInsight(key, v.deg) }));

  const flaggedNow = risk
    ? Object.values(risk).filter((lvl) => typeof lvl === "number" && lvl >= 2).length
    : 0;

  // The zones this clip is classified against — same module the tracker reads,
  // so the tile bands and the overlay colours cannot disagree.
  const zones = profileForSport(sport).zones;

  // Fit the WebView to the clip's aspect ratio; the in-page controls sit below.
  const CTRL_H = 112;
  const videoAreaH = Math.max(120, Math.min(screenW / videoAspect, screenH * 0.62));
  const portraitWebH = Math.round(videoAreaH + CTRL_H);

  const mediaBlock =
    stage.kind === "ready" ? (
      <WebView
        ref={webviewRef}
        source={{ uri: stage.htmlUri }}
        style={{
          flex: isLandscape ? 1 : undefined,
          height: isLandscape ? undefined : portraitWebH,
        }}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        allowingReadAccessToURL={FileSystem.cacheDirectory ?? "file:///"}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        // Only our local file:// page is a legitimate top-level document; the
        // MediaPipe CDN loads as a subresource, which this prop does not gate.
        // Narrowed from ["*"] so a navigation to any other origin is handed to the
        // OS browser rather than loaded inside this file://-privileged WebView.
        originWhitelist={["file://*"]}
        scrollEnabled={false}
        onMessage={handleMessage}
      />
    ) : (
      <View
        style={[
          s.slot,
          { height: isLandscape ? undefined : portraitWebH, flex: isLandscape ? 1 : undefined },
        ]}
      >
        {stage.kind === "loading" && (
          <>
            <ActivityIndicator color={color.cobalt} size="large" />
            <Text style={[T.bodySmall, { textAlign: "center", color: color.onInkFaint }]}>
              Preparing your clip…
            </Text>
          </>
        )}
        {stage.kind === "missing" && (
          <>
            <Text style={[T.cardTitle, { textAlign: "center", color: color.onInk }]}>
              This clip is no longer on your device
            </Text>
            <Text style={[T.bodySmall, { textAlign: "center", color: color.onInkFaint }]}>
              Videos are stored on your phone, not on our servers. This one was removed or the
              app was reinstalled. Your scores and coaching notes are safe. Only playback is
              gone.
            </Text>
            <View style={{ alignSelf: "stretch", marginTop: 8 }}>
              {/* Cobalt, not ink: the slot itself is ink, and this is the one
                  next action the screen can offer. */}
              <PrimaryButton
                label="Upload a new clip"
                tone={color.cobalt}
                labelTone={color.onCobalt}
                onPress={() => router.replace("/(tabs)/analyze")}
              />
            </View>
          </>
        )}
        {stage.kind === "error" && (
          <>
            <Text style={[T.cardTitle, { color: color.rust, textAlign: "center" }]}>
              Playback problem
            </Text>
            <Text style={[T.bodySmall, { textAlign: "center", color: color.onInkFaint }]}>
              {stage.message}
            </Text>
          </>
        )}
      </View>
    );

  return (
    <Screen>
      {!isLandscape && (
        <View style={[s.header, { paddingTop: topPad + 8 }]}>
          <Pressable onPress={() => router.back()} style={s.headerBtn} hitSlop={8}>
            <Chevron direction="left" tone={color.textSecondary} size={16} />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Label>REVIEW</Label>
            <Text style={[T.cardTitle, { marginTop: 2 }]} numberOfLines={1}>
              {title || displaySport(sport) || "Session"}
            </Text>
            {modelReady && (
              <Text style={[T.measuredSmall, { color: color.cobalt, marginTop: 2 }]}>
                POSE TRACKING ACTIVE
              </Text>
            )}
          </View>
          {stage.kind === "ready" ? (
            <Pressable onPress={toggleOrientation} style={s.headerBtn} hitSlop={8}>
              <Text style={[T.measuredSmall, { color: color.textSecondary }]}>⤢</Text>
            </Pressable>
          ) : (
            <View style={s.headerBtn} />
          )}
        </View>
      )}

      {isLandscape ? (
        <>
          {mediaBlock}
          <Pressable onPress={toggleOrientation} style={s.portraitBtn}>
            <Text style={[T.buttonSmall, { color: color.onInk }]}>Portrait</Text>
          </Pressable>
        </>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.mediaFrame}>{mediaBlock}</View>

          {angleCards.length > 0 && (
            <View style={s.section}>
              <View style={s.sectionHead}>
                <Label>LIVE JOINT ANGLES</Label>
                <View
                  style={[
                    s.pill,
                    {
                      backgroundColor:
                        maxLvl === 2 ? "rgba(194,84,46,0.12)" : "rgba(16,19,18,0.06)",
                    },
                  ]}
                >
                  <View
                    style={[
                      s.pillDot,
                      { backgroundColor: maxLvl >= 1 ? RISK_COLORS[maxLvl] : color.cobalt },
                    ]}
                  />
                  <Text
                    style={[
                      T.measuredSmall,
                      {
                        letterSpacing: 1,
                        color: maxLvl === 2 ? color.rust : color.textMuted,
                      },
                    ]}
                  >
                    {maxLvl === 2
                      ? `${Math.max(1, flaggedNow)} OUTSIDE BAND`
                      : maxLvl === 1
                        ? "CAUTION"
                        : "WITHIN BAND"}
                  </Text>
                </View>
              </View>

              <View style={s.grid}>
                {/* >= 0, not > 0 — a genuine 0° reading must render. */}
                {angleCards
                  .filter((a) => a.deg != null && a.deg >= 0)
                  .map(({ label, deg, key }) => {
                    const lvl = Math.max(0, Math.min(2, risk?.[key] ?? 0));
                    const flagged = lvl === 2;
                    const band = safeBand(zones[jointKind(key)]);
                    return (
                      <View
                        key={label}
                        style={[s.angleTile, flagged && s.angleTileFlagged]}
                      >
                        <Text
                          style={[
                            T.measuredSmall,
                            { letterSpacing: 1, color: flagged ? color.rust : color.textGhost },
                          ]}
                        >
                          {label}
                        </Text>
                        <Text
                          style={[
                            T.metricMedium,
                            { marginTop: 3 },
                            flagged && { color: color.rust },
                            lvl === 1 && { color: color.textFaint },
                          ]}
                        >
                          {deg}°
                        </Text>
                        <MicroAxis
                          value={deg}
                          min={0}
                          max={180}
                          bandLow={band?.low ?? null}
                          bandHigh={band?.high ?? null}
                          tone={flagged ? color.rust : color.ink}
                        />
                      </View>
                    );
                  })}
              </View>
            </View>
          )}

          {modelReady && stage.kind === "ready" && (
            <View style={s.section}>
              <Label style={{ marginBottom: 10 }}>WHAT WE SAW · PEAK POSITIONS</Label>
              {insights.length === 0 ? (
                <Card style={s.peakCard}>
                  <Text style={T.rowTitle}>Nothing outside your sport's bands so far</Text>
                  <Text style={[T.bodySmall, { marginTop: 5 }]}>
                    Every joint we tracked stayed within the range your sport expects. Play the
                    whole clip to check the full movement.
                  </Text>
                </Card>
              ) : (
                insights.map(({ key, lvl, deg, title: insightTitle, body }) => (
                  <Card key={key} style={s.peakCard}>
                    <View style={s.peakHead}>
                      <View
                        style={[
                          s.chip,
                          {
                            backgroundColor:
                              lvl === 2 ? "rgba(194,84,46,0.12)" : "rgba(16,19,18,0.06)",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            T.label,
                            {
                              fontSize: 9,
                              letterSpacing: 1,
                              color: lvl === 2 ? color.rust : color.textMuted,
                            },
                          ]}
                        >
                          {lvl === 2 ? "OUTSIDE BAND" : "CAUTION"}
                        </Text>
                      </View>
                      <Text style={[T.rowTitle, { flex: 1 }]}>{insightTitle}</Text>
                      <Text
                        style={[
                          T.measured,
                          { color: lvl === 2 ? color.rust : color.textMuted },
                        ]}
                      >
                        {Math.round(deg)}° PEAK
                      </Text>
                    </View>
                    <Text style={[T.bodySmall, { color: color.textSecondary, marginTop: 8 }]}>
                      {body}
                    </Text>
                  </Card>
                ))
              )}
              <Text style={[T.bodySmall, { marginTop: 12, fontStyle: "italic" }]}>
                Measured joint positions from your video, read against bands for your sport —
                not a medical assessment or an injury prediction. See a coach or physio for
                pain that persists.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: GUTTER,
    paddingBottom: 12,
    gap: 12,
  },
  headerBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.card,
    alignItems: "center",
    justifyContent: "center",
  },
  portraitBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    backgroundColor: "rgba(16,19,18,0.75)",
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },

  // The dark media block reads as one piece with the ink WebView background.
  mediaFrame: { backgroundColor: color.ink, overflow: "hidden" },
  slot: {
    backgroundColor: color.ink,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 28,
  },

  section: { paddingHorizontal: GUTTER, paddingTop: 20 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillDot: { width: 5, height: 5, borderRadius: 3 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  angleTile: {
    width: "31.5%",
    flexGrow: 1,
    backgroundColor: color.card,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  angleTileFlagged: {
    borderWidth: 1.5,
    borderColor: "rgba(194,84,46,0.4)",
  },

  peakCard: { marginBottom: 10, padding: 16, borderRadius: radius.cardSmall },
  peakHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
});
