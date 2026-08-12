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
 * ── Deliverability ──────────────────────────────────────────────────────────
 * Reset mail that lands in spam is the same as no reset mail. SPF, DKIM, and
 * DMARC must be configured on the sending domain before launch — see
 * docs/EMAIL-SETUP.md for the exact records and a verification procedure.
 */

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
      "A mail provider credential is set but MAIL_FROM is not — no mail will be sent. " +
        "Set MAIL_FROM to a verified sender on your authenticated domain.",
    );
    return;
  }

  if (process.env.NODE_ENV === "production" && !emailConfigured()) {
    logger.error(
      { event: "mail_not_configured" },
      "No mail provider is configured in production. Password reset cannot complete " +
        "and lockout notifications will not arrive — see docs/EMAIL-SETUP.md.",
    );
  }
}

/**
 * Send an email. Never throws.
 *
 * See the module header: an auth route's response must not vary with mail
 * outcome, so every failure path here is swallowed after being logged.
 */
export async function sendEmail(email: Email): Promise<void> {
  const provider = activeProvider();

  try {
    if (provider === "none") {
      logger.warn(
        { to: redactEmail(email.to), subject: email.subject, event: "email_not_sent" },
        "Email provider not configured — message logged but NOT delivered",
      );
      return;
    }

    switch (provider) {
      case "resend":
        await sendViaResend(email);
        break;
      case "postmark":
        await sendViaPostmark(email);
        break;
      case "ses":
        await sendViaSes(email);
        break;
    }

    logger.info(
      { to: redactEmail(email.to), subject: email.subject, provider, event: "email_sent" },
      "Email sent",
    );
  } catch (err) {
    // Counted so repeated delivery failure is visible in monitoring rather than
    // only in the log stream — a silently broken mailer locks users out.
    recordAlert("email_delivery_failed");
    logger.error(
      { err, to: redactEmail(email.to), provider, event: "email_failed" },
      "Email delivery failed",
    );
  }
}

// ─── Providers ───────────────────────────────────────────────────────────────

/** Abort a hung provider call rather than holding the request open. */
const SEND_TIMEOUT_MS = 10_000;

function withTimeout(): AbortSignal {
  return AbortSignal.timeout(SEND_TIMEOUT_MS);
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
async function assertOk(res: Response, provider: string): Promise<void> {
  if (res.ok) return;

  let reason = "";
  try {
    const body = await res.text();
    // Providers disagree on the field name; take whichever is present.
    const parsed = JSON.parse(body) as Record<string, unknown>;
    reason =
      String(parsed.message ?? parsed.error ?? parsed.Message ?? parsed.name ?? "") || body;
  } catch {
    // Non-JSON body, or already consumed. The status alone still helps.
  }

  const safe = reason
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<address>")
    .replace(/\b(re|sk|key)_[A-Za-z0-9_-]{6,}/gi, "<key>")
    .slice(0, 300)
    .trim();

  throw new Error(`${provider} returned ${res.status}${safe ? `: ${safe}` : ""}`);
}

async function sendViaResend(email: Email): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: withTimeout(),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
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
<p style="margin:0 0 24px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#78716c;">AthleteAI</p>
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
    "We received a request to reset your AthleteAI password.",
    "",
    `Reset it here: ${resetUrl}`,
    "",
    `This link expires in ${expiresMinutes} minutes and can only be used once.`,
    "If you didn't request this, you can ignore this email — your password will not change.",
  ].join("\n");

  const html = htmlShell(
    "Reset your password",
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#44403c;">We received a request to reset your AthleteAI password. Tap below to choose a new one.</p>
${button(resetUrl, "Reset password")}
<p style="margin:0;font-size:14px;line-height:1.6;color:#44403c;">This link expires in ${expiresMinutes} minutes and can only be used once.</p>`,
    "If you didn't request this, you can safely ignore this email — your password will not change.",
  );

  return { to, subject: "Reset your AthleteAI password", text, html };
}

export function accountLockedEmail(to: string, resetUrl: string, lockMinutes: number): Email {
  const text = [
    "We detected several failed sign-in attempts on your AthleteAI account.",
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
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#44403c;">If this was you and you've forgotten your password, you can reset it now — that also lifts the pause immediately.</p>
${button(resetUrl, "Reset password")}`,
    "If this wasn't you, someone may be trying to access your account. We recommend resetting your password using the link above.",
  );

  return { to, subject: "Unusual sign-in activity on your AthleteAI account", text, html };
}
