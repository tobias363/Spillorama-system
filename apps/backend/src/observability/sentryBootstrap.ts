/**
 * OBS-2 (2026-05-13): Backend Sentry bootstrap.
 *
 * Thin facade over `./sentry.ts` that wires:
 *   - `initSentry({ enableProfiling: true })` on boot
 *   - Profiling integration via `@sentry/profiling-node` (loaded lazily)
 *   - Express error handler (must be installed AFTER all routes)
 *   - Per-request user-context middleware (must be installed BEFORE routes)
 *
 * The actual SDK calls live in `sentry.ts` — this module composes them
 * into Express middleware so the call-site in `index.ts` stays small.
 *
 * Why a separate module:
 *   - Lets `sentry.ts` keep its narrow SDK-handle abstraction (testable).
 *   - Centralises Express-specific wiring so we don't pollute `index.ts`
 *     with conditional Sentry boilerplate.
 *   - Future MCP integrations (Slack alerts on captured errors, custom
 *     transports) hook in here without touching the SDK adapter.
 */

import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";

import {
  initSentry,
  getSentryExpressErrorHandler,
  setSentryUser,
  captureError,
  type SentryInitOptions,
} from "./sentry.js";
import { instrumentPgPool } from "./dbInstrumentation.js";

/**
 * Initialise Sentry with sensible defaults for the backend. Idempotent.
 *
 * Reads `SENTRY_DSN` from env; if unset the SDK stays disabled and all
 * helpers no-op. Profiling is enabled by default but gracefully no-ops
 * when `@sentry/profiling-node` isn't installed.
 *
 * Production overrides via env vars:
 *   - SENTRY_DSN                    : enable Sentry
 *   - SENTRY_TRACES_SAMPLE_RATE     : 0.0–1.0 (default 0.1 in prod, 1.0 elsewhere)
 *   - SENTRY_PROFILES_SAMPLE_RATE   : 0.0–1.0 (default 0.0)
 *   - SENTRY_RELEASE / RELEASE_SHA  : release identifier
 */
export async function bootstrapBackendSentry(
  overrides: Partial<SentryInitOptions> = {},
): Promise<boolean> {
  const tracesEnv = process.env.SENTRY_TRACES_SAMPLE_RATE;
  const profilesEnv = process.env.SENTRY_PROFILES_SAMPLE_RATE;
  const tracesSampleRate = tracesEnv !== undefined ? Number(tracesEnv) : undefined;
  const profilesSampleRate = profilesEnv !== undefined ? Number(profilesEnv) : undefined;

  const options: SentryInitOptions = {
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : undefined,
    profilesSampleRate: Number.isFinite(profilesSampleRate) ? profilesSampleRate : undefined,
    enableProfiling: true,
    ...overrides,
  };

  return initSentry(options);
}

/**
 * Express middleware that propagates the authenticated user-id into the
 * Sentry scope for the lifetime of the request. Must run AFTER your auth
 * middleware has populated `req.user` (or `res.locals.user`).
 *
 * No PII is sent — only the userId. Hall-id is exposed as a tag via the
 * usual breadcrumb path.
 */
export function sentryUserContextMiddleware() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const user = (req as Request & { user?: { id?: string; userId?: string } }).user;
      const userId = user?.id ?? user?.userId;
      if (userId) {
        setSentryUser({ id: userId });
      }
    } catch (err) {
      // Never let observability wiring break a request.
      captureError(err, { source: "sentryUserContextMiddleware" });
    }
    next();
  };
}

/**
 * Returns the Sentry Express error handler so the caller can install it
 * after all route handlers. Falls back to `undefined` when Sentry is
 * disabled — caller should treat that as "skip this middleware".
 */
export function getSentryErrorHandlerMiddleware() {
  return getSentryExpressErrorHandler();
}

/**
 * OBS-7 (2026-05-14): Wire Sentry DB-tracing onto the given pg.Pool-s.
 *
 * Call this AFTER `bootstrapBackendSentry()` (or at any point — the wrapper
 * lazy-resolves Sentry via dynamic import, so it's safe to call before
 * Sentry has actually finished init). Idempotent per pool — re-calling on
 * the same pool is a no-op.
 *
 * Pass the shared platform-pool and optionally the wallet-pool. Each query
 * will emit a `db.sql.query` span tied to the surrounding request trace,
 * subject to Sentry's `tracesSampleRate`.
 *
 * Returns the number of pools that were newly wrapped (for logging).
 */
export function instrumentDbPools(pools: Array<Pool | null | undefined>): number {
  let wrapped = 0;
  for (const pool of pools) {
    if (!pool) continue;
    try {
      if (instrumentPgPool(pool)) wrapped += 1;
    } catch (err) {
      // Never let observability wiring break boot.
      captureError(err, { source: "instrumentDbPools" });
    }
  }
  return wrapped;
}
