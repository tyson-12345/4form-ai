/**
 * The one place a reading is turned into a position on a scale.
 *
 * ── Why this is shared ──────────────────────────────────────────────────────
 * `MetricBand`, `MiniBand` and `MicroAxis` each had their own copy of this
 * arithmetic, and all three carried the same pair of bugs:
 *
 *  1. **Position was clamped, width was not.** `pct()` clamped to 0–100% but
 *     the band fill's width was computed raw, so a band wider than the default
 *     window rendered past 100%. On a real account (band 22–93 against the
 *     40–100 default) the fill came out 118% wide and ran 56pt off the side of
 *     the card and off the screen.
 *
 *  2. **The window was a clamp, not a default.** A Form Index of 22 pinned to
 *     the left edge and drew at exactly the same place as a 40, while the
 *     caption underneath read "BAND 22–93" — the screen stating a range its own
 *     scale could not draw.
 *
 * Widening the window to contain what it is asked to draw keeps rule 4 true for
 * every input: every number is shown against the band it came from.
 */
export interface BandScale {
  from: number;
  to: number;
  /** 0–100, clamped. */
  ratio: (v: number) => number;
  /** Percentage string for RN's DimensionValue. */
  pct: (v: number) => `${number}%`;
  /** Width of a span, clamped so it can never run past the right edge. */
  fillWidth: (lo: number, hi: number, minPct: number) => `${number}%`;
}

export function bandScale(
  min: number,
  max: number,
  values: (number | null | undefined)[],
  step = 1,
): BandScale {
  const points = values.filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n),
  );
  const from = Math.floor(Math.min(min, ...points) / step) * step;
  const to = Math.ceil(Math.max(max, ...points) / step) * step;
  const span = Math.max(1, to - from);

  const ratio = (v: number) => Math.min(100, Math.max(0, ((v - from) / span) * 100));
  return {
    from,
    to,
    ratio,
    pct: (v) => `${ratio(v)}%`,
    fillWidth: (lo, hi, minPct) =>
      `${Math.max(minPct, Math.min(100 - ratio(lo), ratio(hi) - ratio(lo)))}%` as `${number}%`,
  };
}
