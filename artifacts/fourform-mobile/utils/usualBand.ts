/**
 * The athlete's own working range — "the range you usually work in".
 *
 * ── Why this is shared ──────────────────────────────────────────────────────
 * Four screens computed this independently and did not agree. Home, Sessions
 * and the analysis screen took `Math.min`/`Math.max` of every measured score;
 * Progress took an interquartile range, with a comment arguing for it against
 * "min/max, which one bad clip would blow open". So the author had already made
 * the call, changed one screen, and the other three never followed. The same
 * athlete on the same data was shown two different bands depending on which tab
 * they were looking at, both labelled "YOUR BAND".
 *
 * ── Why min/max is the wrong definition, not just the inconsistent one ──────
 * Today's reading is part of the history the band is computed from. With
 * min/max the band therefore *always contains today*, on every screen, for
 * every athlete, forever. A marker that can never fall outside its band says
 * nothing — and rule 4 exists because a number is supposed to mean something
 * against the range beside it. The interquartile range can be exceeded, which
 * is what makes "outside your usual range" a fact worth showing.
 *
 * ── Why not the floor-indexed quartile Progress used ────────────────────────
 * `sorted[Math.floor((n - 1) * f)]` is skewed low at the sizes that matter
 * most. At three readings it returns `[min, median]` — the athlete's best
 * session is *always* above their own band the moment they have exactly the
 * three the band needs. At four it still excludes the top reading. This uses
 * linear interpolation between the neighbouring order statistics (the same
 * "type 7" quantile R and NumPy use by default), which is symmetric at every n.
 */

/** Linear-interpolated quantile, 0 ≤ f ≤ 1, over an already-sorted array. */
function quantile(sorted: number[], f: number): number {
  const pos = (sorted.length - 1) * f;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (pos - lo) * (sorted[hi]! - sorted[lo]!);
}

/**
 * @param values every measured reading, in any order.
 * @returns the interquartile band, or `null` below three readings.
 *
 * Three is the floor every screen already used: with two readings a band would
 * imply more certainty than two points support, and it is the number
 * `docs/TODO-PRODUCTION.md` flags as making the idea invisible for a new
 * athlete's first two clips.
 */
export function usualBand(values: number[]): { low: number; high: number } | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 3) return null;
  const sorted = [...finite].sort((a, b) => a - b);

  const low = quantile(sorted, 0.25);
  const high = quantile(sorted, 0.75);

  /**
   * A consistent athlete collapses the quartiles.
   *
   * Twelve sessions clustered on 88 give an interquartile range of exactly
   * 88 to 88, and "YOUR BAND 88 - 88" is a true statement that tells the reader
   * nothing and draws as a hairline. The observed range is the honest fallback:
   * on data that tight it is narrow anyway, and it is the only range left that
   * still has width.
   *
   * The outlier argument that motivates quartiles in the first place does not
   * apply here, because a spread this small has no outliers to be blown open
   * by.
   */
  if (high - low < 1) {
    return { low: sorted[0]!, high: sorted[sorted.length - 1]! };
  }

  return { low, high };
}
