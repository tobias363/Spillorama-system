/**
 * K1-C: Integrasjonstester for Lucky Number Bonus wire-up i
 * Game1DrawEngineService.
 *
 * Dekker:
 *   - Happy-path: Fullt Hus vunnet PÅ lucky-ball → bonus utbetales
 *   - Mismatch: Fullt Hus vunnet på annen ball enn lucky → ingen bonus
 *   - Config disabled (luckyBonus.enabled=false) → ingen bonus selv med match
 *   - Fase < 5 → ingen bonus selv med match
 *   - Lookup returnerer undefined (spiller har ikke valgt lucky) → ingen bonus
 *   - Service ikke wired opp (luckyBonusService=null) → ingen bonus
 *   - Wallet.credit-feil i bonus → ROLLBACK av hele draw (fail-closed)
 *   - Idempotency-key matcher PM-spec `g1-lucky-bonus-{gameId}-{winnerId}`
 *   - Dedupe: samme vinner med 2 tickets får én bonus
 *
 * Legacy-ref: GameProcess.js:420-429 (trigger-betingelse) +
 *             GameProcess.js:5960-6100 (per-vinner utbetalings-flyt).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import { Game1DrawEngineService } from "./Game1DrawEngineService.js";
import { Game1PayoutService } from "./Game1PayoutService.js";
import { Game1JackpotService } from "./Game1JackpotService.js";
import { Game1LuckyBonusService } from "./Game1LuckyBonusService.js";
import type { WalletAdapter, WalletTransaction } from "../adapters/WalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type { Game1TicketPurchaseService } from "./Game1TicketPurchaseService.js";

// ── Stubs ──────────────────────────────────────────────────────────────────

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

interface RecordedCredit {
  accountId: string;
  amount: number;
  reason: string;
  idempotencyKey?: string;
  to?: "deposit" | "winnings";
}

function makeFakeWallet(opts: { creditAlwaysThrows?: boolean } = {}): {
  adapter: WalletAdapter;
  credits: RecordedCredit[];
} {
  const credits: RecordedCredit[] = [];
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
      credits.push({
        accountId,
        amount,
        reason,
        idempotencyKey: options?.idempotencyKey,
        to: options?.to,
      });
      if (opts.creditAlwaysThrows) {
        throw new Error("wallet-simulated-failure");
      }
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

/** Fullt grid med alle celler markert (Fullt Hus vinner umiddelbart). */
function fullHouseGrid(): Array<number | null> {
  const g: Array<number | null> = [];
  for (let i = 0; i < 25; i++) g.push(i === 12 ? 0 : i + 1);
  return g;
}

function fullHouseMarkings(): boolean[] {
  return new Array(25).fill(true);
}

/**
 * Standard state-row: fase 5 (Fullt Hus-kandidat), draws_completed=23,
 * slik at neste draw (ball i bag-pos 24) fullfører vinnet.
 */
function fullHouseReadyState(drawBall: number, overrides: Record<string, unknown> = {}) {
  return {
    scheduled_game_id: "g1",
    // Bag hvor ball nr 24 (index 23) er den som trekkes neste.
    draw_bag_json: Array.from({ length: 52 }, (_, i) => (i === 23 ? drawBall : i + 1)),
    draws_completed: 23,
    current_phase: 5,
    last_drawn_ball: null,
    last_drawn_at: null,
    next_auto_draw_at: null,
    paused: false,
    engine_started_at: "2026-04-21T12:00:00.000Z",
    engine_ended_at: null,
    ...overrides,
  };
}

/** Standard scheduled-games-row med luckyBonus-config i ticket_config_json. */
function scheduledGameWithLuckyBonus(bonusConfig: {
  amountCents: number;
  enabled: boolean;
} | null) {
  return {
    id: "g1",
    status: "running",
    room_code: "room-1",
    game_config_json: null,
    ticket_config_json: {
      spill1: {
        ticketColors: [
          {
            color: "small_yellow",
            prizePerPattern: { full_house: 20 },
          },
        ],
      },
      ...(bonusConfig ? { luckyBonus: bonusConfig } : {}),
    },
  };
}

