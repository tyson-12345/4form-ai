/**
 * The public pages, and the guard that stops an unfinished one from shipping.
 *
 * Two things are being protected here, and they fail in opposite directions.
 *
 * The renderer turns our own Markdown into HTML, so the risk is not a hostile
 * author — it is that a construct renders wrong and a legal document says
 * something other than what was written. Escaping is asserted anyway, because
 * "the input is trusted" is exactly the assumption that stops being true later.
 *
 * The guard is the more important half. Both documents ship with `[BRACKETED]`
 * values for a human to fill and with editorial notes marked "delete before
 * publishing". Serving either is worse than serving nothing: a privacy policy
 * naming the wrong collector is enforceable against us, and a visible "delete
 * before publishing" tells a store reviewer the document is a draft. So the
 * test that matters most is the one asserting we refuse.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";

import app from "../src/app.js";
import { findPlaceholders, renderMarkdown } from "../src/lib/markdown.js";

describe("renderMarkdown", () => {
  it("renders the constructs the legal documents actually use", () => {
    const html = renderMarkdown(
      [
        "# Title",
        "",
        "A paragraph with **bold** and `code`.",
        "",
        "- first",
        "- second",
        "",
        "1. one",
        "2. two",
        "",
        "| Data | Why |",
        "| --- | --- |",
        "| Email | Sign-in |",
        "",
        "---",
      ].join("\n"),
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<th>Data</th>");
    expect(html).toContain("<td>Email</td>");
    expect(html).toContain("<hr>");
    // The alignment row is syntax, not content.
    expect(html).not.toContain("---</td>");
  });

  it("escapes markup in the source rather than emitting it", () => {
    const html = renderMarkdown("A <script>alert(1)</script> line.");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never emits an anchor, because neither document has a link to emit", () => {
    const html = renderMarkdown("See [our policy](https://elsewhere.example/evil).");
    expect(html).not.toContain("<a ");
    expect(html).toContain("https://elsewhere.example/evil");
  });

  it("drops blockquotes addressed to the publisher", () => {
    const html = renderMarkdown(
      [
        "> **Publishing note (delete this block before publishing).**",
        "> Replace every bracketed value.",
        "",
        "Real content.",
      ].join("\n"),
    );
    expect(html).not.toContain("Replace every bracketed value");
    expect(html).not.toContain("blockquote");
    expect(html).toContain("Real content.");
  });

  it("keeps blockquotes meant for the reader", () => {
    const html = renderMarkdown("> This is a summary for you, the reader.");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("summary for you");
  });
});

describe("findPlaceholders", () => {
  it("finds the values a human still has to fill in", () => {
    const found = findPlaceholders(
      "Operated by [LEGAL ENTITY NAME] at [ADDRESS], governed by [JURISDICTION].",
    );
    expect(found).toEqual(["[LEGAL ENTITY NAME]", "[ADDRESS]", "[JURISDICTION]"]);
  });

  it("does not mistake ordinary bracketed prose for a placeholder", () => {
    expect(findPlaceholders("we retain it [see section 4] for a year")).toEqual([]);
  });

  it("reports each distinct placeholder once", () => {
    expect(findPlaceholders("[ADDRESS] and again [ADDRESS]")).toEqual(["[ADDRESS]"]);
  });
});

describe("public pages", () => {
  it("serves a landing page at the root", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("Your technique, measured.");
  });

  it("locks the pages down to their own inline styles", async () => {
    const res = await request(app).get("/");
    const csp = res.headers["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/style-src 'nonce-[^']+'/);
    // No scripts at all: these pages are prose.
    expect(csp).not.toContain("script-src");
  });

  it.each([
    ["/privacy", "Privacy Policy"],
    ["/terms", "Terms of Service"],
  ])("refuses to publish %s while it still has blanks", async (path, title) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(503);
    expect(res.text).toContain(title);
    expect(res.text).toContain("not published yet");
  });

  it.each(["/privacy", "/terms"])("never leaks a placeholder or a draft note via %s", async (path) => {
    const res = await request(app).get(path);
    expect(res.text).not.toMatch(/\[[A-Z][A-Z ]+\]/);
    expect(res.text.toLowerCase()).not.toContain("before publishing");
  });

  it("leaves the reset page and the API untouched", async () => {
    expect((await request(app).get("/reset-password?token=x")).status).toBe(200);
    expect((await request(app).get("/api/healthz")).status).toBe(200);
    // An unknown path is still a JSON 404, not the landing page.
    const missing = await request(app).get("/definitely-not-a-page");
    expect(missing.status).toBe(404);
    expect(missing.headers["content-type"]).toMatch(/json/);
  });
});
