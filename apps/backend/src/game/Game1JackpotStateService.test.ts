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
import type { Pool, PoolClient, QueryResult } from "pg";
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

// ─── awardJackpot ─────────────────────────────────────────────────────────
// Transaksjonell debit-and-reset med idempotency-guard. Bruker pool.connect()
// + BEGIN/COMMIT/ROLLBACK, så testene må mocke en client.

interface PoolWithClientMock {
  pool: Pool;
  /** Queries kjørt mot client (i.e. inni transaksjonen). */
  clientCalls: QueryCall[];
  /** Queries kjørt mot pool direkte (ikke transaksjon). */
  poolCalls: QueryCall[];
  /** Antall ganger pool.connect() ble kalt. */
  connectCount: number;
  /** Antall ganger client.release() ble kalt. */
  releaseCount: number;
}

interface ClientResponseStream {
  /** Liste av query-respons-handlers. Indeks = kall-rekkefølge. */
  responses: Array<QueryResult<Record<string, unknown>> | Error | undefined>;
}

function makePoolWithClientMock(streams: {
  clientStream: ClientResponseStream;
  poolStream?: ClientResponseStream;
}): PoolWithClientMock {
  const clientCalls: QueryCall[] = [];
  const poolCalls: QueryCall[] = [];
  let clientIdx = 0;
  let poolIdx = 0;
  let connectCount = 0;
  let releaseCount = 0;

  const clientMock = {
    query: async (text: string, params: unknown[] = []): Promise<QueryResult<Record<string, unknown>>> => {
      clientCalls.push({ text, params });
      const response = streams.clientStream.responses[clientIdx];
      clientIdx += 1;
      if (response instanceof Error) throw response;
      return response ?? ({ rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>);
    },
    release: () => { releaseCount += 1; },
  } as unknown as PoolClient;

  const pool = {
    connect: async (): Promise<PoolClient> => {
      connectCount += 1;
      return clientMock;
    },
    query: async (text: string, params: unknown[] = []): Promise<QueryResult<Record<string, unknown>>> => {
      poolCalls.push({ text, params });
      const response = streams.poolStream?.responses[poolIdx];
      poolIdx += 1;
      if (response instanceof Error) throw response;
      return response ?? ({ rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>);
    },
  } as unknown as Pool;

  return {
    pool,
    clientCalls,
    poolCalls,
    get connectCount() { return connectCount; },
    get releaseCount() { return releaseCount; },
  } as PoolWithClientMock;
}

// Helper: bygg standard "happy-path"-respons-strøm for et award.
// Rekkefølge: BEGIN, idempotency-check (empty), ensureStateExists,
// SELECT FOR UPDATE, UPDATE, INSERT awards, COMMIT.
function happyPathResponses(currentAmountCents: number): Array<QueryResult<Record<string, unknown>> | undefined> {
  return [
    // BEGIN
    { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
    // idempotency-check (no existing)
    { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
    // ensureStateExists (ON CONFLICT DO NOTHING)
    { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
    // SELECT ... FOR UPDATE
    {
      rows: [{ current_amount_cents: currentAmountCents }],
      rowCount: 1,
    } as unknown as QueryResult<Record<string, unknown>>,
    // UPDATE state
    { rows: [], rowCount: 1 } as unknown as QueryResult<Record<string, unknown>>,
    // INSERT award (success → rowCount=1)
    {
      rows: [{ id: "g1ja-test-id" }],
      rowCount: 1,
    } as unknown as QueryResult<Record<string, unknown>>,
    // COMMIT
    { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
  ];
}

test("awardJackpot: happy path — debiterer pott, resetter til seed, skriver award-rad", async () => {
  const mock = makePoolWithClientMock({
    clientStream: {
      responses: happyPathResponses(2_500_000), // 25 000 kr i potten
    },
  });
  const svc = new Game1JackpotStateService({
    pool: mock.pool,
    todayKey: () => "2026-04-24",
  });
  const result = await svc.awardJackpot({
    hallGroupId: "group-A",
    idempotencyKey: "g1-jackpot-game-123-50",
    reason: "FULL_HOUSE_WITHIN_THRESHOLD",
    scheduledGameId: "game-123",
    drawSequenceAtWin: 50,
  });

  assert.equal(result.awardedAmountCents, 2_500_000, "skal dele ut hele saldoen før reset");
  assert.equal(result.previousAmountCents, 2_500_000);
  assert.equal(result.newAmountCents, JACKPOT_DEFAULT_START_CENTS);
  assert.equal(result.idempotent, false);
  assert.equal(result.noopZeroBalance, false);
  assert.equal(result.hallGroupId, "group-A");
  assert.match(result.awardId, /^g1ja-/);

  // Verifiser SQL-flyt
  assert.match(mock.clientCalls[0]!.text, /^BEGIN/);
  assert.match(mock.clientCalls[1]!.text, /SELECT[\s\S]*idempotency_key/i);
  assert.match(mock.clientCalls[2]!.text, /INSERT INTO[\s\S]*ON CONFLICT/i);
  assert.match(mock.clientCalls[3]!.text, /SELECT current_amount_cents[\s\S]*FOR UPDATE/i);
  assert.match(mock.clientCalls[4]!.text, /UPDATE[\s\S]*current_amount_cents/i);
  assert.match(mock.clientCalls[5]!.text, /INSERT INTO[\s\S]*app_game1_jackpot_awards/i);
  assert.match(mock.clientCalls[6]!.text, /^COMMIT/);

  // UPDATE skal sette current = seed
  assert.deepEqual(
    mock.clientCalls[4]!.params,
    ["group-A", JACKPOT_DEFAULT_START_CENTS, "2026-04-24"]
  );

  // Connect/release-balansering
  assert.equal(mock.connectCount, 1);
  assert.equal(mock.releaseCount, 1);
});

test("awardJackpot: idempotency — eksisterende key returnerer samme award uten å touche state", async () => {
  const mock = makePoolWithClientMock({
    clientStream: {
      responses: [
        // BEGIN
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
        // idempotency-check FANGER eksisterende rad
        {
          rows: [{
            id: "g1ja-existing",
            awarded_amount_cents: "1500000",
            previous_amount_cents: "1500000",
            new_amount_cents: "200000",
          }],
          rowCount: 1,
        } as unknown as QueryResult<Record<string, unknown>>,
        // COMMIT
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
      ],
    },
  });
  const svc = new Game1JackpotStateService({
    pool: mock.pool,
    todayKey: () => "2026-04-24",
  });
  const result = await svc.awardJackpot({
    hallGroupId: "group-A",
    idempotencyKey: "g1-jackpot-game-123-50",
    reason: "FULL_HOUSE_WITHIN_THRESHOLD",
  });

  assert.equal(result.idempotent, true, "andre kall skal markeres idempotent");
  assert.equal(result.awardId, "g1ja-existing");
  assert.equal(result.awardedAmountCents, 1_500_000);
  assert.equal(result.previousAmountCents, 1_500_000);
  assert.equal(result.newAmountCents, 200_000);
  assert.equal(result.noopZeroBalance, false);

  // INGEN UPDATE skal skje — kun BEGIN, SELECT, COMMIT
  assert.equal(mock.clientCalls.length, 3);
  assert.match(mock.clientCalls[0]!.text, /^BEGIN/);
  assert.match(mock.clientCalls[1]!.text, /SELECT[\s\S]*idempotency_key/i);
  assert.match(mock.clientCalls[2]!.text, /^COMMIT/);
  assert.equal(mock.releaseCount, 1);
});

test("awardJackpot: noopZeroBalance — current=0 gir no-op uten audit-rad", async () => {
  const mock = makePoolWithClientMock({
    clientStream: {
      responses: [
        // BEGIN
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
        // idempotency-check (empty)
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
        // ensureStateExists
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
        // SELECT FOR UPDATE — current=0
        {
          rows: [{ current_amount_cents: 0 }],
          rowCount: 1,
        } as unknown as QueryResult<Record<string, unknown>>,
        // COMMIT (no-op kommitter umiddelbart)
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
      ],
    },
  });
  const svc = new Game1JackpotStateService({
    pool: mock.pool,
    todayKey: () => "2026-04-24",
  });
  const result = await svc.awardJackpot({
    hallGroupId: "group-empty",
    idempotencyKey: "g1-jackpot-empty-1",
    reason: "ADMIN_MANUAL_AWARD",
  });

  assert.equal(result.noopZeroBalance, true);
  assert.equal(result.awardedAmountCents, 0);
  assert.equal(result.previousAmountCents, 0);
  assert.equal(result.newAmountCents, 0);
  assert.equal(result.awardId, "");
  // Ingen UPDATE eller INSERT skal finnes
  const sqlText = mock.clientCalls.map((c) => c.text).join(" | ");
  assert.doesNotMatch(sqlText, /INSERT INTO[\s\S]*app_game1_jackpot_awards/i);
  assert.doesNotMatch(sqlText, /UPDATE[\s\S]*current_amount_cents/i);
});

test("awardJackpot: feil under transaksjon → ROLLBACK + propagerer feilen", async () => {
  const mock = makePoolWithClientMock({
    clientStream: {
      responses: [
        // BEGIN
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
        // idempotency-check feiler
        new Error("simulated db failure"),
        // ROLLBACK (forventet i finally)
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
      ],
    },
  });
  const svc = new Game1JackpotStateService({
    pool: mock.pool,
    todayKey: () => "2026-04-24",
  });
  await assert.rejects(
    () => svc.awardJackpot({
      hallGroupId: "group-A",
      idempotencyKey: "g1-jackpot-fail-1",
      reason: "FULL_HOUSE_WITHIN_THRESHOLD",
    }),
    /simulated db failure/
  );
  // ROLLBACK skal være kalt — siste client-call er ROLLBACK
  const lastCall = mock.clientCalls[mock.clientCalls.length - 1]!;
  assert.match(lastCall.text, /^ROLLBACK/);
  // Client skal være released selv ved feil
  assert.equal(mock.releaseCount, 1);
});

test("awardJackpot: cap-edge-case — full pott (cap=30k) gir alle 30k til vinner", async () => {
  const mock = makePoolWithClientMock({
    clientStream: {
      responses: happyPathResponses(JACKPOT_DEFAULT_MAX_CAP_CENTS), // 30 000 kr
    },
  });
  const svc = new Game1JackpotStateService({
    pool: mock.pool,
    todayKey: () => "2026-04-24",
  });
  const result = await svc.awardJackpot({
    hallGroupId: "group-cap",
    idempotencyKey: "g1-jackpot-cap-1",
    reason: "FULL_HOUSE_WITHIN_THRESHOLD",
    scheduledGameId: "game-cap",
    drawSequenceAtWin: 50,
  });
  assert.equal(result.awardedAmountCents, JACKPOT_DEFAULT_MAX_CAP_CENTS);
  assert.equal(result.previousAmountCents, JACKPOT_DEFAULT_MAX_CAP_CENTS);
  assert.equal(result.newAmountCents, JACKPOT_DEFAULT_START_CENTS, "alltid reset til seed etter award");
});

test("awardJackpot: race-tap — INSERT mister konflikt, fallback returnerer eksisterende", async () => {
  const mock = makePoolWithClientMock({
    clientStream: {
      responses: [
        // BEGIN
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
        // idempotency-check (empty)
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
        // ensureStateExists
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
        // SELECT FOR UPDATE — current=1 000 000
        {
          rows: [{ current_amount_cents: 1_000_000 }],
          rowCount: 1,
        } as unknown as QueryResult<Record<string, unknown>>,
        // UPDATE
        { rows: [], rowCount: 1 } as unknown as QueryResult<Record<string, unknown>>,
        // INSERT — konflikt (ON CONFLICT DO NOTHING → rowCount=0)
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
        // ROLLBACK
        { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
      ],
    },
    poolStream: {
      // fetchExistingAwardForKey kjøres mot pool (ikke client) etter rollback
      responses: [
        {
          rows: [{
            id: "g1ja-existing-from-race",
            awarded_amount_cents: "999000",
            previous_amount_cents: "999000",
            new_amount_cents: "200000",
          }],
          rowCount: 1,
        } as unknown as QueryResult<Record<string, unknown>>,
      ],
    },
  });
  const svc = new Game1JackpotStateService({
    pool: mock.pool,
    todayKey: () => "2026-04-24",
  });
  const result = await svc.awardJackpot({
    hallGroupId: "group-race",
    idempotencyKey: "g1-jackpot-race-1",
    reason: "FULL_HOUSE_WITHIN_THRESHOLD",
  });
  assert.equal(result.idempotent, true);
  assert.equal(result.awardId, "g1ja-existing-from-race");
  assert.equal(result.awardedAmountCents, 999_000);
});

test("awardJackpot: validerer påkrevde felter", async () => {
  const mock = makePoolWithClientMock({
    clientStream: { responses: [] },
  });
  const svc = new Game1JackpotStateService({
    pool: mock.pool,
    todayKey: () => "2026-04-24",
  });

  await assert.rejects(
    () => svc.awardJackpot({
      hallGroupId: "",
      idempotencyKey: "k",
      reason: "ADMIN_MANUAL_AWARD",
    }),
    /hallGroupId er påkrevd/
  );
  await assert.rejects(
    () => svc.awardJackpot({
      hallGroupId: "g",
      idempotencyKey: "",
      reason: "ADMIN_MANUAL_AWARD",
    }),
    /idempotencyKey er påkrevd/
  );
  // Ingen connect skal skje — vi failer før transaksjon starter
  assert.equal(mock.connectCount, 0);
});

// ─── listAwards ───────────────────────────────────────────────────────────

test("listAwards: returnerer formatterte rader sortert via SQL ORDER BY", async () => {
  const { pool, calls } = makePoolMock({
    responses: [
      {
        rows: [
          {
            id: "g1ja-1",
            hall_group_id: "g",
            awarded_amount_cents: "2500000",
            previous_amount_cents: "2500000",
            new_amount_cents: "200000",
            scheduled_game_id: "game-1",
            draw_sequence_at_win: 50,
            reason: "FULL_HOUSE_WITHIN_THRESHOLD",
            awarded_by_user_id: null,
            awarded_at: new Date("2026-04-25T10:00:00Z"),
          },
        ],
        rowCount: 1,
      } as unknown as QueryResult<Record<string, unknown>>,
    ],
  });
  const svc = new Game1JackpotStateService({ pool });
  const awards = await svc.listAwards("g", 25);
  assert.equal(awards.length, 1);
  assert.equal(awards[0]!.awardId, "g1ja-1");
  assert.equal(awards[0]!.awardedAmountCents, 2_500_000);
  assert.equal(awards[0]!.scheduledGameId, "game-1");
  assert.equal(awards[0]!.drawSequenceAtWin, 50);
  assert.equal(awards[0]!.reason, "FULL_HOUSE_WITHIN_THRESHOLD");
  // SQL har ORDER BY DESC og LIMIT
  assert.match(calls[0]!.text, /ORDER BY awarded_at DESC/i);
  assert.match(calls[0]!.text, /LIMIT \$2/i);
  assert.deepEqual(calls[0]!.params, ["g", 25]);
});

test("listAwards: clamper limit til [1, 500]", async () => {
  const { pool, calls } = makePoolMock({
    responses: [
      { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
      { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>,
    ],
  });
  const svc = new Game1JackpotStateService({ pool });
  await svc.listAwards("g", -10);
  assert.equal(calls[0]!.params[1], 1, "negativ limit clampes til 1");
  await svc.listAwards("g", 9999);
  assert.equal(calls[1]!.params[1], 500, "stor limit clampes til 500");
});
