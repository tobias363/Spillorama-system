/**
 * DB-P0-002: Shared PostgreSQL pool to prevent connection-pool sprawl.
 *
 * Before this module:
 *   75 distinct `new Pool()` call-sites × max 20 connections each
 *     = ~1500 theoretical connections vs Render Postgres ~100 limit.
 *
 * After:
 *   One process-wide pool created at boot via `initSharedPool()` from
 *   `index.ts`. Services import `getSharedPool()` (or accept a Pool via
 *   the existing `options.pool` injection path) instead of constructing
 *   their own pool from a connection-string.
 *
 * Why a single shared pool is safe here:
 *   * All production services point at the SAME Postgres database
 *     (`platformConnectionString` and `checkpointConnectionString` both
 *     resolve to `APP_PG_CONNECTION_STRING`/`WALLET_PG_CONNECTION_STRING`).
 *   * `pg.Pool` is concurrency-safe — clients are leased per query,
 *     released back when done. Sharing one pool across 40 services is the
 *     industry-standard pattern (Express + pg).
 *   * Per-service pools were creating duplicate idle connections; one pool
 *     reuses connections across the whole process, dramatically reducing
 *     server-side connection count.
 *
 * Statement timeout (DB-P1-6 quick-win):
 *   The shared pool installs `statement_timeout = 30s` on every new client
 *   via the `connect` event. This caps runaway queries (forgotten WHERE
 *   clauses, accidentally large IN-lists) so they cannot hold a connection
 *   forever.
 *
 * Test code is intentionally NOT migrated to this shared pool — test files
 * create per-test cleanup pools against arbitrary `test_<uuid>` schemas
 * and need full lifecycle control.
 */

import { Pool, type PoolConfig } from "pg";
import { getPoolTuning } from "./pgPool.js";

/**
 * Default `statement_timeout` applied to every connection acquired from the
 * shared pool. 30 seconds is generous for normal queries, well above the
 * slowest legitimate admin reports, but short enough that a runaway never
 * holds a connection long enough to matter for the pool.
 *
 * Override via `PG_STATEMENT_TIMEOUT_MS` env-var if needed (e.g. 0 to
 * disable for ad-hoc debugging).
 */
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

let sharedPool: Pool | null = null;

export interface SharedPoolOptions {
  connectionString: string;
  ssl?: boolean;
  /**
   * Override statement_timeout (ms). Set to 0 to disable.
   * Defaults to PG_STATEMENT_TIMEOUT_MS env var or 30_000.
   */
  statementTimeoutMs?: number;
}

/**
 * Initialize the process-wide shared pool. MUST be called exactly once
 * during boot (typically in `index.ts`) before any service that needs DB
 * access is constructed. Throws if called twice or if connectionString
 * is empty.
 *
 * OBS-7 (2026-05-14): pgBouncer-toggle.
 *   Hvis `PGBOUNCER_URL` er satt, brukes den i stedet for den passerte
 *   `connectionString`. Da går runtime-queries via pgBouncer (transaction-
 *   pool-mode, port 6432) i stedet for direkte mot Postgres. Migrations
 *   skal IKKE bruke pgBouncer (de trenger session-level state); de leser
 *   `APP_PG_CONNECTION_STRING` direkte via node-pg-migrate.
 *
 *   Når PGBOUNCER_URL er satt, logger vi det for synlighet — ops skal kunne
 *   se i boot-log at vi kjører via pooler.
 */
