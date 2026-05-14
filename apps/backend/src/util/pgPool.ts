/**
 * BIN-175: Shared PostgreSQL pool configuration.
 *
 * Reads pool tuning parameters from environment variables and returns
 * a config object that can be spread into `new Pool(...)`.
 *
 * §6.4 (Wave 3b, 2026-05-06): exposing tuning-knobs for pilot-skala-test:
 *   - `PG_POOL_MAX` — pool-størrelse (default 20). Render `basic_256mb`-plan
 *     er capet til ~30 connections totalt. Med shared pool + wallet pool
 *     kan vi ikke gå mye over 15 hver i prod uten å overstige planen.
 *     Test-miljø kan bumpes høyere (f.eks. 50) for stress-test.
 *   - `PG_POOL_CONNECTION_TIMEOUT_MS` — hvor lenge en query venter på en
 *     pool-client før den feiler. Default redusert fra 5s → 3s så
 *     pool-exhaustion blir tydelig (fail-fast) i stedet for å bygge opp
 *     en backlog som senere ramper opp p95 over 30s tick-budsjett.
 *   - `PG_POOL_IDLE_TIMEOUT_MS` — hvor lenge en idle-client kan ligge i
 *     pool før den lukkes. 30s default er trygt for pilot.
 */

import { Pool, type PoolConfig } from "pg";
import { attachPoolErrorHandler } from "./pgPoolErrorHandler.js";

export interface PgPoolTuning {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

export function getPoolTuning(): PgPoolTuning {
  return {
    max: parseIntEnv(process.env.PG_POOL_MAX, 20),
    idleTimeoutMillis: parseIntEnv(process.env.PG_POOL_IDLE_TIMEOUT_MS, 30_000),
    // §6.4: 3s fail-fast (var 5s). Pool-exhaustion under mass-payout skal
    // ikke gjemmes bak en lang timeout — vi vil ha tydelige feil + alert,
    // ikke en stille backlog som balooner p95.
    connectionTimeoutMillis: parseIntEnv(process.env.PG_POOL_CONNECTION_TIMEOUT_MS, 3_000),
  };
}

/**
 * Agent T (2026-05-14): factory som lager en pg.Pool MED standard tuning OG
 * error-handler installert.
 *
 * Brukes av services som har en fallback-path `new Pool({connectionString})`
 * når caller ikke passer en eksisterende pool. Uten error-handler propagerer
 * pg-errors (særlig 57P01 ved Postgres-vedlikehold/failover/docker-recreate)
 * som `uncaughtException` og dreper hele backend-process-en.
 *
 * Bruk slik i service-konstruktør:
 *
 *   if (options.pool) {
 *     this.pool = options.pool;
 *   } else if (options.connectionString?.trim()) {
 *     this.pool = createServicePool({
 *       connectionString: options.connectionString,
 *       poolName: "my-service-pool",
 *     });
 *   } else {
 *     throw new DomainError("INVALID_CONFIG", "...");
 *   }
 *
 * @see attachPoolErrorHandler — installerer error-handler-en
 * @see getPoolTuning — leser env-tunables (PG_POOL_MAX etc.)
 */
export function createServicePool(options: {
  connectionString: string;
  poolName: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
}): Pool {
  const poolConfig: PoolConfig = {
    connectionString: options.connectionString,
    ...getPoolTuning(),
  };
  // Behold eksisterende ssl-paritet med services som bruker
  // `ssl: options.ssl ? { rejectUnauthorized: false } : undefined`.
  // Caller kan også passere en full ssl-config hvis ønsket.
  if (options.ssl !== undefined) {
    if (options.ssl === true) {
      poolConfig.ssl = { rejectUnauthorized: false };
    } else if (options.ssl === false) {
      poolConfig.ssl = undefined;
    } else {
      poolConfig.ssl = options.ssl;
    }
  }
  const pool = new Pool(poolConfig);
  attachPoolErrorHandler(pool, { poolName: options.poolName });
  return pool;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
