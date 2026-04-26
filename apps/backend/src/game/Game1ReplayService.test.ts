/**
 * LOW-1: Tester for Game1ReplayService.
 *
 * Dekker:
 *   - happy-path: full event-stream rekonstruksjon med riktig sortering
 *   - GAME_NOT_FOUND: tomt pool-resultat → kaster med code GAME_NOT_FOUND
 *   - PII-redaction: e-post / display-name / walletId masket før retur
 *   - audit-action mapping: start/pause/resume/stop/exclude/include →
 *     riktig event-type
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1ReplayService,
  redactEmail,
  redactDisplayName,
  redactWalletId,
} from "./Game1ReplayService.js";

// ── Stub-pool ──────────────────────────────────────────────────────────────

interface QueryResult {
  rows: unknown[];
  rowCount: number;
}

interface StubResponses {
  /** SQL-substring → respons. Første match vinner. */
  matchers: Array<{ match: (sql: string) => boolean; respond: () => QueryResult }>;
}

function createStubPool(responses: StubResponses): {
  pool: { query: (sql: string, params?: unknown[]) => Promise<QueryResult> };
  recorded: Array<{ sql: string; params: unknown[] }>;
} {
  const recorded: Array<{ sql: string; params: unknown[] }> = [];
  return {
    pool: {
      async query(sql: string, params: unknown[] = []) {
        recorded.push({ sql, params });
        for (const m of responses.matchers) {
          if (m.match(sql)) return m.respond();
        }
        return { rows: [], rowCount: 0 };
      },
    },
    recorded,
  };
}

// ── Test 1: PII-redaction utility-funksjoner ───────────────────────────────

test("redactEmail: masker lokal-del, beholder domene", () => {
  assert.equal(redactEmail("alice.smith@example.com"), "a***@example.com");
  assert.equal(redactEmail("a@b.no"), "***@b.no");
  assert.equal(redactEmail("ab@b.no"), "a***@b.no");
  assert.equal(redactEmail(null), null);
  assert.equal(redactEmail(""), null);
});

test("redactDisplayName: bevarer fornavn, masker etternavn", () => {
  assert.equal(redactDisplayName("Alice Smith"), "Alice S***");
  assert.equal(redactDisplayName("Bob"), "B***");
  assert.equal(redactDisplayName("A"), "***");
  assert.equal(redactDisplayName("Anne Marie Olsen"), "Anne O***");
  assert.equal(redactDisplayName(null), null);
});

test("redactWalletId: beholder kun siste 4 tegn", () => {
  assert.equal(redactWalletId("wallet_abc123xyz9"), "wal_***xyz9");
  assert.equal(redactWalletId("abcd"), "***");
  assert.equal(redactWalletId("ab"), "***");
  assert.equal(redactWalletId(null), null);
});

// ── Test 2: GAME_NOT_FOUND ─────────────────────────────────────────────────

test("getReplay: spill ikke funnet → kaster GAME_NOT_FOUND", async () => {
  const { pool } = createStubPool({
    matchers: [
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_scheduled_games"),
        respond: () => ({ rows: [], rowCount: 0 }),
      },
    ],
  });
  const service = new Game1ReplayService({ pool: pool as never });

  await assert.rejects(
    () => service.getReplay("nonexistent"),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, "GAME_NOT_FOUND");
      return true;
    }
  );
});

// ── Test 3: Happy-path end-to-end replay ───────────────────────────────────

