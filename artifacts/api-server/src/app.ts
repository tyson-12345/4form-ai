import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import landingPageRouter from "./routes/landingPage.js";
import legalPagesRouter from "./routes/legalPages.js";
import mediapipeRouter from "./routes/mediapipe.js";
import resetPageRouter from "./routes/resetPage";
import waitlistRouter, { wantsJson } from "./routes/waitlist.js";
import { logger } from "./lib/logger";
import { rateLimit, clientIp } from "./lib/rateLimit";
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

/**
 * The allowlist decision, extracted so the limiter below can ask the same
 * question the `cors` callback does without a second copy of the rules.
 */
function isOriginAllowed(req: Request, origin: string | undefined): boolean {
  return (
    /**
     * The pose runtime is readable from any origin, including `null`.
     *
     * The WebView that loads it is a `file://` document, and its `<script>` tag
     * carries `crossorigin="anonymous"` — which it must, because an `integrity`
     * attribute on a cross-origin script is ignored without it. A `file://`
     * document with that attribute sends `Origin: null`, which matches nothing
     * in the allowlist and is not same-origin with anything, so every one of
     * these requests was refused with a 403 the moment they stopped coming from
     * a CDN. Caught by sending `Origin: null` at the route before deploying;
     * the symptom in production would have been the analysis engine failing to
     * start, on every device, with a CORS rejection in a log nobody reads.
     *
     * Exempting them grants nothing. These are 22 MB of public third-party
     * vendor bytes, identical to what the CDN served to anyone who asked, behind
     * no authentication and carrying no user data — there is nothing here for a
     * cross-origin reader to steal. The exemption is scoped to that one path
     * prefix, so the rest of the API keeps the allowlist exactly as it was.
     *
     * Note this is *not* the same as adding `"null"` to `allowedOrigins`, which
     * would let any sandboxed or `file://` context call the authenticated API.
     */
    req.path.startsWith("/assets/mediapipe/") ||
    // Native apps and curl send no Origin header; there is no browser
    // same-origin policy to enforce for them.
    !origin ||
    allowedOrigins.includes(origin) ||
    isSameOrigin(req, origin) ||
    // Previously any origin was allowed whenever NODE_ENV !== "production",
    // which meant an unset NODE_ENV (the common case) disabled CORS entirely.
    // Dev now requires an explicit opt-in.
    (process.env.NODE_ENV === "development" && process.env.CORS_ALLOW_ALL === "true")
  );
}

/**
 * Rejected origins are rate limited, and this has to run *before* `cors`.
 *
 * A rejected origin takes `done(err)`, which goes straight to the error handler
 * — past every limiter, all of which are mounted below. So a request carrying
 * `Origin: https://evil.example` cost the sender nothing, consumed no bucket,
 * and still incremented the `cors_rejected` counter on its way through. A
 * hundred of them, needing no account and no valid path, used to pin
 * `/api/health/metrics` to "degraded" for the life of the process (the counters
 * are windowed now, but the free request path was the other half of it).
 *
 * Only requests that would be *refused* are charged. A same-origin or allowlisted
 * request never reaches the limiter, so nothing legitimate is rationed twice.
 */
const rejectedOriginLimit = rateLimit({ name: "cors-rejected", max: 30 });

app.use((req: Request, res: Response, next: NextFunction) => {
  if (isOriginAllowed(req, req.headers.origin)) {
    next();
    return;
  }
  rejectedOriginLimit(req, res, next);
});

