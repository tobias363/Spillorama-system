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

/**
 * Tobias-bug 2026-05-14 (bong-pris=0 under aktiv trekning):
 *
 * `GamePlanEngineBridge.buildTicketConfigFromCatalog` skriver
 * `ticketTypesData[].pricePerTicket` (i øre), men `entryFeeFromTicketConfig`
 * leste KUN `priceCentsEach` før denne fix-en. Resultatet var at synthetic
 * scheduled-game-snapshot satte `currentGame.entryFee = 0`, som propagerte
 * via `gameVariant.entryFee` til klient. Klient `??`-fallback fanget ikke 0
 * (kun null/undefined) → alle bong-priser vises som "0 kr" under aktiv
 * trekning.
 *
 * Fix matcher `Game1TicketPurchaseService.extractTicketCatalog` som leser
 * alle 4 historiske felter (`priceCents`, `priceCentsEach`, `pricePerTicket`,
 * `price`).
 *
 * DB-evidens fra prod 2026-05-14:
 *   [{"size": "small", "color": "white", "pricePerTicket": 500}, ...]
 */
test("enrichScheduledGame1RoomSnapshot resolves currentGame.entryFee fra pricePerTicket (prod-format)", async () => {
  const pool = {
    query: async (sql: string) => {
      if (sql.includes("app_game1_game_state")) {
        return {
          rows: [
            {
              id: "sg-prod",
              status: "running",
              ticket_config_json: {
                ticketTypesData: [
                  { size: "small", color: "white", pricePerTicket: 500 },
                  { size: "large", color: "white", pricePerTicket: 1500 },
                  { size: "small", color: "yellow", pricePerTicket: 1000 },
                  { size: "large", color: "yellow", pricePerTicket: 3000 },
                  { size: "small", color: "purple", pricePerTicket: 1500 },
                  { size: "large", color: "purple", pricePerTicket: 4500 },
                ],
              },
              actual_start_time: "2026-05-14T12:00:00.000Z",
              actual_end_time: null,
              pause_reason: null,
              draw_bag_json: [1, 2, 3, 4, 5],
              draws_completed: 3,
              paused: false,
              engine_started_at: "2026-05-14T12:00:00.000Z",
              engine_ended_at: null,
            },
          ],
        };
      }
      if (sql.includes("app_game1_ticket_purchases")) return { rows: [] };
      if (sql.includes("app_game1_draws")) {
        return { rows: [{ ball_value: 1 }, { ball_value: 2 }, { ball_value: 3 }] };
      }
      return { rows: [] };
    },
  };

  const enriched = await enrichScheduledGame1RoomSnapshot(baseSnapshot, {
    pool: pool as never,
  });

  // priceCents=500 (5 kr) = minste pris → entryFee = 5
  // FØR FIX: entryFee = 0 fordi priceCentsEach ikke matchet pricePerTicket
  assert.equal(enriched.currentGame?.entryFee, 5,
    "currentGame.entryFee må være 5 kr (billigste bong = 500 øre / 100)");
});

test("enrichScheduledGame1RoomSnapshot resolves entryFee fra legacy priceCentsEach (backward-compat)", async () => {
  const pool = {
    query: async (sql: string) => {
      if (sql.includes("app_game1_game_state")) {
        return {
          rows: [
            {
              id: "sg-legacy",
              status: "running",
              ticket_config_json: {
                ticketTypesData: [
                  { size: "small", color: "white", priceCentsEach: 500 },
                  { size: "small", color: "yellow", priceCentsEach: 1000 },
                ],
              },
              actual_start_time: "2026-05-14T12:00:00.000Z",
              actual_end_time: null,
              pause_reason: null,
              draw_bag_json: [1, 2, 3],
              draws_completed: 1,
              paused: false,
              engine_started_at: "2026-05-14T12:00:00.000Z",
              engine_ended_at: null,
            },
          ],
        };
      }
      if (sql.includes("app_game1_ticket_purchases")) return { rows: [] };
      if (sql.includes("app_game1_draws")) return { rows: [{ ball_value: 1 }] };
      return { rows: [] };
    },
  };

  const enriched = await enrichScheduledGame1RoomSnapshot(baseSnapshot, {
    pool: pool as never,
  });

  // Legacy priceCentsEach=500 fortsatt støttet
  assert.equal(enriched.currentGame?.entryFee, 5);
});

