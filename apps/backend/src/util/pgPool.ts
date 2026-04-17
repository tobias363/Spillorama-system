/**
 * BIN-175: Shared PostgreSQL pool configuration.
 *
 * Reads pool tuning parameters from environment variables and returns
 * a config object that can be spread into `new Pool(...)`.
 */

export interface PgPoolTuning {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

export function getPoolTuning(): PgPoolTuning {
  return {
    max: parseIntEnv(process.env.PG_POOL_MAX, 20),
    idleTimeoutMillis: parseIntEnv(process.env.PG_POOL_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: parseIntEnv(process.env.PG_POOL_CONNECTION_TIMEOUT_MS, 5_000),
  };
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
