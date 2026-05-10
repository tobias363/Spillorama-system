/**
 * ADR-0020 / P1-3 (2026-05-10): Redis-health metrics for store-layer
 * failure-reporting.
 *
 * Why:
 *   `RedisRoomStateStore.persistAsync` and `RedisSchedulerLock` previously
 *   only logged errors via `logger.error`. Connection-errors after
 *   `maxRetriesPerRequest: 3` went silent, leaving ops blind to slow
 *   Redis-degradation. Evolution-grade live-rooms require < 1 min alert-
 *   latency on Redis-failure.
 *
 * What this module does:
 *   - Lightweight in-memory counter (per-process) for Redis-side errors.
 *   - Counts: persist-failures, lock-acquire-failures, lock-release-failures.
 *   - Tracks consecutive-failure runs (incremented on failure, reset on
 *     success — so caller can detect "5 in a row" without reaching the
 *     monitor's ping path).
 *   - Used by `RedisHealthMonitor` for monitor-decision (degraded vs ok)
 *     and exposed via `getRedisMetricsSnapshot()` for admin diagnostics.
 *
 * Not what this module does:
 *   - No alarm-triggering. That lives in `RedisHealthMonitor` which polls
 *     these metrics + does its own ping.
 *   - No PromQL-export — pilot-skala (24 haller) holder fint i in-memory
 *     per-process. Multi-process aggregation deferres til post-pilot.
 *   - No persistence — counters resets ved Redis-restart. DB har audit-log
 *     for permanent traceback.
 *
 * Multi-process-warning:
 *   Hver Node-process holder sin egen counter. Hvis vi skaler til >1
 *   instans må vi flytte til Prometheus/Redis-counters (samme migrasjons-
 *   bane som `errorMetrics.ts`). For pilot er én Render-instans = én
 *   counter, så det er trivielt å resonnere om.
 */

// ── Internal state ──────────────────────────────────────────────────────────

/**
 * Per-operasjons telling. `lastError` holdes for diagnostikk-display
 * (ikke for hot-path-logikk — feil-meldinger kan inneholde sensitiv info,
 * så vi clamper til 200 tegn).
 */
interface OperationCounter {
  /** Total siden process-start. */
  totalFailures: number;
  /** Sammenhengende feil — reset til 0 ved suksess. */
  consecutiveFailures: number;
  /** Total siden process-start. */
  totalSuccesses: number;
  /** Tidspunkt for siste feil (ms). */
  lastFailureMs: number | null;
  /** Tidspunkt for siste suksess (ms). */
  lastSuccessMs: number | null;
  /** Siste error-message (clamped). */
  lastError: string | null;
}

/** Operasjons-typer vi tracker. */
export type RedisOperationType =
  | "persist"
  | "lock_acquire"
  | "lock_release"
  | "ping";

const OPERATIONS: ReadonlyArray<RedisOperationType> = [
  "persist",
  "lock_acquire",
  "lock_release",
  "ping",
];

/** Map fra operasjons-type til counter-state. */
const counters: Map<RedisOperationType, OperationCounter> = new Map(
  OPERATIONS.map((op) => [
    op,
    {
      totalFailures: 0,
      consecutiveFailures: 0,
      totalSuccesses: 0,
      lastFailureMs: null,
      lastSuccessMs: null,
      lastError: null,
    },
  ]),
);

/** Maksimal lengde på lagrede error-strings (tegn). */
const MAX_ERROR_LENGTH = 200;

function clampError(err: unknown): string {
  if (err === null || err === undefined) return "(unknown)";
  const message =
    err instanceof Error
      ? err.message || err.name || "(empty)"
      : typeof err === "string"
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return "(unserializable)";
            }
          })();
  if (message.length > MAX_ERROR_LENGTH) {
    return message.slice(0, MAX_ERROR_LENGTH) + "...";
  }
  return message;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Registrer en mislykket Redis-operasjon. Aldri-throwing — caller skal
 * fortsatt fail-soft.
 */
export function recordRedisFailure(
  operation: RedisOperationType,
  err: unknown,
  nowMs: number = Date.now(),
): void {
  const state = counters.get(operation);
  if (!state) return;
  state.totalFailures += 1;
  state.consecutiveFailures += 1;
  state.lastFailureMs = nowMs;
  state.lastError = clampError(err);
}

/**
 * Registrer en vellykket Redis-operasjon. Resetter `consecutiveFailures`
 * til 0.
 */
export function recordRedisSuccess(
  operation: RedisOperationType,
  nowMs: number = Date.now(),
): void {
  const state = counters.get(operation);
  if (!state) return;
  state.totalSuccesses += 1;
  state.consecutiveFailures = 0;
  state.lastSuccessMs = nowMs;
}

/**
 * Snapshot av alle counters. Brukes av `RedisHealthMonitor.evaluate` og
 * av admin-endpoint for diagnostikk.
 */
export interface RedisOperationSnapshot {
  readonly operation: RedisOperationType;
  readonly totalFailures: number;
  readonly consecutiveFailures: number;
  readonly totalSuccesses: number;
  readonly lastFailureMs: number | null;
  readonly lastSuccessMs: number | null;
  readonly lastError: string | null;
}

export function getRedisMetricsSnapshot(): RedisOperationSnapshot[] {
  return OPERATIONS.map((op) => {
    const state = counters.get(op);
    if (!state) {
      return {
        operation: op,
        totalFailures: 0,
        consecutiveFailures: 0,
        totalSuccesses: 0,
        lastFailureMs: null,
        lastSuccessMs: null,
        lastError: null,
      };
    }
    return {
      operation: op,
      totalFailures: state.totalFailures,
      consecutiveFailures: state.consecutiveFailures,
      totalSuccesses: state.totalSuccesses,
      lastFailureMs: state.lastFailureMs,
      lastSuccessMs: state.lastSuccessMs,
      lastError: state.lastError,
    };
  });
}

/**
 * Hent én counter direkte. Brukes av health-monitor for å avgjøre om
 * vi er degraded basert på persist-failures.
 */
export function getRedisOperationCounter(
  operation: RedisOperationType,
): RedisOperationSnapshot {
  const state = counters.get(operation);
  if (!state) {
    return {
      operation,
      totalFailures: 0,
      consecutiveFailures: 0,
      totalSuccesses: 0,
      lastFailureMs: null,
      lastSuccessMs: null,
      lastError: null,
    };
  }
  return {
    operation,
    totalFailures: state.totalFailures,
    consecutiveFailures: state.consecutiveFailures,
    totalSuccesses: state.totalSuccesses,
    lastFailureMs: state.lastFailureMs,
    lastSuccessMs: state.lastSuccessMs,
    lastError: state.lastError,
  };
}

/**
 * Reset alle counters. Brukes KUN i tests — production-kode skal aldri
 * kalle denne.
 */
export function __resetRedisMetricsForTests(): void {
  for (const op of OPERATIONS) {
    const state = counters.get(op);
    if (!state) continue;
    state.totalFailures = 0;
    state.consecutiveFailures = 0;
    state.totalSuccesses = 0;
    state.lastFailureMs = null;
    state.lastSuccessMs = null;
    state.lastError = null;
  }
}
