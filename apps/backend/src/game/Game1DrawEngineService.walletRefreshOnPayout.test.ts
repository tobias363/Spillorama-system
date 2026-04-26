/**
 * W1-HOTFIX (Tobias 2026-04-26): Verifiserer at `drawNext()` POST-commit
 * kaller `BingoEngine.refreshPlayerBalancesForWallet` for hver vinner-wallet
 * FØR `notifyPlayerRoomUpdate` slik at `room:update`-snapshot inneholder
 * oppdatert balance.
 *
 * Bug-rapport: «Etter man har vunnet 1 gang oppdaterer gevinsten seg.
 * Men gang nr 2 så oppdater ikke gevinst kontoen seg.»
 *
 * Root-cause (per WALLET_DEEP_REVIEW_2026-04-26.md §1.3):
 *   - `Game1PayoutService.payoutPhase` krediterer wallet i DB men oppdaterte
 *     ALDRI in-memory `Player.balance` i BingoEngine-rommet.
 *   - `room:update`-snapshot bygges fra in-memory state → stale balance.
 *   - `GameBridge.lastEmittedBalance`-dedup blokkerer broadcast når server
 *     pusher samme stale verdi 2 ganger.
 *   - Round 1 funket pga `gameEnded`-refetch-race; round 2 mistet race-en.
 *
 * Fix (denne testen verifiserer):
 *   - `evaluateAndPayoutPhase` returnerer `winnerWalletIds` (deduped wallet-IDer).
 *   - `drawNext()` POST-commit kaller `bingoEngine.refreshPlayerBalancesForWallet`
 *     for hver winner-wallet FØR `notifyPlayerRoomUpdate`.
 *   - Fail-closed: en refresh-feil ruller IKKE tilbake noe (payout er allerede
 *     committed); refresh-feilen logges men kaster ikke.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1DrawEngineService } from "./Game1DrawEngineService.js";
import { Game1PayoutService } from "./Game1PayoutService.js";
import { Game1JackpotService } from "./Game1JackpotService.js";
import type { BingoEngine } from "./BingoEngine.js";
import type { Game1PlayerBroadcaster } from "./Game1PlayerBroadcaster.js";
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
}

function createStubPool(responses: StubResponse[]) {
  const queue = responses.slice();
  const queries: RecordedQuery[] = [];
  const runQuery = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i]!;
      if (r.match(sql, params)) {
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

/**
 * Minimal BingoEngine-stub som kun trenger `refreshPlayerBalancesForWallet`
 * + `destroyRoom`. Fanger anrop-rekkefølgen så testen kan asserte at refresh
 * skjer FØR room:update push.
 */
type CallLog = Array<{ kind: "refresh" | "roomUpdate"; walletId?: string }>;

function makeFakeBingoEngine(opts: { throwOnRefresh?: boolean } = {}): {
  engine: BingoEngine;
  refreshCalls: string[];
} {
  const refreshCalls: string[] = [];
  const engine = {
    async refreshPlayerBalancesForWallet(walletId: string): Promise<string[]> {
      refreshCalls.push(walletId);
      if (opts.throwOnRefresh) {
        throw new Error("simulated refresh failure");
      }
      return [];
    },
    destroyRoom() {
      // Ikke relevant for denne testen
    },
  } as unknown as BingoEngine;
  return { engine, refreshCalls };
}

/**
 * Player-broadcaster som logger til en delt callLog så testen kan verifisere
 * at refresh-anrop kommer FØR onRoomUpdate.
 */
