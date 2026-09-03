/**
 * The landing page, its assets, and the waitlist behind its form.
 *
 * Two things here are worth more than the rest.
 *
 * The first is the **Content-Security-Policy self-check**. The page's policy
 * pins the SHA-256 of its own `<style>` and `<script>` blocks instead of using
 * a nonce, which is what makes a 90 KB static page cacheable. The failure mode
 * of getting that wrong is invisible from the server: a 200 with correct
 * markup, rendered unstyled and inert, only in a browser. So the test hashes
 * what was actually served and asserts the policy covers it.
 *
 * The second is that **the page loads nothing from anywhere**. The design it
 * was built from pulled fonts from Google and GSAP from jsDelivr; both are gone,
 * and this is the test that keeps them gone — a re-added CDN link is a privacy
 * regression the privacy policy would then be wrong about, and a page that
 * breaks when someone else's CDN does.
 *
 * The waitlist is mocked at the `@workspace/db` boundary, as everything in this
 * suite is. What is being tested is the endpoint's contract — one row per
 * address, a second submission is not an error, and the no-JavaScript path
 * redirects rather than answering JSON — not Drizzle.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";

// ─── The database, faked at the module boundary ──────────────────────────────

/** Addresses the fake has accepted, in order. Reset before each test. */
const waitlistRows: string[] = [];

/**
 * When set, the next insert fails the way drizzle actually fails.
 *
 * `DrizzleQueryError` puts the SQL *and its bind values* in `message`, in
 * `stack`, and in own `query`/`params` properties. The bind value here is the
 * submitted email address, so the shape of this fake is the whole point of the
 * test that uses it.
 */
let insertFails = false;

class FakeDrizzleQueryError extends Error {
  query: string;
  params: unknown[];
  constructor(query: string, params: unknown[], cause: Error & { code?: string }) {
    super(`Failed query: ${query}\nparams: ${params.join(",")}`, { cause });
    this.query = query;
    this.params = params;
  }
}

/**
 * Drizzle's insert builder, as much of it as `waitlistRepository` uses:
 * `.values().onConflictDoNothing().returning()`, awaited.
 *
 * The conflict is modelled for real — a second insert of the same address
 * resolves to an empty array, exactly as Postgres would with the unique index —
 * because "a re-submission is a no-op, not an error" is the behaviour the route
 * depends on.
 */
