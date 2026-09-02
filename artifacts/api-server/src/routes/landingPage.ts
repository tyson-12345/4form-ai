/**
 * The landing page at `/`, and the handful of files it loads.
 *
 * ── Why the API serves it ───────────────────────────────────────────────────
 * `4formai.com` resolves to this service. The API already served `/`, `/privacy`
 * and `/terms`, so the domain, the TLS, the rate limiting and the HTML plumbing
 * are all here already; a separate static host would be a second deployment to
 * keep in step with a page that shares this server's own copy.
 *
 * ── The page is a file, not a template ──────────────────────────────────────
 * `src/pages/landing.html` is the page — markup, stylesheet and script, all of
 * it — and it is inlined into the bundle at build time by esbuild's text loader,
 * exactly as the legal documents are. The runtime image contains only `dist/`
 * and `lib/`, so reading it from disk would work locally and 404 in production.
 *
 * Everything this module does to that file happens **once, at module load**:
 * three placeholder substitutions, two SHA-256 digests, and one pre-rendered
 * copy per page state. A request does no string work at all.
 *
 * ── Hashes, not a nonce ─────────────────────────────────────────────────────
 * The other HTML routes here mint a per-request nonce. This one cannot afford
 * to: a nonce makes every response body unique, which means no ETag, no 304,
 * and 90 KB back down the wire on every reload of a page whose entire content
 * is fixed. So the CSP pins the exact SHA-256 of the one `<style>` and the two
 * `<script>` blocks instead. That is strictly the stronger statement — a nonce
 * says "the server sent this", a hash says "this is the byte-for-byte script we
 * shipped" — and it makes the page cacheable.
 *
 * The digests are computed from the finished HTML at load, never written by
 * hand, so they cannot drift from the file. If the extraction finds anything
 * other than one style block and two script blocks, the module throws and the
 * server refuses to boot rather than serving a page with a CSP that silently
 * blocks its own stylesheet.
 *
 * ── What the page is allowed to reach ───────────────────────────────────────
 * `default-src 'none'` still. Then: its own fonts and icon from this origin,
 * its own two inline blocks by hash, `connect-src 'self'` for the waitlist
 * fetch, and `form-action 'self'` for the same form without scripting. Nothing
 * third-party, which is why the fonts are vendored (see `assets/fonts/LICENSE.md`).
 */

import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import zlib from "node:zlib";

// The fonts and the icon arrive as base64 strings, not bytes: esbuild's
// `binary` loader emits `Uint8Array.fromBase64`, which node:22-alpine does not
// have. Decoding here, once, is explicit and portable. See build.mjs.
import landingHtml from "../pages/landing.html";
import bricolageWoff2 from "../assets/fonts/bricolage-grotesque-latin.woff2";
import instrumentWoff2 from "../assets/fonts/instrument-sans-latin.woff2";
import jetbrainsWoff2 from "../assets/fonts/jetbrains-mono-latin.woff2";
import appleTouchIcon from "../assets/apple-touch-icon.png";

const router: IRouter = Router();

// ─── Assets ──────────────────────────────────────────────────────────────────

