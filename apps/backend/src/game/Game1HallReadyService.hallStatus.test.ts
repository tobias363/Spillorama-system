/**
 * TASK HS: unit-tester for hall-status fargekode + scan-flyt.
 *
 * Dekker:
 *   - computeHallStatus: rød / oransje / grønn for alle hovedkombinasjoner
 *   - recordStartScan happy path + idempotent re-scan
 *   - recordFinalScan happy path + soldCount = final_id - start_id
 *   - recordFinalScan: INVALID_SCAN_RANGE når final < start
 *   - recordFinalScan: START_SCAN_REQUIRED hvis start-scan ikke er utført
 *   - markReady: FINAL_SCAN_REQUIRED hvis fysiske bonger registrert uten slutt-scan
 *   - markReady: digital-only-hall (0 fysiske, ingen start-scan) tillates
 *   - getHallStatusForGame: beriket liste med alle feltene
 *   - Edge: samme bong to ganger på start → idempotent (ingen feil)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import {
  Game1HallReadyService,
  computeHallStatus,
  type HallReadyStatusRow,
} from "./Game1HallReadyService.js";

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

function baseRow(overrides: Partial<HallReadyStatusRow> = {}): HallReadyStatusRow {
  return {
    gameId: "g1",
    hallId: "hall-2",
    isReady: false,
    readyAt: null,
    readyByUserId: null,
    digitalTicketsSold: 0,
    physicalTicketsSold: 0,
    excludedFromGame: false,
    excludedReason: null,
    createdAt: "",
    updatedAt: "",
    startTicketId: null,
    startScannedAt: null,
    finalScanTicketId: null,
    finalScannedAt: null,
    ...overrides,
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

// ── computeHallStatus (ren logikk) ───────────────────────────────────────────

test("computeHallStatus: 0 spillere → rød", () => {
  const status = computeHallStatus(baseRow({ digitalTicketsSold: 0, physicalTicketsSold: 0 }));
  assert.equal(status.color, "red");
  assert.equal(status.playerCount, 0);
});

test("computeHallStatus: spillere + start-scan gjort + mangler final → oransje", () => {
  const status = computeHallStatus(
    baseRow({
      physicalTicketsSold: 5,
      startTicketId: "100",
      finalScanTicketId: null,
      isReady: false,
    })
  );
  assert.equal(status.color, "orange");
  assert.equal(status.playerCount, 5);
  assert.equal(status.startScanDone, true);
  assert.equal(status.finalScanDone, false);
});

test("computeHallStatus: spillere + final-scan + ikke klar → oransje", () => {
  const status = computeHallStatus(
    baseRow({
      physicalTicketsSold: 5,
      startTicketId: "100",
      finalScanTicketId: "105",
      isReady: false,
    })
  );
  assert.equal(status.color, "orange");
  assert.equal(status.finalScanDone, true);
  assert.equal(status.readyConfirmed, false);
});

test("computeHallStatus: alt komplett → grønn + soldCount = final - start", () => {
  const status = computeHallStatus(
    baseRow({
      physicalTicketsSold: 5,
      startTicketId: "100",
      finalScanTicketId: "105",
      isReady: true,
    })
  );
  assert.equal(status.color, "green");
  assert.equal(status.soldCount, 5);
});

test("computeHallStatus: digital-only hall (0 fysiske, ingen scan) → grønn når klar", () => {
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: 3,
      physicalTicketsSold: 0,
      startTicketId: null,
      isReady: true,
    })
  );
  assert.equal(status.color, "green");
  assert.equal(status.startScanDone, true, "digital-only regnes startScanDone=true");
  assert.equal(status.finalScanDone, true, "digital-only regnes finalScanDone=true");
});

test("computeHallStatus: digital-only hall uten ready → oransje", () => {
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: 3,
      physicalTicketsSold: 0,
      isReady: false,
    })
  );
  assert.equal(status.color, "orange");
});

test("computeHallStatus: soldCount = final - start (numerisk)", () => {
  const status = computeHallStatus(
    baseRow({
      physicalTicketsSold: 23,
      startTicketId: "12345",
      finalScanTicketId: "12368",
      isReady: true,
    })
  );
  assert.equal(status.soldCount, 23);
});

// ── recordStartScan ─────────────────────────────────────────────────────────

test("recordStartScan happy path — INSERT + returnerer rad med start_ticket_id", async () => {
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
      match: (s) =>
        s.includes('INSERT INTO "public"."app_game1_hall_ready_status"') &&
        s.includes("start_ticket_id"),
      rows: [
        {
          game_id: "g1",
          hall_id: "hall-2",
          is_ready: false,
          ready_at: null,
          ready_by_user_id: null,
          digital_tickets_sold: 0,
          physical_tickets_sold: 0,
          excluded_from_game: false,
          excluded_reason: null,
          created_at: "2026-04-24T10:00:00.000Z",
          updated_at: "2026-04-24T10:00:00.000Z",
          start_ticket_id: "12345",
          start_scanned_at: "2026-04-24T10:00:00.000Z",
          final_scan_ticket_id: null,
          final_scanned_at: null,
        },
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.recordStartScan({
    gameId: "g1",
    hallId: "hall-2",
    ticketId: "12345",
  });
  assert.equal(result.startTicketId, "12345");
  assert.equal(result.finalScanTicketId, null);
  const upsert = queries.find((q) => q.sql.includes("ON CONFLICT"));
  assert.ok(upsert, "UPSERT-query med ON CONFLICT for idempotent re-scan");
});

test("recordStartScan avviser tomt ticketId", async () => {
  const { pool } = createStubPool([]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.recordStartScan({ gameId: "g1", hallId: "hall-2", ticketId: "   " }),
    (err) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("recordStartScan avviser hvis spillet ikke er purchase_open", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow({ status: "running" })],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.recordStartScan({ gameId: "g1", hallId: "hall-2", ticketId: "12345" }),
    (err) => err instanceof DomainError && err.code === "GAME_NOT_READY_ELIGIBLE"
  );
});

// ── recordFinalScan ─────────────────────────────────────────────────────────

test("recordFinalScan happy path — soldCount = final - start", async () => {
  const { pool } = createStubPool([
    // assertGameAndHallForScan
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow()],
    },
    // loadExistingRow
    {
      match: (s) => s.includes("SELECT game_id") && s.includes("start_ticket_id"),
      rows: [
        {
          game_id: "g1",
          hall_id: "hall-2",
          is_ready: false,
          ready_at: null,
          ready_by_user_id: null,
          digital_tickets_sold: 0,
          physical_tickets_sold: 0,
          excluded_from_game: false,
          excluded_reason: null,
          created_at: "",
          updated_at: "",
          start_ticket_id: "100",
          start_scanned_at: "2026-04-24T10:00:00.000Z",
          final_scan_ticket_id: null,
          final_scanned_at: null,
        },
      ],
    },
    // UPDATE with final scan
    {
      match: (s) =>
        s.includes("UPDATE") && s.includes("final_scan_ticket_id"),
      rows: [
        {
          game_id: "g1",
          hall_id: "hall-2",
          is_ready: false,
          ready_at: null,
          ready_by_user_id: null,
          digital_tickets_sold: 0,
          physical_tickets_sold: 23,
          excluded_from_game: false,
          excluded_reason: null,
          created_at: "",
          updated_at: "",
          start_ticket_id: "100",
          start_scanned_at: "2026-04-24T10:00:00.000Z",
          final_scan_ticket_id: "123",
          final_scanned_at: "2026-04-24T11:00:00.000Z",
        },
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.recordFinalScan({
    gameId: "g1",
    hallId: "hall-2",
    ticketId: "123",
  });
  assert.equal(result.finalScanTicketId, "123");
  assert.equal(result.physicalTicketsSold, 23);
});

test("recordFinalScan kaster INVALID_SCAN_RANGE når final < start", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow()],
    },
    {
      match: (s) => s.includes("SELECT game_id") && s.includes("start_ticket_id"),
      rows: [
        {
          game_id: "g1",
          hall_id: "hall-2",
          is_ready: false,
          ready_at: null,
          ready_by_user_id: null,
          digital_tickets_sold: 0,
          physical_tickets_sold: 0,
          excluded_from_game: false,
          excluded_reason: null,
          created_at: "",
          updated_at: "",
          start_ticket_id: "100",
          start_scanned_at: "2026-04-24T10:00:00.000Z",
          final_scan_ticket_id: null,
          final_scanned_at: null,
        },
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.recordFinalScan({ gameId: "g1", hallId: "hall-2", ticketId: "50" }),
    (err) => err instanceof DomainError && err.code === "INVALID_SCAN_RANGE"
  );
});

test("recordFinalScan kaster START_SCAN_REQUIRED når start mangler", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow()],
    },
    // loadExistingRow returnerer null (ingen rad)
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.recordFinalScan({ gameId: "g1", hallId: "hall-2", ticketId: "100" }),
    (err) => err instanceof DomainError && err.code === "START_SCAN_REQUIRED"
  );
});

// ── markReady med FINAL_SCAN_REQUIRED-guard ─────────────────────────────────

test("markReady kaster FINAL_SCAN_REQUIRED hvis start-scan utført men final mangler", async () => {
  const { pool } = createStubPool([
    // loadScheduledGame
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow()],
    },
    // countPhysicalSoldForHall
    {
      match: (s) => s.includes('FROM "public"."app_physical_tickets"'),
      rows: [{ cnt: "5" }],
    },
    // loadExistingRow — start-scan er gjort, final mangler
    {
      match: (s) => s.includes("SELECT game_id") && s.includes("start_ticket_id"),
      rows: [
        {
          game_id: "g1",
          hall_id: "hall-2",
          is_ready: false,
          ready_at: null,
          ready_by_user_id: null,
          digital_tickets_sold: 0,
          physical_tickets_sold: 5,
          excluded_from_game: false,
          excluded_reason: null,
          created_at: "",
          updated_at: "",
          start_ticket_id: "100",
          start_scanned_at: "2026-04-24T10:00:00.000Z",
          final_scan_ticket_id: null,
          final_scanned_at: null,
        },
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.markReady({ gameId: "g1", hallId: "hall-2", userId: "u1" }),
    (err) => err instanceof DomainError && err.code === "FINAL_SCAN_REQUIRED"
  );
});

test("markReady tillater digital-only hall (0 fysiske, ingen start-scan)", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow()],
    },
    {
      match: (s) => s.includes('FROM "public"."app_physical_tickets"'),
      rows: [{ cnt: "0" }],
    },
    // loadExistingRow — ingen rad
    {
      match: (s) => s.includes("SELECT game_id") && s.includes("start_ticket_id"),
      rows: [],
    },
    // UPSERT markReady
    {
      match: (s) => s.includes("ON CONFLICT"),
      rows: [
        {
          game_id: "g1",
          hall_id: "hall-2",
          is_ready: true,
          ready_at: "2026-04-24T11:00:00.000Z",
          ready_by_user_id: "u1",
          digital_tickets_sold: 3,
          physical_tickets_sold: 0,
          excluded_from_game: false,
          excluded_reason: null,
          created_at: "",
          updated_at: "",
          start_ticket_id: null,
          start_scanned_at: null,
          final_scan_ticket_id: null,
          final_scanned_at: null,
        },
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.markReady({
    gameId: "g1",
    hallId: "hall-2",
    userId: "u1",
    digitalTicketsSold: 3,
  });
  assert.equal(result.isReady, true);
});

test("markReady tillater når både start og final scan er utført", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [scheduledGameRow()],
    },
    {
      match: (s) => s.includes('FROM "public"."app_physical_tickets"'),
      rows: [{ cnt: "5" }],
    },
    {
      match: (s) => s.includes("SELECT game_id") && s.includes("start_ticket_id"),
      rows: [
        {
          game_id: "g1",
          hall_id: "hall-2",
          is_ready: false,
          ready_at: null,
          ready_by_user_id: null,
          digital_tickets_sold: 0,
          physical_tickets_sold: 5,
          excluded_from_game: false,
          excluded_reason: null,
          created_at: "",
          updated_at: "",
          start_ticket_id: "100",
          start_scanned_at: "2026-04-24T10:00:00.000Z",
          final_scan_ticket_id: "105",
          final_scanned_at: "2026-04-24T10:30:00.000Z",
        },
      ],
    },
    {
      match: (s) => s.includes("ON CONFLICT"),
      rows: [
        {
          game_id: "g1",
          hall_id: "hall-2",
          is_ready: true,
          ready_at: "2026-04-24T11:00:00.000Z",
          ready_by_user_id: "u1",
          digital_tickets_sold: 0,
          physical_tickets_sold: 5,
          excluded_from_game: false,
          excluded_reason: null,
          created_at: "",
          updated_at: "",
          start_ticket_id: "100",
          start_scanned_at: "2026-04-24T10:00:00.000Z",
          final_scan_ticket_id: "105",
          final_scanned_at: "2026-04-24T10:30:00.000Z",
        },
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.markReady({
    gameId: "g1",
    hallId: "hall-2",
    userId: "u1",
  });
  assert.equal(result.isReady, true);
});

// ── getHallStatusForGame ────────────────────────────────────────────────────

test("getHallStatusForGame returnerer beriket liste med farger", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [
        scheduledGameRow({
          participating_halls_json: ["hall-1", "hall-2", "hall-3"],
          master_hall_id: "hall-1",
        }),
      ],
    },
    {
      match: (s) => s.includes("SELECT game_id") && s.includes("start_ticket_id"),
      rows: [
        // hall-1: 0 spillere → rød
        {
          game_id: "g1",
          hall_id: "hall-1",
          is_ready: false,
          ready_at: null,
          ready_by_user_id: null,
          digital_tickets_sold: 0,
          physical_tickets_sold: 0,
          excluded_from_game: false,
          excluded_reason: null,
          created_at: "",
          updated_at: "",
          start_ticket_id: null,
          start_scanned_at: null,
          final_scan_ticket_id: null,
          final_scanned_at: null,
        },
        // hall-2: spillere men ingen slutt-scan → oransje
        {
          game_id: "g1",
          hall_id: "hall-2",
          is_ready: false,
          ready_at: null,
          ready_by_user_id: null,
          digital_tickets_sold: 0,
          physical_tickets_sold: 5,
          excluded_from_game: false,
          excluded_reason: null,
          created_at: "",
          updated_at: "",
          start_ticket_id: "100",
          start_scanned_at: "2026-04-24T10:00:00.000Z",
          final_scan_ticket_id: null,
          final_scanned_at: null,
        },
        // hall-3: alt gjort → grønn
        {
          game_id: "g1",
          hall_id: "hall-3",
          is_ready: true,
          ready_at: "2026-04-24T11:00:00.000Z",
          ready_by_user_id: "u3",
          digital_tickets_sold: 2,
          physical_tickets_sold: 12,
          excluded_from_game: false,
          excluded_reason: null,
          created_at: "",
          updated_at: "",
          start_ticket_id: "200",
          start_scanned_at: "2026-04-24T10:00:00.000Z",
          final_scan_ticket_id: "212",
          final_scanned_at: "2026-04-24T10:30:00.000Z",
        },
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const statuses = await svc.getHallStatusForGame("g1");
  const byHall = new Map(statuses.map((s) => [s.hallId, s]));
  assert.equal(byHall.get("hall-1")!.color, "red");
  assert.equal(byHall.get("hall-2")!.color, "orange");
  assert.equal(byHall.get("hall-3")!.color, "green");
  assert.equal(byHall.get("hall-3")!.soldCount, 12);
  assert.equal(byHall.get("hall-3")!.playerCount, 14);
});
