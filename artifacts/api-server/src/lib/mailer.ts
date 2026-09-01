/**
 * Transactional email.
 *
 * ── Provider selection ──────────────────────────────────────────────────────
 * Three providers are supported and chosen by which credentials are present, so
 * switching provider is a config change and never a code change:
 *
 *   RESEND_API_KEY                          → Resend
 *   POSTMARK_SERVER_TOKEN                   → Postmark
 *   AWS_SES_REGION + AWS credentials        → Amazon SES
 *
 * `MAIL_FROM` is required by all three. If more than one is set, the order
 * above wins — deterministic rather than "whichever the code happens to check
 * first", so a leftover key from a migration cannot silently take over.
 *
 * ── Delivery is best-effort, by design ──────────────────────────────────────
 * `sendEmail` never throws. A mail outage must not turn a password-reset request
 * into a 500, and must not change the response the caller sees — the response is
 * identical whether or not the address exists, and a provider error that leaked
 * through would undo that. Failures are logged and counted for alerting.
 *
 * ── Nothing is delivered inside a request ───────────────────────────────────
 * Callers use `deferEmail`, which schedules the work and returns immediately.
 * Two reasons, and the first is a security property rather than a performance
 * one:
 *
 *  1. **Timing.** `POST /auth/forgot-password` returns the same body whether or
 *     not the address is registered — that is the whole point of its wording.
 *     But it only *sends* when the account exists, so awaiting delivery makes
 *     the registered case take a provider round-trip (a few hundred ms) and the
 *     unregistered case take none. That difference is trivially measurable, and
 *     it would hand back exactly the fact the response text refuses to state.
 *     The endpoint was not enumerable before only because mail was unconfigured
 *     and `sendEmail` returned instantly; turning delivery on is what creates
 *     the oracle, so the fix ships with it.
 *  2. **Retries.** Transient failures are retried with backoff (below). Doing
 *     that inside the request would hold it open for tens of seconds.
 *
 * The cost is that a send in flight when the process dies is lost. `drainMail`
 * is awaited on SIGTERM so an ordinary deploy does not drop one; a hard kill
 * still can, which is the accepted trade for not having a durable queue.
 *
 * ── Deliverability ──────────────────────────────────────────────────────────
 * Reset mail that lands in spam is the same as no reset mail. SPF, DKIM, and
 * DMARC must be configured on the sending domain before launch — see
 * docs/EMAIL-SETUP.md for the exact records and a verification procedure.
 */

import { randomUUID } from "node:crypto";

import { logger } from "./logger.js";
import { recordAlert } from "./alerting.js";

export interface Email {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML alternative. Clients that support it render this instead. */
  html?: string;
}

export type MailProvider = "resend" | "postmark" | "ses" | "none";

/**
 * What happened to one message.
 *
 * Returned rather than thrown, because `sendEmail`'s contract is that it never
 * throws (see the module header) — but "never throws" must not mean "gives the
 * caller nothing to work with". Every caller in the request path ignores this;
 * `scripts/verifyEmail.ts` is the one that reads it, and it exists so setup
 * failures can be diagnosed from a return value instead of by scraping the log
 * stream, which is written on pino's transport thread and is not reliably
 * interceptable.
 *
 * `error` is already redacted by `assertOk` — no address, no key — so it is
 * safe to print.
 */
export interface SendOutcome {
  delivered: boolean;
  provider: MailProvider;
  /** How many attempts were made. 0 when no provider is configured. */
  attempts: number;
  error?: string;
  /** True when the failure will recur identically and was not retried. */
  permanent?: boolean;
}

/**
 * Which provider the current environment resolves to.
 *
 * Exported so the health endpoint can report it and startup can warn about a
 * half-configured setup (a key present but MAIL_FROM missing, say).
 */
export function activeProvider(): MailProvider {
  if (!process.env.MAIL_FROM) return "none";
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.POSTMARK_SERVER_TOKEN) return "postmark";
  if (process.env.AWS_SES_REGION && process.env.AWS_ACCESS_KEY_ID) return "ses";
  return "none";
}

