// Flat ESLint config for the API server.
//
// Adopted from Oscar's fork, which had lint coverage where this package had
// none. The rule set is deliberately small: type-aware correctness rules that
// catch real bugs, and nothing that argues about formatting.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // `test/` and the vitest config sit outside the tsconfig project, so the
    // type-aware rules cannot parse them. They are covered by `tsc` and by the
    // suite itself; linting them would need a second tsconfig for no real gain.
    ignores: [
      "dist/**",
      "node_modules/**",
      "build.mjs",
      "test/**",
      "vitest.config.ts",
      "eslint.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A floating promise in a route handler is a request that resolves before
      // its own database write lands. This is the rule most worth having here.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",

      // `_`-prefixed args are the established convention for Express's unused
      // `next` and `req` parameters, which appear throughout.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Warn rather than error: some Drizzle and Anthropic SDK generics
      // legitimately need `any` at the boundary, and failing the build on those
      // would push people toward disable comments instead of narrower types.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",

      // console is not the logger. Use lib/logger.ts so output stays structured
      // and request-scoped.
      "no-console": ["error", { allow: ["error"] }],
    },
  },
  {
    // Tests mock aggressively and assert on shapes the type system cannot see.
    files: ["**/*.test.ts", "src/test-setup.ts", "test/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "no-console": "off",
    },
  },
);
