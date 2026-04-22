/**
 * PT4: Integrasjonstest for drawNext() + fysisk-bong-evaluering.
 *
 * Verifiserer at drawNext:
 *   - Leser `app_static_tickets` med `sold_to_scheduled_game_id = <game>` OG
 *     `is_purchased = true` OG `paid_out_at IS NULL` for aktuelle fase-evaluering
 *   - Bygger markings fra trukne kuler (ikke markings_json, siden fysisk har
 *     ikke den kolonnen)
 *   - Kaller `physicalTicketPayoutService.createPendingPayout` ved match
 *   - Broadcaster `onPhysicalTicketWon` POST-commit
 *   - Digital + fysisk bong kan vinne samme fase (digital auto-payout,
 *     fysisk pending)
 *   - Fysisk bong uten sold_to_scheduled_game_id evalueres IKKE (hvis ikke
 *     is_purchased = true OR sold_to_scheduled_game_id != gameId)
 *   - Admin-approval-flagg reflekteres i broadcast-event
 *   - Flere fysiske bonger samme fase → alle får pending-rows + broadcasts
 *   - Uten physicalTicketPayoutService wired opp → ingen fysisk-evaluering
 *     (bakoverkompat, ingen krasj)
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
import type {
  PhysicalTicketPayoutService,
  CreatePendingPayoutInput,
  PhysicalTicketPendingPayout,
} from "../compliance/PhysicalTicketPayoutService.js";
import {
  NoopAdminGame1Broadcaster,
  type AdminGame1Broadcaster,
  type AdminGame1PhysicalTicketWonEvent,
} from "./AdminGame1Broadcaster.js";

// ── Stubs (kopier fra payoutWire.test.ts) ──────────────────────────────────

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

function makeFakeWallet(): { adapter: WalletAdapter; credits: unknown[] } {
  const credits: unknown[] = [];
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
 * Fake PhysicalTicketPayoutService — fanger alle createPendingPayout-kall.
 * Returnerer stabile pending-payout-data slik at drawNext kan forwarde til
 * broadcast.
 */
interface FakePayoutCapture {
  inputs: CreatePendingPayoutInput[];
  pendingCounter: number;
}
function makeFakePhysicalPayout(): {
  service: PhysicalTicketPayoutService;
  capture: FakePayoutCapture;
} {
  const capture: FakePayoutCapture = {
    inputs: [],
    pendingCounter: 0,
  };
  const svc = {
    async createPendingPayout(
      input: CreatePendingPayoutInput,
    ): Promise<PhysicalTicketPendingPayout> {
      capture.inputs.push(input);
      capture.pendingCounter += 1;
      return {
        id: `pp-${capture.pendingCounter}`,
        ticketId: input.ticketId,
        hallId: input.hallId,
        scheduledGameId: input.scheduledGameId,
        patternPhase: input.patternPhase,
        expectedPayoutCents: input.expectedPayoutCents,
        responsibleUserId: input.responsibleUserId,
        color: input.color,
        detectedAt: new Date().toISOString(),
        verifiedAt: null,
        verifiedByUserId: null,
        paidOutAt: null,
        paidOutByUserId: null,
        adminApprovalRequired: input.expectedPayoutCents >= 500_000,
        adminApprovedAt: null,
        adminApprovedByUserId: null,
        rejectedAt: null,
        rejectedByUserId: null,
        rejectedReason: null,
      };
    },
  } as unknown as PhysicalTicketPayoutService;
  return { service: svc, capture };
}

