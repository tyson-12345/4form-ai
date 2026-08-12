import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import type { Response } from "express";
import {
  parseOrReject,
  safeText,
  safeMultiline,
  safeEmail,
  safePassword,
  safeUuid,
  safeBirthDate,
  safeOpaqueToken,
  safeMediaUrl,
  ageInYears,
  MINIMUM_AGE_YEARS,
  GENERIC_VALIDATION_ERROR,
} from "./validate.js";

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const ctx = { route: "test", ip: "1.2.3.4" };

describe("safeText", () => {
  const schema = safeText(1, 20);

  it("sanitizes before enforcing length", () => {
    // The markup must not count toward the limit, or a value that is fine once
    // stripped would be rejected for being too long.
    const result = schema.safeParse("<b>Deadlift</b>");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("Deadlift");
  });

  it("rejects a value that is empty after sanitization", () => {
    // "<script>x</script>" carries no real content once stripped.
    expect(schema.safeParse("<script>x</script>").success).toBe(false);
  });

  it("rejects text over the limit", () => {
    expect(schema.safeParse("a".repeat(21)).success).toBe(false);
  });

  it("rejects absurdly long input before sanitizing it", () => {
    // Guards against spending CPU on a multi-megabyte regex pass.
    expect(schema.safeParse("a".repeat(10_000)).success).toBe(false);
  });

  it("accepts ordinary text unchanged", () => {
    const result = schema.safeParse("Back squat 3x5");
    expect(result.success && result.data).toBe("Back squat 3x5");
  });
});

describe("safeMultiline", () => {
  it("keeps line breaks", () => {
    const result = safeMultiline(1, 100).safeParse("line one\nline two");
    expect(result.success && result.data).toBe("line one\nline two");
  });

  it("strips scripts", () => {
    const result = safeMultiline(1, 100).safeParse("hi <script>x()</script> there");
    expect(result.success && result.data).toBe("hi there");
  });
});

describe("safeEmail", () => {
  it("normalizes case and whitespace", () => {
    const result = safeEmail.safeParse("  Foo@Example.COM ");
    expect(result.success && result.data).toBe("foo@example.com");
  });

  it("rejects a malformed address", () => {
    expect(safeEmail.safeParse("not-an-email").success).toBe(false);
    expect(safeEmail.safeParse("@example.com").success).toBe(false);
  });

  it("rejects an over-long address", () => {
    expect(safeEmail.safeParse(`${"a".repeat(400)}@example.com`).success).toBe(false);
  });
});

describe("safePassword", () => {
  it("requires at least 12 characters", () => {
    expect(safePassword.safeParse("short").success).toBe(false);
    expect(safePassword.safeParse("a".repeat(12)).success).toBe(true);
  });

  it("caps length to bound bcrypt cost", () => {
    expect(safePassword.safeParse("a".repeat(201)).success).toBe(false);
  });

  it("does not alter the password", () => {
    // Sanitizing a password would silently change it and break login for
    // anyone using markup characters in a strong passphrase.
    const password = "<script>&my p@ss</script>!";
    const result = safePassword.safeParse(password);
    expect(result.success && result.data).toBe(password);
  });
});

describe("safeUuid", () => {
  it("accepts a valid uuid", () => {
    expect(safeUuid.safeParse("3f2504e0-4f89-11d3-9a0c-0305e82c3301").success).toBe(true);
  });

  it("rejects an id-shaped string that is not a uuid", () => {
    expect(safeUuid.safeParse("../../etc/passwd").success).toBe(false);
    expect(safeUuid.safeParse("1 OR 1=1").success).toBe(false);
  });
});

