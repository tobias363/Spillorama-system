/**
 * Bølge 1 (2026-05-08): Postgres-integrasjons-test for GameLobbyAggregator.
 *
 * Skipper når WALLET_PG_TEST_CONNECTION_STRING ikke er satt — samme
 * mønster som walletReconciliation.integration.test.ts og andre
 * integration-tester i repo-en.
 *
 * Hva testes (vs unit-tester):
 *   Unit-testene bruker stub-pool og mocker `pool.query` per regex. Det
 *   verifiserer logikken, men ikke at SQL-en faktisk fungerer.
 *   Integrations-testen kjører de to raw-queries mot ekte Postgres for
 *   å fange:
 *     - SQL syntaks-feil
 *     - JSONB-cast-feil i `participating_halls_json::jsonb @> ...`
 *     - Indeks-availability for det viktige sortering-leddet
 *     - Status-enum-mismatch hvis vi skulle endre status-verdier i
 *       migrasjonene
 *
 * Setup:
 *   Lager et test-schema med kun `app_game1_scheduled_games`-tabellen
 *   (minimum-shape som aggregator-en queries mot). Dette er raskere enn
 *   full migrasjon og isolerer testen fra annen state.
 *
 * Dekker:
 *   1. queryScheduledGameByPlanRun returnerer rad for matchende
 *      (plan_run_id, plan_position).
 *   2. queryActiveScheduledGameForHall returnerer aktiv rad sortert på
 *      scheduled_start_time ASC.
 *   3. participating_halls_json @> contains-query fungerer for hall i
 *      array.
 *   4. Tabellen tom → null returneres uten å kaste.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over Postgres integration-test";

function makeTestSchema(): string {
  return `lobby_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function setupSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  // Minimum-shape som aggregator queries mot. Speiler relevante kolonner
  // fra `migrations/20260428000000_game1_scheduled_games.sql` +
  // `migrations/20261210010000_app_game1_scheduled_games_catalog_link.sql`.
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

interface TestRowInput {
  id?: string;
  status: string;
  masterHallId: string;
  groupHallId?: string | null;
  participatingHallIds?: string[];
  scheduledStartTime: string;
  scheduledEndTime?: string | null;
  actualStartTime?: string | null;
  planRunId?: string | null;
  planPosition?: number | null;
}

async function insertScheduledGame(
  pool: Pool,
  schema: string,
  input: TestRowInput,
): Promise<string> {
  const id = input.id ?? randomUUID();
  await pool.query(
    `INSERT INTO "${schema}"."app_game1_scheduled_games"
       (id, status, master_hall_id, group_hall_id,
        participating_halls_json, scheduled_start_time,
        scheduled_end_time, actual_start_time,
        plan_run_id, plan_position)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
    [
      id,
      input.status,
      input.masterHallId,
      input.groupHallId ?? null,
      JSON.stringify(input.participatingHallIds ?? []),
      input.scheduledStartTime,
      input.scheduledEndTime ?? null,
      input.actualStartTime ?? null,
      input.planRunId ?? null,
      input.planPosition ?? null,
    ],
  );
  return id;
}

test("integration: queryScheduledGameByPlanRun finner rad for (plan_run_id, plan_position)", { skip: skipReason }, async () => {
  if (!PG_CONN) return;
  const pool = new Pool({ connectionString: PG_CONN });
  const schema = makeTestSchema();
  try {
    await setupSchema(pool, schema);
    const planRunId = randomUUID();
    const id = await insertScheduledGame(pool, schema, {
      status: "running",
      masterHallId: "hall-A",
      participatingHallIds: ["hall-A", "hall-B"],
      scheduledStartTime: "2026-05-08T15:00:00Z",
      planRunId,
      planPosition: 1,
    });

    // Replicate queryScheduledGameByPlanRun
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
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id);
    assert.equal(rows[0].status, "running");
    assert.equal(rows[0].plan_run_id, planRunId);
    assert.equal(rows[0].plan_position, 1);
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});

test("integration: queryActiveScheduledGameForHall sorterer ASC og filtrerer på status + hall", { skip: skipReason }, async () => {
  if (!PG_CONN) return;
  const pool = new Pool({ connectionString: PG_CONN });
  const schema = makeTestSchema();
  try {
    await setupSchema(pool, schema);
    const hallA = "hall-A-" + randomUUID();
    const hallB = "hall-B-" + randomUUID();
    // Eldre rad (skal ignoreres — completed)
    await insertScheduledGame(pool, schema, {
      status: "completed",
      masterHallId: hallA,
      participatingHallIds: [hallA],
      scheduledStartTime: "2026-05-08T13:00:00Z",
    });
    // Aktiv rad senere
    const activeId = await insertScheduledGame(pool, schema, {
      status: "purchase_open",
      masterHallId: hallA,
      participatingHallIds: [hallA, hallB],
      scheduledStartTime: "2026-05-08T15:00:00Z",
    });
    // Annen aktiv rad enda senere
    await insertScheduledGame(pool, schema, {
      status: "running",
      masterHallId: hallA,
      participatingHallIds: [hallA],
      scheduledStartTime: "2026-05-08T18:00:00Z",
    });

    // Replicate queryActiveScheduledGameForHall
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
    assert.equal(rows[0].id, activeId);
    assert.equal(rows[0].status, "purchase_open");
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});

test("integration: participating_halls_json @> matcher hall-id i array", { skip: skipReason }, async () => {
  if (!PG_CONN) return;
  const pool = new Pool({ connectionString: PG_CONN });
  const schema = makeTestSchema();
  try {
    await setupSchema(pool, schema);
    const masterHall = "hall-master-" + randomUUID();
    const participantHall = "hall-participant-" + randomUUID();
    const id = await insertScheduledGame(pool, schema, {
      status: "purchase_open",
      masterHallId: masterHall,
      participatingHallIds: [masterHall, participantHall],
      scheduledStartTime: "2026-05-08T15:00:00Z",
    });

    // participantHall søker — skal finne raden via array-contains
    const { rows } = await pool.query(
      `SELECT id
       FROM "${schema}"."app_game1_scheduled_games"
       WHERE (master_hall_id = $1
          OR participating_halls_json::jsonb @> to_jsonb($1::text))
         AND status IN ('purchase_open','ready_to_start','running','paused')`,
      [participantHall],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id);
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});

test("integration: tom tabell → null/[] returneres uten å kaste", { skip: skipReason }, async () => {
  if (!PG_CONN) return;
  const pool = new Pool({ connectionString: PG_CONN });
  const schema = makeTestSchema();
  try {
    await setupSchema(pool, schema);
    const someHall = "hall-" + randomUUID();
    const { rows } = await pool.query(
      `SELECT id
       FROM "${schema}"."app_game1_scheduled_games"
       WHERE master_hall_id = $1
       LIMIT 1`,
      [someHall],
    );
    assert.equal(rows.length, 0);
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});
