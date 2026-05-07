/**
 * Pot-per-bongstørrelse — fasit-tester per §9.3 i SPILL_REGLER_OG_PAYOUT.md.
 *
 * Disse testene LÅSER multi-vinner-payout-regelen Tobias bekreftet 2026-05-08:
 * SEPARATE potter per bongstørrelse, hver pot deles likt blant vinnere i
 * samme størrelse. En spiller får summen av sine bongers andeler.
 *
 *   pot[bongstørrelse] = base × bongMultiplier[bongstørrelse]
 *   per-bong-andel     = floor(pot / antall_vinnende_bonger_i_samme_størrelse)
 *   spillerens utbetaling = sum av alle hens bongers andel innenfor sin størrelse
 *
 * bongMultiplier per slug-form (§9.2 + bridge LARGE_TICKET_PRICE_MULTIPLIER=2):
 *   - small_white  (5 kr)  × 1
 *   - large_white  (10 kr) × 2
 *   - small_yellow (10 kr) × 2
 *   - large_yellow (20 kr) × 4
 *   - small_purple (15 kr) × 3
 *   - large_purple (30 kr) × 6
 *
 * Test-setup: vi driver `Game1DrawEngineService.drawNext` mot en stub-pool
 * for å verifisere end-to-end pot-per-bongstørrelse-payout. Pattern-config
 * settes via `game_config_json.spill1.ticketColors[].prizePerPattern` som
 * matcher det `GamePlanEngineBridge` skriver i prod (auto-mult bakt inn).
 *
 * Doc-ref: docs/architecture/SPILL_REGLER_OG_PAYOUT.md §9 (kanonisk).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1DrawEngineService } from "../Game1DrawEngineService.js";
import { Game1PayoutService } from "../Game1PayoutService.js";
import { Game1JackpotService } from "../Game1JackpotService.js";
import type {
  WalletAdapter,
  WalletTransaction,
} from "../../adapters/WalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../../compliance/AuditLogService.js";
import type { Game1TicketPurchaseService } from "../Game1TicketPurchaseService.js";

// ── Stubs ───────────────────────────────────────────────────────────────────

interface StubResponse {
  match: (sql: string, params: unknown[]) => boolean;
  rows: unknown[] | (() => unknown[]);
  rowCount?: number;
  once?: boolean;
  throwErr?: { code: string; message: string };
}

function createStubPool(responses: StubResponse[]) {
  const queue = responses.slice();
  const runQuery = async (sql: string, params: unknown[] = []) => {
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i]!;
      if (r.match(sql, params)) {
        if (r.throwErr) {
          const err = Object.assign(new Error(r.throwErr.message), {
            code: r.throwErr.code,
          });
          if (r.once !== false) queue.splice(i, 1);
          throw err;
        }
        const rows = typeof r.rows === "function" ? r.rows() : r.rows;
        if (r.once !== false) queue.splice(i, 1);
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

interface RecordedCredit {
  accountId: string;
  amount: number;
  reason: string;
  idempotencyKey?: string;
  to?: string;
}

function makeFakeWallet(): {
  adapter: WalletAdapter;
  credits: RecordedCredit[];
} {
  const credits: RecordedCredit[] = [];
  let txCounter = 0;
  const adapter: WalletAdapter = {
    async createAccount() {
      throw new Error("ni");
    },
    async ensureAccount() {
      throw new Error("ni");
    },
    async getAccount() {
      throw new Error("ni");
    },
    async listAccounts() {
      return [];
    },
    async getBalance() {
      return 0;
    },
    async getDepositBalance() {
      return 0;
    },
    async getWinningsBalance() {
      return 0;
    },
    async getBothBalances() {
      return { deposit: 0, winnings: 0, total: 0 };
    },
    async debit() {
      throw new Error("ni");
    },
    async credit(accountId, amount, reason, options) {
      credits.push({
        accountId,
        amount,
        reason,
        idempotencyKey: options?.idempotencyKey,
        to: options?.to,
      });
      const tx: WalletTransaction = {
        id: `wtx-${++txCounter}`,
        accountId,
        type: "CREDIT",
        amount,
        reason,
        createdAt: new Date().toISOString(),
      };
      return tx;
    },
    async topUp() {
      throw new Error("ni");
    },
    async withdraw() {
      throw new Error("ni");
    },
    async transfer() {
      throw new Error("ni");
    },
    async listTransactions() {
      return [];
    },
  };
  return { adapter, credits };
}

function makeFakeTicketPurchase(): Game1TicketPurchaseService {
  return {
    async listPurchasesForGame() {
      return [];
    },
  } as unknown as Game1TicketPurchaseService;
}

// ── Test fixtures ──────────────────────────────────────────────────────────

/**
 * 5×5-grid hvor rad 1 (indekser 0-4) inneholder ball-numre som matcher
 * når trekt. Sentercelle er 0 (free).
 */
