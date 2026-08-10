/**
 * Transactional email.
 *
 * No provider is wired up yet, so this ships with a logging transport: emails
 * are recorded server-side and never delivered. That is a deliberate, visible
 * no-op rather than a silent one — `emailConfigured()` reports the real state
 * so callers and the health endpoint can tell the truth about it.
 *
 * To go live, set RESEND_API_KEY (or swap `sendViaResend` for your provider)
 * and MAIL_FROM. Nothing else in the codebase needs to change.
 */

import { logger } from "./logger.js";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/** True when a real provider is configured and mail will actually be delivered. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

/**
 * Send an email. Never throws: a mail failure must not turn into a 500 on an
 * auth route, and must not change the response the caller sees (which would
 * leak whether the address exists).
 */
export async function sendEmail(email: Email): Promise<void> {
  try {
    if (!emailConfigured()) {
      logger.warn(
        { to: redactEmail(email.to), subject: email.subject, event: "email_not_sent" },
        "Email provider not configured — message logged but NOT delivered",
      );
      return;
    }
    await sendViaResend(email);
    logger.info(
      { to: redactEmail(email.to), subject: email.subject, event: "email_sent" },
      "Email sent",
    );
  } catch (err) {
    logger.error(
      { err, to: redactEmail(email.to), event: "email_failed" },
      "Email delivery failed",
    );
  }
}

async function sendViaResend(email: Email): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
    }),
  });

  if (!res.ok) {
    // Body may echo the address; keep it out of the thrown message.
    throw new Error(`Mail provider returned ${res.status}`);
  }
}

/** `ab***@example.com` — enough to correlate logs, not enough to harvest. */
function redactEmail(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

// ─── Templates ───────────────────────────────────────────────────────────────

export function passwordResetEmail(to: string, resetUrl: string, expiresMinutes: number): Email {
  return {
    to,
    subject: "Reset your AthleteAI password",
    text: [
      "We received a request to reset your AthleteAI password.",
      "",
      `Reset it here: ${resetUrl}`,
      "",
      `This link expires in ${expiresMinutes} minutes and can only be used once.`,
      "If you didn't request this, you can ignore this email — your password will not change.",
    ].join("\n"),
  };
}

export function accountLockedEmail(to: string, resetUrl: string, lockMinutes: number): Email {
  return {
    to,
    subject: "Unusual sign-in activity on your AthleteAI account",
    text: [
      "We detected several failed sign-in attempts on your AthleteAI account.",
      `As a precaution, sign-in is paused for ${lockMinutes} minutes.`,
      "",
      "If this was you and you've forgotten your password, reset it here:",
      resetUrl,
      "",
      "If this wasn't you, someone may be trying to access your account.",
      "We recommend resetting your password using the link above.",
    ].join("\n"),
  };
}