/** Standard respons-queue for en Fullt-Hus-draw med én vinner. */
function fullHouseResponses(options: {
  drawBall: number;
  bonusConfig: { amountCents: number; enabled: boolean } | null;
  multipleWinners?: boolean;
}): StubResponse[] {
  const { drawBall, bonusConfig, multipleWinners } = options;
  const grid = fullHouseGrid();
  const markings = fullHouseMarkings();

  const assignmentRows = multipleWinners
    ? [
        { id: "a-1", grid_numbers_json: grid, markings_json: { marked: markings }, buyer_user_id: "u-1", hall_id: "hall-a", ticket_color: "small_yellow" },
        { id: "a-2", grid_numbers_json: grid, markings_json: { marked: markings }, buyer_user_id: "u-1", hall_id: "hall-a", ticket_color: "small_yellow" },
      ]
    : [
        { id: "a-1", grid_numbers_json: grid, markings_json: { marked: markings }, buyer_user_id: "u-1", hall_id: "hall-a", ticket_color: "small_yellow" },
      ];

  const markBallRows = multipleWinners
    ? [
        { id: "a-1", grid_numbers_json: grid, markings_json: { marked: markings } },
        { id: "a-2", grid_numbers_json: grid, markings_json: { marked: markings } },
      ]
    : [
        { id: "a-1", grid_numbers_json: grid, markings_json: { marked: markings } },
      ];

  return [
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [fullHouseReadyState(drawBall)],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [scheduledGameWithLuckyBonus(bonusConfig)],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("FOR UPDATE"),
      rows: markBallRows,
    },
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("markings_json"),
      rows: [],
      // Kan kalles én gang per assignment — ikke fjern fra kø.
      once: false,
    },
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: assignmentRows,
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "wallet-1" }],
      once: false,
    },
    {
      match: (s) =>
        s.includes("COALESCE(SUM(total_amount_cents)") &&
        s.includes("app_game1_ticket_purchases"),
      rows: [{ pot_cents: 100000 }],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"),
      rows: [],
      once: false,
    },
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("scheduled_games") &&
        s.includes("'completed'"),
      rows: [],
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [
        {
          ...fullHouseReadyState(drawBall),
          draws_completed: 24,
          last_drawn_ball: drawBall,
          engine_ended_at: "2026-04-21T12:05:00.000Z",
        },
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ];
}

// ── Test: happy-path — Fullt Hus PÅ lucky → bonus utbetales ─────────────────

test("Lucky Bonus: Fullt Hus på valgt lykketall → bonus credited + audit", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const auditStore = new InMemoryAuditLogStore();
  const audit = new AuditLogService(auditStore);
  const luckyBonusService = new Game1LuckyBonusService();

  const drawBall = 42; // ball som fullfører vinnet
  const { pool } = createStubPool(
    fullHouseResponses({
      drawBall,
      bonusConfig: { amountCents: 10000, enabled: true },
    })
  );

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: audit,
    payoutService,
    jackpotService: new Game1JackpotService(),
    luckyBonusService,
    luckyNumberLookup: ({ roomCode, userId }) => {
      // Spiller u-1 har valgt 42 i rommet.
      if (roomCode === "room-1" && userId === "u-1") return 42;
      return undefined;
    },
    walletAdapter: wallet,
  });

  const view = await service.drawNext("g1");
  assert.equal(view.isFinished, true, "Fullt Hus → game ender");

  // Ordinær Fullt Hus-credit + lucky-bonus-credit → 2 credits.
  assert.equal(credits.length, 2, "ordinær + lucky-bonus = 2 wallet.credit");

  // Lucky-bonus-credit identifiseres via reason-string.
  const bonusCredit = credits.find((c) => c.reason.includes("Lucky Number Bonus"));
  assert.ok(bonusCredit, "skal ha lucky-bonus-credit");
  assert.equal(bonusCredit!.amount, 100, "10000 cents = 100 kr");
  assert.equal(bonusCredit!.accountId, "wallet-1");
  assert.equal(bonusCredit!.to, "winnings", "bonus skal gå til winnings-side");
  assert.equal(
    bonusCredit!.idempotencyKey,
    "g1-lucky-bonus-g1-u-1",
    "idempotency-key matcher PM-spec"
  );

  // Audit-entry skal være registrert.
  await new Promise((r) => setTimeout(r, 10)); // fire-and-forget audit
  const auditEntries = await auditStore.list({
    resourceId: "g1",
    limit: 20,
  });
  const luckyAudit = auditEntries.find(
    (e) => e.action === "game1.lucky_number_bonus_won"
  );
  assert.ok(luckyAudit, "skal ha lucky_number_bonus_won-audit");
  const details = luckyAudit!.details as Record<string, unknown>;
  assert.equal(details.luckyNumber, 42);
  assert.equal(details.fullHouseBall, 42);
  assert.equal(details.bonusCents, 10000);
});

// ── Test: Fullt Hus, men lastBall ≠ luckyNumber → ingen bonus ──────────────

test("Lucky Bonus: Fullt Hus på annen ball enn lucky → ingen bonus", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });

  const drawBall = 50; // ball ulik spillerens lucky (42)
  const { pool } = createStubPool(
    fullHouseResponses({
      drawBall,
      bonusConfig: { amountCents: 10000, enabled: true },
    })
  );

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService: new Game1JackpotService(),
    luckyBonusService: new Game1LuckyBonusService(),
    luckyNumberLookup: ({ userId }) => (userId === "u-1" ? 42 : undefined),
    walletAdapter: wallet,
  });

  await service.drawNext("g1");

  // Kun ordinær Fullt Hus-credit, ingen bonus.
  assert.equal(credits.length, 1, "kun ordinær credit, ingen bonus");
  assert.ok(
    !credits.some((c) => c.reason.includes("Lucky Number Bonus")),
    "ingen lucky-bonus-credit"
  );
});

