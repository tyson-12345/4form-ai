import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import resetPageRouter from "./routes/resetPage";
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
 * Our own public origin, always allowed.
 *
 * The API serves one HTML page — the password-reset landing page — and that page
 * fetches this API. Browsers attach an `Origin` header to that request even
 * though it is same-origin, so without this the server rejects a request from
 * its own page. That is exactly what happened on the first real password reset:
 * `cors_rejected`, then a 500, and the user saw "Something went wrong."
 *
 * Derived from APP_PUBLIC_URL rather than hard-coded, so it stays correct when
 * the deployment moves to a custom domain. Same-origin is not a cross-origin
 * risk by definition — this grants nothing that the page could not already do.
 */
const selfOrigin = (() => {
  const raw = process.env.APP_PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    logger.warn(
      { event: "app_public_url_invalid" },
      "APP_PUBLIC_URL is not a valid URL; the reset page will be blocked by CORS",
    );
    return null;
  }
})();

const allowedOrigins = selfOrigin
  ? [...new Set([...configuredOrigins, selfOrigin])]
  : configuredOrigins;

app.use(
  cors({
    origin(origin, callback) {
      // Native apps and curl send no Origin header; there is no browser
      // same-origin policy to enforce for them.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Previously any origin was allowed whenever NODE_ENV !== "production",
      // which meant an unset NODE_ENV (the common case) disabled CORS entirely.
      // Dev now requires an explicit opt-in.
      if (process.env.NODE_ENV === "development" && process.env.CORS_ALLOW_ALL === "true") {
        return callback(null, true);
      }
      recordAlert("cors_rejected");
      logger.warn({ origin, event: "cors_rejected" }, "Blocked cross-origin request");
      // Tagged 403 so the error handler does not report a policy decision as a
      // server fault. Previously this surfaced as a 500 "Something went wrong",
      // which sent us looking for a bug in the reset route when the actual
      // problem was the allowlist.
      const err = new Error("Not allowed by CORS") as Error & { status?: number };
      err.status = 403;
      return callback(err);
    },
    credentials: true,
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
