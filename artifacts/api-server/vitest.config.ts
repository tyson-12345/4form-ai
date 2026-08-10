import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Every test file that touches lib/auth.ts needs these at import time —
    // that module deliberately throws on a missing or short JWT_SECRET.
    setupFiles: ["./test/setup.ts"],
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
