/**
 * REGULATORISK-KRITISK (2026-05-14, fix for runde 7dcbc3ba payout-feil):
 *
 * Tester for auto-multiplikator-fix på Spill 1 payout-pipeline.
 *
 * **Bug:** Engine leste pattern-pris fra __default__-matrise (HVIT-base)
 * for ALLE vinnere uavhengig av bongfarge fordi `winner.ticketColor`
 * lagres som FAMILY-form ("yellow"/"purple") av purchase-service mens
 * `patternsByColor` keys er engine-navn ("Small Yellow"/"Large Purple").
 * Lookup-mismatch → auto-multiplikator (yellow×2, purple×3) gikk tapt.
 *
 * **DB-bevis (runde 7dcbc3ba 2026-05-14):**
 *   - Yellow Rad 1: utbetalt 100 kr, skal være 200 (= 100 × 2)
 *   - Purple Rad 2: utbetalt 200 kr, skal være 300 (= 100 × 3)
 *   - Yellow Rad 3 og 4: utbetalt 200 kr (= 100 × 2) — heldigvis stemte
 *     dette tilfeldigvis pga test-config, men logikken var feil.
 *
 * **Fix:** `payoutPerColorGroups` bygger nå slug-form ("small_yellow"/
 * "large_purple") fra (ticket_color family-form, ticket_size) via
 * `resolveColorSlugFromAssignment` før lookup. Slug-form matcher
 * `patternsByColor` keys via SCHEDULER_COLOR_SLUG_TO_NAME →
 * "Small Yellow"/"Large Purple" → riktig per-farge pre-multiplisert
 * premie hentes.
 *
 * **Tester dekker:**
 *   1. Yellow Rad 1 (small, family-form ticket_color) → 200 kr (= 100 × 2)
 *   2. Purple Rad 1 (small, family-form) → 300 kr (= 100 × 3)
 *   3. White Rad 1 (small, family-form) → 100 kr (= 100 × 1, baseline)
 *   4. Yellow Fullt Hus (small, family-form) → 2000 kr (= 1000 × 2)
 *   5. Multi-vinner samme fase samme bongstørrelse → pot deles likt
 *   6. Ledger-audit-felter: ticketColor + bongMultiplier i metadata
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1DrawEngineService } from "./Game1DrawEngineService.js";
import { Game1PayoutService } from "./Game1PayoutService.js";
import { Game1JackpotService } from "./Game1JackpotService.js";
import type {
  WalletAdapter,
  WalletTransaction,
} from "../adapters/WalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type {
  ComplianceLedgerPort,
  ComplianceLedgerEventInput,
} from "../adapters/ComplianceLedgerPort.js";
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
    async listPurchasesForGame() {
      return [];
    },
  } as unknown as Game1TicketPurchaseService;
}

function makeRecordingComplianceLedgerPort(): {
  port: ComplianceLedgerPort;
  events: ComplianceLedgerEventInput[];
} {
  const events: ComplianceLedgerEventInput[] = [];
  const port: ComplianceLedgerPort = {
    async recordComplianceLedgerEvent(event) {
      events.push(event);
    },
  };
  return { port, events };
}

// ── Test data ───────────────────────────────────────────────────────────

/** Win-grid for Rad 1 (5 første celler markert + free centre). */
function winningRow0Grid(): Array<number | null> {
  return [
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ];
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

function fullyMarked(): boolean[] {
  return Array(25).fill(true) as boolean[];
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
 * Demo-pilot-katalog speilet i game_config_json — matcher prod-runde
 * 7dcbc3ba (catalog=bingo, prizeMultiplierMode=auto, base 100/100/100/100
 * for Rad 1-4 og bingoBase 1000 for Fullt Hus).
 *
 * `spill1.ticketColors[]` har pre-multipliserte beløp per (color, size)
 * — dette er bridge-output etter `calculateActualPrize`-skalering.
 */
function autoMultGameConfigJson() {
  return {
    spill1: {
      ticketColors: [
        {
          color: "small_white", // hvit 5 kr × 1
          priceNok: 5,
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            row_2: { mode: "fixed", amount: 100 },
            row_3: { mode: "fixed", amount: 100 },
            row_4: { mode: "fixed", amount: 100 },
            full_house: { mode: "fixed", amount: 1000 },
          },
        },
        {
          color: "small_yellow", // gul 10 kr × 2
          priceNok: 10,
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 200 },
            row_2: { mode: "fixed", amount: 200 },
            row_3: { mode: "fixed", amount: 200 },
            row_4: { mode: "fixed", amount: 200 },
            full_house: { mode: "fixed", amount: 2000 },
          },
        },
        {
          color: "small_purple", // lilla 15 kr × 3
          priceNok: 15,
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 300 },
            row_2: { mode: "fixed", amount: 300 },
            row_3: { mode: "fixed", amount: 300 },
            row_4: { mode: "fixed", amount: 300 },
            full_house: { mode: "fixed", amount: 3000 },
          },
        },
        {
          color: "large_yellow", // gul stor 30 kr × 6
          priceNok: 30,
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 600 },
            row_2: { mode: "fixed", amount: 600 },
            row_3: { mode: "fixed", amount: 600 },
            row_4: { mode: "fixed", amount: 600 },
            full_house: { mode: "fixed", amount: 6000 },
          },
        },
      ],
    },
  };
}

