/**
 * Skeleton overlay — interactive review of a clip with the pose skeleton drawn
 * over it, plus live joint angles.
 *
 * This screen is for *looking*; the numbers that drive scoring were already
 * captured during the measurement step (app/analysis/measure.tsx). Nothing here
 * writes to the server.
 *
 * ── Fixes in this rewrite ───────────────────────────────────────────────────
 *  - Clips resolve through `videoStore`, which keeps them in documentDirectory
 *    instead of the OS-evictable cache. This is why the overlay used to work
 *    right after upload and silently stop working days later.
 *  - A missing clip now says so, with a way forward, instead of rendering a
 *    black WebView forever.
 *  - The tracker markup is shared with the measurement step, so the angle maths
 *    and risk thresholds cannot drift between the number you see here and the
 *    number that produced your score.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  StyleSheet,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import * as ScreenOrientation from "expo-screen-orientation";
import * as FileSystem from "expo-file-system/legacy";

import { useColors } from "@/hooks/useColors";
import { analyses as analysesApi } from "@/lib/api";
import { buildPoseHtml, type JointKey, type PoseMessage } from "@/lib/poseTracker";
import { resolveVideo, stageForWebView } from "@/lib/videoStore";

const RISK_COLORS = ["#C6FF3A", "#FFC53D", "#FF5A4D"];

type JointAngles = Record<JointKey, number>;
type RiskMap = Record<JointKey, number>;

/** Is angle `a` a worse pattern than `b` for this joint? */
function moreExtreme(key: string, a: number, b: number): boolean {
  if (key.includes("Knee")) return Math.abs(a - 130) > Math.abs(b - 130);
  if (key.includes("Hip")) return a < b;
  return a > b;
}

/** Plain-language explanation for a flagged joint at its worst observed angle. */
function jointInsight(key: string, deg: number): { title: string; body: string } {
  const side = key.startsWith("left") ? "Left" : "Right";
  if (key.includes("Knee")) {
    if (deg <= 95) {
      return {
        title: `${side} knee — deep bend`,
        body: "The knee flexes very deep under load, which loads the patellar tendon and ACL. Control the descent, keep the knee tracking over your toes rather than caving inward, and build quad and glute strength.",
      };
    }
    return {
      title: `${side} knee — locked out`,
      body: "The knee reaches near-full extension. Keep a soft micro-bend at lockout so the muscles absorb load instead of the joint.",
    };
  }
  if (key.includes("Hip")) {
    return {
      title: `${side} hip — deep flexion`,
      body: "A very deep hip hinge tends to round the lower back. Brace your core, keep a neutral spine, and hinge from the hips rather than collapsing the torso.",
    };
  }
  return {
    title: `${side} elbow — locked out`,
    body: "The elbow reaches full extension under load. Keep a slight bend through the movement to protect the joint and surrounding tendons.",
  };
}

