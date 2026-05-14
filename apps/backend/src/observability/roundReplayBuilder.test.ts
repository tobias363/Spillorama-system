/**
 * Tester for RoundReplayBuilder (Tobias-direktiv 2026-05-14).
 *
 * Dekker (per spec):
 *   1. Komplett runde med 0 anomalier → tom anomalies[]
 *   2. Payout-mismatch (yellow=100 i stedet for 200) → 1 anomaly
 *   3. Missing advance → 1 anomaly
 *   4. Stuck plan-run → 1 anomaly
 *   5. Tidsserie sortert kronologisk
 *   6. Summary aggregerer korrekt fra timeline-data
 *
 * I tillegg:
 *   - SCHEDULED_GAME_NOT_FOUND error
 *   - Fail-soft ved DB-feil i én kilde
 *   - Bridge-form vs catalog-form (auto-mult skalering)
 *   - double_stake-anomaly
 *   - preparing_room_hang-anomaly
 *
 * Vi mock-er Pool og injisererer en deterministisk `now()` slik at
 * timestamps er stable. Bygg-input er rader som matcher faktisk DB-skjema.
 */

import { test } from "node:test";
import * as assert from "node:assert/strict";
import type { Pool } from "pg";
import { RoundReplayBuilder } from "./roundReplayBuilder.js";

// ────────────────────────────────────────────────────────────────────────
// Test-fixtures: deterministic timestamps og catalog-data
// ────────────────────────────────────────────────────────────────────────

const T0 = new Date("2026-05-14T08:44:20.000Z");
const T0_ms = T0.getTime();

function tAt(deltaMs: number): Date {
  return new Date(T0_ms + deltaMs);
}

function fixedNow(deltaMs: number = 60_000): () => Date {
  return () => tAt(deltaMs);
}

/**
 * Katalog-entry for Bingo med auto-multiplikator:
 *   Rad 1 base = 100 kr (10000 øre)
 *   Rad 2 base = 200 kr (20000 øre)
 *   Bingo base = 1000 kr (100000 øre)
 *   Hvit 5kr → ×1, Gul 10kr → ×2, Lilla 15kr → ×3
 */
const BINGO_CATALOG_ROW = {
  id: "cat-bingo-1",
  slug: "bingo",
  display_name: "Bingo",
  rules: { gameVariant: "standard" },
  ticket_colors: ["hvit", "gul", "lilla"],
  ticket_prices_cents: { hvit: 500, gul: 1000, lilla: 1500 },
  prizes_cents: {
    rad1: 10000,
    rad2: 20000,
    rad3: 30000,
    rad4: 40000,
    bingoBase: 100000,
    bingo: {},
  },
  prize_multiplier_mode: "auto",
  bonus_game_slug: null,
  bonus_game_enabled: false,
  requires_jackpot_setup: false,
  is_active: true,
  sort_order: 1,
};

// ────────────────────────────────────────────────────────────────────────
// Pool-mock: ruterer queries til faste responses basert på SQL-substring
// ────────────────────────────────────────────────────────────────────────

interface MockRows {
  scheduledGame?: Record<string, unknown> | null;
  planRun?: Record<string, unknown> | null;
  catalog?: Record<string, unknown> | null;
  purchases?: Array<Record<string, unknown>>;
  draws?: Array<Record<string, unknown>>;
  winners?: Array<Record<string, unknown>>;
  masterAudit?: Array<Record<string, unknown>>;
  ledger?: Array<Record<string, unknown>>;
  outboxStatus?: Array<Record<string, unknown>>;
  /** Hvis satt: kast feil ved query som matcher SUBSTRING. */
  throwOnSql?: string;
}