function makeOrderTrackingBroadcaster(callLog: CallLog): Game1PlayerBroadcaster {
  return {
    onDrawNew: () => undefined,
    onPatternWon: () => undefined,
    onRoomUpdate: (roomCode: string) => {
      callLog.push({ kind: "roomUpdate" });
      void roomCode;
    },
  };
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
    true, true, true, true, false,
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

function buildPhase1WinResponses(opts: {
  walletIdForBuyer: string;
  buyerUserId: string;
  ticketColor: string;
} = { walletIdForBuyer: "wallet-1", buyerUserId: "u-1", ticketColor: "small_yellow" }) {
  return [
    { match: (s: string) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s: string) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s: string) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "running",
          ticket_config_json: {
            spill1: {
              ticketColors: [
                {
                  color: opts.ticketColor,
                  prizePerPattern: { row_1: 10, row_2: 20, row_3: 25, row_4: 25, full_house: 20 },
                },
              ],
            },
          },
        },
      ],
    },
    { match: (s: string) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s: string) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("FOR UPDATE"),
      rows: [{
        id: "a-1",
        grid_numbers_json: winningRow0Grid(),
        markings_json: { marked: markingsRow0AlmostComplete() },
      }],
    },
    {
      match: (s: string) =>
        s.trim().startsWith("UPDATE") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("markings_json"),
      rows: [],
    },
    {
      match: (s: string) =>
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
        buyer_user_id: opts.buyerUserId,
        hall_id: "hall-a",
        ticket_color: opts.ticketColor,
      }],
    },
    {
      match: (s: string) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: opts.walletIdForBuyer }],
    },
    {
      match: (s: string) =>
        s.includes("COALESCE(SUM(total_amount_cents)") &&
        s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 100000 }], // 1000 kr pot
    },
    {
      match: (s: string) =>
        s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"),
      rows: [],
    },
    {
      match: (s: string) =>
        s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s: string) =>
        s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({
        draws_completed: 1,
        last_drawn_ball: 5,
        current_phase: 2,
      })],
    },
    {
      match: (s: string) =>
        s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [{ draw_sequence: 1, ball_value: 5, drawn_at: "2026-04-21T12:01:00.000Z" }],
    },
    { match: (s: string) => s.startsWith("COMMIT"), rows: [] },
  ];
}

// ── Test 1: Refresh kalt etter payout, før room:update ────────────────────

