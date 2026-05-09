/**
 * F-NEW-3 regression-test (2026-05-09).
 *
 * Bug:
 *   GameLobbyAggregator.queryScheduledGameByPlanRun og
 *   queryActiveScheduledGameForHall SELECTer `pause_reason` fra
 *   `app_game1_scheduled_games` (apps/backend/src/game/GameLobbyAggregator.ts:586,611).
 *   Migrasjonen som lager kolonnen mangler. Postgres svarer med
 *   error code 42703 (column does not exist). Catch-blokken
 *   (linjer 593-601 / 621-628) returnerer null silent. Det manifesterer
 *   som falsk BRIDGE_FAILED-warning i lobby-state, som blokkerer ALLE
 *   master-actions via MasterActionService sin pre-validering.
 *
 * Fix:
 *   Migration `20261218000000_app_game1_scheduled_games_pause_reason.sql`
 *   legger til kolonnen `pause_reason TEXT NULL`.
 *
 * Hva testen verifiserer:
 *   1. Etter migrasjon: SELECT med pause_reason fungerer uten 42703-feil.
 *      Mest direkte test mot regression — hvis migrasjonen rulles tilbake
 *      eller en fremtidig agent dropper kolonnen, feiler denne testen
 *      med Postgres error code 42703 i stedet for silent null-fallback.
 *   2. Returnert rad har `pause_reason`-felt (kan være null eller string).
 *   3. Begge query-shapes som GameLobbyAggregator bruker fungerer:
 *      - WHERE plan_run_id = $1 AND plan_position = $2
 *      - WHERE master_hall_id = $1 AND status IN (...) ORDER BY ASC
 *
 * Skipper når WALLET_PG_TEST_CONNECTION_STRING ikke er satt — samme
 * mønster som GameLobbyAggregator.integration.test.ts og andre
 * integration-tester i repo-en.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over Postgres regression-test";

function makeTestSchema(): string {
  return `pause_reason_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/**
 * Setter opp et test-schema med samme `app_game1_scheduled_games`-shape
 * som baseline + F-NEW-3-migrasjonen. Hvis fix-en blir reversert
 * (kolonnen droppet), feiler oppsettet eller SELECT-en med 42703.
 */
async function setupSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`
    CREATE TABLE "${schema}"."app_game1_scheduled_games" (
      id UUID PRIMARY KEY,
      status TEXT NOT NULL,
      master_hall_id TEXT NOT NULL,
      group_hall_id TEXT,
      participating_halls_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      scheduled_start_time TIMESTAMPTZ NOT NULL,
      scheduled_end_time TIMESTAMPTZ,
      actual_start_time TIMESTAMPTZ,
      actual_end_time TIMESTAMPTZ,
      plan_run_id UUID,
      plan_position INTEGER,
      pause_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

test(
  "F-NEW-3 regression: queryScheduledGameByPlanRun-shape SELECTer pause_reason uten 42703",
  { skip: skipReason },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);
      const id = randomUUID();
      const planRunId = randomUUID();
      await pool.query(
        `INSERT INTO "${schema}"."app_game1_scheduled_games"
           (id, status, master_hall_id, scheduled_start_time,
            plan_run_id, plan_position, pause_reason)
         VALUES ($1, 'paused', 'hall-A', '2026-05-09T15:00:00Z',
                 $2, 1, 'master_pause_test')`,
        [id, planRunId],
      );

      // Eksakt query-shape fra GameLobbyAggregator.queryScheduledGameByPlanRun
      // (apps/backend/src/game/GameLobbyAggregator.ts:582-591).
      const { rows } = await pool.query(
        `SELECT id, status, master_hall_id, group_hall_id,
                participating_halls_json, scheduled_start_time,
                scheduled_end_time, actual_start_time, actual_end_time,
                plan_run_id, plan_position, pause_reason
         FROM "${schema}"."app_game1_scheduled_games"
         WHERE plan_run_id = $1 AND plan_position = $2
         LIMIT 1`,
        [planRunId, 1],
      );

      assert.equal(rows.length, 1, "én rad forventet");
      assert.equal(rows[0].id, id);
      assert.equal(rows[0].status, "paused");
      assert.equal(
        rows[0].pause_reason,
        "master_pause_test",
        "pause_reason må returneres med samme verdi som ble satt",
      );
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "F-NEW-3 regression: queryActiveScheduledGameForHall-shape SELECTer pause_reason uten 42703",
  { skip: skipReason },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);
      const hallA = "hall-" + randomUUID();
      const id = randomUUID();
      await pool.query(
        `INSERT INTO "${schema}"."app_game1_scheduled_games"
           (id, status, master_hall_id, participating_halls_json,
            scheduled_start_time, pause_reason)
         VALUES ($1, 'running', $2, $3::jsonb,
                 '2026-05-09T15:00:00Z', NULL)`,
        [id, hallA, JSON.stringify([hallA])],
      );

      // Eksakt query-shape fra GameLobbyAggregator.queryActiveScheduledGameForHall
      // (apps/backend/src/game/GameLobbyAggregator.ts:607-619).
      const { rows } = await pool.query(
        `SELECT id, status, master_hall_id, group_hall_id,
                participating_halls_json, scheduled_start_time,
                scheduled_end_time, actual_start_time, actual_end_time,
                plan_run_id, plan_position, pause_reason
         FROM "${schema}"."app_game1_scheduled_games"
         WHERE (master_hall_id = $1
            OR participating_halls_json::jsonb @> to_jsonb($1::text))
           AND status IN ('purchase_open','ready_to_start','running','paused')
         ORDER BY scheduled_start_time ASC
         LIMIT 1`,
        [hallA],
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, id);
      assert.equal(
        rows[0].pause_reason,
        null,
        "pause_reason må returneres som null når kolonnen ikke er satt — viktig: NULL er gyldig, ikke 42703-error",
      );
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "F-NEW-3 regression: pause_reason-kolonnen aksepterer string-verdi (ikke bare NULL)",
  { skip: skipReason },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);
      const id = randomUUID();
      // Legg inn en verdi som matcher MasterActionService.pause sin
      // pause-reason-shape (jf. apps/backend/src/game/MasterActionService.ts).
      await pool.query(
        `INSERT INTO "${schema}"."app_game1_scheduled_games"
           (id, status, master_hall_id, scheduled_start_time, pause_reason)
         VALUES ($1, 'paused', 'hall-A', '2026-05-09T15:00:00Z',
                 'master_action: agent decided to pause for break')`,
        [id],
      );

      const { rows } = await pool.query(
        `SELECT pause_reason FROM "${schema}"."app_game1_scheduled_games"
         WHERE id = $1`,
        [id],
      );
      assert.equal(rows.length, 1);
      assert.equal(
        rows[0].pause_reason,
        "master_action: agent decided to pause for break",
      );
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);
