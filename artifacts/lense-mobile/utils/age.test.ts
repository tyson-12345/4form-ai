import { describe, it, expect } from "vitest";
import { MINIMUM_AGE_YEARS, ageInYears, parseBirthDate, toIsoDate, isOldEnough, birthDateProblem, birthDateMessage } from "./age";

describe("ageInYears", () => {
  it("counts whole years", () => {
    expect(ageInYears(new Date(2000, 0, 1), new Date(2020, 0, 1))).toBe(20);
  });

  it("counts the birthday itself", () => {
    // Someone born 15 June 2010 turns 13 on 15 June 2023 — not the day after.
    expect(ageInYears(new Date(2010, 5, 15), new Date(2023, 5, 15))).toBe(13);
  });

  it("does not count the day before the birthday", () => {
    expect(ageInYears(new Date(2010, 5, 15), new Date(2023, 5, 14))).toBe(12);
  });

  it("does not credit a birthday later in the same year", () => {
    // The off-by-one that matters: on 31 Dec, someone born 1 Jan is still 19.
    expect(ageInYears(new Date(2000, 0, 1), new Date(2019, 11, 31))).toBe(19);
  });

  it("handles a birthday earlier in the same month", () => {
    expect(ageInYears(new Date(2010, 5, 1), new Date(2023, 5, 20))).toBe(13);
  });

  it("handles a 29 February birthday in a non-leap year", () => {
    // Born on a leap day; on 28 Feb of a non-leap year they have not yet had
    // their birthday, so they are still the younger age.
    expect(ageInYears(new Date(2008, 1, 29), new Date(2023, 1, 28))).toBe(14);
    expect(ageInYears(new Date(2008, 1, 29), new Date(2023, 2, 1))).toBe(15);
  });
});

describe("parseBirthDate — rejects impossible dates", () => {
  it("rejects 31 February rather than rolling it over", () => {
    // new Date(2010, 1, 31) silently becomes 3 March. Without the round-trip
    // check the gate would judge a date the user never typed.
    expect(parseBirthDate("31", "02", "2010")).toBeNull();
  });

  it("rejects 31 April", () => {
    expect(parseBirthDate("31", "04", "2010")).toBeNull();
  });

  it("rejects 29 February in a non-leap year", () => {
    expect(parseBirthDate("29", "02", "2011")).toBeNull();
  });

  it("accepts 29 February in a leap year", () => {
    const d = parseBirthDate("29", "02", "2008");
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(29);
    expect(d!.getMonth()).toBe(1);
  });

  it("rejects an out-of-range month or day", () => {
    expect(parseBirthDate("15", "13", "2010")).toBeNull();
    expect(parseBirthDate("32", "01", "2010")).toBeNull();
    expect(parseBirthDate("00", "01", "2010")).toBeNull();
    expect(parseBirthDate("15", "00", "2010")).toBeNull();
  });

  it("rejects a future date", () => {
    const nextYear = String(new Date().getFullYear() + 1);
    expect(parseBirthDate("15", "06", nextYear)).toBeNull();
  });

  it("rejects incomplete input", () => {
    expect(parseBirthDate("", "06", "2010")).toBeNull();
    expect(parseBirthDate("15", "", "2010")).toBeNull();
    expect(parseBirthDate("15", "06", "")).toBeNull();
    expect(parseBirthDate("15", "06", "201")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(parseBirthDate("ab", "06", "2010")).toBeNull();
    expect(parseBirthDate("15", "xy", "2010")).toBeNull();
  });

  it("accepts an ordinary date", () => {
    const d = parseBirthDate("15", "06", "1995");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(1995);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getDate()).toBe(15);
  });
});

describe("toIsoDate", () => {
  it("formats with zero padding", () => {
    expect(toIsoDate(new Date(1995, 5, 5))).toBe("1995-06-05");
    expect(toIsoDate(new Date(2001, 11, 25))).toBe("2001-12-25");
  });

  it("uses local date parts, not UTC", () => {
    // A date constructed at local midnight must serialise as that same calendar
    // day. toISOString() would shift it back a day west of Greenwich, which on
    // a birthday is the difference between passing and failing the gate.
    const local = new Date(2010, 0, 1);
    expect(toIsoDate(local)).toBe("2010-01-01");
  });
});

describe("isOldEnough", () => {
  const now = new Date(2026, 7, 12); // 12 Aug 2026

  it("accepts someone comfortably over the minimum", () => {
    expect(isOldEnough(new Date(1995, 5, 15), now)).toBe(true);
  });

  it("accepts someone on the day they reach the minimum", () => {
    expect(isOldEnough(new Date(2026 - MINIMUM_AGE_YEARS, 7, 12), now)).toBe(true);
  });

  it("rejects someone one day short of the minimum", () => {
    expect(isOldEnough(new Date(2026 - MINIMUM_AGE_YEARS, 7, 13), now)).toBe(false);
  });

  it("rejects a young child", () => {
    expect(isOldEnough(new Date(2020, 0, 1), now)).toBe(false);
  });

  it("rejects null", () => {
    expect(isOldEnough(null, now)).toBe(false);
  });
});

describe("birthDateProblem", () => {
  const now = new Date(2026, 7, 22); // 22 Aug 2026

  it("says impossible for a date that does not exist, not 'too young'", () => {
    // The bug: 31 February told a 26-year-old they were under 13.
    expect(birthDateProblem("31", "02", "2000", now)).toBe("impossible");
    expect(birthDateMessage("impossible")).toMatch(/doesn't exist/);
  });

  it("catches out-of-range parts", () => {
    expect(birthDateProblem("32", "01", "2000", now)).toBe("impossible");
    expect(birthDateProblem("01", "13", "2000", now)).toBe("impossible");
  });

  it("distinguishes a future date from an underage one", () => {
    expect(birthDateProblem("01", "01", "2030", now)).toBe("future");
    expect(birthDateProblem("01", "01", "2020", now)).toBe("too-young");
  });

  it("stays quiet until the fields are actually filled in", () => {
    expect(birthDateProblem("", "", "", now)).toBe("incomplete");
    expect(birthDateProblem("15", "06", "199", now)).toBe("incomplete");
    expect(birthDateProblem("15", "", "1995", now)).toBe("incomplete");
  });

  it("accepts a valid adult date", () => {
    expect(birthDateProblem("15", "06", "1995", now)).toBeNull();
  });

  it("accepts someone exactly on their thirteenth birthday", () => {
    expect(birthDateProblem("22", "08", "2013", now)).toBeNull();
  });

  it("rejects the day before that birthday", () => {
    expect(birthDateProblem("23", "08", "2013", now)).toBe("too-young");
  });

  it("accepts 29 February in a leap year", () => {
    expect(birthDateProblem("29", "02", "2000", now)).toBeNull();
    expect(birthDateProblem("29", "02", "2001", now)).toBe("impossible");
  });
});
