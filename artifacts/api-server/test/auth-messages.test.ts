/**
 * Static audit of user-facing auth strings.
 *
 * Every authentication failure must be indistinguishable from every other one.
 * A message that says "no account with that email" (or "wrong password", or
 * "this account is locked") tells an attacker whether an address is registered
 * and how far they got — which is exactly what the rate limiting and lockout
 * are there to prevent them learning.
 *
 * This scans the source rather than exercising routes, so it catches a leaky
 * string the moment it is written, including on paths no integration test
 * happens to hit.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL("../src", import.meta.url)));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

/** String literals that appear in a `res.json({ error: ... })`-style position. */
function userFacingStrings(source: string): string[] {
  const stripped = source
    // Drop block and line comments — this file's own explanatory prose
    // legitimately contains the phrases we're banning.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const matches = stripped.matchAll(
    /(?:error|message)\s*:\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g,
  );
  return [...matches].map((m) => m[2]!);
}

const FILES = sourceFiles(SRC);

/** Phrases that disclose account state or which credential was wrong. */
const LEAKY_PATTERNS: [RegExp, string][] = [
  [/\bnot found\b/i, "reveals whether a record exists"],
  [/\bdoes\s*n[o']?t exist\b/i, "reveals whether a record exists"],
  [/\bno such\b/i, "reveals whether a record exists"],
  [/\bwrong password\b/i, "reveals which credential was wrong"],
  [/\bincorrect password\b/i, "reveals which credential was wrong"],
  [/\binvalid email\b/i, "reveals which credential was wrong"],
  [/\bemail not registered\b/i, "confirms registration state"],
  [/\balready registered\b/i, "confirms registration state"],
  [/\balready exists\b/i, "confirms registration state"],
  [/\baccount (is )?locked\b/i, "confirms a lockout was triggered"],
  [/\btoo many (failed )?(login )?attempts\b/i, "confirms a lockout was triggered"],
  [/\bexpired token\b/i, "distinguishes expiry from forgery"],
];

describe("auth routes never leak account state", () => {
  const authSource = readFileSync(join(SRC, "routes", "auth.ts"), "utf8");
  const strings = userFacingStrings(authSource);

  it("the extractor actually finds leaky strings (scanner sanity check)", () => {
    // Without this, a broken extractor would return [] for every file and the
    // whole suite would pass vacuously.
    const fixture = `
      res.status(404).json({ error: "No such user" });
      res.status(401).json({ message: 'Wrong password' });
      logger.info({ event: "ok" }, "not a user-facing string");
    `;
    const found = userFacingStrings(fixture);
    expect(found).toContain("No such user");
    expect(found).toContain("Wrong password");
    expect(found.some((s) => LEAKY_PATTERNS.some(([p]) => p.test(s)))).toBe(true);
  });

  it("finds the inline user-facing strings in auth.ts", () => {
    expect(strings.length).toBeGreaterThanOrEqual(3);
  });

  it.each(LEAKY_PATTERNS)("contains no message matching %s (%s)", (pattern, reason) => {
    const offenders = strings.filter((s) => pattern.test(s));
    expect(offenders, `${reason}: ${offenders.join(" | ")}`).toEqual([]);
  });

  it("uses exactly the agreed credential-failure wording", () => {
    expect(authSource).toContain('const INVALID_CREDENTIALS = "Incorrect email or password"');
  });

  it("uses exactly the agreed password-reset wording", () => {
    expect(authSource).toMatch(
      /RESET_REQUESTED\s*=\s*[\s\S]{0,40}"If that email is registered, you will receive a reset link\."/,
    );
  });

  it("returns the same credential message for every login failure branch", () => {
    // Unknown email, wrong password, and locked account must all land here.
    const loginSection = authSource.slice(
      authSource.indexOf('router.post("/auth/login"'),
      authSource.indexOf('router.post("/auth/forgot-password"'),
    );
    const errorResponses = [...loginSection.matchAll(/res\s*\.\s*status\(\d+\)\s*\.json\(\{\s*error:\s*([A-Za-z_]+|"[^"]*")/g)]
      .map((m) => m[1]);

    expect(errorResponses.length).toBeGreaterThan(0);
    for (const response of errorResponses) {
      expect(response).toBe("INVALID_CREDENTIALS");
    }
  });
});

describe("no user-facing string leaks account state anywhere", () => {
  it.each(FILES.map((f) => [relative(SRC, f), f] as const))(
    "%s",
    (_label, file) => {
      const strings = userFacingStrings(readFileSync(file, "utf8"));
      const offenders: string[] = [];

      for (const value of strings) {
        for (const [pattern] of LEAKY_PATTERNS) {
          // "Analysis not found" / "Not found" on resource routes is fine —
          // those are the caller's own records, and a 404 there discloses
          // nothing about anyone else. Only auth-adjacent nouns are banned.
          if (pattern.test(value) && /account|email|user|password|login|token/i.test(value)) {
            offenders.push(value);
          }
        }
      }

      expect(offenders).toEqual([]);
    },
  );
});

describe("passwords are never logged", () => {
  it.each(FILES.map((f) => [relative(SRC, f), f] as const))(
    "%s contains no logger call naming a password field",
    (_label, file) => {
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      // Matches logger.x({ ...password... }) and console.x(...password...)
      const calls = [
        ...source.matchAll(/(?:logger|console)\.\w+\(([\s\S]{0,300}?)\)\s*[;,]/g),
      ].map((m) => m[1]!);

      const offenders = calls.filter((args) => {
        // Strip quoted strings first. A human-readable message like
        // "Password reset completed" describes the operation and leaks
        // nothing; what matters is whether a password-bearing *identifier* is
        // handed to the logger as a value.
        const withoutStrings = args.replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, '""');
        return /\b(?:password|passwordHash|plaintextPassword|rawPassword|pwd)\b/i.test(
          withoutStrings,
        );
      });

      expect(offenders, offenders.join(" | ")).toEqual([]);
    },
  );

  it("has no console.log statements left in the server source", () => {
    // console.log bypasses the logger's redaction entirely.
    //
    // `src/scripts/` is excluded: those are operator CLIs run from a terminal,
    // never in a request, and printing to stdout is the entire point of one —
    // `pnpm mail:verify` exists to put a diagnosis in front of a person. The
    // property this rule protects for them is asserted separately below, since
    // the exclusion must not become a place credentials can be printed.
    const offenders = FILES.filter((file) => {
      if (relative(SRC, file).startsWith("scripts/")) return false;
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      return /\bconsole\.log\s*\(/.test(source);
    }).map((f) => relative(SRC, f));

    expect(offenders).toEqual([]);
  });

  it("operator scripts never print a credential", () => {
    // The reason the rule above exists, applied to the files it exempts. A
    // setup script is exactly where someone would reach for "just log the key
    // so I can see what it's sending" — and its output is pasted into issues.
    const scripts = FILES.filter((f) => relative(SRC, f).startsWith("scripts/"));
    expect(scripts.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of scripts) {
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      for (const call of source.matchAll(/console\.\w+\s*\(([\s\S]*?)\)\s*;/g)) {
        const raw = call[1];
        // Keep template interpolations, drop the literal text around them.
        // Stripping whole quoted strings is right for prose — `hint("RESEND_API_KEY
        // is not set")` names the variable without printing it — but a blanket
        // strip would also swallow `${RESEND_API_KEY}`, which is the exact thing
        // being looked for.
        const interpolations = [...raw.matchAll(/\$\{([\s\S]*?)\}/g)].map((m) => m[1]).join(" ");
        const args =
          raw.replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, '""') + " " + interpolations;
        if (
          /\b(?:RESEND_API_KEY|POSTMARK_SERVER_TOKEN|AWS_SECRET_ACCESS_KEY|JWT_SECRET|ANTHROPIC_API_KEY|password|apiKey|secret|token)\b/i.test(
            args,
          )
        ) {
          offenders.push(`${relative(SRC, file)}: ${call[1].trim().slice(0, 80)}`);
        }
      }
    }

    expect(offenders, offenders.join(" | ")).toEqual([]);
  });
});
