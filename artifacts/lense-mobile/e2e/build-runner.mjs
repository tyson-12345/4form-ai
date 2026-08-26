// Generates install-audit.mjs from audit.js.
//
// The page sandbox cannot read files, so the audit source travels as an
// embedded string. It is installed with page.addInitScript, which re-runs on
// every navigation — so the harness stays available across the whole route
// sweep and each check costs one tiny evaluate instead of re-sending the source.
//
// audit.js is an object literal of entry points rather than a single function,
// because reachability has to await a scroll and a repaint while the static
// checks must stay synchronous. `window.__audit()` is kept as an alias for the
// static pass so existing call sites and the README's one-liner still work.
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
    '  const src = "window.__ui = (" + AUDIT + "); window.__audit = () => window.__ui.audit();";',
    "  await page.addInitScript(src);",
    "  await page.evaluate(src);",
    '  return "installed: window.__ui.audit() / .scroll() / .focus() available, survives navigation";',
    "}",
    "",
  ].join("\n"),
);
console.log("install-audit.mjs regenerated");
