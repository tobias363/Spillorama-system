/**
 * Regresjons-test for PITFALLS §4.4 — `GamePlanEngineBridge` cancelled-rad-
 * gjenbruk.
 *
 * Status pr 2026-05-12: **LUKKET** av PR `fix/spill1-bridge-cancelled-row-
 * reuse-2026-05-12`. PITFALLS §4.4 lukkes når denne PR mergees.
 *
 * PITFALLS §4.4 symptom (pre-fix):
 *   Mark-ready feiler med `GAME_NOT_READY_ELIGIBLE: 'cancelled'` etter at
 *   runde har vært cancelled tidligere samme dag.
 *
 * Root cause (pre-fix):
 *   `createScheduledGameForPlanRunPosition` gjenbruker eksisterende rader
 *   på `(plan_run_id, plan_position)` uten status-filter.
 *
 * Fix (landet i denne PR):
 *   Idempotency-SELECT filtrerer `WHERE status NOT IN ('cancelled',
 *   'completed')`. Da plukker den kun aktive rader (scheduled |
 *   purchase_open | ready_to_start | running | paused). Cancelled/
 *   completed rader regnes som historiske og forhindrer ikke ny spawn.
 *
 * Denne test-suiten:
 *   1. Verifiserer fix-en strukturelt:
 *      a) Cancelled rad finnes for (run, pos) → bridgen SPAWNER NY RAD
 *         (ikke gjenbruker).
 *      b) Completed rad finnes for (run, pos) → samme regel.
 *   2. Positiv kontroll: aktive rader gjenbrukes fortsatt idempotent
 *      (MasterActionService retry-pathen virker).
 *
 * Test-strategi:
 *   Integration-test mot ekte Postgres (samme pattern som
 *   multiGoHIntegration.test.ts). Bridgen leser idempotency-state via
 *   raw SQL, så stub-pool tester ikke faktisk DB-state-pathen.
 *
 * Skip-betingelse:
 *   WALLET_PG_TEST_CONNECTION_STRING må være satt.
 *
 * Hvis disse tester begynner å feile igjen, har noen fjernet status-
 * filteret fra idempotency-SELECT — det er en regresjon av PITFALLS §4.4.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { GameCatalogService } from "../GameCatalogService.js";
import { GamePlanService } from "../GamePlanService.js";
import { GamePlanRunService } from "../GamePlanRunService.js";
import { GamePlanEngineBridge } from "../GamePlanEngineBridge.js";
import type { GameCatalogEntry } from "../gameCatalog.types.js";
import type { GamePlanWithItems } from "../gamePlan.types.js";

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over cancelled-row-reuse-test";

function makeTestSchema(): string {
  return `cancelled_reuse_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function setupSchema(pool: Pool, schema: string): Promise<void> {
  // Samme schema-shape som GamePlanEngineBridge.multiGoHIntegration.test.ts
  await pool.query(`CREATE SCHEMA "${schema}"`);

  await pool.query(`
    CREATE TABLE "${schema}"."app_halls" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true
    )
  `);

  await pool.query(`
    CREATE TABLE "${schema}"."app_hall_groups" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      master_hall_id TEXT NULL REFERENCES "${schema}"."app_halls"(id) ON DELETE SET NULL,
      deleted_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE "${schema}"."app_hall_group_members" (
      group_id TEXT NOT NULL REFERENCES "${schema}"."app_hall_groups"(id) ON DELETE CASCADE,
      hall_id TEXT NOT NULL REFERENCES "${schema}"."app_halls"(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, hall_id)
    )
  `);

  await pool.query(`
    CREATE TABLE "${schema}"."app_game_plan_run" (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      hall_id TEXT NOT NULL,
      business_date DATE NOT NULL,
      jackpot_overrides_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'running'
    )
  `);

  await pool.query(`
    CREATE TABLE "${schema}"."app_game_catalog" (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true
    )
  `);

  await pool.query(`
    CREATE TABLE "${schema}"."app_game1_scheduled_games" (
      id TEXT PRIMARY KEY,
      daily_schedule_id TEXT NULL,
      schedule_id TEXT NULL,
      sub_game_index INTEGER NOT NULL CHECK (sub_game_index >= 0),
      sub_game_name TEXT NOT NULL,
      custom_game_name TEXT NULL,
      scheduled_day DATE NOT NULL,
      scheduled_start_time TIMESTAMPTZ NOT NULL,
      scheduled_end_time TIMESTAMPTZ NOT NULL,
      notification_start_seconds INTEGER NOT NULL CHECK (notification_start_seconds >= 0),
      ticket_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      jackpot_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      game_mode TEXT NOT NULL CHECK (game_mode IN ('Auto','Manual')),
      master_hall_id TEXT NOT NULL REFERENCES "${schema}"."app_halls"(id) ON DELETE RESTRICT,
      group_hall_id TEXT NOT NULL REFERENCES "${schema}"."app_hall_groups"(id) ON DELETE CASCADE,
      participating_halls_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','purchase_open','ready_to_start','running','paused','completed','cancelled')),
      actual_start_time TIMESTAMPTZ NULL,
      actual_end_time TIMESTAMPTZ NULL,
      started_by_user_id TEXT NULL,
      excluded_hall_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      stopped_by_user_id TEXT NULL,
      stop_reason TEXT NULL,
      game_config_json JSONB NULL,
      catalog_entry_id TEXT NULL REFERENCES "${schema}"."app_game_catalog"(id) ON DELETE SET NULL,
      plan_run_id TEXT NULL REFERENCES "${schema}"."app_game_plan_run"(id) ON DELETE SET NULL,
      plan_position INTEGER NULL CHECK (plan_position IS NULL OR plan_position >= 1),
      room_code TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX "idx_room_code_${schema}"
      ON "${schema}"."app_game1_scheduled_games" (room_code)
      WHERE room_code IS NOT NULL
        AND status NOT IN ('completed', 'cancelled')
  `);

  await pool.query(`
    CREATE TABLE "${schema}"."app_game1_master_audit" (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES "${schema}"."app_game1_scheduled_games"(id) ON DELETE RESTRICT,
      action TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      actor_hall_id TEXT NOT NULL,
      group_hall_id TEXT NOT NULL,
      halls_ready_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

interface TestEnv {
  pool: Pool;
  schema: string;
  groupId: string;
  masterHallId: string;
  runId: string;
  catalogId: string;
  planId: string;
  bridge: GamePlanEngineBridge;
}

async function setupTestEnv(): Promise<TestEnv> {
  const pool = new Pool({ connectionString: PG_CONN!, max: 5 });
  const schema = makeTestSchema();
  await setupSchema(pool, schema);

  const groupId = "test-group";
  const masterHallId = "test-master-hall";
  const planId = "test-plan";
  const catalogId = "test-catalog";
  const runId = `test-run-${randomUUID()}`;
  const businessDate = new Date().toISOString().slice(0, 10);

  await pool.query(
    `INSERT INTO "${schema}"."app_halls" (id, name, is_active) VALUES ($1, $1, true)`,
    [masterHallId],
  );
  await pool.query(
    `INSERT INTO "${schema}"."app_hall_groups" (id, name, master_hall_id, status) VALUES ($1, $1, $2, 'active')`,
    [groupId, masterHallId],
  );
  await pool.query(
    `INSERT INTO "${schema}"."app_hall_group_members" (group_id, hall_id) VALUES ($1, $2)`,
    [groupId, masterHallId],
  );
  await pool.query(
    `INSERT INTO "${schema}"."app_game_catalog" (id, slug, display_name, is_active) VALUES ($1, 'innsatsen', 'Innsatsen', true)`,
    [catalogId],
  );
  await pool.query(
    `INSERT INTO "${schema}"."app_game_plan_run"
       (id, plan_id, hall_id, business_date, jackpot_overrides_json)
     VALUES ($1, $2, $3, $4::date, '{}'::jsonb)`,
    [runId, planId, masterHallId, businessDate],
  );

  const catalog: GameCatalogEntry = {
    id: catalogId,
    slug: "innsatsen",
    displayName: "Innsatsen",
    description: null,
    rules: {},
    ticketColors: ["gul", "hvit"],
    ticketPricesCents: { gul: 1000, hvit: 500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 50000 },
    },
    prizeMultiplierMode: "explicit_per_color",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-12T12:00:00Z",
    updatedAt: "2026-05-12T12:00:00Z",
    createdByUserId: "u-test",
  };

  const plan: GamePlanWithItems = {
    id: planId,
    name: "Test Plan",
    description: null,
    hallId: masterHallId,
    groupOfHallsId: null,
    weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    startTime: "11:00",
    endTime: "21:00",
    isActive: true,
    createdAt: "2026-05-12T12:00:00Z",
    updatedAt: "2026-05-12T12:00:00Z",
    createdByUserId: "u-test",
    items: [
      {
        id: "item-1",
        planId,
        position: 1,
        gameCatalogId: catalogId,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-12T12:00:00Z",
        catalogEntry: catalog,
      },
    ],
  };

  const catalogSvc = Object.create(
    GameCatalogService.prototype,
  ) as GameCatalogService;
  (catalogSvc as unknown as { pool: unknown }).pool = pool;
  (catalogSvc as unknown as { schema: string }).schema = schema;
  (catalogSvc as unknown as { auditLogService: null }).auditLogService = null;
  (catalogSvc as unknown as {
    getById: (id: string) => Promise<GameCatalogEntry | null>;
  }).getById = async (id) => (id === catalogId ? catalog : null);

  const planSvc = Object.create(GamePlanService.prototype) as GamePlanService;
  (planSvc as unknown as { pool: unknown }).pool = pool;
  (planSvc as unknown as { schema: string }).schema = schema;
  (planSvc as unknown as { auditLogService: null }).auditLogService = null;
  (planSvc as unknown as {
    catalogService: GameCatalogService;
  }).catalogService = catalogSvc;
  (planSvc as unknown as {
    getById: (id: string) => Promise<GamePlanWithItems | null>;
  }).getById = async (id) => (id === planId ? plan : null);

  const runSvc = Object.create(
    GamePlanRunService.prototype,
  ) as GamePlanRunService;
  (runSvc as unknown as { pool: unknown }).pool = pool;
  (runSvc as unknown as { schema: string }).schema = schema;

  const bridge = GamePlanEngineBridge.forTesting({
    pool,
    schema,
    catalogService: catalogSvc,
    planService: planSvc,
    planRunService: runSvc,
  });

  return {
    pool,
    schema,
    groupId,
    masterHallId,
    runId,
    catalogId,
    planId,
    bridge,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

test(
  "PITFALLS §4.4 regresjon: bridge skal IKKE gjenbruke en cancelled rad på samme (run, position)",
  {
    skip: skipReason,
    // 2026-05-12: PITFALLS §4.4 lukket av PR `fix/spill1-bridge-cancelled-
    // row-reuse-2026-05-12`. Bridge sin idempotency-SELECT filtrerer nå
    // `status NOT IN ('cancelled','completed')`, så denne test-en er nå
    // BLOKKERENDE (todo-flagget er fjernet). Hvis filteret blir borte
    // igjen, faller test-en og fanger regresjonen.
    timeout: 30_000,
  },
  async () => {
    if (!PG_CONN) return;
    const env = await setupTestEnv();
    try {
      // Steg 1: spawn første scheduled-game.
      const first = await env.bridge.createScheduledGameForPlanRunPosition(
        env.runId,
        1,
      );
      assert.equal(first.reused, false, "Første spawn skal ikke være reused");

      // Steg 2: cancel den manuelt (simulerer master.stopGame eller
      // recovery-cron som markerte runde som cancelled).
      await env.pool.query(
        `UPDATE "${env.schema}"."app_game1_scheduled_games"
           SET status = 'cancelled',
               stop_reason = 'master_stop',
               actual_end_time = now()
         WHERE id = $1`,
        [first.scheduledGameId],
      );

      // Verifiser at den ble cancelled
      const { rows: pre } = await env.pool.query<{ status: string }>(
        `SELECT status FROM "${env.schema}"."app_game1_scheduled_games" WHERE id = $1`,
        [first.scheduledGameId],
      );
      assert.equal(pre[0]!.status, "cancelled");

      // Steg 3: master prøver å starte runde N+1 (samme position 1). I
      // praksis er dette `/api/agent/game-plan/advance` som looper på
      // samme position etter en cancellation, eller en re-start etter
      // crash. Bridgen skal IKKE gjenbruke den cancelled raden — det
      // er bug-en.
      const second = await env.bridge.createScheduledGameForPlanRunPosition(
        env.runId,
        1,
      );

      // FORVENTET ATFERD (når bug-en er fikset):
      //   - second.reused === false (ny rad spawnet)
      //   - second.scheduledGameId !== first.scheduledGameId
      //   - DB skal ha 1 cancelled + 1 active rad for (run, position)
      //
      // FAKTISK ATFERD (pre-fix, ÅPEN BUG):
      //   - second.reused === true
      //   - second.scheduledGameId === first.scheduledGameId
      //   - Klient prøver å markere ready → GAME_NOT_READY_ELIGIBLE
      //     fordi raden er cancelled
      assert.equal(
        second.reused,
        false,
        "Bridge skal IKKE gjenbruke cancelled rad — den er strukturelt ulik en aktiv rad",
      );
      assert.notEqual(
        second.scheduledGameId,
        first.scheduledGameId,
        "Ny scheduled-game skal ha NY id (ikke gjenbruke cancelled)",
      );

      const { rows: post } = await env.pool.query<{
        status: string;
        count: string;
      }>(
        `SELECT status, count(*)::text AS count
         FROM "${env.schema}"."app_game1_scheduled_games"
         WHERE plan_run_id = $1 AND plan_position = 1
         GROUP BY status`,
        [env.runId],
      );
      const byStatus = Object.fromEntries(
        post.map((r) => [r.status, Number(r.count)]),
      );
      assert.equal(byStatus.cancelled, 1, "Den gamle cancelled raden består");
      assert.equal(
        byStatus.ready_to_start,
        1,
        "Den nye raden er aktiv (ready_to_start)",
      );
    } finally {
      await dropSchema(env.pool, env.schema);
      await env.pool.end();
    }
  },
);

test(
  "PITFALLS §4.4 regresjon: completed rad → bridge skal også spawne ny (samme prinsipp)",
  {
    skip: skipReason,
    // 2026-05-12: PITFALLS §4.4 lukket — se kommentaren over. Også
    // `completed`-pathen er nå dekket av samme fix (status-filter
    // ekskluderer både 'cancelled' og 'completed').
    timeout: 30_000,
  },
  async () => {
    if (!PG_CONN) return;
    const env = await setupTestEnv();
    try {
      const first = await env.bridge.createScheduledGameForPlanRunPosition(
        env.runId,
        1,
      );
      assert.equal(first.reused, false);

      // Marker som completed (naturlig runde-slutt)
      await env.pool.query(
        `UPDATE "${env.schema}"."app_game1_scheduled_games"
           SET status = 'completed', actual_end_time = now()
         WHERE id = $1`,
        [first.scheduledGameId],
      );

      // Spawn igjen for samme (run, position). Forventer ny rad.
      const second = await env.bridge.createScheduledGameForPlanRunPosition(
        env.runId,
        1,
      );
      assert.equal(
        second.reused,
        false,
        "Bridge skal spawne ny rad når existing er completed",
      );
      assert.notEqual(second.scheduledGameId, first.scheduledGameId);
    } finally {
      await dropSchema(env.pool, env.schema);
      await env.pool.end();
    }
  },
);

// ── Positive control: idempotency-pathen virker fortsatt for AKTIVE rader ─

test(
  "PITFALLS §4.4 positiv kontroll: idempotent reuse virker for AKTIVE rader",
  {
    skip: skipReason,
    timeout: 30_000,
  },
  async () => {
    if (!PG_CONN) return;
    const env = await setupTestEnv();
    try {
      const first = await env.bridge.createScheduledGameForPlanRunPosition(
        env.runId,
        1,
      );
      assert.equal(first.reused, false, "Første spawn er ikke reused");

      // Andre kall på samme (run, pos) → skal returnere samme id som reuse
      // (idempotency for å støtte retry-pathen i MasterActionService).
      const second = await env.bridge.createScheduledGameForPlanRunPosition(
        env.runId,
        1,
      );
      assert.equal(
        second.reused,
        true,
        "Andre kall på samme aktiv rad skal være idempotent reuse",
      );
      assert.equal(
        second.scheduledGameId,
        first.scheduledGameId,
        "Reuse må returnere SAMME scheduledGameId",
      );

      const { rows } = await env.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM "${env.schema}"."app_game1_scheduled_games"
         WHERE plan_run_id = $1 AND plan_position = 1`,
        [env.runId],
      );
      assert.equal(
        Number(rows[0]!.count),
        1,
        "Kun ÉN scheduled-game-rad skal finnes",
      );
    } finally {
      await dropSchema(env.pool, env.schema);
      await env.pool.end();
    }
  },
);
