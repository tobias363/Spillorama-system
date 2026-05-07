/**
 * Multi-vinner per-farge-payout — Tolkning A (PM-bekreftet 2026-05-08).
 *
 * Verifiserer at `Game1DrawEngineService.payoutPerColorGroups` gir hver
 * vinner sin AUTO-MULTIPLIKATERT prize basert på sin egen bongfarge —
 * IKKE pot-deling.
 *
 * Bakgrunn (kanonisk doc):
 *   docs/architecture/SPILL_REGLER_OG_PAYOUT.md §9
 *
 * Eksempel: Rad 1 base 100 kr, 3 vinnere i samme trekk:
 *   - Hvit-bong-vinner → 100 kr (× 1)
 *   - Gul-bong-vinner  → 200 kr (× 2)
 *   - Lilla-bong-vinner → 300 kr (× 3)
 * Total payout: 600 kr. IKKE 100 / 3 = 33,33 kr hver.
 *
 * Tester:
 *   1. Multi-color same phase: 3 vinnere (hvit + gul + lilla) Rad 1 base 100
 *      → 100 + 200 + 300 = 600 kr total
 *   2. Multiple winners same color: 2 lilla-vinnere Rad 1 base 100
 *      → hver får 300 kr (ikke 150 kr split)
 *   3. Mixed multi-color same phase: 2 lilla + 1 hvit + 1 gul
 *      → 300 + 300 + 100 + 200 = 900 kr total
 *   4. Fullt Hus per-color: hvit + gul + lilla Fullt Hus base 1000
 *      → 1000 + 2000 + 3000 = 6000 kr total
 *   5. Trafikklys-spec (placeholder): explicit_per_color = flat per-row
 *      prize uavhengig av bongfarge (siden alle bonger 15 kr).
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
  credits: Array<{
    accountId: string;
    amount: number;
    idempotencyKey?: string;
  }>;
} {
  const credits: Array<{
    accountId: string;
    amount: number;
    idempotencyKey?: string;
  }> = [];
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
        idempotencyKey: options?.idempotencyKey,
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

// ── Helpers ─────────────────────────────────────────────────────────────────

/** 5×5-grid med Row 0 satt til 1..5; brukes for Rad 1-vinst. */
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

/** Fullt-marked grid for Fullt Hus. */
function fullyMarked(): boolean[] {
  return Array(25).fill(true);
}

function fullGrid(): Array<number | null> {
  const grid: Array<number | null> = [];
  for (let i = 0; i < 25; i++) grid.push(i === 12 ? 0 : i + 1);
  return grid;
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
    engine_started_at: "2026-05-08T12:00:00.000Z",
    engine_ended_at: null,
    ...overrides,
  };
}

/**
 * Bygg en kanonisk `spill1.ticketColors[]`-struktur med slug-keyed entries
 * og auto-multiplikatert prize per fase. Matcher det bridge-en
 * (`buildTicketConfigFromCatalog`) skriver.
 *
 * - hvit (5 kr / small_white) → ×1
 * - gul (10 kr / small_yellow) → ×2
 * - lilla (15 kr / small_purple) → ×3
 */
function buildAutoMultGameConfig(opts: {
  rowBaseKr: { row1: number; row2: number; row3: number; row4: number };
  fullHouseBaseKr: number;
}) {
  const families = [
    { slug: "small_white", multiplier: 1 },
    { slug: "small_yellow", multiplier: 2 },
    { slug: "small_purple", multiplier: 3 },
  ];
  return {
    spill1: {
      ticketColors: families.map(({ slug, multiplier }) => ({
        color: slug,
        prizePerPattern: {
          row_1: { mode: "fixed", amount: opts.rowBaseKr.row1 * multiplier },
          row_2: { mode: "fixed", amount: opts.rowBaseKr.row2 * multiplier },
          row_3: { mode: "fixed", amount: opts.rowBaseKr.row3 * multiplier },
          row_4: { mode: "fixed", amount: opts.rowBaseKr.row4 * multiplier },
          full_house: {
            mode: "fixed",
            amount: opts.fullHouseBaseKr * multiplier,
          },
        },
      })),
    },
  };
}

