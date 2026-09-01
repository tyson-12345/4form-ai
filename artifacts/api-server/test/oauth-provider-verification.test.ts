/**
 * Identity-token verification.
 *
 * These run against a real RSA keypair whose public half is served through a
 * stubbed JWKS endpoint, so the tokens are genuinely signed and genuinely
 * verified — the checks under test are the real ones, not stand-ins.
 *
 * The audience test is the load-bearing one. Google issues valid, correctly
 * signed ID tokens for the same user to every app that asks, so a verifier that
 * skips `aud` accepts a token any other Google-integrated app was handed, and
 * "sign in with Google" becomes "sign in as anyone whose token I have seen".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const { verifyIdentityToken, audiencesFor, isIdentityProvider, __resetJwksCache } =
  await import("../src/lib/oauthProviders.js");

// ─── Signing fixture ─────────────────────────────────────────────────────────

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-key-1";
const JWKS = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, use: "sig", alg: "RS256" }] };

const APPLE_AUD = "com.fourformai.app";
const GOOGLE_AUD = "1234.apps.googleusercontent.com";

interface TokenOverrides {
  [claim: string]: unknown;
}

function mint(
  issuer: string,
  audience: string,
  overrides: TokenOverrides = {},
  kid = KID,
): string {
  return jwt.sign(
    {
      sub: "000123.9f8e7d",
      email: "athlete@example.com",
      email_verified: true,
      ...overrides,
    },
    privateKey,
    { algorithm: "RS256", issuer, audience, expiresIn: 600, keyid: kid },
  );
}

const appleToken = (o?: TokenOverrides) => mint("https://appleid.apple.com", APPLE_AUD, o);
const googleToken = (o?: TokenOverrides) => mint("https://accounts.google.com", GOOGLE_AUD, o);

let fetchCalls = 0;

beforeEach(() => {
  __resetJwksCache();
  fetchCalls = 0;
  process.env.APPLE_CLIENT_IDS = APPLE_AUD;
  process.env.GOOGLE_CLIENT_IDS = GOOGLE_AUD;
  vi.stubGlobal("fetch", async () => {
    fetchCalls++;
    return { ok: true, status: 200, json: async () => JWKS } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Configuration ───────────────────────────────────────────────────────────

describe("audience configuration", () => {
  it("throws rather than accepting anything when unset", async () => {
    delete process.env.GOOGLE_CLIENT_IDS;
    // The failure mode being prevented: an unset env var silently disabling the
    // audience check, turning a misconfiguration into an auth bypass.
    expect(() => audiencesFor("google")).toThrow(/audience allowlist/i);
    await expect(verifyIdentityToken("google", googleToken())).rejects.toThrow();
  });

  it("accepts a comma-separated list, for the iOS/Android/web client ids", () => {
    process.env.GOOGLE_CLIENT_IDS = " a.apps , b.apps ";
    expect(audiencesFor("google")).toEqual(["a.apps", "b.apps"]);
  });
});

describe("provider guard", () => {
  it("accepts only known providers", () => {
    expect(isIdentityProvider("apple")).toBe(true);
    expect(isIdentityProvider("google")).toBe(true);
    expect(isIdentityProvider("facebook")).toBe(false);
    expect(isIdentityProvider("__proto__")).toBe(false);
  });
});

// ─── The five checks ─────────────────────────────────────────────────────────

describe("verifyIdentityToken", () => {
  it("accepts a well-formed token and returns only provider-asserted facts", async () => {
    const result = await verifyIdentityToken("apple", appleToken());
    expect(result).toEqual({
      provider: "apple",
      subject: "000123.9f8e7d",
      email: "athlete@example.com",
      emailVerified: true,
    });
  });

  it("rejects a token signed by a different key", async () => {
    const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const forged = jwt.sign({ sub: "x", email: "a@b.com" }, other, {
      algorithm: "RS256",
      issuer: "https://appleid.apple.com",
      audience: APPLE_AUD,
      expiresIn: 600,
      keyid: KID,
    });
    await expect(verifyIdentityToken("apple", forged)).rejects.toThrow();
  });

  it("rejects a token minted for another app (audience)", async () => {
    const forOtherApp = mint("https://accounts.google.com", "someone-elses.apps.googleusercontent.com");
    await expect(verifyIdentityToken("google", forOtherApp)).rejects.toThrow();
  });

  it("rejects a token from the wrong issuer", async () => {
    const wrongIssuer = mint("https://evil.example.com", APPLE_AUD);
    await expect(verifyIdentityToken("apple", wrongIssuer)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const expired = jwt.sign({ sub: "x" }, privateKey, {
      algorithm: "RS256",
      issuer: "https://appleid.apple.com",
      audience: APPLE_AUD,
      expiresIn: -120,
      keyid: KID,
    });
    await expect(verifyIdentityToken("apple", expired)).rejects.toThrow(/expired/i);
  });

  it("rejects an unsigned token", async () => {
    // `alg: none` — the classic. Pinning RS256 is what stops it.
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "none", kid: KID })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "x", aud: APPLE_AUD, iss: "https://appleid.apple.com" })).toString("base64url")}.`;
    await expect(verifyIdentityToken("apple", unsigned)).rejects.toThrow(/not accepted/i);
  });

  it("accepts Google's legacy bare-host issuer", async () => {
    const legacy = mint("accounts.google.com", GOOGLE_AUD);
    await expect(verifyIdentityToken("google", legacy)).resolves.toMatchObject({
      subject: "000123.9f8e7d",
    });
  });
});

// ─── Email claims ────────────────────────────────────────────────────────────

describe("email claims", () => {
  it("treats Apple's string \"true\" as verified", async () => {
    const r = await verifyIdentityToken("apple", appleToken({ email_verified: "true" }));
    expect(r.emailVerified).toBe(true);
  });

  it("treats an absent email_verified as unverified", async () => {
    const r = await verifyIdentityToken("apple", appleToken({ email_verified: undefined }));
    expect(r.emailVerified).toBe(false);
  });

  it("treats a truthy non-true value as unverified", async () => {
    // A loose `Boolean(claims.email_verified)` would call "false" verified,
    // because a non-empty string is truthy.
    const r = await verifyIdentityToken("apple", appleToken({ email_verified: "false" }));
    expect(r.emailVerified).toBe(false);
  });

  it("returns a null email when the provider omits it, without failing", async () => {
    // Apple's normal behaviour on every sign-in after the first.
    const r = await verifyIdentityToken("apple", appleToken({ email: undefined }));
    expect(r.email).toBeNull();
    expect(r.emailVerified).toBe(false);
  });

  it("lowercases the asserted address", async () => {
    const r = await verifyIdentityToken("apple", appleToken({ email: "Athlete@Example.COM" }));
    expect(r.email).toBe("athlete@example.com");
  });
});

// ─── Nonce ───────────────────────────────────────────────────────────────────

describe("nonce binding", () => {
  const RAW = "a-random-nonce-value-1234";
  const HASHED = crypto.createHash("sha256").update(RAW).digest("hex");

  it("accepts Apple's SHA-256 encoding of the nonce", async () => {
    await expect(
      verifyIdentityToken("apple", appleToken({ nonce: HASHED }), RAW),
    ).resolves.toMatchObject({ subject: "000123.9f8e7d" });
  });

  it("accepts Google's plain echo of the nonce", async () => {
    await expect(
      verifyIdentityToken("google", googleToken({ nonce: RAW }), RAW),
    ).resolves.toMatchObject({ subject: "000123.9f8e7d" });
  });

  it("rejects a token carrying a different attempt's nonce", async () => {
    await expect(
      verifyIdentityToken("apple", appleToken({ nonce: HASHED }), "some-other-nonce"),
    ).rejects.toThrow(/nonce/i);
  });

  it("rejects a token with no nonce when one was expected", async () => {
    await expect(verifyIdentityToken("apple", appleToken(), RAW)).rejects.toThrow(/nonce/i);
  });

  it("does not confuse the two encodings", async () => {
    // Apple's config hashing Google's plain nonce (or vice versa) would either
    // always fail or, worse, be silently skipped.
    await expect(
      verifyIdentityToken("apple", appleToken({ nonce: RAW }), RAW),
    ).rejects.toThrow(/nonce/i);
  });
});

// ─── Key handling ────────────────────────────────────────────────────────────

describe("JWKS handling", () => {
  it("caches keys across verifications", async () => {
    await verifyIdentityToken("apple", appleToken());
    await verifyIdentityToken("apple", appleToken());
    expect(fetchCalls).toBe(1);
  });

  it("does not refetch on every unknown kid", async () => {
    // Otherwise anyone can make us hammer Apple's key endpoint with junk.
    await verifyIdentityToken("apple", appleToken());
    for (let i = 0; i < 5; i++) {
      await expect(
        verifyIdentityToken("apple", mint("https://appleid.apple.com", APPLE_AUD, {}, `junk-${i}`)),
      ).rejects.toThrow(/kid/i);
    }
    expect(fetchCalls).toBe(1);
  });

  it("surfaces an unreachable key endpoint as a failure, never as a pass", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    await expect(verifyIdentityToken("apple", appleToken())).rejects.toThrow();
  });
});
