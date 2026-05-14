/**
 * Pilot Q3 2026 (Agent T, 2026-05-14): pg-pool resilience-helper.
 *
 * Bakgrunn — Sentry-issue SPILLORAMA-BACKEND-5 (2026-05-14 11:23:30 UTC):
 *
 *   error: terminating connection due to administrator command
 *     pg-protocol/src/parser.ts:394 parseErrorMessage
 *     source = uncaughtException
 *
 * Trigger var en Postgres-recreate (`docker-compose up -d --force-recreate
 * postgres`) som terminerte alle åpne klienter i pool-en mens en aktiv
 * REST-request (`POST /api/agent/game1/master/heartbeat`) hadde en
 * leased client. Når serveren sender FATAL (`57P01 admin_shutdown`),
 * node-postgres-clienten emit-er `error`-event på pool-en. Hvis det
 * IKKE finnes en `pool.on("error", ...)`-handler, propagerer feilen
 * som `uncaughtException` og hele process-en krasjer.
 *
 * Samme scenario kan oppstå i prod ved:
 *   - Render Postgres-vedlikehold (de terminerer åpne connections planlagt)
 *   - Postgres failover (Render Pro PITR-auto-failover)
 *   - OS-restart av postgres-container
 *
 * For pilot må dette være fail-soft + auto-reconnect:
 *
 *   - 57P01/57P02/57P03 (admin_shutdown / crash_shutdown / cannot_connect_now)
 *     → WARN, ingen propagering. `pg.Pool` re-leier nye connections automatisk
 *     ved neste `acquire`/`query`.
 *   - 08001/08006 (sqlclient-unable-to-establish / connection_failure)
 *     → WARN, ingen propagering. Samme retry-mønster i caller.
 *   - Alt annet → ERROR med pool-navn så ops kan diagnostisere.
 *
 * Designvalg:
 *   * Idempotent — `attachPoolErrorHandler` kan kalles flere ganger på samme
 *     pool uten å registrere duplikat-handlers. Bruker en WeakSet for å
 *     spore wrapped pools.
 *   * Pool-navn brukes som logger-context for å skille mellom shared-pool,
 *     wallet-pool, etc. Default `"unknown"` hvis ikke gitt.
 *   * Bruker pino-loggeren (samme som resten av backend) — strukturerte
 *     log-lines med `traceId`-autocorrelation via AsyncLocalStorage.
 *   * `isTransientConnectionError` eksponeres som standalone predikat slik
 *     at caller (eks. MasterActionService.heartbeat) kan bruke `withRetry`
 *     med samme klassifisering.
 *
 * @see apps/backend/src/util/sharedPool.ts — bruker dette
 * @see apps/backend/src/adapters/PostgresWalletAdapter.ts — bruker dette
 * @see docs/engineering/PITFALLS_LOG.md §13 (DB-resilience) — root cause
 */

import type { Pool } from "pg";
import { logger as rootLogger } from "./logger.js";
import { withRetry, type RetryOptions, type RetryResult } from "./retry.js";

const log = rootLogger.child({ module: "pg-pool-error-handler" });

/**
 * PostgreSQL SQLSTATE-koder som indikerer transient connection-feil.
 * Returnerer true for koder som det er trygt å retry på (read-paths).
 *
 * Whitelist (ikke blacklist) — alle ikke-listede koder anses som ikke-transient.
 *
 *   57P01 — admin_shutdown                : Postgres terminerte vår client (vedlikehold, restart, manual SIGTERM)
 *   57P02 — crash_shutdown                : Postgres krasjet og restarter
 *   57P03 — cannot_connect_now            : Postgres startet, men aksepterer ikke connections enda
 *   08001 — sqlclient_unable_to_establish : Klient kunne ikke etablere TCP-connection
 *   08006 — connection_failure            : Etablert connection ble droppet midt i en query
 *   08000 — connection_exception          : Generic connection-feil (sjelden, men retry-safe)
 *   08003 — connection_does_not_exist     : Brukt connection-objekt etter at den ble lukket
 *   08004 — sqlserver_rejected_establishment : Server avviste connection (rare, men transient)
 *
 * Node.js TCP-feil:
 *   ECONNREFUSED, ECONNRESET, ETIMEDOUT, EPIPE — alle transient.
 */