function makePool(rows: MockRows): Pool {
  return {
    query: async (sql: string) => {
      if (rows.throwOnSql && sql.includes(rows.throwOnSql)) {
        throw new Error(`intentional query failure for: ${rows.throwOnSql}`);
      }
      // Most-specific først (legacy ENGINE-prinsipp).
      if (
        sql.includes("app_game1_scheduled_games") &&
        !sql.includes("app_game_plan_run") &&
        !sql.includes("app_game_catalog")
      ) {
        return {
          rows: rows.scheduledGame != null ? [rows.scheduledGame] : [],
        };
      }
      if (sql.includes("app_game_plan_run")) {
        return { rows: rows.planRun != null ? [rows.planRun] : [] };
      }
      if (sql.includes("app_game_catalog")) {
        return { rows: rows.catalog != null ? [rows.catalog] : [] };
      }
      if (sql.includes("app_game1_ticket_purchases")) {
        return { rows: rows.purchases ?? [] };
      }
      if (sql.includes("app_game1_draws")) {
        return { rows: rows.draws ?? [] };
      }
      if (sql.includes("app_game1_phase_winners")) {
        return { rows: rows.winners ?? [] };
      }
      if (sql.includes("app_game1_master_audit")) {
        return { rows: rows.masterAudit ?? [] };
      }
      if (sql.includes("app_rg_compliance_ledger")) {
        return { rows: rows.ledger ?? [] };
      }
      if (sql.includes("app_compliance_outbox")) {
        return { rows: rows.outboxStatus ?? [] };
      }
      return { rows: [] };
    },
  } as unknown as Pool;
}

function baseScheduledGameRow(overrides: Record<string, unknown> = {}): Record<
  string,
  unknown
> {
  return {
    id: "sched-1",
    daily_schedule_id: "ds-1",
    schedule_id: "s-1",
    sub_game_index: 0,
    sub_game_name: "Bingo",
    custom_game_name: null,
    scheduled_day: "2026-05-14",
    scheduled_start_time: tAt(0),
    scheduled_end_time: tAt(60 * 60 * 1000),
    ticket_config_json: {},
    jackpot_config_json: {},
    game_mode: "Manual",
    master_hall_id: "demo-hall-001",
    group_hall_id: "goh-1",
    participating_halls_json: ["demo-hall-001"],
    status: "completed",
    actual_start_time: tAt(500),
    actual_end_time: tAt(45_000),
    started_by_user_id: "agent-1",
    stopped_by_user_id: null,
    stop_reason: null,
    catalog_entry_id: "cat-bingo-1",
    plan_run_id: "pr-1",
    plan_position: 1,
    room_code: "BINGO_DEMO",
    created_at: tAt(-1000),
    updated_at: tAt(45_000),
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

test("Test 1: komplett runde med riktige payouts → 0 anomalier", async () => {
  const pool = makePool({
    scheduledGame: baseScheduledGameRow(),
    planRun: {
      id: "pr-1",
      plan_id: "p-1",
      hall_id: "demo-hall-001",
      business_date: "2026-05-14",
      current_position: 1,
      status: "finished",
      jackpot_overrides_json: {},
      started_at: tAt(500),
      finished_at: tAt(45_500),
      master_user_id: "agent-1",
      created_at: tAt(0),
      updated_at: tAt(45_500),
    },
    catalog: BINGO_CATALOG_ROW,
    purchases: [
      {
        id: "p-1",
        scheduled_game_id: "sched-1",
        buyer_user_id: "user-1",
        hall_id: "demo-hall-001",
        ticket_spec_json: [{ color: "hvit", size: "small", count: 1 }],
        total_amount_cents: 500,
        payment_method: "digital_wallet",
        agent_user_id: null,
        purchased_at: tAt(100),
        refunded_at: null,
        refund_reason: null,
      },
    ],
    draws: Array.from({ length: 47 }, (_, i) => ({
      id: `d-${i + 1}`,
      scheduled_game_id: "sched-1",
      draw_sequence: i + 1,
      ball_value: i + 1,
      drawn_at: tAt(1000 + i * 500),
      current_phase_at_draw: i < 10 ? 1 : i < 20 ? 2 : i < 30 ? 3 : i < 40 ? 4 : 5,
    })),
    winners: [
      // Hvit 5kr vinner Rad 1 → expected = 100 kr × 1 = 100 kr.
      {
        id: "w-1",
        scheduled_game_id: "sched-1",
        assignment_id: "a-1",
        winner_user_id: "user-1",
        hall_id: "demo-hall-001",
        phase: 1,
        draw_sequence_at_win: 10,
        prize_amount_cents: 10000,
        total_phase_prize_cents: 10000,
        winner_brett_count: 1,
        ticket_color: "hvit",
        wallet_transaction_id: "wt-1",
        loyalty_points_awarded: null,
        jackpot_amount_cents: null,
        created_at: tAt(6000),
      },
    ],
    masterAudit: [
      {
        id: "ma-1",
        game_id: "sched-1",
        action: "start",
        actor_user_id: "agent-1",
        actor_hall_id: "demo-hall-001",
        group_hall_id: "goh-1",
        halls_ready_snapshot: {},
        metadata_json: {},
        created_at: tAt(400),
      },
    ],
    ledger: [],
    outboxStatus: [{ status: "processed", cnt: 5 }],
  });
  const builder = new RoundReplayBuilder(pool, { now: fixedNow() });
  const replay = await builder.build("sched-1");
  assert.equal(replay.scheduledGameId, "sched-1");
  assert.equal(replay.anomalies.length, 0, JSON.stringify(replay.anomalies));
  assert.equal(replay.summary.draws.total, 47);
  assert.equal(replay.summary.winners.length, 1);
  assert.equal(replay.summary.winners[0]!.match, true);
});

test("Test 2: payout-mismatch (gul Rad 1 utbetalt 100 i stedet for 200) → 1 anomaly", async () => {
  const pool = makePool({
    scheduledGame: baseScheduledGameRow(),
    planRun: null,
    catalog: BINGO_CATALOG_ROW,
    purchases: [],
    draws: [
      {
        id: "d-1",
        scheduled_game_id: "sched-1",
        draw_sequence: 1,
        ball_value: 1,
        drawn_at: tAt(1000),
        current_phase_at_draw: 1,
      },
    ],
    winners: [
      // Gul 10kr vinner Rad 1: expected = 100 kr × 2 = 200 kr (20000 øre).
      // Faktisk utbetalt: 100 kr (10000 øre) → MISMATCH.
      {
        id: "w-1",
        scheduled_game_id: "sched-1",
        assignment_id: "a-1",
        winner_user_id: "user-2",
        hall_id: "demo-hall-001",
        phase: 1,
        draw_sequence_at_win: 5,
        prize_amount_cents: 10000, // FEIL — burde være 20000
        total_phase_prize_cents: 10000,
        winner_brett_count: 1,
        ticket_color: "gul",
        wallet_transaction_id: "wt-2",
        loyalty_points_awarded: null,
        jackpot_amount_cents: null,
        created_at: tAt(3000),
      },
    ],
  });
  const builder = new RoundReplayBuilder(pool, { now: fixedNow() });
  const replay = await builder.build("sched-1");
  const mismatches = replay.anomalies.filter((a) => a.type === "payout_mismatch");
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0]!.severity, "critical");
  assert.equal(mismatches[0]!.details["actualCents"], 10000);
  assert.equal(mismatches[0]!.details["expectedCents"], 20000);
});

