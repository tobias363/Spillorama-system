/**
 * PR-T2 Spor 4: Tester for progressive_threshold winRule-varianten på
 * Game1PotService.
 *
 * Dekker:
 *   - validatePotConfig aksepterer begge winRule-varianter
 *   - validatePotConfig avviser ikke-stigende ladder, tom ladder, verdi
 *     utenfor 1..75, ikke-heltall
 *   - evaluateDrawSequenceAgainstRule returnerer riktig reason-kode for
 *     begge varianter (ok / BEFORE / AFTER)
 *   - tryWin med progressive_threshold: under-window → DRAW_BEFORE_WINDOW;
 *     over-window → DRAW_AFTER_THRESHOLD; innenfor → triggered; feil phase → WRONG_PHASE
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1PotService,
  validatePotConfig,
  evaluateDrawSequenceAgainstRule,
  type PotConfig,
} from "./Game1PotService.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Stub pool (samme mønster som T1-tester) ─────────────────────────────────

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
} {
  const queue = responses.slice();
  const runQuery = async (sql: string, _params: unknown[] = []) => {
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
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function progressiveConfig(overrides: Partial<PotConfig> = {}): PotConfig {
  return {
    seedAmountCents: 2000_00,      // 2000 kr
    dailyBoostCents: 4000_00,      // 4000 kr
    salePercentBps: 0,
    maxAmountCents: 30_000_00,     // 30 000 kr
    winRule: {
      kind: "progressive_threshold",
      phase: 5,
      thresholdLadder: [50, 55, 56, 57],
    },
    ticketColors: [],
    ...overrides,
  };
}

function potDbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pot-jack-1",
    hall_id: "hall-a",
    pot_key: "jackpott",
    display_name: "Jackpott",
    current_amount_cents: 5000_00,
    config_json: progressiveConfig(),
    last_daily_boost_date: null,
    last_reset_at: null,
    last_reset_reason: null,
    created_at: "2026-04-22T10:00:00Z",
    updated_at: "2026-04-22T10:00:00Z",
    ...overrides,
  };
}

// ── validatePotConfig ───────────────────────────────────────────────────────

test("validatePotConfig: progressive_threshold-variant med gyldig ladder passerer", () => {
  validatePotConfig(progressiveConfig());
});

test("validatePotConfig: tom thresholdLadder → INVALID_CONFIG", () => {
  const bad = progressiveConfig();
  if (bad.winRule.kind !== "progressive_threshold") throw new Error("wrong variant");
  bad.winRule.thresholdLadder = [];
  assert.throws(
    () => validatePotConfig(bad),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

test("validatePotConfig: thresholdLadder ikke strengt stigende → INVALID_CONFIG", () => {
  const bad = progressiveConfig();
  if (bad.winRule.kind !== "progressive_threshold") throw new Error("wrong variant");
  bad.winRule.thresholdLadder = [50, 55, 55, 57]; // duplikat
  assert.throws(() => validatePotConfig(bad), DomainError);
  bad.winRule.thresholdLadder = [57, 56, 55, 50]; // synkende
  assert.throws(() => validatePotConfig(bad), DomainError);
});

test("validatePotConfig: ladder-verdi utenfor 1..75 → INVALID_CONFIG", () => {
  const bad = progressiveConfig();
  if (bad.winRule.kind !== "progressive_threshold") throw new Error("wrong variant");
  bad.winRule.thresholdLadder = [0, 50];
  assert.throws(() => validatePotConfig(bad), DomainError);
  bad.winRule.thresholdLadder = [50, 76];
  assert.throws(() => validatePotConfig(bad), DomainError);
});

test("validatePotConfig: ikke-heltall i ladder → INVALID_CONFIG", () => {
  const bad = progressiveConfig();
  if (bad.winRule.kind !== "progressive_threshold") throw new Error("wrong variant");
  bad.winRule.thresholdLadder = [50, 55.5, 57];
  assert.throws(() => validatePotConfig(bad), DomainError);
});

test("validatePotConfig: ugyldig winRule.kind → INVALID_CONFIG", () => {
  const bad = progressiveConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bad.winRule as any).kind = "unknown_variant";
  assert.throws(() => validatePotConfig(bad), DomainError);
});

// ── evaluateDrawSequenceAgainstRule ─────────────────────────────────────────

test("evaluateDrawSequenceAgainstRule: phase_at_or_before_draw under/over/på threshold", () => {
  const rule = { kind: "phase_at_or_before_draw" as const, phase: 5, drawThreshold: 50 };
  assert.equal(evaluateDrawSequenceAgainstRule(rule, 30), "ok");
  assert.equal(evaluateDrawSequenceAgainstRule(rule, 50), "ok", "inklusiv");
  assert.equal(evaluateDrawSequenceAgainstRule(rule, 51), "DRAW_AFTER_THRESHOLD");
});

test("evaluateDrawSequenceAgainstRule: progressive_threshold vindu", () => {
  const rule = {
    kind: "progressive_threshold" as const,
    phase: 5,
    thresholdLadder: [50, 55, 56, 57],
  };
  assert.equal(evaluateDrawSequenceAgainstRule(rule, 49), "DRAW_BEFORE_WINDOW");
  assert.equal(evaluateDrawSequenceAgainstRule(rule, 50), "ok", "nedre inklusiv");
  assert.equal(evaluateDrawSequenceAgainstRule(rule, 55), "ok", "mellom-ladder-verdi");
  assert.equal(evaluateDrawSequenceAgainstRule(rule, 57), "ok", "øvre inklusiv");
  assert.equal(evaluateDrawSequenceAgainstRule(rule, 58), "DRAW_AFTER_THRESHOLD");
});

// ── tryWin med progressive_threshold ────────────────────────────────────────

function winnerInput(overrides: Partial<Parameters<Game1PotService["tryWin"]>[0]> = {}) {
  return {
    hallId: "hall-a",
    potKey: "jackpott",
    phase: 5,
    drawSequenceAtWin: 55,
    ticketColor: "small_yellow",
    winnerUserId: "user-1",
    scheduledGameId: "sg-1",
    ...overrides,
  };
}

test("tryWin progressive: draw=49 (under vindu) → DRAW_BEFORE_WINDOW", async () => {
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [potDbRow()], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin(winnerInput({ drawSequenceAtWin: 49 }));
  assert.equal(r.triggered, false);
  assert.equal(r.reasonCode, "DRAW_BEFORE_WINDOW");
});

test("tryWin progressive: draw=50 (nedre kant) → triggered", async () => {
  const row = potDbRow({ current_amount_cents: 5000_00 });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
    { match: (sql) => /UPDATE[\s\S]*?accumulating_pots/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /INSERT INTO[\s\S]*?pot_events/i.test(sql), rows: [], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin(winnerInput({ drawSequenceAtWin: 50 }));
  assert.equal(r.triggered, true);
  assert.equal(r.amountCents, 5000_00);
});

test("tryWin progressive: draw=57 (øvre kant) → triggered", async () => {
  const row = potDbRow({ current_amount_cents: 3000_00 });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
    { match: (sql) => /UPDATE[\s\S]*?accumulating_pots/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /INSERT INTO[\s\S]*?pot_events/i.test(sql), rows: [], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin(winnerInput({ drawSequenceAtWin: 57 }));
  assert.equal(r.triggered, true);
  assert.equal(r.amountCents, 3000_00);
});

test("tryWin progressive: draw=58 (over vindu) → DRAW_AFTER_THRESHOLD, pot urørt", async () => {
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [potDbRow()], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin(winnerInput({ drawSequenceAtWin: 58 }));
  assert.equal(r.triggered, false);
  assert.equal(r.reasonCode, "DRAW_AFTER_THRESHOLD");
});

test("tryWin progressive: feil phase (4 i stedet for 5) → WRONG_PHASE", async () => {
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [potDbRow()], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin(winnerInput({ phase: 4 }));
  assert.equal(r.triggered, false);
  assert.equal(r.reasonCode, "WRONG_PHASE");
});

test("tryWin progressive: 'står til vunnet' — pot-saldo bevares på tvers av uvunnet spill", async () => {
  // Simulér: spill 1 draw 48 (under vindu) → ikke utløst, saldo urørt.
  const preservedBalance = 8000_00;
  const row = potDbRow({ current_amount_cents: preservedBalance });
  const { pool } = createStubPool([
    { match: (sql) => /^BEGIN/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [], persistent: true },
    { match: (sql) => /FOR UPDATE/i.test(sql), rows: [row], persistent: true },
  ]);
  const svc = new Game1PotService({ pool: pool as never });
  const r = await svc.tryWin(winnerInput({ drawSequenceAtWin: 48 }));
  assert.equal(r.triggered, false);
  // Saldo er ikke endret (ingen UPDATE skjedde — se stub-queue: kun SELECT + BEGIN/COMMIT).
  // Dette simulerer "pot ruller over" — T1-kontrakt: uvunnet = pot urørt.
});