/**
 * Trafikklys-konfig: alle bonger 15 kr → samme flat amount per farge.
 * Gjør at per-color-pathen produserer samme prize for alle vinnere
 * (rad-fargen er allerede latent i prizesPerRowColor). Bridge-en skriver
 * slik for explicit_per_color.
 */
function buildExplicitPerColorGameConfig(opts: {
  rowKr: number; // flat per rad (eks: 50 kr for rød Rad 1)
  fullHouseKr: number; // flat for Fullt Hus
}) {
  const slugs = ["small_white", "small_yellow", "small_purple"];
  return {
    spill1: {
      ticketColors: slugs.map((slug) => ({
        color: slug,
        prizePerPattern: {
          row_1: { mode: "fixed", amount: opts.rowKr },
          row_2: { mode: "fixed", amount: opts.rowKr },
          row_3: { mode: "fixed", amount: opts.rowKr },
          row_4: { mode: "fixed", amount: opts.rowKr },
          full_house: { mode: "fixed", amount: opts.fullHouseKr },
        },
      })),
    },
  };
}

// ── Test 1: Multi-color same phase Rad 1 ────────────────────────────────────

test("Tolkning A: 3 vinnere ulike farger Rad 1 → hver får sin auto-mult prize (100/200/300)", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const gameConfigJson = buildAutoMultGameConfig({
    rowBaseKr: { row1: 100, row2: 200, row3: 300, row4: 400 },
    fullHouseBaseKr: 1000,
  });

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
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
          id: "a-hvit",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
        },
        {
          id: "a-gul",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
        },
        {
          id: "a-lilla",
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
          id: "a-hvit",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-hvit",
          hall_id: "hall-a",
          ticket_color: "small_white",
        },
        {
          id: "a-gul",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-gul",
          hall_id: "hall-a",
          ticket_color: "small_yellow",
        },
        {
          id: "a-lilla",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-lilla",
          hall_id: "hall-a",
          ticket_color: "small_purple",
        },
      ],
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-hvit" }],
      once: true,
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-gul" }],
      once: true,
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-lilla" }],
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
          drawn_at: "2026-05-08T12:01:00.000Z",
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

  // Per-vinner-per-farge (Tolkning A):
  //   Hvit (small_white, 5 kr): 100 × 1 = 100 kr
  //   Gul  (small_yellow, 10 kr): 100 × 2 = 200 kr
  //   Lilla (small_purple, 15 kr): 100 × 3 = 300 kr
  // Total: 600 kr (IKKE 100 / 3 = 33,33 kr per vinner pot-split).
  assert.equal(credits.length, 3, "tre vinnere → tre wallet-credit-kall");
  const hvit = credits.find((c) => c.accountId === "w-hvit");
  const gul = credits.find((c) => c.accountId === "w-gul");
  const lilla = credits.find((c) => c.accountId === "w-lilla");
  assert.ok(hvit, "Hvit-vinner skal ha credit");
  assert.ok(gul, "Gul-vinner skal ha credit");
  assert.ok(lilla, "Lilla-vinner skal ha credit");
  assert.equal(hvit!.amount, 100, "Hvit (×1) → 100 kr");
  assert.equal(gul!.amount, 200, "Gul (×2) → 200 kr");
  assert.equal(lilla!.amount, 300, "Lilla (×3) → 300 kr");
  // Σ = 600 kr (ingen pot-deling, ingen rest).
  assert.equal(
    hvit!.amount + gul!.amount + lilla!.amount,
    600,
    "Total payout = 100 + 200 + 300 = 600 kr"
  );
});

// ── Test 2: Same color, 2 winners ───────────────────────────────────────────

