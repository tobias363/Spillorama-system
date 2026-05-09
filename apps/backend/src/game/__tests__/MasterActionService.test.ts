/**
 * Bølge 2 (2026-05-08): unit-tester for MasterActionService.
 *
 * Mandat (audit `PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` §7):
 *   "Skriv integration-tester som kjører fullt spann (mock pool + mock
 *    engine). Hver master-action med hver pre-state."
 *
 * Strategi: vi bruker MasterActionService.forTesting() for å lage en
 * service uten å kalle constructor-en (som ellers ville kreve en ekte Pool
 * fordi assertSchemaName-en der valider config). Alle dependencies
 * (planRunService, engineBridge, masterControlService, lobbyAggregator,
 * auditLogService, lobbyBroadcaster) er mock-stubs som hardcoder return-
 * value per scenario.
 *
 * Tester som dekkes:
 *   start(...)
 *     ✓ idle → running spawns scheduled-game og kaller engine.startGame
 *     ✓ idempotent re-start på running run gjenbruker bridge-rad
 *     ✓ paused run → GAME_PLAN_RUN_INVALID_TRANSITION (bruk /resume)
 *     ✓ finished run → PLAN_RUN_FINISHED
 *     ✓ BRIDGE_FAILED-warning fra aggregator → LOBBY_INCONSISTENT
 *     ✓ DUAL_SCHEDULED_GAMES-warning → LOBBY_INCONSISTENT
 *     ✓ isMasterAgent=false → FORBIDDEN
 *     ✓ engine.startGame kaster DomainError → propageres uendret
 *     ✓ engine.startGame kaster generic Error → ENGINE_FAILED
 *     ✓ NO_MATCHING_PLAN propageres fra getOrCreateForToday
 *     ✓ Audit-event spill1.master.start skrives
 *     ✓ Lobby-broadcast trigges
 *
 *   advance(...)
 *     ✓ running → next position + new scheduled-game + engine.startGame
 *     ✓ jackpot-required uten override → JACKPOT_SETUP_REQUIRED
 *     ✓ siste posisjon passert → run finished, ingen engine-call,
 *       audit spill1.master.finish
 *     ✓ engine kaster generic Error → ENGINE_FAILED
 *
 *   pause(...)
 *     ✓ running → engine.pauseGame + plan-run.pause
 *     ✓ ingen aktiv scheduled-game → NO_ACTIVE_GAME
 *     ✓ plan-run.pause svikter → engine-pause vinner (best-effort)
 *
 *   resume(...)
 *     ✓ paused → engine.resumeGame + plan-run.resume
 *     ✓ ingen aktiv scheduled-game → NO_ACTIVE_GAME
 *
 *   stop(...)
 *     ✓ running → engine.stopGame + plan-run.finish + audit
 *     ✓ uten reason → INVALID_INPUT
 *     ✓ ingen scheduled-game → plan-run finishes alene (ingen engine-call)
 *
 *   setJackpot(...)
 *     ✓ valid input → override lagret, audit spill1.master.jackpot_set
 *     ✓ draw < 1 → INVALID_INPUT
 *     ✓ draw > 90 → INVALID_INPUT
 *     ✓ position < 1 → INVALID_INPUT
 *     ✓ ugyldig bongfarge → INVALID_INPUT
 *     ✓ ikke-positiv prizesCents-verdi → INVALID_INPUT
 *     ✓ tom prizesCents → INVALID_INPUT
 *     ✓ FORBIDDEN hvis ikke master
 */

import assert from "node:assert/strict";
import test from "node:test";

import { MasterActionService } from "../MasterActionService.js";
import { DomainError } from "../../errors/DomainError.js";
import type { Spill1AgentLobbyState } from "@spillorama/shared-types";
import type { GamePlanRun } from "../gamePlan.types.js";
import type { GameCatalogEntry, TicketColor } from "../gameCatalog.types.js";

// ── shared fixtures ─────────────────────────────────────────────────────

const HALL_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const SCHED_ID = "44444444-4444-4444-4444-444444444444";
const AUDIT_ID = "audit-1";

const MASTER_ACTOR = {
  userId: "user-master-1",
  hallId: HALL_ID,
  role: "AGENT" as const,
};

const NON_MASTER_ACTOR = {
  userId: "user-other-1",
  hallId: "99999999-9999-9999-9999-999999999999",
  role: "AGENT" as const,
};

const TODAY_OSLO = "2026-05-08"; // matcher todayOsloKey ved fixed-clock

function makeLobbyState(
  overrides: Partial<Spill1AgentLobbyState> = {},
): Spill1AgentLobbyState {
  return {
    hallId: HALL_ID,
    hallName: "Test Hall",
    businessDate: TODAY_OSLO,
    generatedAt: "2026-05-08T15:00:00.000Z",
    currentScheduledGameId: null,
    planMeta: null,
    scheduledGameMeta: null,
    halls: [],
    allHallsReady: false,
    masterHallId: HALL_ID,
    groupOfHallsId: null,
    isMasterAgent: true,
    nextScheduledStartTime: null,
    inconsistencyWarnings: [],
    ...overrides,
  };
}

function makeRun(overrides: Partial<GamePlanRun> = {}): GamePlanRun {
  return {
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_ID,
    businessDate: TODAY_OSLO,
    currentPosition: 1,
    status: "idle",
    jackpotOverrides: {},
    startedAt: null,
    finishedAt: null,
    masterUserId: null,
    createdAt: "2026-05-08T10:00:00Z",
    updatedAt: "2026-05-08T10:00:00Z",
    ...overrides,
  };
}

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

// ── mock service factory ────────────────────────────────────────────────

interface ServiceMocks {
  /** Audit-events captured. */
  auditEvents: Array<{ action: string; actorId: string | null; details: Record<string, unknown> }>;
  /** Broadcast calls captured. */
  broadcastCalls: string[];
  /** Plan-run-service calls captured. */
  planRunCalls: string[];
  /** Engine-bridge calls captured. */
  engineBridgeCalls: string[];
  /** Master-control-service calls captured. */
  masterControlCalls: string[];
  /**
   * F-NEW-1 (E2E pilot-blokker, 2026-05-09): captured input til
   * `masterControlService.startGame` slik at tester kan verifisere at
   * `jackpotConfirmed` propageres riktig fra MasterActionInput.
   */
  startGameInputs: Array<Record<string, unknown>>;
}