export function initSharedPool(options: SharedPoolOptions): Pool {
  if (sharedPool) {
    throw new Error(
      "[sharedPool] initSharedPool() called twice. The shared pool is a singleton — initialize once at boot."
    );
  }
  // OBS-7: pgBouncer-toggle via env. Hvis PGBOUNCER_URL er satt, overstyrer
  // den den passerte connectionString. Tom string → fall tilbake til
  // den passerte verdien (default).
  const pgbouncerUrl = process.env.PGBOUNCER_URL?.trim();
  const usePgBouncer = !!pgbouncerUrl;
  const effectiveConn = usePgBouncer ? pgbouncerUrl! : options.connectionString.trim();
  if (!effectiveConn) {
    throw new Error("[sharedPool] connectionString must not be empty.");
  }
  if (usePgBouncer) {
    console.log("[sharedPool] OBS-7: routing app-queries via pgBouncer (PGBOUNCER_URL set)");
  }
  const conn = effectiveConn;

  const tuning = getPoolTuning();
  const poolConfig: PoolConfig = {
    connectionString: conn,
    ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
    max: tuning.max,
    idleTimeoutMillis: tuning.idleTimeoutMillis,
    connectionTimeoutMillis: tuning.connectionTimeoutMillis,
  };

  const pool = new Pool(poolConfig);

  // DB-P1-6: install statement_timeout on every new connection. The
  // `connect` event fires once per backend connection (not per query)
  // so this is a fixed cost paid only at pool warm-up.
  //
  // OBS-7 (2026-05-14): I pgBouncer transaction-mode kan vi IKKE bruke
  // session-level `SET` — bare `SET LOCAL` inne i en transaksjon. Hvis
  // PGBOUNCER_URL er satt, dropper vi `SET statement_timeout` her og
  // forventer at ops setter `statement_timeout` på Postgres-siden via
  // `ALTER ROLE spillorama SET statement_timeout = '30s'`. Da gjelder
  // det automatisk for alle nye connections uten å være session-state
  // pgBouncer må håndtere.
  const usePgBouncerForStatement = !!process.env.PGBOUNCER_URL?.trim();
  const stmtTimeoutMs = resolveStatementTimeoutMs(options.statementTimeoutMs);
  if (stmtTimeoutMs > 0 && !usePgBouncerForStatement) {
    pool.on("connect", (client) => {
      // Fire-and-forget: if SET fails the client is still usable (just
      // without timeout protection). Log so ops notices misconfig.
      client
        .query(`SET statement_timeout = ${stmtTimeoutMs}`)
        .catch((err: unknown) => {
          console.warn(
            "[sharedPool] failed to set statement_timeout on new client:",
            err
          );
        });
    });
  } else if (stmtTimeoutMs > 0 && usePgBouncerForStatement) {
    console.log(
      "[sharedPool] OBS-7: pgBouncer mode — skipping client-side SET statement_timeout. " +
      "Set it on Postgres role instead: ALTER ROLE <app_user> SET statement_timeout = '" +
      stmtTimeoutMs + "ms'"
    );
  }

  // Surface pool errors so a transient network blip doesn't kill the
  // process silently. node-pg's default `error` handler exits the process
  // if no listener is attached.
  pool.on("error", (err) => {
    console.error("[sharedPool] idle client error:", err);
  });

  sharedPool = pool;
  return pool;
}

/**
 * Get the shared pool. Throws if `initSharedPool()` has not yet been
 * called — services that depend on this must be constructed AFTER the
 * pool is initialized in `index.ts`.
 */
export function getSharedPool(): Pool {
  if (!sharedPool) {
    throw new Error(
      "[sharedPool] getSharedPool() called before initSharedPool(). " +
        "Did you forget to wire the shared pool in index.ts boot?"
    );
  }
  return sharedPool;
}

/**
 * Returns true if the shared pool has been initialized. Useful for
 * services that have a degraded mode when no DB is available.
 */
export function hasSharedPool(): boolean {
  return sharedPool !== null;
}

/**
 * Cleanly close the shared pool. Used by tests and graceful shutdown.
 * After calling this, `getSharedPool()` will throw until re-initialized.
 */
export async function closeSharedPool(): Promise<void> {
  const current = sharedPool;
  sharedPool = null;
  if (current) {
    await current.end();
  }
}

/**
 * @internal — test-hook so tests can install their own pool as the
 * shared pool. Not part of the public API.
 */
export function _setSharedPoolForTesting(pool: Pool | null): void {
  sharedPool = pool;
}

function resolveStatementTimeoutMs(override: number | undefined): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  const envRaw = process.env.PG_STATEMENT_TIMEOUT_MS?.trim();
  if (envRaw) {
    const parsed = Number(envRaw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_STATEMENT_TIMEOUT_MS;
}