/** True when a real provider is configured and mail will actually be delivered. */
export function emailConfigured(): boolean {
  return activeProvider() !== "none";
}

/**
 * Report a configuration that looks like a mistake rather than a deliberate
 * "no mail yet". Called once at startup so a typo surfaces at boot instead of
 * the first time a user forgets their password.
 */
export function warnOnPartialMailConfig(): void {
  const hasCredential = Boolean(
    process.env.RESEND_API_KEY ||
      process.env.POSTMARK_SERVER_TOKEN ||
      (process.env.AWS_SES_REGION && process.env.AWS_ACCESS_KEY_ID),
  );

  if (hasCredential && !process.env.MAIL_FROM) {
    logger.error(
      { event: "mail_config_incomplete" },
      "A mail provider credential is set but MAIL_FROM is not; no mail will be sent. " +
        "Set MAIL_FROM to a verified sender on your authenticated domain.",
    );
    return;
  }

  if (process.env.NODE_ENV === "production" && !emailConfigured()) {
    logger.error(
      { event: "mail_not_configured" },
      "No mail provider is configured in production. Password reset cannot complete " +
        "and lockout notifications will not arrive; see docs/EMAIL-SETUP.md.",
    );
  }
}

/**
 * Send an email. Never throws.
 *
 * See the module header: an auth route's response must not vary with mail
 * outcome, so every failure path here is swallowed after being logged.
 */
export async function sendEmail(email: Email): Promise<SendOutcome> {
  const provider = activeProvider();

  if (provider === "none") {
    logger.warn(
      { to: redactEmail(email.to), subject: email.subject, event: "email_not_sent" },
      "Email provider not configured; message logged but NOT delivered",
    );
    return { delivered: false, provider, attempts: 0, error: "No mail provider configured" };
  }

  /**
   * One key for the whole message, reused across retries.
   *
   * Without it, a retry after a lost *response* — the request succeeded, the
   * reply never arrived — sends a second copy. Two password-reset mails for one
   * request is confusing on its own, and it also mints a second valid token, so
   * the one the user is most likely to click (the first) may not be the one
   * they expect. Resend deduplicates on this header; Postmark and SES have no
   * equivalent, so for those the duplicate is the accepted cost of retrying.
   */
  const idempotencyKey = randomUUID();

  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      switch (provider) {
        case "resend":
          await sendViaResend(email, idempotencyKey);
          break;
        case "postmark":
          await sendViaPostmark(email);
          break;
        case "ses":
          await sendViaSes(email);
          break;
      }

      logger.info(
        {
          to: redactEmail(email.to),
          subject: email.subject,
          provider,
          attempt,
          event: "email_sent",
        },
        "Email sent",
      );
      return { delivered: true, provider, attempts: attempt };
    } catch (err) {
      const retryable = err instanceof TransientMailError || isNetworkFailure(err);
      const lastAttempt = attempt === MAX_SEND_ATTEMPTS;

      if (retryable && !lastAttempt) {
        const wait = backoffMs(attempt);
        logger.warn(
          {
            err,
            to: redactEmail(email.to),
            provider,
            attempt,
            retryInMs: wait,
            event: "email_retrying",
          },
          "Email delivery failed with a transient error; retrying",
        );
        await sleep(wait);
        continue;
      }

      // Counted so repeated delivery failure is visible in monitoring rather
      // than only in the log stream — a silently broken mailer locks users out.
      recordAlert("email_delivery_failed");
      logger.error(
        {
          err,
          to: redactEmail(email.to),
          provider,
          attempts: attempt,
          permanent: !retryable,
          event: "email_failed",
        },
        retryable
          ? "Email delivery failed after every retry"
          : "Email delivery failed permanently; not retrying",
      );
      return {
        delivered: false,
        provider,
        attempts: attempt,
        error: err instanceof Error ? err.message : String(err),
        permanent: !retryable,
      };
    }
  }

  // Unreachable: the loop either returns or exhausts into the branch above.
  return { delivered: false, provider, attempts: MAX_SEND_ATTEMPTS };
}

