/**
 * Device-local storage for the profile photo.
 *
 * ── Why the photo never touches the server ──────────────────────────────────
 * "How your data is handled" promises that media stays on the device — only
 * measured joint angles are sent. That promise is load-bearing: it is in the
 * privacy policy, both store data-safety labels, and the profile screen's own
 * copy. An avatar upload endpoint would quietly falsify all of it for a
 * feature that gains nothing from a round trip. So the photo follows the same
 * pattern as training clips (lib/videoStore.ts): copied into
 * `documentDirectory`, referenced locally, gone when the user removes it.
 * The trade — a new phone starts without your photo — is honest and small.
 *
 * ── Mechanics ───────────────────────────────────────────────────────────────
 * Files are keyed by user id so two accounts on one device can never see each
 * other's photo. Each save writes a *new* filename (timestamped) and deletes
 * the old file: expo-image caches by URI, so overwriting in place would keep
 * rendering the stale photo until the cache happened to evict it.
 *
 * Web has no documentDirectory; the picked image is stored as a base64 data
 * URI in AsyncStorage instead. Data URIs survive reloads (blob: URIs do not).
 */

import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const AVATAR_DIR = `${FileSystem.documentDirectory ?? ""}athlete-avatar/`;

const uriKey = (userId: string) => `avatar_uri_${userId}`;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(AVATAR_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(AVATAR_DIR, { intermediates: true });
  }
}

function extensionOf(uri: string): string {
  const raw = uri.split("/").pop()?.split(/[?#]/)[0] ?? "";
  const ext = raw.includes(".") ? raw.split(".").pop()! : "jpg";
  return /^[a-zA-Z0-9]{1,5}$/.test(ext) ? ext.toLowerCase() : "jpg";
}

/** The stored photo URI for this user, or null when none is set. */
export async function loadAvatar(userId: string): Promise<string | null> {
  const stored = await AsyncStorage.getItem(uriKey(userId));
  if (!stored) return null;

  if (Platform.OS === "web" || stored.startsWith("data:")) return stored;

  // Verify the file still exists — documentDirectory is durable, but an OS
  // restore or a partial delete can strand the pointer. A missing file must
  // read as "no photo", not a broken image.
  const info = await FileSystem.getInfoAsync(stored);
  if (!info.exists) {
    await AsyncStorage.removeItem(uriKey(userId));
    return null;
  }
  return stored;
}

/**
 * Persist a freshly picked photo and return its durable URI.
 *
 * `base64` is required on web (the picker is asked for it there); native
 * copies the file instead.
 */
export async function saveAvatar(
  userId: string,
  pickedUri: string,
  base64?: string | null,
): Promise<string> {
  const previous = await AsyncStorage.getItem(uriKey(userId));

  let durable: string;
  if (Platform.OS === "web") {
    if (!base64) throw new Error("Avatar save on web requires base64 image data.");
    durable = `data:image/jpeg;base64,${base64}`;
  } else {
    await ensureDir();
    durable = `${AVATAR_DIR}${userId}-${Date.now()}.${extensionOf(pickedUri)}`;
    await FileSystem.copyAsync({ from: pickedUri, to: durable });
  }

  await AsyncStorage.setItem(uriKey(userId), durable);

  // Clean up the replaced file after the pointer moves, never before.
  if (previous && !previous.startsWith("data:") && previous !== durable) {
    await FileSystem.deleteAsync(previous, { idempotent: true }).catch(() => {});
  }
  return durable;
}

/** Remove the photo — used by "Remove photo" and by account deletion. */
export async function removeAvatar(userId: string): Promise<void> {
  const stored = await AsyncStorage.getItem(uriKey(userId));
  await AsyncStorage.removeItem(uriKey(userId));
  if (stored && !stored.startsWith("data:")) {
    await FileSystem.deleteAsync(stored, { idempotent: true }).catch(() => {});
  }
}