export default function SkeletonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const webviewRef = useRef<WebView>(null);

  const [sport, setSport] = useState("");
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

      analysesApi
        .get(id)
        .then(({ analysis }) => {
          if (!cancelled) setSport(analysis.sport);
        })
        .catch(() => {});

      const resolution = await resolveVideo(id);
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
          buildPoseHtml({ videoUri: staged, mode: "interactive" }),
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
            if (lvl < 1 || !deg) continue;
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
        { label: "L Knee", deg: angles.leftKnee, key: "leftKnee" },
        { label: "R Knee", deg: angles.rightKnee, key: "rightKnee" },
        { label: "L Hip", deg: angles.leftHip, key: "leftHip" },
        { label: "R Hip", deg: angles.rightHip, key: "rightHip" },
        { label: "L Elbow", deg: angles.leftElbow, key: "leftElbow" },
        { label: "R Elbow", deg: angles.rightElbow, key: "rightElbow" },
      ] as const)
    : [];

  const insights = Object.entries(peak)
    .filter(([, v]) => v.lvl >= 1)
    .sort((a, b) => b[1].lvl - a[1].lvl)
    .map(([key, v]) => ({ key, lvl: v.lvl, ...jointInsight(key, v.deg) }));

  // Fit the WebView to the clip's aspect ratio; the in-page controls sit below.
  const CTRL_H = 112;
  const videoAreaH = Math.max(120, Math.min(screenW / videoAspect, screenH * 0.62));
  const portraitWebH = Math.round(videoAreaH + CTRL_H);

  const ss = makeStyles(colors);

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
        originWhitelist={["*", "file://*"]}
        scrollEnabled={false}
        onMessage={handleMessage}
      />
    ) : (
      <View
        style={[
          ss.slot,
          { height: isLandscape ? undefined : portraitWebH, flex: isLandscape ? 1 : undefined },
        ]}
      >
        {stage.kind === "loading" && (
          <>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={ss.slotText}>Preparing your clip…</Text>
          </>
        )}
        {stage.kind === "missing" && (
          <>
            <Feather name="film" size={32} color={colors.mutedForeground} />
            <Text style={ss.slotTitle}>This clip is no longer on your device</Text>
            <Text style={ss.slotText}>
              Videos are stored on your phone, not on our servers. This one was removed or the app
              was reinstalled. Your scores and coaching notes are safe — only playback is gone.
            </Text>
            <TouchableOpacity
              style={ss.slotBtn}
              onPress={() => router.replace("/(tabs)/analyze")}
              activeOpacity={0.85}
            >
              <Text style={ss.slotBtnText}>Upload a new clip</Text>
            </TouchableOpacity>
          </>
        )}
        {stage.kind === "error" && (
          <>
            <Feather name="alert-circle" size={32} color={colors.warning} />
            <Text style={ss.slotTitle}>Playback problem</Text>
            <Text style={ss.slotText}>{stage.message}</Text>
          </>
        )}
      </View>
    );

  return (
    <View style={ss.root}>
      {!isLandscape && (
        <View style={[ss.header, { paddingTop: topPad + 8 }]}>
          <TouchableOpacity style={ss.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Feather name="chevron-left" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={ss.headerTitle} numberOfLines={1}>
              {sport || "Pose"} · Skeleton overlay
            </Text>
            {modelReady && <Text style={ss.headerSub}>● Pose tracking active</Text>}
          </View>
          {stage.kind === "ready" && (
            <TouchableOpacity style={ss.rotateBtn} onPress={toggleOrientation} activeOpacity={0.8}>
              <Feather name="maximize" size={13} color={colors.foreground} />
              <Text style={ss.rotateBtnText}>Fullscreen</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {isLandscape ? (
        <>
          {mediaBlock}
          <TouchableOpacity onPress={toggleOrientation} style={ss.portraitBtn} activeOpacity={0.8}>
            <Feather name="smartphone" size={13} color={colors.foreground} />
            <Text style={ss.rotateBtnText}>Portrait</Text>
          </TouchableOpacity>
        </>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
          showsVerticalScrollIndicator={false}
        >
          {mediaBlock}

          {angleCards.length > 0 && (
            <View style={ss.section}>
              <View style={ss.sectionHeader}>
                <Text style={ss.sectionLabel}>LIVE JOINT ANGLES</Text>
                <View
                  style={[
                    ss.pill,
                    {
                      backgroundColor: RISK_COLORS[maxLvl] + "22",
                      borderColor: RISK_COLORS[maxLvl] + "55",
                    },
                  ]}
                >
                  <Feather
                    name={maxLvl === 2 ? "alert-triangle" : maxLvl === 1 ? "alert-circle" : "check-circle"}
                    size={11}
                    color={RISK_COLORS[maxLvl]}
                  />
                  <Text style={[ss.pillText, { color: RISK_COLORS[maxLvl] }]}>
                    {maxLvl === 2 ? "High strain" : maxLvl === 1 ? "Caution" : "Within range"}
                  </Text>
                </View>
              </View>
              <View style={ss.grid}>
                {angleCards
                  .filter((a) => a.deg > 0)
                  .map(({ label, deg, key }) => {
                    const lvl = Math.max(0, Math.min(2, risk?.[key] ?? 0));
                    const c = RISK_COLORS[lvl];
                    return (
                      <View key={label} style={[ss.angleCard, { borderColor: c + "55" }]}>
                        <Text style={[ss.angleDeg, { color: c }]}>{deg}°</Text>
                        <Text style={ss.angleLabel}>{label}</Text>
                      </View>
                    );
                  })}
              </View>
            </View>
          )}

          {modelReady && stage.kind === "ready" && (
            <View style={ss.section}>
              <Text style={ss.sectionLabel}>WHAT WE SAW</Text>
              {insights.length === 0 ? (
                <View style={ss.okCard}>
                  <Feather name="check-circle" size={18} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={ss.okTitle}>No high-strain positions so far</Text>
                    <Text style={ss.okBody}>
                      Every joint we tracked stayed within its typical range. Play the whole clip to
                      check the full movement.
                    </Text>
                  </View>
                </View>
              ) : (
                insights.map(({ key, lvl, title, body }) => (
                  <View key={key} style={[ss.insightCard, { borderLeftColor: RISK_COLORS[lvl] }]}>
                    <View style={ss.insightHead}>
                      <Feather
                        name={lvl === 2 ? "alert-triangle" : "alert-circle"}
                        size={14}
                        color={RISK_COLORS[lvl]}
                      />
                      <Text style={[ss.insightTitle, { color: RISK_COLORS[lvl] }]}>{title}</Text>
                    </View>
                    <Text style={ss.insightBody}>{body}</Text>
                  </View>
                ))
              )}
              <Text style={ss.disclaimer}>
                This describes joint positions measured from your video. It is not a medical
                assessment or an injury prediction. See a coach or physio for pain that persists.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      textTransform: "capitalize",
    },
    headerSub: { fontSize: 10, color: colors.success, fontFamily: "Inter_400Regular" },
    rotateBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.card,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    rotateBtnText: { fontSize: 12, color: colors.foreground, fontFamily: "Inter_600SemiBold" },
    portraitBtn: {
      position: "absolute",
      top: 14,
      right: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.card,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    slot: {
      backgroundColor: colors.surface2,
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      paddingHorizontal: 28,
    },
    slotTitle: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      textAlign: "center",
    },
    slotText: {
      fontSize: 13,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      textAlign: "center",
      lineHeight: 19,
    },
    slotBtn: {
      marginTop: 6,
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 11,
      paddingHorizontal: 20,
    },
    slotBtnText: {
      color: colors.primaryForeground,
      fontSize: 14,
      fontFamily: "Inter_700Bold",
    },
    section: { paddingHorizontal: 18, paddingTop: 20, gap: 10 },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 2,
    },
    sectionLabel: {
      fontSize: 10,
      color: colors.mutedForeground,
      fontFamily: "SpaceMono_700Bold",
      letterSpacing: 1.5,
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 20,
      borderWidth: 1,
    },
    pillText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    angleCard: {
      width: "30%",
      flexGrow: 1,
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 12,
      alignItems: "center",
      borderWidth: 1,
    },
    angleDeg: { fontSize: 22, fontFamily: "Archivo_800ExtraBold", letterSpacing: -0.5 },
    angleLabel: {
      fontSize: 10,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      marginTop: 3,
    },
    okCard: {
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
      backgroundColor: colors.success + "14",
      borderWidth: 1,
      borderColor: colors.success + "33",
      borderRadius: 16,
      padding: 14,
    },
    okTitle: { fontSize: 13, color: colors.foreground, fontFamily: "Inter_600SemiBold" },
    okBody: {
      fontSize: 12,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      marginTop: 3,
      lineHeight: 17,
    },
    insightCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      borderLeftWidth: 3,
      padding: 14,
      gap: 7,
    },
    insightHead: { flexDirection: "row", alignItems: "center", gap: 7 },
    insightTitle: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
    insightBody: {
      fontSize: 12,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      lineHeight: 18,
    },
    disclaimer: {
      fontSize: 10,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      lineHeight: 14,
      marginTop: 4,
      fontStyle: "italic",
    },
  });
}