describe("parseOrReject", () => {
  const schema = z.object({ name: safeText(1, 10), age: z.number().int().min(0) });

  it("returns parsed data on success", () => {
    const res = mockRes();
    const data = parseOrReject(schema, { name: "Alex", age: 20 }, res, ctx);
    expect(data).toEqual({ name: "Alex", age: 20 });
    expect(res.statusCode).toBe(0);
  });

  it("responds 400 with the generic message on failure", () => {
    const res = mockRes();
    const data = parseOrReject(schema, { name: "", age: -1 }, res, ctx);
    expect(data).toBeUndefined();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: GENERIC_VALIDATION_ERROR });
  });

  it("never reveals which field failed", () => {
    // Naming the field hands an attacker a free map of the schema, and on auth
    // routes distinguishes "no such user" from "wrong password".
    const res = mockRes();
    parseOrReject(schema, { name: "", age: 5 }, res, ctx);
    const message = (res.body as { error: string }).error;
    expect(message).not.toMatch(/name|age|field/i);
  });

  it("returns the same message regardless of which field failed", () => {
    const a = mockRes();
    const b = mockRes();
    parseOrReject(schema, { name: "", age: 5 }, a, ctx);
    parseOrReject(schema, { name: "ok", age: -5 }, b, ctx);
    expect(a.body).toEqual(b.body);
  });

  it("rejects a non-object body", () => {
    const res = mockRes();
    expect(parseOrReject(schema, "a string", res, ctx)).toBeUndefined();
    expect(res.statusCode).toBe(400);
  });

  it("ignores unknown extra properties rather than trusting them", () => {
    const res = mockRes();
    const data = parseOrReject(schema, { name: "Alex", age: 20, isAdmin: true }, res, ctx);
    expect(data).not.toHaveProperty("isAdmin");
  });
});

// ─── Age gate ────────────────────────────────────────────────────────────────

describe("ageInYears", () => {
  it("counts whole years", () => {
    expect(ageInYears(new Date("2000-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"))).toBe(20);
  });

  it("does not credit a birthday that has not happened yet this year", () => {
    // The off-by-one that matters: on 31 Dec, someone born 1 Jan is still 19.
    expect(ageInYears(new Date("2000-01-01T00:00:00Z"), new Date("2019-12-31T00:00:00Z"))).toBe(19);
  });

  it("counts the birthday itself", () => {
    expect(ageInYears(new Date("2010-06-15T00:00:00Z"), new Date("2023-06-15T00:00:00Z"))).toBe(13);
  });

  it("does not count the day before the birthday", () => {
    expect(ageInYears(new Date("2010-06-15T00:00:00Z"), new Date("2023-06-14T00:00:00Z"))).toBe(12);
  });
});

