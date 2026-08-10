import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  comparePassword,
  signToken,
  verifyToken,
  needsRehash,
  detectAlgo,
  isLegacyAlgo,
  dummyHash,
  generateResetToken,
  hashResetToken,
  BCRYPT_ROUNDS,
} from "./auth.js";

const PASSWORD = "correct-horse-battery-staple";

describe("hashPassword", () => {
  it("produces a bcrypt hash at the configured cost", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("uses a cost factor of at least 12", () => {
    expect(BCRYPT_ROUNDS).toBeGreaterThanOrEqual(12);
  });

  it("salts, so the same password hashes differently each time", async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
  });

  it("never stores the plaintext anywhere in the hash", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toContain(PASSWORD);
  });
});

describe("verifyPassword — bcrypt", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash, "bcrypt")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword("wrong-password-entirely", hash, "bcrypt")).toBe(false);
  });

  it("is case sensitive", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD.toUpperCase(), hash, "bcrypt")).toBe(false);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    // The login path compares against a dummy value when no user exists; a
    // throw here would turn that into a distinguishable 500.
    await expect(verifyPassword(PASSWORD, "not-a-bcrypt-hash", "bcrypt")).resolves.toBe(false);
  });

  it("comparePassword is the bcrypt alias", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await comparePassword(PASSWORD, hash)).toBe(true);
  });
});

describe("verifyPassword — legacy formats", () => {
  it("verifies an md5 hash", async () => {
    const hash = crypto.createHash("md5").update(PASSWORD).digest("hex");
    expect(await verifyPassword(PASSWORD, hash, "md5")).toBe(true);
    expect(await verifyPassword("nope", hash, "md5")).toBe(false);
  });

  it("verifies a sha1 hash", async () => {
    const hash = crypto.createHash("sha1").update(PASSWORD).digest("hex");
    expect(await verifyPassword(PASSWORD, hash, "sha1")).toBe(true);
  });

  it("verifies a sha256 hash", async () => {
    const hash = crypto.createHash("sha256").update(PASSWORD).digest("hex");
    expect(await verifyPassword(PASSWORD, hash, "sha256")).toBe(true);
  });

  it("is case-insensitive about stored hex casing", async () => {
    const hash = crypto.createHash("md5").update(PASSWORD).digest("hex").toUpperCase();
    expect(await verifyPassword(PASSWORD, hash, "md5")).toBe(true);
  });

  it("verifies a plaintext password", async () => {
    expect(await verifyPassword(PASSWORD, PASSWORD, "plaintext")).toBe(true);
    expect(await verifyPassword("other", PASSWORD, "plaintext")).toBe(false);
  });

  it("handles length mismatches without throwing", async () => {
    // timingSafeEqual throws on differing buffer lengths; the implementation
    // hashes both sides to a fixed width first.
    await expect(verifyPassword("a", "a-much-longer-stored-value", "plaintext")).resolves.toBe(
      false,
    );
  });
});

describe("detectAlgo", () => {
  it.each([
    ["$2b$12$abcdefghijklmnopqrstuv", "bcrypt"],
    ["$2a$10$abcdefghijklmnopqrstuv", "bcrypt"],
    ["5f4dcc3b5aa765d61d8327deb882cf99", "md5"],
    ["5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8", "sha1"],
    ["a".repeat(64), "sha256"],
    ["hunter2", "plaintext"],
  ])("classifies %s as %s", (hash, expected) => {
    expect(detectAlgo(hash)).toBe(expected);
  });
});

describe("needsRehash", () => {
  it("flags every legacy algorithm", () => {
    for (const algo of ["md5", "sha1", "sha256", "plaintext"]) {
      expect(needsRehash("whatever", algo), algo).toBe(true);
      expect(isLegacyAlgo(algo), algo).toBe(true);
    }
  });

  it("flags bcrypt below the current cost", () => {
    expect(needsRehash("$2b$10$abcdefghijklmnopqrstuv", "bcrypt")).toBe(true);
  });

  it("leaves a current bcrypt hash alone", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(needsRehash(hash, "bcrypt")).toBe(false);
  });

  it("flags a row whose column says bcrypt but whose value is not", () => {
    expect(needsRehash("plaintext-value", "bcrypt")).toBe(true);
  });
});

describe("dummyHash", () => {
  it("is a real bcrypt hash at production cost", async () => {
    // The old placeholder was not valid bcrypt, so `compare` rejected it
    // instantly and the "no such user" path returned measurably faster than a
    // wrong-password attempt — an email-enumeration oracle.
    const hash = await dummyHash();
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("verifies as false for any password", async () => {
    const hash = await dummyHash();
    expect(await verifyPassword("anything at all", hash, "bcrypt")).toBe(false);
  });

  it("costs comparable time to a real comparison", async () => {
    const real = await hashPassword(PASSWORD);
    const dummy = await dummyHash();

    const timeOf = async (hash: string): Promise<number> => {
      const start = process.hrtime.bigint();
      await verifyPassword("some-guess", hash, "bcrypt");
      return Number(process.hrtime.bigint() - start) / 1e6;
    };

    const realMs = await timeOf(real);
    const dummyMs = await timeOf(dummy);

    // Same cost factor means the same work; allow generous slack for CI jitter.
    expect(dummyMs).toBeGreaterThan(realMs * 0.4);
    expect(dummyMs).toBeLessThan(realMs * 2.5);
  });
});

describe("JWT", () => {
  it("round-trips a payload", () => {
    const token = signToken({ userId: "user-1", email: "a@b.com" });
    expect(verifyToken(token)).toMatchObject({ userId: "user-1", email: "a@b.com" });
  });

  it("rejects a tampered token", () => {
    const token = signToken({ userId: "user-1", email: "a@b.com" });
    const tampered = token.slice(0, -3) + "aaa";
    expect(() => verifyToken(tampered)).toThrow();
  });

  it("rejects a token signed with a different secret", () => {
    // Hand-built HS256 token with a foreign key.
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ userId: "x", email: "y" })).toString("base64url");
    const sig = crypto.createHmac("sha256", "some-other-secret").update(`${header}.${body}`).digest("base64url");
    expect(() => verifyToken(`${header}.${body}.${sig}`)).toThrow();
  });

  it("rejects an unsigned 'alg: none' token", () => {
    // Algorithm pinning blocks the classic JWT confusion attack.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ userId: "attacker", email: "a@b.com" })).toString("base64url");
    expect(() => verifyToken(`${header}.${body}.`)).toThrow();
  });

  it("rejects garbage", () => {
    expect(() => verifyToken("not.a.token")).toThrow();
  });
});

describe("password reset tokens", () => {
  it("generates a high-entropy raw token", () => {
    const { raw } = generateResetToken();
    expect(raw.length).toBeGreaterThanOrEqual(32);
  });

  it("never returns the raw token as the stored hash", () => {
    const { raw, hash } = generateResetToken();
    expect(hash).not.toBe(raw);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes deterministically so lookup works", () => {
    const { raw, hash } = generateResetToken();
    expect(hashResetToken(raw)).toBe(hash);
  });

  it("produces a distinct token every call", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateResetToken().raw));
    expect(seen.size).toBe(50);
  });
});
