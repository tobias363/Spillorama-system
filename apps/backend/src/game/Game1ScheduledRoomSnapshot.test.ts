import assert from "node:assert/strict";
import test from "node:test";
import type { RoomSnapshot } from "./types.js";
import { enrichScheduledGame1RoomSnapshot } from "./Game1ScheduledRoomSnapshot.js";

const baseSnapshot: RoomSnapshot = {
  code: "BINGO_DEMO-DEFAULT-GOH",
  hallId: "hall-default",
  hostPlayerId: "host",
  gameSlug: "bingo",
  createdAt: "2026-05-11T12:00:00.000Z",
  players: [
    { id: "player-1", name: "Demo", walletId: "wallet-1", balance: 1000 },
  ],
  gameHistory: [],
};

test("enrichScheduledGame1RoomSnapshot injects DB draw baseline for active scheduled Spill 1 room", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("app_game1_game_state")) {
        return {
          rows: [
            {
              id: "sg-1",
              status: "running",
              ticket_config_json: { ticketTypesData: [{ priceCentsEach: 1000 }] },
              actual_start_time: "2026-05-11T12:01:00.000Z",
              actual_end_time: null,
              pause_reason: null,
              draw_bag_json: [11, 22, 33, 44],
              draws_completed: 2,
              paused: false,
              engine_started_at: "2026-05-11T12:01:00.000Z",
              engine_ended_at: null,
            },
          ],
        };
      }
      if (sql.includes("app_game1_ticket_purchases")) {
        return { rows: [] };
      }
      if (sql.includes("app_game1_draws")) {
        return {
          rows: [
            { ball_value: 11 },
            { ball_value: 22 },
          ],
        };
      }
      return {
        rows: [
          {
            player_id: "wallet-1",
            ticket_color: "yellow",
            ticket_size: "small",
            grid_numbers_json: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
            markings_json: { marked: [false, false, false, false, false, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false, false, true, false, false, false] },
          },
        ],
      };
    },
  };

  const enriched = await enrichScheduledGame1RoomSnapshot(baseSnapshot, {
    pool: pool as never,
  });

  assert.equal(enriched.currentGame?.id, "sg-1");
  assert.equal(enriched.currentGame?.status, "RUNNING");
  assert.deepEqual(enriched.currentGame?.drawnNumbers, [11, 22]);
  assert.deepEqual(enriched.currentGame?.drawBag, [33, 44]);
  assert.equal(enriched.currentGame?.remainingNumbers, 2);
  assert.equal(enriched.currentGame?.tickets["player-1"]?.length, 1);
  assert.deepEqual(enriched.currentGame?.tickets["player-1"]?.[0]?.grid[2], [11, 12, 0, 13, 14]);
  assert.deepEqual(enriched.currentGame?.marks["player-1"], [[11, 21]]);
  assert.deepEqual(enriched.currentGame?.participatingPlayerIds, ["player-1"]);
  assert.deepEqual(queries.map((query) => query.params), [
    ["BINGO_DEMO-DEFAULT-GOH"],
    ["sg-1"],
    ["sg-1"],
    ["sg-1"],
  ]);
});

test("enrichScheduledGame1RoomSnapshot projects pre-start scheduled purchases into pre-round payload fields", async () => {
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("app_game1_scheduled_games")) {
        return {
          rows: [
            {
              id: "sg-ready",
              status: "ready_to_start",
              ticket_config_json: { ticketTypesData: [{ priceCentsEach: 1000 }] },
              actual_start_time: null,
              actual_end_time: null,
              pause_reason: null,
              draw_bag_json: null,
              draws_completed: null,
              paused: null,
              engine_started_at: null,
              engine_ended_at: null,
            },
          ],
        };
      }
      if (sql.includes("app_game1_ticket_purchases")) {
        return {
          rows: [
            {
              id: "purchase-1",
              player_id: "wallet-1",
              buyer_user_id: "user-1",
              hall_id: "hall-default",
              ticket_spec_json: [{ color: "yellow", size: "small", count: 1 }],
              total_amount_cents: 1000,
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO")) {
        return { rows: [] };
      }
      if (sql.includes("app_game1_draws")) {
        return { rows: [] };
      }
      return {
        rows: [
          {
            player_id: "wallet-1",
            ticket_color: "yellow",
            ticket_size: "small",
            grid_numbers_json: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
            markings_json: { marked: [false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false, false] },
          },
        ],
      };
    },
  };

  const enriched = await enrichScheduledGame1RoomSnapshot(baseSnapshot, {
    pool: pool as never,
  });
  const projection = (enriched as { __scheduledGame1Projection?: {
    preRoundTickets: Record<string, unknown[]>;
    armedPlayerIds: string[];
    playerStakes: Record<string, number>;
  } }).__scheduledGame1Projection;

  assert.equal(enriched.currentGame, undefined);
  assert.equal(projection?.preRoundTickets["player-1"]?.length, 1);
  assert.deepEqual(projection?.armedPlayerIds, ["player-1"]);
  assert.equal(projection?.playerStakes["player-1"], 10);
});

test("enrichScheduledGame1RoomSnapshot leaves non-bingo rooms untouched", async () => {
  let called = false;
  const snapshot: RoomSnapshot = {
    ...baseSnapshot,
    gameSlug: "rocket",
  };
  const enriched = await enrichScheduledGame1RoomSnapshot(snapshot, {
    pool: {
      query: async () => {
        called = true;
        return { rows: [] };
      },
    } as never,
  });

  assert.equal(enriched, snapshot);
  assert.equal(called, false);
});
