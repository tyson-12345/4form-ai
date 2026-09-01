/**
 * Send one real email and say precisely what went wrong if it does not arrive.
 *
 *     pnpm mail:verify you@example.com
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Setting up a transactional sender is a chain of six things that must all be
 * right — key, sender domain, DNS verification, `MAIL_FROM` matching that
 * domain, the provider's own sandbox rules, and `APP_PUBLIC_URL` for the links
 * — and the failure mode for every one of them is identical from the app: the
 * email does not arrive. Debugging that through the password-reset flow means
 * a round trip per guess, with the answer buried in server logs and the route
 * deliberately returning the same response either way.
 *
 * This collapses that to one command. It exercises the *real* `sendEmail` path,
 * not a reimplementation, so a pass here means the app can send.
 *
 * It never prints the API key, and it redacts anything key-shaped out of
 * provider responses before showing them.
 */

import { activeProvider, emailConfigured, sendEmail, type Email } from "../lib/mailer.js";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function ok(msg: string): void {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}
function bad(msg: string): void {
  console.log(`${RED}✗${RESET} ${msg}`);
}
function warn(msg: string): void {
  console.log(`${YELLOW}!${RESET} ${msg}`);
}
function hint(msg: string): void {
  console.log(`  ${DIM}${msg}${RESET}`);
}

/**
 * The address in `MAIL_FROM`, which may be either `a@b.com` or
 * `Name <a@b.com>`. Both are valid and the second is preferable, so the
 * checks below have to handle it rather than assuming the bare form.
 */
function fromAddress(): string | null {
  const raw = process.env.MAIL_FROM?.trim();
  if (!raw) return null;
  const angled = /<([^>]+)>/.exec(raw);
  return (angled ? angled[1] : raw).trim().toLowerCase();
}

function preflight(recipient: string): boolean {
  let fatal = false;

  const provider = activeProvider();
  if (!emailConfigured()) {
    bad("No mail provider is configured.");
    if (!process.env.MAIL_FROM) hint("MAIL_FROM is not set.");
    if (!process.env.RESEND_API_KEY) hint("RESEND_API_KEY is not set.");
    hint("Both are required. See docs/EMAIL-SETUP.md §3.");
    return false;
  }
  ok(`Provider resolves to ${BOLD}${provider}${RESET}`);

  const from = fromAddress();
  if (!from || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) {
    bad(`MAIL_FROM does not contain a valid address: ${JSON.stringify(process.env.MAIL_FROM)}`);
    hint('Use either "no-reply@mail.example.com" or "4Form AI <no-reply@mail.example.com>".');
    fatal = true;
  } else {
    ok(`Sending as ${BOLD}${from}${RESET}`);

    // The single most common setup mistake, and the one whose error message is
    // least informative: a key that is valid for one domain, sending as another.
    const domain = from.split("@")[1];
    if (/(gmail|yahoo|outlook|hotmail|icloud|proton)\./.test(domain)) {
      bad(`${domain} cannot be used as a sending domain.`);
      hint("Providers reject consumer domains — you cannot prove you own gmail.com.");
      hint("Use a subdomain you control, e.g. mail.yourdomain.com. See docs/EMAIL-SETUP.md §1.");
      fatal = true;
    }
  }

  if (provider === "resend" && !process.env.RESEND_API_KEY?.startsWith("re_")) {
    warn("RESEND_API_KEY does not start with 're_' — check you pasted the API key.");
    hint("Resend keys look like re_xxxxxxxx. A signing secret or domain ID will 401.");
  }

  if (!process.env.APP_PUBLIC_URL) {
    warn("APP_PUBLIC_URL is not set.");
    hint("Not fatal here, but reset links are built from it — without it they point at");
    hint("localhost in dev and the server refuses to build them at all in production.");
  } else {
    ok(`Reset links will point at ${BOLD}${process.env.APP_PUBLIC_URL}${RESET}`);
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
    bad(`"${recipient}" is not a valid recipient address.`);
    fatal = true;
  }

  return !fatal;
}

/**
 * Map a failure to the thing that is actually wrong.
 *
 * `sendEmail` swallows errors by design — an auth route must not 500 because
 * mail is down — so the message is recovered from the log line it emits rather
 * than from a thrown error. Everything matched here is a real provider
 * response, not a guess at one.
 */