const db = {
  insert: () => {
    let pending: { email?: string } = {};
    const self: Record<string, unknown> = {};
    for (const method of ["onConflictDoNothing", "returning"]) self[method] = () => self;
    self.values = (values: { email: string }) => {
      pending = values;
      return self;
    };
    const settle = () =>
      Promise.resolve().then(() => {
        if (insertFails) {
          const driverError = Object.assign(new Error("Connection terminated unexpectedly"), {
            code: "57P01",
          });
          throw new FakeDrizzleQueryError(
            'insert into "waitlist_signups" ("email") values ($1)',
            [pending.email ?? ""],
            driverError,
          );
        }
        const email = pending.email ?? "";
        if (waitlistRows.includes(email)) return [];
        waitlistRows.push(email);
        return [{ id: `row-${waitlistRows.length}` }];
      });
    self.then = (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
      settle().then(onFulfilled, onRejected);
    self.catch = (onRejected: (e: unknown) => unknown) => settle().catch(onRejected);
    return self;
  },
};

vi.mock("@workspace/db", () => ({
  db,
  pool: { end: async () => {} },
  // app.ts mounts every router, so each table it transitively imports has to
  // exist here or importing the app throws before a single test runs.
  waitlistSignupsTable: { email: "email", id: "id" },
  usersTable: { email: "email", id: "id" },
  athleteProfilesTable: { userId: "user_id", name: "name" },
  subscriptionsTable: { userId: "user_id" },
  passwordResetTokensTable: {
    id: "id",
    tokenHash: "token_hash",
    userId: "user_id",
    expiresAt: "expires_at",
    usedAt: "used_at",
  },
  identitiesTable: { userId: "user_id", provider: "provider", subject: "subject" },
  analysesTable: {},
  chatMessagesTable: {},
  coachingTipsTable: {},
  injuryRisksTable: {},
  progressEntriesTable: {},
  achievementsTable: {},
  userAchievementsTable: {},
}));

const { default: app } = await import("../src/app.js");
const { __resetRateLimitState } = await import("../src/lib/rateLimit.js");

beforeEach(() => {
  __resetRateLimitState();
  waitlistRows.length = 0;
  insertFails = false;
});

/** Every inline block of one kind, in document order. */
function inlineBlocks(html: string, tag: "style" | "script"): string[] {
  return [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map(
    (m) => m[1] ?? "",
  );
}

function sha256(content: string): string {
  return `'sha256-${crypto.createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

// ─── The page ────────────────────────────────────────────────────────────────

describe("the landing page", () => {
  it("serves the page at the root", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("Your technique,");
    expect(res.text).toContain("measured.");
    // The claim the whole product is built on, and the disclaimer beside it.
    expect(res.text).toContain("Same clip, same numbers, every time.");
    expect(res.text).toContain("we don&rsquo;t diagnose");
  });

  it("covers its own inline style and script with the policy that permits them", async () => {
    const res = await request(app).get("/");
    const csp = res.headers["content-security-policy"] ?? "";

    const styles = inlineBlocks(res.text, "style");
    const scripts = inlineBlocks(res.text, "script");
    expect(styles).toHaveLength(1);
    // The head script, the page's script, and the JSON-LD data block.
    expect(scripts).toHaveLength(3);

    // The assertion that matters: hash what was served, and require the policy
    // to name it. A drift between the file and the policy renders the page
    // unstyled and inert, and nothing on the server side would notice.
    for (const block of [...styles, ...scripts]) {
      expect(csp).toContain(sha256(block));
    }
  });

  it("names itself as an entity, under every spelling of the name", async () => {
    const html = (await request(app).get("/")).text;

    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(block, "the page carries no structured data").toBeDefined();

    // Parsed, not substring-matched: a trailing comma or a stray quote makes the
    // block invalid JSON, which every consumer discards in silence. A page that
    // looks right in the markup and is ignored by Google is the failure this
    // catches, and it is invisible everywhere else.
    const graph = JSON.parse(block ?? "")["@graph"] as Array<Record<string, unknown>>;
    const org = graph.find((node) => node["@type"] === "Organization");
    const site = graph.find((node) => node["@type"] === "WebSite");

    expect(org?.["name"]).toBe("4Form AI");
    expect(site?.["name"]).toBe("4Form AI");

    // The reason the block exists. "4Form AI" tokenizes into a crowded generic
    // term, so every spelling has to be claimed explicitly as the same entity.
    expect(org?.["alternateName"]).toContain("4 Form AI");
    expect(org?.["alternateName"]).toContain("4formai");

    // Absolute, and pointing at an asset this server actually serves -- a
    // relative or stale logo URL is dropped without a word.
    const logo = String(org?.["logo"]);
    expect(logo).toMatch(/^https:\/\/4formai\.com\/assets\//);
    expect((await request(app).get(new URL(logo).pathname)).status).toBe(200);
  });

  it("puts the product name in text, not only in the wordmark", async () => {
    // Every other mention is a wordmark, an sr-only span, or the footer. A
    // branded query needs the name in prose the crawler indexes as content.
    expect((await request(app).get("/")).text).toContain(
      "4Form AI tracks your joints frame by frame",
    );
  });

  it("serves robots.txt announcing the sitemap", async () => {
    const res = await request(app).get("/robots.txt");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("Sitemap: https://4formai.com/sitemap.xml");
    // Nothing is off limits. A stray Disallow here would be invisible until a
    // page quietly stopped ranking.
    expect(res.text).not.toContain("Disallow");
  });

  it("lists every public page in the sitemap, and every listed page answers", async () => {
    const res = await request(app).get("/sitemap.xml");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");

    const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? "");
    expect(locs).toEqual([
      "https://4formai.com/",
      "https://4formai.com/privacy",
      "https://4formai.com/terms",
    ]);

    // A sitemap is a set of promises. Submitting one that lists a URL returning
    // 404 or 503 is worse than submitting nothing -- it is the exact state this
    // site was in, and it is not detectable by reading the sitemap alone.
    for (const loc of locs) {
      const page = await request(app).get(new URL(loc).pathname);
      expect(page.status, `${loc} is in the sitemap`).toBe(200);
    }
  });

  it("keeps the policy closed", async () => {
    const csp = (await request(app).get("/")).headers["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("font-src 'self'");
    // The waitlist fetch, and the same form without scripting.
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // A hash-based policy that also allows unsafe-inline allows everything.
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("loads nothing from anywhere but this origin", async () => {
    const html = (await request(app).get("/")).text;

    for (const host of [
      "fonts.googleapis.com",
      "fonts.gstatic.com",
      "cdn.jsdelivr.net",
      "unpkg.com",
      "cdnjs.cloudflare.com",
      "googletagmanager.com",
    ]) {
      expect(html).not.toContain(host);
    }
    // No external script and no external stylesheet, by construction.
    expect(html).not.toMatch(/<script[^>]+\bsrc=/);
    expect(html).not.toMatch(/rel=["']stylesheet["']/);

    // An allowlist, not a denylist: every URL the page names anywhere — markup
    // attribute or stylesheet url() — has to be one this page is allowed to
    // want. A six-host denylist cannot see the seventh host.
    const named = [
      ...[...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]!),
      ...[...html.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => m[1]!),
    ];
    expect(named.length).toBeGreaterThan(5);
    for (const url of named) {
      const allowed =
        url.startsWith("/") || // our own paths, including /assets/…
        url.startsWith("#") || // in-page anchors
        url === "mailto:support@4formai.com" ||
        url === "https://4formai.com/" || // canonical and og:url, and only those
        url === "http://www.w3.org/2000/svg"; // the SVG namespace, not a fetch
      expect(allowed, `unexpected URL in the page: ${url}`).toBe(true);
    }
  });

  it("carries no style attributes, which its own policy would blank", async () => {
    // `style-src` with a hash and no `unsafe-inline` blocks inline style
    // attributes as well as style elements. One of these in the markup is a
    // silently unstyled element in a browser and a passing test everywhere else.
    expect((await request(app).get("/")).text).not.toMatch(/\sstyle="/);
  });

  it("answers a repeat visit with a 304", async () => {
    const first = await request(app).get("/");
    const etag = first.headers["etag"];
    expect(etag).toBeTruthy();

    const second = await request(app).get("/").set("If-None-Match", etag);
    expect(second.status).toBe(304);
    expect(second.text).toBeFalsy();
  });

  it("honours a client that refuses an encoding", async () => {
    // `br;q=0` is a refusal, not a mention. A substring match reads it as
    // "brotli was named" and sends bytes the client said it cannot read.
    const refused = await request(app).get("/").set("Accept-Encoding", "gzip, br;q=0");
    expect(refused.headers["content-encoding"]).toBe("gzip");

    const neither = await request(app).get("/").set("Accept-Encoding", "identity;q=1, *;q=0");
    expect(neither.headers["content-encoding"]).toBeUndefined();

    // A bare wildcard is an invitation.
    const wildcard = await request(app).get("/").set("Accept-Encoding", "*");
    expect(wildcard.headers["content-encoding"]).toBe("br");
  });

  it("compresses, and varies on how it was asked", async () => {
    const brotli = await request(app).get("/").set("Accept-Encoding", "br");
    expect(brotli.headers["content-encoding"]).toBe("br");
    expect(brotli.headers["vary"]).toContain("Accept-Encoding");

    const gzip = await request(app).get("/").set("Accept-Encoding", "gzip");
    expect(gzip.headers["content-encoding"]).toBe("gzip");

    // A different encoding is a different body, so it must be a different ETag.
    expect(brotli.headers["etag"]).not.toBe(gzip.headers["etag"]);
  });

  it("renders the three states the form can leave it in", async () => {
    // The message the script would write on a failed fetch is in the script
    // either way, so the assertion is on the rendered element, not the page.
    const rendered = (html: string) =>
      [...html.matchAll(/<p class="form__error"[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]);

    const idle = await request(app).get("/");
    expect(idle.text).not.toContain('class="is-joined"');
    expect(rendered(idle.text)).toEqual(["", ""]);

    const joined = await request(app).get("/?joined=1");
    expect(joined.status).toBe(200);
    expect(joined.text).toContain('class="is-joined"');
    expect(rendered(joined.text)).toEqual(["", ""]);

    const invalid = await request(app).get("/?email=invalid");
    expect(invalid.status).toBe(200);
    // Both forms say it, so whichever one they used is the one they are looking at.
    expect(rendered(invalid.text)).toEqual([
      "That does not look like an email address.",
      "That does not look like an email address.",
    ]);
    expect(invalid.text).not.toContain('class="is-joined"');
  });

  it("ignores a query it does not recognise", async () => {
    const res = await request(app).get("/?joined=yes&email=%3Cscript%3E&utm_source=x");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('class="is-joined"');
    expect(res.text).not.toContain("<script>alert");
  });
});

  it("hides nothing that JavaScript is not there to reveal", async () => {
    // The page's pre-animation states — opacity 0, offset transforms — are the
    // one thing that can turn a working page into a blank one. They are scoped
    // to `html.motion`, which the head script sets only when scripting is on and
    // reduced motion is not asked for. A rule that escapes that scope is a
    // section that never appears for a reader who has either turned off.
    const raw = inlineBlocks((await request(app).get("/")).text, "style")[0] ?? "";
    // Flatten at-rule preludes first. Without this the scan sees `@media (…) {`
    // as the selector of the rule inside it and skips the rule itself — so a
    // hiding rule nested in any media query was invisible to this guard.
    const css = raw.replace(/@(media|supports|layer|container)[^{]*\{/g, "");

    const offenders: string[] = [];
    // Split on rule boundaries and look at every selector that hides something.
    for (const rule of css.split("}")) {
      const [selectorPart, body] = rule.split("{");
      if (!selectorPart || !body) continue;
      const hides =
        /(^|[;\s])opacity:\s*0(\.0*)?\s*(;|$)/.test(body) ||
        /transform:\s*(translate|scale)/.test(body);
      if (!hides) continue;
      const selector = selectorPart.trim().split("\n").pop()?.trim() ?? "";
      // Keyframe stops are fine: they belong to an animation that only runs
      // under `.motion` anyway, and `.skip-link` is off-screen on purpose.
      const exempt =
        /^(from|to|\d+%)$/.test(selector) ||
        selector.startsWith("@") ||
        selector.includes(".motion") ||
        // Off-screen until focused, which is the point of it.
        selector.includes(".skip-link") ||
        // Only ever added by the script, which does not run without motion.
        selector.includes(".is-retracted") ||
        // These two hide a flag and stop a marquee; neither hides content that
        // has no other way to appear.
        selector.includes(".flag") ||
        selector.includes(".marquee");
      if (!exempt) offenders.push(selector.slice(0, 80));
    }

    expect(offenders).toEqual([]);
  });

  it("ships the standing frame's real numbers, for a reader without scripting", async () => {
    // frame(0) computes knee 176.57, hip 168.54, elbow 168.17 — and the knee is
    // outside its own 72–175 band there, which is why it ships marked. Without
    // scripting these are the only numbers anyone sees, so they have to be the
    // ones the model actually produces rather than round placeholders.
    const html = (await request(app).get("/")).text;

    expect(html).toContain('<span class="readout__value is-out" data-rv="knee">177&deg;</span>');
    expect(html).toContain('<span class="readout__value" data-rv="hip">169&deg;</span>');
    expect(html).toContain('<span class="readout__value" data-rv="elbow">168&deg;</span>');
    expect(html).toMatch(/<text id="fKneeLabel" class="figure__angle"[^>]*>177&#176;<\/text>/);
    // The band panel likewise ships its finished reading, not a zero.
    expect(html).toContain('<span class="panel__score" id="bandScore">78</span>');
    expect(html).toContain('<span class="hero__deg" id="heroDeg">142&deg;</span>');
  });

// ─── The assets ──────────────────────────────────────────────────────────────

describe("the landing page's assets", () => {
  it("serves every file the page asks for", async () => {
    const html = (await request(app).get("/")).text;
    const urls = [...new Set([...html.matchAll(/["'(](\/assets\/[^"')]+)/g)].map((m) => m[1]!))];
    // Three faces, the mark, and the Apple touch icon.
    expect(urls).toHaveLength(5);

    for (const url of urls) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(200);
      expect(res.headers["cache-control"], url).toContain("immutable");
      expect(Number(res.headers["content-length"]), url).toBeGreaterThan(0);
    }
  });

  it("names each file after its own contents, so it can be immutable", async () => {
    const html = (await request(app).get("/")).text;
    const url = [...html.matchAll(/url\("(\/assets\/[^"]+\.woff2)"\)/g)][0]?.[1];
    expect(url).toBeTruthy();

    const res = await request(app).get(url!);
    const digest = crypto.createHash("sha256").update(res.body).digest("hex").slice(0, 8);
    expect(url).toContain(digest);
    expect(res.headers["content-type"]).toContain("font/woff2");
  });

  it("answers the path browsers probe whether or not the page names one", async () => {
    const res = await request(app).get("/favicon.ico");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    // Not content-hashed, so it cannot claim to be immutable.
    expect(res.headers["cache-control"]).toContain("max-age=86400");
    expect(res.headers["cache-control"]).not.toContain("immutable");
  });

  it("does not ration the assets at the page's rate", async () => {
    // Limiters stack, and `app.use("/", …)` matches /assets too — so a wide
    // asset budget mounted under a narrow page budget is still the narrow one.
    // A cold visit costs five requests; sharing one 60/min bucket between the
    // page and its files is twelve first visits per minute for everyone behind
    // one NAT, and a refused font fails silently in fallback faces.
    const html = (await request(app).get("/")).text;
    const mark = html.match(/\/assets\/mark-[a-f0-9]+\.svg/)?.[0];
    expect(mark).toBeTruthy();

    // Spend the page budget entirely.
    for (let i = 0; i < 61; i++) await request(app).get("/");
    expect((await request(app).get("/")).status).toBe(429);

    // The files are on their own budget and are unaffected.
    expect((await request(app).get(mark!)).status).toBe(200);
    expect((await request(app).get("/favicon.ico")).status).toBe(200);
  });

  it("has no directory to walk out of", async () => {
    for (const path of [
      "/assets/../package.json",
      "/assets/nothing.woff2",
      "/assets/mark.svg", // the un-hashed name is not a route
    ]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(404);
    }
  });
});

// ─── The waitlist ────────────────────────────────────────────────────────────

describe("POST /waitlist", () => {
  it("records an address and answers the page's fetch with JSON", async () => {
    const res = await request(app)
      .post("/waitlist")
      .set("Accept", "application/json")
      .send({ email: "Athlete@Example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Stored in the same normalized form `users.email` uses, or the two tables
    // could not be compared and the same person could join twice.
    expect(waitlistRows).toEqual(["athlete@example.com"]);
  });

  it("treats a second submission as the same event", async () => {
    await request(app).post("/waitlist").set("Accept", "application/json").send({ email: "a@b.com" });
    const again = await request(app)
      .post("/waitlist")
      .set("Accept", "application/json")
      .send({ email: "a@b.com" });

    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ok: true });
    expect(waitlistRows).toEqual(["a@b.com"]);
  });

  it("rejects something that is not an address", async () => {
    const res = await request(app)
      .post("/waitlist")
      .set("Accept", "application/json")
      .send({ email: "not-an-address" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("email address");
    expect(waitlistRows).toEqual([]);
  });

  it("redirects a plain form post instead of answering JSON", async () => {
    const res = await request(app)
      .post("/waitlist")
      .type("form")
      .set("Accept", "text/html,application/xhtml+xml")
      .send({ email: "form@example.com", from: "close" });

    // Post/Redirect/Get, so a refresh cannot resubmit.
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe("/?joined=1#waitlist");
    expect(waitlistRows).toEqual(["form@example.com"]);
  });

  it("sends the hero form back to the top of the page", async () => {
    const res = await request(app)
      .post("/waitlist")
      .type("form")
      .set("Accept", "text/html")
      .send({ email: "hero@example.com", from: "hero" });

    expect(res.headers["location"]).toBe("/?joined=1");
  });

  it("will not let the form choose where the browser is sent", async () => {
    const res = await request(app)
      .post("/waitlist")
      .type("form")
      .set("Accept", "text/html")
      .send({ email: "hero@example.com", from: "https://example.net/phish" });

    // `from` selects from a fixed table; it is never the destination.
    expect(res.headers["location"]).toBe("/?joined=1");
  });

  it("returns the browser to a page that says what happened", async () => {
    const bad = await request(app)
      .post("/waitlist")
      .type("form")
      .set("Accept", "text/html")
      .send({ email: "nope", from: "hero" });

    expect(bad.status).toBe(303);
    expect(bad.headers["location"]).toBe("/?email=invalid");

    const landed = await request(app).get("/?email=invalid");
    expect(landed.text).toMatch(
      /<p class="form__error"[^>]*>That does not look like an email address\.<\/p>/,
    );
  });

  it("survives a `from` that names something on Object.prototype", async () => {
    // `RETURN_TO[from]` used to walk the prototype chain, so `constructor` was a
    // function rather than undefined, `?? "/"` did not catch it, and the
    // redirect helper threw — *after* the row was already written. The person
    // was on the list and was told it had failed.
    for (const from of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      __resetRateLimitState();
      waitlistRows.length = 0;
      const res = await request(app)
        .post("/waitlist")
        .type("form")
        .set("Accept", "text/html")
        .send({ email: "proto@example.com", from });

      expect(res.status, from).toBe(303);
      expect(res.headers["location"], from).toBe("/?joined=1");
      expect(waitlistRows, from).toEqual(["proto@example.com"]);
    }
  });

  it("does not let the address travel with a database failure", async () => {
    // The response is generic either way — the global handler sees to that — so
    // asserting on the body would prove nothing. What matters is the error
    // *object*, because that is what pino serializes into the logs and what
    // `reportError` hands to Sentry. Drizzle's own error carries the bind
    // values in `message`, in `stack`, and in `params`; the repository throws a
    // replacement so that none of it survives the boundary.
    const { addToWaitlist } = await import("../src/repositories/waitlistRepository.js");
    insertFails = true;

    const thrown = await addToWaitlist("private@example.com").then(
      () => null,
      (e: unknown) => e as Error & { code?: string; params?: unknown; query?: unknown },
    );

    expect(thrown).toBeInstanceOf(Error);
    const everything = JSON.stringify({
      message: thrown!.message,
      stack: thrown!.stack,
      ...Object.fromEntries(Object.entries(thrown!)),
    });
    expect(everything).not.toContain("private@example.com");
    expect(thrown!.params).toBeUndefined();
    expect(thrown!.query).toBeUndefined();
    // The SQLSTATE is the operational signal, and it is safe to keep.
    expect(thrown!.code).toBe("57P01");

    // And the request as a whole still fails cleanly rather than hanging.
    insertFails = true;
    const res = await request(app)
      .post("/waitlist")
      .set("Accept", "application/json")
      .send({ email: "private@example.com" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("private@example.com");
  });

  it("stops after five in a minute", async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await request(app)
        .post("/waitlist")
        .set("Accept", "application/json")
        .send({ email: `person${i}@example.com` });
      expect(ok.status).toBe(200);
    }

    const blocked = await request(app)
      .post("/waitlist")
      .set("Accept", "application/json")
      .send({ email: "person5@example.com" });

    expect(blocked.status).toBe(429);
    expect(waitlistRows).toHaveLength(5);
  });

  it("sends a refused form post back to the page, not to raw JSON", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post("/waitlist").type("form").set("Accept", "text/html")
        .send({ email: `person${i}@example.com`, from: "close" });
    }

    // Without scripting this is a navigation: JSON here becomes the page.
    const blocked = await request(app)
      .post("/waitlist")
      .type("form")
      .set("Accept", "text/html")
      .send({ email: "person5@example.com", from: "close" });

    expect(blocked.status).toBe(303);
    expect(blocked.headers["location"]).toBe("/?busy=1#waitlist");
    expect(blocked.headers["retry-after"]).toBeTruthy();

    // The page it lands on says so, in the same words the script uses.
    const landed = await request(app).get("/?busy=1");
    expect(landed.status).toBe(200);
    expect(landed.text).toMatch(
      /<p class="form__error"[^>]*>That is a lot of sign-ups from here\. Try again in a minute\.<\/p>/,
    );
  });
});

// ─── Mount order ─────────────────────────────────────────────────────────────

describe("mounting the page at the root", () => {
  it("leaves the documents, the reset page and the API untouched", async () => {
    // What this is really asserting is mount order: `/privacy` reaches the legal
    // router rather than the landing page mounted at `/`. It used to prove that
    // with a 503, which stopped being true the day the documents were finished —
    // so it now checks for the document itself. Either way the landing page must
    // not answer here.
    const privacy = await request(app).get("/privacy");
    expect(privacy.status).toBe(200);
    expect(privacy.text).toContain("Privacy Policy");
    expect(privacy.text).not.toContain("Your technique,");

    expect((await request(app).get("/reset-password?token=x")).status).toBe(200);
    expect((await request(app).get("/api/healthz")).status).toBe(200);

    const missing = await request(app).get("/definitely-not-a-page");
    expect(missing.status).toBe(404);
    expect(missing.headers["content-type"]).toMatch(/json/);
  });
});
