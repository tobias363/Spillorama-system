/**
 * Pilot-blokker regression-test (2026-05-13).
 *
 * # Bakgrunn
 *
 * PR #1284 introduserte `onScheduledGameSpawned`-hooken på
 * `MasterActionService` for å konvertere armed lobby-state til
 * `app_game1_ticket_purchases`-rader rett mellom bridge-spawn og
 * engine.startGame. Hooken er kritisk fundament for at bonger spillere
 * armer i lobby FAKTISK blir LIVE i runden master starter.
 *
 * Den 2026-05-12 oppdaget Tobias at hooken aldri konverterte noen
 * spillere, til tross for at flowen så ut til å være wired. Root cause:
 * hook-implementasjonen i `index.ts:runArmedToPurchaseConversionForSpawn`
 * gjorde en SQL-SELECT med en ikke-eksisterende kolonne (`hall_id`), som
 * kastet `42703 column does not exist`. Feilen ble fanget av
 * `triggerArmedConversionHook`-catch-blokken og engine.startGame kjørte
 * videre uten konvertering. Ingen tests dekket invariant-en "hook MÅ
 * kalles på start + advance".
 *
 * # Hva denne testen verifiserer
 *
 * Direkte invariant-test: når master kaller `start()` eller `advance()`,
 * må `onScheduledGameSpawned` faktisk bli kalt EN gang per spawn med
 * korrekt `scheduledGameId`/`planRunId`/`position`/`masterHallId`. Hvis
 * hooken IKKE kalles (regression hvis noen fjerner kallet, eller setter
 * `onScheduledGameSpawned` til null ved et uhell), feiler testen.
 *
 * Vi lar IKKE hooken kaste — soft-fail-kontrakten betyr at testen ville
 * ikke fanget en silent-broken hook, men den fanger den underliggende
 * MIS-WIRING-en. Combined med
 * `game1ArmedToPurchaseConversion.sqlSchema.test.ts` som verifiserer at
 * SQL-shape-en er gyldig, dekker vi begge sider.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

import { MasterActionService } from "../game/MasterActionService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type { Spill1AgentLobbyState } from "@spillorama/shared-types";
import type { GamePlanRun } from "../game/gamePlan.types.js";
import type {
  GameCatalogEntry,
  TicketColor,
} from "../game/gameCatalog.types.js";

const HALL_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const SCHED_ID_1 = "44444444-4444-4444-4444-444444444444";
const SCHED_ID_2 = "55555555-5555-5555-5555-555555555555";

const ACTOR = {
  userId: "user-master-1",
  hallId: HALL_ID,
  role: "AGENT" as const,
};

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
    sortOrder: 1,
    createdAt: "2026-05-08T15:00:00Z",
    updatedAt: "2026-05-08T15:00:00Z",
    createdByUserId: null,
  };
}

interface PlanRunStateShape {
  currentPosition: number;
  status: "idle" | "running" | "paused" | "finished";
}

interface HookCall {
  scheduledGameId: string;
  planRunId: string;
  position: number;
  masterHallId: string;
  actorUserId: string;
}

interface ServiceForHookTest {
  service: MasterActionService;
  hookCalls: HookCall[];
  setHookHandler: (handler: (input: HookCall) => Promise<void>) => void;
  setSpawnedId: (id: string) => void;
}

function makeServiceForHookTest(auditLog: AuditLogService): ServiceForHookTest {
  let stateRef: PlanRunStateShape = { currentPosition: 0, status: "idle" };
  let spawnedScheduledId = SCHED_ID_1;
  const hookCalls: HookCall[] = [];
  let handler: (input: HookCall) => Promise<void> = async () => {
    // default: capture only
  };

  const planRunStub = {
    async getOrCreateForToday(): Promise<GamePlanRun> {
      return buildRun(stateRef);
    },
    async start(): Promise<GamePlanRun> {
      stateRef = { ...stateRef, status: "running", currentPosition: 1 };
      return buildRun(stateRef);
    },
    async pause(): Promise<GamePlanRun> {
      stateRef = { ...stateRef, status: "paused" };
      return buildRun(stateRef);
    },
    async resume(): Promise<GamePlanRun> {
      stateRef = { ...stateRef, status: "running" };
      return buildRun(stateRef);
    },
    async finish(): Promise<GamePlanRun> {
      stateRef = { ...stateRef, status: "finished" };
      return buildRun(stateRef);
    },
    async advanceToNext(): Promise<{
      run: GamePlanRun;
      nextGame: GameCatalogEntry | null;
      jackpotSetupRequired: boolean;
    }> {
      stateRef = { ...stateRef, currentPosition: stateRef.currentPosition + 1 };
      return {
        run: buildRun(stateRef),
        nextGame: makeCatalogEntry(),
        jackpotSetupRequired: false,
      };
    },
    async setJackpotOverride(): Promise<GamePlanRun> {
      return buildRun(stateRef);
    },
    async findForDay(): Promise<GamePlanRun | null> {
      return buildRun(stateRef);
    },
  } as unknown as import("../game/GamePlanRunService.js").GamePlanRunService;

  const engineBridgeStub = {
    async createScheduledGameForPlanRunPosition(): Promise<{
      scheduledGameId: string;
      reused: boolean;
    }> {
      return { scheduledGameId: spawnedScheduledId, reused: false };
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
        gameId: spawnedScheduledId,
        status: "running",
        auditId: "audit-start",
        actualStartTime: "2026-05-08T15:00:00Z",
        actualEndTime: null,
      };
    },
  } as unknown as import("../game/Game1MasterControlService.js").Game1MasterControlService;

  const lobbyAggregatorStub = {
    async getLobbyState(): Promise<Spill1AgentLobbyState> {
      const hasGame =
        stateRef.status === "running" || stateRef.status === "paused";
      return {
        hallId: HALL_ID,
        hallName: "Test Hall",
        businessDate: "2026-05-08",
        generatedAt: "2026-05-08T15:00:00.000Z",
        currentScheduledGameId: hasGame ? spawnedScheduledId : null,
        planMeta:
          stateRef.status === "idle"
            ? null
            : {
                planRunId: RUN_ID,
                planId: PLAN_ID,
                planName: "Test Plan",
                planRunStatus: stateRef.status,
                currentPosition: stateRef.currentPosition,
                totalPositions: 5,
                catalogSlug: "bingo",
                catalogDisplayName: "Bingo",
                jackpotSetupRequired: false,
                pendingJackpotOverride: null,
              },
        scheduledGameMeta: hasGame
          ? {
              scheduledGameId: spawnedScheduledId,
              status: stateRef.status === "paused" ? "paused" : "running",
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

  const broadcasterStub = {
    async broadcastForHall(): Promise<void> {
      /* noop */
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
    onScheduledGameSpawned: async (input) => {
      hookCalls.push({ ...input });
      await handler(input);
    },
  });

  return {
    service,
    hookCalls,
    setHookHandler: (h) => {
      handler = h;
    },
    setSpawnedId: (id) => {
      spawnedScheduledId = id;
    },
  };
}

