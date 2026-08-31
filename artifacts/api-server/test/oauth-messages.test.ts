/**
 * Response-uniformity audit for the federated sign-in routes.
 *
 * Static, like test/auth-messages.test.ts, and for the same reason: it catches a
 * leaky string the moment it is written rather than only on the paths an
 * integration test happens to walk.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const oauthSrc = readFileSync(join(SRC, "routes", "oauth.ts"), "utf8");
const authSrc = readFileSync(join(SRC, "routes", "auth.ts"), "utf8");

function credentialConstant(source: string): string | undefined {
  return /const INVALID_CREDENTIALS =\s*"([^"]+)"/.exec(source)?.[1];
}

describe("the link challenge fails exactly like a login", () => {
  it("uses the byte-identical credential message", () => {
    // The link endpoint checks a password. If its failure text differed from
    // the login endpoint's by so much as a full stop, a caller could tell the
    // two apart — and the point of sharing lib/passwordAuth.ts between them is
    // that they are indistinguishable.
    const fromAuth = credentialConstant(authSrc);
    const fromOauth = credentialConstant(oauthSrc);
    expect(fromAuth).toBe("Incorrect email or password");
    expect(fromOauth).toBe(fromAuth);
  });

  it("returns that message for every credential failure in the link handler", () => {
    const section = oauthSrc.slice(
      oauthSrc.indexOf('router.post("/auth/oauth/link"'),
      oauthSrc.indexOf("// ─── Shared success path"),
    );
    expect(section.length).toBeGreaterThan(0);

    const responses = [
      ...section.matchAll(/res\s*\.\s*status\((\d{3})\)\s*\.json\(\{\s*error:\s*([A-Za-z_]+|"[^"]*")/g),
    ].map((m) => ({ status: m[1], body: m[2] }));

    expect(responses.length).toBeGreaterThan(0);
    for (const r of responses) {
      // 400 is the expired/tampered challenge, which is not a credential
      // outcome and reveals nothing about the account. Everything else must be
      // the shared constant.
      expect(r.status === "400" ? "FLOW_EXPIRED" : r.body).toBe(
        r.status === "400" ? "FLOW_EXPIRED" : "INVALID_CREDENTIALS",
      );
    }
  });

  it("does not branch its response on whether the account still exists", () => {
    const section = oauthSrc.slice(
      oauthSrc.indexOf('router.post("/auth/oauth/link"'),
      oauthSrc.indexOf("// ─── Shared success path"),
    );
    // A `if (!user)` early return here would answer "is this account real?"
    // faster and differently than a wrong password does. The undefined user is
    // handed to attemptPasswordAuth instead, which burns the same bcrypt time.
    expect(section).not.toMatch(/if\s*\(\s*!user\s*\)/);
    expect(section).toMatch(/attemptPasswordAuth\(user,/);
  });
});

describe("provider failures do not describe themselves", () => {
  it("never returns the verification reason to the caller", () => {
    // "invalid audience" vs "jwt expired" vs "invalid signature" tells someone
    // probing us precisely which knob to turn next. It belongs in the log.
    const responses = [...oauthSrc.matchAll(/res[\s\S]{0,80}?\.json\(\{\s*error:\s*([^,}\n]+)/g)].map(
      (m) => m[1].trim(),
    );
    for (const body of responses) {
      expect(body).not.toMatch(/err|message|reason|code\b/i);
    }
  });

  it("logs the reason instead", () => {
    expect(oauthSrc).toMatch(/event: "oauth_token_rejected"/);
    expect(oauthSrc).toMatch(/reason: err instanceof Error \? err\.message/);
  });
});

describe("the age gate is not skippable through the federated path", () => {
  it("the completion route validates a birth date", () => {
    // A federated signup that did not ask for a birth date would be the easiest
    // signup path in the app, so it would become the one under-13s use.
    expect(oauthSrc).toMatch(/dateOfBirth:\s*safeBirthDate/);
  });

  it("only the completion route creates users, and it stores the birth date", () => {
    const inserts = [...oauthSrc.matchAll(/\.insert\(usersTable\)/g)];
    expect(inserts).toHaveLength(1);
    expect(oauthSrc).toMatch(/birthDate:\s*data\.dateOfBirth/);
  });

  it("never writes a password hash for a federated account", () => {
    // A random unguessable hash would make the row lie about how the account is
    // reachable; see the users.password_hash column comment.
    expect(oauthSrc).toMatch(/passwordHash:\s*null/);
    expect(oauthSrc).not.toMatch(/passwordHash:\s*await\s+hashPassword/);
  });
});
