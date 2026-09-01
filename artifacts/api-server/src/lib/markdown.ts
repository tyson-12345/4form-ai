/**
 * A small Markdown renderer for the legal documents.
 *
 * ── Why not a library ───────────────────────────────────────────────────────
 * The input is not user content. It is two files in this repository, written by
 * us, rendered by us. A general Markdown parser is built to survive hostile
 * input from strangers; that is not the threat here, and pulling one in would
 * add a dependency, a supply-chain surface and an HTML sanitiser to the API for
 * the sake of 400 lines of prose we control.
 *
 * What this does instead is narrow and total: it supports exactly the
 * constructs `docs/PRIVACY-POLICY.md` and `docs/TERMS-OF-SERVICE.md` actually
 * use — headings, paragraphs, bullet and ordered lists, tables, blockquotes,
 * horizontal rules, bold, and inline code — and escapes everything first, so no
 * input can produce an element this file did not choose to emit. Anything it
 * does not recognise degrades to a paragraph rather than vanishing.
 *
 * Links are deliberately NOT supported. Neither document contains one, and a
 * legal page that can be made to emit an anchor is a legal page that can be
 * made to point somewhere else.
 */

/** Escape before anything else, so no source text can inject markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Bold and inline code, applied to already-escaped text. */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/**
 * Editorial notes addressed to whoever publishes the document, not to the
 * reader. Both files mark them explicitly, and both say to remove them.
 * Stripping them here rather than by hand keeps the Markdown the single source
 * of truth — a note deleted from the served page but left in the file would
 * drift, and a note left in the served page is worse.
 */
const PUBLISHING_NOTE = /delete (?:this block )?before publishing/i;

/**
 * Values the author left for a human to fill in.
 *
 * Two shapes, because the documents use two conventions:
 *
 *  - Shouted, like `[LEGAL ENTITY NAME]` or `[DATE — set when published]`.
 *  - Contact addresses, like `[privacy@yourdomain.com]` — lowercase, and
 *    therefore invisible to a capitals-only rule. Publishing one of those on a
 *    live privacy policy is exactly the failure this function exists to stop,
 *    so `yourdomain` is matched explicitly.
 *
 * Deliberately does not match ordinary bracketed prose such as
 * `[see section 4]`, which is content rather than a blank.
 */
const PLACEHOLDER = /\[(?:[A-Z][A-Z0-9 ,.—/–-]*(?:—[^\]]*)?|[^\]]*yourdomain[^\]]*)\]/g;

/**
 * Every unresolved placeholder a reader could actually see, in document order.
 *
 * Runs against the document *after* publisher notes are stripped, not the raw
 * source. Those notes say "Replace every `[BRACKETED]` value" — a placeholder
 * that is itself an instruction about placeholders. Scanning the raw text would
 * mean the documents could never publish: every blank could be filled and the
 * note would still hold them at 503, over a string no reader ever sees.
 */
export function findPlaceholders(markdown: string): string[] {
  const found = stripPublishingNotes(markdown).match(PLACEHOLDER) ?? [];
  return [...new Set(found)];
}

/**
 * Remove blockquotes addressed to whoever publishes the document.
 *
 * Shared by the renderer and the placeholder scan so the two can never disagree
 * about what the reader sees — a note stripped from the page but counted by the
 * guard blocks publication invisibly, which is worse than either alone.
 */
export function stripPublishingNotes(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    if (!(lines[i] ?? "").trim().startsWith(">")) {
      out.push(lines[i] ?? "");
      i += 1;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
      block.push(lines[i] ?? "");
      i += 1;
    }
    if (!block.some((l) => PUBLISHING_NOTE.test(l))) out.push(...block);
  }
  return out.join("\n");
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "rule" };

function splitRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      i += 1;
      continue;
    }

    if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]! });
      i += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoted: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        quoted.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i += 1;
      }
      // Publisher notes are already gone by the time parse() runs (see
      // renderMarkdown), but keep the guard: parse() is also reachable directly.
      if (!quoted.some((q) => PUBLISHING_NOTE.test(q))) {
        blocks.push({ kind: "quote", lines: quoted });
      }
      continue;
    }

    if (trimmed.startsWith("|")) {
      const raw: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        raw.push((lines[i] ?? "").trim());
        i += 1;
      }
      const head = splitRow(raw[0] ?? "");
      // Row 1 of a GFM table is the alignment rule; skip it when present.
      const bodyStart = raw[1] && /^[\s|:-]+$/.test(raw[1]) ? 2 : 1;
      const rows = raw.slice(bodyStart).map(splitRow);
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").trim().replace(/^[-*]\s+/, ""));
        i += 1;
        // Absorb continuation lines of the same item.
        while (
          i < lines.length &&
          (lines[i] ?? "").startsWith("  ") &&
          (lines[i] ?? "").trim() !== "" &&
          !/^\s*[-*]\s+/.test(lines[i] ?? "")
        ) {
          items[items.length - 1] += " " + (lines[i] ?? "").trim();
          i += 1;
        }
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").trim().replace(/^\d+\.\s+/, ""));
        i += 1;
        while (
          i < lines.length &&
          (lines[i] ?? "").startsWith("  ") &&
          (lines[i] ?? "").trim() !== "" &&
          !/^\s*\d+\.\s+/.test(lines[i] ?? "")
        ) {
          items[items.length - 1] += " " + (lines[i] ?? "").trim();
          i += 1;
        }
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Anything else is a paragraph, running until a blank line or a construct.
    const para: string[] = [];
    while (i < lines.length) {
      const l = (lines[i] ?? "").trim();
      if (
        l === "" ||
        l.startsWith(">") ||
        l.startsWith("|") ||
        /^#{1,6}\s/.test(l) ||
        /^[-*]\s+/.test(l) ||
        /^\d+\.\s+/.test(l) ||
        /^-{3,}$/.test(l)
      ) {
        break;
      }
      para.push(l);
      i += 1;
    }
    blocks.push({ kind: "para", text: para.join(" ") });
  }

  return blocks;
}

/** Render the supported subset to HTML. Everything is escaped first. */
export function renderMarkdown(markdown: string): string {
  const out: string[] = [];

  for (const b of parse(stripPublishingNotes(markdown))) {
    switch (b.kind) {
      case "rule":
        out.push("<hr>");
        break;
      case "heading": {
        const level = Math.min(b.level, 6);
        out.push(`<h${level}>${inline(escapeHtml(b.text))}</h${level}>`);
        break;
      }
      case "para":
        out.push(`<p>${inline(escapeHtml(b.text))}</p>`);
        break;
      case "ul":
        out.push(`<ul>${b.items.map((t) => `<li>${inline(escapeHtml(t))}</li>`).join("")}</ul>`);
        break;
      case "ol":
        out.push(`<ol>${b.items.map((t) => `<li>${inline(escapeHtml(t))}</li>`).join("")}</ol>`);
        break;
      case "quote":
        out.push(
          `<blockquote>${b.lines
            .filter((l) => l.trim() !== "")
            .map((l) => `<p>${inline(escapeHtml(l))}</p>`)
            .join("")}</blockquote>`,
        );
        break;
      case "table": {
        const head = b.head.map((c) => `<th>${inline(escapeHtml(c))}</th>`).join("");
        const body = b.rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(escapeHtml(c))}</td>`).join("")}</tr>`)
          .join("");
        out.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
        break;
      }
    }
  }

  return out.join("\n");
}
