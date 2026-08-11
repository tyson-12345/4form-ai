import { defineConfig } from "vitest/config";

/**
 * Tests for pure logic in `utils/` only.
 *
 * This package has no React Native test harness — component tests would need
 * jest-expo and a native module mock layer, which is a separate piece of work.
 * Restricting the include to `utils/` keeps this runnable today and honest
 * about what it covers: dependency-free functions, not screens.
 */
export default defineConfig({
  test: {
    include: ["utils/**/*.test.ts"],
    environment: "node",
  },
});
