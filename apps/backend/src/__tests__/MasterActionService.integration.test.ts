/**
 * Bølge 2 (2026-05-08): integration-test for MasterActionService.
 *
 * Mandat (audit `PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` §7):
 *   "Skriv integration-tester som kjører fullt spann (mock pool + mock
 *    engine). Mod ekte Postgres (skipper grasiøst uten
 *    WALLET_PG_TEST_CONNECTION_STRING). Full start → advance → pause →
 *    resume → stop loop. Verify plan-state og scheduled-game-state
 *    synkronisert etter hver action."
 *
 * Strategi:
 *   1. Default-mode (alltid kjør): bruker InMemoryAuditLogStore + mock-
 *      services for plan-runtime + bridge + engine. Verifiserer at den
 *      fulle master-loopen (start → advance → pause → resume → stop)
 *      sekvenseres korrekt og audit-events persisteres i riktig
 *      rekkefølge med riktig payload.
 *
 *   2. Postgres-mode (skip-graceful): hvis WALLET_PG_TEST_CONNECTION_STRING
 *      er satt, kjør samme loopen mot PostgresAuditLogStore i et temp-
 *      schema. Verifiserer at audit-events faktisk skrives til DB-en
 *      (SQL-pathway) og at de er hentbare via list-API.
 *
 * Dette er ikke en full end-to-end integration mot ekte
 * GamePlanRunService/GamePlanEngineBridge — de testes hver for seg i
 * sine egne integration-tester (`GamePlanRunService.goh.test.ts`,
 * `GameLobbyAggregator.integration.test.ts`). Vår integration-test
 * fokuserer på orchestrating-laget — at MasterActionService faktisk
 * kaller ned-og-igjen i riktig rekkefølge og at audit-trailen er
 * komplett.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { MasterActionService } from "../game/MasterActionService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  PostgresAuditLogStore,
} from "../compliance/AuditLogService.js";
import type { Spill1AgentLobbyState } from "@spillorama/shared-types";
import type { GamePlanRun } from "../game/gamePlan.types.js";
import type { GameCatalogEntry, TicketColor } from "../game/gameCatalog.types.js";

const HALL_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const SCHED_ID = "44444444-4444-4444-4444-444444444444";

const ACTOR = {
  userId: "user-master-1",
  hallId: HALL_ID,
  role: "AGENT" as const,
};

// ── shared fixtures ─────────────────────────────────────────────────────

function makeCatalogEntry(): GameCatalogEntry {
  const ticketColors: TicketColor[] = ["gul", "hvit"];
  return {
    id: "gc-bingo",
    slug: "bingo",
    displayName: "Bingo",
    description: null,
    rules: {},
    ticketColors,
    ticketPricesCents: { gul: 1000, hvit: 500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 50000 },
    },
    prizeMultiplierMode: "auto",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-07T12:00:00Z",
    updatedAt: "2026-05-07T12:00:00Z",
    createdByUserId: "u-1",
  };
}

/**
 * In-memory plan-run state holder. Tracker run-status per gjennom hele
 * loopen så advance/pause/resume/stop ser korrekt forrige state.
 */
class InMemoryPlanRunState {
  private run: GamePlanRun;

  constructor() {
    this.run = {
      id: RUN_ID,
      planId: PLAN_ID,
      hallId: HALL_ID,
      businessDate: "2026-05-08",
      currentPosition: 0,
      status: "idle",
      jackpotOverrides: {},
      startedAt: null,
      finishedAt: null,
      masterUserId: null,
      createdAt: "2026-05-08T10:00:00Z",
      updatedAt: "2026-05-08T10:00:00Z",
    };
  }

  get(): GamePlanRun {
    return { ...this.run };
  }

  setStatus(status: GamePlanRun["status"]): GamePlanRun {
    this.run = { ...this.run, status };
    return this.get();
  }

  setPosition(pos: number): GamePlanRun {
    this.run = { ...this.run, currentPosition: pos };
    return this.get();
  }
}

/**
 * Bygg en MasterActionService med mock-deps som speiler en realistisk
 * loop. State holdes i InMemoryPlanRunState så pause/resume ser at
 * status faktisk har endret seg fra start.
 */