// ── Test 1: Yellow Rad 1 (family-form, small) → 200 kr ─────────────────

test("payout auto-mult: small_yellow Rad 1 (family-form 'yellow' + size 'small') → 200 kr (= 100 × 2)", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const gameConfigJson = autoMultGameConfigJson();

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) =>
        s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "running",
          ticket_config_json: {},
          game_config_json: gameConfigJson,
        },
      ],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("FOR UPDATE"),
      rows: [
        {
          id: "a-1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
        },
      ],
    },
    {
      match: (s) =>
        s.trim().startsWith("UPDATE") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("markings_json"),
      rows: [],
      once: false,
    },
    // KRITISK: ticket_color = 'yellow' (family-form, prod-shape).
    // ticket_size = 'small'. Engine MÅ bygge "small_yellow" slug og
    // slå opp riktig per-farge premie (200 kr = 100 × 2).
    {
      match: (s) =>
        s.includes("SELECT a.id, a.grid_numbers_json, a.markings_json, a.buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [
        {
          id: "a-1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-yellow",
          hall_id: "hall-a",
          ticket_color: "yellow",
          ticket_size: "small",
        },
      ],
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-yellow" }],
    },
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
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: 1,
          last_drawn_ball: 5,
          current_phase: 2,
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        {
          draw_sequence: 1,
          ball_value: 5,
          drawn_at: "2026-04-21T12:01:00.000Z",
        },
      ],
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

  await service.drawNext("g1");

  // Post-fix: yellow + small → small_yellow slug → 200 kr utbetalt.
  // Pre-fix (bug): family-form "yellow" matchet ingen patternsByColor-key,
  // falt til __default__ (HVIT-base) → 100 kr utbetalt.
  assert.equal(credits.length, 1, "én vinner → én wallet-credit");
  assert.equal(
    credits[0]!.amount,
    200,
    "Yellow Rad 1 (small) skal være 200 kr (= 100 × 2 auto-mult). Pre-fix bug: 100 kr (HVIT-base)",
  );
});

// ── Test 2: Purple Rad 2 (family-form, small) → 300 kr ─────────────────

test("payout auto-mult: small_purple Rad 2 (family-form 'purple' + size 'small') → 300 kr (= 100 × 3)", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const gameConfigJson = autoMultGameConfigJson();

  // For Rad 2, vi starter på phase 2 og krever ALLE 5 første rader markert
  // pluss alle 5 av neste rad. La oss bruke en helt fullført brett som
  // garantert vinner på phase 2.
  function row1And2Marked(): boolean[] {
    return [
      true, true, true, true, true,
      true, true, true, true, true,
      false, false, true, false, false,
      false, false, false, false, false,
      false, false, false, false, false,
    ];
  }

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow({ current_phase: 2 })],
    },
    {
      match: (s) =>
        s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "running",
          ticket_config_json: {},
          game_config_json: gameConfigJson,
        },
      ],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("FOR UPDATE"),
      rows: [
        {
          id: "a-1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: row1And2Marked() },
        },
      ],
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
        s.includes("SELECT a.id, a.grid_numbers_json, a.markings_json, a.buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [
        {
          id: "a-1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: row1And2Marked() },
          buyer_user_id: "u-purple",
          hall_id: "hall-a",
          ticket_color: "purple",
          ticket_size: "small",
        },
      ],
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-purple" }],
    },
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
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: 1,
          last_drawn_ball: 10,
          current_phase: 3,
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        {
          draw_sequence: 1,
          ball_value: 10,
          drawn_at: "2026-04-21T12:01:00.000Z",
        },
      ],
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

  await service.drawNext("g1");

  assert.equal(credits.length, 1, "én vinner → én wallet-credit");
  assert.equal(
    credits[0]!.amount,
    300,
    "Purple Rad 2 (small) skal være 300 kr (= 100 × 3 auto-mult). Pre-fix bug: 100 kr (HVIT-base) eller 200 kr.",
  );
});

