/**
 * Measurement step.
 *
 * Sits between picking a clip and getting an analysis. A hidden WebView steps
 * through the video with MediaPipe, accumulating joint angles, and only once
 * real measurements exist do we create the analysis on the server.
 *
 * Previously the app skipped this entirely: it created the analysis straight
 * from the video picker while showing a fake progress list ("Detecting body
 * pose…", "Calculating joint angles…") for work that never ran. The server then
 * asked Claude to invent scores from the title. This screen is where that
 * progress list stops being theatre and starts describing something real.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import * as FileSystem from "expo-file-system/legacy";

import { useColors } from "@/hooks/useColors";
import { analyses as analysesApi, ApiError, NetworkError } from "@/lib/api";
import { buildPoseHtml, type PoseMessage, type PoseMetrics } from "@/lib/poseTracker";
import { persistVideo, stageForWebView } from "@/lib/videoStore";

type Phase = "preparing" | "measuring" | "saving" | "error";

export default function MeasureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ uri: string; sport: string; title: string }>();

  const [phase, setPhase] = useState<Phase>("preparing");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errorMessage, setErrorMessage] = useState("");
  const [htmlUri, setHtmlUri] = useState<string | null>(null);

  // Guards against the WebView firing `metrics` more than once (a reload, a
  // late watchdog) and creating duplicate analyses.
  const submitted = useRef(false);

  const fail = useCallback((message: string) => {
    setErrorMessage(message);
    setPhase("error");
  }, []);

  // ── Stage the clip and the tracker document side by side ──
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!params.uri) {
        fail("No video was provided.");
        return;
      }
      try {
        const staged = await stageForWebView(params.uri);
        const htmlPath = `${FileSystem.cacheDirectory}pose-scan.html`;
        await FileSystem.writeAsStringAsync(
          htmlPath,
          buildPoseHtml({ videoUri: staged, mode: "scan" }),
          { encoding: FileSystem.EncodingType.UTF8 },
        );
        if (cancelled) return;
        setHtmlUri(htmlPath);
        setPhase("measuring");
      } catch {
        if (!cancelled) fail("Couldn't prepare this video for analysis.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.uri, fail]);

  // ── Create the analysis once measurements are in ──
  const submit = useCallback(
    async (metrics: PoseMetrics) => {
      if (submitted.current) return;
      submitted.current = true;
      setPhase("saving");

      try {
        const { analysis } = await analysesApi.create({
          title: params.title?.trim() || `${params.sport} session`,
          sport: params.sport,
          duration: metrics.durationSec,
          poseMetrics: metrics,
        });

        // Store the clip under the analysis id so the overlay can find it later.
        await persistVideo(params.uri, analysis.id);

        router.replace(`/analysis/${analysis.id}`);
      } catch (err) {
        submitted.current = false;
        if (err instanceof ApiError && err.code === "UPGRADE_REQUIRED") {
          fail(err.message ?? "You've used all your analyses for this month.");
          return;
        }
        if (err instanceof NetworkError) {
          fail("We measured your clip but couldn't reach the server. Check your connection and try again.");
          return;
        }
        fail("We couldn't save this analysis. Please try again.");
      }
    },
    [params.title, params.sport, params.uri, router, fail],
  );

  const onMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      let msg: PoseMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data) as PoseMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "progress":
          setProgress({ done: msg.done, total: msg.total });
          break;
        case "metrics":
          void submit(msg.metrics);
          break;
        case "error":
          fail(msg.message);
          break;
      }
    },
    [submit, fail],
  );

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: (Platform.OS === "web" ? 20 : insets.top) + 12,
      paddingHorizontal: 20,
      paddingBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { fontSize: 15, fontFamily: "InstrumentSans_600SemiBold", color: colors.foreground },
    body: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 20 },
    title: {
      fontSize: 20,
      fontFamily: "InstrumentSans_600SemiBold",
      color: colors.foreground,
      textAlign: "center",
    },
    sub: {
      fontSize: 14,
      fontFamily: "InstrumentSans_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 21,
    },
    barTrack: {
      width: "100%",
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surface3,
      overflow: "hidden",
    },
    barFill: { height: "100%", borderRadius: 3, backgroundColor: colors.primary },
    pct: {
      fontSize: 13,
      fontFamily: "InstrumentSans_600SemiBold",
      color: colors.primary,
      fontVariant: ["tabular-nums"],
    },
    btn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 14,
      paddingHorizontal: 28,
      marginTop: 8,
    },
    btnText: { color: colors.primaryForeground, fontSize: 15, fontFamily: "InstrumentSans_600SemiBold" },
    secondaryBtn: { paddingVertical: 12, paddingHorizontal: 20 },
    secondaryText: {
      color: colors.mutedForeground,
      fontSize: 14,
      fontFamily: "InstrumentSans_500Medium",
    },
    // The tracker must render to produce frames, but the user watches the
    // progress UI instead — so keep it on-screen but visually out of the way.
    hiddenWebView: { position: "absolute", width: 1, height: 1, opacity: 0, top: -9999 },
  });

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="chevron-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Analysing</Text>
      </View>

      {phase === "error" ? (
        <View style={s.body}>
          <Feather name="alert-circle" size={40} color={colors.warning} />
          <Text style={s.title}>Couldn't analyse this clip</Text>
          <Text style={s.sub}>{errorMessage}</Text>
          <TouchableOpacity style={s.btn} onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={s.btnText}>Try another video</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.body}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.title}>
            {phase === "preparing" && "Preparing your video"}
            {phase === "measuring" && "Measuring your movement"}
            {phase === "saving" && "Building your report"}
          </Text>

          {phase === "measuring" && progress.total > 0 && (
            <>
              <View style={s.barTrack}>
                <View style={[s.barFill, { width: `${pct}%` }]} />
              </View>
              <Text style={s.pct}>
                {progress.done} of {progress.total} frames
              </Text>
            </>
          )}

          <Text style={s.sub}>
            {phase === "measuring"
              ? "We're tracking your joints frame by frame to measure real angles. Keep the app open."
              : phase === "saving"
                ? "Turning your measurements into coaching feedback."
                : "Getting the pose model ready."}
          </Text>
        </View>
      )}

      {htmlUri && phase !== "error" && (
        <WebView
          source={{ uri: htmlUri }}
          style={s.hiddenWebView}
          onMessage={onMessage}
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
          onError={() => fail("The analysis engine failed to start.")}
        />
      )}
    </View>
  );
}
