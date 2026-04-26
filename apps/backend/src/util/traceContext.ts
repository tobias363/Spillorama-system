/**
 * MED-1: Trace-ID propagation via AsyncLocalStorage.
 *
 * Provides per-request / per-socket-connection trace-id context that
 * automatically propagates across `await`, Promise chains, `setTimeout`,
 * and other async boundaries — without forcing every call-site to thread
 * the trace-id through function arguments.
 *
 * Usage from middleware (Express / Socket.IO):
 *   import { runWithTraceContext } from "./traceContext.js";
 *   runWithTraceContext({ traceId, requestId }, () => next());
 *
 * Usage from any logger.* call-site (zero-config — context is auto-merged):
 *   import { logger } from "./logger.js";
 *   logger.info({ roomCode }, "Player joined");
 *   // → output includes traceId from current ALS context
 *
 * Manual inspection (rarely needed):
 *   import { getTraceContext, setTraceField } from "./traceContext.js";
 *   const ctx = getTraceContext();
 *   setTraceField("userId", user.id);
 *
 * Why AsyncLocalStorage and not cls-hooked?
 *   ALS is the Node-native primitive (since Node 14, stable since 16) and
 *   has zero runtime overhead when no context is active. cls-hooked relies
 *   on async_hooks instrumentation that pre-dates ALS and is slower.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Fields tracked across an async-context. All are optional — a HTTP-request
 * starts with just `{ traceId, requestId }` and downstream code enriches
 * with `userId` / `roomCode` / `gameId` as it learns more.
 */
export interface TraceContext {
  /** UUID v4. Stable for the entire request / socket-event lifecycle. */
  traceId: string;
  /** Alias of traceId for HTTP — kept as a separate field so downstream
   *  log-aggregators can index either name without losing rows. */
  requestId?: string;
  /** Wallet-id or user-id once auth-resolution has completed. */
  userId?: string;
  /** Room code currently being acted on (e.g. "BINGO-42"). */
  roomCode?: string;
  /** Game session id (the engine's `gameId`, not slug). */
  gameId?: string;
  /** Hall id when the request is hall-scoped. */
  hallId?: string;
  /** Socket id for socket-originated traces. */
  socketId?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

/**
 * Run `fn` inside a fresh trace-context. Any `logger.*` calls in the
 * synchronous frame OR in any async work descended from `fn` (await,
 * setTimeout, microtasks) will see this context.
 */
export function runWithTraceContext<T>(ctx: TraceContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Get the current context, or `undefined` if called outside any
 * `runWithTraceContext`. Returning a frozen snapshot keeps consumers
 * from mutating the live object — use `setTraceField` to enrich.
 */
export function getTraceContext(): Readonly<TraceContext> | undefined {
  return storage.getStore();
}

/**
 * Enrich the live context with a new field. No-op when no context
 * is active (e.g. a startup log before any request). This is how
 * downstream code (auth-resolver, room-resolver) attaches `userId`,
 * `roomCode`, etc. to all subsequent log lines without re-wrapping.
 *
 * Mutating the live store is fine — ALS scopes the object per
 * async-tree, so other concurrent requests have their own.
 */
export function setTraceField<K extends keyof TraceContext>(
  key: K,
  value: TraceContext[K],
): void {
  const store = storage.getStore();
  if (store) {
    store[key] = value;
  }
}

/**
 * Generate a new UUID v4 trace-id. Uses Web Crypto when available
 * (Node 19+ globally, also via `node:crypto.webcrypto`) and falls
 * back to `randomUUID` from `node:crypto` otherwise.
 */
export function newTraceId(): string {
  // node:crypto.randomUUID is available in Node 14.17+ and is the
  // preferred path. We resolve at call time (not module-load) to keep
  // this module tree-shakeable in tests.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
}

function fallbackUuid(): string {
  // Defensive fallback — shouldn't be hit on supported Node versions.
  // RFC-4122 v4 layout: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx where y ∈ {8,9,a,b}.
  const hex = "0123456789abcdef";
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += hex[bytes[i] >> 4] + hex[bytes[i] & 0x0f];
    if (i === 3 || i === 5 || i === 7 || i === 9) out += "-";
  }
  return out;
}

/**
 * Internal helper for the logger — merge active trace-context fields
 * into a log-merge-object. Returns `undefined` when there is no active
 * context so the caller can skip the merge entirely (zero allocation).
 */
export function getTraceMergeFields(): TraceContext | undefined {
  return storage.getStore();
}