// ── Test 3: White Rad 1 (family-form, small) → 100 kr (baseline) ───────

test("payout auto-mult: small_white Rad 1 (family-form 'white' + size 'small') → 100 kr (baseline × 1)", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const gameConfigJson = autoMultGameConfigJson();

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) =>
        s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "running",
          ticket_config_json: {},
          game_config_json: gameConfigJson,
        },
      ],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("FOR UPDATE"),
      rows: [
        {
          id: "a-1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
        },
      ],
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
        s.includes("SELECT a.id, a.grid_numbers_json, a.markings_json, a.buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [
        {
          id: "a-1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-white",
          hall_id: "hall-a",
          ticket_color: "white",
          ticket_size: "small",
        },
      ],
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-white" }],
    },
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
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: 1,
          last_drawn_ball: 5,
          current_phase: 2,
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        {
          draw_sequence: 1,
          ball_value: 5,
          drawn_at: "2026-04-21T12:01:00.000Z",
        },
      ],
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

  await service.drawNext("g1");

  assert.equal(credits.length, 1, "én vinner → én wallet-credit");
  assert.equal(
    credits[0]!.amount,
    100,
    "White Rad 1 (small) skal være 100 kr (= 100 × 1, baseline — uendret av fix)",
  );
});

// ── Test 4: Yellow Fullt Hus (family-form, small) → 2000 kr ──────────

test("payout auto-mult: small_yellow Fullt Hus (family-form 'yellow' + size 'small') → 2000 kr (= 1000 × 2)", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const gameConfigJson = autoMultGameConfigJson();

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow({ current_phase: 5 })],
    },
    {
      match: (s) =>
        s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "running",
          ticket_config_json: {},
          game_config_json: gameConfigJson,
        },
      ],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("FOR UPDATE"),
      rows: [
        {
          id: "a-1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: fullyMarked() },
        },
      ],
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
        s.includes("SELECT a.id, a.grid_numbers_json, a.markings_json, a.buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [
        {
          id: "a-1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: fullyMarked() },
          buyer_user_id: "u-yellow",
          hall_id: "hall-a",
          ticket_color: "yellow",
          ticket_size: "small",
        },
      ],
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-yellow" }],
    },
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
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: 1,
          last_drawn_ball: 50,
          current_phase: 5,
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        {
          draw_sequence: 1,
          ball_value: 50,
          drawn_at: "2026-04-21T12:01:00.000Z",
        },
      ],
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

  await service.drawNext("g1");

  assert.equal(credits.length, 1, "én vinner → én wallet-credit");
  assert.equal(
    credits[0]!.amount,
    2000,
    "Yellow Fullt Hus (small) skal være 2000 kr (= 1000 × 2 auto-mult)",
  );
});

// ── Test 5: Multi-vinner samme bongstørrelse → pot deles likt ─────────

