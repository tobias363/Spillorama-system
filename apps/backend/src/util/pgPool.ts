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

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
