import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  rateLimit,
  progressiveDelayMs,
  clientIp,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MS,
  __resetRateLimitState,
} from "./rateLimit.js";

function mockReq(ip = "1.2.3.4", path = "/api/test"): Request {
  return { ip, path, socket: { remoteAddress: ip }, headers: {} } as unknown as Request;
}

function mockRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {
    headers: {} as Record<string, unknown>,
    setHeader(k: string, v: unknown) {
      this.headers[k] = v;
    },
    status(code: number) {
      (this as { statusCode?: number }).statusCode = code;
      return this;
    },
    json(payload: unknown) {
      (this as { body?: unknown }).body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode?: number; body?: unknown };
}

beforeEach(() => {
  __resetRateLimitState();
});

describe("rateLimit", () => {
  it("allows requests up to the limit", () => {
    const limiter = rateLimit({ name: "t", max: 3 });
    const next = vi.fn();

    for (let i = 0; i < 3; i++) limiter(mockReq(), mockRes(), next as NextFunction);

    expect(next).toHaveBeenCalledTimes(3);
  });

  it("blocks the request that exceeds the limit", () => {
    const limiter = rateLimit({ name: "t", max: 3 });
    const next = vi.fn();

    for (let i = 0; i < 3; i++) limiter(mockReq(), mockRes(), next as NextFunction);

    const res = mockRes();
    limiter(mockReq(), res, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(3); // not called a 4th time
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "Too many requests. Please slow down." });
  });

  it("tracks each IP independently", () => {
    const limiter = rateLimit({ name: "t", max: 2 });
    const next = vi.fn();

    limiter(mockReq("1.1.1.1"), mockRes(), next as NextFunction);
    limiter(mockReq("1.1.1.1"), mockRes(), next as NextFunction);
    limiter(mockReq("2.2.2.2"), mockRes(), next as NextFunction);

    expect(next).toHaveBeenCalledTimes(3);
  });

  it("keeps separate counters per limiter name", () => {
    // Otherwise the login limit and the global limit would share a budget.
    const login = rateLimit({ name: "login", max: 1 });
    const global = rateLimit({ name: "global", max: 1 });
    const next = vi.fn();

    login(mockReq(), mockRes(), next as NextFunction);
    global(mockReq(), mockRes(), next as NextFunction);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it("sets Retry-After when blocking", () => {
    const limiter = rateLimit({ name: "t", max: 1 });
    limiter(mockReq(), mockRes(), vi.fn() as NextFunction);

    const res = mockRes();
    limiter(mockReq(), res, vi.fn() as NextFunction);

    const headers = (res as unknown as { headers: Record<string, unknown> }).headers;
    expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
    expect(headers["RateLimit-Remaining"]).toBe(0);
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    try {
      const limiter = rateLimit({ name: "t", max: 1, windowMs: 1000 });
      const next = vi.fn();

      limiter(mockReq(), mockRes(), next as NextFunction);
      limiter(mockReq(), mockRes(), next as NextFunction); // blocked
      expect(next).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1001);
      limiter(mockReq(), mockRes(), next as NextFunction);
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("clientIp", () => {
  it("uses req.ip, which reflects the app's trust-proxy policy", () => {
    // Reading X-Forwarded-For directly (the old behaviour) let any caller
    // bypass every limit by rotating that header.
    expect(clientIp(mockReq("9.9.9.9"))).toBe("9.9.9.9");
  });

  it("ignores a spoofed X-Forwarded-For header", () => {
    const req = {
      ip: "9.9.9.9",
      path: "/",
      socket: { remoteAddress: "9.9.9.9" },
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
    } as unknown as Request;
    expect(clientIp(req)).toBe("9.9.9.9");
  });

  it("falls back to the socket address", () => {
    const req = { path: "/", socket: { remoteAddress: "5.5.5.5" }, headers: {} } as unknown as Request;
    expect(clientIp(req)).toBe("5.5.5.5");
  });
});

describe("lockout policy", () => {
  it("locks after 5 consecutive failures", () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
  });

  it("locks for 15 minutes", () => {
    expect(LOCKOUT_MS).toBe(15 * 60 * 1000);
  });
});

describe("progressiveDelayMs", () => {
  it("does not delay before any failure", () => {
    expect(progressiveDelayMs(0)).toBe(0);
    expect(progressiveDelayMs(-1)).toBe(0);
  });

  it("increases with each successive failure", () => {
    const delays = [1, 2, 3, 4, 5].map(progressiveDelayMs);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });

  it("doubles per attempt", () => {
    expect(progressiveDelayMs(1)).toBe(250);
    expect(progressiveDelayMs(2)).toBe(500);
    expect(progressiveDelayMs(3)).toBe(1000);
  });

  it("caps so a legitimate user is never locked out of the UI by latency", () => {
    expect(progressiveDelayMs(50)).toBe(4000);
  });
});