interface ServiceOverrides {
  lobbyState?: Spill1AgentLobbyState | (() => Spill1AgentLobbyState);
  lobbyError?: Error;
  getOrCreateForToday?: (
    hallId: string,
    businessDate: string,
  ) => GamePlanRun | Promise<GamePlanRun>;
  getOrCreateForTodayError?: Error;
  startRun?: (
    hallId: string,
    businessDate: string,
    masterUserId: string,
  ) => GamePlanRun | Promise<GamePlanRun>;
  startRunError?: Error;
  pauseRun?: (
    hallId: string,
    businessDate: string,
    masterUserId: string,
  ) => GamePlanRun | Promise<GamePlanRun>;
  pauseRunError?: Error;
  resumeRun?: (
    hallId: string,
    businessDate: string,
    masterUserId: string,
  ) => GamePlanRun | Promise<GamePlanRun>;
  resumeRunError?: Error;
  finishRun?: (
    hallId: string,
    businessDate: string,
    masterUserId: string,
  ) => GamePlanRun | Promise<GamePlanRun>;
  finishRunError?: Error;
  advanceToNext?: (
    hallId: string,
    businessDate: string,
    masterUserId: string,
  ) =>
    | { run: GamePlanRun; nextGame: GameCatalogEntry | null; jackpotSetupRequired: boolean }
    | Promise<{
        run: GamePlanRun;
        nextGame: GameCatalogEntry | null;
        jackpotSetupRequired: boolean;
      }>;
  advanceError?: Error;
  setJackpotOverride?: (
    hallId: string,
    businessDate: string,
    position: number,
    override: { draw: number; prizesCents: Record<string, number> },
    masterUserId: string,
  ) => GamePlanRun | Promise<GamePlanRun>;
  findForDay?: (
    hallId: string,
    businessDate: string,
  ) => GamePlanRun | null | Promise<GamePlanRun | null>;
  bridgeResult?: { scheduledGameId: string; reused: boolean };
  bridgeError?: Error;
  startGameResult?: { gameId: string; status: string; auditId: string; actualStartTime: string | null; actualEndTime: string | null };
  startGameError?: Error;
  pauseGameResult?: { gameId: string; status: string; auditId: string; actualStartTime: string | null; actualEndTime: string | null };
  pauseGameError?: Error;
  resumeGameResult?: { gameId: string; status: string; auditId: string; actualStartTime: string | null; actualEndTime: string | null };
  resumeGameError?: Error;
  stopGameResult?: { gameId: string; status: string; auditId: string; actualStartTime: string | null; actualEndTime: string | null };
  stopGameError?: Error;
  // Pilot Q3 2026: rollback-helper overrides for retry-with-rollback-tester.
  rollbackToIdle?: (input: {
    runId: string;
    expectedStatus: string;
    expectedPosition: number;
    targetPosition: number;
    reason: string;
    masterUserId: string;
  }) => GamePlanRun | null | Promise<GamePlanRun | null>;
  rollbackPosition?: (input: {
    runId: string;
    expectedStatus: string;
    expectedPosition: number;
    targetPosition: number;
    reason: string;
    masterUserId: string;
  }) => GamePlanRun | null | Promise<GamePlanRun | null>;
}