/** 5x5 grid: rad 0 = [1,2,3,4,5], rest tilfeldig. */
function winningRow0Grid(): number[] {
  return [
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14, // 0 = free centre
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
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
 * Standard ticket_config_json: fase 1 gir 10% av pot.
 */
function standardTicketConfig() {
  return {
    spill1: {
      ticketColors: [
        {
          color: "small_yellow",
          prizePerPattern: {
            row_1: 10, row_2: 20, row_3: 25, row_4: 25, full_house: 20,
          },
        },
      ],
    },
  };
}

/**
 * Bygger "almost complete" markings: rad 0 har 4/5 satt. Ball=5 fullfører.
 */
function markingsRow0AlmostComplete(): boolean[] {
  return [
    true, true, true, true, false,
    false, false, false, false, false,
    false, false, true, false, false,
    false, false, false, false, false,
    false, false, false, false, false,
  ];
}

function recordingBroadcaster(): {
  broadcaster: AdminGame1Broadcaster;
  physicalEvents: AdminGame1PhysicalTicketWonEvent[];
} {
  const physicalEvents: AdminGame1PhysicalTicketWonEvent[] = [];
  const broadcaster: AdminGame1Broadcaster = {
    ...NoopAdminGame1Broadcaster,
    onPhysicalTicketWon: (e) => physicalEvents.push(e),
  };
  return { broadcaster, physicalEvents };
}

// ── Test 1: Digital + fysisk vinner samme fase ────────────────────────────

test("PT4: digital og fysisk bong vinner begge fase 1 — digital payout + fysisk pending", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();
  const { service: physSvc, capture: physCapture } = makeFakePhysicalPayout();
  const { broadcaster, physicalEvents } = recordingBroadcaster();

  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [{
        id: "g1",
        status: "running",
        ticket_config_json: standardTicketConfig(),
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
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_ticket_assignments"),
      rows: [],
    },
    // evaluateAndPayoutPhase: first SELECT av fysiske bonger (kommer før digital)
    {
      match: (s) => s.includes("sold_to_scheduled_game_id = $1") && s.includes("is_purchased = true"),
      rows: [{
        id: "st-phys-1",
        ticket_serial: "100-1001",
        hall_id: "hall-a",
        ticket_color: "small",
        card_matrix: winningRow0Grid(),
        responsible_user_id: "op-a",
        sold_by_user_id: "op-a",
        paid_out_at: null,
      }],
    },
    // SELECT drawn balls (for markings-bygging på fysisk bong)
    {
      match: (s) => s.includes("SELECT ball_value") && s.includes("app_game1_draws"),
      rows: [{ ball_value: 1 }, { ball_value: 2 }, { ball_value: 3 }, { ball_value: 4 }, { ball_value: 5 }],
    },
    // computePotCents (fysisk path — brukes for expected-payout-beregning)
    {
      match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 100000 }],
    },
    // Digital-path: SELECT alle assignments
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id"),
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
    // resolveWalletIdForUser
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "wallet-1" }],
    },
    // computePotCents (digital-path)
    {
      match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 100000 }],
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
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws") && s.includes("draw_sequence"),
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
    physicalTicketPayoutService: physSvc,
    adminBroadcaster: broadcaster,
  });

  const view = await service.drawNext("g1");
  assert.equal(view.drawsCompleted, 1);

  // Digital wallet.credit kjørt
  assert.equal(credits.length, 1, "digital vinner kreditert");

  // Fysisk pending opprettet
  assert.equal(physCapture.inputs.length, 1, "én fysisk pending-row opprettet");
  assert.equal(physCapture.inputs[0]!.ticketId, "100-1001");
  assert.equal(physCapture.inputs[0]!.patternPhase, "row_1");
  assert.equal(physCapture.inputs[0]!.color, "small");
  assert.equal(physCapture.inputs[0]!.hallId, "hall-a");
  assert.equal(physCapture.inputs[0]!.responsibleUserId, "op-a");

  // Broadcast sendt POST-commit
  assert.equal(physicalEvents.length, 1);
  assert.equal(physicalEvents[0]!.ticketId, "100-1001");
  assert.equal(physicalEvents[0]!.pendingPayoutId, "pp-1");
  assert.equal(physicalEvents[0]!.phase, 1);
  assert.equal(physicalEvents[0]!.adminApprovalRequired, false);

  // Verifisering: static-select-query inneholder WHERE sold_to_scheduled_game_id
  const physicalSelectQuery = queries.find(
    (q) => q.sql.includes("sold_to_scheduled_game_id = $1")
      && q.sql.includes("is_purchased = true")
  );
  assert.ok(physicalSelectQuery, "physical select query utført");
  assert.equal(physicalSelectQuery.params[0], "g1");
});

// ── Test 2: Kun fysisk vinner (ingen digital) ──────────────────────────────

