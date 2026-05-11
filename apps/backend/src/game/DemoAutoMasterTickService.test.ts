/**
 * DemoAutoMasterTickService — unit-tests
 *
 * Tobias-direktiv 2026-05-11: auto-master for hall-default (diagnostic
 * for hall-isolation-verifisering). Tjenesten skal:
 *   - Start plan-run når ingen finnes
 *   - Advance når aktiv scheduled-game er finished
 *   - Skip når run er finished eller scheduled-game kjører
 *   - Fail-soft per hall (en feil blokkerer ikke andre)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DemoAutoMasterTickService,
  isDemoAutoMasterEnabled,
} from "./DemoAutoMasterTickService.js";

// ── Test-double-helpers ─────────────────────────────────────────────────

interface FakeRun {
  id: string;
  hallId: string;
  businessDate: string;
  status: "idle" | "running" | "paused" | "finished";
  currentPosition: number;
}

function makeFakePlanRunService(opts: {
  runByHall: Record<string, FakeRun | null>;
}) {
  return {
    findForDay: async (hallId: string, _businessDate: string): Promise<FakeRun | null> =>
      opts.runByHall[hallId] ?? null,
  };
}

function makeFakeMasterActionService(opts: {
  startCalls: string[];
  advanceCalls: string[];
  startError?: Error;
  advanceError?: Error;
}) {
  return {
    start: async (input: { actor: unknown; hallId: string }) => {
      if (opts.startError) throw opts.startError;
      opts.startCalls.push(input.hallId);
      return { run: { status: "running" }, scheduledGameId: "new-sg-id" } as never;
    },
    advance: async (input: { actor: unknown; hallId: string }) => {
      if (opts.advanceError) throw opts.advanceError;
      opts.advanceCalls.push(input.hallId);
      return { run: { status: "running" }, scheduledGameId: "next-sg-id" } as never;
    },
  };
}

function makeFakePool(opts: {
  scheduledGameStatusByPosition?: Record<string, string>;
  timingOverrideCalls?: Array<{ hallId: string; seconds: number }>;
}) {
  return {
    query: async (sql: string, params: unknown[]) => {
      // applyDefaultHallTimingOverride: UPDATE ... SET ticket_config_json = jsonb_set(...)
      if (sql.includes("UPDATE") && sql.includes("ticket_config_json")) {
        opts.timingOverrideCalls?.push({
          hallId: String(params[0]),
          seconds: Number(params[1]),
        });
        return { rows: [] };
      }
      // getCurrentScheduledGameStatus: SELECT status FROM app_game1_scheduled_games
      const position = String(params[1]);
      const status = opts.scheduledGameStatusByPosition?.[position];
      return { rows: status ? [{ status }] : [] };
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

test("isDemoAutoMasterEnabled: false når env-var ikke er satt", () => {
  delete process.env["DEMO_AUTO_MASTER_ENABLED"];
  assert.equal(isDemoAutoMasterEnabled(), false);
});

test("isDemoAutoMasterEnabled: true når DEMO_AUTO_MASTER_ENABLED='true'", () => {
  process.env["DEMO_AUTO_MASTER_ENABLED"] = "true";
  assert.equal(isDemoAutoMasterEnabled(), true);
  delete process.env["DEMO_AUTO_MASTER_ENABLED"];
});

test("isDemoAutoMasterEnabled: false når DEMO_AUTO_MASTER_ENABLED='false'", () => {
  process.env["DEMO_AUTO_MASTER_ENABLED"] = "false";
  assert.equal(isDemoAutoMasterEnabled(), false);
  delete process.env["DEMO_AUTO_MASTER_ENABLED"];
});

test("tick: ingen run → kaller masterActionService.start", async () => {
  const startCalls: string[] = [];
  const advanceCalls: string[] = [];
  const masterActionService = makeFakeMasterActionService({
    startCalls,
    advanceCalls,
  });
  const planRunService = makeFakePlanRunService({ runByHall: {} });
  const pool = makeFakePool({});

  const service = new DemoAutoMasterTickService({
    pool: pool as never,
    masterActionService: masterActionService as never,
    planRunService: planRunService as never,
    targetHallIds: ["hall-default"],
  });

  const result = await service.tick();

  assert.equal(result.checked, 1);
  assert.equal(result.startedNew, 1);
  assert.equal(result.advanced, 0);
  assert.deepEqual(startCalls, ["hall-default"]);
});

test("tick: run.status='finished' → slett run for ny iteration (Tobias loop 2026-05-11)", async () => {
  const startCalls: string[] = [];
  const advanceCalls: string[] = [];
  const deleteCalls: string[] = [];
  const masterActionService = makeFakeMasterActionService({
    startCalls,
    advanceCalls,
  });
  const planRunService = makeFakePlanRunService({
    runByHall: {
      "hall-default": {
        id: "run-finished-1",
        hallId: "hall-default",
        businessDate: "2026-05-11",
        status: "finished",
        currentPosition: 1,
      },
    },
  });
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("DELETE FROM") && sql.includes("app_game_plan_run")) {
        deleteCalls.push(String(params[0]));
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const service = new DemoAutoMasterTickService({
    pool: pool as never,
    masterActionService: masterActionService as never,
    planRunService: planRunService as never,
    targetHallIds: ["hall-default"],
  });

  const result = await service.tick();

  // Tobias-direktiv 2026-05-11: finished run skal slettes så cron looper.
  assert.equal(result.checked, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(deleteCalls, ["run-finished-1"]);
  assert.equal(startCalls.length, 0);
  assert.equal(advanceCalls.length, 0);
});

test("tick: scheduled-game.status='completed' → advance", async () => {
  const startCalls: string[] = [];
  const advanceCalls: string[] = [];
  const masterActionService = makeFakeMasterActionService({
    startCalls,
    advanceCalls,
  });
  const planRunService = makeFakePlanRunService({
    runByHall: {
      "hall-default": {
        id: "run-1",
        hallId: "hall-default",
        businessDate: "2026-05-11",
        status: "running",
        currentPosition: 1,
      },
    },
  });
  const pool = makeFakePool({
    scheduledGameStatusByPosition: { "1": "completed" },
  });

  const service = new DemoAutoMasterTickService({
    pool: pool as never,
    masterActionService: masterActionService as never,
    planRunService: planRunService as never,
    targetHallIds: ["hall-default"],
  });

  const result = await service.tick();

  assert.equal(result.advanced, 1);
  assert.deepEqual(advanceCalls, ["hall-default"]);
});

test("tick: scheduled-game.status='running' → skip (auto-draw håndterer)", async () => {
  const startCalls: string[] = [];
  const advanceCalls: string[] = [];
  const masterActionService = makeFakeMasterActionService({
    startCalls,
    advanceCalls,
  });
  const planRunService = makeFakePlanRunService({
    runByHall: {
      "hall-default": {
        id: "run-1",
        hallId: "hall-default",
        businessDate: "2026-05-11",
        status: "running",
        currentPosition: 1,
      },
    },
  });
  const pool = makeFakePool({
    scheduledGameStatusByPosition: { "1": "running" },
  });

  const service = new DemoAutoMasterTickService({
    pool: pool as never,
    masterActionService: masterActionService as never,
    planRunService: planRunService as never,
    targetHallIds: ["hall-default"],
  });

  const result = await service.tick();

  assert.equal(result.skipped, 1);
  assert.equal(startCalls.length, 0);
  assert.equal(advanceCalls.length, 0);
});

test("tick: NO_MATCHING_PLAN-feil ved start → skip (ikke error)", async () => {
  const startCalls: string[] = [];
  const advanceCalls: string[] = [];
  const masterActionService = makeFakeMasterActionService({
    startCalls,
    advanceCalls,
    startError: Object.assign(new Error("NO_MATCHING_PLAN: ingen plan dekker"), {
      code: "NO_MATCHING_PLAN",
    }),
  });
  const planRunService = makeFakePlanRunService({ runByHall: {} });
  const pool = makeFakePool({});

  const service = new DemoAutoMasterTickService({
    pool: pool as never,
    masterActionService: masterActionService as never,
    planRunService: planRunService as never,
    targetHallIds: ["hall-default"],
  });

  const result = await service.tick();

  // NO_MATCHING_PLAN er forventet hvis seed ikke har kjørt — telles som skip
  assert.equal(result.skipped, 1);
  assert.equal(result.errors, 0);
});

test("tick: én hall feiler, andre fortsetter (fail-soft)", async () => {
  const startCalls: string[] = [];
  const advanceCalls: string[] = [];
  let throwOnFirst = true;
  const masterActionService = {
    start: async (input: { actor: unknown; hallId: string }) => {
      if (throwOnFirst) {
        throwOnFirst = false;
        throw new Error("UNEXPECTED_DB_ERROR");
      }
      startCalls.push(input.hallId);
      return {} as never;
    },
    advance: async () => {
      throw new Error("not called");
    },
  };
  const planRunService = makeFakePlanRunService({ runByHall: {} });
  const pool = makeFakePool({});

  const service = new DemoAutoMasterTickService({
    pool: pool as never,
    masterActionService: masterActionService as never,
    planRunService: planRunService as never,
    targetHallIds: ["hall-a", "hall-b"],
  });

  const result = await service.tick();

  assert.equal(result.checked, 2);
  assert.equal(result.errors, 1);
  assert.equal(result.startedNew, 1);
  assert.deepEqual(startCalls, ["hall-b"]);
  assert.ok(
    result.errorMessages?.[0]?.includes("hall-a"),
    "error-message should reference hall-a",
  );
});

test("tick: etter start() patcher ticket_config seconds=3 for default-hall (Tobias 2026-05-11)", async () => {
  const startCalls: string[] = [];
  const advanceCalls: string[] = [];
  const timingOverrideCalls: Array<{ hallId: string; seconds: number }> = [];
  const masterActionService = makeFakeMasterActionService({
    startCalls,
    advanceCalls,
  });
  const planRunService = makeFakePlanRunService({ runByHall: {} });
  const pool = makeFakePool({ timingOverrideCalls });

  const service = new DemoAutoMasterTickService({
    pool: pool as never,
    masterActionService: masterActionService as never,
    planRunService: planRunService as never,
    targetHallIds: ["hall-default"],
  });

  await service.tick();

  assert.equal(timingOverrideCalls.length, 1);
  assert.deepEqual(timingOverrideCalls[0], {
    hallId: "hall-default",
    seconds: 30,
  });
});

test("tick: advance() patcher også timing-override for ny scheduled-game", async () => {
  const startCalls: string[] = [];
  const advanceCalls: string[] = [];
  const timingOverrideCalls: Array<{ hallId: string; seconds: number }> = [];
  const masterActionService = makeFakeMasterActionService({
    startCalls,
    advanceCalls,
  });
  const planRunService = makeFakePlanRunService({
    runByHall: {
      "hall-default": {
        id: "run-1",
        hallId: "hall-default",
        businessDate: "2026-05-11",
        status: "running",
        currentPosition: 1,
      },
    },
  });
  const pool = makeFakePool({
    scheduledGameStatusByPosition: { "1": "completed" },
    timingOverrideCalls,
  });

  const service = new DemoAutoMasterTickService({
    pool: pool as never,
    masterActionService: masterActionService as never,
    planRunService: planRunService as never,
    targetHallIds: ["hall-default"],
  });

  const result = await service.tick();

  assert.equal(result.advanced, 1);
  assert.equal(timingOverrideCalls.length, 1);
  assert.equal(timingOverrideCalls[0].seconds, 30);
});

test("tick: idle-run uten scheduled-game → start() (bug-fix 2026-05-11)", async () => {
  const startCalls: string[] = [];
  const advanceCalls: string[] = [];
  const timingOverrideCalls: Array<{ hallId: string; seconds: number }> = [];
  const masterActionService = makeFakeMasterActionService({
    startCalls,
    advanceCalls,
  });
  const planRunService = makeFakePlanRunService({
    runByHall: {
      "hall-default": {
        id: "run-1",
        hallId: "hall-default",
        businessDate: "2026-05-11",
        status: "idle",
        currentPosition: 1,
      },
    },
  });
  const pool = makeFakePool({
    // scheduledGameStatusByPosition er tom → null → start() skal kjøres
    timingOverrideCalls,
  });

  const service = new DemoAutoMasterTickService({
    pool: pool as never,
    masterActionService: masterActionService as never,
    planRunService: planRunService as never,
    targetHallIds: ["hall-default"],
  });

  const result = await service.tick();

  // Pre-fix bug: dette ville være skipped=1 fordi run finnes (ikke null)
  // Post-fix: idle-run uten scheduled-game → start() kalles
  assert.equal(result.startedNew, 1);
  assert.deepEqual(startCalls, ["hall-default"]);
});

test("tick: default targetHallIds er ['hall-default']", async () => {
  const startCalls: string[] = [];
  const advanceCalls: string[] = [];
  const masterActionService = makeFakeMasterActionService({
    startCalls,
    advanceCalls,
  });
  const planRunService = makeFakePlanRunService({ runByHall: {} });
  const pool = makeFakePool({});

  const service = new DemoAutoMasterTickService({
    pool: pool as never,
    masterActionService: masterActionService as never,
    planRunService: planRunService as never,
    // targetHallIds NOT passed — should default to ['hall-default']
  });

  const result = await service.tick();

  assert.equal(result.checked, 1);
  assert.deepEqual(startCalls, ["hall-default"]);
});