test("Tolkning A: 2 lilla-vinnere Rad 1 base 100 → hver får 300 kr (ikke 150 split)", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const gameConfigJson = buildAutoMultGameConfig({
    rowBaseKr: { row1: 100, row2: 200, row3: 300, row4: 400 },
    fullHouseBaseKr: 1000,
  });

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
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
          id: "a-lilla1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
        },
        {
          id: "a-lilla2",
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
          id: "a-lilla1",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-lilla1",
          hall_id: "hall-a",
          ticket_color: "small_purple",
        },
        {
          id: "a-lilla2",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-lilla2",
          hall_id: "hall-a",
          ticket_color: "small_purple",
        },
      ],
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-lilla1" }],
      once: true,
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-lilla2" }],
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

  await service.drawNext("g1");

  // 2 vinnere på samme farge (small_purple, 15 kr × 3 = 300 kr).
  // Per-vinner-per-farge: hver får 300 kr (FULL prize, INGEN split).
  assert.equal(credits.length, 2, "to vinnere → to wallet-credit-kall");
  for (const c of credits) {
    assert.equal(
      c.amount,
      300,
      `Hver lilla-vinner skal ha 300 kr (auto-mult ×3, ingen split). Fikk: ${c.amount}`
    );
  }
});

// ── Test 3: Mixed multi-color same phase ────────────────────────────────────

test("Tolkning A: 2 lilla + 1 hvit + 1 gul Rad 1 base 100 → 300+300+100+200", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const gameConfigJson = buildAutoMultGameConfig({
    rowBaseKr: { row1: 100, row2: 200, row3: 300, row4: 400 },
    fullHouseBaseKr: 1000,
  });

  const winnerRows = [
    { id: "a-l1", uid: "u-l1", wid: "w-l1", color: "small_purple" },
    { id: "a-l2", uid: "u-l2", wid: "w-l2", color: "small_purple" },
    { id: "a-h", uid: "u-h", wid: "w-h", color: "small_white" },
    { id: "a-g", uid: "u-g", wid: "w-g", color: "small_yellow" },
  ];

  const responses: StubResponse[] = [
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
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
      rows: winnerRows.map((w) => ({
        id: w.id,
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
        s.includes("SELECT a.id, a.grid_numbers_json, a.markings_json, a.buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: winnerRows.map((w) => ({
        id: w.id,
        grid_numbers_json: winningRow0Grid(),
        markings_json: { marked: allRow0Marked() },
        buyer_user_id: w.uid,
        hall_id: "hall-a",
        ticket_color: w.color,
      })),
    },
  ];
  for (const w of winnerRows) {
    responses.push({
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: w.wid }],
      once: true,
    });
  }
  responses.push(
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
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] }
  );

  const { pool } = createStubPool(responses);

  const service = new Game1DrawEngineService({
    pool: pool as never,
    ticketPurchaseService: makeFakeTicketPurchase(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService,
  });

  await service.drawNext("g1");

  // 2 lilla, 1 hvit, 1 gul → 300+300+100+200 = 900 kr total.
  assert.equal(credits.length, 4, "fire vinnere → fire wallet-credit-kall");
  const byWid = (wid: string) => credits.find((c) => c.accountId === wid);
  assert.equal(byWid("w-l1")!.amount, 300, "Lilla 1 → 300 kr (full)");
  assert.equal(byWid("w-l2")!.amount, 300, "Lilla 2 → 300 kr (full)");
  assert.equal(byWid("w-h")!.amount, 100, "Hvit → 100 kr");
  assert.equal(byWid("w-g")!.amount, 200, "Gul → 200 kr");
  const total = credits.reduce((s, c) => s + c.amount, 0);
  assert.equal(total, 900, "Total = 300+300+100+200 = 900 kr");
});

// ── Test 4: Fullt Hus per-color ──────────────────────────────────────────────