test("Test 3: missing-advance — plan-run finished på position 3 uten advance i audit → 1 info-anomaly", async () => {
  const pool = makePool({
    scheduledGame: baseScheduledGameRow({
      plan_position: 3,
    }),
    planRun: {
      id: "pr-1",
      plan_id: "p-1",
      hall_id: "demo-hall-001",
      business_date: "2026-05-14",
      current_position: 3,
      status: "finished",
      jackpot_overrides_json: {},
      started_at: tAt(500),
      finished_at: tAt(45_500),
      master_user_id: "agent-1",
      created_at: tAt(0),
      updated_at: tAt(45_500),
    },
    catalog: BINGO_CATALOG_ROW,
    draws: [
      {
        id: "d-1",
        scheduled_game_id: "sched-1",
        draw_sequence: 1,
        ball_value: 1,
        drawn_at: tAt(1000),
        current_phase_at_draw: 1,
      },
    ],
    masterAudit: [
      // Kun start — ingen advance.
      {
        id: "ma-1",
        game_id: "sched-1",
        action: "start",
        actor_user_id: "agent-1",
        actor_hall_id: "demo-hall-001",
        group_hall_id: "goh-1",
        halls_ready_snapshot: {},
        metadata_json: {},
        created_at: tAt(400),
      },
    ],
  });
  const builder = new RoundReplayBuilder(pool, { now: fixedNow() });
  const replay = await builder.build("sched-1");
  const missing = replay.anomalies.filter((a) => a.type === "missing_advance");
  assert.equal(missing.length, 1);
  assert.equal(missing[0]!.severity, "info");
  assert.equal(missing[0]!.details["position"], 3);
});