function buildRun(state: PlanRunStateShape): GamePlanRun {
  return {
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_ID,
    businessDate: "2026-05-08",
    currentPosition: state.currentPosition,
    status: state.status,
    jackpotOverrides: {},
    startedAt: state.status === "running" ? "2026-05-08T15:00:00Z" : null,
    finishedAt: state.status === "finished" ? "2026-05-08T15:30:00Z" : null,
    masterUserId: ACTOR.userId,
    createdAt: "2026-05-08T15:00:00Z",
    updatedAt: "2026-05-08T15:00:00Z",
  };
}

// ── tests ───────────────────────────────────────────────────────────────

test("invariant: start() trigger onScheduledGameSpawned-hook med riktig scheduledGameId + planRunId + position", async () => {
  const auditLog = new AuditLogService(new InMemoryAuditLogStore());
  const { service, hookCalls } = makeServiceForHookTest(auditLog);

  await service.start({ actor: ACTOR, hallId: HALL_ID });

  assert.equal(
    hookCalls.length,
    1,
    "Forventet at hook ble kalt eksakt 1 gang fra start()",
  );
  assert.equal(hookCalls[0]?.scheduledGameId, SCHED_ID_1);
  assert.equal(hookCalls[0]?.planRunId, RUN_ID);
  assert.equal(hookCalls[0]?.position, 1);
  assert.equal(hookCalls[0]?.masterHallId, HALL_ID);
  assert.equal(hookCalls[0]?.actorUserId, ACTOR.userId);
});

test("invariant: advance() trigger onScheduledGameSpawned-hook for ny posisjon", async () => {
  const auditLog = new AuditLogService(new InMemoryAuditLogStore());
  const { service, hookCalls, setSpawnedId } =
    makeServiceForHookTest(auditLog);

  await service.start({ actor: ACTOR, hallId: HALL_ID });
  assert.equal(hookCalls.length, 1);

  setSpawnedId(SCHED_ID_2);
  await service.advance({ actor: ACTOR, hallId: HALL_ID });

  assert.equal(
    hookCalls.length,
    2,
    "Forventet at advance() også trigger hook",
  );
  assert.equal(hookCalls[1]?.scheduledGameId, SCHED_ID_2);
  assert.equal(hookCalls[1]?.position, 2);
  assert.equal(hookCalls[1]?.planRunId, RUN_ID);
});

test("soft-fail kontrakt: hook som kaster blokkerer IKKE engine.startGame", async () => {
  const auditLog = new AuditLogService(new InMemoryAuditLogStore());
  const { service, setHookHandler, hookCalls } =
    makeServiceForHookTest(auditLog);
  setHookHandler(async () => {
    throw new Error("simulert hook-feil (eks: SQL 42703)");
  });

  // Skal IKKE kaste — soft-fail i MasterActionService.triggerArmedConversionHook.
  const result = await service.start({ actor: ACTOR, hallId: HALL_ID });

  assert.equal(hookCalls.length, 1, "Hook ble likevel forsøkt kalt");
  assert.equal(result.status, "running", "Engine startet til tross for hook-feil");
});