// ─── Background delivery ─────────────────────────────────────────────────────

/**
 * Work that has been scheduled but has not finished.
 *
 * Tracked so shutdown can wait for it. An untracked fire-and-forget send is
 * dropped on every deploy, and the one it drops is a password reset someone is
 * sitting there waiting for.
 */
const inFlight = new Set<Promise<void>>();

/**
 * Run `work` after the current request has been answered.
 *
 * `work` is the whole job, not just the send — for a password reset that
 * includes minting the token, because doing that inside the request would put
 * a database write on the registered-address path and none on the other, which
 * is the same timing tell in a smaller form.
 *
 * Never throws and never rejects: callers use it in a position where they have
 * already decided what to return.
 */
export function deferEmail(label: string, work: () => Promise<void>): void {
  const task = (async () => {
    try {
      await work();
    } catch (err) {
      recordAlert("email_delivery_failed");
      logger.error({ err, label, event: "email_task_failed" }, "Deferred email task threw");
    }
  })();

  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
}

/**
 * Wait for scheduled sends to finish, up to `timeoutMs`.
 *
 * Called on SIGTERM, and by tests that need to assert on what was sent without
 * depending on microtask ordering. Returns how many were still outstanding when
 * it gave up — nonzero means mail was probably lost, which is worth a log line
 * rather than a silent exit.
 */
export async function drainMail(timeoutMs = 10_000): Promise<number> {
  if (inFlight.size === 0) return 0;

  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });

  await Promise.race([Promise.allSettled([...inFlight]), expired]);
  if (timer) clearTimeout(timer);

  return inFlight.size;
}

// ─── Providers ───────────────────────────────────────────────────────────────

/** Abort a hung provider call rather than leaking a pending request forever. */
const SEND_TIMEOUT_MS = 10_000;

function withTimeout(): AbortSignal {
  return AbortSignal.timeout(SEND_TIMEOUT_MS);
}

/**
 * Total attempts per message, including the first.
 *
 * Three, because the failure this exists for is a blip — a 429 from a burst, a
 * 502 while the provider redeploys — and the cost of not retrying it is a
 * password reset that silently never arrives. The user's only signal is an
 * email that does not come, and their only recourse is to ask again, which is
 * indistinguishable from the request having worked.
 *
 * Not more than three: past that it stops being a blip and the alert counter is
 * the right response, not a longer queue of doomed retries.
 */
const MAX_SEND_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

/**
 * A failure worth trying again. Anything else — a bad key, an unverified
 * domain, a malformed address — will fail identically forever, and retrying it
 * just triples the log noise while delaying the alert.
 */
class TransientMailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientMailError";
  }
}

function isRetryableStatus(status: number): boolean {
  // 408 timeout, 425 too early, 429 rate limited, and anything 5xx.
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * A network-level failure: DNS, connection reset, or our own abort timer.
 *
 * These never reached `assertOk`, so they arrive as ordinary `Error`s and would
 * otherwise be classed as permanent — which is backwards, since a dropped
 * connection is the most retryable failure there is.
 */
function isNetworkFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "AbortError" ||
    err.name === "TimeoutError" ||
    err.name === "TypeError" || // fetch's "failed to fetch" / connection errors
    /network|socket|ECONN|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(err.message)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential, with jitter so retries from a burst do not resynchronise. */
function backoffMs(attempt: number): number {
  const base = RETRY_BASE_MS * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * RETRY_BASE_MS);
}

/**
 * Turn a failed provider response into an error worth reading.
 *
 * ── Why this changed ────────────────────────────────────────────────────────
 * This used to keep only the status code, on the reasoning that provider errors
 * echo the recipient address and sometimes the key prefix. That was too blunt:
 * the first real failure in production was a bare `Resend returned 403`, which
 * says nothing about whether the key was wrong, the domain unverified, the
 * recipient not permitted, or the account rate-limited. Every one of those has a
 * different fix.
 *
 * Providers return a short machine-readable reason alongside the prose. That
 * reason is what gets extracted here — bounded in length, and with anything
 * that looks like an email address or a key redacted before it can reach a log.
 * The reason travels in the *server log only*; the caller's response is
 * unchanged, so this still cannot leak whether an address is registered.
 */
