/**
 * Multi-GoH integrasjons-test for GamePlanEngineBridge (Tobias 2026-05-12).
 *
 * Pilot-blokker som drev disse testene:
 *   PR #1253 (commit c8e12911) introduserte `releaseStaleRoomCodeBindings`-
 *   pre-pass i `createScheduledGameForPlanRunPosition`. Eksisterende unit-
 *   tests (`GamePlanEngineBridge.takeover.test.ts`) bruker stub-pool og
 *   verifiserer logikken, men:
 *     - SQL kjøres ikke mot ekte Postgres (unique-indeksen testes ikke)
 *     - Concurrency mellom parallelle GoHs testes ikke
 *     - Audit-trail (app_game1_master_audit) skrives faktisk ikke
 *
 * Denne test-suiten dekker det ortogonale gapet:
 *   1. Multi-GoH isolasjon (5-6 parallelle): hver GoH får UNIK
 *      `BINGO_<GROUP-ID>` room_code, ingen kryss-konflikt.
 *   2. Race-condition for samme GoH: 2 samtidige bridge-spawns for samme
 *      (run, position) → én lykkes, andre returnerer idempotent reuse.
 *   3. Stale-state recovery: pre-eksisterende aktiv rad med samme
 *      room_code men annen (run, position) → cancelles automatisk med
 *      audit-spor `auto_cancelled_by_bridge_takeover`.
 *   4. Unique-index håndhevelse: to aktive rader med samme room_code er
 *      strukturelt umulig (verifiserer migrasjon
 *      `20261221000000_app_game1_scheduled_games_room_code_active_only.sql`).
 *
 * Skip-betingelse:
 *   Kjører kun når `WALLET_PG_TEST_CONNECTION_STRING` er satt — samme
 *   mønster som `GameLobbyAggregator.integration.test.ts` og
 *   `PostgresWalletAdapter.reservation.test.ts`.
 *
 * Schema-strategi:
 *   Per-test schema med minimum-shape:
 *     - app_halls (FK target for master_hall_id)
 *     - app_hall_groups (FK target for group_hall_id)
 *     - app_hall_group_members
 *     - app_game_catalog (FK target for catalog_entry_id, nullable)
 *     - app_game_plan (FK target for plan_id, nullable)
 *     - app_game_plan_run (FK target for plan_run_id, nullable)
 *     - app_game1_scheduled_games (selve testen)
 *     - app_game1_master_audit (audit-trail)
 *
 *   Vi instansierer den ekte `GamePlanEngineBridge` mot et per-test schema
 *   via `bridge.forTesting()` — kun stubbing av `catalogService`,
 *   `planService`, `planRunService` siden vi vil ha kontroll over hvilken
 *   catalog/plan/run som returneres uten å sette opp full migrasjon for
 *   disse aggregatene.
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
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over multi-GoH Postgres integration-test";

// ── Schema-bootstrap ──────────────────────────────────────────────────────

function makeTestSchema(): string {
  return `multi_goh_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/**
 * Setter opp minimum-shape så `GamePlanEngineBridge` kan kjøre INSERT mot
 * `app_game1_scheduled_games`. Speiler relevante kolonner + indekser fra
 * migrasjonene:
 *   - 20260428000000_game1_scheduled_games.sql
 *   - 20260601000000_app_game1_scheduled_games_room_code.sql
 *   - 20261210010000_app_game1_scheduled_games_catalog_link.sql
 *   - 20261210010100_app_game1_scheduled_games_nullable_legacy_fks.sql
 *   - 20261221000000_app_game1_scheduled_games_room_code_active_only.sql
 *
 * `daily_schedule_id` og `schedule_id` er NULLABLE (Fase 4-migrasjon). Vi
 * setter dem til NULL i alle test-INSERTs — bridge-pathen bruker dem ikke.
 */
