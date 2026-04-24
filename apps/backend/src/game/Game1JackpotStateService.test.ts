/**
 * MASTER_PLAN §2.3 — tester for Game1JackpotStateService.
 *
 * Dekker:
 *   - getStateForGroup: parser row korrekt (cents, thresholds, date)
 *   - getStateForGroup: manglende rad → defaults (start=2000, cap=30k, thresholds 50/55/56/57)
 *   - accumulateDaily: call-shape matcher WHERE last_accumulation_date < today
 *   - accumulateDaily: separerer updated vs capped vs alreadyCurrent
 *   - accumulateDaily: idempotent (2. kall samme dag gir 0 updates)
 *   - accumulateDaily: 30k-cap håndheves via LEAST (testes via mock-respons)
 *   - resetToStart: setter current_amount_cents tilbake til seed
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, QueryResult } from "pg";
import {
  Game1JackpotStateService,
  JACKPOT_DEFAULT_DAILY_INCREMENT_CENTS,
  JACKPOT_DEFAULT_DRAW_THRESHOLDS,
  JACKPOT_DEFAULT_MAX_CAP_CENTS,
  JACKPOT_DEFAULT_START_CENTS,
} from "./Game1JackpotStateService.js";

interface QueryCall {
  text: string;
  params: unknown[];
}

interface PoolMockOptions {
  /**
   * List av responser som returneres i rekkefølge for hver query.
   * Brukes når testen trenger spesifikke svar per kall.
   */
  responses?: QueryResult<Record<string, unknown>>[];
  /** Throw-behavior per indeks. */
  errors?: Array<Error | null>;
}

