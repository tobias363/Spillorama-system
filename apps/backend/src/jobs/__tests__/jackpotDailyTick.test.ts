/**
 * MASTER_PLAN §2.3 — tester for `jackpot-daily-tick` cron-job.
 *
 * Dekker:
 *   - Før runAtHour/runAtMinute → no-op waiting-note
 *   - Samme date-key to ganger → andre kall er no-op
 *   - Kaller service.accumulateDaily én gang per dag
 *   - Note inneholder updated/alreadyCurrent/capped-tall
 *   - 42P01 fra service → soft-no-op
 *   - alwaysRun=true overstyrer hour/date-key
 *   - Ikke-42P01 feil propageres
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createJackpotDailyTickJob } from "../jackpotDailyTick.js";
import type {
  AccumulateDailyResult,
  Game1JackpotStateService,
} from "../../game/Game1JackpotStateService.js";

interface Recorder {
  calls: number;
  behavior?: () => Promise<AccumulateDailyResult>;
}

function makeService(rec: Recorder): Game1JackpotStateService {
  return {
    accumulateDaily: async (): Promise<AccumulateDailyResult> => {
      rec.calls += 1;
      if (rec.behavior) return rec.behavior();
      return { updatedCount: 3, alreadyCurrentCount: 2, cappedCount: 1, errors: 0 };
    },
  } as unknown as Game1JackpotStateService;
}

// ── Guards ────────────────────────────────────────────────────────────────

test("jackpot-daily-tick: før runAtHour → waiting note, ingen kall", async () => {
  const rec: Recorder = { calls: 0 };
  const service = makeService(rec);
  const job = createJackpotDailyTickJob({
    service,
    runAtHourLocal: 0,
    runAtMinuteLocal: 15,
  });
  // Klokka er 00:05 — før 00:15
  const tooEarly = new Date("2026-04-24T00:05:00").getTime();
  const result = await job(tooEarly);
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /waiting for 00:15/);
  assert.equal(rec.calls, 0);
});

test("jackpot-daily-tick: samme date-key to ganger → andre kall er no-op", async () => {
  const rec: Recorder = { calls: 0 };
  const service = makeService(rec);
  const job = createJackpotDailyTickJob({
    service,
    runAtHourLocal: 0,
    runAtMinuteLocal: 15,
  });
  const first = new Date("2026-04-24T00:20:00").getTime();
  const second = new Date("2026-04-24T00:25:00").getTime();

  const r1 = await job(first);
  assert.equal(rec.calls, 1, "første kall skal kjøre");
  assert.doesNotMatch(r1.note ?? "", /already ran today/);

  const r2 = await job(second);
  assert.equal(rec.calls, 1, "andre kall samme dag skal være no-op");
  assert.match(r2.note ?? "", /already ran today/);
});

test("jackpot-daily-tick: note inkluderer updated/alreadyCurrent/capped", async () => {
  const rec: Recorder = {
    calls: 0,
    behavior: async () => ({
      updatedCount: 5,
      alreadyCurrentCount: 2,
      cappedCount: 3,
      errors: 0,
    }),
  };
  const service = makeService(rec);
  const job = createJackpotDailyTickJob({
    service,
    runAtHourLocal: 0,
    runAtMinuteLocal: 0,
  });
  const result = await job(new Date("2026-04-24T01:00:00").getTime());
  assert.equal(result.itemsProcessed, 5);
  assert.match(result.note ?? "", /updated=5/);
  assert.match(result.note ?? "", /alreadyCurrent=2/);
  assert.match(result.note ?? "", /capped=3/);
});

test("jackpot-daily-tick: alwaysRun overstyrer hour og date-key", async () => {
  const rec: Recorder = { calls: 0 };
  const service = makeService(rec);
  const job = createJackpotDailyTickJob({
    service,
    runAtHourLocal: 23,
    runAtMinuteLocal: 59,
    alwaysRun: true,
  });
  const morning = new Date("2026-04-24T08:00:00").getTime();
  await job(morning);
  await job(morning);
  assert.equal(rec.calls, 2, "alwaysRun skal ignorere date-key");
});

// ── Error handling ────────────────────────────────────────────────────────

test("jackpot-daily-tick: 42P01 fra service → soft no-op (migrasjon ikke kjørt)", async () => {
  const rec: Recorder = {
    calls: 0,
    behavior: async () => {
      const err = new Error("relation \"app_game1_jackpot_state\" does not exist") as Error & {
        code?: string;
      };
      err.code = "42P01";
      throw err;
    },
  };
  const service = makeService(rec);
  const job = createJackpotDailyTickJob({
    service,
    runAtHourLocal: 0,
    runAtMinuteLocal: 0,
    alwaysRun: true,
  });
  const result = await job(Date.now());
  assert.equal(result.itemsProcessed, 0);
  assert.match(result.note ?? "", /tabell mangler/i);
});

test("jackpot-daily-tick: ikke-42P01 feil propageres", async () => {
  const rec: Recorder = {
    calls: 0,
    behavior: async () => {
      throw new Error("catastrophic failure");
    },
  };
  const service = makeService(rec);
  const job = createJackpotDailyTickJob({
    service,
    runAtHourLocal: 0,
    runAtMinuteLocal: 0,
    alwaysRun: true,
  });
  await assert.rejects(() => job(Date.now()), /catastrophic failure/);
});