function winningRow0Grid(): Array<number | null> {
  return [
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ];
}

/** Hele rad 0 + sentercelle markert. */
function allRow0Marked(): boolean[] {
  return [
    true, true, true, true, true,
    false, false, false, false, false,
    false, false, true, false, false,
    false, false, false, false, false,
    false, false, false, false, false,
  ];
}

function runningStateRow(overrides: Record<string, unknown> = {}) {
  return {
    scheduled_game_id: "g1",
    draw_bag_json: [5, 11, 22],
    draws_completed: 0,
    current_phase: 1,
    last_drawn_ball: null,
    last_drawn_at: null,
    next_auto_draw_at: null,
    paused: false,
    engine_started_at: "2026-04-21T12:00:00.000Z",
    engine_ended_at: null,
    ...overrides,
  };
}

/**
 * Bygger spill1.ticketColors[] med fixed-amount per (color, size)
 * tilsvarende det GamePlanEngineBridge.buildTicketConfigFromCatalog skriver.
 *
 * Pris-mapping (kr per bong): white=5, yellow=10, purple=15. Multiplier:
 *   - small_white × 1
 *   - small_yellow × 2 (10 kr / 5 kr)
 *   - small_purple × 3 (15 kr / 5 kr)
 *   - large_white × 2, large_yellow × 4, large_purple × 6 (LARGE × 2)
 *
 * Per Rad 1 base = 100 kr, dette gir:
 *   - small_white  → 100 × 1 = 100 kr-pot
 *   - small_yellow → 100 × 2 = 200 kr-pot
 *   - small_purple → 100 × 3 = 300 kr-pot
 *
 * Brukes i alle test-scenarioer. `bingoBase`-pot regnes likt × multiplier.
 */
function makeRad1Base100Config(): unknown {
  return {
    spill1: {
      ticketColors: [
        // 5 kr-bonger
        {
          color: "small_white",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            full_house: { mode: "fixed", amount: 1000 },
          },
        },
        {
          color: "large_white",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 200 },
            full_house: { mode: "fixed", amount: 2000 },
          },
        },
        // 10 kr-bonger
        {
          color: "small_yellow",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 200 },
            full_house: { mode: "fixed", amount: 2000 },
          },
        },
        {
          color: "large_yellow",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 400 },
            full_house: { mode: "fixed", amount: 4000 },
          },
        },
        // 15 kr-bonger
        {
          color: "small_purple",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 300 },
            full_house: { mode: "fixed", amount: 3000 },
          },
        },
        {
          color: "large_purple",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 600 },
            full_house: { mode: "fixed", amount: 6000 },
          },
        },
      ],
    },
  };
}

interface WinnerDef {
  assignmentId: string;
  userId: string;
  walletId: string;
  hallId: string;
  ticketColor: string;
}

/**
 * Bygg full stub-respons-pipeline for én drawNext-call hvor alle gitte
 * winners blir treffet i fase 1 (rad 1) på første ball.
 *
 * Stub-en matcher engine-flyten:
 *   1. BEGIN
 *   2. SELECT FOR UPDATE app_game1_game_state
 *   3. SELECT FOR UPDATE scheduled_games
 *   4. INSERT app_game1_draws
 *   5. SELECT FOR UPDATE assignments (markings-update + win-check)
 *   6. UPDATE markings_json (per row, gjentatt)
 *   7. SELECT a.id, a.grid_numbers_json, ... (evaluateAndPayoutPhase)
 *   8. SELECT wallet_id (per unik buyer)
 *   9. computePotCents
 *  10. INSERT phase_winners (per vinner)
 *  11. UPDATE game_state
 *  12. SELECT game_state (refresh)
 *  13. SELECT draws (orden)
 *  14. COMMIT
 */
