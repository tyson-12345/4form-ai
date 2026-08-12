import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
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
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : ["http://localhost:8081", "http://localhost:19006", "exp://localhost:8081"];

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
      return callback(new Error("Not allowed by CORS"));
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
app.use("/api/auth", rateLimit({ name: "auth", max: 20 }));

// Endpoints that cost us money on every call (Claude inference).
app.use("/api/chat", rateLimit({ name: "chat", max: 20 }));
app.use("/api/analyses", rateLimit({ name: "analyses", max: 20 }));

// Catch-all for everything else under /api.
app.use("/api", rateLimit({ name: "global", max: 120 }));

app.use("/api", router);

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
