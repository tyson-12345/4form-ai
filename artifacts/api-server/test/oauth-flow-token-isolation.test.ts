/**
 * The federated sign-in flow tokens must never be usable as session tokens.
 *
 * This is the sharp edge of the whole feature. A link challenge is handed to an
 * *unauthenticated* caller and it names the user it is a challenge for. If that
 * blob is also accepted as a bearer token, then triggering a collision against
 * someone's address returns a working session for their account — and the
 * challenge, whose entire job is to demand a password first, becomes the thing
 * that hands out access without one.
 *
 * Four independent guards stop that, and each is asserted separately below so
 * that removing any one of them fails a test rather than quietly narrowing the
 * margin to zero.
 */

import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const { signToken, verifyToken } = await import("../src/lib/auth.js");
const { signLinkToken, signRegistrationToken, verifyFlowToken, FLOW_ISSUER } =
  await import("../src/lib/oauthFlowTokens.js");

const UID = "11111111-2222-3333-4444-555555555555";

const linkToken = () =>
  signLinkToken({
    provider: "apple",
    subject: "000123.abc",
    providerEmail: "athlete@example.com",
    uid: UID,
  });

describe("a link challenge cannot authenticate", () => {
  it("is rejected by the session verifier", () => {
    expect(() => verifyToken(linkToken())).toThrow();
  });

  it("does not verify under the session secret at all (guard 1: derived key)", () => {
    // Not merely refused by a check we wrote — the signature does not validate,
    // because the flow key is HMAC(JWT_SECRET, label) and not JWT_SECRET.
    expect(() =>
      jwt.verify(linkToken(), process.env.JWT_SECRET!, { algorithms: ["HS256"] }),
    ).toThrow(/signature/i);
  });

  it("carries a different issuer from a session token (guard 2)", () => {
    const flow = jwt.decode(linkToken()) as { iss?: string };
    const session = jwt.decode(signToken({ userId: UID, email: "a@b.com" })) as { iss?: string };
    expect(flow.iss).toBe(FLOW_ISSUER);
    expect(session.iss).toBe("athleteai-api");
    expect(flow.iss).not.toBe(session.iss);
  });

  it("is refused for its purpose claim even when signed with the session secret (guard 3)", () => {
    // Simulates the mistake of someone 'simplifying' the two secrets into one:
    // this token is signed with JWT_SECRET and carries the session issuer, so
    // guards 1 and 2 are both gone. It must still be refused.
    const forged = jwt.sign(
      { userId: UID, email: "athlete@example.com", purpose: "oauth_link" },
      process.env.JWT_SECRET!,
      { issuer: "athleteai-api", expiresIn: 600 },
    );
    expect(() => verifyToken(forged)).toThrow(/purpose/i);
  });

  it("names the user as `uid`, not `userId` (guard 4)", () => {
    // So a flow token that somehow reached the session verifier with the other
    // three guards removed would still fail its malformed-payload check.
    const claims = jwt.decode(linkToken()) as Record<string, unknown>;
    expect(claims.uid).toBe(UID);
    expect(claims.userId).toBeUndefined();

    const stripped = jwt.sign(
      { ...claims, iss: undefined, purpose: undefined },
      process.env.JWT_SECRET!,
      { issuer: "athleteai-api" },
    );
    expect(() => verifyToken(stripped)).toThrow(/malformed/i);
  });
});

describe("a session token cannot stand in for a flow token", () => {
  it("is rejected by the flow verifier", () => {
    const session = signToken({ userId: UID, email: "athlete@example.com" });
    expect(() => verifyFlowToken(session, "oauth_link")).toThrow();
  });
});

describe("flow tokens are not interchangeable with each other", () => {
  it("a registration token is refused by the link endpoint's verifier", () => {
    // This one matters on its own: a registration token is obtainable by any
    // anonymous caller for an address they control. If the link endpoint
    // accepted one, an attacker could mint their own challenge naming... well,
    // nothing, because a registration token has no `uid` — which is exactly why
    // the purpose check must reject it rather than reading a missing field.
    const registration = signRegistrationToken({
      provider: "google",
      subject: "sub-1",
      email: "athlete@example.com",
    });
    expect(() => verifyFlowToken(registration, "oauth_link")).toThrow(/oauth_register/);
  });

  it("a link token is refused by the registration endpoint's verifier", () => {
    expect(() => verifyFlowToken(linkToken(), "oauth_register")).toThrow(/oauth_link/);
  });

  it("accepts each token for its own purpose", () => {
    expect(verifyFlowToken(linkToken(), "oauth_link").uid).toBe(UID);
    const reg = signRegistrationToken({
      provider: "apple",
      subject: "sub-2",
      email: "athlete@example.com",
      nameHint: "Sam",
    });
    expect(verifyFlowToken(reg, "oauth_register").nameHint).toBe("Sam");
  });
});

describe("flow tokens expire", () => {
  it("refuses one that has aged out", () => {
    const expired = jwt.sign(
      { purpose: "oauth_link", provider: "apple", subject: "s", providerEmail: "a@b.com", uid: UID },
      // Same derivation as lib/oauthFlowTokens.ts.
      crypto
        .createHmac("sha256", process.env.JWT_SECRET!)
        .update("athleteai-oauth-flow-v1")
        .digest(),
      { issuer: FLOW_ISSUER, expiresIn: -10 },
    );
    expect(() => verifyFlowToken(expired, "oauth_link")).toThrow(/expired/i);
  });
});