async function setupSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA "${schema}"`);

  // app_halls — FK-target for master_hall_id
  await pool.query(`
    CREATE TABLE "${schema}"."app_halls" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true
    )
  `);

  // app_hall_groups — FK-target for group_hall_id.
  // NB: `status` + `deleted_at` matcher schema som `HallGroupMembershipQuery`
  // bruker (`status = 'active'` + `deleted_at IS NULL`-filter i alle queries).
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

  // app_hall_group_members
  await pool.query(`
    CREATE TABLE "${schema}"."app_hall_group_members" (
      group_id TEXT NOT NULL REFERENCES "${schema}"."app_hall_groups"(id) ON DELETE CASCADE,
      hall_id TEXT NOT NULL REFERENCES "${schema}"."app_halls"(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, hall_id)
    )
  `);

  // app_game_plan_run — FK-target for plan_run_id (nullable). Minimum
  // kolonner som bridgen leser via raw query (id, plan_id, hall_id,
  // business_date, jackpot_overrides_json).
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

  // app_game_catalog — FK-target for catalog_entry_id (nullable, ON DELETE SET NULL)
  await pool.query(`
    CREATE TABLE "${schema}"."app_game_catalog" (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true
    )
  `);

  // app_game1_scheduled_games — selve testen.
  // NB: daily_schedule_id og schedule_id er NULLABLE per
  // 20261210010100_app_game1_scheduled_games_nullable_legacy_fks.sql
  // og vi setter dem aldri i bridge-pathen.
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

  // Partial unique index — replikerer
  // 20261221000000_app_game1_scheduled_games_room_code_active_only.sql.
  // Dette er det kritiske constraintet vi tester at bridgen håndterer.
  await pool.query(`
    CREATE UNIQUE INDEX "idx_app_game1_scheduled_games_room_code_${schema}"
      ON "${schema}"."app_game1_scheduled_games" (room_code)
      WHERE room_code IS NOT NULL
        AND status NOT IN ('completed', 'cancelled')
  `);

  // app_game1_master_audit — audit-trail som bridgen skriver til
  // (releaseStaleRoomCodeBindings → INSERT audit-entry per cancellet rad).
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

// ── Test fixtures ─────────────────────────────────────────────────────────

interface TestGoH {
  groupId: string;
  /** Master-hall som starter run-en. */
  masterHallId: string;
  /** Andre haller som er medlem av gruppen. */
  participantHallIds: string[];
  /** Plan-run + catalog for denne GoH-en. */
  runId: string;
  planId: string;
  catalogId: string;
}

/**
 * Setter opp én GoH med master + N participants + plan-run + catalog-rad.
 * Returnerer IDene som test-en bruker for bridge-kall.
 */
async function seedGoH(
  pool: Pool,
  schema: string,
  options: { goHName: string; participantCount: number },
): Promise<TestGoH> {
  const goHName = options.goHName;
  // Bruk goHName direkte som group-id (uppercase-conversion gjøres av
  // getCanonicalRoomCode). Det gjør test-output lett å lese: BINGO_GOH_TEST_1.
  const groupId = goHName;
  const masterHallId = `${goHName}-master`;
  const participantHallIds = Array.from(
    { length: options.participantCount },
    (_, i) => `${goHName}-participant-${i + 1}`,
  );
  const runId = `run-${goHName}-${randomUUID()}`;
  const planId = `plan-${goHName}`;
  const catalogId = `catalog-${goHName}`;

  // 1. Halls
  await pool.query(
    `INSERT INTO "${schema}"."app_halls" (id, name, is_active) VALUES ($1, $2, true)`,
    [masterHallId, masterHallId],
  );
  for (const pid of participantHallIds) {
    await pool.query(
      `INSERT INTO "${schema}"."app_halls" (id, name, is_active) VALUES ($1, $2, true)`,
      [pid, pid],
    );
  }

  // 2. Hall group (master_hall_id pinnet)
  await pool.query(
    `INSERT INTO "${schema}"."app_hall_groups" (id, name, master_hall_id) VALUES ($1, $2, $3)`,
    [groupId, goHName, masterHallId],
  );

  // 3. Members (master først)
  await pool.query(
    `INSERT INTO "${schema}"."app_hall_group_members" (group_id, hall_id) VALUES ($1, $2)`,
    [groupId, masterHallId],
  );
  for (const pid of participantHallIds) {
    await pool.query(
      `INSERT INTO "${schema}"."app_hall_group_members" (group_id, hall_id) VALUES ($1, $2)`,
      [groupId, pid],
    );
  }

  // 4. Catalog entry
  await pool.query(
    `INSERT INTO "${schema}"."app_game_catalog" (id, slug, display_name, is_active)
     VALUES ($1, 'innsatsen', $2, true)`,
    [catalogId, `Innsatsen-${goHName}`],
  );

  // 5. Plan-run
  const businessDate = new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO "${schema}"."app_game_plan_run"
       (id, plan_id, hall_id, business_date, jackpot_overrides_json)
     VALUES ($1, $2, $3, $4::date, '{}'::jsonb)`,
    [runId, planId, masterHallId, businessDate],
  );

  return {
    groupId,
    masterHallId,
    participantHallIds,
    runId,
    planId,
    catalogId,
  };
}

