/**
 * GAME1_SCHEDULE PR 2: unit-tester for Game1HallReadyService.
 *
 * Testene bruker en stub-pool som matcher mot SQL-fragment og returnerer
 * preset rader. Matcher testmønsteret i Game1ScheduleTickService.test.ts.
 *
 * Dekker:
 *   - markReady happy path + UPSERT ved gjenta trykk
 *   - markReady avviser hvis status ≠ purchase_open
 *   - markReady avviser hvis hall ikke er i participating_halls_json
 *   - unmarkReady happy path
 *   - unmarkReady avviser hvis status ≠ purchase_open
 *   - getReadyStatusForGame fyller ut defaults for haller uten rad
 *   - allParticipatingHallsReady (alle klare, noen excluded, ingen ready)
 *   - assertPurchaseOpenForHall kaster PURCHASE_CLOSED_FOR_HALL når
 *     is_ready=true + status=purchase_open; passerer ellers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import { Game1HallReadyService } from "./Game1HallReadyService.js";

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[];
  rowCount?: number;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queue = responses.slice();
  const queries: RecordedQuery[] = [];
  return {
    pool: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        for (let i = 0; i < queue.length; i++) {
          const r = queue[i]!;
          if (r.match(sql)) {
            queue.splice(i, 1);
            return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
          }
        }
        return { rows: [], rowCount: 0 };
      },
    },
    queries,
  };
}

function scheduledGameRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "g1",
    status: "purchase_open",
    participating_halls_json: ["hall-1", "hall-2"],
    group_hall_id: "grp-1",
    master_hall_id: "hall-1",
    ...overrides,
  };
}

function hallReadyRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    game_id: "g1",
    hall_id: "hall-2",
    is_ready: true,
    ready_at: "2026-04-21T10:00:00.000Z",
    ready_by_user_id: "user-bv",
    digital_tickets_sold: 5,
    physical_tickets_sold: 7,
    excluded_from_game: false,
    excluded_reason: null,
    created_at: "2026-04-21T09:50:00.000Z",
    updated_at: "2026-04-21T10:00:00.000Z",
    ...overrides,
  };
}

// ── markReady ───────────────────────────────────────────────────────────────

test("markReady happy path — UPSERT + returnerer rad", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow()],
    },
    {
      match: (s) => s.includes('FROM "public"."app_physical_tickets"'),
      rows: [{ cnt: "3" }],
    },
    {
      match: (s) => s.includes('INSERT INTO "public"."app_game1_hall_ready_status"'),
      rows: [hallReadyRow({ physical_tickets_sold: 3 })],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.markReady({
    gameId: "g1",
    hallId: "hall-2",
    userId: "user-bv",
    digitalTicketsSold: 5,
  });
  assert.equal(result.isReady, true);
  assert.equal(result.hallId, "hall-2");
  assert.equal(result.physicalTicketsSold, 3);
  assert.equal(result.digitalTicketsSold, 5);
});

test("markReady UPSERT-query inneholder ON CONFLICT DO UPDATE", async () => {
  const { pool, queries } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow()],
    },
    {
      match: (s) => s.includes('FROM "public"."app_physical_tickets"'),
      rows: [{ cnt: "0" }],
    },
    {
      match: (s) => s.includes("ON CONFLICT"),
      rows: [hallReadyRow()],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await svc.markReady({ gameId: "g1", hallId: "hall-2", userId: "u1" });
  const upsert = queries.find((q) =>
    q.sql.includes("ON CONFLICT (game_id, hall_id) DO UPDATE")
  );
  assert.ok(upsert, "forventet UPSERT-query med ON CONFLICT");
});

test("markReady avviser hvis status ≠ purchase_open", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow({ status: "running" })],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.markReady({ gameId: "g1", hallId: "hall-2", userId: "u1" }),
    (err) =>
      err instanceof DomainError &&
      err.code === "GAME_NOT_READY_ELIGIBLE"
  );
});

test("markReady avviser hvis hall ikke deltar", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow({ participating_halls_json: ["hall-x"] })],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.markReady({ gameId: "g1", hallId: "hall-2", userId: "u1" }),
    (err) =>
      err instanceof DomainError && err.code === "HALL_NOT_PARTICIPATING"
  );
});

test("markReady tillater master-hall selv uten participating-liste", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [
        scheduledGameRow({
          participating_halls_json: [],
          master_hall_id: "hall-1",
        }),
      ],
    },
    {
      match: (s) => s.includes('FROM "public"."app_physical_tickets"'),
      rows: [{ cnt: "0" }],
    },
    {
      match: (s) => s.includes("ON CONFLICT"),
      rows: [hallReadyRow({ hall_id: "hall-1" })],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.markReady({
    gameId: "g1",
    hallId: "hall-1",
    userId: "u1",
  });
  assert.equal(result.hallId, "hall-1");
});

test("markReady avviser hvis spill ikke finnes", async () => {
  const { pool } = createStubPool([]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.markReady({ gameId: "ghost", hallId: "hall-2", userId: "u1" }),
    (err) => err instanceof DomainError && err.code === "GAME_NOT_FOUND"
  );
});

// ── unmarkReady ─────────────────────────────────────────────────────────────

test("unmarkReady happy path", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow()],
    },
    {
      match: (s) => s.includes("UPDATE") && s.includes("is_ready   = false"),
      rows: [hallReadyRow({ is_ready: false, ready_at: null })],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.unmarkReady({
    gameId: "g1",
    hallId: "hall-2",
    userId: "u1",
  });
  assert.equal(result.isReady, false);
  assert.equal(result.readyAt, null);
});

test("unmarkReady avviser hvis status ≠ purchase_open", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow({ status: "ready_to_start" })],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.unmarkReady({ gameId: "g1", hallId: "hall-2", userId: "u1" }),
    (err) =>
      err instanceof DomainError &&
      err.code === "GAME_NOT_READY_ELIGIBLE"
  );
});

test("unmarkReady kaster READY_STATUS_NOT_FOUND hvis ingen eksisterende rad", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow()],
    },
    // UPDATE returnerer tom — ingen matching rad
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.unmarkReady({ gameId: "g1", hallId: "hall-2", userId: "u1" }),
    (err) =>
      err instanceof DomainError && err.code === "READY_STATUS_NOT_FOUND"
  );
});

// ── getReadyStatusForGame ───────────────────────────────────────────────────

test("getReadyStatusForGame fyller ut defaults for haller uten rad", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow({ participating_halls_json: ["hall-1", "hall-2"] })],
    },
    {
      match: (s) => s.includes("SELECT game_id"),
      rows: [hallReadyRow()], // only hall-2 has a row
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.getReadyStatusForGame("g1");
  assert.equal(result.length, 2);
  const byHall = new Map(result.map((r) => [r.hallId, r]));
  assert.equal(byHall.get("hall-1")!.isReady, false);
  assert.equal(byHall.get("hall-2")!.isReady, true);
});

test("getReadyStatusForGame inkluderer master-hall selv uten participating-oppføring", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [
        scheduledGameRow({
          participating_halls_json: ["hall-2"],
          master_hall_id: "hall-1",
        }),
      ],
    },
    {
      match: (s) => s.includes("SELECT game_id"),
      rows: [],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.getReadyStatusForGame("g1");
  const hallIds = result.map((r) => r.hallId).sort();
  assert.deepEqual(hallIds, ["hall-1", "hall-2"]);
});

// ── allParticipatingHallsReady ──────────────────────────────────────────────

test("allParticipatingHallsReady true når alle er klare", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow({ participating_halls_json: ["hall-1", "hall-2"] })],
    },
    {
      match: (s) => s.includes("SELECT game_id"),
      rows: [
        hallReadyRow({ hall_id: "hall-1", is_ready: true }),
        hallReadyRow({ hall_id: "hall-2", is_ready: true }),
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  assert.equal(await svc.allParticipatingHallsReady("g1"), true);
});

test("allParticipatingHallsReady teller ikke excluded haller", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow({ participating_halls_json: ["hall-1", "hall-2"] })],
    },
    {
      match: (s) => s.includes("SELECT game_id"),
      rows: [
        hallReadyRow({ hall_id: "hall-1", is_ready: true }),
        hallReadyRow({
          hall_id: "hall-2",
          is_ready: false,
          excluded_from_game: true,
        }),
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  assert.equal(await svc.allParticipatingHallsReady("g1"), true);
});

test("allParticipatingHallsReady false når en hall mangler ready-rad", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow({ participating_halls_json: ["hall-1", "hall-2"] })],
    },
    {
      match: (s) => s.includes("SELECT game_id"),
      rows: [hallReadyRow({ hall_id: "hall-1", is_ready: true })],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  assert.equal(await svc.allParticipatingHallsReady("g1"), false);
});

test("allParticipatingHallsReady false hvis alle haller er excluded (ingen kandidater)", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow({ participating_halls_json: ["hall-1", "hall-2"] })],
    },
    {
      match: (s) => s.includes("SELECT game_id"),
      rows: [
        hallReadyRow({ hall_id: "hall-1", excluded_from_game: true }),
        hallReadyRow({ hall_id: "hall-2", excluded_from_game: true }),
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  assert.equal(await svc.allParticipatingHallsReady("g1"), false);
});

// ── assertPurchaseOpenForHall ───────────────────────────────────────────────

test("assertPurchaseOpenForHall kaster PURCHASE_CLOSED_FOR_HALL når hall er ready", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes("LEFT JOIN"),
      rows: [{ is_ready: true, status: "purchase_open" }],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.assertPurchaseOpenForHall("g1", "hall-2"),
    (err) =>
      err instanceof DomainError &&
      err.code === "PURCHASE_CLOSED_FOR_HALL"
  );
});

test("assertPurchaseOpenForHall passerer når hall ikke er ready", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes("LEFT JOIN"),
      rows: [{ is_ready: false, status: "purchase_open" }],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await svc.assertPurchaseOpenForHall("g1", "hall-2"); // should not throw
});

test("assertPurchaseOpenForHall passerer for ukjent game (backward-compat)", async () => {
  const { pool } = createStubPool([]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await svc.assertPurchaseOpenForHall("ghost", "hall-2"); // should not throw
});

test("assertPurchaseOpenForHall passerer når game er i ready_to_start/running (lar game-session-logikk ta over)", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes("LEFT JOIN"),
      rows: [{ is_ready: true, status: "ready_to_start" }],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await svc.assertPurchaseOpenForHall("g1", "hall-2"); // should not throw
});
