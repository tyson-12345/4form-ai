/**
 * The web page a password-reset link opens.
 *
 * ── Why the API serves HTML at all ──────────────────────────────────────────
 * The reset email contains a link. Until this existed, that link pointed at the
 * API and got a JSON 404 — the mail sent, the token was valid, and the user hit
 * a dead end. The flow was complete on paper and broken in practice.
 *
 * Three ways to land a reset link, and only one works today:
 *
 *  - **Universal / App Links** (`https://…` opening the installed app) need a
 *    domain we control plus an `apple-app-site-association` file and an Android
 *    assetlinks file. We have no domain yet.
 *  - **A custom scheme** (`athleteai://…`) needs no domain, but mail clients
 *    routinely strip or refuse non-http links, and it fails completely for
 *    someone reading mail on a laptop — which is the common case.
 *  - **A web page**, this. Works in every mail client, on every device, whether
 *    or not the app is installed.
 *
 * When a domain exists, Universal Links can be layered on top; this page stays
 * as the fallback for desktop and for people without the app.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 * The page is self-contained: no external scripts, styles, fonts, or images, so
 * nothing about a password reset is observable by a third party. The API's
 * global CSP is `default-src 'none'`, which would block even this page's own
 * inline assets, so a per-request nonce is issued and the CSP narrowed to it.
 *
 * The token is never echoed into the HTML as text. It goes into a hidden input
 * value, HTML-escaped, and is submitted by fetch — it is never placed anywhere
 * it could be logged, and `Referrer-Policy: no-referrer` (set globally) keeps it
 * out of any outbound referer header.
 */

import { Router, type IRouter } from "express";
import crypto from "node:crypto";
// Imported rather than restated, so this page cannot tell a user a rule the
// server disagrees with.
import { MIN_PASSWORD_LENGTH } from "../lib/validate.js";

const router: IRouter = Router();


function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * `GET /reset-password?token=…`
 *
 * Deliberately **not** under `/api` — this is a page a person opens, and the
 * `/api` prefix carries rate limits tuned for programmatic access.
 */
router.get("/reset-password", (req, res) => {
  const rawToken = typeof req.query.token === "string" ? req.query.token : "";
  // Bounded and character-restricted before it goes anywhere near the markup.
  // Reset tokens are base64url from `generateResetToken`.
  const token = /^[A-Za-z0-9_-]{20,200}$/.test(rawToken) ? rawToken : "";

  const nonce = crypto.randomBytes(16).toString("base64");

  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; "),
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  res.send(page(token, nonce));
});

function page(token: string, nonce: string): string {
  const missing = token === "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Reset your AthleteAI password</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 24px; background: #f5f5f4; color: #1c1917;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .card { width: 100%; max-width: 400px; background: #fff; border-radius: 14px; padding: 32px; }
  .brand { margin: 0 0 22px; font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: #78716c; }
  h1 { margin: 0 0 8px; font-size: 21px; line-height: 1.25; }
  p { margin: 0 0 20px; color: #44403c; font-size: 15px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 0 0 6px; }
  input {
    width: 100%; padding: 12px 14px; font-size: 16px; border: 1px solid #d6d3d1;
    border-radius: 9px; background: #fafaf9; color: inherit;
  }
  input:focus { outline: 2px solid #1c1917; outline-offset: 1px; }
  .hint { font-size: 13px; color: #78716c; margin: 7px 0 18px; }
  button {
    width: 100%; padding: 13px; font-size: 15px; font-weight: 600; color: #fff;
    background: #1c1917; border: 0; border-radius: 9px; cursor: pointer;
  }
  button:disabled { opacity: .45; cursor: not-allowed; }
  .msg { margin-top: 18px; padding: 12px 14px; border-radius: 9px; font-size: 14px; display: none; }
  .msg.err { display: block; background: #fef2f2; color: #991b1b; }
  .msg.ok  { display: block; background: #f0fdf4; color: #166534; }
  .foot { margin: 24px 0 0; padding-top: 16px; border-top: 1px solid #e7e5e4; font-size: 13px; color: #78716c; }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1917; color: #f5f5f4; }
    .card { background: #292524; }
    input { background: #1c1917; border-color: #44403c; color: #f5f5f4; }
    button { background: #f5f5f4; color: #1c1917; }
    p, .hint, .foot { color: #a8a29e; }
    .msg.err { background: #450a0a; color: #fecaca; }
    .msg.ok  { background: #052e16; color: #bbf7d0; }
  }
</style>
</head>
<body>
<main class="card">
  <p class="brand">AthleteAI</p>
${
  missing
    ? `  <h1>This link isn't valid</h1>
  <p>The reset link is missing or malformed. Reset links expire 30 minutes after they're sent and can only be used once.</p>
  <p>Request a new one from the sign-in screen in the app.</p>`
    : `  <h1>Choose a new password</h1>
  <p>Pick something you don't use anywhere else.</p>

  <form id="f" autocomplete="on">
    <input type="hidden" id="token" value="${escapeHtml(token)}">
    <label for="pw">New password</label>
    <input id="pw" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
    <p class="hint">At least ${MIN_PASSWORD_LENGTH} characters. Length matters more than symbols.</p>
    <button id="go" type="submit">Reset password</button>
  </form>
  <div class="msg" id="m" role="status" aria-live="polite"></div>`
}
  <p class="foot">If you didn't ask for this, you can close this page — your password hasn't changed.</p>
</main>
${
  missing
    ? ""
    : `<script nonce="${nonce}">
(function () {
  var f = document.getElementById('f');
  var pw = document.getElementById('pw');
  var go = document.getElementById('go');
  var m = document.getElementById('m');

  function say(text, kind) { m.textContent = text; m.className = 'msg ' + kind; }

  f.addEventListener('submit', function (e) {
    e.preventDefault();
    if (pw.value.length < ${MIN_PASSWORD_LENGTH}) {
      say('Password must be at least ${MIN_PASSWORD_LENGTH} characters.', 'err');
      return;
    }
    go.disabled = true;
    go.textContent = 'Resetting…';

    fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: document.getElementById('token').value,
        password: pw.value
      })
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (res) {
        if (res.ok) {
          f.style.display = 'none';
          say('Your password has been reset. Open AthleteAI and sign in with your new password.', 'ok');
        } else {
          say((res.b && res.b.error) || 'That did not work. Request a new reset link.', 'err');
          go.disabled = false;
          go.textContent = 'Reset password';
        }
      })
      .catch(function () {
        say('Could not reach the server. Check your connection and try again.', 'err');
        go.disabled = false;
        go.textContent = 'Reset password';
      });
  });
})();
</script>`
}
</body>
</html>`;
}

export default router;
