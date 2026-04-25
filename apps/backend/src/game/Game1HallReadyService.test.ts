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
    // TASK HS: loadExistingRow må returnere en rad med start+final scan utført
    // slik at FINAL_SCAN_REQUIRED-guarden ikke blokkerer happy-path-testen.
    {
      match: (s) =>
        s.includes("SELECT game_id") && s.includes("WHERE game_id = $1 AND hall_id = $2"),
      rows: [
        hallReadyRow({
          start_ticket_id: "100",
          start_scanned_at: "2026-04-24T10:00:00.000Z",
          final_scan_ticket_id: "103",
          final_scanned_at: "2026-04-24T10:30:00.000Z",
          physical_tickets_sold: 3,
        }),
      ],
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

// ── Audit-funn 2026-04-25: schema-injection + JSONB-string + edge cases ────

test("constructor: ugyldig schema-navn (SQL-injection-defens)", () => {
  // Schema brukes i raw SQL strings.
  for (const bad of ["drop'table", "schema; DROP", "1starts-with-digit"]) {
    assert.throws(
      () =>
        new Game1HallReadyService({
          pool: {} as never,
          schema: bad,
        }),
      (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
      `schema=${bad} skal avvises`,
    );
  }
});

test("getReadyStatusForGame: håndterer JSONB-string (Pool returnerer string)", async () => {
  // Noen pg-konfigurasjoner returnerer JSONB-felt som string i stedet for
  // parsed object. Service må parse string-versjonen riktig.
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [
        scheduledGameRow({
          participating_halls_json: JSON.stringify(["hall-1", "hall-2"]),
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
  assert.equal(result.length, 2, "string-JSONB parses og returnerer 2 haller");
});

test("getReadyStatusForGame: korrupt JSONB-string → tom liste (try/catch)", async () => {
  // Hvis JSONB-stringen er korrupt, parseHallIdsArray returnerer []
  // (try/catch). master_hall_id er fortsatt med, så vi får 1 result.
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [
        scheduledGameRow({
          participating_halls_json: "{not valid json",
          master_hall_id: "hall-master",
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
  // Bare master-hall, siden parsing av participating-listen feilet.
  assert.equal(result.length, 1);
  assert.equal(result[0]!.hallId, "hall-master");
});

test("allParticipatingHallsReady: alle excluded inkludert master → false (ingen kandidat)", async () => {
  // Edge: alle haller (inkl master) er excluded. Service har "hasCandidate"-
  // sjekk → false når ingen non-excluded.
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [
        scheduledGameRow({
          participating_halls_json: ["hall-1", "hall-2"],
          master_hall_id: "hall-master",
        }),
      ],
    },
    {
      match: (s) => s.includes("SELECT game_id"),
      rows: [
        hallReadyRow({ hall_id: "hall-1", excluded_from_game: true }),
        hallReadyRow({ hall_id: "hall-2", excluded_from_game: true }),
        hallReadyRow({ hall_id: "hall-master", excluded_from_game: true }),
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.allParticipatingHallsReady("g1");
  assert.equal(result, false, "alle excluded → false (ikke ready_to_start-eligible)");
});

test("markReady: digitalTicketsSold=undefined fall til 0", async () => {
  // Service har `Math.max(0, Math.floor(input.digitalTicketsSold ?? 0))`.
  // Locker semantikk: undefined → 0, ikke NaN eller throw.
  const { pool } = createStubPool([
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
        s.includes("SELECT game_id") && s.includes("WHERE game_id = $1 AND hall_id = $2"),
      rows: [],
    },
    {
      match: (s) => s.includes("ON CONFLICT"),
      rows: [hallReadyRow({ digital_tickets_sold: 0 })],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.markReady({
    gameId: "g1",
    hallId: "hall-2",
    userId: "u1",
    // digitalTicketsSold udefiniert
  });
  assert.equal(result.digitalTicketsSold, 0);
});

test("markReady: digitalTicketsSold=-5 (negativ) → klampes til 0", async () => {
  // Math.max(0, ...) klamper negative til 0. Defens mot rusk-input.
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
        s.includes("SELECT game_id") && s.includes("WHERE game_id = $1 AND hall_id = $2"),
      rows: [],
    },
    {
      match: (s) => s.includes("ON CONFLICT"),
      rows: [hallReadyRow({ digital_tickets_sold: 0 })],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await svc.markReady({
    gameId: "g1",
    hallId: "hall-2",
    userId: "u1",
    digitalTicketsSold: -5,
  });
  // Verifiser INSERT har 0, ikke -5.
  const upsert = queries.find((q) => q.sql.includes("ON CONFLICT"));
  assert.ok(upsert);
  assert.equal(upsert!.params[3], 0, "negativ digitalTicketsSold klampes til 0");
});

test("markReady: physical_tickets-tabell mangler (42P01) → fallback til 0 uten kast", async () => {
  // Dev-environment uten migrasjoner — tabellen finnes ikke. Service har
  // 42P01-håndtering for å returnere 0 i stedet for å kaste.
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('FROM "public"."app_game1_scheduled_games"')) {
        return { rows: [scheduledGameRow()], rowCount: 1 };
      }
      if (sql.includes('FROM "public"."app_physical_tickets"')) {
        const err = new Error("relation does not exist") as Error & { code: string };
        err.code = "42P01";
        throw err;
      }
      if (sql.includes("SELECT game_id") && sql.includes("WHERE game_id = $1 AND hall_id = $2")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("ON CONFLICT")) {
        return {
          rows: [hallReadyRow({ physical_tickets_sold: 0 })],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const svc = Game1HallReadyService.forTesting(pool as never);
  // Skal ikke kaste, fallback til 0.
  const result = await svc.markReady({
    gameId: "g1",
    hallId: "hall-2",
    userId: "u1",
  });
  assert.equal(result.physicalTicketsSold, 0);
});

test("markReady: physical_tickets-tabell andre feil (ikke 42P01) → propagerer", async () => {
  // Andre DB-feil skal IKKE bli swallowed.
  const pool = {
    query: async (sql: string) => {
      if (sql.includes('FROM "public"."app_game1_scheduled_games"')) {
        return { rows: [scheduledGameRow()], rowCount: 1 };
      }
      if (sql.includes('FROM "public"."app_physical_tickets"')) {
        const err = new Error("connection lost") as Error & { code: string };
        err.code = "08006"; // ikke 42P01
        throw err;
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.markReady({ gameId: "g1", hallId: "hall-2", userId: "u1" }),
    (err: unknown) => err instanceof Error && err.message.includes("connection lost"),
  );
});

test("getReadyStatusForGame: ingen deltagende haller (kun master) → 1 default-rad", async () => {
  // Edge: spillet har ingen non-master deltakende haller. master skal
  // alltid være med i statussen.
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [
        scheduledGameRow({
          participating_halls_json: [],
          master_hall_id: "hall-master",
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
  assert.equal(result.length, 1);
  assert.equal(result[0]!.hallId, "hall-master");
  assert.equal(result[0]!.isReady, false);
});

test("getGameGroupId: returnerer group_hall_id fra scheduled_game", async () => {
  // Helper for socket-broadcast-rom-routing. Locker at det returnerer
  // group_hall_id, ikke noe annet.
  const { pool } = createStubPool([
    {
      match: (s) => s.includes('FROM "public"."app_game1_scheduled_games"'),
      rows: [
        scheduledGameRow({
          group_hall_id: "grp-special-1",
          master_hall_id: "hall-master",
        }),
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const groupId = await svc.getGameGroupId("g1");
  assert.equal(groupId, "grp-special-1");
});

test("getGameGroupId: spill ikke funnet → DomainError(GAME_NOT_FOUND)", async () => {
  const { pool } = createStubPool([]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () => svc.getGameGroupId("ghost"),
    (err) => err instanceof DomainError && err.code === "GAME_NOT_FOUND",
  );
});