/**
 * Pull a human-readable reason out of a provider's JSON error body.
 *
 * The three providers disagree on the field name, and some of them nest — SES
 * returns `{ message }`, Postmark `{ Message }`, and Resend has used both a
 * flat `{ message }` and a wrapped `{ error: { message } }`. Coercing the field
 * with `String()` produced `[object Object]` for the nested shape, which is
 * exactly as useless as the bare status code this function was added to
 * replace.
 *
 * Depth-bounded, because the input is an untrusted response body.
 */
function extractReason(value: unknown, depth = 0): string {
  if (typeof value === "string") return value;
  if (depth > 3 || value === null || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  for (const key of ["message", "Message", "error", "errorMessage", "name", "detail"]) {
    const found = extractReason(record[key], depth + 1);
    if (found) return found;
  }
  return "";
}

async function assertOk(res: Response, provider: string): Promise<void> {
  if (res.ok) return;

  let reason = "";
  try {
    const body = await res.text();
    const parsed: unknown = JSON.parse(body);
    reason = extractReason(parsed) || body;
  } catch {
    // Non-JSON body, or already consumed. The status alone still helps.
  }

  const safe = reason
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<address>")
    .replace(/\b(re|sk|key)_[A-Za-z0-9_-]{6,}/gi, "<key>")
    .slice(0, 300)
    .trim();

  const message = `${provider} returned ${res.status}${safe ? `: ${safe}` : ""}`;

  // Classified here rather than at the call site, because the status is the
  // only thing that distinguishes "try again in a second" from "this will fail
  // identically forever". Retrying a 422 for a malformed address just delays
  // the alert that says the address is malformed.
  throw isRetryableStatus(res.status)
    ? new TransientMailError(message)
    : new Error(message);
}

async function sendViaResend(email: Email, idempotencyKey?: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: withTimeout(),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      // Resend deduplicates on this for 24h, so a retry after a lost response
      // does not send a second copy (and does not mint a second reset token).
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
      ...(email.html ? { html: email.html } : {}),
    }),
  });
  await assertOk(res, "Resend");
}

async function sendViaPostmark(email: Email): Promise<void> {
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    signal: withTimeout(),
    headers: {
      "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN!,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      From: process.env.MAIL_FROM,
      To: email.to,
      Subject: email.subject,
      TextBody: email.text,
      ...(email.html ? { HtmlBody: email.html } : {}),
      // Postmark's transactional stream — separate from any broadcast stream, so
      // a marketing unsubscribe can never suppress a password reset.
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM ?? "outbound",
    }),
  });
  await assertOk(res, "Postmark");
}

/**
 * Amazon SES via the v2 REST API, signed with SigV4.
 *
 * Implemented directly rather than pulling in `@aws-sdk/client-sesv2` — the SDK
 * is ~10MB of dependency for one POST, and this keeps the container small.
 */
async function sendViaSes(email: Email): Promise<void> {
  const region = process.env.AWS_SES_REGION!;
  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";

  const payload = JSON.stringify({
    FromEmailAddress: process.env.MAIL_FROM,
    Destination: { ToAddresses: [email.to] },
    Content: {
      Simple: {
        Subject: { Data: email.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: email.text, Charset: "UTF-8" },
          ...(email.html ? { Html: { Data: email.html, Charset: "UTF-8" } } : {}),
        },
      },
    },
  });

  const headers = await signSesRequest({ region, host, path, payload });

  const res = await fetch(`https://${host}${path}`, {
    method: "POST",
    signal: withTimeout(),
    headers,
    body: payload,
  });
  await assertOk(res, "SES");
}