/**
 * The 4 mark, at the 29pt rung of the icon's optical size ladder, with the
 * favicon's 42-unit corner radius.
 *
 * Same geometry and the same three colours as `generate-icons.py`, the app's
 * `AppMark`, and the legal pages' inline mark. Cobalt appears nowhere except
 * the diagonal — that is the system's one rule.
 */
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 168 168">
<rect width="168" height="168" rx="42" fill="#101312"/>
<path d="M 107 32 L 107 136" stroke="#EDECE7" stroke-width="20" stroke-linecap="round" fill="none"/>
<path d="M 22 118 L 140 118" stroke="#EDECE7" stroke-width="20" stroke-linecap="round" fill="none"/>
<path d="M 107 32 L 23 118" stroke="#2436E8" stroke-width="20" stroke-linecap="round" fill="none"/>
</svg>
`;

interface Asset {
  /** The path this is served at, content-hashed so it can be immutable. */
  url: string;
  body: Buffer;
  type: string;
}

/**
 * An asset's URL carries eight hex characters of its own SHA-256.
 *
 * That is what lets the response say `immutable`: the bytes at a given URL can
 * never change, because changing the bytes changes the URL. A deploy that edits
 * a font ships a new path and no reader is left holding a stale one.
 */
function asset(name: string, body: Buffer, type: string): Asset {
  const digest = crypto.createHash("sha256").update(body).digest("hex").slice(0, 8);
  const dot = name.lastIndexOf(".");
  return { url: `/assets/${name.slice(0, dot)}-${digest}${name.slice(dot)}`, body, type };
}

const decode = (base64: string): Buffer => Buffer.from(base64, "base64");

const ASSETS = {
  fontDisplay: asset("bricolage-grotesque-latin.woff2", decode(bricolageWoff2), "font/woff2"),
  fontSans: asset("instrument-sans-latin.woff2", decode(instrumentWoff2), "font/woff2"),
  fontMono: asset("jetbrains-mono-latin.woff2", decode(jetbrainsWoff2), "font/woff2"),
  favicon: asset("mark.svg", Buffer.from(MARK_SVG, "utf8"), "image/svg+xml"),
  touchIcon: asset("apple-touch-icon.png", decode(appleTouchIcon), "image/png"),
} satisfies Record<string, Asset>;

const ASSETS_BY_URL = new Map(Object.values(ASSETS).map((a) => [a.url, a]));

// ─── The page ────────────────────────────────────────────────────────────────

const withAssets = landingHtml
  .replace(/__ASSET_FONT_DISPLAY__/g, ASSETS.fontDisplay.url)
  .replace(/__ASSET_FONT_SANS__/g, ASSETS.fontSans.url)
  .replace(/__ASSET_FONT_MONO__/g, ASSETS.fontMono.url)
  .replace(/__ASSET_FAVICON__/g, ASSETS.favicon.url)
  .replace(/__ASSET_TOUCH_ICON__/g, ASSETS.touchIcon.url);

/**
 * The CSP source expression for one inline block, hashed after substitution.
 *
 * The digest has to be over exactly what the browser will parse, which is why
 * this runs on the finished string and not on the source file: the stylesheet
 * carries the font URLs, and those are not known until the assets are hashed.
 */
function hashOf(content: string): string {
  return `'sha256-${crypto.createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

function inlineBlocks(html: string, tag: "style" | "script", expected: number): string[] {
  const found = [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map(
    (m) => m[1] ?? "",
  );
  if (found.length !== expected) {
    // A boot failure, not a degraded page. A CSP that does not cover the page's
    // own stylesheet renders it unstyled, and a CSP that does not cover its own
    // script renders it inert — both silently, and both only in a browser.
    throw new Error(
      `landing.html: expected ${expected} <${tag}> block(s), found ${found.length}. ` +
        "The Content-Security-Policy is derived from them, so this cannot be guessed at.",
    );
  }
  return found;
}

const STYLE_HASHES = inlineBlocks(withAssets, "style", 1).map(hashOf);
const SCRIPT_HASHES = inlineBlocks(withAssets, "script", 2).map(hashOf);

const CSP = [
  "default-src 'none'",
  `style-src ${STYLE_HASHES.join(" ")}`,
  `script-src ${SCRIPT_HASHES.join(" ")}`,
  "font-src 'self'",
  "img-src 'self'",
  // The waitlist fetch, and the same form without scripting.
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The three things the page can be showing, rendered once each.
 *
 * `joined` and `invalid` are what the no-JavaScript path lands on after its
 * POST and redirect; with scripting on, the page's own script reaches the same
 * joined state without a round trip. One set of markup, one set of rules — the
 * two paths cannot disagree about what "you are on the list" looks like.
 */
type PageState = "idle" | "joined" | "invalid" | "busy";

/** Word for word what the page's own script says, so the two paths agree. */
const MESSAGES: Record<PageState, string> = {
  idle: "",
  joined: "",
  invalid: "That does not look like an email address.",
  busy: "That is a lot of sign-ups from here. Try again in a minute.",
};

function render(state: PageState): string {
  return withAssets
    .replace(/__BODY_CLASS__/g, state === "joined" ? "is-joined" : "")
    .replace(/__FORM_ERROR__/g, MESSAGES[state]);
}

interface Page {
  identity: Buffer;
  gzip: Buffer;
  brotli: Buffer;
  etag: string;
}

/**
 * Compressed once at boot, not per request.
 *
 * The page is 90 KB of markup that never changes, so compressing it on every
 * request would be the same work repeated forever. Brotli at quality 11 is far
 * too slow to do per-request and completely free to do here.
 */
function compress(html: string): Page {
  const identity = Buffer.from(html, "utf8");
  return {
    identity,
    gzip: zlib.gzipSync(identity, { level: 9 }),
    brotli: zlib.brotliCompressSync(identity, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: identity.length,
      },
    }),
    etag: `"${crypto.createHash("sha256").update(identity).digest("base64url").slice(0, 27)}"`,
  };
}

