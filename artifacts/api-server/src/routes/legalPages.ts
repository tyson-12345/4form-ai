/**
 * The two legal documents: the privacy policy and the terms.
 *
 * The landing page at `/` moved to `routes/landingPage.ts` when it became a
 * real page — it is a large static file with its own stylesheet, script, fonts
 * and Content-Security-Policy, and it had nothing left in common with these two
 * beyond the shell they no longer share.
 *
 * ── Why the API serves these ────────────────────────────────────────────────
 * Both stores check the privacy-policy URL during review, and the same URL goes
 * in App Store Connect, Play Console and the app's Profile screen. Until this
 * existed `4formai.com` returned a JSON 404, which is a review rejection and
 * looks worse than the parking page it replaced.
 *
 * The API already serves the password-reset page, so it already has the CSP,
 * the rate limiting and the HTML plumbing. Standing up a separate static host
 * for two documents would mean a second deployment to keep in sync with the
 * text, and the text is the thing most likely to change.
 *
 * ── The documents are the Markdown ──────────────────────────────────────────
 * `docs/PRIVACY-POLICY.md` and `docs/TERMS-OF-SERVICE.md` are the source of
 * truth and are inlined into the bundle at build time (esbuild's text loader).
 * There is no copy to drift: editing the Markdown and redeploying is the whole
 * publishing process.
 *
 * ── Refusing to publish an unfinished document ──────────────────────────────
 * Both files ship with `[BRACKETED]` values for a human to fill — the legal
 * entity, its address, the governing jurisdiction — and with editorial notes
 * marked "delete before publishing". Serving either of those to a user would be
 * worse than serving nothing: a privacy policy that misstates who is collecting
 * the data is enforceable against us, and a stray "delete before publishing"
 * tells a store reviewer the document is a draft.
 *
 * So a document with unresolved placeholders is not served. It returns 503 and
 * a page saying so, and the specific placeholders are logged. This cannot be
 * forgotten about, and it cannot leak.
 */

import { Router, type IRouter } from "express";
import crypto from "node:crypto";

import privacyMarkdown from "../../../../docs/PRIVACY-POLICY.md";
import termsMarkdown from "../../../../docs/TERMS-OF-SERVICE.md";
import { findPlaceholders, renderMarkdown } from "../lib/markdown.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/** Caliper's palette, so the web pages and the app are recognisably one thing. */
const INK = "#101312";
const BONE = "#EDECE7";
const COBALT = "#2436E8";
const MUTED = "#6B6F6C";

function shell(title: string, nonce: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 24px 96px;
    font: 16px/1.65 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: ${INK}; background: ${BONE};
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 720px; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 40px; }
  .brand svg { display: block; border-radius: 22.6%; }
  .brand span {
    font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase;
    font-weight: 600; color: ${MUTED};
  }
  h1 { font-size: 30px; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 8px; }
  h2 { font-size: 20px; letter-spacing: -0.01em; margin: 40px 0 8px; }
  h3 { font-size: 16px; margin: 28px 0 6px; }
  p, li { color: #2A2E2C; }
  a { color: ${COBALT}; }
  hr { border: 0; border-top: 1px solid rgba(16,19,18,0.12); margin: 40px 0; }
  code {
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    background: rgba(16,19,18,0.06); padding: 1px 5px; border-radius: 4px;
  }
  blockquote {
    margin: 20px 0; padding: 2px 0 2px 16px;
    border-left: 2px solid ${COBALT}; color: #3A3E3C;
  }
  blockquote p { margin: 6px 0; }
  table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 14px; display: block; overflow-x: auto; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid rgba(16,19,18,0.12); vertical-align: top; }
  th { font-weight: 600; white-space: nowrap; }
  nav { margin-top: 56px; font-size: 14px; }
  nav a { margin-right: 20px; }
  .lede { color: ${MUTED}; font-size: 17px; }
  @media (prefers-color-scheme: dark) {
    body { color: ${BONE}; background: ${INK}; }
    p, li { color: #C9CCC8; }
    blockquote { color: #B4B8B4; }
    th, td, hr { border-color: rgba(237,236,231,0.14); }
    code { background: rgba(237,236,231,0.10); }
    a { color: #8E9BFF; }
    .brand span, .lede { color: #9AA09C; }
  }
</style>
</head>
<body>
<main>
  <div class="brand">
    ${mark(28)}
    <span>4Form AI</span>
  </div>
${body}
  <nav>
    <a href="/">Home</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>
  </nav>
</main>
</body>
</html>`;
}

/**
 * The 4 mark, at the 29pt rung of the icon's optical size ladder.
 *
 * Same geometry as `scripts/generate-icons.py` and the app's `AppMark`. Inline
 * because the CSP is `default-src 'none'` — an external image would be blocked,
 * and should be: these pages load nothing from anywhere.
 */
function mark(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 168 168" xmlns="http://www.w3.org/2000/svg" style="background:${INK}">
  <path d="M 107 32 L 107 136" stroke="${BONE}" stroke-width="20" stroke-linecap="round" fill="none"/>
  <path d="M 22 118 L 140 118" stroke="${BONE}" stroke-width="20" stroke-linecap="round" fill="none"/>
  <path d="M 107 32 L 23 118" stroke="${COBALT}" stroke-width="20" stroke-linecap="round" fill="none"/>
</svg>`;
}

function startPage(res: import("express").Response): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  res.setHeader(
    "Content-Security-Policy",
    ["default-src 'none'", `style-src 'nonce-${nonce}'`, "img-src data:", "form-action 'none'"].join(
      "; ",
    ),
  );
  res.type("html");
  return nonce;
}

/** A document, or an honest refusal if it is not finished. */
function serveDocument(
  res: import("express").Response,
  title: string,
  markdown: string,
  slug: string,
): void {
  const nonce = startPage(res);
  const unresolved = findPlaceholders(markdown);

  if (unresolved.length > 0) {
    logger.warn(
      { document: slug, placeholders: unresolved, event: "legal_document_unpublished" },
      "Refusing to serve a legal document with unresolved placeholders",
    );
    res.status(503).send(
      shell(
        `${title} · 4Form AI`,
        nonce,
        `<h1>${title}</h1>
  <p class="lede">This document is not published yet.</p>
  <p>It is written but still has details to fill in, and publishing a legal
  document with blanks in it would be worse than publishing none. It will be
  here shortly.</p>`,
      ),
    );
    return;
  }

  res.status(200).send(shell(`${title} · 4Form AI`, nonce, renderMarkdown(markdown)));
}

router.get("/privacy", (_req, res) => {
  serveDocument(res, "Privacy Policy", privacyMarkdown, "privacy");
});

router.get("/terms", (_req, res) => {
  serveDocument(res, "Terms of Service", termsMarkdown, "terms");
});

export default router;
