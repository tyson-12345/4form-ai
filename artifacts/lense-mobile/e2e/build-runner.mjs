// Generates install-audit.mjs from audit.js.
//
// The page sandbox cannot read files, so the audit source travels as an
// embedded string. It is installed with page.addInitScript, which re-runs on
// every navigation — so `window.__audit()` stays available across the whole
// route sweep and each check costs one tiny evaluate instead of re-sending
// ~5 kB of source.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const audit = JSON.stringify(readFileSync(join(here, "audit.js"), "utf8"));

writeFileSync(
  join(here, "install-audit.mjs"),
  [
    "async (page) => {",
    "  const AUDIT = " + audit + ";",
    '  const src = "window.__audit = (" + AUDIT + ");";',
    "  await page.addInitScript(src);",
    "  await page.evaluate(src);",
    '  return "installed: window.__audit() is available and survives navigation";',
    "}",
    "",
  ].join("\n"),
);
console.log("install-audit.mjs regenerated");
