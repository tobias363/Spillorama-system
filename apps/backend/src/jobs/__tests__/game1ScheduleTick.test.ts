/**
 * GAME1_SCHEDULE PR 1+2: tests for the JobScheduler-integration wrapper.
 *
 * Verifies:
 *   - Job calls all four service methods in sequence (PR2 added transitionReadyToStartGames)
 *   - Job aggregates item counts into JobResult
 *   - Feature-flag disabled → scheduler does not run the job (verified
 *     via JobScheduler harness)
 *   - 42P01 (missing table) in the service → job returns 0 with note
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createGame1ScheduleTickJob } from "../game1ScheduleTick.js";
import { createJobScheduler } from "../JobScheduler.js";
import { logger as rootLogger } from "../../util/logger.js";

const silentLogger = rootLogger.child({ module: "test" });
silentLogger.level = "silent";

interface ServiceRecorder {
  spawnCalls: number;
  openCalls: number;
  readyCalls: number;
  cancelCalls: number;
}

function makeService(overrides: {
  spawned?: number;
  skipped?: number;
  skippedSchedules?: number;
  errors?: number;
  opened?: number;
  readied?: number;
  cancelled?: number;
  throwCode?: string;
} = {}): {
  service: Parameters<typeof createGame1ScheduleTickJob>[0]["service"];
  recorder: ServiceRecorder;
} {
  const recorder: ServiceRecorder = {
    spawnCalls: 0,
    openCalls: 0,
    readyCalls: 0,
    cancelCalls: 0,
  };
  const service = {
    spawnUpcomingGame1Games: async () => {
      recorder.spawnCalls++;
      if (overrides.throwCode) {
        const err = new Error("simulated");
        (err as unknown as { code?: string }).code = overrides.throwCode;
        throw err;
      }
      return {
        spawned: overrides.spawned ?? 0,
        skipped: overrides.skipped ?? 0,
        skippedSchedules: overrides.skippedSchedules ?? 0,
        errors: overrides.errors ?? 0,
      };
    },
    openPurchaseForImminentGames: async () => {
      recorder.openCalls++;
      return overrides.opened ?? 0;
    },
    transitionReadyToStartGames: async () => {
      recorder.readyCalls++;
      return overrides.readied ?? 0;
    },
    cancelEndOfDayUnstartedGames: async () => {
      recorder.cancelCalls++;
      return overrides.cancelled ?? 0;
    },
  } as unknown as Parameters<typeof createGame1ScheduleTickJob>[0]["service"];
  return { service, recorder };
}

test("game1-schedule-tick: kaller alle 4 service-metoder i sekvens", async () => {
  const { service, recorder } = makeService({
    spawned: 2,
    opened: 1,
    readied: 0,
    cancelled: 0,
  });
  const job = createGame1ScheduleTickJob({ service });
  const result = await job(Date.now());
  assert.equal(recorder.spawnCalls, 1);
  assert.equal(recorder.openCalls, 1);
  assert.equal(recorder.readyCalls, 1);
  assert.equal(recorder.cancelCalls, 1);
  assert.equal(result.itemsProcessed, 3);
  assert.match(result.note ?? "", /spawned=2/);
  assert.match(result.note ?? "", /opened=1/);
});

test("game1-schedule-tick: aggregerer tellere for note-feltet", async () => {
  const { service } = makeService({
    spawned: 5,
    skipped: 3,
    skippedSchedules: 2,
    errors: 1,
    opened: 4,
    readied: 1,
    cancelled: 2,
  });
  const job = createGame1ScheduleTickJob({ service });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 5 + 4 + 1 + 2);
  const note = result.note ?? "";
  assert.match(note, /spawned=5/);
  assert.match(note, /skipped=3/);
  assert.match(note, /skippedSchedules=2/);
  assert.match(note, /errors=1/);
  assert.match(note, /opened=4/);
  assert.match(note, /readied=1/);
  assert.match(note, /cancelled=2/);
});

test("game1-schedule-tick: 42P01 fra service → returnerer 0 med note (ikke kast)", async () => {
  const { service } = makeService({ throwCode: "42P01" });
  const job = createGame1ScheduleTickJob({ service });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /tabell mangler/);
});

test("game1-schedule-tick: andre errors fra service propageres (scheduler fanger)", async () => {
  const { service } = makeService({ throwCode: "23505" });
  const job = createGame1ScheduleTickJob({ service });
  await assert.rejects(() => job(Date.now()));
});

test("game1-schedule-tick: JobScheduler harness — feature-flag OFF hopper over job", async () => {
  const { service, recorder } = makeService({ spawned: 0 });
  const scheduler = createJobScheduler({ enabled: true, logger: silentLogger });
  scheduler.register({
    name: "game1-schedule-tick-test",
    description: "test",
    intervalMs: 60_000,
    enabled: false, // feature-flag OFF
    run: createGame1ScheduleTickJob({ service }),
  });
  scheduler.start();
  await new Promise((r) => setTimeout(r, 10));
  scheduler.stop();
  assert.equal(recorder.spawnCalls, 0, "job skal ikke kjøre når enabled=false");
});

test("game1-schedule-tick: JobScheduler harness — feature-flag ON kjører job", async () => {
  const { service, recorder } = makeService({ spawned: 1 });
  const scheduler = createJobScheduler({ enabled: true, logger: silentLogger });
  scheduler.register({
    name: "game1-schedule-tick-test-on",
    description: "test",
    intervalMs: 60_000,
    enabled: true,
    run: createGame1ScheduleTickJob({ service }),
  });
  scheduler.start();
  await new Promise((r) => setTimeout(r, 10));
  scheduler.stop();
  assert.ok(recorder.spawnCalls >= 1, "job skal kjøre minst én gang ved start");
});