test("PT4: kun fysisk bong vinner — ingen digital assignments returnerer phaseWon=false men fysisk broadcast likevel", async () => {
  const { adapter: wallet } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();
  const { service: physSvc, capture: physCapture } = makeFakePhysicalPayout();
  const { broadcaster, physicalEvents } = recordingBroadcaster();

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [{
        id: "g1",
        status: "running",
        ticket_config_json: standardTicketConfig(),
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    // markBall assignments — tom
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [],
    },
    // Physical select: én bong som vinner
    {
      match: (s) => s.includes("sold_to_scheduled_game_id = $1") && s.includes("is_purchased = true"),
      rows: [{
        id: "st-phys-1",
        ticket_serial: "200-2001",
        hall_id: "hall-b",
        ticket_color: "large",
        card_matrix: winningRow0Grid(),
        responsible_user_id: "op-b",
        sold_by_user_id: "op-b",
        paid_out_at: null,
      }],
    },
    // Drawn balls
    {
      match: (s) => s.includes("SELECT ball_value") && s.includes("app_game1_draws"),
      rows: [{ ball_value: 1 }, { ball_value: 2 }, { ball_value: 3 }, { ball_value: 4 }, { ball_value: 5 }],
    },
    // computePotCents (brukes i evaluatePhysicalTickets)
    {
      match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 100000 }],
    },
    // Digital-path: SELECT assignments — tom (ingen digital bong)
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id"),
      rows: [],
    },
    // UPDATE game_state
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    // loadGameState
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 5 })],
    },
    // loadDrawsInOrder
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws") && s.includes("draw_sequence"),
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
    physicalTicketPayoutService: physSvc,
    adminBroadcaster: broadcaster,
  });

  await service.drawNext("g1");

  assert.equal(physCapture.inputs.length, 1, "fysisk pending-row opprettet selv uten digital");
  assert.equal(physicalEvents.length, 1);
  assert.equal(physicalEvents[0]!.ticketId, "200-2001");
  assert.equal(physicalEvents[0]!.hallId, "hall-b");
});

// ── Test 3: Flere fysiske bonger samme fase ────────────────────────────────

test("PT4: flere fysiske bonger vinner samme fase — alle får pending-rows + broadcasts", async () => {
  const { adapter: wallet } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();
  const { service: physSvc, capture: physCapture } = makeFakePhysicalPayout();
  const { broadcaster, physicalEvents } = recordingBroadcaster();

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [{
        id: "g1",
        status: "running",
        ticket_config_json: standardTicketConfig(),
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [],
    },
    // 3 fysiske bonger, alle med vinner-grid
    {
      match: (s) => s.includes("sold_to_scheduled_game_id = $1") && s.includes("is_purchased = true"),
      rows: [
        {
          id: "st-1",
          ticket_serial: "100-1001",
          hall_id: "hall-a",
          ticket_color: "small",
          card_matrix: winningRow0Grid(),
          responsible_user_id: "op-a",
          sold_by_user_id: "op-a",
          paid_out_at: null,
        },
        {
          id: "st-2",
          ticket_serial: "100-1002",
          hall_id: "hall-a",
          ticket_color: "small",
          card_matrix: winningRow0Grid(),
          responsible_user_id: "op-a",
          sold_by_user_id: "op-a",
          paid_out_at: null,
        },
        {
          id: "st-3",
          ticket_serial: "200-2001",
          hall_id: "hall-a",
          ticket_color: "large",
          card_matrix: winningRow0Grid(),
          responsible_user_id: "op-b",
          sold_by_user_id: "op-b",
          paid_out_at: null,
        },
      ],
    },
    {
      match: (s) => s.includes("SELECT ball_value") && s.includes("app_game1_draws"),
      rows: [{ ball_value: 1 }, { ball_value: 2 }, { ball_value: 3 }, { ball_value: 4 }, { ball_value: 5 }],
    },
    {
      match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 100000 }],
    },
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id"),
      rows: [],
    },
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 5 })],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws") && s.includes("draw_sequence"),
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
    physicalTicketPayoutService: physSvc,
    adminBroadcaster: broadcaster,
  });

  await service.drawNext("g1");

  assert.equal(physCapture.inputs.length, 3, "3 pending-rows opprettet");
  assert.equal(physicalEvents.length, 3, "3 broadcasts sendt");
  const ticketIds = physicalEvents.map((e) => e.ticketId).sort();
  assert.deepEqual(ticketIds, ["100-1001", "100-1002", "200-2001"]);
});

// ── Test 4: Uten physicalTicketPayoutService wired opp ────────────────────

