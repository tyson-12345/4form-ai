/**
 * Short-lived tokens that carry state across the two-step federated sign-in
 * flows, without a server-side session store.
 *
 * Two flows need to pause and come back:
 *
 *  - **Registration.** Apple and Google do not tell us a date of birth, and the
 *    account cannot be created without one (see `safeBirthDate`). So the first
 *    call returns a *registration* token describing the verified provider
 *    identity, the app collects a birth date, and the second call redeems it.
 *  - **Linking.** A verified provider identity whose email already belongs to
 *    an account must not silently take that account over. The first call
 *    returns a *link challenge*, the user proves the password once, and the
 *    second call attaches the identity.
 *
 * ── Why these are not signed with JWT_SECRET ────────────────────────────────
 * This is the part that matters, and it is a real vulnerability if done the
 * obvious way.
 *
 * A link challenge names the user it is a challenge *for*. Sign that with the
 * session secret and it is, structurally, a session token: an attacker who
 * triggers a collision against a victim's address receives a signed blob
 * naming the victim, and can present it as a bearer token to become that user —
 * skipping the password proof the challenge exists to demand. The feature would
 * hand out exactly what it was built to withhold.
 *
 * So the signing key here is derived from `JWT_SECRET` and cannot verify
 * against it. Cross-use is not "prevented by a check we remembered to write",
 * it is arithmetically impossible. Three further guards sit on top, because
 * this is worth being repetitive about:
 *
 *   1. A distinct `issuer`, which `verifyToken` pins against.
 *   2. An explicit `purpose` claim, which `verifyToken` rejects outright.
 *   3. The user id travels as `uid`, not `userId`, so even a token that somehow
 *      reached `verifyToken` would fail its "malformed payload" check.
 *
 * See `test/oauth-flow-token-isolation.test.ts`, which asserts all four.
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { IdentityProvider } from "@workspace/db";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");

/**
 * A key derived from the session secret, for flow tokens only.
 *
 * HMAC with a fixed label: one secret to configure and rotate, two keys that
 * cannot impersonate each other. The label is versioned so that if the flow
 * token format ever changes incompatibly, bumping it invalidates every
 * outstanding one without touching `JWT_SECRET` and logging every user out.
 */
const FLOW_SECRET: Buffer = crypto
  .createHmac("sha256", JWT_SECRET)
  .update("athleteai-oauth-flow-v1")
  .digest();

/** Deliberately different from the session issuer, which is `athleteai-api`. */
export const FLOW_ISSUER = "athleteai-api/oauth-flow";

/**
 * Long enough to type a birth date without rushing, short enough that a token
 * captured from a log or a crash report is stale before it is useful.
 */
const REGISTRATION_TTL_S = 20 * 60;
/** Shorter: this one is presented alongside a password. */
const LINK_TTL_S = 10 * 60;

export type FlowPurpose = "oauth_register" | "oauth_link";

/** A provider identity that verified but has no account yet. */
export interface RegistrationClaims {
  purpose: "oauth_register";
  provider: IdentityProvider;
  subject: string;
  /** Always present and always provider-verified — the route refuses otherwise. */
  email: string;
  /**
   * The display name the client forwarded from the provider credential, if any.
   *
   * Client-asserted and therefore untrusted: Apple returns the name only to the
   * device, never in the token, so there is no way to verify it. It is
   * sanitized before it is stored and it only ever populates a profile display
   * name — nothing authorizes off it.
   */
  nameHint?: string;
}

/** A verified provider identity whose email already belongs to an account. */
export interface LinkClaims {
  purpose: "oauth_link";
  provider: IdentityProvider;
  subject: string;
  providerEmail: string;
  /** Named `uid`, not `userId` — see the header. */
  uid: string;
}

export type FlowClaims = RegistrationClaims | LinkClaims;

function sign(claims: FlowClaims, ttlSeconds: number): string {
  return jwt.sign(claims, FLOW_SECRET, {
    algorithm: "HS256",
    expiresIn: ttlSeconds,
    issuer: FLOW_ISSUER,
  });
}

export function signRegistrationToken(claims: Omit<RegistrationClaims, "purpose">): string {
  return sign({ ...claims, purpose: "oauth_register" }, REGISTRATION_TTL_S);
}

export function signLinkToken(claims: Omit<LinkClaims, "purpose">): string {
  return sign({ ...claims, purpose: "oauth_link" }, LINK_TTL_S);
}

export class FlowTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowTokenError";
  }
}

/**
 * Verify a flow token and confirm it is the kind the caller expected.
 *
 * The `expected` argument is not ceremony. Without it, a registration token —
 * which any anonymous caller can obtain for an address they control — would be
 * accepted by the link endpoint, and vice versa. Each endpoint states the one
 * purpose it will honour.
 */
export function verifyFlowToken<P extends FlowPurpose>(
  token: string,
  expected: P,
): Extract<FlowClaims, { purpose: P }> {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, FLOW_SECRET, {
      algorithms: ["HS256"],
      issuer: FLOW_ISSUER,
    });
  } catch (err) {
    throw new FlowTokenError(err instanceof Error ? err.message : "Flow token rejected");
  }

  if (typeof decoded !== "object" || decoded === null) {
    throw new FlowTokenError("Flow token payload was not an object");
  }

  const claims = decoded as Partial<FlowClaims>;
  if (claims.purpose !== expected) {
    throw new FlowTokenError(
      `Flow token is for "${claims.purpose ?? "nothing"}", not "${expected}"`,
    );
  }
  if (typeof claims.provider !== "string" || typeof claims.subject !== "string") {
    throw new FlowTokenError("Flow token is missing its provider identity");
  }

  return claims as Extract<FlowClaims, { purpose: P }>;
}
