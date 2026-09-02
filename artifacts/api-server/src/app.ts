import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import landingPageRouter from "./routes/landingPage.js";
import legalPagesRouter from "./routes/legalPages.js";
import resetPageRouter from "./routes/resetPage";
import waitlistRouter, { wantsJson } from "./routes/waitlist.js";
import { logger } from "./lib/logger";
import { rateLimit } from "./lib/rateLimit";
import { recordAlert } from "./lib/alerting";
import { reportError } from "./lib/observability";

const app: Express = express();

// ── Fingerprinting ────────────────────────────────────────────────────────────
// Express advertises itself in `X-Powered-By` by default. That is free
// reconnaissance: it tells a scanner which stack to try known CVEs against, and
// it buys us nothing. Not a vulnerability on its own — just an unnecessary hint.
app.disable("x-powered-by");

// ── Proxy trust ───────────────────────────────────────────────────────────────
// Rate limiting keys on the client IP, so how we derive that IP is a security
// control, not a config detail. `X-Forwarded-For` is caller-supplied: trusting
// it unconditionally lets anyone bypass every limit by rotating the header.
//
// Set TRUST_PROXY to the number of proxies in front of this server (Fly/Render/
// nginx = 1). Leave it unset when the server is directly exposed.
const trustProxy = process.env.TRUST_PROXY;
app.set("trust proxy", trustProxy ? Number(trustProxy) : false);
if (process.env.NODE_ENV === "production" && !trustProxy) {
  logger.warn(
    "TRUST_PROXY is not set. If this server runs behind a load balancer, every " +
      "request will appear to come from the proxy and rate limits will apply globally.",
  );
}

// ── Security headers ──────────────────────────────────────────────────────────
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  // This API serves JSON only — no scripts, styles, frames, or embeds.
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  // Do not let API responses linger in shared caches.
  res.setHeader("Cache-Control", "no-store");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // X-XSS-Protection is deliberately omitted: it is deprecated and its legacy
  // filter introduced vulnerabilities. CSP above is the real control.
  next();
});

app.use(
  pinoHttp({
    logger,
    // Never log request bodies — they carry passwords and reset tokens.
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
const configuredOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : ["http://localhost:8081", "http://localhost:19006", "exp://localhost:8081"];

/**
 * Our own public origin, from configuration.
 *
 * The API serves HTML pages that talk back to it — the password-reset page
 * posts a new password, the landing page posts a waitlist address, and the
 * landing page's stylesheet loads three fonts. Browsers attach an `Origin`
 * header to all of those even though they are same-origin, so without an
 * exemption the server rejects requests from its own pages. That is exactly
 * what happened on the first real password reset: `cors_rejected`, then a 500,
 * and the user saw "Something went wrong."
 *
 * Derived from APP_PUBLIC_URL rather than hard-coded, so it stays correct when
 * the deployment moves to a custom domain.
 */
const selfOrigin = (() => {
  const raw = process.env.APP_PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    logger.warn(
      { event: "app_public_url_invalid" },
      "APP_PUBLIC_URL is not a valid URL; same-origin requests fall back to the Host header",
    );
    return null;
  }
})();

const allowedOrigins = selfOrigin
  ? [...new Set([...configuredOrigins, selfOrigin])]
  : configuredOrigins;

/**
 * The origin this very request was addressed to.
 *
 * APP_PUBLIC_URL is a good default but it is one string, and the server answers
 * on more than one name: the Railway hostname as well as the custom domain, and
 * `localhost:PORT` in development. When a page served on one of those loads a
 * font or posts its own form, the browser sends that name as the `Origin`, and
 * matching it against a single configured value fails — which is how the
 * landing page's own self-hosted fonts came back 403 the first time it was run.
 *
 * A request whose `Origin` equals its own `Host` is same-origin by definition,
 * and allowing it grants nothing: the page making it is a page we served. Both
 * halves come from the same request, so a caller forging them is only fooling
 * itself — a real browser sends the true `Host`, and a non-browser client was
 * never bound by CORS in the first place.
 *
 * `req.protocol` honours `X-Forwarded-Proto` under the `trust proxy` setting
 * above, so this is `https://…` behind the load balancer and `http://…` locally.
 */
function isSameOrigin(req: Request, origin: string): boolean {
  const host = req.get("host");
  return host !== undefined && origin === `${req.protocol}://${host}`;
}

app.use(
  cors((req: Request, done) => {
    const origin = req.headers.origin;

    // Native apps and curl send no Origin header; there is no browser
    // same-origin policy to enforce for them.
    const allowed =
      !origin ||
      allowedOrigins.includes(origin) ||
      isSameOrigin(req, origin) ||
      // Previously any origin was allowed whenever NODE_ENV !== "production",
      // which meant an unset NODE_ENV (the common case) disabled CORS entirely.
      // Dev now requires an explicit opt-in.
      (process.env.NODE_ENV === "development" && process.env.CORS_ALLOW_ALL === "true");

    if (allowed) {
      done(null, { origin: true, credentials: true });
      return;
    }

    recordAlert("cors_rejected");
    logger.warn({ origin, event: "cors_rejected" }, "Blocked cross-origin request");
    // Tagged 403 so the error handler does not report a policy decision as a
    // server fault. Previously this surfaced as a 500 "Something went wrong",
    // which sent us looking for a bug in the reset route when the actual
    // problem was the allowlist.
    const err = new Error("Not allowed by CORS") as Error & { status?: number };
    err.status = 403;
    done(err);
  }),
);

// Bodies are small JSON documents. Videos are never uploaded through this API.
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "256kb" }));

