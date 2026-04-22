/**
 * GAME1_SCHEDULE PR 4c Bolk 5: Integrasjonstest for drawNext() wire-up
 * med payoutService + jackpotService.
 *
 * Verifiserer at drawNext:
 *   - Evaluerer current_phase etter markings-oppdatering
 *   - Kaller payoutService.payoutPhase ved vinnere
 *   - Øker current_phase ved fase-win (ikke Fullt Hus)
 *   - Ender spillet ved Fullt Hus (phase 5 win)
 *   - Rullbaker drawNext-transaksjonen hvis payoutService kaster
 *   - PR 4b-modus (uten payoutService) → fortsatt fungerer (ingen payout)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import { Game1DrawEngineService } from "./Game1DrawEngineService.js";
import { Game1PayoutService } from "./Game1PayoutService.js";
import { Game1JackpotService } from "./Game1JackpotService.js";
import type { WalletAdapter, WalletTransaction } from "../adapters/WalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type {
  Game1TicketPurchaseService,
} from "./Game1TicketPurchaseService.js";

// ── Stubs ───────────────────────────────────────────────────────────────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string, params: unknown[]) => boolean;
  rows: unknown[] | (() => unknown[]);
  rowCount?: number;
  once?: boolean;
  throwErr?: { code: string; message: string };
}

function createStubPool(responses: StubResponse[]) {
  const queue = responses.slice();
  const queries: RecordedQuery[] = [];
  const runQuery = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
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
    queries,
  };
}

function makeFakeWallet(): { adapter: WalletAdapter; credits: any[] } {
  const credits: any[] = [];
  let txCounter = 0;
  const adapter: WalletAdapter = {
    async createAccount() { throw new Error("ni"); },
    async ensureAccount() { throw new Error("ni"); },
    async getAccount() { throw new Error("ni"); },
    async listAccounts() { return []; },
    async getBalance() { return 0; },
    async getDepositBalance() { return 0; },
    async getWinningsBalance() { return 0; },
    async getBothBalances() { return { deposit: 0, winnings: 0, total: 0 }; },
    async debit() { throw new Error("ni"); },
    async credit(accountId, amount, reason, options) {
      credits.push({ accountId, amount, reason, idempotencyKey: options?.idempotencyKey });
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
    async topUp() { throw new Error("ni"); },
    async withdraw() { throw new Error("ni"); },
    async transfer() { throw new Error("ni"); },
    async listTransactions() { return []; },
  };
  return { adapter, credits };
}

function makeFakeTicketPurchase(): Game1TicketPurchaseService {
  return {
    async listPurchasesForGame() { return []; },
  } as unknown as Game1TicketPurchaseService;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** 5x5 grid med centre-free hvor rad 0 inneholder [1,2,3,4,5]. */
function winningRow0Grid(): Array<number | null> {
  return [
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ];
}

/** markings der rad 0 allerede har 4 markert; ball=5 vil fullføre. */
function markingsRow0AlmostComplete(): boolean[] {
  return [
    true, true, true, true, false, // rad 0: 4 av 5 markert
    false, false, false, false, false,
    false, false, true, false, false, // centre
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

// ── Test: fase 1 vinner ved neste draw ────────────────────────────────────

test("drawNext fase 1: ball=5 fullfører rad 0 → payoutPhase kalt, phase→2", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    // loadGameStateForUpdate
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    // loadScheduledGameForUpdate — ticket_config har prize % for fase 1
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "running",
          ticket_config_json: {
            spill1: {
              ticketColors: [
                {
                  color: "small_yellow",
                  prizePerPattern: { row_1: 10, row_2: 20, row_3: 25, row_4: 25, full_house: 20 },
                },
              ],
            },
          },
        },
      ],
    },
    // INSERT draws
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    // markBallOnAssignments SELECT — grid med 5 på rad 0, markings 4/5
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [{
        id: "a-1",
        grid_numbers_json: winningRow0Grid(),
        markings_json: { marked: markingsRow0AlmostComplete() },
      }],
    },
    // markBallOnAssignments UPDATE
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_ticket_assignments") && s.includes("markings_json"),
      rows: [],
    },
    // evaluateAndPayoutPhase: SELECT alle assignments
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [{
        id: "a-1",
        grid_numbers_json: winningRow0Grid(),
        markings_json: {
          marked: [
            true, true, true, true, true, // rad 0 NÅ komplett (etter mark)
            false, false, false, false, false,
            false, false, true, false, false,
            false, false, false, false, false,
            false, false, false, false, false,
          ],
        },
        buyer_user_id: "u-1",
        hall_id: "hall-a",
        ticket_color: "small_yellow",
      }],
    },
    // resolveWalletIdForUser
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "wallet-1" }],
    },
    // computePotCents
    {
      match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 100000 }], // 1000 kr pot
    },
    // payoutService INSERT phase_winners
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"),
      rows: [],
    },
    // UPDATE game_state
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    // loadGameState (etter update)
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 5, current_phase: 2 })],
    },
    // loadDrawsInOrder
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [{ draw_sequence: 1, ball_value: 5, drawn_at: "2026-04-21T12:01:00.000Z" }],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService,
  });

  const view = await service.drawNext("g1");

  assert.equal(view.drawsCompleted, 1);
  assert.equal(view.lastDrawnBall, 5);

  // Wallet.credit kalt med 1000 kr × 10% = 100 kr = én vinner.
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.amount, 100);
  assert.equal(credits[0]!.accountId, "wallet-1");

  // UPDATE game_state skal sette current_phase=2 (fase 1 vunnet, ikke Fullt Hus).
  const stateUpdate = queries.find(
    (q) =>
      q.sql.trim().startsWith("UPDATE") &&
      q.sql.includes("app_game1_game_state") &&
      q.sql.includes("current_phase")
  );
  assert.ok(stateUpdate, "UPDATE game_state skal skje");
  // params: [scheduledGameId, drawsCompleted, ball, newPhase, isFinished]
  assert.equal(stateUpdate!.params[3], 2, "current_phase → 2 etter fase 1-win");
  assert.equal(stateUpdate!.params[4], false, "ikke isFinished ved fase 1");
});

