/**
 * Persistent storage for uploaded training clips.
 *
 * ── The bug this fixes ──────────────────────────────────────────────────────
 * Clips used to be referenced by the URI `expo-image-picker` returns, which
 * points into the app's *cache* directory. iOS evicts that directory whenever
 * it wants space, and it is cleared on some app updates. The analysis row in
 * Postgres survived, so the app kept offering "Skeleton Overlay" for a video
 * file that no longer existed — which is why the overlay silently stopped
 * appearing for older analyses while new ones worked fine.
 *
 * Clips are now copied into `documentDirectory`, which the OS does not evict,
 * under a name derived from the analysis id. `resolveVideo` verifies the file
 * is actually on disk before returning it, so a missing clip produces a clear
 * message instead of a black WebView.
 */

import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Directory holding user clips. Created lazily on first save. */
const VIDEO_DIR = `${FileSystem.documentDirectory}athlete-videos/`;

/** Legacy key written by older builds; read once so old clips still resolve. */
const legacyKey = (analysisId: string) => `video_uri_${analysisId}`;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(VIDEO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(VIDEO_DIR, { intermediates: true });
  }
}

function extensionOf(uri: string): string {
  const raw = uri.split("/").pop()?.split(/[?#]/)[0] ?? "";
  const ext = raw.includes(".") ? raw.split(".").pop()! : "mp4";
  // Guard against a pathological "extension" from a content:// URI.
  return /^[a-zA-Z0-9]{1,5}$/.test(ext) ? ext.toLowerCase() : "mp4";
}

/**
 * Copy a picked clip into permanent storage.
 *
 * Returns the durable URI. Falls back to the original URI if the copy fails
 * (some Android `content://` URIs are readable in place but not copyable) —
 * the caller still gets something usable, it just may not survive as long.
 */
export async function persistVideo(sourceUri: string, analysisId: string): Promise<string> {
  try {
    await ensureDir();
    const target = `${VIDEO_DIR}${analysisId}.${extensionOf(sourceUri)}`;

    const existing = await FileSystem.getInfoAsync(target);
    if (existing.exists) return target;

    await FileSystem.copyAsync({ from: sourceUri, to: target });
    await AsyncStorage.setItem(legacyKey(analysisId), target);
    return target;
  } catch {
    // Keep the original reference rather than losing the clip entirely.
    await AsyncStorage.setItem(legacyKey(analysisId), sourceUri).catch(() => {});
    return sourceUri;
  }
}

export type VideoResolution =
  | { status: "ready"; uri: string }
  | { status: "missing" };

/**
 * Find the clip for an analysis and confirm it still exists on disk.
 *
 * Checks the durable location first, then the legacy AsyncStorage pointer so
 * clips saved by older builds keep working until they're evicted.
 */
export async function resolveVideo(analysisId: string): Promise<VideoResolution> {
  for (const ext of ["mp4", "mov", "m4v", "avi", "webm"]) {
    const candidate = `${VIDEO_DIR}${analysisId}.${ext}`;
    const info = await FileSystem.getInfoAsync(candidate);
    if (info.exists) return { status: "ready", uri: candidate };
  }

  const legacy = await AsyncStorage.getItem(legacyKey(analysisId));
  if (legacy) {
    const info = await FileSystem.getInfoAsync(legacy);
    if (info.exists) return { status: "ready", uri: legacy };
    // Pointer is stale — drop it so we don't keep re-checking a dead path.
    await AsyncStorage.removeItem(legacyKey(analysisId)).catch(() => {});
  }

  return { status: "missing" };
}

/** Remove a clip when its analysis is deleted, so storage doesn't grow forever. */
export async function deleteVideo(analysisId: string): Promise<void> {
  for (const ext of ["mp4", "mov", "m4v", "avi", "webm"]) {
    const candidate = `${VIDEO_DIR}${analysisId}.${ext}`;
    await FileSystem.deleteAsync(candidate, { idempotent: true }).catch(() => {});
  }
  await AsyncStorage.removeItem(legacyKey(analysisId)).catch(() => {});
}

/**
 * Copy a clip into the cache directory next to the pose-tracker HTML.
 *
 * WKWebView's `allowingReadAccessTo` only covers the HTML file's own directory,
 * so the video has to sit beside it to be loadable from a `file://` page.
 * This copy is disposable — the durable original stays in documentDirectory.
 */
export async function stageForWebView(uri: string): Promise<string> {
  const target = `${FileSystem.cacheDirectory}pose-video.${extensionOf(uri)}`;
  try {
    await FileSystem.deleteAsync(target, { idempotent: true });
    await FileSystem.copyAsync({ from: uri, to: target });
    return target;
  } catch {
    return uri;
  }
}

/** Total bytes held in the video directory — surfaced in Profile → Storage. */
export async function storageUsedBytes(): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(VIDEO_DIR);
    if (!info.exists) return 0;
    const names = await FileSystem.readDirectoryAsync(VIDEO_DIR);
    let total = 0;
    for (const name of names) {
      const fileInfo = await FileSystem.getInfoAsync(`${VIDEO_DIR}${name}`);
      if (fileInfo.exists && !fileInfo.isDirectory) total += fileInfo.size ?? 0;
    }
    return total;
  } catch {
    return 0;
  }
}