// ── Rate limits ───────────────────────────────────────────────────────────────
// Ordered most-specific first; Express runs every matching middleware, so the
// broad /api limiter still applies on top of each targeted one.

// Credential-guessing surface.
app.use("/api/auth/login", rateLimit({ name: "auth-login", max: 10 }));
app.use("/api/auth/signup", rateLimit({ name: "auth-signup", max: 5 }));
app.use("/api/auth/forgot-password", rateLimit({ name: "auth-forgot", max: 3 }));
app.use("/api/auth/reset-password", rateLimit({ name: "auth-reset", max: 5 }));

// Federated sign-in. `/link` checks a password, so it gets the login budget —
// otherwise it would be a cheaper endpoint to guess against than /auth/login,
// and attackers would simply move here. `/providers` is a cheap read the app
// makes once on launch, so it is mounted first with a wider budget rather than
// inheriting the tight one below.
app.use("/api/auth/oauth/providers", rateLimit({ name: "auth-oauth-providers", max: 30 }));
app.use("/api/auth/oauth/link", rateLimit({ name: "auth-oauth-link", max: 10 }));
app.use("/api/auth/oauth/complete", rateLimit({ name: "auth-oauth-complete", max: 5 }));
// Each attempt costs an outbound JWKS lookup on a cold cache.
app.use("/api/auth/oauth", rateLimit({ name: "auth-oauth", max: 15 }));

app.use("/api/auth", rateLimit({ name: "auth", max: 20 }));

// Endpoints that cost us money on every call (Claude inference).
app.use("/api/chat", rateLimit({ name: "chat", max: 20 }));
app.use("/api/analyses", rateLimit({ name: "analyses", max: 20 }));

// Catch-all for everything else under /api.
app.use("/api", rateLimit({ name: "global", max: 120 }));

app.use("/api", router);

// ── Password reset landing page ───────────────────────────────────────────────
// Mounted at the root, not under /api: this is a page a person opens from an
// email, and it needs its own rate limit and its own CSP. Without it the link
// in the reset email lands on a JSON 404 — the mail sends, the token is valid,
// and the user hits a dead end.
//
// A lower limit than /api because a human opening a link does it once or twice,
// and this route is reachable without authentication.
app.use("/reset-password", rateLimit({ name: "reset-page", max: 20 }));
app.use(resetPageRouter);

// ── Public pages ──────────────────────────────────────────────────────────────
// The landing page, its assets, the waitlist form's target, and the two legal
// documents. Mounted at the root for the same reason as the reset page: they are
// opened by people, not by the app. Both stores fetch the privacy URL during
// review, so a 404 here is a rejection.
//
// The waitlist limiter is first and much tighter than the page limiter, which it
// stacks with: it is an unauthenticated write, and a person joining a waitlist
// does it once. The budget is per IP, not per address — five a minute leaves
// room for a fat-fingered retry and for a couple of people behind one office
// NAT, and not much else.
//
// A refused form post must not answer JSON. Without scripting the browser is
// *navigating*, so `{"error":"Too many requests…"}` becomes the page — the
// same dead end the reset page exists to prevent. It goes back to the landing
// page instead, which has a state that says so in the reader's own words.
app.use(
  "/waitlist",
  rateLimit({
    name: "waitlist",
    max: 5,
    onLimited(req, res) {
      if (wantsJson(req.get("accept"), req.get("content-type"))) {
        res.status(429).json({ error: "Too many requests. Please slow down." });
        return;
      }
      res.redirect(303, "/?busy=1#waitlist");
    },
  }),
);

// The page's own files, which are static, content-addressed and immutable, and
// so are not worth rationing at the rate the HTML is. A cold visit costs five
// requests — the page, three faces and the mark — so one 60/min bucket shared
// between them is twelve first visits per IP per minute, and a shared egress
// (carrier CGNAT, an office, a campus) is one IP for everybody behind it. The
// failure was silent, too: a refused font renders the page in fallback faces
// with nothing to say why.
//
// The exemption below is the part that makes this work. Limiters *stack* — the
// comment at the top of this section says so — and `app.use("/", …)` matches
// `/assets` as well, so a wide asset budget mounted under a narrow page budget
// is still the narrow one. The page limiter has to step aside for the paths
// that carry their own.
const publicAssets = rateLimit({ name: "public-assets", max: 600 });
const publicPages = rateLimit({ name: "public-pages", max: 60 });

app.use((req: Request, res: Response, next: NextFunction) => {
  const isAsset = req.path.startsWith("/assets/") || req.path === "/favicon.ico";
  (isAsset ? publicAssets : publicPages)(req, res, next);
});
app.use(landingPageRouter);
app.use(waitlistRouter);
app.use(legalPagesRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: number }).status ?? 500;

  // Log the full error server-side; return only a generic message. Error text
  // routinely contains connection strings, file paths, and SQL fragments.
  logger.error(
    { err, path: req.path, method: req.method, status, event: "unhandled_error" },
    "Request failed",
  );

  // Report anything that is our fault. 4xx are the caller's problem and would
  // otherwise bury real bugs under validation noise. No-op without SENTRY_DSN.
  if (status >= 500) {
    reportError(err, { path: req.path, method: req.method, status });
  }

  if (res.headersSent) return;

  res
    .status(status)
    .json({ error: status === 400 ? "Invalid request." : "Something went wrong. Please try again." });
});

export default app;
