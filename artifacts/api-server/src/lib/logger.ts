import pino from "pino";

import { stripBoundValues } from "./dbErrors.js";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Structured logger.
 *
 * The redaction list is a backstop, not the primary control: the rule is that
 * secrets are never passed to the logger in the first place (no request bodies,
 * no password fields, no raw reset tokens). These paths catch the cases where
 * an object is logged wholesale by mistake — e.g. an error whose `config`
 * carries an Authorization header.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-api-key']",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.password_hash",
      "*.token",
      "*.tokenHash",
      "*.accessToken",
      "*.refreshToken",
      "*.apiKey",
      "*.secret",
      "password",
      "passwordHash",
      "token",
      "err.config.headers.authorization",
      // Drizzle's DrizzleQueryError carries the SQL and its bind values as own
      // properties, and pino's error serializer emits both. The bind values of
      // any query are user data by definition. `repositories/waitlistRepository`
      // already strips them at the throw site; this is the net under it, for
      // every other query in the app.
      "err.query",
      "err.params",
      "*.params",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    /**
     * Drizzle interpolates bind values into the error's own `message` (and so
     * into `stack`), which no redact path can reach — a path matches a
     * property, not a substring of one. `stripBoundValues` swaps the whole
     * error for one carrying only the SQLSTATE and the constraint name, then
     * the standard serializer formats that.
     *
     * At the serializer rather than at each `logger.error` call, because the
     * call sites that matter are the ones nobody remembered to change: the
     * global error handler in app.ts logs whatever reached it.
     */
    err: (error: unknown) => pino.stdSerializers.err(stripBoundValues(error) as Error),
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
