/**
 * BIN-539: Sentry wiring for the backend.
 *
 * The import is lazy so `@sentry/node` only loads when `SENTRY_DSN` is set.
 * In dev and test, this module is a no-op: all functions return successfully
 * without doing any I/O, so there's nothing to stub out in tests.
 *
 * Usage:
 *   initSentry();                                 // call once at startup
 *   setSocketSentryContext(socket, user);         // per-connection
 *   captureError(err, { roomCode, playerId });    // on thrown error
 *   addBreadcrumb("claim:submit", { roomCode });  // on key lifecycle events
 */

import { createHash } from "node:crypto";
import type { Socket } from "socket.io";

// ── Minimal Sentry surface — decoupled from @sentry/node types ──────────────
// We import the SDK lazily inside initSentry so a missing DSN never pulls it
// into the process. The rest of the module stores a narrow handle.

interface SentryHandle {
  captureException: (err: unknown, hint?: { tags?: Record<string, string>; extra?: Record<string, unknown> }) => void;
  addBreadcrumb: (breadcrumb: { category: string; message?: string; data?: Record<string, unknown>; level?: "info" | "warning" | "error" }) => void;
  setTag: (key: string, value: string) => void;
  setUser: (user: { id?: string; username?: string; email?: string } | null) => void;
  withScope: (cb: (scope: { setTag: (k: string, v: string) => void; setExtra: (k: string, v: unknown) => void; setUser: (u: { id?: string; username?: string; email?: string } | null) => void }) => void) => void;
  flush: (timeoutMs?: number) => Promise<boolean>;
  expressErrorHandler?: () => (err: unknown, req: unknown, res: unknown, next: unknown) => void;
}

let sentry: SentryHandle | null = null;
let initialized = false;

export interface SentryInitOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  /**
   * Trace sample rate (0.0–1.0). Defaults to 0.1 in production and 1.0 in
   * non-production environments. Set explicitly to override.
   */
  tracesSampleRate?: number;
  /**
   * Profile sample rate (0.0–1.0). Profiling adds ~5–10 % CPU overhead and
   * is therefore only enabled when explicitly opted-in. Defaults to 0.0.
   * Operators can flip to `1.0` in dev/staging when debugging hot loops.
   */
  profilesSampleRate?: number;
  /**
   * Enable @sentry/profiling-node integration. Requires the package to be
   * installed; if it isn't, init falls through with a warning. Defaults
   * to true so production gets profiling automatically when the
   * SENTRY_DSN is configured.
   */
  enableProfiling?: boolean;
}

/**
 * Initialize Sentry if `SENTRY_DSN` is set in the environment. Safe to call
 * multiple times — subsequent calls are no-ops. Returns true if Sentry is now
 * active, false if it was skipped (dev fallback).
 */
export async function initSentry(options: SentryInitOptions = {}): Promise<boolean> {
  if (initialized) return sentry !== null;
  initialized = true;

  const dsn = (options.dsn ?? process.env.SENTRY_DSN ?? "").trim();
  if (!dsn) {
    console.warn("[sentry] DISABLED — SENTRY_DSN is unset. Errors will only be logged to stderr.");
    return false;
  }

  try {
    // Dynamic import so the dep is optional at runtime. If the package isn't
    // installed yet, we log and fall back — the rest of the app still runs.
    const mod = await import("@sentry/node").catch(() => null);
    if (!mod) {
      console.warn("[sentry] DISABLED — @sentry/node not installed. Run `npm install @sentry/node` to enable.");
      return false;
    }
    const environment = options.environment ?? process.env.NODE_ENV ?? "development";
    const isProd = environment === "production";

    // Build integrations list. Profiling is opt-in via the
    // `enableProfiling` option (default true) and gracefully no-ops when
    // the package isn't installed. The httpIntegration and
    // expressIntegration are included automatically by @sentry/node v10.
    const integrations: unknown[] = [];
    const enableProfiling = options.enableProfiling ?? true;
    if (enableProfiling) {
      try {
        const profilingMod = await import("@sentry/profiling-node").catch(() => null);
        if (profilingMod && typeof profilingMod.nodeProfilingIntegration === "function") {
          integrations.push(profilingMod.nodeProfilingIntegration());
        } else if (!profilingMod) {
          // Quiet warning — profiling is optional.
          console.info("[sentry] profiling disabled (@sentry/profiling-node not installed)");
        }
      } catch (err) {
        console.warn("[sentry] profiling integration failed to load", err);
      }
    }

    mod.init({
      dsn,
      environment,
      release: options.release ?? process.env.SENTRY_RELEASE ?? process.env.RELEASE_SHA ?? undefined,
      tracesSampleRate: options.tracesSampleRate ?? (isProd ? 0.1 : 1.0),
      profilesSampleRate: options.profilesSampleRate ?? 0.0,
      integrations: integrations.length > 0 ? (integrations as Parameters<typeof mod.init>[0] extends { integrations?: infer T } ? T : never) : undefined,
    });
    sentry = {
      captureException: (err, hint) => { mod.captureException(err, hint); },
      addBreadcrumb: (b) => { mod.addBreadcrumb(b); },
      setTag: (k, v) => { mod.setTag(k, v); },
      setUser: (u) => { mod.setUser(u); },
      withScope: (cb) => {
        mod.withScope((scope: {
          setTag: (k: string, v: string) => void;
          setExtra: (k: string, v: unknown) => void;
          setUser: (u: { id?: string; username?: string; email?: string } | null) => void;
        }) => {
          cb({
            setTag: (k, v) => { scope.setTag(k, v); },
            setExtra: (k, v) => { scope.setExtra(k, v); },
            setUser: (u) => { scope.setUser(u); },
          });
        });
      },
      flush: (t) => mod.flush(t),
      // @sentry/node v10 exposes expressErrorHandler as a factory. Cast is
      // narrow so a v8/v9 fallback would simply leave this undefined.
      expressErrorHandler: typeof (mod as unknown as { expressErrorHandler?: () => unknown }).expressErrorHandler === "function"
        ? () => (mod as unknown as { expressErrorHandler: () => (err: unknown, req: unknown, res: unknown, next: unknown) => void }).expressErrorHandler()
        : undefined,
    };
    console.log(`[sentry] ENABLED (env=${environment}, profiling=${enableProfiling}, traces=${options.tracesSampleRate ?? (isProd ? 0.1 : 1.0)})`);
    return true;
  } catch (err) {
    console.error("[sentry] init failed — continuing without", err);
    return false;
  }
}

