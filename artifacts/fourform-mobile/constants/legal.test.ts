import { describe, expect, it, vi } from "vitest";

// `legal.ts` reaches react-native for `Linking` and `@/lib/alert` for the
// dialogs, neither of which exists under a node test runner. Only the pure
// resolution below is under test here, so both are stubbed rather than
// exercised — see the note in `resolveLegalBaseUrl` about why that function is
// exported at all.
vi.mock("react-native", () => ({
  Linking: { canOpenURL: vi.fn(), openURL: vi.fn() },
}));
vi.mock("@/lib/alert", () => ({ alert: vi.fn() }));

import { resolveLegalBaseUrl } from "./legal";

describe("resolveLegalBaseUrl", () => {
  describe("an explicit setting wins", () => {
    it("uses EXPO_PUBLIC_LEGAL_BASE_URL over the API origin", () => {
      // The point of the precedence: a marketing domain is where a reader
      // expects these documents, and it is rarely the API's host.
      expect(resolveLegalBaseUrl("https://4formai.com", "https://api.4formai.com")).toBe(
        "https://4formai.com",
      );
    });

    it("strips trailing slashes so <base>/privacy stays a single slash", () => {
      expect(resolveLegalBaseUrl("https://4formai.com///", undefined)).toBe("https://4formai.com");
    });

    it("honours an explicit value the origin check would have rejected", () => {
      // Someone naming a host on purpose has said which host they mean. The
      // athleteai.app incident was about guessing one, not about obeying one.
      expect(resolveLegalBaseUrl("http://localhost:8080", undefined)).toBe("http://localhost:8080");
    });

    it("treats a whitespace-only setting as unset", () => {
      expect(resolveLegalBaseUrl("   ", "https://api.4formai.com")).toBe("https://api.4formai.com");
    });
  });

  describe("derives from a public https API origin", () => {
    it("uses the API origin when no legal base is set", () => {
      expect(resolveLegalBaseUrl(undefined, "https://api.4formai.com")).toBe(
        "https://api.4formai.com",
      );
    });

    it("strips a trailing slash from the API origin too", () => {
      expect(resolveLegalBaseUrl(undefined, "https://api.4formai.com/")).toBe(
        "https://api.4formai.com",
      );
    });

    it("accepts an apex domain", () => {
      expect(resolveLegalBaseUrl(undefined, "https://4formai.com")).toBe("https://4formai.com");
    });

    it("accepts a multi-label host", () => {
      expect(resolveLegalBaseUrl(undefined, "https://api.eu.4form-ai.co.uk")).toBe(
        "https://api.eu.4form-ai.co.uk",
      );
    });
  });

  // Every value below is one `resolveApiUrl` in lib/api.ts accepts happily.
  // None of them may become a URL in a store listing.
  describe("refuses to derive a published URL from a dev value", () => {
    it.each([
      ["the documented local dev value", "http://localhost:3000"],
      ["the native simulator fallback", "http://localhost:3001"],
      ["the documented physical-device LAN value", "http://192.168.1.42:3000"],
      ["an https LAN address", "https://192.168.1.42"],
      ["an https loopback literal", "https://127.0.0.1"],
      ["bare localhost over https", "https://localhost"],
      ["localhost with a port over https", "https://localhost:3000"],
      ["a Bonjour name", "https://tysons-mac.local"],
      ["a .localhost name", "https://api.localhost"],
      ["cleartext on a real domain", "http://api.4formai.com"],
    ])("returns null for %s", (_label, apiUrl) => {
      expect(resolveLegalBaseUrl(undefined, apiUrl)).toBeNull();
    });

    it("returns null for an https origin on a non-standard port", () => {
      // lib/api.ts's header is a field report about non-standard ports being
      // silently blocked on cellular and corporate networks. A store reviewer
      // is on one of those networks.
      expect(resolveLegalBaseUrl(undefined, "https://api.4formai.com:8443")).toBeNull();
    });

    it("returns null when the API variable carries a path", () => {
      // `resolveApiUrl` appends `/api` to this value, so it is an origin by
      // contract. A path means it is something else, and the legal pages are
      // served from the root regardless.
      expect(resolveLegalBaseUrl(undefined, "https://4formai.com/api")).toBeNull();
    });

    it("returns null when nothing at all is set", () => {
      expect(resolveLegalBaseUrl(undefined, undefined)).toBeNull();
    });

    it("returns null when both are whitespace", () => {
      expect(resolveLegalBaseUrl("  ", "  ")).toBeNull();
    });
  });

  it("gives the same answer twice for the same input", () => {
    // Guards against the origin pattern ever acquiring a `g` flag, whose
    // `lastIndex` would make every second call fail.
    expect(resolveLegalBaseUrl(undefined, "https://api.4formai.com")).toBe(
      "https://api.4formai.com",
    );
    expect(resolveLegalBaseUrl(undefined, "https://api.4formai.com")).toBe(
      "https://api.4formai.com",
    );
  });
});