function makeService(
  overrides: ServiceOverrides = {},
): { service: MasterActionService; mocks: ServiceMocks } {
  const mocks: ServiceMocks = {
    auditEvents: [],
    broadcastCalls: [],
    planRunCalls: [],
    engineBridgeCalls: [],
    masterControlCalls: [],
    startGameInputs: [],
  };

  const lobbyAggregatorStub = {
    async getLobbyState(hallId: string): Promise<Spill1AgentLobbyState> {
      if (overrides.lobbyError) throw overrides.lobbyError;
      const state =
        typeof overrides.lobbyState === "function"
          ? overrides.lobbyState()
          : (overrides.lobbyState ?? makeLobbyState({ hallId }));
      return state;
    },
  } as unknown as import("../GameLobbyAggregator.js").GameLobbyAggregator;

  const planRunStub = {
    async getOrCreateForToday(
      hallId: string,
      businessDate: string,
    ): Promise<GamePlanRun> {
      mocks.planRunCalls.push("getOrCreateForToday");
      if (overrides.getOrCreateForTodayError) throw overrides.getOrCreateForTodayError;
      if (overrides.getOrCreateForToday) {
        return overrides.getOrCreateForToday(hallId, businessDate);
      }
      return makeRun();
    },
    async start(
      hallId: string,
      businessDate: string,
      masterUserId: string,
    ): Promise<GamePlanRun> {
      mocks.planRunCalls.push("start");
      if (overrides.startRunError) throw overrides.startRunError;
      if (overrides.startRun) return overrides.startRun(hallId, businessDate, masterUserId);
      return makeRun({ status: "running", currentPosition: 1, masterUserId });
    },
    async pause(
      hallId: string,
      businessDate: string,
      masterUserId: string,
    ): Promise<GamePlanRun> {
      mocks.planRunCalls.push("pause");
      if (overrides.pauseRunError) throw overrides.pauseRunError;
      if (overrides.pauseRun) return overrides.pauseRun(hallId, businessDate, masterUserId);
      return makeRun({ status: "paused" });
    },
    async resume(
      hallId: string,
      businessDate: string,
      masterUserId: string,
    ): Promise<GamePlanRun> {
      mocks.planRunCalls.push("resume");
      if (overrides.resumeRunError) throw overrides.resumeRunError;
      if (overrides.resumeRun) return overrides.resumeRun(hallId, businessDate, masterUserId);
      return makeRun({ status: "running" });
    },
    async finish(
      hallId: string,
      businessDate: string,
      masterUserId: string,
    ): Promise<GamePlanRun> {
      mocks.planRunCalls.push("finish");
      if (overrides.finishRunError) throw overrides.finishRunError;
      if (overrides.finishRun) return overrides.finishRun(hallId, businessDate, masterUserId);
      return makeRun({ status: "finished" });
    },
    async advanceToNext(
      hallId: string,
      businessDate: string,
      masterUserId: string,
    ): Promise<{
      run: GamePlanRun;
      nextGame: GameCatalogEntry | null;
      jackpotSetupRequired: boolean;
    }> {
      mocks.planRunCalls.push("advanceToNext");
      if (overrides.advanceError) throw overrides.advanceError;
      if (overrides.advanceToNext) {
        return overrides.advanceToNext(hallId, businessDate, masterUserId);
      }
      return {
        run: makeRun({ status: "running", currentPosition: 2 }),
        nextGame: makeCatalogEntry(),
        jackpotSetupRequired: false,
      };
    },
    async setJackpotOverride(
      hallId: string,
      businessDate: string,
      position: number,
      override: { draw: number; prizesCents: Record<string, number> },
      masterUserId: string,
    ): Promise<GamePlanRun> {
      mocks.planRunCalls.push("setJackpotOverride");
      if (overrides.setJackpotOverride) {
        return overrides.setJackpotOverride(
          hallId,
          businessDate,
          position,
          override,
          masterUserId,
        );
      }
      return makeRun({
        status: "running",
        jackpotOverrides: { [String(position)]: override },
      });
    },
    async findForDay(
      hallId: string,
      businessDate: string,
    ): Promise<GamePlanRun | null> {
      mocks.planRunCalls.push("findForDay");
      if (overrides.findForDay) return overrides.findForDay(hallId, businessDate);
      return makeRun({ status: "running" });
    },
    // Pilot Q3 2026: rollback-helpers brukt av MasterActionService etter
    // bridge-spawn-feil. Default-implementasjonene returnerer en gyldig
    // run så testene som ikke testes spesifikt rollback-pathen ikke krasjer.
    async rollbackToIdle(input: {
      runId: string;
      expectedStatus: string;
      expectedPosition: number;
      targetPosition: number;
      reason: string;
      masterUserId: string;
    }): Promise<GamePlanRun | null> {
      mocks.planRunCalls.push("rollbackToIdle");
      if (overrides.rollbackToIdle) return overrides.rollbackToIdle(input);
      return makeRun({
        id: input.runId,
        status: "idle",
        currentPosition: input.targetPosition,
      });
    },
    async rollbackPosition(input: {
      runId: string;
      expectedStatus: string;
      expectedPosition: number;
      targetPosition: number;
      reason: string;
      masterUserId: string;
    }): Promise<GamePlanRun | null> {
      mocks.planRunCalls.push("rollbackPosition");
      if (overrides.rollbackPosition) return overrides.rollbackPosition(input);
      return makeRun({
        id: input.runId,
        status: "running",
        currentPosition: input.targetPosition,
      });
    },
  } as unknown as import("../GamePlanRunService.js").GamePlanRunService;

  const engineBridgeStub = {
    async createScheduledGameForPlanRunPosition(
      runId: string,
      position: number,
    ): Promise<{ scheduledGameId: string; reused: boolean }> {
      mocks.engineBridgeCalls.push("createScheduledGameForPlanRunPosition");
      if (overrides.bridgeError) throw overrides.bridgeError;
      return overrides.bridgeResult ?? { scheduledGameId: SCHED_ID, reused: false };
    },
  } as unknown as import("../GamePlanEngineBridge.js").GamePlanEngineBridge;

  const masterControlStub = {
    async startGame(input: Record<string, unknown>): Promise<{
      gameId: string;
      status: string;
      auditId: string;
      actualStartTime: string | null;
      actualEndTime: string | null;
    }> {
      mocks.masterControlCalls.push("startGame");
      // F-NEW-1: capture input for assertions on jackpotConfirmed-propagering.
      mocks.startGameInputs.push(input);
      if (overrides.startGameError) throw overrides.startGameError;
      return (
        overrides.startGameResult ?? {
          gameId: SCHED_ID,
          status: "running",
          auditId: AUDIT_ID,
          actualStartTime: "2026-05-08T15:00:00Z",
          actualEndTime: null,
        }
      );
    },
    async pauseGame(): Promise<{
      gameId: string;
      status: string;
      auditId: string;
      actualStartTime: string | null;
      actualEndTime: string | null;
    }> {
      mocks.masterControlCalls.push("pauseGame");
      if (overrides.pauseGameError) throw overrides.pauseGameError;
      return (
        overrides.pauseGameResult ?? {
          gameId: SCHED_ID,
          status: "paused",
          auditId: AUDIT_ID,
          actualStartTime: "2026-05-08T15:00:00Z",
          actualEndTime: null,
        }
      );
    },
    async resumeGame(): Promise<{
      gameId: string;
      status: string;
      auditId: string;
      actualStartTime: string | null;
      actualEndTime: string | null;
    }> {
      mocks.masterControlCalls.push("resumeGame");
      if (overrides.resumeGameError) throw overrides.resumeGameError;
      return (
        overrides.resumeGameResult ?? {
          gameId: SCHED_ID,
          status: "running",
          auditId: AUDIT_ID,
          actualStartTime: "2026-05-08T15:00:00Z",
          actualEndTime: null,
        }
      );
    },
    async stopGame(): Promise<{
      gameId: string;
      status: string;
      auditId: string;
      actualStartTime: string | null;
      actualEndTime: string | null;
    }> {
      mocks.masterControlCalls.push("stopGame");
      if (overrides.stopGameError) throw overrides.stopGameError;
      return (
        overrides.stopGameResult ?? {
          gameId: SCHED_ID,
          status: "cancelled",
          auditId: AUDIT_ID,
          actualStartTime: "2026-05-08T15:00:00Z",
          actualEndTime: "2026-05-08T15:30:00Z",
        }
      );
    },
  } as unknown as import("../Game1MasterControlService.js").Game1MasterControlService;

  const auditStub = {
    async record(input: {
      actorId: string | null;
      action: string;
      details?: Record<string, unknown>;
    }): Promise<void> {
      mocks.auditEvents.push({
        action: input.action,
        actorId: input.actorId,
        details: input.details ?? {},
      });
    },
  } as unknown as import("../../compliance/AuditLogService.js").AuditLogService;

  const broadcasterStub = {
    async broadcastForHall(hallId: string): Promise<void> {
      mocks.broadcastCalls.push(hallId);
    },
  };

  // Bruk forTesting for å skape service uten å kalle full constructor.
  const service = MasterActionService.forTesting({
    pool: {} as unknown as import("pg").Pool,
    schema: "public",
    planRunService: planRunStub,
    engineBridge: engineBridgeStub,
    masterControlService: masterControlStub,
    lobbyAggregator: lobbyAggregatorStub,
    auditLogService: auditStub,
    lobbyBroadcaster: broadcasterStub,
    clock: () => new Date("2026-05-08T15:00:00Z"),
  });

  return { service, mocks };
}

