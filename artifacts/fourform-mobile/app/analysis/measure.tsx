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
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import * as FileSystem from "expo-file-system/legacy";

import {
  AlertGlyph,
  BackButton,
  PrimaryButton,
  Meter,
  Text,
} from "@/components/caliper";
import { color, type as T, GUTTER } from "@/constants/caliper";
import { analyses as analysesApi, ApiError, NetworkError } from "@/lib/api";
import { buildPoseHtml, type PoseMessage, type PoseMetrics } from "@/lib/poseTracker";
import { persistVideo, stageForWebView, isLocalAppFile } from "@/lib/videoStore";
import * as haptics from "@/lib/haptics";

type Phase = "preparing" | "measuring" | "saving" | "error";

export default function MeasureScreen() {
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
    haptics.fail();
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
      /**
       * This screen is reachable by deep link, so `params.uri` is untrusted
       * input — and it ends up interpolated into a WebView document that runs
       * with `allowFileAccessFromFileURLs` and `allowUniversalAccessFromFileURLs`.
       * Only a clip inside our own sandbox is ever measured. `buildPoseHtml`
       * escapes for the script context too; this is the other half.
       */
      if (!isLocalAppFile(params.uri)) {
        fail("That video isn't available on this device.");
        return;
      }
      try {
        const staged = await stageForWebView(params.uri);
        const htmlPath = `${FileSystem.cacheDirectory}pose-scan.html`;
        await FileSystem.writeAsStringAsync(
          htmlPath,
          buildPoseHtml({ videoUri: staged, mode: "scan", sport: params.sport }),
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

        // The moment this whole product exists to produce, and until now it
        // arrived in complete silence.
        haptics.success();
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


  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <BackButton onPress={() => router.back()} />
        <Text style={T.cardTitle}>Measuring</Text>
      </View>

      {phase === "error" ? (
        <View style={s.body}>
          <AlertGlyph tone={color.rust} size={38} />
          <Text style={s.title}>Couldn&apos;t measure this clip</Text>
          <Text style={s.sub}>{errorMessage}</Text>
          <View style={{ alignSelf: "stretch", marginTop: 4 }}>
            <PrimaryButton label="Try another clip" onPress={() => router.back()} />
          </View>
        </View>
      ) : (
        <View style={s.body}>
          <ActivityIndicator size="large" color={color.cobalt} />
          {/*
            This screen runs for about a minute and said nothing to a screen
            reader for any of it — no role on the bar, no value, and no
            announcement when the phase changed. A blind user started a
            measurement and then had no way to know whether it was running,
            finished, or dead.
          */}
          <Text style={s.title} accessibilityLiveRegion="polite">
            {phase === "preparing" && "Preparing your video"}
            {phase === "measuring" && "Measuring your movement"}
            {phase === "saving" && "Building your report"}
          </Text>

          {phase === "measuring" && progress.total > 0 && (
            <>
              {/*
                Was a raw View whose width was bound straight to React state, so
                it jumped from reading to reading rather than advancing. On the
                app's longest wait, a bar that lurches reads as a process that
                keeps stalling.
              */}
              <Meter
                value={progress.done / progress.total}
                tone={color.cobalt}
                label={`Measuring: ${progress.done} of ${progress.total} frames`}
                style={{ alignSelf: "stretch" }}
              />
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
          // The only legitimate top-level document here is our local file:// page;
          // the MediaPipe CDN is loaded as a subresource, which this prop does not
          // gate. Narrowed from ["*"] so a navigation to any other origin (e.g. one
          // triggered by tampered script) is handed to the OS browser rather than
          // loaded inside this file://-privileged WebView.
          originWhitelist={["file://*"]}
          scrollEnabled={false}
          onError={() => fail("The analysis engine failed to start.")}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  header: {
    paddingHorizontal: GUTTER,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  body: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 20 },
  title: { ...T.cardTitle, fontSize: 20, lineHeight: 26, textAlign: "center" },
  sub: { ...T.body, textAlign: "center" },
  pct: { ...T.measured, color: color.cobalt, fontVariant: ["tabular-nums"] },
  // The tracker must render to produce frames, but the athlete watches the
  // progress UI instead — so keep it mounted but visually out of the way.
  hiddenWebView: { position: "absolute", width: 1, height: 1, opacity: 0, top: -9999 },
});