test("PT4: uten physicalTicketPayoutService wired opp — ingen fysisk-evaluering (bakoverkompat)", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();
  const { broadcaster, physicalEvents } = recordingBroadcaster();

  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [{
        id: "g1",
        status: "running",
        ticket_config_json: standardTicketConfig(),
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id"),
      rows: [],
    },
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 5 })],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws") && s.includes("draw_sequence"),
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
    // INTENSJONELT uten physicalTicketPayoutService
    adminBroadcaster: broadcaster,
  });

  await service.drawNext("g1");

  // Ingen physical-select-query utført
  const physicalQuery = queries.find(
    (q) => q.sql.includes("sold_to_scheduled_game_id = $1"),
  );
  assert.equal(physicalQuery, undefined, "ingen fysisk-query utført uten service");
  assert.equal(physicalEvents.length, 0, "ingen broadcast");
  assert.equal(credits.length, 0, "ingen digital vinner → ingen credit");
});

// ── Test 5: Fysisk bong uten match → ingen pending-row ─────────────────────

test("PT4: fysisk bong uten pattern-match — ingen pending-row opprettet", async () => {
  const { adapter: wallet } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();
  const { service: physSvc, capture: physCapture } = makeFakePhysicalPayout();
  const { broadcaster, physicalEvents } = recordingBroadcaster();

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [{
        id: "g1",
        status: "running",
        ticket_config_json: standardTicketConfig(),
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [],
    },
    // Fysisk bong som IKKE vinner (ingen 1-5 i rad 0)
    {
      match: (s) => s.includes("sold_to_scheduled_game_id = $1") && s.includes("is_purchased = true"),
      rows: [{
        id: "st-phys-1",
        ticket_serial: "100-1001",
        hall_id: "hall-a",
        ticket_color: "small",
        card_matrix: [
          // Full ingen-match grid
          70, 71, 72, 73, 74,
          60, 61, 62, 63, 64,
          50, 51, 0, 52, 53,
          40, 41, 42, 43, 44,
          30, 31, 32, 33, 34,
        ],
        responsible_user_id: "op-a",
        sold_by_user_id: "op-a",
        paid_out_at: null,
      }],
    },
    // Drawn balls: [1-5] — ingen match med grid-tall
    {
      match: (s) => s.includes("SELECT ball_value") && s.includes("app_game1_draws"),
      rows: [{ ball_value: 1 }, { ball_value: 2 }, { ball_value: 3 }, { ball_value: 4 }, { ball_value: 5 }],
    },
    {
      match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 100000 }],
    },
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id"),
      rows: [],
    },
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 5 })],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws") && s.includes("draw_sequence"),
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
    physicalTicketPayoutService: physSvc,
    adminBroadcaster: broadcaster,
  });

  await service.drawNext("g1");

  assert.equal(physCapture.inputs.length, 0, "ingen pending — bongen vinner ikke");
  assert.equal(physicalEvents.length, 0);
});

// ── Test 6: Admin-approval-flagg reflekteres i broadcast ─────────────────

test("PT4: fysisk bong med beløp ≥ terskel → adminApprovalRequired=true i broadcast", async () => {
  const { adapter: wallet } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();
  const { service: physSvc, capture: physCapture } = makeFakePhysicalPayout();
  const { broadcaster, physicalEvents } = recordingBroadcaster();

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [{
        id: "g1",
        status: "running",
        ticket_config_json: {
          spill1: {
            ticketColors: [
              {
                color: "small_yellow",
                // 10% av 10M cents pot = 1M cents = 10k NOK → over terskel
                prizePerPattern: { row_1: 10, row_2: 20, row_3: 25, row_4: 25, full_house: 20 },
              },
            ],
          },
        },
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [],
    },
    {
      match: (s) => s.includes("sold_to_scheduled_game_id = $1") && s.includes("is_purchased = true"),
      rows: [{
        id: "st-phys-1",
        ticket_serial: "100-1001",
        hall_id: "hall-a",
        ticket_color: "small",
        card_matrix: winningRow0Grid(),
        responsible_user_id: "op-a",
        sold_by_user_id: "op-a",
        paid_out_at: null,
      }],
    },
    {
      match: (s) => s.includes("SELECT ball_value") && s.includes("app_game1_draws"),
      rows: [{ ball_value: 1 }, { ball_value: 2 }, { ball_value: 3 }, { ball_value: 4 }, { ball_value: 5 }],
    },
    // Pot 10M cents (100 000 NOK)
    {
      match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 10_000_000 }],
    },
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id"),
      rows: [],
    },
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 5 })],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws") && s.includes("draw_sequence"),
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
    physicalTicketPayoutService: physSvc,
    adminBroadcaster: broadcaster,
  });

  await service.drawNext("g1");

  assert.equal(physCapture.inputs.length, 1);
  // 10% av 10M = 1M cents (10k NOK) → over 5k NOK terskel
  assert.equal(physCapture.inputs[0]!.expectedPayoutCents, 1_000_000);
  assert.equal(physicalEvents.length, 1);
  assert.equal(physicalEvents[0]!.expectedPayoutCents, 1_000_000);
  assert.equal(physicalEvents[0]!.adminApprovalRequired, true);
});

