/**
 * PR-T3 Spor 4: Tester for Innsatsen-spesifikke Game1PotService-paths.
 *
 * Dekker:
 *   - onSaleCompleted: happy (akkumulerer alle pot-er i hallen),
 *     ingen pot-er (no-op), salePercentBps=0 (skip), isolert feil
 *     (én pot-feil stopper ikke resten).
 *   - tryWin med drawThresholdLower: vinn før vindu → DRAW_BEFORE_WINDOW,
 *     vinn i vindu → triggered.
 *   - tryWin med targetAmountCents: pot under target → BELOW_TARGET,
 *     pot på/over target → triggered.
 *   - validatePotConfig: Innsatsen-spesifikke invariants.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1PotService,
  validatePotConfig,
  type PotConfig,
} from "./Game1PotService.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Stub pool (kopiert fra Game1PotService.test.ts) ─────────────────────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[] | (() => unknown[]);
  rowCount?: number;
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

function innsatsenConfig(overrides: Partial<PotConfig> = {}): PotConfig {
  return {
    seedAmountCents: 500_00, // base 500 kr (T3-brief)
    dailyBoostCents: 0,
    salePercentBps: 2000, // 20% (T3-brief)
    maxAmountCents: null,
    winRule: {
      kind: "phase_at_or_before_draw",
      phase: 5,
      drawThreshold: 58, // øvre grense (spec §Innsatsen)
    },
    ticketColors: [],
    potType: "innsatsen",
    drawThresholdLower: 56, // nedre grense (spec §Innsatsen)
    targetAmountCents: 2000_00, // 2000 kr target
    ...overrides,
  };
}

function jackpottConfig(overrides: Partial<PotConfig> = {}): PotConfig {
  return {
    seedAmountCents: 100_00,
    dailyBoostCents: 50_00,
    salePercentBps: 500,
    maxAmountCents: 10_000_00,
    winRule: {
      kind: "phase_at_or_before_draw",
      phase: 5,
      drawThreshold: 50,
    },
    ticketColors: [],
    potType: "jackpott",
    ...overrides,
  };
}

function potDbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pot-1",
    hall_id: "hall-a",
    pot_key: "innsatsen",
    display_name: "Innsatsen",
    current_amount_cents: 500_00,
    config_json: innsatsenConfig(),
    last_daily_boost_date: null,
    last_reset_at: null,
    last_reset_reason: null,
    created_at: "2026-04-22T10:00:00Z",
    updated_at: "2026-04-22T10:00:00Z",
    ...overrides,
  };
}

// ── validatePotConfig: Innsatsen invariants ─────────────────────────────────

test("validatePotConfig: Innsatsen-config med target + lower passerer", () => {
  validatePotConfig(innsatsenConfig());
});

test("validatePotConfig: potType='innsatsen' med salePercentBps=0 → INVALID_CONFIG", () => {
  assert.throws(
    () => validatePotConfig(innsatsenConfig({ salePercentBps: 0 })),
    (err: unknown) =>
      err instanceof DomainError &&
      err.code === "INVALID_CONFIG" &&
      /salePercentBps > 0/.test(err.message)
  );
});

test("validatePotConfig: drawThresholdLower > drawThreshold → INVALID_CONFIG", () => {
  const bad = innsatsenConfig();
  bad.drawThresholdLower = 60; // > drawThreshold=58
  assert.throws(
    () => validatePotConfig(bad),
    (err: unknown) =>
      err instanceof DomainError &&
      err.code === "INVALID_CONFIG" &&
      /drawThresholdLower/.test(err.message)
  );
});

test("validatePotConfig: drawThresholdLower utenfor 1..75 → INVALID_CONFIG", () => {
  assert.throws(
    () => validatePotConfig(innsatsenConfig({ drawThresholdLower: 0 })),
    DomainError
  );
  assert.throws(
    () => validatePotConfig(innsatsenConfig({ drawThresholdLower: 76 })),
    DomainError
  );
});

test("validatePotConfig: negativ targetAmountCents → INVALID_CONFIG", () => {
  assert.throws(
    () => validatePotConfig(innsatsenConfig({ targetAmountCents: -1 })),
    DomainError
  );
});

test("validatePotConfig: ugyldig potType → INVALID_CONFIG", () => {
  const bad = innsatsenConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bad as any).potType = "unknown";
  assert.throws(() => validatePotConfig(bad), DomainError);
});

// Agent IJ2 — capType-semantikk (legacy total-cap for Innsatsen).

test("validatePotConfig IJ2: capType='total' med maxAmountCents satt passerer", () => {
  validatePotConfig(
    innsatsenConfig({ capType: "total", maxAmountCents: 2000_00 })
  );
});

test("validatePotConfig IJ2: capType='total' uten maxAmountCents → INVALID_CONFIG", () => {
  assert.throws(
    () =>
      validatePotConfig(
        innsatsenConfig({ capType: "total", maxAmountCents: null })
      ),
    (err: unknown) =>
      err instanceof DomainError &&
      err.code === "INVALID_CONFIG" &&
      /maxAmountCents/.test(err.message)
  );
});

test("validatePotConfig IJ2: capType='pot-balance' uten maxAmountCents (null) passerer (bakoverkompat)", () => {
  validatePotConfig(
    innsatsenConfig({ capType: "pot-balance", maxAmountCents: null })
  );
});

test("validatePotConfig IJ2: capType uten verdi default (undefined) passerer (bakoverkompat)", () => {
  const cfg: PotConfig = { ...innsatsenConfig() };
  delete cfg.capType;
  validatePotConfig(cfg);
});

test("validatePotConfig IJ2: ugyldig capType-verdi → INVALID_CONFIG", () => {
  assert.throws(
    () =>
      validatePotConfig(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        innsatsenConfig({ capType: "bogus" as any })
      ),
    (err: unknown) =>
      err instanceof DomainError &&
      err.code === "INVALID_CONFIG" &&
      /capType/.test(err.message)
  );
});

test("validatePotConfig: potType='generic' er lovlig", () => {
  validatePotConfig(
    innsatsenConfig({ potType: "generic", salePercentBps: 0 })
  );
});

// ── onSaleCompleted: dispatcher-tester ──────────────────────────────────────

test("onSaleCompleted: ingen pot-er i hall → tom resultat-liste (no-op)", async () => {
  const { pool } = createStubPool([
    {
      match: (sql) => /SELECT \*[\s\S]+app_game1_accumulating_pots/i.test(sql),
      rows: [],
      persistent: true,
    },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const results = await svc.onSaleCompleted({
    hallId: "hall-a",
    saleAmountCents: 1000_00,
  });
  assert.deepEqual(results, []);
});

test("onSaleCompleted: akkumulerer alle pot-er i hallen", async () => {
  // To pot-er: innsatsen (bps=2000) og jackpott (bps=500).
  // saleAmount = 100 kr = 10_000 øre → innsatsen får 2000, jackpott får 500.
  const innsatsenRow = potDbRow({
    id: "pot-inns",
    pot_key: "innsatsen",
    current_amount_cents: 500_00,
    config_json: innsatsenConfig(),
  });
  const jackpottRow = potDbRow({
    id: "pot-jp",
    pot_key: "jackpott",
    current_amount_cents: 100_00,
    config_json: jackpottConfig(),
  });

  let innsatsenUpdated = false;
  let jackpottUpdated = false;

  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    // listPotsForHall
    {
      match: (sql) =>
        /SELECT \*[\s\S]+app_game1_accumulating_pots[\s\S]+WHERE hall_id/i.test(sql) &&
        !/FOR UPDATE/i.test(sql),
      rows: [innsatsenRow, jackpottRow],
      persistent: true,
    },
    // Inside accumulateFromSale: loadPotForUpdate (FOR UPDATE)
    {
      match: (sql) => /FOR UPDATE/i.test(sql),
      rows: (
      ) => {
        // Siste FOR UPDATE params vil inneholde pot_key. Vi leser fra queries.
        const lastFU = queries
          .filter((q) => /FOR UPDATE/i.test(q.sql))
          .slice(-1)[0];
        const potKey = lastFU?.params?.[1];
        if (potKey === "innsatsen") return [innsatsenRow];
        if (potKey === "jackpott") return [jackpottRow];
        return [];
      },
      persistent: true,
    },
    {
      match: (sql) => /UPDATE[\s\S]+app_game1_accumulating_pots/i.test(sql),
      rows: () => {
        const params = queries
          .filter((q) => /UPDATE/i.test(q.sql))
          .slice(-1)[0]?.params;
        const id = params?.[1];
        if (id === "pot-inns") innsatsenUpdated = true;
        if (id === "pot-jp") jackpottUpdated = true;
        return [];
      },
      persistent: true,
    },
    {
      match: (sql) => /INSERT INTO[\s\S]+app_game1_pot_events/i.test(sql),
      rows: [],
      persistent: true,
    },
  ]);

  const svc = new Game1PotService({ pool: pool as never });
  const results = await svc.onSaleCompleted({
    hallId: "hall-a",
    saleAmountCents: 10_000, // 100 kr
  });

  assert.equal(results.length, 2);
  const innsatsenRes = results.find((r) => r.potKey === "innsatsen")!;
  const jackpottRes = results.find((r) => r.potKey === "jackpott")!;
  // 10000 øre * 2000bps / 10000 = 2000 øre
  assert.equal(innsatsenRes.appliedCents, 2000);
  // 10000 øre * 500bps / 10000 = 500 øre
  assert.equal(jackpottRes.appliedCents, 500);
});

test("onSaleCompleted: pot med salePercentBps=0 hoppes over (uten UPDATE eller event)", async () => {
  const zeroRow = potDbRow({
    config_json: innsatsenConfig({ salePercentBps: 0, potType: "generic" }),
  });
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    {
      match: (sql) =>
        /SELECT \*[\s\S]+app_game1_accumulating_pots[\s\S]+WHERE hall_id/i.test(sql) &&
        !/FOR UPDATE/i.test(sql),
      rows: [zeroRow],
      persistent: true,
    },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const results = await svc.onSaleCompleted({
    hallId: "hall-a",
    saleAmountCents: 10_000,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]!.appliedCents, 0);
  // Ingen INSERT INTO pot_events, ingen UPDATE skal skje.
  const mutations = queries.filter(
    (q) => /INSERT|UPDATE/i.test(q.sql) && /pot/i.test(q.sql)
  );
  assert.equal(mutations.length, 0, "forventet ingen mutasjoner for bps=0 pot");
});

test("onSaleCompleted: negativ saleAmountCents → kaster INVALID_AMOUNT", async () => {
  const { pool } = createStubPool([]);
  const svc = new Game1PotService({ pool: pool as never });
  await assert.rejects(
    () => svc.onSaleCompleted({ hallId: "hall-a", saleAmountCents: -1 }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_AMOUNT"
  );
});

test("onSaleCompleted: manglende hallId → kaster INVALID_HALL", async () => {
  const { pool } = createStubPool([]);
  const svc = new Game1PotService({ pool: pool as never });
  await assert.rejects(
    () => svc.onSaleCompleted({ hallId: "", saleAmountCents: 1000 }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_HALL"
  );
});

test("onSaleCompleted: isolert pot-feil → andre pot-er fortsetter", async () => {
  // Første pot kaster (FOR UPDATE returnerer ingen rad = pot forsvinner
  // midlertidig), andre pot lykkes.
  const innsatsenRow = potDbRow({
    id: "pot-inns",
    pot_key: "innsatsen",
    config_json: innsatsenConfig(),
  });
  const jackpottRow = potDbRow({
    id: "pot-jp",
    pot_key: "jackpott",
    config_json: jackpottConfig(),
  });

  let forUpdateCalls = 0;
  const { pool, queries } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^ROLLBACK/i.test(sql), rows: [], persistent: true },
    {
      match: (sql) =>
        /SELECT \*[\s\S]+app_game1_accumulating_pots[\s\S]+WHERE hall_id/i.test(sql) &&
        !/FOR UPDATE/i.test(sql),
      rows: [innsatsenRow, jackpottRow],
      persistent: true,
    },
    {
      match: (sql) => /FOR UPDATE/i.test(sql),
      rows: () => {
        forUpdateCalls++;
        // 1. call: innsatsen → returnér tomt (trigger POT_NOT_FOUND-feil i accumulateFromSale)
        if (forUpdateCalls === 1) return [];
        // 2. call: jackpott → returnér row
        return [jackpottRow];
      },
      persistent: true,
    },
    {
      match: (sql) => /UPDATE[\s\S]+app_game1_accumulating_pots/i.test(sql),
      rows: [],
      persistent: true,
    },
    {
      match: (sql) => /INSERT INTO[\s\S]+app_game1_pot_events/i.test(sql),
      rows: [],
      persistent: true,
    },
  ]);

  const svc = new Game1PotService({ pool: pool as never });
  const results = await svc.onSaleCompleted({
    hallId: "hall-a",
    saleAmountCents: 10_000,
  });

  assert.equal(results.length, 2);
  const innsatsenRes = results.find((r) => r.potKey === "innsatsen")!;
  const jackpottRes = results.find((r) => r.potKey === "jackpott")!;
  assert.ok(innsatsenRes.error, "innsatsen skulle ha en error-melding");
  assert.equal(innsatsenRes.appliedCents, 0);
  assert.equal(jackpottRes.appliedCents, 500); // 10_000 * 500 / 10_000
});

// ── tryWin: drawThresholdLower ──────────────────────────────────────────────

test("tryWin: Innsatsen draw FØR drawThresholdLower → DRAW_BEFORE_WINDOW", async () => {
  const row = potDbRow({
    current_amount_cents: 2000_00, // på target
    config_json: innsatsenConfig(),
  });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    {
      match: (sql) => /FOR UPDATE/i.test(sql),
      rows: [row],
      persistent: true,
    },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const res = await svc.tryWin({
    hallId: "hall-a",
    potKey: "innsatsen",
    phase: 5,
    drawSequenceAtWin: 55, // < lower=56
    ticketColor: "yellow",
    winnerUserId: "u-1",
    scheduledGameId: "sg-1",
  });
  assert.equal(res.triggered, false);
  assert.equal(res.reasonCode, "DRAW_BEFORE_WINDOW");
});

test("tryWin: Innsatsen draw innen vindu + på target → triggered", async () => {
  const row = potDbRow({
    current_amount_cents: 2000_00,
    config_json: innsatsenConfig(),
  });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    {
      match: (sql) => /FOR UPDATE/i.test(sql),
      rows: [row],
      persistent: true,
    },
    {
      match: (sql) => /UPDATE[\s\S]+app_game1_accumulating_pots/i.test(sql),
      rows: [],
      persistent: true,
    },
    {
      match: (sql) => /INSERT INTO[\s\S]+app_game1_pot_events/i.test(sql),
      rows: [],
      persistent: true,
    },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const res = await svc.tryWin({
    hallId: "hall-a",
    potKey: "innsatsen",
    phase: 5,
    drawSequenceAtWin: 57, // innen [56, 58]
    ticketColor: "yellow",
    winnerUserId: "u-1",
    scheduledGameId: "sg-1",
  });
  assert.equal(res.triggered, true);
  assert.equal(res.amountCents, 2000_00);
});

test("tryWin: Innsatsen draw ETTER drawThreshold (58) → DRAW_AFTER_THRESHOLD", async () => {
  const row = potDbRow({
    current_amount_cents: 2000_00,
    config_json: innsatsenConfig(),
  });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    {
      match: (sql) => /FOR UPDATE/i.test(sql),
      rows: [row],
      persistent: true,
    },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const res = await svc.tryWin({
    hallId: "hall-a",
    potKey: "innsatsen",
    phase: 5,
    drawSequenceAtWin: 59,
    ticketColor: "yellow",
    winnerUserId: "u-1",
    scheduledGameId: "sg-1",
  });
  assert.equal(res.triggered, false);
  assert.equal(res.reasonCode, "DRAW_AFTER_THRESHOLD");
});

// ── tryWin: targetAmountCents ───────────────────────────────────────────────

test("tryWin: Innsatsen pot UNDER target → BELOW_TARGET", async () => {
  const row = potDbRow({
    current_amount_cents: 1999_00, // under target=2000_00
    config_json: innsatsenConfig(),
  });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    {
      match: (sql) => /FOR UPDATE/i.test(sql),
      rows: [row],
      persistent: true,
    },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const res = await svc.tryWin({
    hallId: "hall-a",
    potKey: "innsatsen",
    phase: 5,
    drawSequenceAtWin: 57,
    ticketColor: "yellow",
    winnerUserId: "u-1",
    scheduledGameId: "sg-1",
  });
  assert.equal(res.triggered, false);
  assert.equal(res.reasonCode, "BELOW_TARGET");
});

test("tryWin: target ikke satt → target-gate hoppes over (T1-bakoverkompat)", async () => {
  const cfg = innsatsenConfig();
  delete cfg.targetAmountCents;
  delete cfg.drawThresholdLower; // også fjern så DRAW_BEFORE_WINDOW ikke trigger
  const row = potDbRow({
    current_amount_cents: 100_00,
    config_json: cfg,
  });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    {
      match: (sql) => /FOR UPDATE/i.test(sql),
      rows: [row],
      persistent: true,
    },
    {
      match: (sql) => /UPDATE[\s\S]+app_game1_accumulating_pots/i.test(sql),
      rows: [],
      persistent: true,
    },
    {
      match: (sql) => /INSERT INTO[\s\S]+app_game1_pot_events/i.test(sql),
      rows: [],
      persistent: true,
    },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const res = await svc.tryWin({
    hallId: "hall-a",
    potKey: "innsatsen",
    phase: 5,
    drawSequenceAtWin: 20,
    ticketColor: "yellow",
    winnerUserId: "u-1",
    scheduledGameId: "sg-1",
  });
  assert.equal(res.triggered, true);
});