function makeServiceForLoop(auditLog: AuditLogService): {
  service: MasterActionService;
  state: InMemoryPlanRunState;
  broadcastCalls: string[];
} {
  const state = new InMemoryPlanRunState();
  const broadcastCalls: string[] = [];

  const lobbyAggregatorStub = {
    async getLobbyState(): Promise<Spill1AgentLobbyState> {
      const run = state.get();
      const hasGame = run.status === "running" || run.status === "paused";
      return {
        hallId: HALL_ID,
        hallName: "Test Hall",
        businessDate: "2026-05-08",
        generatedAt: "2026-05-08T15:00:00.000Z",
        currentScheduledGameId: hasGame ? SCHED_ID : null,
        planMeta:
          run.status === "idle"
            ? null
            : {
                planRunId: RUN_ID,
                planId: PLAN_ID,
                planName: "Test Plan",
                planRunStatus: run.status,
                currentPosition: run.currentPosition,
                totalPositions: 5,
                catalogSlug: "bingo",
                catalogDisplayName: "Bingo",
                jackpotSetupRequired: false,
                pendingJackpotOverride: null,
              },
        scheduledGameMeta: hasGame
          ? {
              scheduledGameId: SCHED_ID,
              status: run.status === "paused" ? "paused" : "running",
              scheduledStartTime: "2026-05-08T15:00:00.000Z",
              scheduledEndTime: null,
              actualStartTime: "2026-05-08T15:00:00.000Z",
              actualEndTime: null,
              pauseReason: null,
            }
          : null,
        halls: [],
        allHallsReady: false,
        masterHallId: HALL_ID,
        groupOfHallsId: null,
        isMasterAgent: true,
        nextScheduledStartTime: null,
        inconsistencyWarnings: [],
      };
    },
  } as unknown as import("../game/GameLobbyAggregator.js").GameLobbyAggregator;

  const planRunStub = {
    async getOrCreateForToday(): Promise<GamePlanRun> {
      return state.get();
    },
    async start(): Promise<GamePlanRun> {
      state.setStatus("running");
      return state.setPosition(1);
    },
    async pause(): Promise<GamePlanRun> {
      return state.setStatus("paused");
    },
    async resume(): Promise<GamePlanRun> {
      return state.setStatus("running");
    },
    async finish(): Promise<GamePlanRun> {
      return state.setStatus("finished");
    },
    async advanceToNext(): Promise<{
      run: GamePlanRun;
      nextGame: GameCatalogEntry | null;
      jackpotSetupRequired: boolean;
    }> {
      const cur = state.get();
      const newRun = state.setPosition(cur.currentPosition + 1);
      return { run: newRun, nextGame: makeCatalogEntry(), jackpotSetupRequired: false };
    },
    async setJackpotOverride(): Promise<GamePlanRun> {
      return state.get();
    },
    async findForDay(): Promise<GamePlanRun | null> {
      return state.get();
    },
  } as unknown as import("../game/GamePlanRunService.js").GamePlanRunService;

  const engineBridgeStub = {
    async createScheduledGameForPlanRunPosition(): Promise<{
      scheduledGameId: string;
      reused: boolean;
    }> {
      return { scheduledGameId: SCHED_ID, reused: false };
    },
  } as unknown as import("../game/GamePlanEngineBridge.js").GamePlanEngineBridge;

  const masterControlStub = {
    async startGame(): Promise<{
      gameId: string;
      status: string;
      auditId: string;
      actualStartTime: string | null;
      actualEndTime: string | null;
    }> {
      return {
        gameId: SCHED_ID,
        status: "running",
        auditId: "audit-start",
        actualStartTime: "2026-05-08T15:00:00Z",
        actualEndTime: null,
      };
    },
    async pauseGame(): Promise<{
      gameId: string;
      status: string;
      auditId: string;
      actualStartTime: string | null;
      actualEndTime: string | null;
    }> {
      return {
        gameId: SCHED_ID,
        status: "paused",
        auditId: "audit-pause",
        actualStartTime: "2026-05-08T15:00:00Z",
        actualEndTime: null,
      };
    },
    async resumeGame(): Promise<{
      gameId: string;
      status: string;
      auditId: string;
      actualStartTime: string | null;
      actualEndTime: string | null;
    }> {
      return {
        gameId: SCHED_ID,
        status: "running",
        auditId: "audit-resume",
        actualStartTime: "2026-05-08T15:00:00Z",
        actualEndTime: null,
      };
    },
    async stopGame(): Promise<{
      gameId: string;
      status: string;
      auditId: string;
      actualStartTime: string | null;
      actualEndTime: string | null;
    }> {
      return {
        gameId: SCHED_ID,
        status: "cancelled",
        auditId: "audit-stop",
        actualStartTime: "2026-05-08T15:00:00Z",
        actualEndTime: "2026-05-08T15:30:00Z",
      };
    },
  } as unknown as import("../game/Game1MasterControlService.js").Game1MasterControlService;

  const broadcasterStub = {
    async broadcastForHall(hallId: string): Promise<void> {
      broadcastCalls.push(hallId);
    },
  };

  const service = MasterActionService.forTesting({
    pool: {} as unknown as Pool,
    schema: "public",
    planRunService: planRunStub,
    engineBridge: engineBridgeStub,
    masterControlService: masterControlStub,
    lobbyAggregator: lobbyAggregatorStub,
    auditLogService: auditLog,
    lobbyBroadcaster: broadcasterStub,
    clock: () => new Date("2026-05-08T15:00:00Z"),
  });

  return { service, state, broadcastCalls };
}

// ── default-mode integration-test (alltid kjør) ────────────────────────

