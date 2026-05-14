/**
 * FIX-1 (2026-05-14): tester for MasterActionService.reconcileStuckPlanRuns.
 *
 * Bakgrunn (fra OBS-6 DB-auditor):
 *   Plan-run kan ende i `status='running'` uten aktive scheduled-games. Klient
 *   sitter fast og venter på neste runde som aldri spawnes. Eksisterende
 *   `GamePlanRunCleanupService.cleanupAllStale` rydder kun gårsdagens stale
 *   rader — dagens stuck-rader må reconcileers on-the-fly.
 *
 * Disse testene verifiserer at:
 *   1. `start()` kaller `findStuck` + `finish` FØR ny plan-run-state.
 *   2. `advance()` kaller `findStuck` + `finish` FØR `advanceToNext`.
 *   3. Tom stuck-liste = no-op (eksisterende eksisterende flyt urørt).
 *   4. `findStuck`-feil = soft-fail (logg + fortsett).
 *   5. `finish`-feil = soft-fail (logg + fortsett).
 *   6. Reconcile er per-(hall, businessDate) — andre haller/datoer rør ikke.
 *   7. Audit-event `plan_run.reconcile_stuck` skrives per finishet rad.
 *
 * Strategi: vi gjenbruker `MasterActionService.forTesting()` med en pool/
 * planRunService-stub som returnerer konfigurerte fixture-data. Vi sjekker
 * mocks.planRunCalls + mocks.auditEvents for å verifisere ordre + side-
 * effects.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { MasterActionService } from "../MasterActionService.js";
import { DomainError } from "../../errors/DomainError.js";
import type { Spill1AgentLobbyState } from "@spillorama/shared-types";
import type { GamePlanRun } from "../gamePlan.types.js";
import type { GameCatalogEntry, TicketColor } from "../gameCatalog.types.js";

// ── shared fixtures (matcher MasterActionService.test.ts) ──────────────

const HALL_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const STUCK_RUN_ID = "30dfdd2c-9fa2-4102-bcc8-ed3a69cf9938"; // mirror audit:db
const SCHED_ID = "44444444-4444-4444-4444-444444444444";
const AUDIT_ID = "audit-stuck-1";

const MASTER_ACTOR = {
  userId: "user-master-1",
  hallId: HALL_ID,
  role: "AGENT" as const,
};

const TODAY_OSLO = "2026-05-08"; // matcher todayOsloKey(clock fixed nedenfor)

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

function makeStuckRun(overrides: Partial<GamePlanRun> = {}): GamePlanRun {
  // Mirror the actual stuck-state observed by audit:db OBS-6:
  // status='running', business_date=today, current_position=1.
  return makeRun({
    id: STUCK_RUN_ID,
    status: "running",
    currentPosition: 1,
    businessDate: TODAY_OSLO,
    startedAt: "2026-05-08T10:00:00Z",
    masterUserId: "previous-master",
    ...overrides,
  });
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
  /** Captured audit-events keyed by action. */
  auditEvents: Array<{
    action: string;
    actorId: string | null;
    details: Record<string, unknown>;
  }>;
  /** Captured plan-run-service method-calls in order. */
  planRunCalls: string[];
  /** Captured engine-bridge calls. */
  engineBridgeCalls: string[];
  /** Captured master-control calls. */
  masterControlCalls: string[];
  /** Captured findStuck inputs (one per call). */
  findStuckInputs: Array<{ hallId: string; businessDate: string | Date }>;
  /** Captured finish inputs. */
  finishInputs: Array<{
    hallId: string;
    businessDate: string;
    masterUserId: string;
  }>;
}

interface ServiceOverrides {
  lobbyState?: Spill1AgentLobbyState;
  /** Run returned by getOrCreateForToday. Default: idle run. */
  runAfterCreate?: GamePlanRun;
  /** Stuck-runs returned by findStuck. Default: []. */
  stuckRuns?: GamePlanRun[];
  /** If set, findStuck throws this error. */
  findStuckError?: Error;
  /** If set, finish() throws this error. */
  finishError?: Error;
  /** Run returned by `planRunService.start`. Default: makeRun({status:'running'}). */
  startedRun?: GamePlanRun;
  /** Advance result for advance() test. */
  advanceResult?: {
    run: GamePlanRun;
    nextGame: GameCatalogEntry | null;
    jackpotSetupRequired: boolean;
  };
}

