/**
 * PR-T1 Spor 4: Tester for Game1PotService.
 *
 * Dekker:
 *   - Pure helpers: validatePotConfig (happy + alle invariants),
 *     computeCappedAdd (uten cap, med cap, full pot), isTicketColorAllowed
 *     (tom liste = alle, case-insensitiv).
 *   - Service-API via stub-pool:
 *       getOrInitPot (create + idempotent retry)
 *       accumulateDaily (happy, idempotent per-dato, boost=0, cap-klipp)
 *       accumulateFromSale (bps=0 skip, bps=500=5%, cap-klipp, nulltotal)
 *       tryWin (fase mismatch, draw over threshold, color mismatch, pot empty,
 *               happy-sti → reset + event + delta-negativ)
 *       resetPot (writer reset-event + skriver seed)
 *       updateConfig (config-event med delta=0, saldo urørt)
 *       listPotsForHall
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1PotService,
  validatePotConfig,
  computeCappedAdd,
  isTicketColorAllowed,
  type PotConfig,
} from "./Game1PotService.js";
import { DomainError } from "../BingoEngine.js";

// ── Stub pool ───────────────────────────────────────────────────────────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[] | (() => unknown[]);
  rowCount?: number;
  /** Hvis true, consumes ikke responsen når den matcher (kan gjenbrukes). */
  persistent?: boolean;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: {
    connect: () => Promise<{
      query: (
        sql: string,
        params?: unknown[]
      ) => Promise<{ rows: unknown[]; rowCount: number }>;
      release: () => void;
    }>;
    query: (
      sql: string,
      params?: unknown[]
    ) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queue = responses.slice();
  const queries: RecordedQuery[] = [];
  const runQuery = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i]!;
      if (r.match(sql)) {
        const rows = typeof r.rows === "function" ? r.rows() : r.rows;
        if (!r.persistent) queue.splice(i, 1);
        return { rows, rowCount: r.rowCount ?? rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return {
    pool: {
      connect: async () => ({ query: runQuery, release: () => undefined }),
      query: runQuery,
    },
    queries,
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function validConfig(overrides: Partial<PotConfig> = {}): PotConfig {
  return {
    seedAmountCents: 100_00,
    dailyBoostCents: 50_00,
    salePercentBps: 500, // 5%
    maxAmountCents: 10_000_00,
    winRule: {
      kind: "phase_at_or_before_draw",
      phase: 5,
      drawThreshold: 50,
    },
    ticketColors: [],
    ...overrides,
  };
}

function potDbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pot-1",
    hall_id: "hall-a",
    pot_key: "jackpott",
    display_name: "Jackpott",
    current_amount_cents: 100_00,
    config_json: validConfig(),
    last_daily_boost_date: null,
    last_reset_at: null,
    last_reset_reason: null,
    created_at: "2026-04-22T10:00:00Z",
    updated_at: "2026-04-22T10:00:00Z",
    ...overrides,
  };
}

// ── Pure helpers: validatePotConfig ─────────────────────────────────────────

test("validatePotConfig: gyldig config passerer", () => {
  validatePotConfig(validConfig());
});

test("validatePotConfig: negativ seed → INVALID_CONFIG", () => {
  assert.throws(
    () => validatePotConfig(validConfig({ seedAmountCents: -1 })),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

test("validatePotConfig: negativ dailyBoost → INVALID_CONFIG", () => {
  assert.throws(
    () => validatePotConfig(validConfig({ dailyBoostCents: -100 })),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

test("validatePotConfig: salePercentBps utenfor 0..10000 → INVALID_CONFIG", () => {
  assert.throws(() => validatePotConfig(validConfig({ salePercentBps: -1 })), DomainError);
  assert.throws(
    () => validatePotConfig(validConfig({ salePercentBps: 10001 })),
    DomainError
  );
});

test("validatePotConfig: maxAmountCents < seedAmountCents → INVALID_CONFIG", () => {
  assert.throws(
    () =>
      validatePotConfig(
        validConfig({ seedAmountCents: 500_00, maxAmountCents: 100_00 })
      ),
    DomainError
  );
});

test("validatePotConfig: maxAmountCents=null er tillatt", () => {
  validatePotConfig(validConfig({ maxAmountCents: null }));
});

test("validatePotConfig: winRule.kind ukjent → INVALID_CONFIG", () => {
  const bad = validConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bad.winRule as any).kind = "unknown";
  assert.throws(() => validatePotConfig(bad), DomainError);
});

test("validatePotConfig: phase utenfor 1..5 → INVALID_CONFIG", () => {
  const bad = validConfig();
  bad.winRule.phase = 6;
  assert.throws(() => validatePotConfig(bad), DomainError);
  bad.winRule.phase = 0;
  assert.throws(() => validatePotConfig(bad), DomainError);
});

test("validatePotConfig: drawThreshold utenfor 1..75 → INVALID_CONFIG", () => {
  const bad = validConfig();
  bad.winRule.drawThreshold = 0;
  assert.throws(() => validatePotConfig(bad), DomainError);
  bad.winRule.drawThreshold = 76;
  assert.throws(() => validatePotConfig(bad), DomainError);
});

test("validatePotConfig: ticketColors med ikke-streng → INVALID_CONFIG", () => {
  const bad = validConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bad.ticketColors as any) = [123];
  assert.throws(() => validatePotConfig(bad), DomainError);
});

// ── Pure helpers: computeCappedAdd ──────────────────────────────────────────

test("computeCappedAdd: ingen cap → hele delta appliseres", () => {
  const r = computeCappedAdd(100, 50, null);
  assert.equal(r.appliedCents, 50);
  assert.equal(r.newBalance, 150);
});

test("computeCappedAdd: innen cap → hele delta appliseres", () => {
  const r = computeCappedAdd(100, 50, 1000);
  assert.equal(r.appliedCents, 50);
  assert.equal(r.newBalance, 150);
});

test("computeCappedAdd: delta klippes til cap", () => {
  const r = computeCappedAdd(900, 500, 1000);
  assert.equal(r.appliedCents, 100);
  assert.equal(r.newBalance, 1000);
});

test("computeCappedAdd: current allerede på cap → 0 applisert", () => {
  const r = computeCappedAdd(1000, 500, 1000);
  assert.equal(r.appliedCents, 0);
  assert.equal(r.newBalance, 1000);
});

test("computeCappedAdd: delta<=0 → no-op", () => {
  assert.deepEqual(computeCappedAdd(500, 0, null), {
    appliedCents: 0,
    newBalance: 500,
  });
  assert.deepEqual(computeCappedAdd(500, -10, null), {
    appliedCents: 0,
    newBalance: 500,
  });
});

// ── Pure helpers: isTicketColorAllowed ──────────────────────────────────────

test("isTicketColorAllowed: tom liste = alle tillatt", () => {
  assert.equal(isTicketColorAllowed("small_yellow", []), true);
  assert.equal(isTicketColorAllowed("red", []), true);
});

test("isTicketColorAllowed: case-insensitiv match", () => {
  assert.equal(isTicketColorAllowed("Small_Yellow", ["small_yellow"]), true);
  assert.equal(isTicketColorAllowed("small_yellow", ["SMALL_YELLOW"]), true);
});

test("isTicketColorAllowed: farge utenfor liste → false", () => {
  assert.equal(isTicketColorAllowed("red", ["small_yellow", "large_white"]), false);
});

// ── Service: getOrInitPot ───────────────────────────────────────────────────

test("getOrInitPot: oppretter ny pot + skriver init-event", async () => {
  // Første SELECT FOR UPDATE → ingen rader (pot ikke funnet).
  // INSERT-er returnerer tomme rader.
  // Re-load etter commit returnerer den nye pot-en.
  const initialConfig = validConfig();
  let inserted = false;
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    {
      match: (sql) => /FOR UPDATE/i.test(sql),
      rows: () => (inserted ? [] : []),
      persistent: true,
    },
    {
      match: (sql) => /INSERT INTO[\s\S]*?"app_game1_accumulating_pots"/i.test(sql),
      rows: () => {
        inserted = true;
        return [];
      },
      persistent: true,
    },
    {
      match: (sql) => /INSERT INTO[\s\S]*?"app_game1_pot_events"/i.test(sql),
      rows: [],
      persistent: true,
    },
    {
      match: (sql) => /SELECT \*[\s\S]+app_game1_accumulating_pots/i.test(sql),
      // etter commit — les non-FOR-UPDATE
      rows: () => (inserted ? [potDbRow({ config_json: initialConfig })] : []),
      persistent: true,
    },
  ]);

  const svc = new Game1PotService({ pool: pool as never });
  const pot = await svc.getOrInitPot({
    hallId: "hall-a",
    potKey: "jackpott",
    displayName: "Jackpott",
    config: initialConfig,
  });

  assert.equal(pot.potKey, "jackpott");
  assert.equal(pot.currentAmountCents, 100_00);
  // Både pot-INSERT og event-INSERT skal ha skjedd.
  const insertSqls = queries.filter((q) => /INSERT INTO/i.test(q.sql)).map((q) => q.sql);
  assert.ok(
    insertSqls.some((s) => /app_game1_accumulating_pots/.test(s)),
    "pot-rad skal være inserted"
  );
  assert.ok(
    insertSqls.some((s) => /app_game1_pot_events/.test(s)),
    "init-event skal være inserted"
  );
});

test("getOrInitPot: eksisterende pot → returnerer eksisterende uten re-insert", async () => {
  const existing = potDbRow({ current_amount_cents: 500_00 });
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    {
      match: (sql) => /FOR UPDATE/i.test(sql),
      rows: [existing],
      persistent: true,
    },
    {
      match: (sql) => /SELECT \*[\s\S]+app_game1_accumulating_pots/i.test(sql),
      rows: [existing],
      persistent: true,
    },
  ]);

  const svc = new Game1PotService({ pool: pool as never });
  const pot = await svc.getOrInitPot({
    hallId: "hall-a",
    potKey: "jackpott",
    displayName: "Jackpott",
    config: validConfig(),
  });

  assert.equal(pot.currentAmountCents, 500_00);
  const insertSqls = queries.filter((q) => /INSERT INTO/i.test(q.sql));
  assert.equal(insertSqls.length, 0, "ingen INSERT ved eksisterende pot");
});

// ── Service: accumulateDaily ────────────────────────────────────────────────

test("accumulateDaily: happy-sti → boost applisert + event skrevet", async () => {
  const row = potDbRow({ current_amount_cents: 100_00 });
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
    {
      match: (sql) => /UPDATE[\s\S]*?"app_game1_accumulating_pots"/i.test(sql),
      rows: [],
      persistent: true,
    },
    {
      match: (sql) => /INSERT INTO[\s\S]*?"app_game1_pot_events"/i.test(sql),
      rows: [],
      persistent: true,
    },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.accumulateDaily({
    hallId: "hall-a",
    potKey: "jackpott",
    dateUtc: "2026-04-22",
  });
  assert.equal(r.applied, true);
  assert.equal(r.boostCents, 50_00);
  assert.equal(r.newBalanceCents, 150_00);
  assert.ok(r.eventId);
  assert.ok(queries.some((q) => /app_game1_pot_events/.test(q.sql)));
});

test("accumulateDaily: samme dato to ganger → andre kall er idempotent (applied=false)", async () => {
  const row = potDbRow({
    current_amount_cents: 150_00,
    last_daily_boost_date: "2026-04-22",
  });
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.accumulateDaily({
    hallId: "hall-a",
    potKey: "jackpott",
    dateUtc: "2026-04-22",
  });
  assert.equal(r.applied, false);
  assert.equal(r.boostCents, 0);
  assert.equal(
    queries.filter((q) => /INSERT INTO[\s\S]*?"app_game1_pot_events"/i.test(q.sql)).length,
    0,
    "ingen event ved idempotent-hit"
  );
});

test("accumulateDaily: boost=0 → applied=false, men last_daily_boost_date settes", async () => {
  const row = potDbRow({
    current_amount_cents: 100_00,
    config_json: validConfig({ dailyBoostCents: 0 }),
  });
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
    {
      match: (sql) => /UPDATE[\s\S]*?"app_game1_accumulating_pots"/i.test(sql),
      rows: [],
      persistent: true,
    },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.accumulateDaily({
    hallId: "hall-a",
    potKey: "jackpott",
    dateUtc: "2026-04-22",
  });
  assert.equal(r.applied, false);
  assert.equal(r.boostCents, 0);
  // UPDATE skal ha skjedd for å sette last_daily_boost_date, men ingen event.
  assert.ok(queries.some((q) => /UPDATE[\s\S]*?accumulating_pots/i.test(q.sql)));
  assert.equal(
    queries.filter((q) => /INSERT INTO[\s\S]*?"app_game1_pot_events"/i.test(q.sql)).length,
    0
  );
});

test("accumulateDaily: klipper boost ved cap", async () => {
  const row = potDbRow({
    current_amount_cents: 980_00,
    config_json: validConfig({ dailyBoostCents: 50_00, maxAmountCents: 1000_00 }),
  });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
    {
      match: (sql) => /UPDATE[\s\S]*?accumulating_pots/i.test(sql),
      rows: [],
      persistent: true,
    },
    {
      match: (sql) => /INSERT INTO[\s\S]*?pot_events/i.test(sql),
      rows: [],
      persistent: true,
    },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.accumulateDaily({
    hallId: "hall-a",
    potKey: "jackpott",
    dateUtc: "2026-04-22",
  });
  assert.equal(r.applied, true);
  assert.equal(r.boostCents, 20_00, "kun 20 kr plass igjen før cap");
  assert.equal(r.newBalanceCents, 1000_00);
});

test("accumulateDaily: pot ikke funnet → POT_NOT_FOUND", async () => {
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^ROLLBACK/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  await assert.rejects(
    () =>
      svc.accumulateDaily({ hallId: "hall-a", potKey: "nope", dateUtc: "2026-04-22" }),
    (err: unknown) => err instanceof DomainError && err.code === "POT_NOT_FOUND"
  );
});

test("accumulateDaily: ugyldig dato-format → INVALID_DATE", async () => {
  const { pool } = createStubPool([]);
  const svc = new Game1PotService({ pool: pool as never });
  await assert.rejects(
    () =>
      svc.accumulateDaily({
        hallId: "hall-a",
        potKey: "jackpott",
        dateUtc: "22-04-2026",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_DATE"
  );
});

// ── Service: accumulateFromSale ─────────────────────────────────────────────

test("accumulateFromSale: 5% av 200 kr = 10 kr akkumulert", async () => {
  const row = potDbRow({
    current_amount_cents: 100_00,
    config_json: validConfig({ salePercentBps: 500 }),
  });
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
    { match: (sql) => /UPDATE[\s\S]*?accumulating_pots/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /INSERT INTO[\s\S]*?pot_events/i.test(sql), rows: [], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.accumulateFromSale({
    hallId: "hall-a",
    potKey: "jackpott",
    ticketTotalCents: 200_00, // 200 kr
  });
  assert.equal(r.appliedCents, 10_00, "5% av 20000 øre = 1000 øre");
  assert.equal(r.newBalanceCents, 110_00);
  assert.ok(r.eventId);
  assert.ok(
    queries.some((q) => /INSERT INTO[\s\S]*?pot_events/i.test(q.sql)),
    "sale-event skrevet"
  );
});

test("accumulateFromSale: salePercentBps=0 → skip uten event", async () => {
  const row = potDbRow({
    config_json: validConfig({ salePercentBps: 0 }),
  });
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.accumulateFromSale({
    hallId: "hall-a",
    potKey: "jackpott",
    ticketTotalCents: 200_00,
  });
  assert.equal(r.appliedCents, 0);
  assert.equal(
    queries.filter((q) => /INSERT INTO[\s\S]*?pot_events/i.test(q.sql)).length,
    0
  );
});

test("accumulateFromSale: ticketTotalCents=0 → skip", async () => {
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [potDbRow()], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.accumulateFromSale({
    hallId: "hall-a",
    potKey: "jackpott",
    ticketTotalCents: 0,
  });
  assert.equal(r.appliedCents, 0);
  assert.equal(
    queries.filter((q) => /INSERT INTO[\s\S]*?pot_events/i.test(q.sql)).length,
    0
  );
});

test("accumulateFromSale: cap-klipp", async () => {
  const row = potDbRow({
    current_amount_cents: 995_00,
    config_json: validConfig({ salePercentBps: 500, maxAmountCents: 1000_00 }),
  });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
    { match: (sql) => /UPDATE[\s\S]*?accumulating_pots/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /INSERT INTO[\s\S]*?pot_events/i.test(sql), rows: [], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.accumulateFromSale({
    hallId: "hall-a",
    potKey: "jackpott",
    ticketTotalCents: 200_00, // 5% = 10 kr, men kun 5 kr plass
  });
  assert.equal(r.appliedCents, 5_00);
  assert.equal(r.newBalanceCents, 1000_00);
});

test("accumulateFromSale: negativ ticketTotalCents → INVALID_AMOUNT", async () => {
  const { pool } = createStubPool([]);
  const svc = new Game1PotService({ pool: pool as never });
  await assert.rejects(
    () =>
      svc.accumulateFromSale({
        hallId: "hall-a",
        potKey: "jackpott",
        ticketTotalCents: -100,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_AMOUNT"
  );
});

// ── Service: tryWin ─────────────────────────────────────────────────────────

test("tryWin: happy-sti → pot utløses, saldo resettes til seed, event har negativ delta", async () => {
  const row = potDbRow({ current_amount_cents: 500_00 });
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
    { match: (sql) => /UPDATE[\s\S]*?accumulating_pots/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /INSERT INTO[\s\S]*?pot_events/i.test(sql), rows: [], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin({
    hallId: "hall-a",
    potKey: "jackpott",
    phase: 5,
    drawSequenceAtWin: 42,
    ticketColor: "small_yellow",
    winnerUserId: "user-1",
    scheduledGameId: "sg-1",
  });

  assert.equal(r.triggered, true);
  assert.equal(r.amountCents, 500_00, "utbetaling = pot-saldo før reset");
  assert.equal(r.reasonCode, null);
  assert.ok(r.eventId);

  // Event-INSERT skal ha delta_cents = seed - payout = 100_00 - 500_00 = -400_00.
  const eventInsert = queries.find((q) =>
    /INSERT INTO[\s\S]*?pot_events/i.test(q.sql)
  );
  assert.ok(eventInsert, "event-insert fant sted");
  // Params: [id, potId, hallId, kind, delta, balanceAfter, ...]
  assert.equal(eventInsert!.params[3], "win", "event_kind = 'win'");
  assert.equal(eventInsert!.params[4], -400_00, "delta_cents negativ");
  assert.equal(eventInsert!.params[5], 100_00, "balance_after = seed");
});

test("tryWin: feil fase → WRONG_PHASE, pot urørt", async () => {
  const row = potDbRow({ current_amount_cents: 500_00 });
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin({
    hallId: "hall-a",
    potKey: "jackpott",
    phase: 3,
    drawSequenceAtWin: 30,
    ticketColor: "small_yellow",
    winnerUserId: "user-1",
    scheduledGameId: "sg-1",
  });
  assert.equal(r.triggered, false);
  assert.equal(r.reasonCode, "WRONG_PHASE");
  assert.equal(
    queries.filter((q) => /UPDATE[\s\S]*?accumulating_pots/i.test(q.sql)).length,
    0
  );
});

test("tryWin: draw etter threshold → DRAW_AFTER_THRESHOLD", async () => {
  const row = potDbRow({
    config_json: validConfig({
      winRule: { kind: "phase_at_or_before_draw", phase: 5, drawThreshold: 50 },
    }),
  });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin({
    hallId: "hall-a",
    potKey: "jackpott",
    phase: 5,
    drawSequenceAtWin: 51,
    ticketColor: "small_yellow",
    winnerUserId: "user-1",
    scheduledGameId: "sg-1",
  });
  assert.equal(r.triggered, false);
  assert.equal(r.reasonCode, "DRAW_AFTER_THRESHOLD");
});

test("tryWin: draw = threshold → OK (inklusiv)", async () => {
  const row = potDbRow({ current_amount_cents: 500_00 });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
    { match: (sql) => /UPDATE[\s\S]*?accumulating_pots/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /INSERT INTO[\s\S]*?pot_events/i.test(sql), rows: [], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin({
    hallId: "hall-a",
    potKey: "jackpott",
    phase: 5,
    drawSequenceAtWin: 50,
    ticketColor: "small_yellow",
    winnerUserId: "user-1",
    scheduledGameId: "sg-1",
  });
  assert.equal(r.triggered, true);
});

test("tryWin: color ikke i whitelist → COLOR_NOT_ALLOWED", async () => {
  const row = potDbRow({
    config_json: validConfig({ ticketColors: ["small_yellow", "large_yellow"] }),
  });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin({
    hallId: "hall-a",
    potKey: "jackpott",
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "red",
    winnerUserId: "user-1",
    scheduledGameId: "sg-1",
  });
  assert.equal(r.triggered, false);
  assert.equal(r.reasonCode, "COLOR_NOT_ALLOWED");
});

test("tryWin: pot tom (saldo=0) → POT_EMPTY", async () => {
  const row = potDbRow({ current_amount_cents: 0 });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin({
    hallId: "hall-a",
    potKey: "jackpott",
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "small_yellow",
    winnerUserId: "user-1",
    scheduledGameId: "sg-1",
  });
  assert.equal(r.triggered, false);
  assert.equal(r.reasonCode, "POT_EMPTY");
});

test("tryWin: pot ikke funnet → reasonCode=POT_NOT_FOUND, triggered=false", async () => {
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^ROLLBACK/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin({
    hallId: "hall-a",
    potKey: "nope",
    phase: 5,
    drawSequenceAtWin: 30,
    ticketColor: "small_yellow",
    winnerUserId: "user-1",
    scheduledGameId: "sg-1",
  });
  assert.equal(r.triggered, false);
  assert.equal(r.reasonCode, "POT_NOT_FOUND");
});

test("tryWin: ugyldig phase → INVALID_PHASE", async () => {
  const { pool } = createStubPool([]);
  const svc = new Game1PotService({ pool: pool as never });
  await assert.rejects(
    () =>
      svc.tryWin({
        hallId: "hall-a",
        potKey: "jackpott",
        phase: 0,
        drawSequenceAtWin: 30,
        ticketColor: "small_yellow",
        winnerUserId: "user-1",
        scheduledGameId: "sg-1",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_PHASE"
  );
});

// ── Service: resetPot ───────────────────────────────────────────────────────

test("resetPot: skriver reset-event, saldo settes til seed", async () => {
  const row = potDbRow({ current_amount_cents: 500_00 });
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
    { match: (sql) => /UPDATE[\s\S]*?accumulating_pots/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /INSERT INTO[\s\S]*?pot_events/i.test(sql), rows: [], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.resetPot({
    hallId: "hall-a",
    potKey: "jackpott",
    reason: "admin-override",
    actorUserId: "admin-1",
  });
  assert.equal(r.newBalanceCents, 100_00);
  const ev = queries.find((q) => /INSERT INTO[\s\S]*?pot_events/i.test(q.sql));
  assert.ok(ev);
  assert.equal(ev!.params[3], "reset");
  assert.equal(ev!.params[4], -400_00, "delta negativt");
  assert.equal(ev!.params[5], 100_00, "saldo etter = seed");
});

test("resetPot: tom reason → INVALID_REASON", async () => {
  const { pool } = createStubPool([]);
  const svc = new Game1PotService({ pool: pool as never });
  await assert.rejects(
    () => svc.resetPot({ hallId: "hall-a", potKey: "jackpott", reason: "" }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_REASON"
  );
});

// ── Service: updateConfig ───────────────────────────────────────────────────

test("updateConfig: oppdaterer config + skriver config-event m/ delta=0", async () => {
  const row = potDbRow({ current_amount_cents: 300_00 });
  const newCfg = validConfig({ dailyBoostCents: 100_00 });
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
    { match: (sql) => /UPDATE[\s\S]*?accumulating_pots/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /INSERT INTO[\s\S]*?pot_events/i.test(sql), rows: [], persistent: true },
    {
      match: (sql) => /SELECT \*[\s\S]+app_game1_accumulating_pots/i.test(sql),
      rows: [potDbRow({ config_json: newCfg, current_amount_cents: 300_00 })],
      persistent: true,
    },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.updateConfig({
    hallId: "hall-a",
    potKey: "jackpott",
    config: newCfg,
  });
  assert.equal(r.config.dailyBoostCents, 100_00);
  assert.equal(r.currentAmountCents, 300_00, "saldo urørt");
  const ev = queries.find((q) => /INSERT INTO[\s\S]*?pot_events/i.test(q.sql));
  assert.ok(ev);
  assert.equal(ev!.params[3], "config");
  assert.equal(ev!.params[4], 0, "delta 0 for config-event");
  assert.equal(ev!.params[5], 300_00);
});

test("updateConfig: ugyldig config → INVALID_CONFIG, ingen DB-kall", async () => {
  const { pool, queries } = createStubPool([]);
  const svc = new Game1PotService({ pool: pool as never });
  await assert.rejects(
    () =>
      svc.updateConfig({
        hallId: "hall-a",
        potKey: "jackpott",
        config: validConfig({ salePercentBps: 99999 }),
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
  assert.equal(queries.length, 0, "ingen DB-kall ved validerings-feil");
});

// ── Service: listPotsForHall ────────────────────────────────────────────────

test("listPotsForHall: returnerer hydrerte rader sortert på pot_key", async () => {
  const rows = [
    potDbRow({ id: "pot-1", pot_key: "innsatsen", display_name: "Innsatsen" }),
    potDbRow({ id: "pot-2", pot_key: "jackpott", display_name: "Jackpott" }),
  ];
  const { pool } = createStubPool([
    {
      match: (sql) => /SELECT \*[\s\S]+app_game1_accumulating_pots/i.test(sql),
      rows,
      persistent: true,
    },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const list = await svc.listPotsForHall("hall-a");
  assert.equal(list.length, 2);
  assert.equal(list[0]!.potKey, "innsatsen");
  assert.equal(list[1]!.potKey, "jackpott");
});
