/**
 * Tests for the nightly cron-tick that wraps GamePlanRunCleanupService.
 *
 * Covers:
 *   1. Service result is propagated to JobResult.itemsProcessed
 *   2. Hour-gate skips ticks before runAtHourLocal (Oslo)
 *   3. Date-key gate prevents double-run within the same Oslo-day
 *   4. alwaysRun bypasses both gates (test-mode)
 *   5. Service errors propagate (so JobScheduler logs + retries)
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createGamePlanRunCleanupJob } from "../gamePlanRunCleanup.js";
import type { GamePlanRunCleanupService } from "../../game/GamePlanRunCleanupService.js";

interface FakeServiceCallLog {
  args: { now: Date }[];
  cleanupResults: number[];
}

function makeServiceStub(
  cleanupCounts: number[],
  opts?: { throwOnIndex?: number },
): {
  service: GamePlanRunCleanupService;
  log: FakeServiceCallLog;
} {
  const log: FakeServiceCallLog = { args: [], cleanupResults: [] };
  let callIndex = 0;
  const service = {
    async cleanupAllStale(now: Date) {
      log.args.push({ now });
      const idx = callIndex++;
      if (opts?.throwOnIndex === idx) {
        throw new Error("simulated-cleanup-failure");
      }
      const count = cleanupCounts[idx] ?? 0;
      log.cleanupResults.push(count);
      return {
        cleanedCount: count,
        closedRuns: Array.from({ length: count }, (_, i) => ({
          id: `run-${idx}-${i}`,
          planId: "plan-1",
          hallId: "hall-1",
          businessDate: "2026-05-08",
          previousStatus: "running" as const,
        })),
      };
    },
  } as unknown as GamePlanRunCleanupService;
  return { service, log };
}

test("alwaysRun: forwards service.cleanedCount to itemsProcessed", async () => {
  const { service, log } = makeServiceStub([3]);
  const job = createGamePlanRunCleanupJob({ service, alwaysRun: true });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 3);
  assert.match(result.note ?? "", /auto-closed=3/);
  assert.equal(log.args.length, 1);
});

test("alwaysRun + 0 cleanups → itemsProcessed=0, friendly note", async () => {
  const { service } = makeServiceStub([0]);
  const job = createGamePlanRunCleanupJob({ service, alwaysRun: true });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /no stale runs/);
});

test("hour-gate: skips before runAtHourLocal Oslo (returns 0, no service call)", async () => {
  const { service, log } = makeServiceStub([5]);
  const job = createGamePlanRunCleanupJob({
    service,
    runAtHourLocal: 23, // very late; before 23:00 Oslo always
  });
  // Pick early-morning UTC; even worst-case (UTC+2 Oslo summer) is < 23.
  const earlyUtc = new Date("2026-05-09T05:00:00Z");
  const result = await job(earlyUtc.getTime());
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /waiting for 23:00 Oslo/);
  assert.equal(log.args.length, 0, "service must not be called when hour-gate fires");
});

test("date-key gate: second call same Oslo-day is no-op even after hour passes", async () => {
  const { service, log } = makeServiceStub([4, 7]);
  const job = createGamePlanRunCleanupJob({
    service,
    runAtHourLocal: 0, // any hour qualifies so we isolate date-gate behaviour
  });
  // First call: midnight UTC = 02:00 Oslo (summer) — passes hour-gate
  const t1 = new Date("2026-05-09T05:00:00Z").getTime();
  const r1 = await job(t1);
  assert.equal(r1.itemsProcessed, 4);
  // Second call: same Oslo-day, later hour
  const t2 = new Date("2026-05-09T18:00:00Z").getTime();
  const r2 = await job(t2);
  assert.equal(r2.itemsProcessed, 0);
  assert.match(r2.note ?? "", /already ran today/);
  assert.equal(log.args.length, 1, "second call must not invoke service");
});

test("date-key gate: next Oslo-day re-runs the cleanup", async () => {
  const { service, log } = makeServiceStub([2, 6]);
  const job = createGamePlanRunCleanupJob({
    service,
    runAtHourLocal: 0,
  });
  const day1 = new Date("2026-05-09T05:00:00Z").getTime();
  const day2 = new Date("2026-05-10T05:00:00Z").getTime();
  await job(day1);
  const result = await job(day2);
  assert.equal(result.itemsProcessed, 6);
  assert.equal(log.args.length, 2);
});

test("service error rethrows (JobScheduler picks it up + retries)", async () => {
  const { service } = makeServiceStub([0], { throwOnIndex: 0 });
  const job = createGamePlanRunCleanupJob({ service, alwaysRun: true });
  await assert.rejects(() => job(Date.now()), /simulated-cleanup-failure/);
});
