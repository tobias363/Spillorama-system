/**
 * BUG-A 2026-05-14: tests for the natural-end-reconcile cron-tick that
 * wraps GamePlanRunCleanupService.reconcileNaturalEndStuckRuns.
 *
 * Covers:
 *   1. Service result is propagated to JobResult.itemsProcessed
 *   2. 42P01 (table missing) → graceful no-op (no throw)
 *   3. Non-42P01 service errors propagate (so JobScheduler logs + retries)
 *   4. Env-helpers default + parsing
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  createGamePlanRunNaturalEndReconcileJob,
  getGamePlanRunNaturalEndReconcileIntervalMs,
  getGamePlanRunNaturalEndReconcileThresholdMs,
  isGamePlanRunNaturalEndReconcileEnabled,
} from "../gamePlanRunNaturalEndReconcile.js";
import type {
  GamePlanRunCleanupService,
  NaturalEndReconcileResult,
} from "../../game/GamePlanRunCleanupService.js";

function makeServiceStub(opts: {
  result?: NaturalEndReconcileResult;
  throw?: Error;
}): GamePlanRunCleanupService {
  return {
    async reconcileNaturalEndStuckRuns(): Promise<NaturalEndReconcileResult> {
      if (opts.throw) throw opts.throw;
      return (
        opts.result ?? {
          cleanedCount: 0,
          closedRuns: [],
        }
      );
    },
  } as unknown as GamePlanRunCleanupService;
}

test("propagates cleanedCount to JobResult.itemsProcessed", async () => {
  const service = makeServiceStub({
    result: {
      cleanedCount: 2,
      closedRuns: [
        {
          id: "r1",
          planId: "p1",
          hallId: "h1",
          businessDate: "2026-05-14",
          previousStatus: "running",
          currentPosition: 1,
          scheduledGameId: "sg1",
          scheduledGameEndedAt: "2026-05-14T07:00:00Z",
          stuckForSeconds: 60,
        },
        {
          id: "r2",
          planId: "p1",
          hallId: "h2",
          businessDate: "2026-05-14",
          previousStatus: "running",
          currentPosition: 1,
          scheduledGameId: "sg2",
          scheduledGameEndedAt: "2026-05-14T07:00:00Z",
          stuckForSeconds: 60,
        },
      ],
    },
  });
  const job = createGamePlanRunNaturalEndReconcileJob({ service });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 2);
  assert.match(result.note ?? "", /reconciled=2/);
});

test("zero stuck runs → itemsProcessed=0 + 'no stuck plan-runs' note", async () => {
  const service = makeServiceStub({});
  const job = createGamePlanRunNaturalEndReconcileJob({ service });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 0);
  assert.equal(result.note, "no stuck plan-runs");
});

test("42P01 PG error → soft no-op (fresh DB boot-safe, no throw)", async () => {
  const err = new Error("undefined_table") as Error & { code: string };
  err.code = "42P01";
  const service = makeServiceStub({ throw: err });
  const job = createGamePlanRunNaturalEndReconcileJob({ service });
  // Must NOT throw — JobScheduler tick should continue running.
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /migration ikke kjørt/);
});

test("non-42P01 PG error → bubbles to JobScheduler (logs + retries)", async () => {
  const err = new Error("connection lost") as Error & { code: string };
  err.code = "08000";
  const service = makeServiceStub({ throw: err });
  const job = createGamePlanRunNaturalEndReconcileJob({ service });
  await assert.rejects(() => job(Date.now()), /connection lost/);
});

test("generic error without code → bubbles", async () => {
  const service = makeServiceStub({ throw: new Error("oops") });
  const job = createGamePlanRunNaturalEndReconcileJob({ service });
  await assert.rejects(() => job(Date.now()), /oops/);
});

// ── env-helper tests ─────────────────────────────────────────────────────

test("isGamePlanRunNaturalEndReconcileEnabled defaults to true", () => {
  assert.equal(isGamePlanRunNaturalEndReconcileEnabled({}), true);
  assert.equal(
    isGamePlanRunNaturalEndReconcileEnabled({
      GAME_PLAN_RUN_NATURAL_END_RECONCILE_ENABLED: "true",
    }),
    true,
  );
});

test("isGamePlanRunNaturalEndReconcileEnabled returns false only for explicit 'false'", () => {
  assert.equal(
    isGamePlanRunNaturalEndReconcileEnabled({
      GAME_PLAN_RUN_NATURAL_END_RECONCILE_ENABLED: "false",
    }),
    false,
  );
});

test("getGamePlanRunNaturalEndReconcileIntervalMs default 30 000", () => {
  assert.equal(getGamePlanRunNaturalEndReconcileIntervalMs({}), 30_000);
});

test("getGamePlanRunNaturalEndReconcileIntervalMs parses valid env", () => {
  assert.equal(
    getGamePlanRunNaturalEndReconcileIntervalMs({
      GAME_PLAN_RUN_NATURAL_END_RECONCILE_INTERVAL_MS: "60000",
    }),
    60_000,
  );
});

test("getGamePlanRunNaturalEndReconcileIntervalMs floors at 5 sek", () => {
  assert.equal(
    getGamePlanRunNaturalEndReconcileIntervalMs({
      GAME_PLAN_RUN_NATURAL_END_RECONCILE_INTERVAL_MS: "100",
    }),
    5_000,
  );
});

test("getGamePlanRunNaturalEndReconcileIntervalMs caps at 1 time", () => {
  assert.equal(
    getGamePlanRunNaturalEndReconcileIntervalMs({
      GAME_PLAN_RUN_NATURAL_END_RECONCILE_INTERVAL_MS: "999999999",
    }),
    60 * 60 * 1000,
  );
});

test("getGamePlanRunNaturalEndReconcileIntervalMs handles non-numeric", () => {
  assert.equal(
    getGamePlanRunNaturalEndReconcileIntervalMs({
      GAME_PLAN_RUN_NATURAL_END_RECONCILE_INTERVAL_MS: "not-a-number",
    }),
    30_000,
  );
});

test("getGamePlanRunNaturalEndReconcileThresholdMs default 30 000", () => {
  assert.equal(getGamePlanRunNaturalEndReconcileThresholdMs({}), 30_000);
});

test("getGamePlanRunNaturalEndReconcileThresholdMs parses + clamps", () => {
  assert.equal(
    getGamePlanRunNaturalEndReconcileThresholdMs({
      PLAN_RUN_NATURAL_END_RECONCILE_THRESHOLD_MS: "60000",
    }),
    60_000,
  );
  assert.equal(
    getGamePlanRunNaturalEndReconcileThresholdMs({
      PLAN_RUN_NATURAL_END_RECONCILE_THRESHOLD_MS: "500",
    }),
    1_000, // floor
  );
  assert.equal(
    getGamePlanRunNaturalEndReconcileThresholdMs({
      PLAN_RUN_NATURAL_END_RECONCILE_THRESHOLD_MS: "999999999",
    }),
    30 * 60 * 1000, // cap
  );
});
