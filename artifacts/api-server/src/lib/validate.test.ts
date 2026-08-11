import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { Response } from "express";
import {
  parseOrReject,
  safeText,
  safeMultiline,
  safeEmail,
  safePassword,
  safeUuid,
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
