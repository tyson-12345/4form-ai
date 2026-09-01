/**
 * Transactional email.
 *
 * The provider is stubbed at `fetch`, so these exercise the real request
 * building, the real error classification, and the real retry loop — the only
 * thing not real is the socket.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const {
  sendEmail,
  deferEmail,
  drainMail,
  activeProvider,
  emailConfigured,
  passwordResetEmail,
  accountLockedEmail,
} = await import("./mailer.js");

const MAIL_ENV = [
  "MAIL_FROM",
  "RESEND_API_KEY",
  "POSTMARK_SERVER_TOKEN",
  "POSTMARK_MESSAGE_STREAM",
  "AWS_SES_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of MAIL_ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MAIL_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
});

function configureResend(): void {
  process.env.MAIL_FROM = "4Form AI <no-reply@mail.example.com>";
  process.env.RESEND_API_KEY = "re_test_key";
}

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Stub fetch with a queue of responses; returns the calls it received. */
function stubFetch(responses: { status: number; body?: unknown }[]): Call[] {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => JSON.stringify(next.body ?? {}),
    } as unknown as Response;
  });
  return calls;
}

const EMAIL = { to: "athlete@example.com", subject: "Test", text: "Body" };

// ─── Provider selection ──────────────────────────────────────────────────────

describe("activeProvider", () => {
  it("is 'none' without MAIL_FROM, even with a key", () => {
    // Half a configuration must not half-work: a key with no sender produces a
    // request the provider rejects, on the password-reset path.
    process.env.RESEND_API_KEY = "re_test_key";
    expect(activeProvider()).toBe("none");
    expect(emailConfigured()).toBe(false);
  });

  it("is 'none' with MAIL_FROM but no credential", () => {
    process.env.MAIL_FROM = "a@b.com";
    expect(activeProvider()).toBe("none");
  });

  it("resolves to resend when configured", () => {
    configureResend();
    expect(activeProvider()).toBe("resend");
    expect(emailConfigured()).toBe(true);
  });

  it("prefers resend over a leftover postmark token", () => {
    // Deterministic precedence, so a key left behind by a migration cannot
    // silently take over the sending path.
    configureResend();
    process.env.POSTMARK_SERVER_TOKEN = "leftover";
    expect(activeProvider()).toBe("resend");
  });
});

// ─── Sending ─────────────────────────────────────────────────────────────────

describe("sendEmail with no provider", () => {
  it("reports undelivered instead of throwing", async () => {
    const outcome = await sendEmail(EMAIL);
    expect(outcome.delivered).toBe(false);
    expect(outcome.provider).toBe("none");
    expect(outcome.attempts).toBe(0);
  });
});