function makePoolMock(opts: PoolMockOptions = {}): {
  pool: Pool;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  let idx = 0;
  const pool = {
    query: async (text: string, params: unknown[] = []): Promise<QueryResult<Record<string, unknown>>> => {
      calls.push({ text, params });
      const err = opts.errors?.[idx];
      const response = opts.responses?.[idx];
      idx += 1;
      if (err) throw err;
      return response ?? ({ rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>);
    },
  } as unknown as Pool;
  return { pool, calls };
}

// ─── getStateForGroup ─────────────────────────────────────────────────────

test("getStateForGroup: parser numeric/string felter korrekt", async () => {
  const { pool } = makePoolMock({
    responses: [
      {
        rows: [
          {
            hall_group_id: "group-1",
            current_amount_cents: "500000", // pg bigint kommer ofte som string
            last_accumulation_date: "2026-04-24",
            max_cap_cents: "3000000",
            daily_increment_cents: "400000",
            draw_thresholds_json: [50, 55, 56, 57],
            updated_at: new Date("2026-04-24T10:00:00Z"),
          },
        ],
        rowCount: 1,
      } as unknown as QueryResult<Record<string, unknown>>,
    ],
  });
  const svc = new Game1JackpotStateService({ pool });
  const state = await svc.getStateForGroup("group-1");
  assert.equal(state.hallGroupId, "group-1");
  assert.equal(state.currentAmountCents, 500_000);
  assert.equal(state.maxCapCents, 3_000_000);
  assert.equal(state.dailyIncrementCents, 400_000);
  assert.deepEqual(state.drawThresholds, [50, 55, 56, 57]);
  assert.equal(state.lastAccumulationDate, "2026-04-24");
});

test("getStateForGroup: manglende rad → defaults fra Appendix B.9", async () => {
  const { pool } = makePoolMock({
    responses: [{ rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>],
  });
  const svc = new Game1JackpotStateService({ pool, todayKey: () => "2026-04-24" });
  const state = await svc.getStateForGroup("group-unknown");
  assert.equal(state.currentAmountCents, JACKPOT_DEFAULT_START_CENTS, "2000 kr start");
  assert.equal(state.maxCapCents, JACKPOT_DEFAULT_MAX_CAP_CENTS, "30k cap");
  assert.equal(state.dailyIncrementCents, JACKPOT_DEFAULT_DAILY_INCREMENT_CENTS, "4000/dag");
  assert.deepEqual(state.drawThresholds, [...JACKPOT_DEFAULT_DRAW_THRESHOLDS]);
});

test("getCurrentAmount: returnerer amount fra state", async () => {
  const { pool } = makePoolMock({
    responses: [
      {
        rows: [
          {
            hall_group_id: "g",
            current_amount_cents: 1_200_000,
            last_accumulation_date: "2026-04-24",
            max_cap_cents: 3_000_000,
            daily_increment_cents: 400_000,
            draw_thresholds_json: [50, 55, 56, 57],
            updated_at: new Date(),
          },
        ],
        rowCount: 1,
      } as unknown as QueryResult<Record<string, unknown>>,
    ],
  });
  const svc = new Game1JackpotStateService({ pool });
  const amount = await svc.getCurrentAmount("g");
  assert.equal(amount, 1_200_000);
});

// ─── accumulateDaily ──────────────────────────────────────────────────────

test("accumulateDaily: én gruppe fikk påfyll (under cap)", async () => {
  const { pool, calls } = makePoolMock({
    responses: [
      // UPDATE ... RETURNING
      {
        rows: [
          {
            hall_group_id: "g1",
            current_amount_cents: "600000", // 200k + 400k
            prev_amount_cents: "200000",
            max_cap_cents: "3000000",
          },
        ],
        rowCount: 1,
      } as unknown as QueryResult<Record<string, unknown>>,
      // SELECT COUNT
      { rows: [{ cnt: "1" }], rowCount: 1 } as unknown as QueryResult<Record<string, unknown>>,
    ],
  });
  const svc = new Game1JackpotStateService({ pool, todayKey: () => "2026-04-24" });
  const result = await svc.accumulateDaily();
  assert.equal(result.updatedCount, 1);
  assert.equal(result.cappedCount, 0);
  assert.equal(result.alreadyCurrentCount, 0);
  assert.equal(result.errors, 0);
  assert.ok(calls[0], "første query skal være UPDATE");
  assert.match(calls[0]!.text, /UPDATE/i);
  assert.match(calls[0]!.text, /LEAST/, "bruker LEAST for 30k-cap");
  assert.match(calls[0]!.text, /last_accumulation_date < \$1::date/, "idempotent WHERE-guard");
  assert.deepEqual(calls[0]!.params, ["2026-04-24"]);
});

test("accumulateDaily: gruppe som var på cap (prev >= cap) → capped, ikke updated", async () => {
  const { pool } = makePoolMock({
    responses: [
      {
        rows: [
          {
            hall_group_id: "g-full",
            current_amount_cents: "3000000",
            prev_amount_cents: "3000000", // var allerede på cap
            max_cap_cents: "3000000",
          },
        ],
        rowCount: 1,
      } as unknown as QueryResult<Record<string, unknown>>,
      { rows: [{ cnt: "1" }], rowCount: 1 } as unknown as QueryResult<Record<string, unknown>>,
    ],
  });
  const svc = new Game1JackpotStateService({ pool, todayKey: () => "2026-04-24" });
  const result = await svc.accumulateDaily();
  assert.equal(result.updatedCount, 0);
  assert.equal(result.cappedCount, 1, "cap-treffere skal telles som capped");
});

test("accumulateDaily: idempotent (ingen rader returnert andre gang samme dag)", async () => {
  const { pool } = makePoolMock({
    responses: [
      { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>, // UPDATE
      { rows: [{ cnt: "5" }], rowCount: 1 } as unknown as QueryResult<Record<string, unknown>>, // SELECT
    ],
  });
  const svc = new Game1JackpotStateService({ pool, todayKey: () => "2026-04-24" });
  const result = await svc.accumulateDaily();
  assert.equal(result.updatedCount, 0);
  assert.equal(result.cappedCount, 0);
  assert.equal(result.alreadyCurrentCount, 5, "alle 5 grupper var allerede oppdatert");
});

test("accumulateDaily: 30k-cap — LEAST-klausul i SQL returnerer new = cap når prev+increment > cap", async () => {
  // Simulerer: prev=2_800_000, increment=400_000 → LEAST(3_200_000, 3_000_000) = 3_000_000.
  const { pool } = makePoolMock({
    responses: [
      {
        rows: [
          {
            hall_group_id: "g-near-cap",
            current_amount_cents: "3000000", // toppet ut på cap
            prev_amount_cents: "2800000",
            max_cap_cents: "3000000",
          },
        ],
        rowCount: 1,
      } as unknown as QueryResult<Record<string, unknown>>,
      { rows: [{ cnt: "1" }], rowCount: 1 } as unknown as QueryResult<Record<string, unknown>>,
    ],
  });
  const svc = new Game1JackpotStateService({ pool, todayKey: () => "2026-04-24" });
  const result = await svc.accumulateDaily();
  // prev < cap → updated. curr == cap → logs "reached_cap" men stadig updated.
  assert.equal(result.updatedCount, 1);
  assert.equal(result.cappedCount, 0);
});

// ─── resetToStart ─────────────────────────────────────────────────────────

test("resetToStart: setter current tilbake til seed + oppdaterer date", async () => {
  const { pool, calls } = makePoolMock({
    responses: [
      // UPDATE
      { rows: [], rowCount: 1 } as unknown as QueryResult<Record<string, unknown>>,
      // SELECT (via getStateForGroup)
      {
        rows: [
          {
            hall_group_id: "g",
            current_amount_cents: JACKPOT_DEFAULT_START_CENTS,
            last_accumulation_date: "2026-04-24",
            max_cap_cents: 3_000_000,
            daily_increment_cents: 400_000,
            draw_thresholds_json: [50, 55, 56, 57],
            updated_at: new Date(),
          },
        ],
        rowCount: 1,
      } as unknown as QueryResult<Record<string, unknown>>,
    ],
  });
  const svc = new Game1JackpotStateService({ pool, todayKey: () => "2026-04-24" });
  const state = await svc.resetToStart("g", "won-by-yellow-at-draw-50");
  assert.equal(state.currentAmountCents, JACKPOT_DEFAULT_START_CENTS);
  assert.match(calls[0]!.text, /UPDATE/);
  assert.match(calls[0]!.text, /current_amount_cents\s*=\s*\$2/);
  assert.deepEqual(
    calls[0]!.params,
    ["g", JACKPOT_DEFAULT_START_CENTS, "2026-04-24"]
  );
});