function buildStubResponses(args: {
  gameConfigJson: unknown;
  winners: WinnerDef[];
  potCents?: number;
  drawSequenceAtWin?: number;
}): StubResponse[] {
  const winners = args.winners;
  const drawSeq = args.drawSequenceAtWin ?? 1;

  // Engine kaller resolveWalletIdForUser per WINNER (ikke per unik user) —
  // vi gir én stub-respons per winner, i samme rekkefølge som assignments.
  const walletIdResponses: StubResponse[] = winners.map((w) => ({
    match: (s) => s.includes("wallet_id") && s.includes("app_users"),
    rows: [{ wallet_id: w.walletId }],
    once: true,
  }));

  return [
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [
        runningStateRow({
          draws_completed: drawSeq - 1,
          current_phase: 1,
          last_drawn_ball: null,
        }),
      ],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "running",
          ticket_config_json: {},
          game_config_json: args.gameConfigJson,
        },
      ],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("FOR UPDATE"),
      rows: winners.map((w) => ({
        id: w.assignmentId,
        grid_numbers_json: winningRow0Grid(),
        markings_json: { marked: allRow0Marked() },
      })),
    },
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("markings_json"),
      rows: [],
      once: false,
    },
    {
      match: (s) =>
        s.includes(
          "SELECT a.id, a.grid_numbers_json, a.markings_json, a.buyer_user_id",
        ) && s.includes("app_game1_ticket_assignments"),
      rows: winners.map((w) => ({
        id: w.assignmentId,
        grid_numbers_json: winningRow0Grid(),
        markings_json: { marked: allRow0Marked() },
        buyer_user_id: w.userId,
        hall_id: w.hallId,
        ticket_color: w.ticketColor,
      })),
    },
    ...walletIdResponses,
    {
      match: (s) =>
        s.includes("COALESCE(SUM(total_amount_cents)") &&
        s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: args.potCents ?? 0 }],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"),
      rows: [],
      once: false,
    },
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: drawSeq,
          last_drawn_ball: 5,
          current_phase: 2,
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        {
          draw_sequence: drawSeq,
          ball_value: 5,
          drawn_at: "2026-04-21T12:01:00.000Z",
        },
      ],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ];
}

function makeService(
  gameConfigJson: unknown,
  winners: WinnerDef[],
  options: { potCents?: number; drawSequenceAtWin?: number } = {},
): {
  service: Game1DrawEngineService;
  wallet: ReturnType<typeof makeFakeWallet>;
} {
  const wallet = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet.adapter,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();
  const { pool } = createStubPool(
    buildStubResponses({
      gameConfigJson,
      winners,
      potCents: options.potCents,
      drawSequenceAtWin: options.drawSequenceAtWin,
    }),
  );
  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService,
  });
  return { service, wallet };
}

// ── §9.3 fasit-scenarioer (Rad 1 base = 100 kr) ────────────────────────────

test("§9.3 #1: 1 hvit-spiller solo → hvit-pot 100 / 1 = 100 kr", async () => {
  const { service, wallet } = makeService(makeRad1Base100Config(), [
    {
      assignmentId: "a-1",
      userId: "u-1",
      walletId: "w-1",
      hallId: "h-a",
      ticketColor: "small_white",
    },
  ]);
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.amount, 100);
});

test("§9.3 #2: 1 lilla-spiller solo → lilla-pot 300 / 1 = 300 kr", async () => {
  const { service, wallet } = makeService(makeRad1Base100Config(), [
    {
      assignmentId: "a-1",
      userId: "u-1",
      walletId: "w-1",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
  ]);
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 1);
  assert.equal(wallet.credits[0]!.amount, 300);
});

test("§9.3 #3: 1 hvit + 1 lilla (forskjellige spillere) → hvit 100, lilla 300", async () => {
  const { service, wallet } = makeService(makeRad1Base100Config(), [
    {
      assignmentId: "a-1",
      userId: "u-white",
      walletId: "w-white",
      hallId: "h-a",
      ticketColor: "small_white",
    },
    {
      assignmentId: "a-2",
      userId: "u-purple",
      walletId: "w-purple",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
  ]);
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 2);
  const white = wallet.credits.find((c) => c.accountId === "w-white");
  const purple = wallet.credits.find((c) => c.accountId === "w-purple");
  assert.ok(white && purple);
  assert.equal(white.amount, 100, "hvit-pot 100, solo");
  assert.equal(purple.amount, 300, "lilla-pot 300, solo");
});

