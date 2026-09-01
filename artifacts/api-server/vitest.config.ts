import { defineConfig } from "vitest/config";

/**
 * Load `.md` as a string, mirroring esbuild's `loader: { ".md": "text" }` in
 * build.mjs. The legal pages import the documents directly, so without this the
 * suite cannot even parse them — Vite tries to read the Markdown as JavaScript.
 *
 * `enforce: "pre"` matters: it has to run before vite:import-analysis, which is
 * what reports the syntax error.
 */
const markdownAsText = {
  name: "markdown-as-text",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.endsWith(".md")) return null;
    return { code: `export default ${JSON.stringify(code)};`, map: null };
  },
};

export default defineConfig({
  plugins: [markdownAsText],
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