export const TRANSIENT_PG_SQLSTATE_CODES: ReadonlySet<string> = new Set([
  "57P01",
  "57P02",
  "57P03",
  "08001",
  "08006",
  "08000",
  "08003",
  "08004",
]);

export const TRANSIENT_NODE_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTCONN",
]);

/**
 * Subset av transient-koder som spesifikt betyr "Postgres terminated us"
 * (planlagt eller krasj). Logges som WARN ikke ERROR siden det er en
 * forventet del av prod-driften (vedlikehold/failover).
 */
export const SHUTDOWN_PG_SQLSTATE_CODES: ReadonlySet<string> = new Set([
  "57P01",
  "57P02",
  "57P03",
]);

/**
 * Hent SQLSTATE-kode fra en pg-error. node-postgres legger denne i
 * `err.code` på 5-tegns SQLSTATE-form. Returnerer null hvis ikke pg-feil.
 */
export function getPgErrorCode(err: unknown): string | null {
  if (err === null || typeof err !== "object") return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/**
 * Returner true hvis feilen er en transient connection-feil som det er
 * trygt å retry på. Brukes som default-predikat i `withDbRetry`.
 *
 * IKKE retry på query-side-feil (constraint violation, syntax error,
 * permission denied, etc.) — bare på connection-level transient-feil.
 */
export function isTransientConnectionError(err: unknown): boolean {
  const code = getPgErrorCode(err);
  if (!code) return false;
  return (
    TRANSIENT_PG_SQLSTATE_CODES.has(code) ||
    TRANSIENT_NODE_ERROR_CODES.has(code)
  );
}

/**
 * Returner true hvis feilen er en "Postgres shut us down"-variant.
 * Logges som WARN i pool-error-handler siden det er forventet ved
 * vedlikehold/failover. Subset av `isTransientConnectionError`.
 */
export function isPostgresShutdownError(err: unknown): boolean {
  const code = getPgErrorCode(err);
  if (!code) return false;
  return SHUTDOWN_PG_SQLSTATE_CODES.has(code);
}

/**
 * Spore pools vi allerede har wrappet, så `attachPoolErrorHandler` kan
 * kalles flere ganger uten duplikat-listeners.
 *
 * Bruker WeakSet — pool-instans GC-es av node-pg når den end()-es, og
 * vi vil ikke holde på referansen unødvendig.
 */
const handlerInstalledPools = new WeakSet<Pool>();

export interface AttachPoolErrorHandlerOptions {
  /**
   * Navn på pool-en for logging. Brukes til å skille mellom
   * shared-pool, wallet-pool, etc. Default `"unknown"`.
   */
  poolName?: string;
}

/**
 * Installer `error`-event-handler på en pg.Pool-instans.
 *
 * Uten denne handleren propagerer pg-errors som `uncaughtException` og
 * krasjer backend-process-en. Med handleren logges feilen strukturert
 * og pool-en re-leier connections automatisk ved neste query.
 *
 * Klassifisering:
 *   - Postgres shutdown (57P01/02/03) → WARN (forventet ved vedlikehold)
 *   - Andre transient (08xxx, ECONNxxx) → WARN
 *   - Alt annet → ERROR (uventet, ops bør undersøke)
 *
 * Idempotent — kall flere ganger på samme pool er no-op etter første.
 *
 * @returns true hvis handler ble installert, false hvis allerede installert
 */
export function attachPoolErrorHandler(
  pool: Pool,
  options: AttachPoolErrorHandlerOptions = {},
): boolean {
  if (handlerInstalledPools.has(pool)) {
    return false;
  }
  handlerInstalledPools.add(pool);

  const poolName = options.poolName ?? "unknown";

  pool.on("error", (err: Error) => {
    const code = getPgErrorCode(err);
    const isShutdown = isPostgresShutdownError(err);
    const isTransient = isTransientConnectionError(err);

    if (isShutdown) {
      // Forventet ved Postgres-vedlikehold / failover / docker-recreate.
      // pg.Pool re-creates connections automatisk på neste query.
      log.warn(
        {
          err,
          code,
          poolName,
          category: "pg-shutdown",
        },
        "[pg-pool] idle client terminated by server, will auto-reconnect on next checkout",
      );
      return;
    }

    if (isTransient) {
      // Transient TCP / connection-feil. Pool reagerer ved å fjerne
      // den døde clienten; neste query kjører på ny.
      log.warn(
        {
          err,
          code,
          poolName,
          category: "pg-transient",
        },
        "[pg-pool] transient connection error, pool will recover automatically",
      );
      return;
    }

    // Uventet pool-feil. Logges som ERROR så ops blir varslet.
    log.error(
      {
        err,
        code,
        poolName,
        category: "pg-unexpected",
      },
      "[pg-pool] unexpected error on idle client",
    );
  });

  return true;
}

/**
 * Default backoff-sekvens for transient connection-retries.
 *
 * Tre forsøk: 100ms → 250ms → 500ms = totalt ~850ms worst-case.
 *
 * Matcher task-spec for kritiske read-paths (heartbeat, room-state-fetch)
 * der vi vil tåle en flaky DB-glitch (eks. midt i en Render-failover) uten
 * å vente lenger enn nødvendig. Lengre delays (eks. fra `DEFAULT_RETRY_
 * DELAYS_MS` = [100, 500, 2000]) er overkill for read-paths — hvis Postgres
 * fortsatt er nede etter 500ms, er det neppe en "transient glitch" lenger
 * og caller-en bør håndtere feilen eksplisitt.
 */
export const DEFAULT_DB_RETRY_DELAYS_MS: ReadonlyArray<number> = [100, 250, 500];

export interface WithDbRetryOptions
  extends Omit<RetryOptions, "shouldRetry"> {
  /**
   * Custom retry-predikat. Default = `isTransientConnectionError`.
   *
   * Bruk dette hvis du vil utvide retry-listen (eks. inkludere bestemte
   * deadlock-koder for write-paths) — men husk at automatic retry på
   * mutasjoner er FARLIG uten idempotency-key. Default-predikatet
   * retry KUN på connection-level transient-feil.
   */
  shouldRetry?: (err: unknown, attemptNumber: number) => boolean;
}

/**
 * Kjør en DB-operasjon med retry på transient connection-feil.
 *
 * Bruksområde: kritiske LESE-paths (heartbeat, room-state-fetch, lobby-
 * aggregator) som ikke skal feile fordi Postgres restartet mid-flight.
 *
 * ADVARSEL — IKKE bruk på write-paths uten outbox-mønster!
 *   Automatic retry på INSERT/UPDATE kan dupliere mutasjoner hvis original
 *   query faktisk lyktes server-side før connection ble drept. Wallet- og
 *   compliance-mutasjoner har egne outbox-mønstre (BIN-761→764) som
 *   håndterer dette — IKKE wrap dem med `withDbRetry`.
 *
 * @example
 *   const result = await withDbRetry(
 *     async () => pool.query("SELECT 1 FROM app_users WHERE id = $1", [userId]),
 *     { operationName: "user-lookup" },
 *   );
 */
export async function withDbRetry<T>(
  op: () => Promise<T>,
  options: WithDbRetryOptions,
): Promise<RetryResult<T>> {
  return withRetry(op, {
    ...options,
    delaysMs: options.delaysMs ?? DEFAULT_DB_RETRY_DELAYS_MS,
    shouldRetry: options.shouldRetry ?? isTransientConnectionError,
  });
}

/**
 * @internal — test-hook. Returnerer true hvis pool er markert som "har handler",
 * brukes for å verifisere idempotens. Tester bruker fresh pool-instanser per
 * test slik at WeakSet-state ikke blir et problem.
 */
export function _hasHandlerInstalledForTesting(pool: Pool): boolean {
  return handlerInstalledPools.has(pool);
}