function makeCatalogEntry(catalogId: string): GameCatalogEntry {
  return {
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
}

function makePlanWithItems(
  planId: string,
  catalogId: string,
  hallId: string,
): GamePlanWithItems {
  return {
    id: planId,
    name: "Pilot Test Plan",
    description: null,
    hallId,
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
        id: `item-${catalogId}`,
        planId,
        position: 1,
        gameCatalogId: catalogId,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-12T12:00:00Z",
        catalogEntry: makeCatalogEntry(catalogId),
      },
    ],
  };
}

/**
 * Bygger bridge instans mot ekte Postgres pool. Bruker `forTesting`-API
 * for å injisere stubbet `catalogService` / `planService` / `planRunService`
 * (vi vil ikke sette opp catalog/plan/run-aggregatene fullt ut for hver
 * test — bridgen leser run-rad direkte via SQL og catalog/plan via
 * services).
 *
 * NB: `planRunService` brukes ikke direkte i `createScheduledGameForPlanRunPosition`-
 * pathen (bridgen gjør raw SELECT), så vi gir en tom stub.
 */
function makeBridge(
  pool: Pool,
  schema: string,
  catalogId: string,
  catalogEntry: GameCatalogEntry,
  plan: GamePlanWithItems,
): GamePlanEngineBridge {
  const catalogSvc = Object.create(
    GameCatalogService.prototype,
  ) as GameCatalogService;
  (catalogSvc as unknown as { pool: unknown }).pool = pool;
  (catalogSvc as unknown as { schema: string }).schema = schema;
  (catalogSvc as unknown as { auditLogService: null }).auditLogService = null;
  (catalogSvc as unknown as {
    getById: (id: string) => Promise<GameCatalogEntry | null>;
  }).getById = async (id) => (id === catalogId ? catalogEntry : null);

  const planSvc = Object.create(GamePlanService.prototype) as GamePlanService;
  (planSvc as unknown as { pool: unknown }).pool = pool;
  (planSvc as unknown as { schema: string }).schema = schema;
  (planSvc as unknown as { auditLogService: null }).auditLogService = null;
  (planSvc as unknown as {
    catalogService: GameCatalogService;
  }).catalogService = catalogSvc;
  (planSvc as unknown as {
    getById: (id: string) => Promise<GamePlanWithItems | null>;
  }).getById = async (id) => (id === plan.id ? plan : null);

  const runSvc = Object.create(
    GamePlanRunService.prototype,
  ) as GamePlanRunService;
  (runSvc as unknown as { pool: unknown }).pool = pool;
  (runSvc as unknown as { schema: string }).schema = schema;

  return GamePlanEngineBridge.forTesting({
    pool,
    schema,
    catalogService: catalogSvc,
    planService: planSvc,
    planRunService: runSvc,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

test(
  "multi-GoH integration: 5 parallelle GoH-spawns gir 5 unike room_codes uten kryss-konflikt",
  { skip: skipReason, timeout: 30_000 },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN, max: 10 });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);

      // Seed 5 GoH-er, hver med master + 2 participants.
      const goHs: TestGoH[] = [];
      for (let i = 1; i <= 5; i++) {
        const goH = await seedGoH(pool, schema, {
          goHName: `goh-test-${i}`,
          participantCount: 2,
        });
        goHs.push(goH);
      }

      // Bygg én bridge per GoH (de deler samme pool, samme schema).
      const bridges = goHs.map((goH) => {
        const catalog = makeCatalogEntry(goH.catalogId);
        const plan = makePlanWithItems(goH.planId, goH.catalogId, goH.masterHallId);
        return {
          goH,
          bridge: makeBridge(pool, schema, goH.catalogId, catalog, plan),
        };
      });

      // Kjør ALLE 5 spawns SAMTIDIG via Promise.allSettled.
      const results = await Promise.allSettled(
        bridges.map(({ bridge, goH }) =>
          bridge.createScheduledGameForPlanRunPosition(goH.runId, 1),
        ),
      );

      // Forventer 5 fulfilled — ingen rejecter pga kryss-konflikt.
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.equal(
        fulfilled.length,
        5,
        `Alle 5 parallelle spawns må lykkes — fikk ${fulfilled.length} fulfilled, ${rejected.length} rejected. ` +
          `Rejections: ${rejected.map((r) => (r as PromiseRejectedResult).reason).join(", ")}`,
      );

      // Verifiser at hver GoH fikk UNIK room_code i DB.
      const { rows } = await pool.query<{
        room_code: string;
        master_hall_id: string;
        group_hall_id: string;
        plan_run_id: string;
      }>(
        `SELECT room_code, master_hall_id, group_hall_id, plan_run_id
         FROM "${schema}"."app_game1_scheduled_games"
         WHERE status NOT IN ('completed','cancelled')
         ORDER BY room_code`,
      );
      assert.equal(rows.length, 5, "Skal være 5 aktive scheduled-games");

      const roomCodes = new Set(rows.map((r) => r.room_code));
      assert.equal(
        roomCodes.size,
        5,
        `Alle 5 room_codes må være unike — fikk ${roomCodes.size} unike. Codes: ${[...roomCodes].join(", ")}`,
      );

      // Verifiser at room_code matcher kanonisk format BINGO_<GROUP-ID>.
      for (const row of rows) {
        const expectedPrefix = "BINGO_";
        assert.ok(
          row.room_code.startsWith(expectedPrefix),
          `room_code må starte med 'BINGO_' — fikk '${row.room_code}'`,
        );
        // Kanonisk: BINGO_<GROUP-ID uppercased>
        const groupSegment = row.room_code.slice(expectedPrefix.length);
        assert.equal(
          groupSegment,
          row.group_hall_id.toUpperCase(),
          `room_code-suffiks må matche group_hall_id uppercased — fikk '${groupSegment}' for group '${row.group_hall_id}'`,
        );
      }

      // Ingen audit-entries siden ingen stale rader trengte cancellering.
      const { rows: auditRows } = await pool.query(
        `SELECT id FROM "${schema}"."app_game1_master_audit"`,
      );
      assert.equal(
        auditRows.length,
        0,
        "Ingen audit-entries skal skrives når det ikke finnes stale rader",
      );
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "multi-GoH integration: 6 parallelle GoH-spawns (større belastning)",
  { skip: skipReason, timeout: 30_000 },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN, max: 10 });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);

      const goHs: TestGoH[] = [];
      for (let i = 1; i <= 6; i++) {
        const goH = await seedGoH(pool, schema, {
          goHName: `goh-load-${i}`,
          participantCount: 3,
        });
        goHs.push(goH);
      }

      const bridges = goHs.map((goH) => {
        const catalog = makeCatalogEntry(goH.catalogId);
        const plan = makePlanWithItems(goH.planId, goH.catalogId, goH.masterHallId);
        return {
          goH,
          bridge: makeBridge(pool, schema, goH.catalogId, catalog, plan),
        };
      });

      const results = await Promise.allSettled(
        bridges.map(({ bridge, goH }) =>
          bridge.createScheduledGameForPlanRunPosition(goH.runId, 1),
        ),
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      assert.equal(
        fulfilled.length,
        6,
        `Alle 6 parallelle spawns må lykkes — fikk ${fulfilled.length}`,
      );

      // Verifiser participating_halls_json inneholder master + alle 3 participants.
      const { rows } = await pool.query<{
        master_hall_id: string;
        participating_halls_json: string[];
      }>(
        `SELECT master_hall_id, participating_halls_json
         FROM "${schema}"."app_game1_scheduled_games"`,
      );
      for (const row of rows) {
        const halls = Array.isArray(row.participating_halls_json)
          ? row.participating_halls_json
          : JSON.parse(row.participating_halls_json as unknown as string);
        assert.equal(
          halls.length,
          4,
          `Hver GoH har master + 3 participants = 4 haller. Fikk ${halls.length} for ${row.master_hall_id}`,
        );
        // Master først (resolveParticipatingHallIds-kontrakt).
        assert.equal(
          halls[0],
          row.master_hall_id,
          "Master må være første hall i participating_halls_json",
        );
      }
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "multi-GoH integration: race-condition samme (GoH, run, position) → idempotent reuse",
  { skip: skipReason, timeout: 30_000 },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN, max: 5 });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);

      const goH = await seedGoH(pool, schema, {
        goHName: "goh-race",
        participantCount: 1,
      });

      const catalog = makeCatalogEntry(goH.catalogId);
      const plan = makePlanWithItems(goH.planId, goH.catalogId, goH.masterHallId);

      // To separate bridge-instanser, samme pool/schema/catalog/plan.
      // Kall createScheduledGameForPlanRunPosition på samme (runId, 1)
      // samtidig.
      const bridge1 = makeBridge(pool, schema, goH.catalogId, catalog, plan);
      const bridge2 = makeBridge(pool, schema, goH.catalogId, catalog, plan);

      const results = await Promise.allSettled([
        bridge1.createScheduledGameForPlanRunPosition(goH.runId, 1),
        bridge2.createScheduledGameForPlanRunPosition(goH.runId, 1),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      assert.equal(
        fulfilled.length,
        2,
        "Begge race-kall må lykkes — én med INSERT, andre med idempotent reuse",
      );

      // Begge må returnere SAMME scheduledGameId (idempotency)
      const ids = (
        fulfilled as PromiseFulfilledResult<{ scheduledGameId: string }>[]
      ).map((r) => r.value.scheduledGameId);
      assert.equal(
        new Set(ids).size,
        1,
        `Begge race-kall må returnere samme scheduledGameId (idempotency) — fikk: ${ids.join(", ")}`,
      );

      // DB skal ha kun ÉN rad
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM "${schema}"."app_game1_scheduled_games"
         WHERE plan_run_id = $1 AND plan_position = 1`,
        [goH.runId],
      );
      assert.equal(
        Number(rows[0]!.count),
        1,
        "Kun ÉN scheduled-game-rad skal eksistere etter race",
      );
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "multi-GoH integration: stale-state recovery — eksisterende aktiv rad med samme room_code cancelleres",
  { skip: skipReason, timeout: 30_000 },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN, max: 5 });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);

      const goH = await seedGoH(pool, schema, {
        goHName: "goh-stale",
        participantCount: 1,
      });

      // Pre-seed: legg inn en STALE aktiv rad med samme kanoniske room_code
      // men ANNEN (plan_run_id, plan_position). Simulerer scenarie der en
      // tidligere test-sesjon eller crash etterlot en rad i 'running'-state.
      const staleId = randomUUID();
      const staleRunId = `run-stale-${randomUUID()}`;
      // Lag en separat plan-run-rad for stale-raden (FK krav).
      const businessDate = new Date().toISOString().slice(0, 10);
      await pool.query(
        `INSERT INTO "${schema}"."app_game_plan_run"
           (id, plan_id, hall_id, business_date, jackpot_overrides_json)
         VALUES ($1, $2, $3, $4::date, '{}'::jsonb)`,
        [staleRunId, goH.planId, goH.masterHallId, businessDate],
      );

      // Forventet kanonisk kode: BINGO_<GROUP-ID uppercased>
      const expectedRoomCode = `BINGO_${goH.groupId.toUpperCase()}`;

      await pool.query(
        `INSERT INTO "${schema}"."app_game1_scheduled_games"
           (id, sub_game_index, sub_game_name, scheduled_day, scheduled_start_time,
            scheduled_end_time, notification_start_seconds, game_mode,
            master_hall_id, group_hall_id, status, plan_run_id, plan_position,
            room_code)
         VALUES ($1, 0, 'Stale Game', $2::date, now(), now() + interval '1 hour',
                 0, 'Manual', $3, $4, 'running', $5, 1, $6)`,
        [
          staleId,
          businessDate,
          goH.masterHallId,
          goH.groupId,
          staleRunId,
          expectedRoomCode,
        ],
      );

      // Verifiser stale-rad er på plass og blokkerer
      const { rows: pre } = await pool.query(
        `SELECT id, status FROM "${schema}"."app_game1_scheduled_games" WHERE id = $1`,
        [staleId],
      );
      assert.equal(pre.length, 1);
      assert.equal(pre[0]!.status, "running");

      // Nå kall bridgen — den skal cancel stale + INSERT ny rad
      const catalog = makeCatalogEntry(goH.catalogId);
      const plan = makePlanWithItems(goH.planId, goH.catalogId, goH.masterHallId);
      const bridge = makeBridge(pool, schema, goH.catalogId, catalog, plan);

      const result = await bridge.createScheduledGameForPlanRunPosition(
        goH.runId,
        1,
      );

      // Stale-raden skal være cancelled
      const { rows: postStale } = await pool.query<{
        status: string;
        stop_reason: string | null;
      }>(
        `SELECT status, stop_reason
         FROM "${schema}"."app_game1_scheduled_games"
         WHERE id = $1`,
        [staleId],
      );
      assert.equal(postStale.length, 1);
      assert.equal(
        postStale[0]!.status,
        "cancelled",
        "Stale-raden skal være cancelled",
      );
      assert.equal(
        postStale[0]!.stop_reason,
        "auto_cancelled_by_bridge_takeover",
        "stop_reason må være 'auto_cancelled_by_bridge_takeover'",
      );

      // Den nye raden skal ha riktig room_code (ikke NULL — det er F-NEW-3-fixen)
      const { rows: postNew } = await pool.query<{
        room_code: string | null;
        status: string;
      }>(
        `SELECT room_code, status
         FROM "${schema}"."app_game1_scheduled_games"
         WHERE id = $1`,
        [result.scheduledGameId],
      );
      assert.equal(postNew.length, 1);
      assert.equal(
        postNew[0]!.room_code,
        expectedRoomCode,
        "Ny rad må ha kanonisk room_code (IKKE NULL — F-NEW-3 fjerner lazy-binding-fallback)",
      );
      assert.equal(postNew[0]!.status, "purchase_open");

      // Audit-entry må være skrevet for den cancellete raden
      const { rows: audit } = await pool.query<{
        game_id: string;
        action: string;
        actor_user_id: string;
        metadata_json: { reason?: string; cancelledByRunId?: string };
      }>(
        `SELECT game_id, action, actor_user_id, metadata_json
         FROM "${schema}"."app_game1_master_audit"
         WHERE game_id = $1`,
        [staleId],
      );
      assert.equal(audit.length, 1, "Én audit-entry per cancellet rad");
      assert.equal(audit[0]!.action, "stop");
      assert.equal(audit[0]!.actor_user_id, "SYSTEM");
      const meta =
        typeof audit[0]!.metadata_json === "string"
          ? JSON.parse(audit[0]!.metadata_json as unknown as string)
          : audit[0]!.metadata_json;
      assert.equal(
        meta.reason,
        "auto_cancelled_by_bridge_takeover",
        "Audit-metadata må logge takeover-årsak",
      );
      assert.equal(
        meta.cancelledByRunId,
        goH.runId,
        "Audit-metadata må peke på run som tok over",
      );
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "multi-GoH integration: 5 GoH-er hvor 3 har stale rader → alle 5 lykkes med 3 audit-spor",
  { skip: skipReason, timeout: 30_000 },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN, max: 10 });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);

      const goHs: TestGoH[] = [];
      for (let i = 1; i <= 5; i++) {
        const goH = await seedGoH(pool, schema, {
          goHName: `goh-mixed-${i}`,
          participantCount: 1,
        });
        goHs.push(goH);
      }

      // Plant stale aktive rader for GoH 1, 3, 5 (hver i forskjellig
      // status). GoH 2, 4 har ingen stale rader.
      const staleStatuses = ["running", "paused", "ready_to_start"];
      const businessDate = new Date().toISOString().slice(0, 10);
      const staleIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const goH = goHs[i * 2]!; // 0, 2, 4 → goh-mixed-1, 3, 5
        const staleId = randomUUID();
        const staleRunId = `run-stale-mixed-${i}-${randomUUID()}`;
        await pool.query(
          `INSERT INTO "${schema}"."app_game_plan_run"
             (id, plan_id, hall_id, business_date, jackpot_overrides_json)
           VALUES ($1, $2, $3, $4::date, '{}'::jsonb)`,
          [staleRunId, goH.planId, goH.masterHallId, businessDate],
        );

        const roomCode = `BINGO_${goH.groupId.toUpperCase()}`;
        await pool.query(
          `INSERT INTO "${schema}"."app_game1_scheduled_games"
             (id, sub_game_index, sub_game_name, scheduled_day, scheduled_start_time,
              scheduled_end_time, notification_start_seconds, game_mode,
              master_hall_id, group_hall_id, status, plan_run_id, plan_position,
              room_code)
           VALUES ($1, 0, 'Stale', $2::date, now(), now() + interval '1 hour',
                   0, 'Manual', $3, $4, $5, $6, 1, $7)`,
          [
            staleId,
            businessDate,
            goH.masterHallId,
            goH.groupId,
            staleStatuses[i],
            staleRunId,
            roomCode,
          ],
        );
        staleIds.push(staleId);
      }

      // Nå spawn alle 5 GoH-er parallelt
      const bridges = goHs.map((goH) => {
        const catalog = makeCatalogEntry(goH.catalogId);
        const plan = makePlanWithItems(goH.planId, goH.catalogId, goH.masterHallId);
        return {
          goH,
          bridge: makeBridge(pool, schema, goH.catalogId, catalog, plan),
        };
      });

      const results = await Promise.allSettled(
        bridges.map(({ bridge, goH }) =>
          bridge.createScheduledGameForPlanRunPosition(goH.runId, 1),
        ),
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.equal(
        fulfilled.length,
        5,
        `Alle 5 lykkes — fikk ${fulfilled.length} fulfilled, rejections: ${rejected
          .map((r) => (r as PromiseRejectedResult).reason)
          .join(", ")}`,
      );

      // Alle 3 stale rader skal være cancelled
      const { rows: staleStatusRows } = await pool.query<{
        id: string;
        status: string;
        stop_reason: string | null;
      }>(
        `SELECT id, status, stop_reason
         FROM "${schema}"."app_game1_scheduled_games"
         WHERE id = ANY($1::text[])`,
        [staleIds],
      );
      for (const row of staleStatusRows) {
        assert.equal(
          row.status,
          "cancelled",
          `Stale rad ${row.id} må være cancelled`,
        );
        assert.equal(row.stop_reason, "auto_cancelled_by_bridge_takeover");
      }

      // Alle 5 nye rader skal ha kanonisk room_code (ingen NULL fallback)
      const { rows: newRows } = await pool.query<{
        room_code: string | null;
        group_hall_id: string;
      }>(
        `SELECT room_code, group_hall_id
         FROM "${schema}"."app_game1_scheduled_games"
         WHERE plan_run_id IN (${goHs.map((_, i) => `$${i + 1}`).join(",")})`,
        goHs.map((g) => g.runId),
      );
      assert.equal(newRows.length, 5);
      for (const row of newRows) {
        assert.ok(
          row.room_code,
          `room_code må være satt — fikk NULL for group ${row.group_hall_id}`,
        );
        assert.equal(
          row.room_code,
          `BINGO_${row.group_hall_id.toUpperCase()}`,
          "room_code må være kanonisk format",
        );
      }

      // Audit-spor: 3 entries (én per cancellet rad)
      const { rows: auditCount } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM "${schema}"."app_game1_master_audit"
         WHERE metadata_json->>'reason' = 'auto_cancelled_by_bridge_takeover'`,
      );
      assert.equal(
        Number(auditCount[0]!.count),
        3,
        "Tre audit-spor (én per cancellet stale rad)",
      );
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);