test("ensureAssignmentsForPurchases multipliserer Stor X med 3 brett (Bug-fix 2026-05-15 iter 2)", async () => {
  // Bug-fix 2026-05-15 (iter 2): tidligere genererte enricher 1 rad per
  // spec.count uavhengig av size. 1 stor bong = 3 brett per §SPILL_REGLER §2,
  // så 1 Stor White-kjøp skal generere 3 rader i app_game1_ticket_assignments.
  // Frontend triple-grupperingen krever 3 fysiske brett for å vises som
  // ÉN visuell triple-container.
  const insertedRows: Array<{
    purchase_id: string;
    sequence_in_purchase: number;
    ticket_color: string;
    ticket_size: string;
  }> = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("app_game1_scheduled_games") && sql.includes("SELECT")) {
        return {
          rows: [
            {
              id: "sg-large",
              status: "ready_to_start",
              ticket_config_json: { ticketTypesData: [{ pricePerTicket: 500 }] },
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
        // Handlekurv: 1 Stor White + 1 Stor Yellow + 1 Stor Purple
        return {
          rows: [
            {
              id: "purchase-mixed-large",
              player_id: "wallet-1",
              buyer_user_id: "user-1",
              hall_id: "hall-default",
              ticket_spec_json: [
                { color: "white", size: "large", count: 1 },
                { color: "yellow", size: "large", count: 1 },
                { color: "purple", size: "large", count: 1 },
              ],
              total_amount_cents: 9000,
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO") && sql.includes("ticket_assignments")) {
        // Capture inserted row params for verification
        insertedRows.push({
          purchase_id: params[2] as string,
          sequence_in_purchase: params[8] as number,
          ticket_color: params[5] as string,
          ticket_size: params[6] as string,
        });
        return { rows: [] };
      }
      if (sql.includes("app_game1_draws")) return { rows: [] };
      // SELECT FROM ticket_assignments — return empty (snapshot won't have them)
      return { rows: [] };
    },
  };

  await enrichScheduledGame1RoomSnapshot(baseSnapshot, {
    pool: pool as never,
  });

  // 3 Stor-kjøp × 3 brett per stor = 9 INSERT-rader totalt
  assert.equal(
    insertedRows.length,
    9,
    `Forventet 9 rader (3 stor × 3 brett), fikk ${insertedRows.length}`,
  );

  // Sjekk farge-fordeling: 3 white + 3 yellow + 3 purple
  const whiteCount = insertedRows.filter((r) => r.ticket_color === "white").length;
  const yellowCount = insertedRows.filter((r) => r.ticket_color === "yellow").length;
  const purpleCount = insertedRows.filter((r) => r.ticket_color === "purple").length;
  assert.equal(whiteCount, 3, "3 brett av Stor White");
  assert.equal(yellowCount, 3, "3 brett av Stor Yellow");
  assert.equal(purpleCount, 3, "3 brett av Stor Purple");

  // Alle skal være ticket_size = "large"
  for (const row of insertedRows) {
    assert.equal(row.ticket_size, "large");
  }

  // Sjekk sekvens-numrene: 1-9, alle unike
  const sequences = insertedRows.map((r) => r.sequence_in_purchase).sort((a, b) => a - b);
  assert.deepEqual(sequences, [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // Alle skal dele samme purchaseId (handlekurv = ÉN purchase-rad)
  for (const row of insertedRows) {
    assert.equal(row.purchase_id, "purchase-mixed-large");
  }
});

test("ensureAssignmentsForPurchases liten X gir 1 rad per count (small ikke multiplisert)", async () => {
  // Liten X = 1 brett. spec.count=2 (kjøp 2 stk Liten Yellow) skal gi 2 rader.
  // Bug-fix 2026-05-15 (iter 2): regresjon-sjekk så small ikke regredieres.
  const insertedRows: Array<{
    sequence_in_purchase: number;
    ticket_size: string;
  }> = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("app_game1_scheduled_games") && sql.includes("SELECT")) {
        return {
          rows: [
            {
              id: "sg-small",
              status: "ready_to_start",
              ticket_config_json: { ticketTypesData: [{ pricePerTicket: 500 }] },
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
              id: "purchase-small",
              player_id: "wallet-1",
              buyer_user_id: "user-1",
              hall_id: "hall-default",
              ticket_spec_json: [{ color: "yellow", size: "small", count: 2 }],
              total_amount_cents: 2000,
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO") && sql.includes("ticket_assignments")) {
        insertedRows.push({
          sequence_in_purchase: params[8] as number,
          ticket_size: params[6] as string,
        });
        return { rows: [] };
      }
      if (sql.includes("app_game1_draws")) return { rows: [] };
      return { rows: [] };
    },
  };

  await enrichScheduledGame1RoomSnapshot(baseSnapshot, {
    pool: pool as never,
  });

  // spec.count=2 × 1 brett per Liten = 2 rader
  assert.equal(insertedRows.length, 2, "Liten X: 2 rader for count=2");
  for (const row of insertedRows) {
    assert.equal(row.ticket_size, "small");
  }
  assert.deepEqual(
    insertedRows.map((r) => r.sequence_in_purchase).sort((a, b) => a - b),
    [1, 2],
  );
});

test("enrichScheduledGame1RoomSnapshot returnerer 0 hvis ingen pris-felt finnes (defensive)", async () => {
  const pool = {
    query: async (sql: string) => {
      if (sql.includes("app_game1_game_state")) {
        return {
          rows: [
            {
              id: "sg-empty",
              status: "running",
              ticket_config_json: {
                ticketTypesData: [
                  { size: "small", color: "white" }, // INGEN price-felt
                ],
              },
              actual_start_time: "2026-05-14T12:00:00.000Z",
              actual_end_time: null,
              pause_reason: null,
              draw_bag_json: [1],
              draws_completed: 0,
              paused: false,
              engine_started_at: "2026-05-14T12:00:00.000Z",
              engine_ended_at: null,
            },
          ],
        };
      }
      if (sql.includes("app_game1_ticket_purchases")) return { rows: [] };
      if (sql.includes("app_game1_draws")) return { rows: [] };
      return { rows: [] };
    },
  };

  const enriched = await enrichScheduledGame1RoomSnapshot(baseSnapshot, {
    pool: pool as never,
  });

  // Når ingen pris-felt finnes må vi returnere 0 — `roomHelpers.currentEntryFee`
  // tar over med `> 0`-sjekk og faller til `getRoomConfiguredEntryFee` som
  // er autoritativ fra room-level config.
  assert.equal(enriched.currentGame?.entryFee, 0);
});
