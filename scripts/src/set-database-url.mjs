#!/usr/bin/env node
/**
 * Set DATABASE_URL in artifacts/api-server/.env without opening the file.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `.env` is a dotfile, so Finder and most editor file-pickers hide it, and
 * editing it by hand is the step where connection strings pick up stray
 * quotes, line breaks, and leftover [PLACEHOLDER] brackets.
 *
 * This asks for the string, checks its shape, and rewrites exactly that one
 * line. Everything else in the file is preserved, and the previous value is
 * backed up so a bad paste is recoverable.
 *
 * ── On secrecy ──────────────────────────────────────────────────────────────
 * Input is read with echo disabled, so the connection string does not appear on
 * screen, does not enter shell history, and is not passed as an argument (which
 * would be visible in `ps`). Nothing is printed back except the host.
 *
 *   node scripts/src/set-database-url.mjs
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(here, "../../artifacts/api-server/.env");

/** Read a line with the terminal echo turned off. */
function askSecret(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = (char) => {
      // Redraw the prompt without the typed characters.
      if (["\n", "\r", ""].includes(char.toString())) {
        process.stdin.removeListener("data", onData);
      } else {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(prompt);
      }
    };
    process.stdin.on("data", onData);
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

/** The same checks the verifier runs, applied before anything is written. */
function problemsWith(url) {
  const out = [];
  if (!url) out.push("nothing was entered");
  if (url && !/^postgresql:\/\//.test(url)) {
    out.push(`does not start with postgresql:// (got "${url.slice(0, 12)}…")`);
  }
  if (/^["']|["']$/.test(url)) out.push("is wrapped in quotes — paste it without them");
  if (/\[|\]/.test(url)) out.push("still contains [SQUARE BRACKETS] — remove them along with the placeholder");
  if (/YOUR-PASSWORD/i.test(url)) out.push("still contains the literal text YOUR-PASSWORD");
  if (/\s/.test(url)) out.push("contains a space or line break");
  if (/:6543\//.test(url)) {
    out.push("uses port 6543 (transaction pooler) — use the session pooler on 5432");
  }
  if ((url.match(/@/g) ?? []).length > 1) {
    out.push(
      "has more than one @ — percent-encode the special character in your password " +
        "(@ = %40, : = %3A, / = %2F, # = %23), or reset it to letters and numbers only",
    );
  }
  return out;
}

async function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(`No .env found at ${ENV_PATH}`);
    console.error("Copy .env.example to .env first.");
    process.exit(1);
  }

  console.log("Set DATABASE_URL");
  console.log("────────────────");
  console.log("Supabase → Connect → Session pooler (port 5432).");
  console.log("Paste the string with your real password in place of [YOUR-PASSWORD].");
  console.log("Input is hidden.\n");

  const url = await askSecret("Connection string: ");

  const problems = problemsWith(url);
  if (problems.length > 0) {
    console.error("\nThat string has a problem:\n");
    for (const p of problems) console.error(`  • ${p}`);
    console.error("\nNothing was changed. Fix it and run this again.");
    process.exit(1);
  }

  const original = fs.readFileSync(ENV_PATH, "utf8");

  // Keep a copy of the old value. This is the undo for a bad paste, and while
  // Supabase is being set up it is also the only remaining pointer at Neon.
  const backup = `${ENV_PATH}.backup`;
  fs.writeFileSync(backup, original, { mode: 0o600 });

  const line = `DATABASE_URL=${url}`;
  const updated = /^DATABASE_URL=.*$/m.test(original)
    ? original.replace(/^DATABASE_URL=.*$/m, line)
    : `${original.replace(/\n*$/, "")}\n${line}\n`;

  fs.writeFileSync(ENV_PATH, updated, { mode: 0o600 });

  const host = url.replace(/^.*@/, "").replace(/\/.*$/, "");
  console.log("\n✓ DATABASE_URL updated");
  console.log(`  Host: ${host}`);
  if (/supabase/i.test(host)) console.log("  Provider: Supabase");
  console.log(`  Previous value backed up to ${path.basename(backup)}`);
  console.log("\nNext:");
  console.log("  pnpm --filter @workspace/scripts run verify-database");
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