test("Tolkning A: hvit + gul + lilla Fullt Hus base 1000 → 1000/2000/3000", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const gameConfigJson = buildAutoMultGameConfig({
    rowBaseKr: { row1: 100, row2: 200, row3: 300, row4: 400 },
    fullHouseBaseKr: 1000,
  });

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [
        runningStateRow({
          current_phase: 5,
          draws_completed: 39,
          draw_bag_json: Array.from({ length: 60 }, (_, i) => i + 1),
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
          id: "a-hvit",
          grid_numbers_json: fullGrid(),
          markings_json: { marked: fullyMarked() },
        },
        {
          id: "a-gul",
          grid_numbers_json: fullGrid(),
          markings_json: { marked: fullyMarked() },
        },
        {
          id: "a-lilla",
          grid_numbers_json: fullGrid(),
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
          id: "a-hvit",
          grid_numbers_json: fullGrid(),
          markings_json: { marked: fullyMarked() },
          buyer_user_id: "u-hvit",
          hall_id: "hall-a",
          ticket_color: "small_white",
        },
        {
          id: "a-gul",
          grid_numbers_json: fullGrid(),
          markings_json: { marked: fullyMarked() },
          buyer_user_id: "u-gul",
          hall_id: "hall-a",
          ticket_color: "small_yellow",
        },
        {
          id: "a-lilla",
          grid_numbers_json: fullGrid(),
          markings_json: { marked: fullyMarked() },
          buyer_user_id: "u-lilla",
          hall_id: "hall-a",
          ticket_color: "small_purple",
        },
      ],
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-hvit" }],
      once: true,
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-gul" }],
      once: true,
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-lilla" }],
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
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("scheduled_games") &&
        s.includes("'completed'"),
      rows: [],
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [
        runningStateRow({
          draws_completed: 40,
          last_drawn_ball: 40,
          current_phase: 5,
          engine_ended_at: "x",
        }),
      ],
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

  await service.drawNext("g1");

  // Per-vinner-per-farge Fullt Hus base 1000:
  //   Hvit (×1): 1000 kr
  //   Gul  (×2): 2000 kr
  //   Lilla (×3): 3000 kr
  assert.equal(credits.length, 3);
  const hvit = credits.find((c) => c.accountId === "w-hvit");
  const gul = credits.find((c) => c.accountId === "w-gul");
  const lilla = credits.find((c) => c.accountId === "w-lilla");
  assert.equal(hvit!.amount, 1000, "Hvit Fullt Hus → 1000 kr");
  assert.equal(gul!.amount, 2000, "Gul Fullt Hus → 2000 kr");
  assert.equal(lilla!.amount, 3000, "Lilla Fullt Hus → 3000 kr");
});

// ── Test 5: Trafikklys-spec (placeholder for fremtidig variant-PR) ───────────
//
// Når Trafikklys-runtime lander vil rad-fargen velges per spill-start og
// engine vil bruke `rules.prizesPerRowColor[radFarge]` som flat amount
// per vinner uavhengig av bongfarge.
//
// I dag (engine-fix-PR) skriver bridge-en samme flat amount per slug for
// `prizeMultiplierMode = "explicit_per_color"`. Per-vinner-per-farge-pathen
// gir derfor flat amount for alle vinnere — dette er korrekt for Trafikklys
// (alle bonger 15 kr → samme prize).
//
// Denne testen verifiserer at fix-en ikke bryter eksisterende
// Trafikklys-stil-konfig: alle vinnere får samme prize uansett bongfarge.

test("Trafikklys-stil (explicit_per_color): flat 50 kr per rad → alle vinnere får 50 kr uansett bongfarge", async () => {
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const gameConfigJson = buildExplicitPerColorGameConfig({
    rowKr: 50, // Rød Rad 1
    fullHouseKr: 500, // Rød Fullt Hus
  });

  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [runningStateRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
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
        {
          id: "a-2",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
        },
        {
          id: "a-3",
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
          buyer_user_id: "u-1",
          hall_id: "hall-a",
          ticket_color: "small_white",
        },
        {
          id: "a-2",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-2",
          hall_id: "hall-a",
          ticket_color: "small_yellow",
        },
        {
          id: "a-3",
          grid_numbers_json: winningRow0Grid(),
          markings_json: { marked: allRow0Marked() },
          buyer_user_id: "u-3",
          hall_id: "hall-a",
          ticket_color: "small_purple",
        },
      ],
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-1" }],
      once: true,
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-2" }],
      once: true,
    },
    {
      match: (s) => s.includes("wallet_id") && s.includes("app_users"),
      rows: [{ wallet_id: "w-3" }],
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

  await service.drawNext("g1");

  // Trafikklys-stil: explicit_per_color → samme flat amount (50 kr) for
  // alle bongfarger. Per-vinner-per-farge-pathen gir korrekt 50 kr per
  // vinner uansett bongfarge.
  assert.equal(credits.length, 3);
  for (const c of credits) {
    assert.equal(
      c.amount,
      50,
      `Alle vinnere skal ha 50 kr (flat per rad-farge). Fikk: ${c.amount}`
    );
  }
});