// ── Test: bonus-config disabled → ingen bonus selv med match ──────────────

test("Lucky Bonus: bonusConfig.enabled=false → ingen bonus", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });

  const drawBall = 42;
  const { pool } = createStubPool(
    fullHouseResponses({
      drawBall,
      bonusConfig: { amountCents: 10000, enabled: false },
    })
  );

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService: new Game1JackpotService(),
    luckyBonusService: new Game1LuckyBonusService(),
    luckyNumberLookup: ({ userId }) => (userId === "u-1" ? 42 : undefined),
    walletAdapter: wallet,
  });

  await service.drawNext("g1");

  assert.equal(credits.length, 1, "kun ordinær credit (enabled=false)");
  assert.ok(!credits.some((c) => c.reason.includes("Lucky Number Bonus")));
});

// ── Test: ingen bonus-config → ingen bonus ────────────────────────────────

test("Lucky Bonus: luckyBonus-config fraværende → ingen bonus", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });

  const drawBall = 42;
  const { pool } = createStubPool(
    fullHouseResponses({
      drawBall,
      bonusConfig: null,
    })
  );

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService: new Game1JackpotService(),
    luckyBonusService: new Game1LuckyBonusService(),
    luckyNumberLookup: ({ userId }) => (userId === "u-1" ? 42 : undefined),
    walletAdapter: wallet,
  });

  await service.drawNext("g1");

  assert.equal(credits.length, 1, "ingen config → ingen bonus");
});

// ── Test: spiller har ikke valgt lucky → ingen bonus ──────────────────────

test("Lucky Bonus: lookup returnerer undefined → ingen bonus", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });

  const drawBall = 42;
  const { pool } = createStubPool(
    fullHouseResponses({
      drawBall,
      bonusConfig: { amountCents: 10000, enabled: true },
    })
  );

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService: new Game1JackpotService(),
    luckyBonusService: new Game1LuckyBonusService(),
    luckyNumberLookup: () => undefined, // ingen spiller har lucky
    walletAdapter: wallet,
  });

  await service.drawNext("g1");

  assert.equal(credits.length, 1, "lookup=undefined → ingen bonus");
});

// ── Test: service ikke wired opp → ingen bonus (bakoverkompat) ────────────

test("Lucky Bonus: luckyBonusService null → ingen bonus (bakoverkompat)", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });

  const drawBall = 42;
  const { pool } = createStubPool(
    fullHouseResponses({
      drawBall,
      bonusConfig: { amountCents: 10000, enabled: true },
    })
  );

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService: new Game1JackpotService(),
    // luckyBonusService IKKE wired opp
    walletAdapter: wallet,
  });

  await service.drawNext("g1");

  assert.equal(credits.length, 1, "uten service → ingen bonus");
});

// ── Test: wallet-feil i bonus ruller tilbake hele draw-en ─────────────────

test("Lucky Bonus: wallet-feil i bonus-credit → ROLLBACK + DomainError", async () => {
  // Wallet som alltid kaster.
  const { adapter: failingWallet } = makeFakeWallet({ creditAlwaysThrows: true });
  const payoutService = new Game1PayoutService({
    walletAdapter: failingWallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });

  const drawBall = 42;
  const { pool, queries } = createStubPool([
    ...fullHouseResponses({
      drawBall,
      bonusConfig: { amountCents: 10000, enabled: true },
    }),
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService: new Game1JackpotService(),
    luckyBonusService: new Game1LuckyBonusService(),
    luckyNumberLookup: ({ userId }) => (userId === "u-1" ? 42 : undefined),
    walletAdapter: failingWallet,
  });

  await assert.rejects(
    service.drawNext("g1"),
    (err) =>
      err instanceof DomainError && err.code === "PAYOUT_WALLET_CREDIT_FAILED"
  );

  // Noe credit-feil → enten ordinær eller bonus — begge skal rulle tilbake.
  assert.ok(queries.some((q) => q.sql.startsWith("ROLLBACK")));
});

// ── Test: dedupe — samme spiller med 2 vinnende tickets får 1 bonus ───────

test("Lucky Bonus: én spiller med 2 vinnende tickets → kun 1 bonus (dedupe)", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });

  const drawBall = 42;
  const { pool } = createStubPool(
    fullHouseResponses({
      drawBall,
      bonusConfig: { amountCents: 10000, enabled: true },
      multipleWinners: true,
    })
  );

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService: new Game1JackpotService(),
    luckyBonusService: new Game1LuckyBonusService(),
    luckyNumberLookup: ({ userId }) => (userId === "u-1" ? 42 : undefined),
    walletAdapter: wallet,
  });

  await service.drawNext("g1");

  // Ordinær utbetaling per ticket (2 tickets = 2 credits) + 1 lucky-bonus.
  const bonusCredits = credits.filter((c) =>
    c.reason.includes("Lucky Number Bonus")
  );
  assert.equal(
    bonusCredits.length,
    1,
    "dedupe: 1 bonus selv med 2 vinnende tickets"
  );
});