test("Test 4: stuck plan-run — completed > 30s siden men plan-run.running → 1 anomaly", async () => {
  const pool = makePool({
    scheduledGame: baseScheduledGameRow({
      status: "completed",
      actual_end_time: tAt(0),
    }),
    planRun: {
      id: "pr-1",
      plan_id: "p-1",
      hall_id: "demo-hall-001",
      business_date: "2026-05-14",
      current_position: 1,
      status: "paused", // ← ikke finished, ikke running heller
      jackpot_overrides_json: {},
      started_at: tAt(-1000),
      finished_at: null,
      master_user_id: "agent-1",
      created_at: tAt(-1000),
      updated_at: tAt(0),
    },
    catalog: BINGO_CATALOG_ROW,
  });
  // now = T0 + 60s — 60s siden actual_end_time = T0+0.
  const builder = new RoundReplayBuilder(pool, { now: fixedNow(60_000) });
  const replay = await builder.build("sched-1");
  const stuck = replay.anomalies.filter((a) => a.type === "stuck_plan_run");
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0]!.severity, "warn");
  assert.equal(stuck[0]!.details["deltaMs"], 60_000);
  assert.equal(stuck[0]!.details["planRunStatus"], "paused");
});

test("Test 5: timeline sortert kronologisk (alle events i riktig rekkefølge)", async () => {
  // Events spredt i tid: scheduled_game.created_at=T-1000, master.start=T+400,
  // purchase=T+100, draw=T+1000, winner=T+3000, master.stop=T+44000,
  // actual_end=T+45000.
  const pool = makePool({
    scheduledGame: baseScheduledGameRow(),
    planRun: null,
    catalog: BINGO_CATALOG_ROW,
    purchases: [
      {
        id: "p-1",
        scheduled_game_id: "sched-1",
        buyer_user_id: "user-1",
        hall_id: "demo-hall-001",
        ticket_spec_json: [{ color: "hvit", size: "small", count: 1 }],
        total_amount_cents: 500,
        payment_method: "digital_wallet",
        agent_user_id: null,
        purchased_at: tAt(100),
        refunded_at: null,
        refund_reason: null,
      },
    ],
    draws: [
      {
        id: "d-1",
        scheduled_game_id: "sched-1",
        draw_sequence: 1,
        ball_value: 1,
        drawn_at: tAt(1000),
        current_phase_at_draw: 1,
      },
    ],
    winners: [
      {
        id: "w-1",
        scheduled_game_id: "sched-1",
        assignment_id: "a-1",
        winner_user_id: "user-1",
        hall_id: "demo-hall-001",
        phase: 1,
        draw_sequence_at_win: 1,
        prize_amount_cents: 10000,
        total_phase_prize_cents: 10000,
        winner_brett_count: 1,
        ticket_color: "hvit",
        wallet_transaction_id: "wt-1",
        loyalty_points_awarded: null,
        jackpot_amount_cents: null,
        created_at: tAt(3000),
      },
    ],
    masterAudit: [
      {
        id: "ma-1",
        game_id: "sched-1",
        action: "start",
        actor_user_id: "agent-1",
        actor_hall_id: "demo-hall-001",
        group_hall_id: "goh-1",
        halls_ready_snapshot: {},
        metadata_json: {},
        created_at: tAt(400),
      },
      {
        id: "ma-2",
        game_id: "sched-1",
        action: "stop",
        actor_user_id: "agent-1",
        actor_hall_id: "demo-hall-001",
        group_hall_id: "goh-1",
        halls_ready_snapshot: {},
        metadata_json: {},
        created_at: tAt(44_000),
      },
    ],
  });
  const builder = new RoundReplayBuilder(pool, { now: fixedNow() });
  const replay = await builder.build("sched-1");
  // Verify chronological order.
  for (let i = 1; i < replay.timeline.length; i += 1) {
    assert.ok(
      replay.timeline[i]!.tsMs >= replay.timeline[i - 1]!.tsMs,
      `Timeline not sorted at index ${i}: ${replay.timeline[i - 1]!.ts} → ${replay.timeline[i]!.ts}`,
    );
  }
  // Verify all 6 event-types present.
  const types = new Set(replay.timeline.map((e) => e.type));
  assert.ok(types.has("scheduled_game_created"));
  assert.ok(types.has("ticket_purchase"));
  assert.ok(types.has("master_action"));
  assert.ok(types.has("draw"));
  assert.ok(types.has("phase_winner"));
  assert.ok(types.has("scheduled_game_completed"));
});

