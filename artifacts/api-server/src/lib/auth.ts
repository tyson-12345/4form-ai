/**
 * Password hashing, verification, and JWT issuance.
 *
 * Passwords are never logged, never returned, and never compared with `===`.
 * The only comparison paths are bcrypt's own constant-time `compare` and
 * `crypto.timingSafeEqual` for the legacy formats we are migrating off.
 */

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");
if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 48");
}

const JWT_EXPIRES_IN = "7d";
const JWT_ISSUER = "athleteai-api";

/**
 * bcrypt cost factor. 12 is the floor for new hashes; raising this later is
 * safe because `needsRehash` will migrate existing users on their next login.
 */
export const BCRYPT_ROUNDS = 12;

export interface JwtPayload {
  userId: string;
  email: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET!, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: JWT_ISSUER,
  });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, JWT_SECRET!, {
    issuer: JWT_ISSUER,
    algorithms: ["HS256"], // pin the algorithm: blocks `alg: none` confusion
  });
  if (typeof decoded === "string" || !decoded.userId || !decoded.email) {
    throw new Error("Malformed token payload");
  }
  return { userId: decoded.userId as string, email: decoded.email as string };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// ─── Legacy hash migration ───────────────────────────────────────────────────

/** Hash formats we accept once, only to immediately upgrade them to bcrypt. */
export type PasswordAlgo = "bcrypt" | "md5" | "sha1" | "sha256" | "plaintext";

export const LEGACY_ALGOS: readonly PasswordAlgo[] = ["md5", "sha1", "sha256", "plaintext"];

export function isLegacyAlgo(algo: string): boolean {
  return (LEGACY_ALGOS as readonly string[]).includes(algo);
}

/**
 * Infer the storage format of an existing hash.
 *
 * Used by the migration script for rows written before `password_algo` existed,
 * where the column defaults to "bcrypt" but the value may not be one.
 */
export function detectAlgo(hash: string): PasswordAlgo {
  if (/^\$2[aby]\$\d{2}\$/.test(hash)) return "bcrypt";
  if (/^[a-f0-9]{32}$/i.test(hash)) return "md5";
  if (/^[a-f0-9]{40}$/i.test(hash)) return "sha1";
  if (/^[a-f0-9]{64}$/i.test(hash)) return "sha256";
  return "plaintext";
}

/** Constant-time string comparison that does not leak length via early return. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch, so hash both to a fixed width
  // first — this keeps the comparison itself constant-time.
  const digestA = crypto.createHash("sha256").update(bufA).digest();
  const digestB = crypto.createHash("sha256").update(bufB).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/**
 * Verify `password` against a stored hash in any supported format.
 *
 * Legacy formats are accepted exactly once — the caller is expected to rehash
 * with bcrypt immediately on success (see `migratePasswordHash` in the auth
 * route). They are unsalted and fast, which is precisely why they must go.
 */
export async function verifyPassword(
  password: string,
  hash: string,
  algo: PasswordAlgo = "bcrypt",
): Promise<boolean> {
  switch (algo) {
    case "bcrypt":
      // bcrypt.compare is constant-time and returns false on a malformed hash
      // rather than throwing.
      return bcrypt.compare(password, hash);
    case "md5":
    case "sha1":
    case "sha256":
      return timingSafeEqualStr(
        crypto.createHash(algo).update(password, "utf8").digest("hex"),
        hash.toLowerCase(),
      );
    case "plaintext":
      return timingSafeEqualStr(password, hash);
    default:
      return false;
  }
}

/** Back-compat alias for existing call sites. */
export const comparePassword = (password: string, hash: string): Promise<boolean> =>
  verifyPassword(password, hash, "bcrypt");

/**
 * True when a stored hash should be re-hashed on the next successful login —
 * either it uses a legacy algorithm, or it is bcrypt below our current cost.
 */
export function needsRehash(hash: string, algo: string): boolean {
  if (isLegacyAlgo(algo)) return true;
  const match = /^\$2[aby]\$(\d{2})\$/.exec(hash);
  if (!match) return true; // not bcrypt despite the column saying so
  return Number(match[1]) < BCRYPT_ROUNDS;
}

// ─── Timing-attack mitigation ────────────────────────────────────────────────

/**
 * A real bcrypt hash at our production cost, computed once at startup.
 *
 * The previous implementation used a hand-written placeholder string that was
 * not valid bcrypt — `compare` rejected it immediately, so a request for a
 * non-existent email returned measurably faster than one for a real account.
 * That turned the login endpoint into an email-enumeration oracle. Hashing a
 * random value here means the "no such user" path does the same ~250ms of work
 * as the "wrong password" path.
 */
const DUMMY_HASH_PROMISE: Promise<string> = bcrypt.hash(
  crypto.randomBytes(32).toString("hex"),
  BCRYPT_ROUNDS,
);

export async function dummyHash(): Promise<string> {
  return DUMMY_HASH_PROMISE;
}

// ─── Password reset tokens ───────────────────────────────────────────────────

/** Raw token goes to the user's inbox; only its SHA-256 is ever stored. */
export function generateResetToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashResetToken(raw) };
}

export function hashResetToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
