/**
 * Verification of identity tokens issued by Apple and Google.
 *
 * ── What this module is defending against ───────────────────────────────────
 * The client hands us a string and says "this proves I am
 * alice@example.com". Everything that makes that claim trustworthy happens
 * here, and nowhere else. Get any one of the five checks below wrong and the
 * endpoint becomes an "log me in as anyone" endpoint:
 *
 *  1. **Signature**, against the provider's *current* published key. Not a
 *     pinned key — both providers rotate, and a pinned key means a silent
 *     outage the week they do.
 *  2. **Issuer.** A validly-signed token from some other issuer is still a
 *     forgery as far as we are concerned.
 *  3. **Audience.** This is the one that is easiest to skip and worst to skip.
 *     Google will happily issue a valid, correctly-signed ID token to *any*
 *     app for the same user. Without an `aud` check, the operator of any other
 *     Google-integrated app could take the token their own users hand them and
 *     replay it here to become those users on AthleteAI.
 *  4. **Expiry**, with a small clock tolerance — these tokens live ~10 minutes.
 *  5. **Nonce**, when the caller supplied one. See `expectedNonce` below for
 *     exactly what this does and does not buy.
 *
 * ── Why there is no provider SDK here ───────────────────────────────────────
 * `google-auth-library` and the Firebase Admin SDK both do this, and both drag
 * in a large dependency tree plus a vendor account model we do not use. The
 * actual work is a JWKS fetch and a `jwt.verify` — Node can build a public key
 * straight from a JWK, so the whole thing is the file you are reading with no
 * new dependency. That also keeps this swappable: adding a third provider is a
 * new entry in `PROVIDERS`, not an SDK migration.
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { IdentityProvider } from "@workspace/db";
import { logger } from "./logger.js";

/** What a verified token tells us. Nothing here is client-supplied. */
export interface VerifiedIdentity {
  provider: IdentityProvider;
  /** The `sub` claim. Stable per provider account, scoped to our team. */
  subject: string;
  /**
   * The address the provider asserted, or null.
   *
   * Apple sends this only on the user's *first* authorization for the app, so
   * null is normal and expected for a returning user — it is not an error.
   */
  email: string | null;
  /**
   * Whether the provider says it has verified that address.
   *
   * Only ever true when the provider says so explicitly. The caller must treat
   * false as "this address proves nothing", because the whole account-linking
   * decision downstream turns on it.
   */
  emailVerified: boolean;
}

export class IdentityTokenError extends Error {
  constructor(
    message: string,
    /** Short machine code for the log. Never returned to a client. */
    readonly code: string,
  ) {
    super(message);
    this.name = "IdentityTokenError";
  }
}

// ─── Provider configuration ──────────────────────────────────────────────────

interface ProviderConfig {
  jwksUrl: string;
  /**
   * Accepted `iss` values. Google is listed twice because it has historically
   * issued both forms and old clients still see the bare-host variant.
   */
  issuers: string[];
  /** Env var holding the comma-separated list of accepted `aud` values. */
  audienceEnv: string;
  /**
   * How the provider binds the nonce into the token.
   *
   * Apple hashes it: the token carries SHA-256(raw) as lowercase hex. Google
   * echoes the raw string. Getting this backwards means the nonce check either
   * always fails (a hard outage) or is silently skipped (no check at all).
   */
  nonceEncoding: "sha256-hex" | "plain";
}

const PROVIDERS: Record<IdentityProvider, ProviderConfig> = {
  apple: {
    jwksUrl: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
    audienceEnv: "APPLE_CLIENT_IDS",
    nonceEncoding: "sha256-hex",
  },
  google: {
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    audienceEnv: "GOOGLE_CLIENT_IDS",
    nonceEncoding: "plain",
  },
};

/**
 * Every provider this build knows how to verify.
 *
 * Derived from `PROVIDERS`, so a provider added to the config above is
 * automatically offered and one removed cannot be requested — the two cannot
 * drift apart. `satisfies` keeps it honest against the schema's type.
 */
export const IDENTITY_PROVIDERS = Object.keys(PROVIDERS) as IdentityProvider[];

