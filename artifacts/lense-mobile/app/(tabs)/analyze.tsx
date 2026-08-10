import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  Platform,
  Modal,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { useColors } from "@/hooks/useColors";
import { analyses as analysesApi, type AnalysisRecord, type UsageRecord } from "@/lib/api";
import { deleteVideo } from "@/lib/videoStore";
import { useAuth } from "@/lib/authContext";
import * as Haptics from "expo-haptics";

const SPORTS = [
  "Weightlifting", "Running", "Basketball", "Golf", "Tennis",
  "Swimming", "CrossFit", "Boxing", "Soccer", "Gymnastics", "Other",
];

function getScoreColor(score: number, colors: ReturnType<typeof useColors>) {
  if (score >= 80) return colors.success;
  if (score >= 65) return colors.primary;
  return colors.warning;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function AnalyzeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();

  const [analysisList, setAnalysisList] = useState<AnalysisRecord[]>([]);
  const [usage, setUsage] = useState<UsageRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Sport picker modal state
  const [showSportPicker, setShowSportPicker] = useState(false);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [pendingTitle, setPendingTitle] = useState("");
  const [selectedSport, setSelectedSport] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 + 84 : insets.bottom + 84 + 16;

  const loadAnalyses = useCallback(async () => {
    try {
      // Usage is fetched alongside the list so the quota shown in the header is
      // the server's number, not a count of rows that happen to be loaded.
      const [listResult, usageResult] = await Promise.allSettled([
        analysesApi.list(),
        analysesApi.usage(),
      ]);
      if (listResult.status === "fulfilled") setAnalysisList(listResult.value.analyses);
      if (usageResult.status === "fulfilled") setUsage(usageResult.value);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadAnalyses(); }, [loadAnalyses]);

  // Poll for processing analyses
  useEffect(() => {
    const processing = analysisList.some((a) => a.status === "processing" || a.status === "pending");
    if (!processing) return;
    const interval = setInterval(loadAnalyses, 5000);
    return () => clearInterval(interval);
  }, [analysisList, loadAnalyses]);

  async function handleUpload() {
    try {
      if (Platform.OS !== "web") {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission needed", "Allow photo & video access in Settings to pick a clip.");
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "videos",
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled) return;
      const uri = result.assets[0]?.uri ?? "";
      if (!uri) return;

      setPendingUri(uri);
      setPendingTitle("");
      setSelectedSport(profile?.sport ?? "");
      setShowSportPicker(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isiCloud = /3164|PHPhotos|could not be completed/i.test(msg);
      Alert.alert(
        "Couldn't load that video",
        isiCloud
          ? "This clip is in iCloud and hasn't downloaded yet. Open Photos, let it download fully, then try again."
          : "Something went wrong. Please try a different clip.",
      );
    }
  }

  function submitAnalysis() {
    if (!selectedSport || !pendingUri) return;

    // Check the quota before spending a minute measuring a clip we'd then be
    // unable to save.
    if (usage && usage.limit !== -1 && usage.remaining <= 0) {
      setShowSportPicker(false);
      Alert.alert(
        "Monthly limit reached",
        `Your plan includes ${usage.limit} analyses per month. Your next ${usage.limit} unlock on ${new Date(usage.resetsAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`,
        [
          { text: "Not now", style: "cancel" },
          { text: "See plans", onPress: () => router.push("/pricing") },
        ],
      );
      return;
    }

    setShowSportPicker(false);

    // Measurement happens first; the analysis is created on the other side of
    // it, from real joint angles rather than from the title string.
    router.push({
      pathname: "/analysis/measure",
      params: {
        uri: pendingUri,
        sport: selectedSport.toLowerCase(),
        title: pendingTitle.trim(),
      },
    });
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingTop: topPad + 16, paddingHorizontal: 20, paddingBottom: 20 },
    title: { fontSize: 28, fontFamily: "Archivo_800ExtraBold", color: colors.foreground, letterSpacing: -0.5 },
    subtitle: { fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 4 },
    uploadBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primary, borderRadius: colors.radius, paddingVertical: 14, paddingHorizontal: 20, marginHorizontal: 20, marginBottom: 20, justifyContent: "center" },
    uploadBtnText: { color: "#07090B", fontSize: 15, fontFamily: "Inter_700Bold" },
    card: { backgroundColor: colors.card, borderRadius: colors.radius, marginHorizontal: 20, marginBottom: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
    cardBody: { padding: 16, flexDirection: "row", alignItems: "center", gap: 14 },
    iconBg: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.primary + "20", alignItems: "center", justifyContent: "center" },
    cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    cardMeta: { fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 2, textTransform: "capitalize" },
    scoreCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", borderWidth: 2 },
    scoreText: { fontSize: 16, fontFamily: "Archivo_800ExtraBold" },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingTop: 60 },
    emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary + "22", alignItems: "center", justifyContent: "center", marginBottom: 16 },
    emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 8 },
    emptyText: { fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
    // Overlay
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 32 },
    overlayCard: { backgroundColor: colors.card, borderRadius: 20, padding: 28, alignItems: "center", width: "100%" },
    overlayTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 8 },
    overlayStep: { fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 16, textAlign: "center" },
    // Sport picker modal
    pickerModal: { flex: 1, backgroundColor: colors.background },
    pickerHeader: { paddingTop: topPad + 16, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    pickerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    pickerContent: { flex: 1, padding: 20 },
    pickerLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground, marginBottom: 8 },
    pickerInput: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, color: colors.foreground, fontSize: 15, fontFamily: "Inter_400Regular", marginBottom: 20 },
    sportGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 24 },
    sportChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
    sportChipSelected: { borderColor: colors.primary, backgroundColor: colors.primary + "22" },
    sportChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    sportChipTextSelected: { color: colors.primary },
    analyzeBtn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
    analyzeBtnDisabled: { opacity: 0.5 },
    analyzeBtnText: { color: "#07090B", fontSize: 16, fontFamily: "Inter_700Bold" },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
    statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  });

  return (
    <View style={s.container}>
      {/* Sport/title picker modal */}
      <Modal visible={showSportPicker} animationType="slide">
        <View style={s.pickerModal}>
          <View style={s.pickerHeader}>
            <TouchableOpacity onPress={() => setShowSportPicker(false)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={s.pickerTitle}>Analysis Details</Text>
            <View style={{ width: 22 }} />
          </View>
          <ScrollView style={s.pickerContent} keyboardShouldPersistTaps="handled">
            <Text style={[s.pickerLabel, { marginTop: 4 }]}>Title (optional)</Text>
            <TextInput
              style={s.pickerInput}
              value={pendingTitle}
              onChangeText={setPendingTitle}
              placeholder="e.g. Deadlift 180kg"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
            />
            <Text style={s.pickerLabel}>Sport</Text>
            <View style={s.sportGrid}>
              {SPORTS.map((sport) => {
                const sel = selectedSport.toLowerCase() === sport.toLowerCase();
                return (
                  <TouchableOpacity
                    key={sport}
                    style={[s.sportChip, sel && s.sportChipSelected]}
                    onPress={() => setSelectedSport(sport)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.sportChipText, sel && s.sportChipTextSelected]}>{sport}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={[s.analyzeBtn, !selectedSport && s.analyzeBtnDisabled]}
              onPress={submitAnalysis}
              disabled={!selectedSport}
              activeOpacity={0.85}
            >
              <Text style={s.analyzeBtnText}>Analyze Video</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      <FlatList
        data={analysisList}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAnalyses(); }} tintColor={colors.primary} />}
        ListHeaderComponent={
          <>
            <View style={s.header}>
              <Text style={s.title}>Analyses</Text>
              <Text style={s.subtitle}>
                {usage
                  ? usage.limit === -1
                    ? "Unlimited analyses"
                    : `${usage.used}/${usage.limit} analyses used this month`
                  : " "}
              </Text>
            </View>
            <TouchableOpacity style={s.uploadBtn} onPress={handleUpload} activeOpacity={0.85}>
              <Feather name="upload" size={18} color={colors.primaryForeground} />
              <Text style={s.uploadBtnText}>Upload Training Video</Text>
            </TouchableOpacity>
          </>
        }
        ListEmptyComponent={
          loading ? (
            <View style={s.empty}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Feather name="video" size={28} color={colors.primary} />
              </View>
              <Text style={s.emptyTitle}>No analyses yet</Text>
              <Text style={s.emptyText}>Upload a training video and get AI-powered biomechanics analysis in seconds.</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const isProcessing = item.status === "processing" || item.status === "pending";
          // A null score means "not measured" — showing 0 would read as a
          // terrible result rather than an absent one.
          const score = item.overallScore;
          const scoreColor = score === null ? colors.mutedForeground : getScoreColor(score, colors);
          return (
            <TouchableOpacity
              style={s.card}
              onPress={() => !isProcessing && router.push(`/analysis/${item.id}`)}
              onLongPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                Alert.alert(
                  item.title,
                  "What would you like to do?",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await analysesApi.delete(item.id);
                          // Reclaim the clip too, or deleted analyses keep
                          // occupying device storage indefinitely.
                          await deleteVideo(item.id);
                          setAnalysisList((prev) => prev.filter((a) => a.id !== item.id));
                          void loadAnalyses();
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        } catch {
                          Alert.alert("Couldn't delete", "Please try again.");
                        }
                      },
                    },
                  ]
                );
              }}
              activeOpacity={isProcessing ? 1 : 0.85}
            >
              <View style={s.cardBody}>
                <View style={s.iconBg}>
                  <Feather name="activity" size={22} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={s.cardMeta}>{item.sport} · {formatDate(item.uploadedAt)}</Text>
                </View>
                {isProcessing ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : item.status === "failed" ? (
                  <Feather name="alert-circle" size={22} color={colors.destructive} />
                ) : (
                  <View style={[s.scoreCircle, { borderColor: scoreColor }]}>
                    <Text style={[s.scoreText, { color: scoreColor }]}>
                      {score === null ? "–" : Math.round(score)}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={{ paddingBottom: bottomPad }}
      />
    </View>
  );
}