test("Test 6: summary aggregerer korrekt fra timeline-data", async () => {
  const pool = makePool({
    scheduledGame: baseScheduledGameRow(),
    planRun: null,
    catalog: BINGO_CATALOG_ROW,
    purchases: [
      {
        id: "p-1",
        scheduled_game_id: "sched-1",
        buyer_user_id: "user-1",
        hall_id: "demo-hall-001",
        ticket_spec_json: [
          { color: "hvit", size: "small", count: 5 },
          { color: "gul", size: "small", count: 10 },
        ],
        total_amount_cents: 12_500, // 5*500 + 10*1000
        payment_method: "digital_wallet",
        agent_user_id: null,
        purchased_at: tAt(100),
        refunded_at: null,
        refund_reason: null,
      },
      {
        id: "p-2",
        scheduled_game_id: "sched-1",
        buyer_user_id: "user-2",
        hall_id: "demo-hall-001",
        ticket_spec_json: [{ color: "lilla", size: "large", count: 3 }],
        total_amount_cents: 4500,
        payment_method: "cash_agent",
        agent_user_id: "agent-1",
        purchased_at: tAt(150),
        refunded_at: tAt(200), // refunded
        refund_reason: "test-refund",
      },
    ],
    draws: [
      {
        id: "d-1",
        scheduled_game_id: "sched-1",
        draw_sequence: 1,
        ball_value: 7,
        drawn_at: tAt(1000),
        current_phase_at_draw: 1,
      },
      {
        id: "d-2",
        scheduled_game_id: "sched-1",
        draw_sequence: 2,
        ball_value: 23,
        drawn_at: tAt(1500),
        current_phase_at_draw: 1,
      },
    ],
    winners: [],
    ledger: [
      {
        id: "l-1",
        created_at: tAt(2000),
        created_at_ms: T0_ms + 2000,
        hall_id: "demo-hall-001",
        game_type: "MAIN_GAME",
        channel: "INTERNET",
        event_type: "STAKE",
        amount: "125.00",
        currency: "NOK",
        game_id: "sched-1",
        claim_id: null,
        player_id: "user-1",
        wallet_id: "w-1",
      },
    ],
    outboxStatus: [
      { status: "processed", cnt: 5 },
      { status: "pending", cnt: 1 },
    ],
  });
  const builder = new RoundReplayBuilder(pool, { now: fixedNow() });
  const replay = await builder.build("sched-1");
  // Purchases-summary.
  assert.equal(replay.summary.purchases.totalCount, 2);
  assert.equal(replay.summary.purchases.totalCents, 17_000); // 12500 + 4500
  assert.equal(replay.summary.purchases.refundedCount, 1);
  assert.equal(replay.summary.purchases.byColorSize["hvit:small"], 5);
  assert.equal(replay.summary.purchases.byColorSize["gul:small"], 10);
  assert.equal(replay.summary.purchases.byColorSize["lilla:large"], 3);
  // Draws-summary.
  assert.equal(replay.summary.draws.total, 2);
  assert.equal(replay.summary.draws.uniqueBalls, 2);
  // Compliance-summary.
  assert.equal(replay.summary.compliance.ledgerEntries, 1);
  assert.equal(replay.summary.compliance.outboxProcessed, 5);
  assert.equal(replay.summary.compliance.outboxPending, 1);
});

test("kastet SCHEDULED_GAME_NOT_FOUND når raden ikke finnes", async () => {
  const pool = makePool({ scheduledGame: null });
  const builder = new RoundReplayBuilder(pool, { now: fixedNow() });
  await assert.rejects(
    () => builder.build("missing-sched"),
    (err: Error & { code?: string }) => err.code === "SCHEDULED_GAME_NOT_FOUND",
  );
});