function diagnose(logLine: string): void {
  const checks: [RegExp, string[]][] = [
    [
      /\b401\b|invalid.*api.?key|unauthor/i,
      [
        "The API key was rejected.",
        "Regenerate it in Resend → API Keys and check for a trailing space or newline.",
        "A key scoped to 'sending access' on a specific domain will also 401 for another domain.",
      ],
    ],
    [
      /\b403\b|not verified|domain.*verif/i,
      [
        "The sending domain is not verified.",
        "Resend → Domains → your domain must read 'Verified', not 'Pending'.",
        "DNS can take up to an hour; re-run this once it flips. See docs/EMAIL-SETUP.md §2.",
      ],
    ],
    [
      /\b422\b|validation|invalid.*from|does not match/i,
      [
        "The provider rejected the message itself, usually the From address.",
        "MAIL_FROM's domain must be exactly the domain you verified — mail.example.com",
        "and example.com are different domains as far as the provider is concerned.",
      ],
    ],
    [
      /testing emails|own email address|sandbox/i,
      [
        "The account is still in testing mode.",
        "Until a domain is verified, Resend only delivers to the address that owns the",
        "account. Either send this test to that address, or verify a domain.",
      ],
    ],
    [
      /\b429\b|rate limit/i,
      ["Rate limited by the provider. Wait a moment and re-run; the app retries these automatically."],
    ],
    [
      /\b5\d\d\b|network|fetch failed|timeout|abort/i,
      [
        "Could not reach the provider — network, DNS, or an outage on their side.",
        "The app retries these automatically, so this is only a problem if it persists.",
      ],
    ],
  ];

  for (const [pattern, lines] of checks) {
    if (pattern.test(logLine)) {
      for (const line of lines) hint(line);
      return;
    }
  }
  hint("Unrecognised failure. The full provider response is in the line above.");
}

async function main(): Promise<void> {
  const recipient = process.argv[2];

  console.log(`\n${BOLD}Email delivery check${RESET}\n`);

  if (!recipient) {
    bad("Usage: pnpm mail:verify <recipient@example.com>");
    hint("Send it to an address you can actually open — the point is to read the result.");
    process.exit(1);
  }

  if (!preflight(recipient)) {
    console.log(`\n${RED}Configuration is incomplete. Nothing was sent.${RESET}\n`);
    process.exit(1);
  }

  const message: Email = {
    to: recipient,
    subject: "4Form AI email delivery test",
    text: [
      "This is a test from `pnpm mail:verify`.",
      "",
      "If you are reading it, transactional email works: password resets and",
      "lockout notices will be delivered the same way.",
      "",
      "One thing left to check — open this message's raw headers and confirm",
      "spf=pass, dkim=pass and dmarc=pass. Mail that lands in spam is the same",
      "as mail that never arrived.",
    ].join("\n"),
  };

  console.log(`\n${DIM}Sending to ${recipient}…${RESET}\n`);
  // `sendEmail` never throws — it reports. Reading the returned outcome rather
  // than scraping the log stream matters here: pino writes through a transport
  // thread, so stdout interception silently sees nothing and every failure
  // would be reported as "unrecognised".
  const outcome = await sendEmail(message);

  console.log("");
  if (outcome.delivered) {
    ok(
      `${BOLD}The provider accepted the message.${RESET}` +
        (outcome.attempts > 1 ? ` ${DIM}(after ${outcome.attempts} attempts)${RESET}` : ""),
    );
    console.log("");
    hint("Accepted is not the same as delivered. Now open the inbox and check:");
    hint("  1. It arrived, and is not in spam.");
    hint("  2. Raw headers show spf=pass, dkim=pass, dmarc=pass.");
    hint("     Gmail: ⋮ → Show original.");
    hint("Anything less means a DNS record is wrong — see docs/EMAIL-SETUP.md §2.");
    console.log("");
    process.exit(0);
  }

  bad(`${BOLD}The message was not accepted.${RESET}`);
  if (outcome.error) hint(outcome.error);
  console.log("");
  diagnose(outcome.error ?? "");
  if (!outcome.permanent && outcome.attempts > 1) {
    hint(`Retried ${outcome.attempts} times before giving up.`);
  }
  console.log("");
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(`\n${RED}The check itself failed:${RESET}`, err);
  process.exit(1);
});
