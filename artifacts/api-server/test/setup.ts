/**
 * Test environment bootstrap.
 *
 * `src/lib/auth.ts` throws at import time when JWT_SECRET is missing or too
 * short — that guard is deliberate, so tests must satisfy it rather than
 * weaken it. Values here are fixtures and never touch a real service.
 */

process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? "test-only-jwt-secret-value-that-is-long-enough-to-pass-the-guard";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "sk-ant-test-key-not-real";
process.env.LOG_LEVEL = "silent";