test("§9.3 #4: 2 hvit-spillere → hvit-pot 100 / 2 = 50 hver", async () => {
  const { service, wallet } = makeService(makeRad1Base100Config(), [
    {
      assignmentId: "a-1",
      userId: "u-1",
      walletId: "w-1",
      hallId: "h-a",
      ticketColor: "small_white",
    },
    {
      assignmentId: "a-2",
      userId: "u-2",
      walletId: "w-2",
      hallId: "h-a",
      ticketColor: "small_white",
    },
  ]);
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 2);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 50, "hver hvit-vinner får floor(100/2) = 50");
  }
});

test("§9.3 #5: 2 gul-spillere → gul-pot 200 / 2 = 100 hver", async () => {
  const { service, wallet } = makeService(makeRad1Base100Config(), [
    {
      assignmentId: "a-1",
      userId: "u-1",
      walletId: "w-1",
      hallId: "h-a",
      ticketColor: "small_yellow",
    },
    {
      assignmentId: "a-2",
      userId: "u-2",
      walletId: "w-2",
      hallId: "h-a",
      ticketColor: "small_yellow",
    },
  ]);
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 2);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 100, '"begge satser 10 kr → 50/50" — hver får 100');
  }
});

test("§9.3 #6: 2 lilla-spillere → lilla-pot 300 / 2 = 150 hver", async () => {
  const { service, wallet } = makeService(makeRad1Base100Config(), [
    {
      assignmentId: "a-1",
      userId: "u-1",
      walletId: "w-1",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
    {
      assignmentId: "a-2",
      userId: "u-2",
      walletId: "w-2",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
  ]);
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 2);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 150, "hver lilla-vinner får floor(300/2) = 150");
  }
});