const PAGES: Record<PageState, Page> = {
  idle: compress(render("idle")),
  joined: compress(render("joined")),
  invalid: compress(render("invalid")),
  busy: compress(render("busy")),
};

/** Which pre-rendered page a request is asking for. Only these three count. */
function stateFor(query: import("express").Request["query"]): PageState {
  if (query["joined"] === "1") return "joined";
  if (query["email"] === "invalid") return "invalid";
  if (query["busy"] === "1") return "busy";
  return "idle";
}

/**
 * The best encoding this client accepts, from the two we hold ready.
 *
 * Parsed rather than substring-matched, because `Accept-Encoding` can *refuse*
 * a coding: `gzip, br;q=0` means "gzip yes, brotli no", and a client that is
 * told no and served brotli anyway gets bytes it cannot read. `*` is honoured
 * too — a `*;q=0` with no explicit mention rules a coding out.
 */
function encodingFor(header: string | undefined): "br" | "gzip" | null {
  if (!header) return null;

  const q = new Map<string, number>();
  for (const part of header.toLowerCase().split(",")) {
    const [rawCoding, ...params] = part.trim().split(";");
    const coding = rawCoding?.trim();
    if (!coding) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const value = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
    q.set(coding, Number.isFinite(value) ? value : 1);
  }

  const wanted = (coding: string): boolean => {
    const explicit = q.get(coding);
    if (explicit !== undefined) return explicit > 0;
    const wildcard = q.get("*");
    return wildcard !== undefined && wildcard > 0;
  };

  if (wanted("br")) return "br";
  if (wanted("gzip")) return "gzip";
  return null;
}

router.get("/", (req, res) => {
  const page = PAGES[stateFor(req.query)];
  const encoding = encodingFor(req.get("accept-encoding"));

  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Revalidate rather than cache: a deploy should be visible immediately, and
  // an unchanged page still costs only a 304. This overrides the API-wide
  // `no-store`, which exists for JSON that may carry a user's own data — this
  // page has none, and it is the same bytes for everyone.
  res.setHeader("Cache-Control", "public, no-cache");
  res.setHeader("Vary", "Accept-Encoding");
  // The ETag is set before send, so express keeps it instead of generating one
  // over the compressed body — and answers a matching If-None-Match with a 304.
  res.setHeader("ETag", encoding ? `${page.etag.slice(0, -1)}-${encoding}"` : page.etag);

  if (encoding) res.setHeader("Content-Encoding", encoding);
  res.status(200).send(encoding === "br" ? page.brotli : encoding === "gzip" ? page.gzip : page.identity);
});

/**
 * `GET /assets/…` — the fonts and the mark.
 *
 * A closed set, looked up by the exact hashed path the page asked for. There is
 * no directory here and no path to traverse: an unknown name falls through to
 * the JSON 404 like any other unknown route.
 */
router.get("/assets/:file", (req, res, next) => {
  const found = ASSETS_BY_URL.get(`/assets/${req.params.file}`);
  if (!found) return next();

  res.setHeader("Content-Type", found.type);
  // The name contains the content hash, so these bytes are the only bytes this
  // URL will ever have.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.status(200).send(found.body);
});

/**
 * `/favicon.ico` — the path browsers probe whether or not the page names one.
 *
 * The page does name one, and it is the SVG above, which is what any current
 * browser will use. This is the fallback for the ones that guess, and it exists
 * mostly so the request stops landing in the logs as a 404 on every visit. It is
 * a PNG despite the extension: `.ico` has not meant "ICO format" for years, the
 * Content-Type is what is honoured, and `nosniff` is set globally so the
 * declared type is the only one considered.
 *
 * No content hash in this path, so it cannot claim to be immutable — a day is
 * long enough that nobody fetches it twice in a session, and short enough that a
 * new mark is not stuck in caches.
 */
router.get("/favicon.ico", (_req, res) => {
  res.setHeader("Content-Type", ASSETS.touchIcon.type);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.status(200).send(ASSETS.touchIcon.body);
});

export default router;