test("fail-soft: DB-feil i én kilde feller ikke hele requesten", async () => {
  const pool = makePool({
    scheduledGame: baseScheduledGameRow(),
    throwOnSql: "app_game1_draws", // forsake bare draws-queryen
  });
  const builder = new RoundReplayBuilder(pool, { now: fixedNow() });
  const replay = await builder.build("sched-1");
  // Replay må fortsatt komme tilbake.
  assert.equal(replay.scheduledGameId, "sched-1");
  // Errors-felt skal inneholde draws-feilen.
  assert.ok(replay.errors["draws"]);
  // Draws-array skal være tom.
  assert.equal(replay.summary.draws.total, 0);
});

test("multi-vinner pot-deling: 2 gul-vinnere deler 200 kr = 100 kr hver, match=true", async () => {
  const pool = makePool({
    scheduledGame: baseScheduledGameRow(),
    catalog: BINGO_CATALOG_ROW,
    winners: [
      {
        id: "w-1",
        scheduled_game_id: "sched-1",
        assignment_id: "a-1",
        winner_user_id: "u-1",
        hall_id: "demo-hall-001",
        phase: 1,
        draw_sequence_at_win: 10,
        // 200 kr total / 2 vinnere = 100 kr hver (10000 øre).
        prize_amount_cents: 10000,
        total_phase_prize_cents: 20000,
        winner_brett_count: 2,
        ticket_color: "gul",
        wallet_transaction_id: "wt-1",
        loyalty_points_awarded: null,
        jackpot_amount_cents: null,
        created_at: tAt(3000),
      },
      {
        id: "w-2",
        scheduled_game_id: "sched-1",
        assignment_id: "a-2",
        winner_user_id: "u-2",
        hall_id: "demo-hall-001",
        phase: 1,
        draw_sequence_at_win: 10,
        prize_amount_cents: 10000,
        total_phase_prize_cents: 20000,
        winner_brett_count: 2,
        ticket_color: "gul",
        wallet_transaction_id: "wt-2",
        loyalty_points_awarded: null,
        jackpot_amount_cents: null,
        created_at: tAt(3000),
      },
    ],
  });
  const builder = new RoundReplayBuilder(pool, { now: fixedNow() });
  const replay = await builder.build("sched-1");
  // Begge vinnere skal være match=true (expected = 20000 / 2 = 10000).
  assert.equal(replay.summary.winners.length, 2);
  assert.equal(replay.summary.winners[0]!.match, true);
  assert.equal(replay.summary.winners[1]!.match, true);
  assert.equal(replay.summary.winners[0]!.expectedCents, 10000);
  // 0 anomalies for korrekt pot-deling.
  const mismatches = replay.anomalies.filter((a) => a.type === "payout_mismatch");
  assert.equal(mismatches.length, 0);
});

test("auto-multiplikator: lilla 15kr Bingo skal være 3000 kr (100000 × 3)", async () => {
  const pool = makePool({
    scheduledGame: baseScheduledGameRow(),
    catalog: BINGO_CATALOG_ROW,
    winners: [
      {
        id: "w-1",
        scheduled_game_id: "sched-1",
        assignment_id: "a-1",
        winner_user_id: "u-1",
        hall_id: "demo-hall-001",
        phase: 5, // Fullt Hus
        draw_sequence_at_win: 47,
        prize_amount_cents: 300000, // 3000 kr (riktig: 100000 × 3)
        total_phase_prize_cents: 300000,
        winner_brett_count: 1,
        ticket_color: "lilla",
        wallet_transaction_id: "wt-1",
        loyalty_points_awarded: null,
        jackpot_amount_cents: null,
        created_at: tAt(40_000),
      },
    ],
  });
  const builder = new RoundReplayBuilder(pool, { now: fixedNow() });
  const replay = await builder.build("sched-1");
  assert.equal(replay.summary.winners[0]!.match, true);
  assert.equal(replay.summary.winners[0]!.expectedCents, 300000);
});

