import { randomUUID } from "node:crypto";
import pino from "pino";

const level = process.env.LOG_LEVEL?.trim().toLowerCase() || "info";

export const logger = pino({
  level,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// ---------------------------------------------------------------------------
// Override console.log/error/warn/info so ALL existing log statements
// automatically flow through pino as structured JSON in production.
// This avoids a 45-file find-and-replace while still getting structured
// logging immediately.
// ---------------------------------------------------------------------------
console.log = (...args: unknown[]) => logger.info(args.map(String).join(" "));
console.error = (...args: unknown[]) => logger.error(args.map(String).join(" "));
console.warn = (...args: unknown[]) => logger.warn(args.map(String).join(" "));
console.info = (...args: unknown[]) => logger.info(args.map(String).join(" "));
console.debug = (...args: unknown[]) => logger.debug(args.map(String).join(" "));

// ---------------------------------------------------------------------------
// Correlation ID — generate a short unique ID for tracing requests
// ---------------------------------------------------------------------------
export function correlationId(): string {
  return randomUUID().slice(0, 8);
}

export type Logger = typeof logger;