app.use(
  cors((req: Request, done) => {
    const origin = req.headers.origin;
    const allowed = isOriginAllowed(req, origin);

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

/**
 * Body-parser failures, handled here rather than falling through.
 *
 * ── Why this is not left to the global error handler ────────────────────────
 * A parse failure calls `next(err)`, and Express then skips every remaining
 * three-arity middleware to reach the first four-arity one. The rate limiters
 * are all three-arity and all mounted below this line, so a request with a
 * deliberately malformed body used to reach the error handler having consumed
 * **no bucket at all** — an unlimited, uncounted, unauthenticated request path
 * on every route in the app, available to anyone willing to send `{`.
 *
 * Being first and four-arity, this catches those before they can skip anything,
 * and charges them to a bucket of their own. Well-formed bodies never come
 * through here, so the normal path is untouched.
 *
 * ── And why the error is not passed on ──────────────────────────────────────
 * body-parser attaches the entire raw body to the error it raises, as
 * `err.body`. The global handler logs the error object wholesale, so a failed
 * parse of a login request wrote the plaintext password into the log — with
 * `app.use(pinoHttp(...))` above carrying the comment "Never log request
 * bodies — they carry passwords and reset tokens". The body is dropped here,
 * before anything can serialize it.
 */
const malformedBodyLimit = rateLimit({ name: "malformed-body", max: 20 });

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  const type = (err as { type?: string }).type;
  const isBodyError =
    typeof type === "string" &&
    ["entity.parse.failed", "entity.too.large", "encoding.unsupported", "request.aborted"].includes(
      type,
    );

  if (!isBodyError) {
    next(err);
    return;
  }

  // Drop the raw body before this error can be logged or reported.
  delete (err as { body?: unknown }).body;

  logger.warn(
    { type, ip: clientIp(req), path: req.path, event: "malformed_body" },
    "Rejected a request whose body could not be parsed",
  );

  malformedBodyLimit(req, res, () => {
    res.status(400).json({ error: "Invalid request." });
  });
});

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

// Account deletion checks a password, so it is a credential endpoint and needs a
// credential endpoint's budget. It is authenticated, but a session token is
// exactly what an attacker with a stolen phone has, and without this the only
// bound on guessing here was the 120/min catch-all — twelve times the login
// route's. The handler now also runs the shared lockout path, so this is the
// volumetric half of the same control.
app.use("/api/profile/account", rateLimit({ name: "account-delete", max: 5 }));

// Endpoints that cost us money on every call (Claude inference).
//
// These ration per *account*, not per IP. Every athlete on a gym's wifi, in an
// office, or behind carrier NAT shares one address, so an IP-keyed budget means
// one heavy user throttles strangers and an individual's real limit depends on
// who else is on their carrier. It is also the weaker control once a session
// exists: a token holder can rotate IPs and cannot rotate their account.
// Unauthenticated callers still fall back to the IP.
app.use("/api/chat", rateLimit({ name: "chat", max: 20, keyBy: "account" }));
// The write path is the one that costs a Claude call, so it keeps the tight
// budget — and it is now the only thing in that bucket. Reads used to share it,
// and the app's own analysis screen could not survive that: [id].tsx polls a
// pending write-up every 3s for its first 20 polls, which is 20 GETs in the
// first minute on top of the POST that started it, the detail and history GETs
// on first focus, and the usage GET the analyze tab fetches before recording.
// The 21st request landed at ~51s and the screen 429'd itself — and a 429 there
// is not a stale poll, it flips the screen to its "couldn't load" error state,
// whose "Try again" button fires straight back into the exhausted bucket.
//
// `app.post`, not `app.use`: `use` matches by prefix and would catch the reads
// again.
app.post("/api/analyses", rateLimit({ name: "analyses-create", max: 5, keyBy: "account" }));
app.use("/api/analyses", rateLimit({ name: "analyses-read", max: 90, keyBy: "account" }));

// Catch-all for everything else under /api. Account-keyed for the same reason,
// falling back to the IP for anything unauthenticated — which is most of what
// this one actually catches.
app.use("/api", rateLimit({ name: "global", max: 120, keyBy: "account" }));

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
// The pose runtime. Mounted with the other root-served files and above the
// landing page router so its `/assets/:file` handler does not see these names
// first and 404 them. It is under `/assets/`, so the wide asset budget applies:
// a cold pose session is nine requests, and the app is the only caller.
app.use(mediapipeRouter);
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