test("double_stake: purchase=300 kr men ledger STAKE=200 kr → anomaly", async () => {
  const pool = makePool({
    scheduledGame: baseScheduledGameRow(),
    catalog: BINGO_CATALOG_ROW,
    purchases: [
      {
        id: "p-1",
        scheduled_game_id: "sched-1",
        buyer_user_id: "u-1",
        hall_id: "demo-hall-001",
        ticket_spec_json: [{ color: "hvit", size: "small", count: 60 }],
        total_amount_cents: 30000, // 300 kr
        payment_method: "digital_wallet",
        agent_user_id: null,
        purchased_at: tAt(100),
        refunded_at: null,
        refund_reason: null,
      },
    ],
    ledger: [
      {
        id: "l-1",
        created_at: tAt(2000),
        created_at_ms: T0_ms + 2000,
        hall_id: "demo-hall-001",
        game_type: "MAIN_GAME",
        channel: "INTERNET",
        event_type: "STAKE",
        amount: "200.00", // 200 kr — mismatch!
        currency: "NOK",
        game_id: "sched-1",
        claim_id: null,
        player_id: "u-1",
        wallet_id: "w-1",
      },
    ],
  });
  const builder = new RoundReplayBuilder(pool, { now: fixedNow() });
  const replay = await builder.build("sched-1");
  const doubles = replay.anomalies.filter((a) => a.type === "double_stake");
  assert.equal(doubles.length, 1);
  assert.equal(doubles[0]!.severity, "critical");
  assert.equal(doubles[0]!.details["purchaseCents"], 30000);
  assert.equal(doubles[0]!.details["stakeCents"], 20000);
});

test("preparing_room_hang: completed > 15s siden, plan-run.running → anomaly", async () => {
  const pool = makePool({
    scheduledGame: baseScheduledGameRow({
      status: "completed",
      actual_end_time: tAt(0),
    }),
    planRun: {
      id: "pr-1",
      plan_id: "p-1",
      hall_id: "demo-hall-001",
      business_date: "2026-05-14",
      current_position: 1,
      status: "running", // ← fortsatt running, ikke finished
      jackpot_overrides_json: {},
      started_at: tAt(-1000),
      finished_at: null,
      master_user_id: "agent-1",
      created_at: tAt(-1000),
      updated_at: tAt(0),
    },
    catalog: BINGO_CATALOG_ROW,
  });
  // now = T+20s — 20s siden actual_end_time.
  const builder = new RoundReplayBuilder(pool, { now: fixedNow(20_000) });
  const replay = await builder.build("sched-1");
  const hangs = replay.anomalies.filter((a) => a.type === "preparing_room_hang");
  assert.equal(hangs.length, 1);
  assert.equal(hangs[0]!.severity, "warn");
});

test("metadata: catalog-slug og display-name propageres riktig", async () => {
  const pool = makePool({
    scheduledGame: baseScheduledGameRow(),
    catalog: BINGO_CATALOG_ROW,
  });
  const builder = new RoundReplayBuilder(pool, { now: fixedNow() });
  const replay = await builder.build("sched-1");
  assert.equal(replay.metadata.catalogSlug, "bingo");
  assert.equal(replay.metadata.catalogDisplayName, "Bingo");
});

test("ingen catalog: replay fungerer men expected-prize er null (kan ikke verifisere)", async () => {
  const pool = makePool({
    scheduledGame: baseScheduledGameRow({ catalog_entry_id: null }),
    winners: [
      {
        id: "w-1",
        scheduled_game_id: "sched-1",
        assignment_id: "a-1",
        winner_user_id: "u-1",
        hall_id: "demo-hall-001",
        phase: 1,
        draw_sequence_at_win: 5,
        prize_amount_cents: 99999,
        total_phase_prize_cents: 99999,
        winner_brett_count: 1,
        ticket_color: "gul",
        wallet_transaction_id: null,
        loyalty_points_awarded: null,
        jackpot_amount_cents: null,
        created_at: tAt(3000),
      },
    ],
  });
  const builder = new RoundReplayBuilder(pool, { now: fixedNow() });
  const replay = await builder.build("sched-1");
  assert.equal(replay.summary.winners[0]!.expectedCents, null);
  assert.equal(replay.summary.winners[0]!.match, true); // null = ikke verifiserbar = no flag
  const mismatches = replay.anomalies.filter((a) => a.type === "payout_mismatch");
  assert.equal(mismatches.length, 0);
});