/** Narrowing guard for the untrusted `provider` field on a request body. */
export function isIdentityProvider(value: unknown): value is IdentityProvider {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

/**
 * Accepted audiences for a provider, from the environment.
 *
 * Read per-call rather than captured at module load so tests can set it, and so
 * a deploy that adds an Android client ID does not need a code change.
 *
 * An unset or empty value throws. It must not fall back to "accept anything":
 * that is check 3 above, and silently disabling it would turn a missing
 * environment variable into an authentication bypass rather than an outage.
 */
export function audiencesFor(provider: IdentityProvider): string[] {
  const raw = process.env[PROVIDERS[provider].audienceEnv]?.trim();
  const list = raw ? raw.split(",").map((v) => v.trim()).filter(Boolean) : [];
  if (list.length === 0) {
    throw new IdentityTokenError(
      `${PROVIDERS[provider].audienceEnv} is not set. Refusing to verify a ${provider} ` +
        `token without an audience allowlist — without one, a token issued to any ` +
        `other app for this user would be accepted here.`,
      "audience_unconfigured",
    );
  }
  return list;
}

/** True when the provider is configured well enough to be offered to clients. */
export function providerConfigured(provider: IdentityProvider): boolean {
  try {
    audiencesFor(provider);
    return true;
  } catch {
    return false;
  }
}

// ─── JWKS cache ──────────────────────────────────────────────────────────────

interface JwksCacheEntry {
  keys: Map<string, crypto.KeyObject>;
  fetchedAt: number;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
/**
 * Floor between refetches triggered by an unrecognised `kid`.
 *
 * Without it, anyone can make us hammer Apple's key endpoint by posting tokens
 * with random `kid` headers — we would refetch on every one. With it, an
 * unknown key costs at most one upstream request per minute no matter how many
 * bad tokens arrive.
 */
const JWKS_REFETCH_FLOOR_MS = 60 * 1000;
const JWKS_TIMEOUT_MS = 5_000;

const jwksCache = new Map<IdentityProvider, JwksCacheEntry>();
/** De-duplicates concurrent fetches so a cold start does not stampede. */
const jwksInFlight = new Map<IdentityProvider, Promise<JwksCacheEntry>>();

async function fetchJwks(provider: IdentityProvider): Promise<JwksCacheEntry> {
  const inFlight = jwksInFlight.get(provider);
  if (inFlight) return inFlight;

  const promise = (async (): Promise<JwksCacheEntry> => {
    const { jwksUrl } = PROVIDERS[provider];
    let response: Response;
    try {
      response = await fetch(jwksUrl, {
        signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
    } catch (err) {
      throw new IdentityTokenError(
        `Could not reach the ${provider} key endpoint: ${err instanceof Error ? err.message : "unknown"}`,
        "jwks_unreachable",
      );
    }
    if (!response.ok) {
      throw new IdentityTokenError(
        `${provider} key endpoint returned ${response.status}`,
        "jwks_bad_status",
      );
    }

    const body = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) {
      throw new IdentityTokenError(`${provider} JWKS had no key array`, "jwks_malformed");
    }

    const keys = new Map<string, crypto.KeyObject>();
    for (const jwk of body.keys as Record<string, unknown>[]) {
      const kid = typeof jwk.kid === "string" ? jwk.kid : null;
      // Only signing keys, and only RSA — both providers use RS256. Importing
      // whatever shows up would mean accepting an algorithm we have not
      // reasoned about.
      if (!kid || jwk.kty !== "RSA") continue;
      if (jwk.use !== undefined && jwk.use !== "sig") continue;
      try {
        keys.set(kid, crypto.createPublicKey({ key: jwk as crypto.webcrypto.JsonWebKey, format: "jwk" }));
      } catch {
        // One unusable key must not poison the whole set.
        logger.warn({ provider, kid, event: "jwks_key_unusable" }, "Skipped an unusable JWKS key");
      }
    }

    if (keys.size === 0) {
      throw new IdentityTokenError(`${provider} JWKS contained no usable keys`, "jwks_empty");
    }

    const entry: JwksCacheEntry = { keys, fetchedAt: Date.now() };
    jwksCache.set(provider, entry);
    logger.info({ provider, keyCount: keys.size, event: "jwks_refreshed" }, "Fetched provider keys");
    return entry;
  })().finally(() => {
    jwksInFlight.delete(provider);
  });

  jwksInFlight.set(provider, promise);
  return promise;
}

/**
 * The public key for `kid`, refetching once if it is unrecognised.
 *
 * The refetch matters: providers publish a new key *before* they start signing
 * with it, but a long-lived process that cached the old set would reject every
 * token minted with the new one until it happened to restart.
 */
async function publicKeyFor(
  provider: IdentityProvider,
  kid: string,
): Promise<crypto.KeyObject> {
  let entry = jwksCache.get(provider);

  if (!entry || Date.now() - entry.fetchedAt > JWKS_TTL_MS) {
    entry = await fetchJwks(provider);
  }

  let key = entry.keys.get(kid);
  if (!key && Date.now() - entry.fetchedAt > JWKS_REFETCH_FLOOR_MS) {
    entry = await fetchJwks(provider);
    key = entry.keys.get(kid);
  }

  if (!key) {
    throw new IdentityTokenError(
      `No published ${provider} key matches this token's kid`,
      "unknown_kid",
    );
  }
  return key;
}

/** Drops cached keys. Tests only. */
export function __resetJwksCache(): void {
  jwksCache.clear();
  jwksInFlight.clear();
}

// ─── Verification ────────────────────────────────────────────────────────────

/** Both providers sign with RS256. Pinning blocks `alg: none` and HS256 confusion. */
const ACCEPTED_ALGORITHMS = ["RS256"] as const;

/** Tokens live ~10 minutes; 30s covers ordinary clock drift without widening that. */
const CLOCK_TOLERANCE_S = 30;

/**
 * Apple sends `email_verified` as the string "true" on some flows and the
 * boolean `true` on others. Anything else — including the string "false",
 * `undefined`, and any truthy non-`true` value — is not verified.
 */
function claimIsTrue(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * Verify an identity token and return only what the provider actually asserted.
 *
 * @param expectedNonce the raw nonce the client generated for this attempt.
 *   When supplied, the token's `nonce` claim must match it under the provider's
 *   encoding, which ties the token to *this* sign-in attempt and makes a token
 *   captured from an earlier attempt useless.
 *
 *   What it does not do: stop the holder of a token from using their own token,
 *   because the client picks the nonce. Binding to a server-issued nonce would
 *   close that, at the cost of server-side state per attempt. The audience
 *   check is what carries the weight against cross-app replay; this is a
 *   second, cheaper layer against replay within our own flow.
 */
export async function verifyIdentityToken(
  provider: IdentityProvider,
  identityToken: string,
  expectedNonce?: string | null,
): Promise<VerifiedIdentity> {
  const config = PROVIDERS[provider];
  const audience = audiencesFor(provider);

  // Decode (not verify) to read the `kid`, so we know which key to demand.
  // Nothing from this decode is trusted or used beyond selecting the key.
  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded || typeof decoded === "string") {
    throw new IdentityTokenError("Token is not a decodable JWT", "undecodable");
  }
  const header = decoded.header;
  if (!header.kid) {
    throw new IdentityTokenError("Token header has no kid", "no_kid");
  }
  if (!ACCEPTED_ALGORITHMS.includes(header.alg as (typeof ACCEPTED_ALGORITHMS)[number])) {
    throw new IdentityTokenError(`Token alg ${header.alg} is not accepted`, "bad_alg");
  }

  const key = await publicKeyFor(provider, header.kid);

  let claims: jwt.JwtPayload;
  try {
    const verified = jwt.verify(identityToken, key, {
      algorithms: [...ACCEPTED_ALGORITHMS],
      issuer: config.issuers as [string, ...string[]],
      audience: audience as [string, ...string[]],
      clockTolerance: CLOCK_TOLERANCE_S,
    });
    if (typeof verified === "string") {
      throw new IdentityTokenError("Token payload was not an object", "payload_not_object");
    }
    claims = verified;
  } catch (err) {
    if (err instanceof IdentityTokenError) throw err;
    throw new IdentityTokenError(
      err instanceof Error ? err.message : "Token verification failed",
      "verify_failed",
    );
  }

  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new IdentityTokenError("Token has no subject", "no_subject");
  }

  if (expectedNonce) {
    const expected =
      config.nonceEncoding === "sha256-hex"
        ? crypto.createHash("sha256").update(expectedNonce).digest("hex")
        : expectedNonce;
    const actual = typeof claims.nonce === "string" ? claims.nonce : "";
    // Constant-time over fixed-width digests: a plain !== on the raw values
    // leaks the matching prefix length by timing.
    const matches =
      actual.length > 0 &&
      crypto.timingSafeEqual(
        crypto.createHash("sha256").update(expected).digest(),
        crypto.createHash("sha256").update(actual).digest(),
      );
    if (!matches) {
      throw new IdentityTokenError("Token nonce does not match this attempt", "nonce_mismatch");
    }
  }

  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;

  return {
    provider,
    subject: claims.sub,
    email: email && email.length > 0 ? email : null,
    // An address with no explicit verification claim is treated as unverified.
    emailVerified: Boolean(email) && claimIsTrue(claims.email_verified),
  };
}
