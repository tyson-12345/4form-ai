import { describe, it, expect } from "vitest";
import { SPORTS } from "./sports";
import { scienceForSport, pubmedUrl } from "./sportScience";

/**
 * The library's contract: every sport the picker offers gets three sourced
 * reads — injuries, prevention, form — and only "Other" is allowed to fall
 * back to the generic entries. A sport silently falling through to generic
 * content would defeat the point of a per-sport science screen.
 */

describe("scienceForSport", () => {
  const generic = scienceForSport("no-such-sport");

  for (const sport of SPORTS) {
    if (sport === "Other") continue;
    it(`has sport-specific, fully sourced entries for ${sport}`, () => {
      const articles = scienceForSport(sport);
      // Not the generic fallback.
      expect(articles[0].title).not.toBe(generic[0].title);
      // One of each kind, in reading order.
      expect(articles.map((a) => a.kind)).toEqual(["injuries", "prevention", "form"]);
      for (const a of articles) {
        expect(a.title.length).toBeGreaterThan(0);
        expect(a.body.length).toBeGreaterThan(40);
        // Every entry cites something checkable: an author-year citation.
        expect(a.source).toMatch(/\d{4}/);
        // And links to a PubMed search, never a bare id.
        expect(pubmedUrl(a)).toMatch(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\?term=/);
      }
    });
  }

  it("gives Other and unknown sports the honest generic entries", () => {
    expect(scienceForSport("Other")[0].title).toBe(generic[0].title);
    expect(scienceForSport(null)[0].title).toBe(generic[0].title);
    expect(scienceForSport("  ")[0].source).toContain("Bahr");
  });

  it("matches case-insensitively, same as the risk profiles", () => {
    expect(scienceForSport("RUNNING")[0].title).toBe(scienceForSport("running")[0].title);
    expect(scienceForSport(" Track & Field ")[0].source).toContain("Edouard");
  });
});
