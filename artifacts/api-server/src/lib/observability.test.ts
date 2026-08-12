/**
 * Error-reporting redaction.
 *
 * Sentry reports leave our infrastructure, so they are held to the same rule as
 * logs: no passwords, no tokens, no email addresses. The risk is not that a
 * call site sends something sensitive deliberately — it is that a future one
 * passes a whole request object and nobody notices.
 */

import { describe, it, expect } from "vitest";
import { __redactForTest as redact, sentryEnabled } from "./observability.js";

describe("redaction", () => {
  it("masks credential-shaped keys at the top level", () => {
    expect(redact({ password: "hunter2", userId: "u1" })).toEqual({
      password: "[redacted]",
      userId: "u1",
    });
  });

  it("masks every credential spelling we use", () => {
    const out = redact({
      password: "a", passwordHash: "b", token: "c", tokenHash: "d",
      secret: "e", authorization: "f", cookie: "g", apiKey: "h",
      api_key: "i", email: "j",
    }) as Record<string, unknown>;
    for (const [k, v] of Object.entries(out)) {
      expect(v, k).toBe("[redacted]");
    }
  });

  it("masks nested credentials", () => {
    expect(redact({ req: { body: { password: "x" } } })).toEqual({
      req: { body: { password: "[redacted]" } },
    });
  });

  it("masks inside arrays", () => {
    expect(redact({ users: [{ email: "a@b.c", id: "1" }] })).toEqual({
      users: [{ email: "[redacted]", id: "1" }],
    });
  });

  it("leaves non-sensitive values intact", () => {
    const input = { path: "/api/analyses", status: 500, count: 3, ok: false };
    expect(redact(input)).toEqual(input);
  });

  it("passes primitives and null through unchanged", () => {
    expect(redact("plain")).toBe("plain");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it("stops at a bounded depth rather than recursing forever", () => {
    // A cyclic or absurdly nested object must not hang the error path — the
    // reporter runs while something has already gone wrong.
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 50; i++) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    expect(() => redact(deep)).not.toThrow();
  });

  it("survives a cyclic object", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(() => redact(cyclic)).not.toThrow();
  });
});

describe("sentryEnabled", () => {
  it("is false without a DSN, so nothing is sent by default", () => {
    // The whole module must be inert until someone configures a project.
    delete process.env.SENTRY_DSN;
    expect(sentryEnabled()).toBe(false);
  });

  it("is true once a DSN is set", () => {
    process.env.SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";
    expect(sentryEnabled()).toBe(true);
    delete process.env.SENTRY_DSN;
  });
});