test(
  "multi-GoH integration: unique-index strukturelt håndhever én aktiv rad per room_code",
  { skip: skipReason, timeout: 30_000 },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN, max: 5 });
    const schema = makeTestSchema();
    try {
      await setupSchema(pool, schema);

      const goH = await seedGoH(pool, schema, {
        goHName: "goh-unique",
        participantCount: 1,
      });

      const roomCode = `BINGO_${goH.groupId.toUpperCase()}`;
      const businessDate = new Date().toISOString().slice(0, 10);

      // INSERT første rad med room_code
      await pool.query(
        `INSERT INTO "${schema}"."app_game1_scheduled_games"
           (id, sub_game_index, sub_game_name, scheduled_day, scheduled_start_time,
            scheduled_end_time, notification_start_seconds, game_mode,
            master_hall_id, group_hall_id, status, room_code)
         VALUES ($1, 0, 'First', $2::date, now(), now() + interval '1 hour',
                 0, 'Manual', $3, $4, 'running', $5)`,
        [
          randomUUID(),
          businessDate,
          goH.masterHallId,
          goH.groupId,
          roomCode,
        ],
      );

      // INSERT andre rad med SAMME room_code → må feile med 23505
      await assert.rejects(
        () =>
          pool.query(
            `INSERT INTO "${schema}"."app_game1_scheduled_games"
               (id, sub_game_index, sub_game_name, scheduled_day, scheduled_start_time,
                scheduled_end_time, notification_start_seconds, game_mode,
                master_hall_id, group_hall_id, status, room_code)
             VALUES ($1, 1, 'Second', $2::date, now(), now() + interval '1 hour',
                     0, 'Manual', $3, $4, 'running', $5)`,
            [
              randomUUID(),
              businessDate,
              goH.masterHallId,
              goH.groupId,
              roomCode,
            ],
          ),
        (err: unknown) => {
          const code = (err as { code?: string } | null)?.code;
          assert.equal(
            code,
            "23505",
            `Unique-violation forventes — fikk ${code}`,
          );
          return true;
        },
      );

      // Marker første rad som 'completed' → så skal andre INSERT lykkes
      // (partial index ekskluderer completed/cancelled).
      await pool.query(
        `UPDATE "${schema}"."app_game1_scheduled_games"
           SET status = 'completed'
         WHERE room_code = $1`,
        [roomCode],
      );

      // Nå skal samme room_code være ledig
      await pool.query(
        `INSERT INTO "${schema}"."app_game1_scheduled_games"
           (id, sub_game_index, sub_game_name, scheduled_day, scheduled_start_time,
            scheduled_end_time, notification_start_seconds, game_mode,
            master_hall_id, group_hall_id, status, room_code)
         VALUES ($1, 2, 'Third', $2::date, now(), now() + interval '1 hour',
                 0, 'Manual', $3, $4, 'running', $5)`,
        [
          randomUUID(),
          businessDate,
          goH.masterHallId,
          goH.groupId,
          roomCode,
        ],
      );

      // Skal være: 1 completed + 1 running med samme room_code
      const { rows } = await pool.query<{ status: string; count: string }>(
        `SELECT status, count(*)::text AS count
         FROM "${schema}"."app_game1_scheduled_games"
         WHERE room_code = $1
         GROUP BY status
         ORDER BY status`,
        [roomCode],
      );
      assert.equal(rows.length, 2);
      const byStatus = Object.fromEntries(
        rows.map((r) => [r.status, Number(r.count)]),
      );
      assert.equal(byStatus.completed, 1);
      assert.equal(byStatus.running, 1);
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);