test(
  "W1-hotfix: drawNext POST-commit kaller refreshPlayerBalancesForWallet for hver vinner-wallet FØR notifyPlayerRoomUpdate",
  async () => {
    const { adapter: wallet } = makeFakeWallet();
    const payoutService = new Game1PayoutService({
      walletAdapter: wallet,
      auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    });
    const jackpotService = new Game1JackpotService();
    const { engine: bingoEngine, refreshCalls } = makeFakeBingoEngine();

    // Order-tracking: vi pusher refresh-anrop og roomUpdate-anrop til samme
    // log slik at vi kan asserte rekkefølgen.
    const callLog: CallLog = [];
    // Wrap refreshPlayerBalancesForWallet til å logge i felles callLog.
    const originalRefresh = bingoEngine.refreshPlayerBalancesForWallet.bind(bingoEngine);
    bingoEngine.refreshPlayerBalancesForWallet = async (walletId: string) => {
      callLog.push({ kind: "refresh", walletId });
      return originalRefresh(walletId);
    };

    const broadcaster = makeOrderTrackingBroadcaster(callLog);

    const { pool } = createStubPool(buildPhase1WinResponses());

    const service = new Game1DrawEngineService({
      pool: pool as never,
      ticketPurchaseService: makeFakeTicketPurchase(),
      auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
      payoutService,
      jackpotService,
      bingoEngine,
      playerBroadcaster: broadcaster,
    });

    // Sett room_code i scheduled_game-rad slik at notifyPlayerRoomUpdate
    // faktisk fyrer (er gated på capturedRoomCode != null).
    // Re-sett pool med oppdatert scheduled_games-rad for å inkludere room_code.
    const { pool: poolWithRoomCode } = createStubPool([
      { match: (s: string) => s.startsWith("BEGIN"), rows: [] },
      {
        match: (s: string) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
        rows: [runningStateRow()],
      },
      {
        match: (s: string) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
        rows: [
          {
            id: "g1",
            status: "running",
            room_code: "ROOM-1",
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
      { match: (s: string) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
      {
        match: (s: string) =>
          s.includes("FROM") &&
          s.includes("app_game1_ticket_assignments") &&
          s.includes("FOR UPDATE"),
        rows: [{
          id: "a-1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: markingsRow0AlmostComplete() },
        }],
      },
      {
        match: (s: string) =>
          s.trim().startsWith("UPDATE") &&
          s.includes("app_game1_ticket_assignments") &&
          s.includes("markings_json"),
        rows: [],
      },
      {
        match: (s: string) =>
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
          ticket_color: "small_yellow",
        }],
      },
      {
        match: (s: string) => s.includes("wallet_id") && s.includes("app_users"),
        rows: [{ wallet_id: "wallet-1" }],
      },
      {
        match: (s: string) =>
          s.includes("COALESCE(SUM(total_amount_cents)") &&
          s.includes("app_game1_ticket_purchases"),
        rows: [{ pot_cents: 100000 }],
      },
      {
        match: (s: string) =>
          s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"),
        rows: [],
      },
      {
        match: (s: string) =>
          s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
        rows: [],
      },
      {
        match: (s: string) =>
          s.includes("SELECT") && s.includes("app_game1_game_state"),
        rows: [runningStateRow({
          draws_completed: 1,
          last_drawn_ball: 5,
          current_phase: 2,
        })],
      },
      {
        match: (s: string) =>
          s.includes("FROM") && s.includes("app_game1_draws"),
        rows: [{ draw_sequence: 1, ball_value: 5, drawn_at: "2026-04-21T12:01:00.000Z" }],
      },
      { match: (s: string) => s.startsWith("COMMIT"), rows: [] },
    ]);

    const service2 = new Game1DrawEngineService({
      pool: poolWithRoomCode as never,
      ticketPurchaseService: makeFakeTicketPurchase(),
      auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
      payoutService,
      jackpotService,
      bingoEngine,
      playerBroadcaster: broadcaster,
    });
    void service; // unused — service2 har room_code wired

    await service2.drawNext("g1");

    // Refresh skal være kalt for vinner-wallet "wallet-1".
    assert.deepEqual(refreshCalls, ["wallet-1"]);

    // Refresh-anropet MÅ komme FØR roomUpdate-anropet (W1-hotfix-kjernefix).
    const refreshIdx = callLog.findIndex(
      (c) => c.kind === "refresh" && c.walletId === "wallet-1"
    );
    const roomUpdateIdx = callLog.findIndex((c) => c.kind === "roomUpdate");
    assert.ok(refreshIdx >= 0, "refreshPlayerBalancesForWallet skal være kalt");
    assert.ok(roomUpdateIdx >= 0, "onRoomUpdate skal være kalt");
    assert.ok(
      refreshIdx < roomUpdateIdx,
      `refresh (idx=${refreshIdx}) MÅ skje før roomUpdate (idx=${roomUpdateIdx}) — ellers er snapshot stale`
    );
  }
);

// ── Test 2: To sekvensielle vinn (reproduserer 2.-vinn-bug) ──────────────

test(
  "W1-hotfix: 2 sekvensielle wins (round 1 + round 2) refresher balanse begge ganger",
  async () => {
    const { adapter: wallet } = makeFakeWallet();
    const payoutService = new Game1PayoutService({
      walletAdapter: wallet,
      auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    });
    const jackpotService = new Game1JackpotService();
    const { engine: bingoEngine, refreshCalls } = makeFakeBingoEngine();

    // Round 1: build full response sett.
    const round1Responses = buildPhase1WinResponses().map((r) => {
      // Inject room_code i scheduled_games-rad.
      if (
        r === buildPhase1WinResponses()[2] // index 2 = scheduled_games match
      ) {
        return r;
      }
      return r;
    });
    const round1WithRoom: StubResponse[] = round1Responses.map((r, i) => {
      if (i === 2) {
        return {
          ...r,
          rows: [
            {
              id: "g1",
              status: "running",
              room_code: "ROOM-1",
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
        };
      }
      return r;
    });

    const { pool } = createStubPool(round1WithRoom);
    const broadcaster: Game1PlayerBroadcaster = {
      onDrawNew: () => undefined,
      onPatternWon: () => undefined,
      onRoomUpdate: () => undefined,
    };
    const service = new Game1DrawEngineService({
      pool: pool as never,
      ticketPurchaseService: makeFakeTicketPurchase(),
      auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
      payoutService,
      jackpotService,
      bingoEngine,
      playerBroadcaster: broadcaster,
    });

    // Round 1
    await service.drawNext("g1");
    const refreshCallsAfterRound1 = [...refreshCalls];

    // Round 2: ny pool-instans med samme stubs (simulerer ny scheduled-game
    // eller resumed runde).
    const round2WithRoom: StubResponse[] = round1WithRoom.map((r) => ({ ...r }));
    const { pool: pool2 } = createStubPool(round2WithRoom);
    const service2 = new Game1DrawEngineService({
      pool: pool2 as never,
      ticketPurchaseService: makeFakeTicketPurchase(),
      auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
      payoutService,
      jackpotService,
      bingoEngine, // SAMME engine-instans — viktig for å verifisere at refresh fyrer hver gang
      playerBroadcaster: broadcaster,
    });
    await service2.drawNext("g1");

    // PRE-FIX-OPPFØRSEL (uten W1-hotfix): refreshCalls.length === 0 etter
    // begge rundene fordi refresh aldri ble kalt.
    // POST-FIX-OPPFØRSEL: refreshCalls.length === 2 (én per runde).
    assert.equal(
      refreshCallsAfterRound1.length,
      1,
      "Round 1 skal trigge refresh"
    );
    assert.equal(
      refreshCalls.length,
      2,
      "Round 2 skal trigge refresh ENDA EN GANG (kjernefix mot 2.-vinn-bug)"
    );
    assert.deepEqual(
      refreshCalls,
      ["wallet-1", "wallet-1"],
      "Begge rundene skal refresh-e samme vinner-wallet"
    );
  }
);

// ── Test 3: Refresh-feil ruller IKKE tilbake payout ───────────────────────

test(
  "W1-hotfix: refresh-feil etter payout ruller IKKE tilbake (fail-closed: payout er allerede committed)",
  async () => {
    const { adapter: wallet, credits } = makeFakeWallet();
    const payoutService = new Game1PayoutService({
      walletAdapter: wallet,
      auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    });
    const jackpotService = new Game1JackpotService();
    const { engine: bingoEngine } = makeFakeBingoEngine({ throwOnRefresh: true });

    const responses = buildPhase1WinResponses();
    const responsesWithRoom: StubResponse[] = responses.map((r, i) => {
      if (i === 2) {
        return {
          ...r,
          rows: [
            {
              id: "g1",
              status: "running",
              room_code: "ROOM-1",
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
        };
      }
      return r;
    });
    const { pool } = createStubPool(responsesWithRoom);

    const service = new Game1DrawEngineService({
      pool: pool as never,
      ticketPurchaseService: makeFakeTicketPurchase(),
      auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
      payoutService,
      jackpotService,
      bingoEngine,
      playerBroadcaster: {
        onDrawNew: () => undefined,
        onPatternWon: () => undefined,
        onRoomUpdate: () => undefined,
      },
    });

    // drawNext skal IKKE kaste selv om refresh kaster.
    const view = await service.drawNext("g1");

    // Wallet.credit gikk gjennom (payout committed).
    assert.equal(credits.length, 1);
    assert.equal(credits[0]!.amount, 100);
    // Draw progressed.
    assert.equal(view.drawsCompleted, 1);
  }
);
