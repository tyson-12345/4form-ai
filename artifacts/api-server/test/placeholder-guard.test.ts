/**
 * The publication guard, on the shapes that got past it.
 *
 * `test/legal-pages.test.ts` covers the guard's happy path and the two
 * regressions it already knew about. This file is about the third: a
 * placeholder that is neither shouted nor an address, and which was therefore
 * invisible to `findPlaceholders` — so `/privacy` returned 200 and served
 * "Backups roll off within [30] days" to the public.
 *
 * The second half is the other side of the same trade. A guard that refuses too
 * much is not safe, it is stuck: a false positive holds both documents at 503
 * for ever over a string nobody can see, and the pressure that creates is to
 * turn the guard off. So the prose and the link syntax are asserted just as
 * hard as the blanks.
 */

import { describe, it, expect } from "vitest";

import { findPlaceholders } from "../src/lib/markdown.js";

describe("findPlaceholders — numeric blanks", () => {
  /**
   * The regression this file exists for. `[30]` is the retention window in
   * section 7 of docs/PRIVACY-POLICY.md, and the rule required an uppercase
   * first character, so it scanned clean and shipped.
   */
  it("catches a bare number left for a human", () => {
    expect(findPlaceholders("Backups roll off within [30] days.")).toEqual(["[30]"]);
  });

  it("catches the same shape with a unit attached", () => {
    expect(findPlaceholders("We keep logs for [90 days] after collection.")).toEqual([
      "[90 days]",
    ]);
  });

  it("reports it once however often it appears", () => {
    expect(findPlaceholders("[30] here and [30] there")).toEqual(["[30]"]);
  });

  it("finds it alongside the shapes that already worked", () => {
    expect(
      findPlaceholders("[LEGAL ENTITY NAME] keeps backups for [30] days; write to [dpo@yourdomain.com]."),
    ).toEqual(["[LEGAL ENTITY NAME]", "[30]", "[dpo@yourdomain.com]"]);
  });
});

describe("findPlaceholders — what must stay unflagged", () => {
  /**
   * The line between a blank and prose is that a blank is a *value* and prose
   * is a phrase opening with a lowercase word. `[see section 4]` contains a
   * digit, so "contains a digit" would have been the wrong rule.
   */
  it("leaves ordinary bracketed prose alone", () => {
    expect(findPlaceholders("we retain it [see section 4] for a year")).toEqual([]);
    expect(findPlaceholders("the wording [sic] is theirs")).toEqual([]);
    expect(findPlaceholders("as described [above] and below")).toEqual([]);
  });

  it("leaves Markdown link syntax alone", () => {
    expect(findPlaceholders("See [our policy](https://example.com/privacy).")).toEqual([]);
    expect(findPlaceholders("See [OUR POLICY](https://example.com/privacy).")).toEqual([]);
    expect(findPlaceholders("See [the terms][terms] and [THE TERMS][t2].")).toEqual([]);
    expect(findPlaceholders("[terms]: https://example.com/terms")).toEqual([]);
    expect(findPlaceholders("[SECTION 7]: https://example.com/#retention")).toEqual([]);
  });

  /**
   * A colon after a placeholder is not a link definition unless a destination
   * follows it. Losing this would hide the most likely way a contact blank gets
   * written: as the label of the line that explains it.
   */
  it("still flags a placeholder that merely happens to be followed by a colon", () => {
    expect(findPlaceholders("**[privacy@yourdomain.com]:** for data requests")).toEqual([
      "[privacy@yourdomain.com]",
    ]);
  });
});