/**
 * Hash a PII value (walletId, playerId) so it's correlatable across events
 * without exposing the raw identifier. SHA-256 truncated to 12 hex chars is
 * collision-safe at operator-readable scale (~4B unique inputs).
 */
export function hashPii(value: string | undefined | null): string {
  if (!value) return "anon";
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Set Sentry context tags on a freshly authenticated socket. Called from the
 * connection middleware after token validation so every captured error for
 * this socket is tagged with its hall + hashed player id.
 */
export function setSocketSentryContext(
  socket: Socket,
  user: { walletId?: string; hallId?: string; playerId?: string } | undefined | null,
): void {
  if (!sentry || !user) return;
  socket.data.sentry = {
    hallId: user.hallId ?? "unknown",
    playerIdHash: hashPii(user.playerId ?? user.walletId),
    walletIdHash: hashPii(user.walletId),
  };
}

/**
 * Capture an error with optional tags. Falls through to console.error when
 * Sentry is disabled so dev still sees stack traces.
 */
export function captureError(err: unknown, tags: Record<string, string | undefined> = {}): void {
  if (!sentry) {
    console.error("[sentry-fallback]", err, tags);
    return;
  }
  const cleanTags = Object.fromEntries(
    Object.entries(tags).filter(([, v]) => typeof v === "string" && v.length > 0),
  ) as Record<string, string>;
  sentry.captureException(err, { tags: cleanTags });
}

/**
 * Add a breadcrumb to the current Sentry scope. Use for successful lifecycle
 * events (room:create, claim:submit, draw:new) so the trail is available on
 * the next error. Data is capped to avoid PII leaks — prefer hashed ids.
 */
export function addBreadcrumb(
  category: string,
  data: Record<string, unknown> = {},
  level: "info" | "warning" | "error" = "info",
): void {
  if (!sentry) return;
  sentry.addBreadcrumb({ category, data, level });
}

/**
 * Flush pending events before a graceful shutdown. No-op when disabled.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!sentry) return;
  try { await sentry.flush(timeoutMs); } catch { /* best effort */ }
}

/**
 * Set the current user context. Pass `null` to clear it (e.g. on logout).
 * IDs are user-ids in our system; never raw email/PII without a hash —
 * call `hashPii` first if the source is sensitive.
 */
export function setSentryUser(
  user: { id?: string; username?: string; email?: string } | null,
): void {
  if (!sentry) return;
  sentry.setUser(user);
}

/**
 * Run a callback in an isolated Sentry scope, useful for per-request
 * tag/extra annotations that should not leak to other captures.
 */
export function withSentryScope(
  cb: (scope: {
    setTag: (k: string, v: string) => void;
    setExtra: (k: string, v: unknown) => void;
    setUser: (u: { id?: string; username?: string; email?: string } | null) => void;
  }) => void,
): void {
  if (!sentry) return;
  sentry.withScope(cb);
}

/**
 * Get the Express error handler from @sentry/node v10. Returns `undefined`
 * when Sentry is disabled or the SDK version doesn't expose it (e.g. v8/v9).
 * Caller is responsible for installing it after all routes.
 *
 * Usage:
 *   const handler = getSentryExpressErrorHandler();
 *   if (handler) app.use(handler);
 */
export function getSentryExpressErrorHandler():
  | ((err: unknown, req: unknown, res: unknown, next: unknown) => void)
  | undefined {
  if (!sentry?.expressErrorHandler) return undefined;
  return sentry.expressErrorHandler();
}

/** Test-only: force-disable Sentry so unit tests don't pick up a partial init. */
export function __resetSentryForTests(): void {
  sentry = null;
  initialized = false;
}

/** Test-only: inject a mock sentry so tests can assert captureException calls. */
export function __installMockSentryForTests(mock: SentryHandle): void {
  sentry = mock;
  initialized = true;
}
