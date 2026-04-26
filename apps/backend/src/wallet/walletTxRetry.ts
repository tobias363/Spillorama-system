/**
 * BIN-762: REPEATABLE READ / SERIALIZABLE isolation + retry på 40001/40P01
 *
 * Industri-standard fra Pragmatic Play / Evolution: kjør wallet-write-paths
 * under en sterkere isolation-level enn Postgres-default `READ COMMITTED`,
 * og retry på serialization-konflikt-feil. Dette gir phantom-read-protection
 * og dekker race-vinduer som ikke er beskyttet av eksisterende `FOR UPDATE`.
 *
 * SQLState-koder:
 *   - `40001` = serialization_failure (forekommer i REPEATABLE READ + SERIALIZABLE
 *               når concurrent transaksjon ville bryte isolation)
 *   - `40P01` = deadlock_detected
 *
 * Bruk:
 *   await withWalletTx(pool, async (client) => {
 *     await client.query("UPDATE wallet ...");
 *     return result;
 *   });
 *
 * Default: REPEATABLE READ. Opt-in til SERIALIZABLE via `options.isolation`.
 * Default: 3 retries med exponential backoff (50/150/450ms + jitter).
 *
 * Etter 3 retries kaster vi `WALLET_SERIALIZATION_FAILURE` (norsk feilmelding).
 *
 * Logging: hver retry logges med correlation-id (pino + redaction håndterer
 * sensitive felt automatisk).
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { WalletError } from "../adapters/WalletAdapter.js";
import { logger } from "../util/logger.js";

const log = logger.child({ module: "walletTxRetry" });

export type WalletTxIsolation = "REPEATABLE READ" | "SERIALIZABLE";

export interface WithWalletTxOptions {
  /** Isolation-level. Default: "REPEATABLE READ". */
  isolation?: WalletTxIsolation;
  /** Max retries på 40001/40P01. Default: 3. */
  maxRetries?: number;
  /**
   * Correlation-id for logging. Auto-generert hvis ikke satt.
   * Bør propageres fra request-context der mulig.
   */
  correlationId?: string;
  /**
   * Backoff-funksjon (ms) per retry-attempt (0-indexed).
   * Default: exponential med jitter — 50ms, 150ms, 450ms.
   * Eksposert for testing (mock-able).
   */
  backoffMs?: (attempt: number) => number;
  /**
   * Setter (ms → Promise<void>) — eksposert for testing slik at vi kan unngå
   * faktiske timer-ventinger. I prod brukes setTimeout.
   */
  sleepFn?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_ISOLATION: WalletTxIsolation = "REPEATABLE READ";

const SQLSTATE_SERIALIZATION_FAILURE = "40001";
const SQLSTATE_DEADLOCK_DETECTED = "40P01";

/**
 * Default backoff: 50ms, 150ms, 450ms (exponential med liten jitter).
 * Holder samlet maks-ventetid <650ms for tre retries — pilot-akseptabelt
 * for hot-path latency P99-budsjett.
 */
function defaultBackoff(attempt: number): number {
  const base = 50 * Math.pow(3, attempt); // 50, 150, 450
  const jitter = Math.floor(Math.random() * 50); // 0-49ms
  return Math.min(base + jitter, 500);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hent SQLState-kode fra pg-driver-feil. pg-feil har `code` som streng.
 */
function getSqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if (!("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Avgjør om en feil er retry-bar — kun serialization-failure og deadlock.
 * Andre feil (constraint, INSUFFICIENT_FUNDS, etc.) skal aldri retries.
 */
function isRetryableError(error: unknown): boolean {
  const code = getSqlState(error);
  return code === SQLSTATE_SERIALIZATION_FAILURE || code === SQLSTATE_DEADLOCK_DETECTED;
}

/**
 * Kjør `fn` i en wallet-transaksjon med REPEATABLE READ (default) eller
 * SERIALIZABLE isolation. Retry på 40001/40P01 inntil `maxRetries`.
 *
 * COMMIT/ROLLBACK håndteres her — `fn` skal IKKE selv kalle BEGIN/COMMIT.
 *
 * Etter `maxRetries` mislykkete retries kastes `WalletError`
 * med code `WALLET_SERIALIZATION_FAILURE`.
 */
export async function withWalletTx<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
  options?: WithWalletTxOptions,
): Promise<T> {
  const isolation = options?.isolation ?? DEFAULT_ISOLATION;
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const correlationId = options?.correlationId ?? randomUUID();
  const backoffMs = options?.backoffMs ?? defaultBackoff;
  const sleepFn = options?.sleepFn ?? defaultSleep;

  // Attempt 0 = initial try, attempts 1..maxRetries = retries.
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const client = await pool.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;
      // Sett isolation-level på denne transaksjonen. Må komme før første
      // data-statement for å ta effekt — vi gjør det rett etter BEGIN.
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);

      const result = await fn(client);

      await client.query("COMMIT");
      inTransaction = false;

      if (attempt > 0) {
        log.info(
          { correlationId, attempt, isolation },
          "wallet-tx succeeded after retry",
        );
      }
      return result;
    } catch (error) {
      // Forsøk å rolle tilbake — ignorér feil her (transaksjonen kan
      // allerede være avbrutt av Postgres ved 40001).
      if (inTransaction) {
        await client.query("ROLLBACK").catch(() => undefined);
      }

      const sqlState = getSqlState(error);
      const retryable = isRetryableError(error);

      if (!retryable) {
        // Ikke serialization-feil — propagér umiddelbart.
        throw error;
      }

      if (attempt >= maxRetries) {
        // Tom for retries — log og kast WALLET_SERIALIZATION_FAILURE.
        log.error(
          { correlationId, attempt, sqlState, isolation },
          "wallet-tx serialization-failure: tom for retries",
        );
        throw new WalletError(
          "WALLET_SERIALIZATION_FAILURE",
          "Lommebok-operasjon kunne ikke fullføres. Prøv igjen.",
        );
      }

      // Logg retry-forsøk og vent med backoff før neste attempt.
      const wait = backoffMs(attempt);
      log.warn(
        {
          correlationId,
          attempt,
          nextAttempt: attempt + 1,
          maxRetries,
          sqlState,
          backoffMs: wait,
          isolation,
        },
        "wallet-tx serialization-failure: retry",
      );
      await sleepFn(wait);
    } finally {
      client.release();
    }
  }

  // Skal aldri nås — løkken kaster eller returnerer alltid. Men TS krever det.
  /* istanbul ignore next */
  throw new WalletError(
    "WALLET_SERIALIZATION_FAILURE",
    "Lommebok-operasjon kunne ikke fullføres. Prøv igjen.",
  );
}

/** Eksponert for testing — la tester sjekke at klassifisering er riktig. */
export const __testing = {
  isRetryableError,
  getSqlState,
  defaultBackoff,
  SQLSTATE_SERIALIZATION_FAILURE,
  SQLSTATE_DEADLOCK_DETECTED,
};
