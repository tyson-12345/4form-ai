/**
 * The federated-flow handoff slot.
 *
 * Small surface, but it holds a credential between two screens, so the two
 * properties worth pinning are that it is single-use and that it cannot hand a
 * link challenge to the screen expecting a registration token (or the reverse).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { stashOAuth, takeOAuth, clearOAuth } from "./oauthHandoff";

const REGISTRATION = {
  kind: "registration",
  token: "reg-token",
  email: "athlete@example.com",
  suggestedName: "Sam",
} as const;

const LINK = {
  kind: "link",
  token: "link-token",
  email: "athlete@example.com",
  message: "",
} as const;

beforeEach(() => clearOAuth());

describe("takeOAuth", () => {
  it("returns null when nothing is pending", () => {
    expect(takeOAuth("registration")).toBeNull();
    expect(takeOAuth("link")).toBeNull();
  });

  it("returns what was stashed", () => {
    stashOAuth({ ...REGISTRATION });
    expect(takeOAuth("registration")).toMatchObject({ token: "reg-token", suggestedName: "Sam" });
  });

  it("is single-use", () => {
    // A token left behind would be found by a later, unrelated visit to the
    // route and redeemed against a flow the user had already abandoned.
    stashOAuth({ ...LINK });
    expect(takeOAuth("link")).not.toBeNull();
    expect(takeOAuth("link")).toBeNull();
  });

  it("does not hand a link challenge to the registration screen", () => {
    stashOAuth({ ...LINK });
    expect(takeOAuth("registration")).toBeNull();
  });

  it("does not hand a registration token to the link screen", () => {
    stashOAuth({ ...REGISTRATION });
    expect(takeOAuth("link")).toBeNull();
  });

  it("leaves a mismatched value in place rather than consuming it", () => {
    // The wrong screen asking must not destroy the right screen's token.
    stashOAuth({ ...REGISTRATION });
    takeOAuth("link");
    expect(takeOAuth("registration")).not.toBeNull();
  });

  it("keeps only the most recent handoff", () => {
    stashOAuth({ ...REGISTRATION });
    stashOAuth({ ...LINK });
    expect(takeOAuth("registration")).toBeNull();
    stashOAuth({ ...LINK });
    expect(takeOAuth("link")).toMatchObject({ token: "link-token" });
  });
});

describe("clearOAuth", () => {
  it("drops anything pending", () => {
    stashOAuth({ ...LINK });
    clearOAuth();
    expect(takeOAuth("link")).toBeNull();
  });
});