// ── tests: start ────────────────────────────────────────────────────────

test("start: idle → running spawner scheduled-game og kaller engine.startGame", async () => {
  const { service, mocks } = makeService();
  const result = await service.start({ actor: MASTER_ACTOR, hallId: HALL_ID });
  assert.equal(result.scheduledGameId, SCHED_ID);
  assert.equal(result.planRunId, RUN_ID);
  assert.equal(result.status, "running");
  assert.equal(result.scheduledGameStatus, "running");
  assert.deepEqual(result.inconsistencyWarnings, []);
  assert.ok(mocks.planRunCalls.includes("getOrCreateForToday"));
  assert.ok(mocks.planRunCalls.includes("start"));
  assert.ok(mocks.engineBridgeCalls.includes("createScheduledGameForPlanRunPosition"));
  assert.ok(mocks.masterControlCalls.includes("startGame"));
  // Audit-event skrives.
  const startAudit = mocks.auditEvents.find((e) => e.action === "spill1.master.start");
  assert.ok(startAudit, "spill1.master.start audit-event må skrives");
  assert.equal(startAudit?.actorId, MASTER_ACTOR.userId);
  // Lobby-broadcast trigges.
  assert.deepEqual(mocks.broadcastCalls, [HALL_ID]);
});

test("start: idempotent re-start på running run → bridge gjenbrukes uten å kalle planRun.start", async () => {
  const { service, mocks } = makeService({
    getOrCreateForToday: () => makeRun({ status: "running" }),
    bridgeResult: { scheduledGameId: SCHED_ID, reused: true },
  });
  const result = await service.start({ actor: MASTER_ACTOR, hallId: HALL_ID });
  assert.equal(result.scheduledGameId, SCHED_ID);
  // start() i planRun ble IKKE kalt fordi run var allerede running
  assert.ok(!mocks.planRunCalls.includes("start"));
});

test("start: paused run → GAME_PLAN_RUN_INVALID_TRANSITION", async () => {
  const { service } = makeService({
    getOrCreateForToday: () => makeRun({ status: "paused" }),
  });
  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_PLAN_RUN_INVALID_TRANSITION",
  );
});

test("start: finished run → PLAN_RUN_FINISHED", async () => {
  const { service } = makeService({
    getOrCreateForToday: () => makeRun({ status: "finished" }),
  });
  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "PLAN_RUN_FINISHED",
  );
});

test("start: BRIDGE_FAILED-warning fra aggregator → LOBBY_INCONSISTENT", async () => {
  const { service } = makeService({
    lobbyState: makeLobbyState({
      inconsistencyWarnings: [
        { code: "BRIDGE_FAILED", message: "test" },
      ],
    }),
  });
  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "LOBBY_INCONSISTENT",
  );
});

test("start: DUAL_SCHEDULED_GAMES-warning → LOBBY_INCONSISTENT", async () => {
  const { service } = makeService({
    lobbyState: makeLobbyState({
      inconsistencyWarnings: [
        {
          code: "DUAL_SCHEDULED_GAMES",
          message: "two games for same hall",
        },
      ],
    }),
  });
  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "LOBBY_INCONSISTENT",
  );
});

test("start: isMasterAgent=false → FORBIDDEN", async () => {
  const { service } = makeService({
    lobbyState: makeLobbyState({ isMasterAgent: false }),
  });
  await assert.rejects(
    () => service.start({ actor: NON_MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "FORBIDDEN",
  );
});

test("start: engine.startGame kaster DomainError → propageres uendret", async () => {
  const customErr = new DomainError("HALLS_NOT_READY", "Halls not ready");
  const { service } = makeService({ startGameError: customErr });
  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "HALLS_NOT_READY",
  );
});

test("start: engine.startGame kaster generic Error → ENGINE_FAILED", async () => {
  const { service } = makeService({
    startGameError: new Error("DB connection lost"),
  });
  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "ENGINE_FAILED",
  );
});

test("start: NO_MATCHING_PLAN propageres fra getOrCreateForToday", async () => {
  const { service } = makeService({
    getOrCreateForTodayError: new DomainError(
      "NO_MATCHING_PLAN",
      "ingen plan dekker (hall, ukedag)",
    ),
  });
  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "NO_MATCHING_PLAN",
  );
});

test("start: HALL_NOT_IN_GROUP fra bridge → propageres uendret", async () => {
  const { service } = makeService({
    bridgeError: new DomainError(
      "HALL_NOT_IN_GROUP",
      "hall ikke medlem av gruppen",
    ),
  });
  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "HALL_NOT_IN_GROUP",
  );
});

test("start: bridge generic Error → BRIDGE_FAILED", async () => {
  const { service } = makeService({
    bridgeError: new Error("connection refused"),
  });
  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "BRIDGE_FAILED",
  );
});

// ── tests: advance ──────────────────────────────────────────────────────

test("advance: running → next position + new scheduled-game + engine.startGame", async () => {
  const { service, mocks } = makeService();
  const result = await service.advance({ actor: MASTER_ACTOR, hallId: HALL_ID });
  assert.equal(result.scheduledGameId, SCHED_ID);
  assert.equal(result.status, "running");
  assert.ok(mocks.planRunCalls.includes("advanceToNext"));
  assert.ok(mocks.engineBridgeCalls.includes("createScheduledGameForPlanRunPosition"));
  assert.ok(mocks.masterControlCalls.includes("startGame"));
  const advanceAudit = mocks.auditEvents.find(
    (e) => e.action === "spill1.master.advance",
  );
  assert.ok(advanceAudit, "spill1.master.advance audit-event må skrives");
});