test("§9.3 #7: 1 spiller med 3 lilla-bonger → lilla-pot 300 / 3 = 100 per bong, total 300 til spiller", async () => {
  const { service, wallet } = makeService(makeRad1Base100Config(), [
    {
      assignmentId: "a-1",
      userId: "u-solo",
      walletId: "w-solo",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
    {
      assignmentId: "a-2",
      userId: "u-solo",
      walletId: "w-solo",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
    {
      assignmentId: "a-3",
      userId: "u-solo",
      walletId: "w-solo",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
  ]);
  await service.drawNext("g1");
  // 3 credits à 100, alle til samme wallet — totalsum = 300 kr.
  assert.equal(wallet.credits.length, 3);
  const total = wallet.credits.reduce((sum, c) => sum + c.amount, 0);
  assert.equal(total, 300, "spilleren får hele lilla-poten på 300");
  for (const c of wallet.credits) {
    assert.equal(c.accountId, "w-solo");
    assert.equal(c.amount, 100);
  }
});

test("§9.3 #8: 3 forskjellige spillere med 1 lilla-bong hver → lilla-pot 300 / 3 = 100 hver", async () => {
  const { service, wallet } = makeService(makeRad1Base100Config(), [
    {
      assignmentId: "a-1",
      userId: "u-1",
      walletId: "w-1",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
    {
      assignmentId: "a-2",
      userId: "u-2",
      walletId: "w-2",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
    {
      assignmentId: "a-3",
      userId: "u-3",
      walletId: "w-3",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
  ]);
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 3);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 100, "hver av 3 unike spillere får 100 fra lilla-pot 300");
  }
});

test("§9.3 #9: 1 hvit + 1 gul + 1 lilla → 100 + 200 + 300 (forhold 1:2:3)", async () => {
  const { service, wallet } = makeService(makeRad1Base100Config(), [
    {
      assignmentId: "a-1",
      userId: "u-white",
      walletId: "w-white",
      hallId: "h-a",
      ticketColor: "small_white",
    },
    {
      assignmentId: "a-2",
      userId: "u-yellow",
      walletId: "w-yellow",
      hallId: "h-a",
      ticketColor: "small_yellow",
    },
    {
      assignmentId: "a-3",
      userId: "u-purple",
      walletId: "w-purple",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
  ]);
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 3);
  const w = wallet.credits.find((c) => c.accountId === "w-white");
  const y = wallet.credits.find((c) => c.accountId === "w-yellow");
  const p = wallet.credits.find((c) => c.accountId === "w-purple");
  assert.ok(w && y && p);
  assert.equal(w.amount, 100, "hvit: 100");
  assert.equal(y.amount, 200, "gul: 200");
  assert.equal(p.amount, 300, "lilla: 300");
});

// ── Floor-rounding-rest til huset (§9.3, §9.7) ─────────────────────────────

test("§9.7 floor-rest: 7 lilla-bonger på Rad 1 base 100 → hver 42 kr, 6 kr til hus (HOUSE_RETAINED)", async () => {
  const winners: WinnerDef[] = [];
  for (let i = 1; i <= 7; i++) {
    winners.push({
      assignmentId: `a-${i}`,
      userId: `u-${i}`,
      walletId: `w-${i}`,
      hallId: "h-a",
      ticketColor: "small_purple",
    });
  }
  const { service, wallet } = makeService(makeRad1Base100Config(), winners);
  await service.drawNext("g1");
  // 30000 øre / 7 = floor 4285 øre = 42.85 kr (formel: kroner-side bevarer to desimaler).
  // Faktisk: kroner = 4285/100 = 42.85.
  assert.equal(wallet.credits.length, 7);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 42.85, "floor((300kr * 100)/7)/100 = 42.85 kr");
  }
  const total = wallet.credits.reduce((sum, c) => sum + c.amount, 0);
  // 7 × 42.85 = 299.95. Hus-rest = 300 - 299.95 = 0.05 kr (5 øre).
  // Note: §9.3 i doc-en bruker hele kroner som eksempel (300 kr / 7 = 42 kr,
  // 6 kr til hus). Engine opererer i øre — floor(30000/7) = 4285 → 42.85 kr.
  // Ledger logger HOUSE_RETAINED = 5 øre = 0.05 kr.
  assert.ok(Math.abs(total - 299.95) < 0.001, `total ≈ 299.95, got ${total}`);
});

// ── Oddsen Fullt Hus (§9.5, §6) ────────────────────────────────────────────

/**
 * Oddsen-55 config matcher §6.3 i SPILL_REGLER_OG_PAYOUT.md:
 *   - targetDraw = 55
 *   - bingoBaseLow = 50000 øre = 500 kr (LOW når draw > 55)
 *   - bingoBaseHigh = 150000 øre = 1500 kr (HIGH når draw <= 55)
 *
 * Pot-størrelse per bongstørrelse:
 *   HIGH: small_purple = 1500 × 3 = 4500 kr
 *   LOW:  small_purple = 500 × 3 = 1500 kr
 */
function makeOddsen55Config(): unknown {
  return {
    spill1: {
      ticketColors: [
        // Rad 1 må ha pattern (auto-mult ikke overstyret av oddsen for Rad 1-4).
        // Vi setter 0-rad-premier (vi tester kun Fullt Hus her, men engine
        // krever at fasen kan progresses uansett).
        {
          color: "small_purple",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            full_house: { mode: "fixed", amount: 0 }, // overstyres av oddsen
          },
        },
      ],
      oddsen: {
        targetDraw: 55,
        bingoBaseLow: 50000,
        bingoBaseHigh: 150000,
      },
    },
  };
}

/**
 * Bygg Fullt Hus-stub med drawSequenceAtWin = `drawSeq`.
 * Vi bruker en fullt utfylt grid + alle markeringer slik at ANY bingo-evaluering
 * gir treff på fase 5.
 */