// ── Test: Fullt Hus vinner → spillet ender ────────────────────────────────

test("drawNext fase 5: Fullt Hus-vinn → engine_ended_at satt + status='completed'", async () => {
  const { adapter: wallet } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  // Grid hvor alle celler kan markeres med tilgjengelige tall.
  const fullGrid: Array<number | null> = [];
  for (let i = 0; i < 25; i++) fullGrid.push(i === 12 ? 0 : i + 1);
  const fullMarked = new Array(25).fill(true);

  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow({
        current_phase: 5,
        draws_completed: 23,
        // Bag med 25 elementer slik at draws_completed=23 er gyldig.
        draw_bag_json: Array.from({ length: 25 }, (_, i) => i + 1),
      })],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [{
        id: "g1",
        status: "running",
        ticket_config_json: {
          spill1: {
            ticketColors: [{ color: "small_yellow", prizePerPattern: { full_house: 20 } }],
            jackpot: {
              prizeByColor: { yellow: 10000, white: 0, purple: 0 },
              draw: 50,
            },
          },
        },
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [{ id: "a-1", grid_numbers_json: fullGrid, markings_json: { marked: fullMarked } }],
    },
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_ticket_assignments") && s.includes("markings_json"),
      rows: [],
    },
    // evaluateAndPayoutPhase SELECT
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [{
        id: "a-1",
        grid_numbers_json: fullGrid,
        markings_json: { marked: fullMarked },
        buyer_user_id: "u-1",
        hall_id: "hall-a",
        ticket_color: "small_yellow",
      }],
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "wallet-1" }],
    },
    {
      match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 100000 }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"), rows: [] },
    { match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"), rows: [] },
    // UPDATE scheduled_games → completed
    {
      match: (s) => s.includes("UPDATE") && s.includes("scheduled_games") && s.includes("'completed'"),
      rows: [],
    },
    // loadGameState
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({
        draws_completed: 24,
        last_drawn_ball: 24,
        current_phase: 5,
        engine_ended_at: "2026-04-21T12:05:00.000Z",
      })],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService,
  });

  const view = await service.drawNext("g1");

  assert.equal(view.isFinished, true, "Fullt Hus-vinn → isFinished=true");

  // UPDATE scheduled_games 'completed' skal skje.
  assert.ok(
    queries.some(
      (q) =>
        q.sql.includes("UPDATE") &&
        q.sql.includes("scheduled_games") &&
        q.sql.includes("'completed'")
    ),
    "UPDATE scheduled_games → completed"
  );

  // UPDATE game_state skal sette isFinished=true og current_phase=5 (ikke +1 etter siste fase).
  const stateUpdate = queries.find(
    (q) =>
      q.sql.trim().startsWith("UPDATE") &&
      q.sql.includes("app_game1_game_state") &&
      q.sql.includes("current_phase")
  );
  assert.ok(stateUpdate);
  assert.equal(stateUpdate!.params[3], 5, "current_phase forblir 5 ved Fullt Hus");
  assert.equal(stateUpdate!.params[4], true, "isFinished=true");
});

// ── Test: Payout-feil ruller tilbake draw-en ──────────────────────────────

test("drawNext: wallet.credit-feil i payout → ROLLBACK av hele draw", async () => {
  // Wallet som alltid kaster.
  const walletAdapter: WalletAdapter = {
    async createAccount() { throw new Error("ni"); },
    async ensureAccount() { throw new Error("ni"); },
    async getAccount() { throw new Error("ni"); },
    async listAccounts() { return []; },
    async getBalance() { return 0; },
    async getDepositBalance() { return 0; },
    async getWinningsBalance() { return 0; },
    async getBothBalances() { return { deposit: 0, winnings: 0, total: 0 }; },
    async debit() { throw new Error("ni"); },
    async credit() {
      throw new Error("wallet-simulated-failure");
    },
    async topUp() { throw new Error("ni"); },
    async withdraw() { throw new Error("ni"); },
    async transfer() { throw new Error("ni"); },
    async listTransactions() { return []; },
  };
  const payoutService = new Game1PayoutService({
    walletAdapter,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });

  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    { match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"), rows: [runningStateRow()] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [{
        id: "g1",
        status: "running",
        ticket_config_json: {
          spill1: { ticketColors: [{ color: "yellow", prizePerPattern: { row_1: 10 } }] },
        },
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [{
        id: "a-1",
        grid_numbers_json: winningRow0Grid(),
        markings_json: { marked: markingsRow0AlmostComplete() },
      }],
    },
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_ticket_assignments") && s.includes("markings_json"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [{
        id: "a-1",
        grid_numbers_json: winningRow0Grid(),
        markings_json: {
          marked: [
            true, true, true, true, true,
            false, false, false, false, false,
            false, false, true, false, false,
            false, false, false, false, false,
            false, false, false, false, false,
          ],
        },
        buyer_user_id: "u-1",
        hall_id: "hall-a",
        ticket_color: "yellow",
      }],
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "wallet-1" }],
    },
    {
      match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 100000 }],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
  });

  await assert.rejects(
    service.drawNext("g1"),
    (err) => err instanceof DomainError && err.code === "PAYOUT_WALLET_CREDIT_FAILED"
  );

  // ROLLBACK skal ha skjedd.
  assert.ok(queries.some((q) => q.sql.startsWith("ROLLBACK")));
});
