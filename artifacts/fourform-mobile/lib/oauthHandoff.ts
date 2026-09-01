/**
 * A single in-memory slot for the continuation token a federated sign-in hands
 * to the screen that finishes it.
 *
 * ── Why not a route param ───────────────────────────────────────────────────
 * The obvious move is `router.push({ pathname, params: { challenge } })`. On
 * native that is memory; on web, expo-router puts params in the address bar.
 * These tokens are short-lived credentials — a link challenge is one half of an
 * account-linking proof — and the address bar is the one place on the web
 * designed to be copied, bookmarked, autocompleted, synced between devices, and
 * handed to whatever analytics the page loads. A credential that lands there
 * has effectively been published.
 *
 * So the token goes in a module variable and the route carries nothing. The
 * cost is that a hard refresh loses it, which is correct: the screens below
 * treat an empty slot as "start again", and starting again is cheap.
 *
 * ── Why it clears on read ───────────────────────────────────────────────────
 * Each token is redeemable once. Leaving it here after the screen has taken it
 * means a later, unrelated visit to that route finds a stale credential and
 * tries to redeem it — the user would see a confusing failure for something
 * they did minutes ago in a flow they had abandoned.
 */

export interface PendingRegistration {
  kind: "registration";
  token: string;
  email: string;
  suggestedName: string | null;
}

export interface PendingLink {
  kind: "link";
  token: string;
  email: string;
  message: string;
}

export type PendingOAuth = PendingRegistration | PendingLink;

let pending: PendingOAuth | null = null;

export function stashOAuth(next: PendingOAuth): void {
  pending = next;
}

/** Take the pending handoff, clearing it. Returns null if there is none. */
export function takeOAuth<K extends PendingOAuth["kind"]>(
  kind: K,
): Extract<PendingOAuth, { kind: K }> | null {
  if (!pending || pending.kind !== kind) return null;
  const value = pending as Extract<PendingOAuth, { kind: K }>;
  pending = null;
  return value;
}

/** Drop anything pending — on sign-out, or when a flow is abandoned. */
export function clearOAuth(): void {
  pending = null;
}