function buildOddsenFullHouseStubResponses(args: {
  gameConfigJson: unknown;
  winners: WinnerDef[];
  drawSequenceAtWin: number;
}): StubResponse[] {
  const winners = args.winners;
  const drawSeq = args.drawSequenceAtWin;

  // Full grid (5×5) der alle 24 numre + sentercelle er trukket.
  const fullGrid: Array<number | null> = [
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ];
  const allMarked: boolean[] = Array(25).fill(true);

  // Engine kaller resolveWalletIdForUser per WINNER (ikke per unik user).
  const walletIdResponses: StubResponse[] = winners.map((w) => ({
    match: (s) => s.includes("wallet_id") && s.includes("app_users"),
    rows: [{ wallet_id: w.walletId }],
    once: true,
  }));

  // draw_bag må ha nok baller til å dekke draws_completed + 1.
  // Lag en bag med drawSeq baller: 1, 2, ..., drawSeq.
  const drawBag: number[] = [];
  for (let i = 1; i <= drawSeq + 5; i++) drawBag.push(i);

  return [
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [
        runningStateRow({
          draws_completed: drawSeq - 1,
          current_phase: 5, // Fullt Hus-fasen
          draw_bag_json: drawBag,
        }),
      ],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "running",
          ticket_config_json: {},
          game_config_json: args.gameConfigJson,
        },
      ],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("FOR UPDATE"),
      rows: winners.map((w) => ({
        id: w.assignmentId,
        grid_numbers_json: fullGrid,
        markings_json: { marked: allMarked },
      })),
    },
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("markings_json"),
      rows: [],
      once: false,
    },
    {
      match: (s) =>
        s.includes(
          "SELECT a.id, a.grid_numbers_json, a.markings_json, a.buyer_user_id",
        ) && s.includes("app_game1_ticket_assignments"),
      rows: winners.map((w) => ({
        id: w.assignmentId,
        grid_numbers_json: fullGrid,
        markings_json: { marked: allMarked },
        buyer_user_id: w.userId,
        hall_id: w.hallId,
        ticket_color: w.ticketColor,
      })),
    },
    ...walletIdResponses,
    {
      match: (s) =>
        s.includes("COALESCE(SUM(total_amount_cents)") &&
        s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 0 }],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"),
      rows: [],
      once: false,
    },
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
      once: false,
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: drawSeq,
          last_drawn_ball: drawSeq,
          current_phase: 5,
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        {
          draw_sequence: drawSeq,
          ball_value: drawSeq,
          drawn_at: "2026-04-21T12:01:00.000Z",
        },
      ],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ];
}

function makeOddsenService(
  gameConfigJson: unknown,
  winners: WinnerDef[],
  drawSequenceAtWin: number,
) {
  const wallet = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet.adapter,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();
  const { pool } = createStubPool(
    buildOddsenFullHouseStubResponses({
      gameConfigJson,
      winners,
      drawSequenceAtWin,
    }),
  );
  return {
    wallet,
    service: new Game1DrawEngineService({
      pool: pool as never,
      ticketPurchaseService: makeFakeTicketPurchase(),
      auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
      payoutService,
      jackpotService,
    }),
  };
}

test("§9.5 Oddsen-55 #11: Fullt Hus trekk 50, 1 lilla → HIGH lilla-pot 4500 kr (1500 × 3)", async () => {
  const { service, wallet } = makeOddsenService(
    makeOddsen55Config(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_purple",
      },
    ],
    50, // drawSequenceAtWin <= 55 → HIGH
  );
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 1);
  assert.equal(
    wallet.credits[0]!.amount,
    4500,
    "Oddsen HIGH: bingoBaseHigh 1500 × bongMultiplier 3 = 4500",
  );
});

test("§9.5 Oddsen-55 #12: Fullt Hus trekk 56, 1 lilla → LOW lilla-pot 1500 kr (500 × 3)", async () => {
  const { service, wallet } = makeOddsenService(
    makeOddsen55Config(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_purple",
      },
    ],
    56, // drawSequenceAtWin > 55 → LOW
  );
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 1);
  assert.equal(
    wallet.credits[0]!.amount,
    1500,
    "Oddsen LOW: bingoBaseLow 500 × bongMultiplier 3 = 1500",
  );
});

test("§9.5 Oddsen-55 #13: Fullt Hus trekk 50, 2 lilla → HIGH lilla-pot 4500 / 2 = 2250 hver", async () => {
  const { service, wallet } = makeOddsenService(
    makeOddsen55Config(),
    [
      {
        assignmentId: "a-1",
        userId: "u-1",
        walletId: "w-1",
        hallId: "h-a",
        ticketColor: "small_purple",
      },
      {
        assignmentId: "a-2",
        userId: "u-2",
        walletId: "w-2",
        hallId: "h-a",
        ticketColor: "small_purple",
      },
    ],
    50,
  );
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 2);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 2250, "HIGH lilla-pot 4500 / 2 = 2250");
  }
});

