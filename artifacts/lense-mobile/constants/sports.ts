/**
 * The canonical sport list.
 *
 * Three screens previously carried their own hardcoded arrays that had drifted
 * apart — onboarding offered Fencing, the upload sheet didn't, and Profile
 * offered a third set. An athlete could pick a sport at signup that the upload
 * sheet then couldn't show as selected.
 *
 * One list, imported everywhere. Adding a sport here adds it to every screen.
 *
 * Order is roughly by how well 2D side-on pose tracking works for the movement:
 * clearly planar, whole-body movements first.
 */
export const SPORTS = [
  "Weightlifting",
  "Running",
  "CrossFit",
  "Boxing",
  "Martial Arts",
  "Gymnastics",
  "Basketball",
  "Soccer",
  "Tennis",
  "Golf",
  "Swimming",
  "Cycling",
  "Rowing",
  "Volleyball",
  "Baseball",
  "Track & Field",
  "Skiing",
  "Climbing",
  "Dance",
  "Fencing",
  "Other",
] as const;

export type Sport = (typeof SPORTS)[number];

/**
 * Match a stored sport string back to a canonical entry.
 *
 * Sports are stored lowercased server-side, and older rows may hold a value no
 * longer in the list. Returns undefined rather than guessing, so callers can
 * decide whether to show the raw value or fall back.
 */
export function canonicalSport(value: string | null | undefined): Sport | undefined {
  if (!value) return undefined;
  const needle = value.trim().toLowerCase();
  return SPORTS.find((s) => s.toLowerCase() === needle);
}

/** Title-cased sport for display, falling back to the stored value. */
export function displaySport(value: string | null | undefined): string {
  if (!value) return "";
  return canonicalSport(value) ?? value.charAt(0).toUpperCase() + value.slice(1);
}
