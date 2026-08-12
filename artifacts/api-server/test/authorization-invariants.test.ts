/**
 * Authorization invariants, enforced by reading the source.
 *
 * ── Why a source-reading test ───────────────────────────────────────────────
 * Some security properties in this codebase are structural: they hold because
 * of how the code is *shaped*, not because of what any single function returns.
 * A behavioural test cannot see them, and a comment saying "keep it this way"
 * is not enforcement — it is a hope.
 *
 * These are the properties whose violation would be an authorization bug and
 * would otherwise be invisible until someone exploited it. Each one failed
 * silently in some earlier version of this app or in Oscar's fork.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

/** Remove block and line comments so prose about a rule isn't mistaken for it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function listFiles(dir: string): string[] {
  const full = path.join(SRC, dir);
  return fs
    .readdirSync(full)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(dir, f));
}

describe("row access is scoped to the owner", () => {
  it("every by-id read in a repository takes a userId", () => {
    // The IDOR guard. `findAnalysisById(id)` without an owner is the shape that
    // lets one user read another's analysis by guessing a uuid, and the moment
    // such an overload exists a route will eventually call it.
    const offenders: string[] = [];

    for (const rel of listFiles("repositories")) {
      const src = read(rel);
      const re = /export async function (\w*(?:ById|ByUserId|Ownership)\w*)\(([^)]*)\)/gs;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const [, name, params] = m;
        // The one deliberate exception, and the reason it is safe is asserted
        // separately below.
        if (name === "updateAnalysisById") continue;
        if (!/userId/.test(params)) offenders.push(`${rel}: ${name}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("updateAnalysisById is never reachable with a user-supplied id", () => {
    // It takes no userId by design — every caller operates on a row it created
    // moments earlier in the same request. That is only safe while no route
    // handler passes it something from req.params or req.body.
    for (const rel of listFiles("routes")) {
      expect(read(rel), `${rel} must not call updateAnalysisById`).not.toMatch(
        /updateAnalysisById/,
      );
    }
  });
});

describe("entitlement cannot be asserted by the client", () => {
  it("no route writes a tier taken from the request body", () => {
    // Oscar's fork exposes POST /subscriptions/update, which writes
    // `req.body.tier` straight to the database — any authenticated user grants
    // themselves Elite permanently. This asserts that shape never appears here.
    for (const rel of listFiles("routes")) {
      const src = read(rel);
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (/tier:\s*(req\.body|data)\.tier/.test(line)) {
          // dev-set-tier is allowed, but only because it is double-gated.
          const context = lines.slice(Math.max(0, i - 40), i).join("\n");
          const gated =
            /NODE_ENV !== "production"/.test(context) &&
            /ALLOW_DEV_TIER_OVERRIDE/.test(context);
          expect(gated, `${rel}:${i + 1} writes a client-supplied tier ungated`).toBe(
            true,
          );
        }
      });
    }
  });

  it("the subscriptions router exposes no unexpected mutating route", () => {
    const src = read("routes/subscriptions.ts");
    const posts = [...src.matchAll(/router\.(post|put|patch)\(\s*"([^"]+)"/g)].map(
      (m) => m[2],
    );
    expect(posts.sort()).toEqual(
      [
        "/subscriptions/cancel",
        "/subscriptions/dev-set-tier",
        "/subscriptions/verify-purchase",
      ].sort(),
    );
  });
});

describe("credentials never reach a log or a response", () => {
  it("no source file logs a password, hash, or token value", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          read(rel)
            .split("\n")
            .forEach((line, i) => {
              // A logger call that interpolates a credential-bearing variable.
              if (
                /logger\.(info|warn|error|debug|fatal)/.test(line) &&
                /\b(password|passwordHash|tokenHash|rawToken|secret)\b/.test(line) &&
                !/redact|event:|"password/.test(line)
              ) {
                offenders.push(`${rel}:${i + 1}`);
              }
            });
        }
      }
    };
    walk(".");
    expect(offenders).toEqual([]);
  });

  it("the reset token is stored only as a hash", () => {
    const src = read("routes/auth.ts");
    // The raw token goes in the email; only its SHA-256 is persisted. Storing
    // the raw value would make a database dump a set of working reset links.
    expect(src).toMatch(/tokenHash:\s*hash/);
    expect(src).not.toMatch(/tokenHash:\s*raw\b/);
  });
});

describe("auth responses are uniform", () => {
  it("login has exactly one failure message", () => {
    const src = read("routes/auth.ts");
    const loginSection = src.slice(
      src.indexOf('router.post("/auth/login"'),
      src.indexOf("async function registerFailure"),
    );
    const messages = [...loginSection.matchAll(/res\.status\(4\d\d\)\.json\(\{\s*error:\s*([^,}]+)/g)].map(
      (m) => m[1].trim(),
    );
    // Every 4xx out of the login handler must be the same constant.
    expect(new Set(messages)).toEqual(new Set(["INVALID_CREDENTIALS"]));
  });

  it("uses the exact agreed strings", () => {
    const src = read("routes/auth.ts");
    expect(src).toMatch(/const INVALID_CREDENTIALS = "Incorrect email or password"/);
    expect(src).toMatch(
      /const RESET_REQUESTED =\s*\n?\s*"If that email is registered, you will receive a reset link\."/,
    );
  });

  it("no auth route leaks existence with a banned phrase", () => {
    // Comments are stripped first. The header of routes/auth.ts *describes* the
    // policy using the very phrases it forbids — "the 'no such user' path runs a
    // real bcrypt comparison" — and matching those would fail the test for
    // documenting the rule it enforces.
    const banned =
      /(no such user|wrong password|invalid email|already registered|email (is )?taken|user does not exist)/i;

    const code = stripComments(read("routes/auth.ts"));
    const literals = [...code.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((m) => m[1]);

    const offenders = literals.filter((s) => banned.test(s));
    expect(offenders).toEqual([]);
  });
});