test("getReplay: full event-stream sortert + PII redacted", async () => {
  const gameId = "g1-replay";
  // Tidsstempler ordnet: created → purchase → start-audit → draw → win → end.
  const t0 = "2026-04-26T10:00:00.000Z"; // game created
  const t1 = "2026-04-26T10:05:00.000Z"; // first purchase
  const t2 = "2026-04-26T10:06:00.000Z"; // start-audit
  const t3 = "2026-04-26T10:06:30.000Z"; // first draw
  const t4 = "2026-04-26T10:07:00.000Z"; // phase win
  const t5 = "2026-04-26T10:07:05.000Z"; // mini-game triggered
  const t6 = "2026-04-26T10:07:30.000Z"; // mini-game completed
  const t7 = "2026-04-26T10:10:00.000Z"; // game ended

  const { pool } = createStubPool({
    matchers: [
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_scheduled_games"),
        respond: () => ({
          rows: [
            {
              id: gameId,
              status: "completed",
              scheduled_start_time: t0,
              scheduled_end_time: t7,
              actual_start_time: t2,
              actual_end_time: t7,
              master_hall_id: "hall-master",
              group_hall_id: "grp-1",
              participating_halls_json: ["hall-master", "hall-2"],
              excluded_hall_ids_json: [],
              sub_game_name: "Jackpot",
              custom_game_name: null,
              started_by_user_id: "u-master",
              stopped_by_user_id: null,
              stop_reason: null,
              created_at: t0,
            },
          ],
          rowCount: 1,
        }),
      },
      {
        match: (s) => s.includes("app_game1_master_audit"),
        respond: () => ({
          rows: [
            {
              id: "aud-1",
              action: "start",
              actor_user_id: "u-master",
              actor_hall_id: "hall-master",
              metadata_json: { confirmExcludedHalls: [] },
              halls_ready_snapshot: { "hall-master": { isReady: true } },
              created_at: t2,
            },
          ],
          rowCount: 1,
        }),
      },
      {
        match: (s) => s.includes("app_game1_ticket_purchases"),
        respond: () => ({
          rows: [
            {
              id: "p-1",
              buyer_user_id: "u-player1",
              buyer_email: "alice.smith@example.com",
              buyer_display_name: "Alice Smith",
              buyer_wallet_id: "wallet_abc123xyz9",
              hall_id: "hall-2",
              ticket_spec_json: [{ color: "yellow", size: "small", count: 2, price_cents_each: 2000 }],
              total_amount_cents: "4000",
              payment_method: "digital_wallet",
              agent_user_id: null,
              idempotency_key: "idem-key-1",
              purchased_at: t1,
              refunded_at: null,
              refund_reason: null,
              refund_transaction_id: null,
              wallet_transaction_id: "wt-debit-1",
            },
          ],
          rowCount: 1,
        }),
      },
      {
        match: (s) => s.includes("app_game1_draws"),
        respond: () => ({
          rows: [
            {
              id: "d-1",
              draw_sequence: 1,
              ball_value: 42,
              current_phase_at_draw: 1,
              drawn_at: t3,
            },
          ],
          rowCount: 1,
        }),
      },
      {
        match: (s) => s.includes("app_game1_phase_winners"),
        respond: () => ({
          rows: [
            {
              id: "w-1",
              assignment_id: "a-1",
              winner_user_id: "u-player1",
              winner_email: "alice.smith@example.com",
              winner_display_name: "Alice Smith",
              winner_wallet_id: "wallet_abc123xyz9",
              hall_id: "hall-2",
              phase: 5,
              draw_sequence_at_win: 1,
              prize_amount_cents: 50000,
              total_phase_prize_cents: 50000,
              winner_brett_count: 1,
              ticket_color: "yellow",
              wallet_transaction_id: "wt-credit-1",
              loyalty_points_awarded: 25,
              jackpot_amount_cents: null,
              created_at: t4,
            },
          ],
          rowCount: 1,
        }),
      },
      {
        match: (s) => s.includes("app_game1_mini_game_results"),
        respond: () => ({
          rows: [
            {
              id: "m-1",
              mini_game_type: "wheel",
              winner_user_id: "u-player1",
              winner_email: "alice.smith@example.com",
              winner_display_name: "Alice Smith",
              config_snapshot_json: { segments: 10 },
              choice_json: null,
              result_json: { segmentIndex: 3, prize: 1000 },
              payout_cents: 1000,
              triggered_at: t5,
              completed_at: t6,
            },
          ],
          rowCount: 1,
        }),
      },
    ],
  });

  const service = new Game1ReplayService({ pool: pool as never });
  const replay = await service.getReplay(gameId);

  // Meta
  assert.equal(replay.meta.scheduledGameId, gameId);
  assert.equal(replay.meta.status, "completed");
  assert.equal(replay.meta.masterHallId, "hall-master");
  assert.deepEqual(replay.meta.participatingHallIds, ["hall-master", "hall-2"]);

  // Events sortert kronologisk: room_created, player_joined, tickets_purchased,
  // game_started, draw, phase_won, payout, mini_game_triggered,
  // mini_game_completed, game_ended.
  const types = replay.events.map((e) => e.type);
  assert.deepEqual(types, [
    "room_created",
    "player_joined",
    "tickets_purchased",
    "game_started",
    "draw",
    "phase_won",
    "payout",
    "mini_game_triggered",
    "mini_game_completed",
    "game_ended",
  ]);

  // PII redaction-verifisering: ingen klartekst e-post/display-name skal
  // forekomme noe sted i payload.
  const fullJson = JSON.stringify(replay);
  assert.equal(fullJson.includes("alice.smith@example.com"), false,
    "klartekst e-post skal ikke lekke");
  assert.equal(fullJson.includes("Alice Smith"), false,
    "klartekst display-name skal ikke lekke");
  assert.equal(fullJson.includes("wallet_abc123xyz9"), false,
    "klartekst walletId skal ikke lekke");

  // Verifiser at masket form finnes der vi forventer.
  const joinEvent = replay.events.find((e) => e.type === "player_joined")!;
  assert.equal((joinEvent.data as Record<string, unknown>).email, "a***@example.com");
  assert.equal((joinEvent.data as Record<string, unknown>).displayName, "Alice S***");
  assert.equal((joinEvent.data as Record<string, unknown>).walletIdMasked, "wal_***xyz9");

  // Wallet-tx-mapping fungerer: tickets_purchased event har walletTransactionId.
  const purchaseEvent = replay.events.find((e) => e.type === "tickets_purchased")!;
  assert.equal((purchaseEvent.data as Record<string, unknown>).walletTransactionId, "wt-debit-1");
  assert.equal((purchaseEvent.data as Record<string, unknown>).idempotencyKey, "idem-key-1");

  // Phase-won event har redacted vinner-info + phaseLabel.
  const winEvent = replay.events.find((e) => e.type === "phase_won")!;
  assert.equal((winEvent.data as Record<string, unknown>).phase, 5);
  assert.equal((winEvent.data as Record<string, unknown>).phaseLabel, "Fullt Hus");
  assert.equal((winEvent.data as Record<string, unknown>).winnerEmail, "a***@example.com");

  // Payout-event har wallet-tx-ID for credit.
  const payoutEvent = replay.events.find((e) => e.type === "payout")!;
  assert.equal((payoutEvent.data as Record<string, unknown>).walletTransactionId, "wt-credit-1");
  assert.equal((payoutEvent.data as Record<string, unknown>).prizeAmountCents, 50000);

  // userId IKKE redacted (regulatorisk: nødvendig for ledger-korrelering).
  assert.equal((joinEvent.data as Record<string, unknown>).userId, "u-player1");
  assert.equal((winEvent.data as Record<string, unknown>).winnerUserId, "u-player1");

  // eventCount matcher
  assert.equal(replay.meta.eventCount, replay.events.length);
});