test("advance: jackpot-required uten override → JACKPOT_SETUP_REQUIRED", async () => {
  const { service, mocks } = makeService({
    advanceToNext: () => ({
      run: makeRun({ status: "running", currentPosition: 1 }),
      nextGame: { ...makeCatalogEntry(), requiresJackpotSetup: true },
      jackpotSetupRequired: true,
    }),
  });
  await assert.rejects(
    () => service.advance({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "JACKPOT_SETUP_REQUIRED",
  );
  // Bridge skal IKKE kalles når jackpot mangler.
  assert.ok(!mocks.engineBridgeCalls.includes("createScheduledGameForPlanRunPosition"));
});

test("advance: siste posisjon passert → run finished, ingen engine-call, audit spill1.master.finish", async () => {
  const { service, mocks } = makeService({
    advanceToNext: () => ({
      run: makeRun({ status: "finished", currentPosition: 5 }),
      nextGame: null,
      jackpotSetupRequired: false,
    }),
  });
  const result = await service.advance({ actor: MASTER_ACTOR, hallId: HALL_ID });
  assert.equal(result.scheduledGameId, null);
  assert.equal(result.status, "finished");
  // Engine-call skal IKKE skje på finish.
  assert.ok(!mocks.masterControlCalls.includes("startGame"));
  const finishAudit = mocks.auditEvents.find((e) => e.action === "spill1.master.finish");
  assert.ok(finishAudit, "spill1.master.finish audit-event må skrives");
});

test("advance: engine kaster generic Error → ENGINE_FAILED", async () => {
  const { service } = makeService({
    startGameError: new Error("draw-engine offline"),
  });
  await assert.rejects(
    () => service.advance({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "ENGINE_FAILED",
  );
});

// ── tests: pause ────────────────────────────────────────────────────────

test("pause: running scheduled-game → engine.pauseGame + plan-run.pause", async () => {
  const { service, mocks } = makeService({
    lobbyState: makeLobbyState({
      currentScheduledGameId: SCHED_ID,
      planMeta: {
        planId: PLAN_ID,
        planRunId: RUN_ID,
        planName: "Test Plan",
        planRunStatus: "running",
        currentPosition: 1,
        totalPositions: 5,
        catalogSlug: "bingo",
        catalogDisplayName: "Bingo",
        jackpotSetupRequired: false,
        pendingJackpotOverride: null,
      },
    }),
  });
  const result = await service.pause({
    actor: MASTER_ACTOR,
    hallId: HALL_ID,
    reason: "Operatør pauset",
  });
  assert.equal(result.scheduledGameId, SCHED_ID);
  assert.ok(mocks.masterControlCalls.includes("pauseGame"));
  assert.ok(mocks.planRunCalls.includes("pause"));
  const pauseAudit = mocks.auditEvents.find((e) => e.action === "spill1.master.pause");
  assert.ok(pauseAudit, "spill1.master.pause audit-event må skrives");
});

test("pause: ingen aktiv scheduled-game → NO_ACTIVE_GAME", async () => {
  const { service } = makeService({
    lobbyState: makeLobbyState({ currentScheduledGameId: null }),
  });
  await assert.rejects(
    () => service.pause({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "NO_ACTIVE_GAME",
  );
});

test("pause: plan-run.pause svikter → engine-pause vinner (best-effort)", async () => {
  const { service, mocks } = makeService({
    lobbyState: makeLobbyState({
      currentScheduledGameId: SCHED_ID,
      planMeta: {
        planId: PLAN_ID,
        planRunId: RUN_ID,
        planName: "Test Plan",
        planRunStatus: "running",
        currentPosition: 1,
        totalPositions: 5,
        catalogSlug: "bingo",
        catalogDisplayName: "Bingo",
        jackpotSetupRequired: false,
        pendingJackpotOverride: null,
      },
    }),
    pauseRunError: new DomainError(
      "GAME_PLAN_RUN_INVALID_TRANSITION",
      "kan ikke pause",
    ),
  });
  // pause() skal lykkes selv om planRun.pause kaster — engine er allerede pauset.
  const result = await service.pause({ actor: MASTER_ACTOR, hallId: HALL_ID });
  assert.equal(result.scheduledGameId, SCHED_ID);
  assert.ok(mocks.masterControlCalls.includes("pauseGame"));
});

// ── tests: resume ───────────────────────────────────────────────────────

test("resume: paused scheduled-game → engine.resumeGame + plan-run.resume", async () => {
  const { service, mocks } = makeService({
    lobbyState: makeLobbyState({
      currentScheduledGameId: SCHED_ID,
      planMeta: {
        planId: PLAN_ID,
        planRunId: RUN_ID,
        planName: "Test Plan",
        planRunStatus: "paused",
        currentPosition: 1,
        totalPositions: 5,
        catalogSlug: "bingo",
        catalogDisplayName: "Bingo",
        jackpotSetupRequired: false,
        pendingJackpotOverride: null,
      },
    }),
  });
  const result = await service.resume({ actor: MASTER_ACTOR, hallId: HALL_ID });
  assert.equal(result.scheduledGameId, SCHED_ID);
  assert.ok(mocks.masterControlCalls.includes("resumeGame"));
  assert.ok(mocks.planRunCalls.includes("resume"));
  const resumeAudit = mocks.auditEvents.find(
    (e) => e.action === "spill1.master.resume",
  );
  assert.ok(resumeAudit, "spill1.master.resume audit-event må skrives");
});

test("resume: ingen aktiv scheduled-game → NO_ACTIVE_GAME", async () => {
  const { service } = makeService({
    lobbyState: makeLobbyState({ currentScheduledGameId: null }),
  });
  await assert.rejects(
    () => service.resume({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "NO_ACTIVE_GAME",
  );
});

// ── tests: stop ─────────────────────────────────────────────────────────

test("stop: running scheduled-game → engine.stopGame + plan-run.finish + audit", async () => {
  const { service, mocks } = makeService({
    lobbyState: makeLobbyState({
      currentScheduledGameId: SCHED_ID,
      planMeta: {
        planId: PLAN_ID,
        planRunId: RUN_ID,
        planName: "Test Plan",
        planRunStatus: "running",
        currentPosition: 1,
        totalPositions: 5,
        catalogSlug: "bingo",
        catalogDisplayName: "Bingo",
        jackpotSetupRequired: false,
        pendingJackpotOverride: null,
      },
    }),
  });
  const result = await service.stop({
    actor: MASTER_ACTOR,
    hallId: HALL_ID,
    reason: "Operatør stoppet runden",
  });
  assert.equal(result.status, "finished");
  assert.ok(mocks.masterControlCalls.includes("stopGame"));
  assert.ok(mocks.planRunCalls.includes("finish"));
  const stopAudit = mocks.auditEvents.find((e) => e.action === "spill1.master.stop");
  assert.ok(stopAudit, "spill1.master.stop audit-event må skrives");
  assert.equal(stopAudit?.details["reason"], "Operatør stoppet runden");
});

test("stop: uten reason → INVALID_INPUT", async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.stop({
        actor: MASTER_ACTOR,
        hallId: HALL_ID,
        reason: "",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("stop: ingen scheduled-game → plan-run finishes alene (ingen engine-call)", async () => {
  const { service, mocks } = makeService({
    lobbyState: makeLobbyState({
      currentScheduledGameId: null,
      planMeta: {
        planId: PLAN_ID,
        planRunId: RUN_ID,
        planName: "Test Plan",
        planRunStatus: "running",
        currentPosition: 1,
        totalPositions: 5,
        catalogSlug: "bingo",
        catalogDisplayName: "Bingo",
        jackpotSetupRequired: false,
        pendingJackpotOverride: null,
      },
    }),
  });
  const result = await service.stop({
    actor: MASTER_ACTOR,
    hallId: HALL_ID,
    reason: "abort før engine startet",
  });
  assert.equal(result.scheduledGameId, null);
  // Engine-call skal IKKE skje hvis ingen scheduled-game finnes.
  assert.ok(!mocks.masterControlCalls.includes("stopGame"));
  // Men plan-run finish skal kalles.
  assert.ok(mocks.planRunCalls.includes("finish"));
});

// ── tests: setJackpot ───────────────────────────────────────────────────

test("setJackpot: valid input → override lagret, audit spill1.master.jackpot_set", async () => {
  const { service, mocks } = makeService();
  const result = await service.setJackpot({
    actor: MASTER_ACTOR,
    hallId: HALL_ID,
    position: 2,
    draw: 47,
    prizesCents: { gul: 50000, hvit: 25000 },
  });
  assert.equal(result.planRunId, RUN_ID);
  assert.ok(mocks.planRunCalls.includes("setJackpotOverride"));
  const jackpotAudit = mocks.auditEvents.find(
    (e) => e.action === "spill1.master.jackpot_set",
  );
  assert.ok(jackpotAudit, "spill1.master.jackpot_set audit-event må skrives");
  assert.equal(jackpotAudit?.details["draw"], 47);
});

test("setJackpot: draw < 1 → INVALID_INPUT", async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.setJackpot({
        actor: MASTER_ACTOR,
        hallId: HALL_ID,
        position: 1,
        draw: 0,
        prizesCents: { gul: 50000 },
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("setJackpot: draw > 90 → INVALID_INPUT", async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.setJackpot({
        actor: MASTER_ACTOR,
        hallId: HALL_ID,
        position: 1,
        draw: 91,
        prizesCents: { gul: 50000 },
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("setJackpot: position < 1 → INVALID_INPUT", async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.setJackpot({
        actor: MASTER_ACTOR,
        hallId: HALL_ID,
        position: 0,
        draw: 50,
        prizesCents: { gul: 50000 },
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("setJackpot: ugyldig bongfarge → INVALID_INPUT", async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.setJackpot({
        actor: MASTER_ACTOR,
        hallId: HALL_ID,
        position: 1,
        draw: 50,
        prizesCents: { rosa: 50000 },
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("setJackpot: ikke-positiv prizesCents-verdi → INVALID_INPUT", async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.setJackpot({
        actor: MASTER_ACTOR,
        hallId: HALL_ID,
        position: 1,
        draw: 50,
        prizesCents: { gul: 0 },
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("setJackpot: tom prizesCents → INVALID_INPUT", async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.setJackpot({
        actor: MASTER_ACTOR,
        hallId: HALL_ID,
        position: 1,
        draw: 50,
        prizesCents: {},
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("setJackpot: FORBIDDEN hvis ikke master-agent", async () => {
  const { service } = makeService({
    lobbyState: makeLobbyState({ isMasterAgent: false }),
  });
  await assert.rejects(
    () =>
      service.setJackpot({
        actor: NON_MASTER_ACTOR,
        hallId: HALL_ID,
        position: 1,
        draw: 50,
        prizesCents: { gul: 50000 },
      }),
    (err: unknown) => err instanceof DomainError && err.code === "FORBIDDEN",
  );
});

// ── tests: aggregator infra-error propageres ────────────────────────────

test("preValidate: aggregator infra-error propageres uendret", async () => {
  const infraErr = new DomainError(
    "LOBBY_AGGREGATOR_INFRA_ERROR",
    "DB connection lost",
  );
  const { service } = makeService({ lobbyError: infraErr });
  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "LOBBY_AGGREGATOR_INFRA_ERROR",
  );
});

// ── F-NEW-1 regression tests (E2E pilot-blokker, 2026-05-09) ────────────
//
// E2E test-engineer-agenten i `docs/engineering/SPILL1_E2E_TEST_RUN_2026-05-09.md`
// avdekket at master-bingovert ikke kunne fullføre jackpot-popup-flyten via
// den NYE Bølge 2-routen `/api/agent/game1/master/start`. Service-laget
// (MasterActionService.start) aksepterte ikke `jackpotConfirmed` i input,
// og endepunktets Zod-schema avviste body-feltet med "Unrecognized key:
// jackpotConfirmed". Resultatet var en endeløs JACKPOT_CONFIRM_REQUIRED-
// loop på klient-siden — master-agent kunne ikke starte JACKPOT-spill via
// agent-konsollet, kun via admin-konsollet.
//
// Disse testene encoder kontrakten:
//   1. `MasterActionInput` MÅ akseptere `jackpotConfirmed?: boolean`.
//   2. Når `jackpotConfirmed=true` propageres flagget videre til
//      `Game1MasterControlService.startGame({ jackpotConfirmed: true })`.
//   3. Når `jackpotConfirmed` utelates eller er false, settes flagget IKKE
//      i startGame-input (forblir undefined). Dette gjør at jackpot-
//      preflight i Game1MasterControlService.startGame fortsatt kan kaste
//      JACKPOT_CONFIRM_REQUIRED for den første start-attempten.

test("F-NEW-1: start propagerer jackpotConfirmed=true til masterControlService.startGame", async () => {
  const { service, mocks } = makeService();
  await service.start({
    actor: MASTER_ACTOR,
    hallId: HALL_ID,
    jackpotConfirmed: true,
  });
  assert.equal(mocks.startGameInputs.length, 1);
  const startInput = mocks.startGameInputs[0]!;
  assert.equal(
    startInput.jackpotConfirmed,
    true,
    "jackpotConfirmed=true må propageres til Game1MasterControlService.startGame",
  );
});

test("F-NEW-1: start uten jackpotConfirmed sender IKKE flagget til engine (legacy default)", async () => {
  const { service, mocks } = makeService();
  await service.start({ actor: MASTER_ACTOR, hallId: HALL_ID });
  assert.equal(mocks.startGameInputs.length, 1);
  const startInput = mocks.startGameInputs[0]!;
  assert.ok(
    !("jackpotConfirmed" in startInput),
    "jackpotConfirmed skal ikke settes i input når master ikke har bekreftet — engine kan da kaste JACKPOT_CONFIRM_REQUIRED",
  );
});

test("F-NEW-1: start med jackpotConfirmed=false sender IKKE flagget til engine", async () => {
  const { service, mocks } = makeService();
  await service.start({
    actor: MASTER_ACTOR,
    hallId: HALL_ID,
    jackpotConfirmed: false,
  });
  assert.equal(mocks.startGameInputs.length, 1);
  const startInput = mocks.startGameInputs[0]!;
  assert.ok(
    !("jackpotConfirmed" in startInput),
    "jackpotConfirmed=false (eller undefined) skal IKKE settes — kun true propageres",
  );
});

// ── retry-with-rollback (BIN-XXXX, 2026-05-09) ──────────────────────────

const FAST_RETRY_DELAYS = [0, 0, 0] as const;
const FAST_SLEEP = async (_ms: number): Promise<void> => {};

function makeRetryService(
  overrides: ServiceOverrides = {},
): { service: MasterActionService; mocks: ServiceMocks } {
  const built = makeService(overrides);
  // Tving fast-retry-konfig på service-en via Object.assign — vi kan ikke
  // re-konstruere service-en direkte fordi makeService bruker forTesting.
  Object.assign(built.service as unknown as Record<string, unknown>, {
    bridgeRetryDelaysMs: FAST_RETRY_DELAYS,
    retrySleep: FAST_SLEEP,
  });
  return built;
}

test("start: bridge-spawn feiler 1x → retry lykkes på forsøk 2", async () => {
  let calls = 0;
  const { service, mocks } = makeRetryService({});
  // Override bridge til å feile første forsøk, lykkes på andre.
  const originalBridge =
    (service as unknown as { engineBridge: { createScheduledGameForPlanRunPosition: Function } })
      .engineBridge;
  Object.assign(originalBridge, {
    createScheduledGameForPlanRunPosition: async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient DB glitch");
      return { scheduledGameId: SCHED_ID, reused: false };
    },
  });

  const result = await service.start({ actor: MASTER_ACTOR, hallId: HALL_ID });
  assert.equal(result.scheduledGameId, SCHED_ID);
  assert.equal(calls, 2, "bridge skal ha blitt kalt 2 ganger (1 fail + 1 success)");
  assert.ok(mocks.masterControlCalls.includes("startGame"));
  // Rollback skal IKKE være kalt siden retry lykkes.
  assert.ok(!mocks.planRunCalls.includes("rollbackToIdle"));
});

test("start: bridge-spawn feiler 3x (alle forsøk) → rollback til idle + DomainError", async () => {
  let calls = 0;
  const { service, mocks } = makeRetryService({
    // Run var idle, så vi forventer rollback.
    getOrCreateForToday: () => makeRun({ status: "idle" }),
  });
  Object.assign(
    (service as unknown as { engineBridge: { createScheduledGameForPlanRunPosition: Function } })
      .engineBridge,
    {
      createScheduledGameForPlanRunPosition: async () => {
        calls += 1;
        throw new Error("DB connection refused");
      },
    },
  );

  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => {
      if (!(err instanceof DomainError) || err.code !== "BRIDGE_FAILED") return false;
      const details = err.details as { rolledBack?: boolean } | undefined;
      return details?.rolledBack === true;
    },
  );
  // 4 totale forsøk (1 + 3 retries).
  assert.equal(calls, 4);
  // Rollback skal være kalt.
  assert.ok(
    mocks.planRunCalls.includes("rollbackToIdle"),
    "rollbackToIdle skal være kalt etter alle retries feilet",
  );
  // Audit-event skal skrives.
  const rollbackAudit = mocks.auditEvents.find(
    (e) => e.action === "spill1.master.start.bridge_failed_with_rollback",
  );
  assert.ok(rollbackAudit, "rollback-audit-event må skrives");
});

test("start: permanent feil (JACKPOT_SETUP_REQUIRED) → ingen retry, ingen rollback", async () => {
  let calls = 0;
  const { service, mocks } = makeRetryService({});
  Object.assign(
    (service as unknown as { engineBridge: { createScheduledGameForPlanRunPosition: Function } })
      .engineBridge,
    {
      createScheduledGameForPlanRunPosition: async () => {
        calls += 1;
        throw new DomainError("JACKPOT_SETUP_REQUIRED", "trenger popup");
      },
    },
  );

  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "JACKPOT_SETUP_REQUIRED",
  );
  // Permanente feil skal IKKE retries.
  assert.equal(calls, 1, "permanent feil skal ikke retries");
  // Rollback skal IKKE kalles for permanente feil — den feilen vil bare
  // gjenta seg.
  assert.ok(!mocks.planRunCalls.includes("rollbackToIdle"));
});

test("advance: bridge-spawn feiler 2x → retry lykkes på forsøk 3", async () => {
  let calls = 0;
  const { service, mocks } = makeRetryService({});
  Object.assign(
    (service as unknown as { engineBridge: { createScheduledGameForPlanRunPosition: Function } })
      .engineBridge,
    {
      createScheduledGameForPlanRunPosition: async () => {
        calls += 1;
        if (calls < 3) throw new Error(`transient-${calls}`);
        return { scheduledGameId: SCHED_ID, reused: false };
      },
    },
  );

  const result = await service.advance({ actor: MASTER_ACTOR, hallId: HALL_ID });
  assert.equal(result.scheduledGameId, SCHED_ID);
  assert.equal(calls, 3);
  // Position-rollback skal IKKE være kalt siden retry lykkes.
  assert.ok(!mocks.planRunCalls.includes("rollbackPosition"));
});

test("advance: bridge feiler 4x → rollback position + DomainError", async () => {
  let calls = 0;
  const { service, mocks } = makeRetryService({
    advanceToNext: () => ({
      // Simuler at vi har inkrementert fra 1 til 2.
      run: makeRun({ status: "running", currentPosition: 2 }),
      nextGame: makeCatalogEntry(),
      jackpotSetupRequired: false,
    }),
  });
  Object.assign(
    (service as unknown as { engineBridge: { createScheduledGameForPlanRunPosition: Function } })
      .engineBridge,
    {
      createScheduledGameForPlanRunPosition: async () => {
        calls += 1;
        throw new Error("DB pool exhausted");
      },
    },
  );

  await assert.rejects(
    () => service.advance({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => {
      if (!(err instanceof DomainError) || err.code !== "BRIDGE_FAILED") return false;
      const details = err.details as { rolledBack?: boolean; previousPosition?: number } | undefined;
      return details?.rolledBack === true && details?.previousPosition === 1;
    },
  );
  assert.equal(calls, 4, "4 totale forsøk på advance");
  assert.ok(
    mocks.planRunCalls.includes("rollbackPosition"),
    "rollbackPosition skal være kalt etter alle retries feilet",
  );
  const rollbackAudit = mocks.auditEvents.find(
    (e) => e.action === "spill1.master.advance.bridge_failed_with_rollback",
  );
  assert.ok(rollbackAudit, "advance rollback-audit-event må skrives");
});

test("advance: permanent feil (HALL_NOT_IN_GROUP) → ingen retry, men rollback position", async () => {
  // For permanente feil på advance skal vi rulle position tilbake siden
  // advanceToNext har inkrementert den allerede.
  let calls = 0;
  const { service, mocks } = makeRetryService({
    advanceToNext: () => ({
      run: makeRun({ status: "running", currentPosition: 2 }),
      nextGame: makeCatalogEntry(),
      jackpotSetupRequired: false,
    }),
  });
  Object.assign(
    (service as unknown as { engineBridge: { createScheduledGameForPlanRunPosition: Function } })
      .engineBridge,
    {
      createScheduledGameForPlanRunPosition: async () => {
        calls += 1;
        throw new DomainError(
          "HALL_NOT_IN_GROUP",
          "hallen er ikke i aktiv gruppe",
        );
      },
    },
  );

  await assert.rejects(
    () => service.advance({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "HALL_NOT_IN_GROUP",
  );
  assert.equal(calls, 1, "permanente feil skal ikke retries");
  // Position-rollback SKAL kalles selv for permanente feil — ellers blir
  // run hengende på posisjon 2 som ikke har scheduled-game.
  assert.ok(mocks.planRunCalls.includes("rollbackPosition"));
});

test("start: rollback selv feiler → original BRIDGE_FAILED propageres uendret", async () => {
  let calls = 0;
  const { service, mocks } = makeRetryService({
    getOrCreateForToday: () => makeRun({ status: "idle" }),
    rollbackToIdle: () => {
      throw new Error("rollback DB error");
    },
  });
  Object.assign(
    (service as unknown as { engineBridge: { createScheduledGameForPlanRunPosition: Function } })
      .engineBridge,
    {
      createScheduledGameForPlanRunPosition: async () => {
        calls += 1;
        throw new Error("primary bridge failure");
      },
    },
  );

  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => err instanceof DomainError && err.code === "BRIDGE_FAILED",
  );
  assert.equal(calls, 4);
  // Rollback ble forsøkt selv om den feilet.
  assert.ok(mocks.planRunCalls.includes("rollbackToIdle"));
});

test("start: idempotent re-start på running run → ingen rollback selv om bridge feiler etter retries", async () => {
  // Hvis run var allerede 'running' (idempotent re-start), skal vi IKKE
  // rulle tilbake til idle — det ville ødelagt eksisterende engine-state.
  let calls = 0;
  const { service, mocks } = makeRetryService({
    getOrCreateForToday: () => makeRun({ status: "running" }),
  });
  Object.assign(
    (service as unknown as { engineBridge: { createScheduledGameForPlanRunPosition: Function } })
      .engineBridge,
    {
      createScheduledGameForPlanRunPosition: async () => {
        calls += 1;
        throw new Error("transient");
      },
    },
  );

  await assert.rejects(
    () => service.start({ actor: MASTER_ACTOR, hallId: HALL_ID }),
    (err: unknown) => {
      if (!(err instanceof DomainError) || err.code !== "BRIDGE_FAILED") return false;
      const details = err.details as { rolledBack?: boolean } | undefined;
      return details?.rolledBack === false;
    },
  );
  assert.equal(calls, 4);
  // Rollback skal IKKE kalles fordi run var allerede running.
  assert.ok(!mocks.planRunCalls.includes("rollbackToIdle"));
});