test("payout auto-mult: 2 yellow Rad 1-vinnere (begge small) → pot 200 deles likt = 100 kr hver", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const gameConfigJson = autoMultGameConfigJson();

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) =>
        s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "running",
          ticket_config_json: {},
          game_config_json: gameConfigJson,
        },
      ],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("FOR UPDATE"),
      rows: [
        {
          id: "a-alice",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
        },
        {
          id: "a-bob",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
        },
      ],
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
        s.includes("SELECT a.id, a.grid_numbers_json, a.markings_json, a.buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [
        {
          id: "a-alice",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-alice",
          hall_id: "hall-a",
          ticket_color: "yellow",
          ticket_size: "small",
        },
        {
          id: "a-bob",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-bob",
          hall_id: "hall-a",
          ticket_color: "yellow",
          ticket_size: "small",
        },
      ],
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-alice" }],
      once: true,
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-bob" }],
      once: true,
    },
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
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: 1,
          last_drawn_ball: 5,
          current_phase: 2,
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        {
          draw_sequence: 1,
          ball_value: 5,
          drawn_at: "2026-04-21T12:01:00.000Z",
        },
      ],
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

  await service.drawNext("g1");

  // small_yellow-pot = 200 kr (= 100 × 2). 2 vinnere → 100 kr hver
  // (floor-split, ingen rest).
  assert.equal(credits.length, 2, "to vinnere → to wallet-credit");
  const alice = credits.find((c) => c.accountId === "w-alice");
  const bob = credits.find((c) => c.accountId === "w-bob");
  assert.ok(alice, "Alice (yellow small) skal ha credit");
  assert.ok(bob, "Bob (yellow small) skal ha credit");
  assert.equal(
    alice!.amount,
    100,
    "Alice: small_yellow-pot 200 / 2 vinnere = 100 kr",
  );
  assert.equal(
    bob!.amount,
    100,
    "Bob: small_yellow-pot 200 / 2 vinnere = 100 kr",
  );
});

// ── Test 6: Ledger-audit-felter — bongMultiplier + potCentsForBongSize ─

test("payout auto-mult: compliance-ledger PRIZE-entry har bongMultiplier + potCentsForBongSize", async () => {
  const { adapter: wallet } = makeFakeWallet();
  const { port: ledgerPort, events: ledgerEvents } =
    makeRecordingComplianceLedgerPort();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    complianceLedgerPort: ledgerPort,
  });
  const jackpotService = new Game1JackpotService();

  const gameConfigJson = autoMultGameConfigJson();

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) =>
        s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "running",
          ticket_config_json: {},
          game_config_json: gameConfigJson,
        },
      ],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") && s.includes("app_game1_draws"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_assignments") &&
        s.includes("FOR UPDATE"),
      rows: [
        {
          id: "a-1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
        },
      ],
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
        s.includes("SELECT a.id, a.grid_numbers_json, a.markings_json, a.buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [
        {
          id: "a-1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-purple",
          hall_id: "hall-a",
          ticket_color: "purple",
          ticket_size: "small",
        },
      ],
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-purple" }],
    },
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
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: 1,
          last_drawn_ball: 5,
          current_phase: 2,
        }),
      ],
    },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_draws"),
      rows: [
        {
          draw_sequence: 1,
          ball_value: 5,
          drawn_at: "2026-04-21T12:01:00.000Z",
        },
      ],
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

  await service.drawNext("g1");

  const prizeEvent = ledgerEvents.find((e) => e.eventType === "PRIZE");
  assert.ok(prizeEvent, "PRIZE-event skrives til compliance-ledger");
  assert.equal(
    prizeEvent!.amount,
    300,
    "PRIZE-amount er 300 kr (post-fix: purple × 3)",
  );
  assert.equal(
    prizeEvent!.hallId,
    "hall-a",
    "PRIZE bindes til kjøpe-hall (winner.hallId)",
  );
  assert.equal(
    prizeEvent!.gameType,
    "MAIN_GAME",
    "Spill 1 = MAIN_GAME (hovedspill, ikke databingo)",
  );
  // Pot-metadata-felter for §71-sporbarhet:
  const meta = prizeEvent!.metadata as Record<string, unknown>;
  assert.equal(
    meta.bongMultiplier,
    3,
    "bongMultiplier=3 (small_purple = 15 kr × 3)",
  );
  assert.equal(
    meta.potCentsForBongSize,
    30000,
    "potCentsForBongSize=30000 øre (= 300 kr — pre-multiplisert purple-pot)",
  );
  assert.equal(
    meta.ticketColor,
    "purple",
    "ticketColor=purple (family-form i ledger, behold for audit-trail-paritet)",
  );
  assert.equal(
    meta.winningTicketsInSameSize,
    1,
    "1 vinnende bong i denne pot-en",
  );
  assert.equal(
    meta.winningPlayersInSameSize,
    1,
    "1 unik spiller blant vinnerne",
  );
});
