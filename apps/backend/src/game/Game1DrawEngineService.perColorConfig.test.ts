/**
 * Scheduler-config-kobling: per-farge-payout i Game1DrawEngineService.
 *
 * Testene verifiserer at `evaluateAndPayoutPhase` bygger per-farge
 * variantConfig fra `scheduled_games.game_config_json` (kopiert av
 * scheduler fra `GameManagement.config_json`) og gruppererer vinnere per
 * ticketColor når per-farge-matrise finnes.
 *
 * Dekker:
 *   1. Per-farge fixed-beløp: to vinnere med ulike farger får ulike
 *      premier (Option X).
 *   2. Fallback: game_config_json=null → flat-path (dagens atferd).
 *   3. Bug 2-fix: multi-winner flat-path evaluerer jackpot per vinners
 *      egen ticketColor.
 *
 * Spec: docs/architecture/spill1-variantconfig-admin-coupling.md
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1DrawEngineService } from "./Game1DrawEngineService.js";
import { Game1PayoutService } from "./Game1PayoutService.js";
import { Game1JackpotService } from "./Game1JackpotService.js";
import type { WalletAdapter, WalletTransaction } from "../adapters/WalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type { Game1TicketPurchaseService } from "./Game1TicketPurchaseService.js";

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

function makeFakeWallet(): {
  adapter: WalletAdapter;
  credits: Array<{ accountId: string; amount: number; idempotencyKey?: string }>;
} {
  const credits: Array<{ accountId: string; amount: number; idempotencyKey?: string }> = [];
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
      credits.push({ accountId, amount, idempotencyKey: options?.idempotencyKey });
      const tx: WalletTransaction = {
        id: `wtx-${++txCounter}`, accountId, type: "CREDIT", amount, reason,
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function winningRow0Grid(): Array<number | null> {
  return [
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ];
}

function fullyMarked(): boolean[] {
  const arr = Array(25).fill(true);
  return arr;
}

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

// ── Test 1: Per-farge fixed-beløp — to vinnere, ulike premier ─────────────

test("perColorConfig: game_config_json med spill1.ticketColors → per-farge fixed-premier", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const gameConfigJson = {
    spill1: {
      ticketColors: [
        {
          color: "small_white",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            full_house: { mode: "fixed", amount: 1000 },
          },
        },
        {
          color: "small_yellow",
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 50 },
            full_house: { mode: "fixed", amount: 500 },
          },
        },
      ],
    },
  };

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    // loadScheduledGameForUpdate med game_config_json.
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [{
        id: "g1",
        status: "running",
        ticket_config_json: {},
        game_config_json: gameConfigJson,
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [
        { id: "a-alice", grid_numbers_json: winningRow0Grid(), markings_json: { marked: allRow0Marked() } },
        { id: "a-bob", grid_numbers_json: winningRow0Grid(), markings_json: { marked: allRow0Marked() } },
      ],
    },
    // markBallOnAssignments UPDATE (per row)
    { match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_ticket_assignments") && s.includes("markings_json"), rows: [], once: false },
    // evaluateAndPayoutPhase SELECT — Alice=white, Bob=yellow.
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [
        {
          id: "a-alice", grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-alice", hall_id: "hall-a", ticket_color: "small_white",
        },
        {
          id: "a-bob", grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-bob", hall_id: "hall-a", ticket_color: "small_yellow",
        },
      ],
    },
    // resolveWalletIdForUser — for begge vinnere.
    { match: (s) => s.includes("wallet_id") && s.includes("app_users"), rows: [{ wallet_id: "w-alice" }], once: true },
    { match: (s) => s.includes("wallet_id") && s.includes("app_users"), rows: [{ wallet_id: "w-bob" }], once: true },
    // computePotCents.
    { match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"), rows: [{ pot_cents: 0 }] },
    // phase_winners INSERT (to ganger, én per vinner).
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"), rows: [], once: false },
    // UPDATE game_state.
    { match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"), rows: [] },
    // loadGameState.
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 5, current_phase: 2 })],
    },
    // loadDrawsInOrder.
    { match: (s) => s.includes("FROM") && s.includes("app_game1_draws"), rows: [{ draw_sequence: 1, ball_value: 5, drawn_at: "2026-04-21T12:01:00.000Z" }] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService,
  });

  await service.drawNext("g1");

  // Alice (white) = 100 kr, Bob (yellow) = 50 kr.
  assert.equal(credits.length, 2, "to vinnere → to wallet-credit-kall");
  const alice = credits.find((c) => c.accountId === "w-alice");
  const bob = credits.find((c) => c.accountId === "w-bob");
  assert.ok(alice, "Alice skal ha credit");
  assert.ok(bob, "Bob skal ha credit");
  assert.equal(alice!.amount, 100, "Alice (small_white) → 100 kr per farge-matrise");
  assert.equal(bob!.amount, 50, "Bob (small_yellow) → 50 kr per farge-matrise");
});

// ── Test 2: Bakoverkompat — game_config_json=null → flat-path ──────────

test("perColorConfig: game_config_json=null → flat-path (dagens atferd uendret)", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    { match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"), rows: [runningStateRow()] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [{
        id: "g1",
        status: "running",
        ticket_config_json: {
          spill1: {
            ticketColors: [{ color: "small_yellow", prizePerPattern: { row_1: 10 } }],
          },
        },
        game_config_json: null, // Legacy scheduled_game uten config-kobling.
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [{ id: "a-1", grid_numbers_json: winningRow0Grid(), markings_json: { marked: allRow0Marked() } }],
    },
    { match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_ticket_assignments") && s.includes("markings_json"), rows: [] },
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [{
        id: "a-1", grid_numbers_json: winningRow0Grid(),
        markings_json: { marked: allRow0Marked() },
        buyer_user_id: "u-1", hall_id: "hall-a", ticket_color: "small_yellow",
      }],
    },
    { match: (s) => s.includes("wallet_id") && s.includes("app_users"), rows: [{ wallet_id: "w-1" }] },
    { match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"), rows: [{ pot_cents: 100000 }] },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"), rows: [] },
    { match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"), rows: [] },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 5, current_phase: 2 })],
    },
    { match: (s) => s.includes("FROM") && s.includes("app_game1_draws"), rows: [{ draw_sequence: 1, ball_value: 5, drawn_at: "2026-04-21T12:01:00.000Z" }] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService,
  });

  await service.drawNext("g1");

  // Flat-path: 1000 kr (pot) × 10% = 100 kr.
  assert.equal(credits.length, 1);
  assert.equal(credits[0]!.amount, 100, "flat-path → 10% av 1000 kr = 100 kr");
});

// ── Test 3: Bug 2-fix i flat-path — per-vinner jackpot-routing ───────

test("perColorConfig / Bug 2: flat-path Fullt Hus med multi-color winners → per-vinner jackpot", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const fullGrid: Array<number | null> = [];
  for (let i = 0; i < 25; i++) fullGrid.push(i === 12 ? 0 : i + 1);

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow({
        current_phase: 5,
        draws_completed: 39,
        draw_bag_json: Array.from({ length: 60 }, (_, i) => i + 1),
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
              prizeByColor: { yellow: 10000, white: 3000 },
              draw: 50,
            },
          },
        },
        game_config_json: null, // flat-path
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [
        { id: "a-alice", grid_numbers_json: fullGrid, markings_json: { marked: fullyMarked() } },
        { id: "a-bob", grid_numbers_json: fullGrid, markings_json: { marked: fullyMarked() } },
      ],
    },
    { match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_ticket_assignments") && s.includes("markings_json"), rows: [], once: false },
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [
        {
          id: "a-alice", grid_numbers_json: fullGrid,
          markings_json: { marked: fullyMarked() },
          buyer_user_id: "u-alice", hall_id: "hall-a", ticket_color: "small_yellow",
        },
        {
          id: "a-bob", grid_numbers_json: fullGrid,
          markings_json: { marked: fullyMarked() },
          buyer_user_id: "u-bob", hall_id: "hall-a", ticket_color: "small_white",
        },
      ],
    },
    { match: (s) => s.includes("wallet_id") && s.includes("app_users"), rows: [{ wallet_id: "w-alice" }], once: true },
    { match: (s) => s.includes("wallet_id") && s.includes("app_users"), rows: [{ wallet_id: "w-bob" }], once: true },
    { match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"), rows: [{ pot_cents: 200000 }] },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"), rows: [], once: false },
    { match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"), rows: [] },
    { match: (s) => s.includes("UPDATE") && s.includes("scheduled_games") && s.includes("'completed'"), rows: [] },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({ draws_completed: 40, last_drawn_ball: 40, current_phase: 5, engine_ended_at: "x" })],
    },
    { match: (s) => s.includes("FROM") && s.includes("app_game1_draws"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService,
  });

  await service.drawNext("g1");

  // Flat-path: 200000 cents (2000 kr) × 20% = 40000 cents = 400 kr.
  // Split 400 / 2 = 200 kr hver (flat-path semantikk).
  //
  // Bug 2-fix: hver vinner får sin EGEN jackpot-farge:
  //   Alice (small_yellow) → family "yellow" → 10000 kr.
  //   Bob   (small_white)  → family "white"  →  3000 kr.
  //
  // Alice credit = 200 + 10000 = 10200 kr.
  // Bob   credit = 200 +  3000 =  3200 kr.
  assert.equal(credits.length, 2, "begge vinnere får hver sin credit");
  const alice = credits.find((c) => c.accountId === "w-alice");
  const bob = credits.find((c) => c.accountId === "w-bob");
  assert.ok(alice);
  assert.ok(bob);
  assert.equal(alice!.amount, 10200, "Alice får split-andel + yellow jackpot (10000)");
  assert.equal(
    bob!.amount, 3200,
    "Bob får split-andel + EGEN white jackpot (3000), IKKE Alice's yellow (10000)"
  );
});
