import { describe, expect, it } from "vitest";
import { parseLocalDate } from "./localDate";

describe("parseLocalDate", () => {
  it("parses a date-only string as local midnight", () => {
    const d = parseLocalDate("2026-08-16");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(16);
    expect(d.getHours()).toBe(0);
  });

  it("renders the recorded calendar day whatever the device timezone", () => {
    // The observed bug: `new Date("2026-08-16")` is UTC midnight, which
    // toLocaleDateString renders as "15 Aug" anywhere west of Greenwich.
    // Local parts in, local parts out — this holds in every timezone.
    const stamped = parseLocalDate("2026-08-16").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
    expect(stamped).toBe("16 Aug");
  });

  it("preserves chronological order for sorting and cutoff filters", () => {
    expect(parseLocalDate("2026-08-15").getTime()).toBeLessThan(
      parseLocalDate("2026-08-16").getTime(),
    );
    expect(parseLocalDate("2025-12-31").getTime()).toBeLessThan(
      parseLocalDate("2026-01-01").getTime(),
    );
  });

  it("falls through to native parsing for full timestamps", () => {
    const iso = "2026-08-16T14:30:00.000Z";
    expect(parseLocalDate(iso).getTime()).toBe(new Date(iso).getTime());
  });

  it("returns an Invalid Date for garbage rather than throwing", () => {
    expect(Number.isNaN(parseLocalDate("not-a-date").getTime())).toBe(true);
  });
});