// ── Test 7: Fysisk bong med manglende responsible_user_id → fallback sold_by ─

test("PT4: responsible_user_id mangler → faller tilbake til sold_by_user_id", async () => {
  const { adapter: wallet } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();
  const { service: physSvc, capture: physCapture } = makeFakePhysicalPayout();
  const { broadcaster, physicalEvents } = recordingBroadcaster();

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [{
        id: "g1",
        status: "running",
        ticket_config_json: standardTicketConfig(),
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [],
    },
    {
      match: (s) => s.includes("sold_to_scheduled_game_id = $1") && s.includes("is_purchased = true"),
      rows: [{
        id: "st-phys-1",
        ticket_serial: "100-1001",
        hall_id: "hall-a",
        ticket_color: "small",
        card_matrix: winningRow0Grid(),
        responsible_user_id: null, // MANGLER
        sold_by_user_id: "op-fallback",
        paid_out_at: null,
      }],
    },
    {
      match: (s) => s.includes("SELECT ball_value") && s.includes("app_game1_draws"),
      rows: [{ ball_value: 1 }, { ball_value: 2 }, { ball_value: 3 }, { ball_value: 4 }, { ball_value: 5 }],
    },
    {
      match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 100000 }],
    },
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id"),
      rows: [],
    },
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 5 })],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws") && s.includes("draw_sequence"),
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
    physicalTicketPayoutService: physSvc,
    adminBroadcaster: broadcaster,
  });

  await service.drawNext("g1");

  assert.equal(physCapture.inputs.length, 1);
  assert.equal(physCapture.inputs[0]!.responsibleUserId, "op-fallback");
  assert.equal(physicalEvents[0]!.responsibleUserId, "op-fallback");
});

// ── Test 8: Fysisk bong uten responsible_user_id OG sold_by → skippes ─────

test("PT4: hverken responsible_user_id eller sold_by_user_id satt → bong skippes", async () => {
  const { adapter: wallet } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();
  const { service: physSvc, capture: physCapture } = makeFakePhysicalPayout();
  const { broadcaster, physicalEvents } = recordingBroadcaster();

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [{
        id: "g1",
        status: "running",
        ticket_config_json: standardTicketConfig(),
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [],
    },
    {
      match: (s) => s.includes("sold_to_scheduled_game_id = $1") && s.includes("is_purchased = true"),
      rows: [{
        id: "st-phys-1",
        ticket_serial: "100-1001",
        hall_id: "hall-a",
        ticket_color: "small",
        card_matrix: winningRow0Grid(),
        responsible_user_id: null,
        sold_by_user_id: null, // ogs tomt
        paid_out_at: null,
      }],
    },
    {
      match: (s) => s.includes("SELECT ball_value") && s.includes("app_game1_draws"),
      rows: [{ ball_value: 1 }, { ball_value: 2 }, { ball_value: 3 }, { ball_value: 4 }, { ball_value: 5 }],
    },
    {
      match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 100000 }],
    },
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id"),
      rows: [],
    },
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [runningStateRow({ draws_completed: 1, last_drawn_ball: 5 })],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws") && s.includes("draw_sequence"),
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
    physicalTicketPayoutService: physSvc,
    adminBroadcaster: broadcaster,
  });

  await service.drawNext("g1");

  assert.equal(physCapture.inputs.length, 0, "skippet pga manglende user ids");
  assert.equal(physicalEvents.length, 0);
});