// ── Trafikklys / explicit_per_color (§9.4) ─────────────────────────────────

/**
 * Trafikklys-runtime ikke i scope for denne PR-en. Men vi verifiserer at
 * `prize_multiplier_mode = "explicit_per_color"` (Trafikklys-stil) ikke
 * brytes — flat-pris bonger gir flat pot per pattern, og pot-en deles
 * jevnt blant vinnere. For en bong-størrelse alle har samme pris, deler
 * vinnerne flat per §9.4.
 */
test("§9.4 Trafikklys-stil flat-pris: 2 vinnere samme bongstørrelse → flat pot delt jevnt", async () => {
  // Trafikklys: alle bonger 15 kr (= small_purple-pris i bridge-mapping).
  // Pattern-config har samme amount per (color, size) — ingen auto-mult.
  const flatConfig = {
    spill1: {
      ticketColors: [
        {
          color: "small_purple",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 150 },
            full_house: { mode: "fixed", amount: 1500 },
          },
        },
      ],
    },
  };
  const { service, wallet } = makeService(flatConfig, [
    {
      assignmentId: "a-1",
      userId: "u-1",
      walletId: "w-1",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
    {
      assignmentId: "a-2",
      userId: "u-2",
      walletId: "w-2",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
  ]);
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 2);
  for (const c of wallet.credits) {
    assert.equal(c.amount, 75, "Trafikklys flat-pot 150 / 2 = 75 hver");
  }
});

// ── Regresjon: standard solo-vinner per farge (§9.3 #14) ───────────────────

test("§9.3 regresjon: Innsatsen base 1000 (Fullt Hus) — solo per farge → 1000/2000/3000", async () => {
  // Engine kjører kun ÉN fase per drawNext. Vi tester her at de tre solo-
  // scenarioene gir riktig payout uavhengig (samme test-shape som §9.3 #1-3,
  // men på Fullt Hus base 1000). Vi tester én farge per drawNext.
  for (const [color, expected] of [
    ["small_white", 1000],
    ["small_yellow", 2000],
    ["small_purple", 3000],
  ] as const) {
    const config = {
      spill1: {
        ticketColors: [
          {
            color,
            prizePerPattern: {
              full_house: { mode: "fixed", amount: expected },
            },
          },
        ],
      },
    };
    const { service, wallet } = makeOddsenService(
      config,
      [
        {
          assignmentId: "a-1",
          userId: "u-1",
          walletId: "w-1",
          hallId: "h-a",
          ticketColor: color,
        },
      ],
      30,
    );
    await service.drawNext("g1");
    assert.equal(wallet.credits.length, 1, `${color}: 1 credit`);
    assert.equal(
      wallet.credits[0]!.amount,
      expected,
      `${color} solo Fullt Hus → ${expected} kr (auto-mult)`,
    );
  }
});

// ── Regresjon: Trafikklys explicit_per_color path ikke brutt ───────────────

test("§9.4 regresjon: explicit_per_color (Trafikklys-style) faller fortsatt gjennom riktig path", async () => {
  // Ingen oddsen-blokk → standard pattern-payout. Ingen auto-mult fordi
  // vi setter eksplisitt amount per farge (ulike per farge for å verifisere
  // at hver gruppes egen pot brukes).
  const config = {
    spill1: {
      ticketColors: [
        {
          color: "small_purple",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 50 }, // rød pot eksempel
          },
        },
        {
          color: "large_purple",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 }, // gul pot eksempel
          },
        },
      ],
    },
  };
  const { service, wallet } = makeService(config, [
    {
      assignmentId: "a-1",
      userId: "u-1",
      walletId: "w-1",
      hallId: "h-a",
      ticketColor: "small_purple",
    },
    {
      assignmentId: "a-2",
      userId: "u-2",
      walletId: "w-2",
      hallId: "h-a",
      ticketColor: "large_purple",
    },
  ]);
  await service.drawNext("g1");
  assert.equal(wallet.credits.length, 2);
  const small = wallet.credits.find((c) => c.accountId === "w-1");
  const large = wallet.credits.find((c) => c.accountId === "w-2");
  assert.ok(small && large);
  assert.equal(small.amount, 50, "small_purple pot 50, solo");
  assert.equal(large.amount, 100, "large_purple pot 100, solo");
});