/** Minimal AWS SigV4 signer for the single SES call above. */
async function signSesRequest(opts: {
  region: string;
  host: string;
  path: string;
  payload: string;
}): Promise<Record<string, string>> {
  const crypto = await import("node:crypto");
  const { region, host, path, payload } = opts;

  const accessKey = process.env.AWS_ACCESS_KEY_ID!;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY!;
  const service = "ses";

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const sha256 = (data: string | Buffer): string =>
    crypto.createHash("sha256").update(data).digest("hex");
  const hmac = (key: string | Buffer, data: string): Buffer =>
    crypto.createHmac("sha256", key).update(data).digest();

  const payloadHash = sha256(payload);
  const canonicalHeaders =
    `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";

  const canonicalRequest = [
    "POST",
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), service),
    "aws4_request",
  );
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  return {
    "Content-Type": "application/json",
    "X-Amz-Date": amzDate,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** `ab***@example.com` — enough to correlate logs, not enough to harvest. */
function redactEmail(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

// ─── Templates ───────────────────────────────────────────────────────────────

/**
 * Escape before interpolating into the HTML bodies below.
 *
 * The only interpolated value is a URL we generated ourselves, so this is
 * belt-and-braces — but a template that concatenates unescaped strings is one
 * refactor away from being a real problem.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Shared HTML shell. Table-based and inline-styled because that is what renders
 * consistently in Outlook and Gmail; no external CSS or images, so nothing is
 * blocked by an image-blocking client and there is no tracking pixel to explain
 * in the privacy policy.
 */
function htmlShell(heading: string, bodyHtml: string, footer: string): string {
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#f5f5f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<tr><td>
<p style="margin:0 0 24px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#78716c;">4Form AI</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#1c1917;font-weight:600;">${escapeHtml(heading)}</h1>
${bodyHtml}
<p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e7e5e4;font-size:12px;line-height:1.5;color:#78716c;">${escapeHtml(footer)}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:0 0 24px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:500;">${escapeHtml(label)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#78716c;">If the button doesn't work, paste this into your browser:</p>
<p style="margin:0 0 24px;font-size:13px;word-break:break-all;"><a href="${escapeHtml(url)}" style="color:#1c1917;">${escapeHtml(url)}</a></p>`;
}

export function passwordResetEmail(to: string, resetUrl: string, expiresMinutes: number): Email {
  const text = [
    "We received a request to reset your 4Form AI password.",
    "",
    `Reset it here: ${resetUrl}`,
    "",
    `This link expires in ${expiresMinutes} minutes and can only be used once.`,
    "If you didn't request this, you can ignore this email. Your password will not change.",
  ].join("\n");

  const html = htmlShell(
    "Reset your password",
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#44403c;">We received a request to reset your 4Form AI password. Tap below to choose a new one.</p>
${button(resetUrl, "Reset password")}
<p style="margin:0;font-size:14px;line-height:1.6;color:#44403c;">This link expires in ${expiresMinutes} minutes and can only be used once.</p>`,
    "If you didn't request this, you can safely ignore this email. Your password will not change.",
  );

  return { to, subject: "Reset your 4Form AI password", text, html };
}

export function accountLockedEmail(to: string, resetUrl: string, lockMinutes: number): Email {
  const text = [
    "We detected several failed sign-in attempts on your 4Form AI account.",
    `As a precaution, sign-in is paused for ${lockMinutes} minutes.`,
    "",
    "If this was you and you've forgotten your password, reset it here:",
    resetUrl,
    "",
    "If this wasn't you, someone may be trying to access your account.",
    "We recommend resetting your password using the link above.",
  ].join("\n");

  const html = htmlShell(
    "Unusual sign-in activity",
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#44403c;">We detected several failed sign-in attempts on your account. As a precaution, sign-in is paused for ${lockMinutes} minutes.</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#44403c;">If this was you and you've forgotten your password, you can reset it now. That also lifts the pause immediately.</p>
${button(resetUrl, "Reset password")}`,
    "If this wasn't you, someone may be trying to access your account. We recommend resetting your password using the link above.",
  );

  return { to, subject: "Unusual sign-in activity on your 4Form AI account", text, html };
}
