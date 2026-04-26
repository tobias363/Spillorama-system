/**
 * BIN-168: Centralized structured JSON logger using pino.
 * BIN-309: Automatic redaction of sensitive fields in all log output.
 * MED-1:   Automatic merge of AsyncLocalStorage trace-context (traceId,
 *          requestId, userId, roomCode, gameId, hallId, socketId) into
 *          every log call — no manual threading required.
 *
 * Usage:
 *   import { logger } from "../util/logger.js";
 *   logger.info({ roomCode, playerId }, "Player joined room");
 *   logger.error({ err, gameId }, "Game start failed");
 *
 * Per-module child loggers:
 *   const log = logger.child({ module: "scheduler" });
 *   log.info("Tick completed");
 *
 * Configuration via environment:
 *   LOG_LEVEL: trace | debug | info | warn | error | fatal (default: info)
 *   NODE_ENV: production → JSON output; otherwise → structured but readable
 *
 * Redacted fields (replaced with "[REDACTED]"):
 *   password, token, accessToken, refreshToken, sessionToken,
 *   nationalId, ssn, personnummer, cardNumber, cvv, cvc,
 *   authorization header (HTTP requests), x-api-key header
 *
 * Backwards-compat (MED-1): existing `logger.info/warn/error` calls work
 * unchanged. They simply gain a `traceId` field automatically when called
 * inside a request-scope.
 */

import pino from "pino";
import { getTraceMergeFields } from "./traceContext.js";

const level = process.env.LOG_LEVEL?.trim().toLowerCase() || "info";
const isProduction = process.env.NODE_ENV === "production";

/**
 * BIN-309: Sensitive field paths to redact from all log output.
 * Pino replaces these with "[REDACTED]" before serialization.
 * Wildcards (*) cover one level of nesting (e.g. body.password).
 */
const REDACT_PATHS = [
  // Auth credentials — top-level and nested one level deep
  "password",
  "*.password",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "sessionToken",
  "*.sessionToken",
  "secret",
  "*.secret",

  // Norwegian national identity fields
  "nationalId",
  "*.nationalId",
  "ssn",
  "*.ssn",
  "personnummer",
  "*.personnummer",
  "fodselsnummer",
  "*.fodselsnummer",

  // Payment card data
  "cardNumber",
  "*.cardNumber",
  "cvv",
  "*.cvv",
  "cvc",
  "*.cvc",
  "pan",
  "*.pan",

  // HTTP request/response auth headers (pino-http req.headers)
  "req.headers.authorization",
  "req.headers['x-api-key']",
  "headers.authorization",
  "headers['x-api-key']",
];

export const logger = pino({
  level,
  // BIN-309: Redact sensitive fields before any serializer or transport sees them
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // MED-1: pino calls `mixin` on every log statement and merges its return
  // value into the emitted record. We use it to inject the active
  // AsyncLocalStorage trace-context (traceId, userId, roomCode, gameId, ...)
  // so all log lines for one request share the same correlation id without
  // manual threading.
  //
  // Returning `undefined` is intentional when there is no active context —
  // pino tolerates it and emits no extra fields. This keeps startup-time
  // logs (no request scope) and tests (no middleware) clean.
  //
  // mergeObject (the user's per-call merge object) takes precedence over
  // mixin per pino docs, so explicit `logger.info({ traceId: "x" }, ...)`
  // still wins over the ALS-injected one — useful for cross-trace audit
  // events that need to reference an external id.
  mixin() {
    const ctx = getTraceMergeFields();
    if (!ctx) return {} as Record<string, unknown>;
    // Spread to a fresh object so pino's serializer can't accidentally
    // mutate the live ALS store.
    return { ...ctx };
  },
  ...(isProduction ? {} : { transport: undefined }),
});

export type Logger = pino.Logger;
