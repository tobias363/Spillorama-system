/**
 * Scheduler-config-kobling E2E:
 *
 * Ende-til-ende-test som speiler produksjonsflyten:
 *   1. Admin lager GameManagement med spill1.ticketColors[] og per-farge
 *      premie-matrise i `config_json`.
 *   2. Scheduler-tick (Game1ScheduleTickService.spawnUpcomingGame1Games)
 *      kopierer GM.config_json → scheduled_games.game_config_json.
 *   3. Runtime (Game1DrawEngineService.drawNext) leser game_config_json,
 *      bygger per-farge variantConfig, og utbetaler ulike premier per
 *      vinners farge.
 *
 * Testen bruker stub-pool for å koble sammen de to servicene uten ekte DB —
 * data-snapshots sendes fra scheduler-INSERT til draw-engine-SELECT via en
 * delt in-memory "scheduled_games"-map.
 *
 * Spec: docs/architecture/spill1-variantconfig-admin-coupling.md
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1ScheduleTickService } from "./Game1ScheduleTickService.js";
import { Game1DrawEngineService } from "./Game1DrawEngineService.js";
import { Game1PayoutService } from "./Game1PayoutService.js";
import { Game1JackpotService } from "./Game1JackpotService.js";
import type { WalletAdapter, WalletTransaction } from "../adapters/WalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type { Game1TicketPurchaseService } from "./Game1TicketPurchaseService.js";

// ── Shared pool that services both scheduler + draw-engine ────────────

/**
 * Simulert "scheduled_games"-rad etter spawn. Holder `game_config_json`
 * slik scheduler skrev det, for å matche draw-engine's SELECT-query.
 */
interface SimScheduledGame {
  id: string;
  status: string;
  ticket_config_json: unknown;
  game_config_json: unknown;
  room_code: string | null;
}

interface PoolResponse {
  match: (sql: string, params: unknown[]) => boolean;
  rows: unknown[] | (() => unknown[]);
  rowCount?: number;
  once?: boolean;
}