// ── Test 4: Audit-action-mapping ────────────────────────────────────────────

test("getReplay: audit-actions mappet til riktige event-typer", async () => {
  const gameId = "g1-audit";
  const baseTs = "2026-04-26T10:00:00.000Z";

  const { pool } = createStubPool({
    matchers: [
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_scheduled_games"),
        respond: () => ({
          rows: [
            {
              id: gameId,
              status: "cancelled",
              scheduled_start_time: baseTs,
              scheduled_end_time: baseTs,
              actual_start_time: baseTs,
              actual_end_time: baseTs,
              master_hall_id: "h-m",
              group_hall_id: "grp",
              participating_halls_json: ["h-m"],
              excluded_hall_ids_json: [],
              sub_game_name: "X",
              custom_game_name: null,
              started_by_user_id: "u",
              stopped_by_user_id: "u",
              stop_reason: "master_stop",
              created_at: baseTs,
            },
          ],
          rowCount: 1,
        }),
      },
      {
        match: (s) => s.includes("app_game1_master_audit"),
        respond: () => ({
          rows: [
            {
              id: "a-start",
              action: "start",
              actor_user_id: "u",
              actor_hall_id: "h-m",
              metadata_json: {},
              halls_ready_snapshot: {},
              created_at: "2026-04-26T10:01:00.000Z",
            },
            {
              id: "a-pause",
              action: "pause",
              actor_user_id: "u",
              actor_hall_id: "h-m",
              metadata_json: { reason: "tech-issue" },
              halls_ready_snapshot: {},
              created_at: "2026-04-26T10:02:00.000Z",
            },
            {
              id: "a-resume",
              action: "resume",
              actor_user_id: "u",
              actor_hall_id: "h-m",
              metadata_json: {},
              halls_ready_snapshot: {},
              created_at: "2026-04-26T10:03:00.000Z",
            },
            {
              id: "a-excl",
              action: "exclude_hall",
              actor_user_id: "u",
              actor_hall_id: "h-m",
              metadata_json: { hallId: "h-2", reason: "no-internet" },
              halls_ready_snapshot: {},
              created_at: "2026-04-26T10:04:00.000Z",
            },
            {
              id: "a-incl",
              action: "include_hall",
              actor_user_id: "u",
              actor_hall_id: "h-m",
              metadata_json: { hallId: "h-2" },
              halls_ready_snapshot: {},
              created_at: "2026-04-26T10:05:00.000Z",
            },
            {
              id: "a-stop",
              action: "stop",
              actor_user_id: "u",
              actor_hall_id: "h-m",
              metadata_json: { reason: "manual" },
              halls_ready_snapshot: {},
              created_at: "2026-04-26T10:06:00.000Z",
            },
          ],
          rowCount: 6,
        }),
      },
    ],
  });

  const service = new Game1ReplayService({ pool: pool as never });
  const replay = await service.getReplay(gameId);

  const types = replay.events.map((e) => e.type);
  // Forventet inkluderer (i kronologisk rekkefølge):
  //   room_created, game_started, game_paused, game_resumed,
  //   hall_excluded, hall_included, game_stopped, game_ended
  assert.ok(types.includes("game_started"));
  assert.ok(types.includes("game_paused"));
  assert.ok(types.includes("game_resumed"));
  assert.ok(types.includes("hall_excluded"));
  assert.ok(types.includes("hall_included"));
  assert.ok(types.includes("game_stopped"));
});