describe("safeBirthDate", () => {
  /** A `YYYY-MM-DD` string for someone exactly `years` old today. */
  function dobForAge(years: number): string {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
    return d.toISOString().slice(0, 10);
  }

  it("accepts someone comfortably over the minimum age", () => {
    expect(safeBirthDate.safeParse(dobForAge(25)).success).toBe(true);
  });

  it("accepts someone exactly at the minimum age", () => {
    expect(safeBirthDate.safeParse(dobForAge(MINIMUM_AGE_YEARS)).success).toBe(true);
  });

  it("rejects someone one year under the minimum", () => {
    expect(safeBirthDate.safeParse(dobForAge(MINIMUM_AGE_YEARS - 1)).success).toBe(false);
  });

  it("rejects a young child", () => {
    expect(safeBirthDate.safeParse(dobForAge(6)).success).toBe(false);
  });

  it("rejects a future date", () => {
    // Otherwise a date far enough in the future wraps to a negative age, which
    // is not >= 13 — but relying on that is accidental, so it is checked.
    expect(safeBirthDate.safeParse("2099-01-01").success).toBe(false);
  });

  it("rejects an implausibly old date", () => {
    expect(safeBirthDate.safeParse("1850-01-01").success).toBe(false);
  });

  it("rejects malformed input rather than coercing it", () => {
    for (const bad of ["", "not-a-date", "2010", "2010-13-01", "01/01/2010", "2010-1-1"]) {
      expect(safeBirthDate.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("cannot be bypassed by sending a non-string", () => {
    // The client is not the control; a caller that skips the app entirely must
    // still be refused.
    for (const bad of [null, undefined, 0, {}, [], true]) {
      expect(safeBirthDate.safeParse(bad).success).toBe(false);
    }
  });
});

// ─── Reset-link base URL ─────────────────────────────────────────────────────
//
// Lives here rather than in a route test because it needs no database. The
// regression it guards against: `createResetUrl` used to fall back to a
// hard-coded domain that turned out to belong to someone else, which would have
// mailed working single-use account-recovery tokens to a third party.

describe("reset link base URL", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env.NODE_ENV = original.NODE_ENV;
    process.env.APP_PUBLIC_URL = original.APP_PUBLIC_URL;
  });

  /** Mirrors resetLinkBase() in routes/auth.ts. */
  function resetLinkBase(): string {
    const configured = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, "");
    if (configured) return configured;
    if (process.env.NODE_ENV === "production") {
      throw new Error("APP_PUBLIC_URL is not set.");
    }
    return `http://localhost:${process.env.PORT ?? 3000}`;
  }

  it("uses the configured origin", () => {
    process.env.APP_PUBLIC_URL = "https://app.example.com";
    expect(resetLinkBase()).toBe("https://app.example.com");
  });

  it("strips a trailing slash so links do not get a double slash", () => {
    process.env.APP_PUBLIC_URL = "https://app.example.com/";
    expect(resetLinkBase()).toBe("https://app.example.com");
  });

  it("throws in production rather than inventing a domain", () => {
    // The whole point: no default is safe. A reset link is a credential, and
    // one pointing at a domain we do not control is worse than no link at all.
    process.env.NODE_ENV = "production";
    delete process.env.APP_PUBLIC_URL;
    expect(() => resetLinkBase()).toThrow(/APP_PUBLIC_URL/);
  });

  it("treats a whitespace-only value as unset", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_PUBLIC_URL = "   ";
    expect(() => resetLinkBase()).toThrow();
  });

  it("falls back to localhost outside production so the flow is testable", () => {
    process.env.NODE_ENV = "development";
    delete process.env.APP_PUBLIC_URL;
    expect(resetLinkBase()).toMatch(/^http:\/\/localhost:/);
  });
});

// ─── Opaque tokens and media URLs ────────────────────────────────────────────

describe("safeOpaqueToken", () => {
  it("accepts a token of the shape we mint", () => {
    // crypto.randomBytes(32).toString("base64url")
    expect(safeOpaqueToken.safeParse("a".repeat(43)).success).toBe(true);
    expect(safeOpaqueToken.safeParse("Ab-_09".repeat(8)).success).toBe(true);
  });

  it("rejects characters we never mint", () => {
    for (const bad of [
      "<script>alert(1)</script>aaaaaaaaaaaaaaaaaaaa",
      "'; drop table users; --aaaaaaaaaaaaaaaaaaaaa",
      "../../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaaa",
      `${"a".repeat(30)} ${"b".repeat(30)}`,
      `${"a".repeat(30)}%00`,
    ]) {
      expect(safeOpaqueToken.safeParse(bad).success, bad.slice(0, 24)).toBe(false);
    }
  });

  it("rejects lengths outside what we mint", () => {
    expect(safeOpaqueToken.safeParse("short").success).toBe(false);
    expect(safeOpaqueToken.safeParse("a".repeat(201)).success).toBe(false);
  });
});

describe("safeMediaUrl", () => {
  it("accepts http and https", () => {
    expect(safeMediaUrl.safeParse("https://cdn.example.com/clip.mp4").success).toBe(true);
    expect(safeMediaUrl.safeParse("http://localhost:3000/clip.mp4").success).toBe(true);
  });

  it("rejects the schemes that turn a stored string into code or file access", () => {
    // z.string().url() accepts every one of these. That is the whole reason
    // this is a scheme allowlist and not a format check.
    for (const bad of [
      "javascript:alert(document.cookie)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
    ]) {
      expect(safeMediaUrl.safeParse(bad).success, bad.slice(0, 28)).toBe(false);
    }
  });

  it("rejects a non-URL and an over-long value", () => {
    expect(safeMediaUrl.safeParse("not a url").success).toBe(false);
    expect(safeMediaUrl.safeParse(`https://e.com/${"a".repeat(2100)}`).success).toBe(false);
  });
});