function makeService(overrides: ServiceOverrides = {}): {
  service: MasterActionService;
  mocks: ServiceMocks;
} {
  const mocks: ServiceMocks = {
    auditEvents: [],
    planRunCalls: [],
    engineBridgeCalls: [],
    masterControlCalls: [],
    findStuckInputs: [],
    finishInputs: [],
  };

  const lobbyAggregatorStub = {
    async getLobbyState(): Promise<Spill1AgentLobbyState> {
      return overrides.lobbyState ?? makeLobbyState();
    },
  } as unknown as import("../GameLobbyAggregator.js").GameLobbyAggregator;

  const planRunStub = {
    async getOrCreateForToday(): Promise<GamePlanRun> {
      mocks.planRunCalls.push("getOrCreateForToday");
      return overrides.runAfterCreate ?? makeRun({ status: "idle" });
    },
    async start(): Promise<GamePlanRun> {
      mocks.planRunCalls.push("start");
      return (
        overrides.startedRun ??
        makeRun({ status: "running", currentPosition: 1 })
      );
    },
    async finish(
      hallId: string,
      businessDate: string,
      masterUserId: string,
    ): Promise<GamePlanRun> {
      mocks.planRunCalls.push("finish");
      mocks.finishInputs.push({ hallId, businessDate, masterUserId });
      if (overrides.finishError) throw overrides.finishError;
      return makeRun({ status: "finished" });
    },
    async findStuck(input: {
      hallId: string;
      businessDate: Date | string;
    }): Promise<GamePlanRun[]> {
      mocks.planRunCalls.push("findStuck");
      mocks.findStuckInputs.push(input);
      if (overrides.findStuckError) throw overrides.findStuckError;
      return overrides.stuckRuns ?? [];
    },
    async findForDay(): Promise<GamePlanRun | null> {
      mocks.planRunCalls.push("findForDay");
      return makeRun({ status: "running" });
    },
    async advanceToNext(): Promise<{
      run: GamePlanRun;
      nextGame: GameCatalogEntry | null;
      jackpotSetupRequired: boolean;
    }> {
      mocks.planRunCalls.push("advanceToNext");
      return (
        overrides.advanceResult ?? {
          run: makeRun({ status: "running", currentPosition: 2 }),
          nextGame: makeCatalogEntry(),
          jackpotSetupRequired: false,
        }
      );
    },
    async rollbackToIdle(): Promise<GamePlanRun | null> {
      mocks.planRunCalls.push("rollbackToIdle");
      return null;
    },
    async rollbackPosition(): Promise<GamePlanRun | null> {
      mocks.planRunCalls.push("rollbackPosition");
      return null;
    },
  } as unknown as import("../GamePlanRunService.js").GamePlanRunService;

  const engineBridgeStub = {
    async createScheduledGameForPlanRunPosition(): Promise<{
      scheduledGameId: string;
      reused: boolean;
    }> {
      mocks.engineBridgeCalls.push("createScheduledGameForPlanRunPosition");
      return { scheduledGameId: SCHED_ID, reused: false };
    },
  } as unknown as import("../GamePlanEngineBridge.js").GamePlanEngineBridge;

  const masterControlStub = {
    async startGame(): Promise<{
      gameId: string;
      status: string;
      auditId: string;
      actualStartTime: string | null;
      actualEndTime: string | null;
    }> {
      mocks.masterControlCalls.push("startGame");
      return {
        gameId: SCHED_ID,
        status: "running",
        auditId: AUDIT_ID,
        actualStartTime: "2026-05-08T15:00:00Z",
        actualEndTime: null,
      };
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
    async broadcastForHall(): Promise<void> {
      // no-op
    },
  };

  const poolStub = {
    async query(): Promise<{ rows: unknown[] }> {
      return { rows: [] };
    },
  };

  const service = MasterActionService.forTesting({
    pool: poolStub as unknown as import("pg").Pool,
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

// ── tests ──────────────────────────────────────────────────────────────

test("reconcile: start() kaller findStuck FØR getOrCreateForToday", async () => {
  const { service, mocks } = makeService();
  await service.start({ actor: MASTER_ACTOR, hallId: HALL_ID });

  const findStuckIdx = mocks.planRunCalls.indexOf("findStuck");
  const getOrCreateIdx = mocks.planRunCalls.indexOf("getOrCreateForToday");

  assert.ok(findStuckIdx >= 0, "findStuck må kalles");
  assert.ok(getOrCreateIdx >= 0, "getOrCreateForToday må kalles");
  assert.ok(
    findStuckIdx < getOrCreateIdx,
    `findStuck (idx=${findStuckIdx}) må kalles før getOrCreateForToday (idx=${getOrCreateIdx})`,
  );
});

test("reconcile: start() med stuck-run → finish kalles + audit-event skrives", async () => {
  const stuckRun = makeStuckRun();
  const { service, mocks } = makeService({
    stuckRuns: [stuckRun],
  });

  await service.start({ actor: MASTER_ACTOR, hallId: HALL_ID });

  // finish-kallet er gjort på stuck-raden via hall+businessDate (samme som
  // finish-API i GamePlanRunService — hallId+businessDate identifiserer
  // raden, runId trengs ikke som parameter).
  assert.equal(mocks.finishInputs.length, 1, "finish() må kalles én gang");
  assert.equal(mocks.finishInputs[0]?.hallId, HALL_ID);
  assert.equal(mocks.finishInputs[0]?.businessDate, TODAY_OSLO);
  assert.equal(mocks.finishInputs[0]?.masterUserId, MASTER_ACTOR.userId);

  // Audit-event skrives med korrekt action + detaljer.
  const reconcileAudit = mocks.auditEvents.find(
    (e) => e.action === "plan_run.reconcile_stuck",
  );
  assert.ok(
    reconcileAudit,
    "plan_run.reconcile_stuck audit-event må skrives",
  );
  assert.equal(reconcileAudit?.actorId, MASTER_ACTOR.userId);
  assert.equal(reconcileAudit?.details.reason, "no_active_scheduled_games");
  assert.equal(reconcileAudit?.details.triggeringAction, "start");
  assert.equal(reconcileAudit?.details.planRunId, STUCK_RUN_ID);
  assert.equal(reconcileAudit?.details.currentPosition, 1);
  assert.equal(reconcileAudit?.details.hallId, HALL_ID);
});

test("reconcile: start() uten stuck-run → no-op (finish ikke kalt, ingen audit)", async () => {
  const { service, mocks } = makeService({
    stuckRuns: [], // ingen stuck
  });

  await service.start({ actor: MASTER_ACTOR, hallId: HALL_ID });

  assert.equal(mocks.finishInputs.length, 0, "finish skal IKKE kalles");
  const reconcileAudit = mocks.auditEvents.find(
    (e) => e.action === "plan_run.reconcile_stuck",
  );
  assert.equal(
    reconcileAudit,
    undefined,
    "plan_run.reconcile_stuck SKAL IKKE skrives når ingen stuck",
  );
});

test("reconcile: advance() kaller findStuck FØR advanceToNext", async () => {
  const { service, mocks } = makeService();
  await service.advance({ actor: MASTER_ACTOR, hallId: HALL_ID });

  const findStuckIdx = mocks.planRunCalls.indexOf("findStuck");
  const advanceIdx = mocks.planRunCalls.indexOf("advanceToNext");

  assert.ok(findStuckIdx >= 0, "findStuck må kalles");
  assert.ok(advanceIdx >= 0, "advanceToNext må kalles");
  assert.ok(
    findStuckIdx < advanceIdx,
    `findStuck (idx=${findStuckIdx}) må kalles før advanceToNext (idx=${advanceIdx})`,
  );
});

test("reconcile: advance() med stuck-run → finish kalles + audit triggeringAction='advance'", async () => {
  const stuckRun = makeStuckRun();
  const { service, mocks } = makeService({
    stuckRuns: [stuckRun],
  });

  await service.advance({ actor: MASTER_ACTOR, hallId: HALL_ID });

  assert.equal(mocks.finishInputs.length, 1);
  const reconcileAudit = mocks.auditEvents.find(
    (e) => e.action === "plan_run.reconcile_stuck",
  );
  assert.ok(reconcileAudit);
  assert.equal(reconcileAudit?.details.triggeringAction, "advance");
});

test("reconcile: findStuck-input bruker korrekt (hallId, businessDate)", async () => {
  const { service, mocks } = makeService();
  await service.start({ actor: MASTER_ACTOR, hallId: HALL_ID });

  assert.equal(mocks.findStuckInputs.length, 1);
  assert.equal(mocks.findStuckInputs[0]?.hallId, HALL_ID);
  assert.equal(mocks.findStuckInputs[0]?.businessDate, TODAY_OSLO);
});

test("reconcile: findStuck kaster → soft-fail, start() fortsetter normalt", async () => {
  const { service, mocks } = makeService({
    findStuckError: new Error("DB connection lost"),
  });

  // start() skal IKKE kaste — findStuck-feil er soft-fail.
  await service.start({ actor: MASTER_ACTOR, hallId: HALL_ID });

  // Normal start-flyt fortsetter.
  assert.ok(mocks.planRunCalls.includes("getOrCreateForToday"));
  assert.ok(mocks.planRunCalls.includes("start"));
  assert.ok(mocks.engineBridgeCalls.includes("createScheduledGameForPlanRunPosition"));

  // Ingen reconcile-audit (finish kalles ikke når findStuck feiler).
  const reconcileAudit = mocks.auditEvents.find(
    (e) => e.action === "plan_run.reconcile_stuck",
  );
  assert.equal(reconcileAudit, undefined);
  assert.equal(mocks.finishInputs.length, 0);
});

test("reconcile: finish kaster → soft-fail, start() fortsetter normalt", async () => {
  const stuckRun = makeStuckRun();
  const { service, mocks } = makeService({
    stuckRuns: [stuckRun],
    finishError: new DomainError(
      "GAME_PLAN_RUN_INVALID_TRANSITION",
      "state ble endret under reconcile",
    ),
  });

  // start() skal IKKE kaste — finish-feil under reconcile er soft-fail.
  await service.start({ actor: MASTER_ACTOR, hallId: HALL_ID });

  // Normal start-flyt fortsetter etter soft-fail.
  assert.ok(mocks.planRunCalls.includes("getOrCreateForToday"));

  // finish ble forsøkt, men audit-event for VELLYKKET reconcile er ikke
  // skrevet (siden finish feilet før audit-kallet).
  assert.equal(mocks.finishInputs.length, 1);
  const reconcileAudit = mocks.auditEvents.find(
    (e) => e.action === "plan_run.reconcile_stuck",
  );
  assert.equal(
    reconcileAudit,
    undefined,
    "audit skal IKKE skrives når finish feiler (skrives først etter vellykket finish)",
  );
});