test("integration: full master-loop start → advance → pause → resume → stop med InMemoryAuditLogStore", async () => {
  const auditStore = new InMemoryAuditLogStore();
  const auditLog = new AuditLogService(auditStore);
  const { service, state, broadcastCalls } = makeServiceForLoop(auditLog);

  // 1. start: idle → running
  let result = await service.start({ actor: ACTOR, hallId: HALL_ID });
  assert.equal(result.status, "running");
  assert.equal(result.scheduledGameId, SCHED_ID);
  assert.equal(state.get().status, "running");
  assert.equal(state.get().currentPosition, 1);

  // 2. advance: running → next position
  result = await service.advance({ actor: ACTOR, hallId: HALL_ID });
  assert.equal(result.status, "running");
  assert.equal(state.get().currentPosition, 2);

  // 3. pause: running → paused
  result = await service.pause({
    actor: ACTOR,
    hallId: HALL_ID,
    reason: "tester pause",
  });
  assert.equal(state.get().status, "paused");

  // 4. resume: paused → running
  result = await service.resume({ actor: ACTOR, hallId: HALL_ID });
  assert.equal(state.get().status, "running");

  // 5. stop: running → finished
  result = await service.stop({
    actor: ACTOR,
    hallId: HALL_ID,
    reason: "tester stop",
  });
  assert.equal(result.status, "finished");
  assert.equal(state.get().status, "finished");

  // Audit-events persistert i korrekt rekkefølge.
  const events = await auditLog.list({ resource: "spill1_master_action" });
  // events er ordered DESC (newest first) etter list-default.
  const actions = events.map((e) => e.action).reverse();
  assert.deepEqual(actions, [
    "spill1.master.start",
    "spill1.master.advance",
    "spill1.master.pause",
    "spill1.master.resume",
    "spill1.master.stop",
  ]);

  // Hver action ble broadcastet til lobby.
  assert.equal(broadcastCalls.length, 5);
  for (const call of broadcastCalls) assert.equal(call, HALL_ID);
});

test("integration: setJackpot lagrer override og skriver audit-event", async () => {
  const auditStore = new InMemoryAuditLogStore();
  const auditLog = new AuditLogService(auditStore);
  const { service } = makeServiceForLoop(auditLog);

  // start først så vi har en running run
  await service.start({ actor: ACTOR, hallId: HALL_ID });

  await service.setJackpot({
    actor: ACTOR,
    hallId: HALL_ID,
    position: 3,
    draw: 47,
    prizesCents: { gul: 50000, hvit: 25000 },
  });

  const events = await auditLog.list({ action: "spill1.master.jackpot_set" });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.actorId, ACTOR.userId);
  assert.equal(events[0]?.details["draw"], 47);
  assert.equal(events[0]?.details["position"], 3);
  assert.deepEqual(events[0]?.details["prizeColors"], ["gul", "hvit"]);
});

// ── Postgres-mode integration-test (skip uten WALLET_PG_TEST_CONNECTION_STRING) ─

const PG_CONN = process.env.WALLET_PG_TEST_CONNECTION_STRING?.trim();
const skipReason = PG_CONN
  ? undefined
  : "WALLET_PG_TEST_CONNECTION_STRING ikke satt — hopper over Postgres integration-test";

function makeTestSchema(): string {
  return `master_action_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function setupAuditSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  // Speile relevante kolonner fra app_audit_log-migrasjonen.
  await pool.query(`
    CREATE TABLE "${schema}"."app_audit_log" (
      id BIGSERIAL PRIMARY KEY,
      actor_id TEXT,
      actor_type TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `CREATE INDEX "ix_${schema}_audit_resource" ON "${schema}"."app_audit_log" (resource, resource_id)`,
  );
}

async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

test(
  "integration: full master-loop persisterer audit-events i Postgres",
  { skip: skipReason },
  async () => {
    if (!PG_CONN) return;
    const pool = new Pool({ connectionString: PG_CONN });
    const schema = makeTestSchema();
    try {
      await setupAuditSchema(pool, schema);
      const auditStore = new PostgresAuditLogStore({ pool, schema });
      const auditLog = new AuditLogService(auditStore);
      const { service } = makeServiceForLoop(auditLog);

      await service.start({ actor: ACTOR, hallId: HALL_ID });
      await service.advance({ actor: ACTOR, hallId: HALL_ID });
      await service.pause({
        actor: ACTOR,
        hallId: HALL_ID,
        reason: "pg test pause",
      });
      await service.resume({ actor: ACTOR, hallId: HALL_ID });
      await service.stop({
        actor: ACTOR,
        hallId: HALL_ID,
        reason: "pg test stop",
      });

      const events = await auditLog.list({ resource: "spill1_master_action" });
      assert.equal(events.length, 5);
      // events er DESC; reverser så vi får start→stop.
      const actions = events.map((e) => e.action).reverse();
      assert.deepEqual(actions, [
        "spill1.master.start",
        "spill1.master.advance",
        "spill1.master.pause",
        "spill1.master.resume",
        "spill1.master.stop",
      ]);
      // Verify resourceId binder til scheduled-game-id (ikke planRunId).
      const stopEvent = events.find((e) => e.action === "spill1.master.stop");
      assert.equal(stopEvent?.resourceId, SCHED_ID);
      // Verify reason er persistert.
      assert.equal(stopEvent?.details["reason"], "pg test stop");
    } finally {
      await dropSchema(pool, schema);
      await pool.end();
    }
  },
);
