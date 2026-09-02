import { defineConfig } from "vitest/config";

import { readFileSync } from "node:fs";

/**
 * Mirror `build.mjs`'s loaders, so the suite parses what production ships.
 *
 * Without these Vite tries to read the landing page as JavaScript and the suite
 * cannot even import `app.ts`. The mirroring is the point: `build.mjs`,
 * `src/types/assets.d.ts` and this file are three statements of the same fact,
 * and a disagreement between them is a test that passes over a build that does
 * not work.
 *
 * `enforce: "pre"` matters: this has to run before vite:import-analysis, which
 * is what reports the syntax error.
 */
const textAsString = {
  name: "text-as-string",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!/\.(md|html)$/.test(id.split("?")[0] ?? "")) return null;
    return { code: `export default ${JSON.stringify(code)};`, map: null };
  },
};

/**
 * `.woff2` and `.png` need a `load` hook, not a `transform`.
 *
 * Both extensions are in Vite's own asset list, so `vite:asset` claims them and
 * returns a URL string before any transform sees the file. Loading it here,
 * first, is the only way to get esbuild's `base64` behaviour.
 */
const binaryAsBase64 = {
  name: "binary-as-base64",
  enforce: "pre" as const,
  load(id: string) {
    const file = id.split("?")[0] ?? "";
    if (!/\.(woff2|png)$/.test(file)) return null;
    return `export default ${JSON.stringify(readFileSync(file).toString("base64"))};`;
  },
};

export default defineConfig({
  plugins: [textAsString, binaryAsBase64],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Every test file that touches lib/auth.ts needs these at import time —
    // that module deliberately throws on a missing or short JWT_SECRET.
    setupFiles: ["./test/setup.ts"],

    /**
     * Well above vitest's 5s default, because a large part of this suite is
     * bcrypt at cost 12 — which is slow *on purpose*. `lib/auth.ts` also
     * computes a dummy hash at module load, so merely importing anything that
     * transitively pulls in auth costs a full hash before a single assertion
     * runs.
     *
     * At 5s this passes on an idle machine and fails on a busy one. That was
     * observed directly: five tests timed out while an iOS build was running,
     * with no assertion failures among them — the kind of flake that trains
     * people to re-run CI instead of reading it.
     *
     * The lockout tests are slower still: they perform five sequential failed
     * logins, each with a real bcrypt comparison and a progressive delay that
     * doubles to a 4s cap.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/routes/**/*.ts", "src/middlewares/**/*.ts"],
      exclude: ["**/*.test.ts"],
    },
  },
  resolve: {
    // Source uses NodeNext-style ".js" specifiers for local TS files; map them
    // back to the real .ts on disk so vitest can resolve them.
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: "$1" }],
  },
});