function createSharedPool(initialResponses: PoolResponse[], state: { scheduled: SimScheduledGame[] }) {
  const queue = initialResponses.slice();
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  const runQuery = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });

    // Catch scheduler's INSERT INTO app_game1_scheduled_games → simulate
    // row persistence slik at senere SELECT kan finne den.
    if (sql.includes("INSERT INTO") && sql.includes("app_game1_scheduled_games")) {
      // params[16] er game_config_json (17-param-layouten).
      const row: SimScheduledGame = {
        id: params[0] as string,
        status: "scheduled",
        ticket_config_json: typeof params[10] === "string" ? JSON.parse(params[10]) : {},
        game_config_json: typeof params[16] === "string" ? JSON.parse(params[16]) : null,
        room_code: null,
      };
      state.scheduled.push(row);
      return { rows: [], rowCount: 1 };
    }

    // Catch draw-engine's FOR UPDATE on scheduled_games.
    if (sql.includes("FOR UPDATE") && sql.includes("scheduled_games") && !sql.includes("app_game1_game_state")) {
      const id = params[0] as string;
      const row = state.scheduled.find((r) => r.id === id);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    // Match preset responses.
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

function makeFakeWallet(): { adapter: WalletAdapter; credits: Array<{ accountId: string; amount: number }> } {
  const credits: Array<{ accountId: string; amount: number }> = [];
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
    async credit(accountId, amount) {
      credits.push({ accountId, amount });
      const tx: WalletTransaction = {
        id: `wtx-${++txCounter}`, accountId, type: "CREDIT", amount,
        reason: "test", createdAt: new Date().toISOString(),
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

// ── The E2E test ──────────────────────────────────────────────────────

test("E2E: admin GM.config.spill1 → scheduler spawn → drawEngine per-farge-utbetaling", async () => {
  // 1. Admin-UI ville skrevet denne konfigen til GameManagement.config_json.
  const gmConfig = {
    spill1: {
      ticketColors: [
        {
          color: "small_white",
          priceNok: 20,
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            full_house: { mode: "fixed", amount: 1000 },
          },
        },
        {
          color: "small_yellow",
          priceNok: 20,
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 50 },
            full_house: { mode: "fixed", amount: 500 },
          },
        },
      ],
    },
  };

  const sharedState = { scheduled: [] as SimScheduledGame[] };

  // Fremtidig scheduled_game-id vi forventer at scheduler spawner (én INSERT).
  const fixedNow = Date.parse("2026-05-01T10:00:00.000Z");

  // 2. Scheduler setup: mock daily_schedules + schedules + GM-query.
  const schedulerResponses: PoolResponse[] = [
    {
      match: (s) => s.includes("FROM ") && s.includes("app_daily_schedules"),
      rows: [{
        id: "daily-e2e",
        name: "E2E plan",
        hall_ids_json: { masterHallId: "hall-m", hallIds: ["hall-m"], groupHallIds: ["group-1"] },
        week_days: 0,
        start_date: "2026-05-01T00:00:00.000Z",
        end_date: "2026-05-10T23:59:59.000Z",
        start_time: "09:00",
        end_time: "23:00",
        status: "running",
        stop_game: false,
        other_data_json: { scheduleId: "sid-e2e" },
        game_management_id: "gm-e2e",
      }],
    },
    {
      match: (s) => s.includes("FROM ") && s.includes("app_schedules"),
      rows: [{
        id: "sid-e2e",
        schedule_type: "Manual",
        sub_games_json: [{
          name: "Spill 1",
          startTime: "19:00",
          endTime: "19:45",
          notificationStartTime: "5m",
          ticketTypesData: {},
          jackpotData: {},
        }],
      }],
    },
    {
      match: (s) => s.includes("FROM ") && s.includes("app_game_management"),
      rows: [{ id: "gm-e2e", config_json: gmConfig }],
    },
    { match: (s) => s.includes("SELECT daily_schedule_id"), rows: [] },
  ];

  const { pool } = createSharedPool(schedulerResponses, sharedState);

  // 3. Kjør scheduler-tick.
  const scheduler = Game1ScheduleTickService.forTesting(pool as unknown as import("pg").Pool);
  const spawnResult = await scheduler.spawnUpcomingGame1Games(fixedNow);
  assert.ok(spawnResult.spawned >= 1, "scheduler skal spawne minst én rad");
  assert.ok(sharedState.scheduled.length >= 1, "delt state skal ha scheduled-row");

  // Verifiser at game_config_json ble kopiert korrekt.
  const spawned = sharedState.scheduled[0]!;
  assert.deepEqual(
    spawned.game_config_json, gmConfig,
    "spawned scheduled_game.game_config_json = GM.config_json (1:1)"
  );

  // 4. Draw-engine setup: bruker SAMME pool men med egne responser for
  //    state-lesing og payout-queries.
  const { adapter: wallet, credits } = makeFakeWallet();
  const payoutService = new Game1PayoutService({
    walletAdapter: wallet,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
  });
  const jackpotService = new Game1JackpotService();

  const winningGrid = [
    1, 2, 3, 4, 5,
    6, 7, 8, 9, 10,
    11, 12, 0, 13, 14,
    15, 16, 17, 18, 19,
    20, 21, 22, 23, 24,
  ];
  const row0Marked = [
    true, true, true, true, true,
    false, false, false, false, false,
    false, false, true, false, false,
    false, false, false, false, false,
    false, false, false, false, false,
  ];

  // Oppdater scheduled_game.status → 'running' (normally done via master-start).
  spawned.status = "running";

  // Append draw-engine-responser direkte til shared pool.
  const drawEngineResponses: PoolResponse[] = [
    { match: (s) => s.startsWith("BEGIN"), rows: [], once: false },
    {
      match: (s) => s.includes("app_game1_game_state") && s.includes("FOR UPDATE"),
      rows: [{
        scheduled_game_id: spawned.id,
        draw_bag_json: [5, 11, 22],
        draws_completed: 0,
        current_phase: 1,
        last_drawn_ball: null,
        last_drawn_at: null,
        next_auto_draw_at: null,
        paused: false,
        engine_started_at: "2026-04-21T12:00:00.000Z",
        engine_ended_at: null,
      }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_draws"), rows: [] },
    {
      match: (s) => s.includes("FROM") && s.includes("app_game1_ticket_assignments") && s.includes("FOR UPDATE"),
      rows: [
        { id: "a-alice", grid_numbers_json: winningGrid, markings_json: { marked: row0Marked } },
        { id: "a-bob", grid_numbers_json: winningGrid, markings_json: { marked: row0Marked } },
      ],
    },
    {
      match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_ticket_assignments") && s.includes("markings_json"),
      rows: [], once: false,
    },
    {
      match: (s) =>
        s.includes("SELECT id, grid_numbers_json, markings_json, buyer_user_id") &&
        s.includes("app_game1_ticket_assignments"),
      rows: [
        {
          id: "a-alice", grid_numbers_json: winningGrid, markings_json: { marked: row0Marked },
          buyer_user_id: "u-alice", hall_id: "hall-a", ticket_color: "small_white",
        },
        {
          id: "a-bob", grid_numbers_json: winningGrid, markings_json: { marked: row0Marked },
          buyer_user_id: "u-bob", hall_id: "hall-a", ticket_color: "small_yellow",
        },
      ],
    },
    { match: (s) => s.includes("wallet_id") && s.includes("app_users"), rows: [{ wallet_id: "w-alice" }], once: true },
    { match: (s) => s.includes("wallet_id") && s.includes("app_users"), rows: [{ wallet_id: "w-bob" }], once: true },
    { match: (s) => s.includes("COALESCE(SUM(total_amount_cents)") && s.includes("app_game1_ticket_purchases"), rows: [{ pot_cents: 0 }] },
    { match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_phase_winners"), rows: [], once: false },
    { match: (s) => s.trim().startsWith("UPDATE") && s.includes("app_game1_game_state"), rows: [] },
    {
      match: (s) => s.includes("SELECT") && s.includes("app_game1_game_state"),
      rows: [{
        scheduled_game_id: spawned.id,
        draw_bag_json: [5, 11, 22],
        draws_completed: 1,
        current_phase: 2,
        last_drawn_ball: 5,
        last_drawn_at: "2026-04-21T12:01:00.000Z",
        next_auto_draw_at: null,
        paused: false,
        engine_started_at: "2026-04-21T12:00:00.000Z",
        engine_ended_at: null,
      }],
    },
    { match: (s) => s.includes("FROM") && s.includes("app_game1_draws"), rows: [{ draw_sequence: 1, ball_value: 5, drawn_at: "2026-04-21T12:01:00.000Z" }] },
    { match: (s) => s.startsWith("COMMIT"), rows: [], once: false },
  ];

  // Spin up en ny shared-pool som bare bruker draw-engine-responses
  // + reuses sharedState for scheduled_games-oppslag.
  const { pool: enginePool } = createSharedPool(drawEngineResponses, sharedState);

  const drawEngine = new Game1DrawEngineService({
    pool: enginePool as never,
    ticketPurchaseService: {
      async listPurchasesForGame() { return []; },
    } as unknown as Game1TicketPurchaseService,
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    payoutService,
    jackpotService,
  });

  // 5. Draw neste kule → skal utløse fase 1-win for begge vinnere.
  await drawEngine.drawNext(spawned.id);

  // 6. Verifiser: Alice (white) fikk 100 kr, Bob (yellow) fikk 50 kr
  //    — per-farge-matriser fra GM.config.spill1 levde hele veien fra
  //    admin-UI gjennom scheduler til engine.
  assert.equal(credits.length, 2, "to wallet-credit-kall — én per vinner");
  const alice = credits.find((c) => c.accountId === "w-alice");
  const bob = credits.find((c) => c.accountId === "w-bob");
  assert.ok(alice, "Alice skal ha credit");
  assert.ok(bob, "Bob skal ha credit");
  assert.equal(
    alice!.amount, 100,
    "Alice (small_white) får 100 kr — matcher GM.config.spill1.ticketColors[small_white].prizePerPattern.row_1.amount"
  );
  assert.equal(
    bob!.amount, 50,
    "Bob (small_yellow) får 50 kr — matcher GM.config.spill1.ticketColors[small_yellow].prizePerPattern.row_1.amount"
  );
});