describe("sendEmail via Resend", () => {
  it("posts the message and reports delivery", async () => {
    configureResend();
    const calls = stubFetch([{ status: 200 }]);

    const outcome = await sendEmail({ ...EMAIL, html: "<p>Body</p>" });

    expect(outcome).toMatchObject({ delivered: true, provider: "resend", attempts: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].body).toMatchObject({
      from: "4Form AI <no-reply@mail.example.com>",
      to: "athlete@example.com",
      subject: "Test",
      text: "Body",
      html: "<p>Body</p>",
    });
  });

  it("omits html entirely when there is none", async () => {
    configureResend();
    const calls = stubFetch([{ status: 200 }]);
    await sendEmail(EMAIL);
    expect(calls[0].body).not.toHaveProperty("html");
  });

  it("sends an idempotency key", async () => {
    configureResend();
    const calls = stubFetch([{ status: 200 }]);
    await sendEmail(EMAIL);
    expect(calls[0].headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ─── Retry ───────────────────────────────────────────────────────────────────

describe("retry", () => {
  it("retries a 429 and succeeds", async () => {
    configureResend();
    const calls = stubFetch([{ status: 429 }, { status: 200 }]);

    const outcome = await sendEmail(EMAIL);

    expect(outcome).toMatchObject({ delivered: true, attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it("retries a 502", async () => {
    configureResend();
    stubFetch([{ status: 502 }, { status: 200 }]);
    expect((await sendEmail(EMAIL)).delivered).toBe(true);
  });

  it("reuses the same idempotency key across retries", async () => {
    // The point of the key: a retry after a *lost response* must not send a
    // second copy, which for a password reset would also mint a second token.
    configureResend();
    const calls = stubFetch([{ status: 500 }, { status: 200 }]);
    await sendEmail(EMAIL);
    expect(calls[0].headers["Idempotency-Key"]).toBe(calls[1].headers["Idempotency-Key"]);
  });

  it("gives up after three attempts", async () => {
    configureResend();
    const calls = stubFetch([{ status: 500 }]);

    const outcome = await sendEmail(EMAIL);

    expect(calls).toHaveLength(3);
    expect(outcome).toMatchObject({ delivered: false, attempts: 3, permanent: false });
  });

  it("does not retry a 401", async () => {
    // A bad key fails identically forever. Retrying only delays the alert.
    configureResend();
    const calls = stubFetch([{ status: 401, body: { message: "API key is invalid" } }]);

    const outcome = await sendEmail(EMAIL);

    expect(calls).toHaveLength(1);
    expect(outcome).toMatchObject({ delivered: false, permanent: true });
    expect(outcome.error).toContain("401");
  });

  it("does not retry a 422", async () => {
    configureResend();
    const calls = stubFetch([{ status: 422, body: { message: "Invalid from address" } }]);
    await sendEmail(EMAIL);
    expect(calls).toHaveLength(1);
  });

  it("retries a dropped connection", async () => {
    // Network failures never reach the status check, so they arrive as plain
    // Errors — classing those as permanent would be exactly backwards.
    configureResend();
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts++;
      if (attempts < 3) throw new TypeError("fetch failed");
      return { ok: true, status: 200, text: async () => "{}" } as unknown as Response;
    });

    const outcome = await sendEmail(EMAIL);

    expect(attempts).toBe(3);
    expect(outcome.delivered).toBe(true);
  });

  it("never throws, whatever the provider does", async () => {
    configureResend();
    vi.stubGlobal("fetch", async () => {
      throw new Error("something entirely unexpected");
    });
    // An auth route must not 500 because mail is down, and must not vary its
    // response with mail outcome.
    await expect(sendEmail(EMAIL)).resolves.toMatchObject({ delivered: false });
  });
});

// ─── Error reporting ─────────────────────────────────────────────────────────

describe("provider errors", () => {
  it("extracts a nested reason", async () => {
    // Resend has used both `{ message }` and `{ error: { message } }`; the
    // nested shape used to stringify to "[object Object]".
    configureResend();
    stubFetch([{ status: 403, body: { error: { message: "Domain is not verified" } } }]);
    expect((await sendEmail(EMAIL)).error).toContain("Domain is not verified");
  });

  it("redacts an address out of the reason", async () => {
    configureResend();
    stubFetch([{ status: 422, body: { message: "recipient athlete@example.com is invalid" } }]);
    const { error } = await sendEmail(EMAIL);
    expect(error).toContain("<address>");
    expect(error).not.toContain("athlete@example.com");
  });

  it("redacts a key out of the reason", async () => {
    configureResend();
    stubFetch([{ status: 401, body: { message: "key re_abcdef123456 is invalid" } }]);
    const { error } = await sendEmail(EMAIL);
    expect(error).toContain("<key>");
    expect(error).not.toContain("re_abcdef123456");
  });

  it("still reports the status when the body is not JSON", async () => {
    configureResend();
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 503,
      text: async () => "<html>Bad Gateway</html>",
    }) as unknown as Response);
    expect((await sendEmail(EMAIL)).error).toContain("503");
  });
});

// ─── Deferred delivery ───────────────────────────────────────────────────────

describe("deferEmail", () => {
  it("returns before the work runs", async () => {
    // This is what keeps /auth/forgot-password from taking longer for a
    // registered address than an unregistered one.
    let ran = false;
    deferEmail("test", async () => {
      await Promise.resolve();
      ran = true;
    });
    expect(ran).toBe(false);
    await drainMail();
    expect(ran).toBe(true);
  });

  it("swallows a throwing task", async () => {
    deferEmail("test", async () => {
      throw new Error("boom");
    });
    await expect(drainMail()).resolves.toBe(0);
  });

  it("drains several tasks", async () => {
    let done = 0;
    for (let i = 0; i < 3; i++) {
      deferEmail("test", async () => {
        await new Promise((r) => setTimeout(r, 5));
        done++;
      });
    }
    expect(await drainMail()).toBe(0);
    expect(done).toBe(3);
  });

  it("reports what is still outstanding when it times out", async () => {
    // Shutdown needs to know it dropped something, rather than exiting quietly.
    deferEmail("slow", async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(await drainMail(20)).toBe(1);
    await drainMail();
  });

  it("is a no-op with nothing pending", async () => {
    expect(await drainMail()).toBe(0);
  });
});

// ─── Templates ───────────────────────────────────────────────────────────────

describe("templates", () => {
  const URL_ = "https://4formai.com/reset-password?token=abc123";

  it("puts the link in both the text and html parts", () => {
    const email = passwordResetEmail("a@b.com", URL_, 30);
    expect(email.text).toContain(URL_);
    expect(email.html).toContain(URL_);
    expect(email.text).toContain("30 minutes");
  });

  it("ships a plain-text alternative for both templates", () => {
    // A client that will not render HTML must still be able to reset.
    expect(passwordResetEmail("a@b.com", URL_, 30).text.length).toBeGreaterThan(50);
    expect(accountLockedEmail("a@b.com", URL_, 15).text.length).toBeGreaterThan(50);
  });

  it("embeds no remote images or tracking pixels", () => {
    // Nothing to be blocked by an image-blocking client, and nothing extra to
    // disclose in the privacy policy.
    const html = passwordResetEmail("a@b.com", URL_, 30).html;
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/src=["']https?:/i);
  });

  it("escapes a url that contains markup", () => {
    const html = passwordResetEmail("a@b.com", 'https://x.test/?t="><script>', 30).html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("says the lockout is temporary and how to lift it", () => {
    const email = accountLockedEmail("a@b.com", URL_, 15);
    expect(email.text).toContain("15 minutes");
    expect(email.text).toContain(URL_);
  });
});
