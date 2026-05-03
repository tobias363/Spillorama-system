/**
 * 2026-12-06 (Spill 2 v2/v3): tester for `Game2TicketPoolService`.
 *
 * Dekker:
 *   - In-memory pool generering: deterministisk, 32 brett, 3×3, range 1-21
 *   - Idempotens: samme (room, player, gameId) gir samme pool
 *   - buy() validerer indices + idempotens på re-buy
 *   - getPurchasedGrids() returnerer korrekte grids i sortert rekkefølge
 *   - getPurchasedGridsFromCache() sync-variant for hot-path
 *   - listPlayersWithPurchasedTickets() iterasjon
 *   - DB-persistens via mocket pg.Pool: load + upsert + delete
 *   - deletePoolForGame() rydder både cache og DB
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import type { Pool as PgPool, QueryResultRow } from "pg";
import { Game2TicketPoolService } from "./Game2TicketPoolService.js";

// ── Helper: minimal mock-pool som logger queries og kan returnere fixtures ─

interface MockedQuery {
  text: string;
  values: unknown[];
}

function makeMockPool(rowsByQuery: Record<string, QueryResultRow[]> = {}): {
  pool: PgPool;
  queries: MockedQuery[];
  setRows: (sqlPrefix: string, rows: QueryResultRow[]) => void;
} {
  const queries: MockedQuery[] = [];
  const rowMap = new Map<string, QueryResultRow[]>();
  for (const [k, v] of Object.entries(rowsByQuery)) rowMap.set(k, v);

  const pool = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values: values ?? [] });
      // Match by SQL-prefix (substring) — first match wins.
      for (const [prefix, rows] of rowMap) {
        if (text.includes(prefix)) {
          return { rows, rowCount: rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PgPool;

  return {
    pool,
    queries,
    setRows: (prefix, rows) => rowMap.set(prefix, rows),
  };
}

// ── Tests: in-memory mode (no DB) ─────────────────────────────────────────

describe("Game2TicketPoolService — in-memory mode", () => {
  test("getOrCreatePool genererer deterministisk pool med 32 brett (3×3, 1-21)", async () => {
    const svc = new Game2TicketPoolService();
    const snapA = await svc.getOrCreatePool("ROCKET", "p1", "g1");
    const snapB = await svc.getOrCreatePool("ROCKET", "p1", "g1");

    assert.equal(snapA.tickets.length, 32);
    for (const ticket of snapA.tickets) {
      assert.equal(ticket.grid.length, 3, "3 rows");
      for (const row of ticket.grid) {
        assert.equal(row.length, 3, "3 cols");
        for (const cell of row) {
          assert.ok(Number.isInteger(cell), "cell is integer");
          assert.ok(cell >= 1 && cell <= 21, `cell in [1,21] (got ${cell})`);
        }
      }
      // Hver brett må ha 9 unike tall
      const flat = ticket.grid.flat();
      assert.equal(new Set(flat).size, 9, "9 unique values per ticket");
    }
    assert.deepEqual(snapA.tickets, snapB.tickets, "deterministic");
    assert.deepEqual(snapA.purchasedIndices, []);
  });

  test("buy() markerer indices som kjøpt og er idempotent", async () => {
    const svc = new Game2TicketPoolService();
    await svc.getOrCreatePool("ROCKET", "p1", "g1");
    const a = await svc.buy({
      roomCode: "ROCKET",
      playerId: "p1",
      gameId: "g1",
      indices: [0, 5, 10],
    });
    assert.deepEqual(a.purchasedIndices, [0, 5, 10]);

    // Re-buy same indices — idempotent (Set dedupes)
    const b = await svc.buy({
      roomCode: "ROCKET",
      playerId: "p1",
      gameId: "g1",
      indices: [5, 10, 11],
    });
    assert.deepEqual(b.purchasedIndices, [0, 5, 10, 11]);
  });

  test("buy() validerer ugyldige indices", async () => {
    const svc = new Game2TicketPoolService();
    await svc.getOrCreatePool("ROCKET", "p1", "g1");
    await assert.rejects(
      () => svc.buy({ roomCode: "ROCKET", playerId: "p1", gameId: "g1", indices: [-1] }),
      /INVALID_INDEX/,
    );
    await assert.rejects(
      () => svc.buy({ roomCode: "ROCKET", playerId: "p1", gameId: "g1", indices: [32] }),
      /INVALID_INDEX/,
    );
  });

  test("buy() validerer pickAnyNumber", async () => {
    const svc = new Game2TicketPoolService();
    await svc.getOrCreatePool("ROCKET", "p1", "g1");
    await assert.rejects(
      () =>
        svc.buy({
          roomCode: "ROCKET",
          playerId: "p1",
          gameId: "g1",
          indices: [],
          pickAnyNumber: 0,
        }),
      /INVALID_PICK_ANY_NUMBER/,
    );
    await assert.rejects(
      () =>
        svc.buy({
          roomCode: "ROCKET",
          playerId: "p1",
          gameId: "g1",
          indices: [],
          pickAnyNumber: 22,
        }),
      /INVALID_PICK_ANY_NUMBER/,
    );
    const ok = await svc.buy({
      roomCode: "ROCKET",
      playerId: "p1",
      gameId: "g1",
      indices: [],
      pickAnyNumber: 7,
    });
    assert.equal(ok.pickAnyNumber, 7);
  });

  test("getPurchasedGrids returnerer korrekte grids i sortert rekkefølge", async () => {
    const svc = new Game2TicketPoolService();
    const snap = await svc.getOrCreatePool("ROCKET", "p1", "g1");
    await svc.buy({
      roomCode: "ROCKET",
      playerId: "p1",
      gameId: "g1",
      indices: [10, 0, 5],
    });
    const grids = await svc.getPurchasedGrids("ROCKET", "p1", "g1");
    assert.equal(grids.length, 3);
    // Sortert ascending → grid for index 0, så 5, så 10
    assert.deepEqual(grids[0], snap.tickets[0]?.grid);
    assert.deepEqual(grids[1], snap.tickets[5]?.grid);
    assert.deepEqual(grids[2], snap.tickets[10]?.grid);
  });

  test("getPurchasedGridsFromCache returnerer null når pool ikke i cache", () => {
    const svc = new Game2TicketPoolService();
    // Ingen getOrCreatePool-call først — cache er tom.
    const result = svc.getPurchasedGridsFromCache("ROCKET", "p1", "g1");
    assert.equal(result, null);
  });

  test("getPurchasedGridsFromCache returnerer null når purchasedIndices == []", async () => {
    const svc = new Game2TicketPoolService();
    await svc.getOrCreatePool("ROCKET", "p1", "g1");
    // Pool er i cache, men ingen kjøp gjort
    const result = svc.getPurchasedGridsFromCache("ROCKET", "p1", "g1");
    assert.equal(result, null);
  });

  test("getPurchasedGridsFromCache returnerer grids når pool er kjøpt fra", async () => {
    const svc = new Game2TicketPoolService();
    const snap = await svc.getOrCreatePool("ROCKET", "p1", "g1");
    await svc.buy({
      roomCode: "ROCKET",
      playerId: "p1",
      gameId: "g1",
      indices: [3, 7],
    });
    const grids = svc.getPurchasedGridsFromCache("ROCKET", "p1", "g1");
    assert.ok(grids);
    assert.equal(grids.length, 2);
    assert.deepEqual(grids[0], snap.tickets[3]?.grid);
    assert.deepEqual(grids[1], snap.tickets[7]?.grid);
  });

  test("listPlayersWithPurchasedTickets returnerer kun spillere med kjøp", async () => {
    const svc = new Game2TicketPoolService();
    await svc.getOrCreatePool("ROCKET", "p1", "g1");
    await svc.getOrCreatePool("ROCKET", "p2", "g1");
    await svc.getOrCreatePool("ROCKET", "p3", "g1");
    await svc.buy({ roomCode: "ROCKET", playerId: "p1", gameId: "g1", indices: [0] });
    await svc.buy({ roomCode: "ROCKET", playerId: "p3", gameId: "g1", indices: [1, 2] });
    const ids = svc.listPlayersWithPurchasedTickets("ROCKET", "g1").sort();
    assert.deepEqual(ids, ["p1", "p3"]);
  });

  test("listPlayersWithPurchasedTickets isolerer per gameId", async () => {
    const svc = new Game2TicketPoolService();
    await svc.getOrCreatePool("ROCKET", "p1", "g1");
    await svc.getOrCreatePool("ROCKET", "p1", "g2");
    await svc.buy({ roomCode: "ROCKET", playerId: "p1", gameId: "g1", indices: [0] });
    // p1 har kjøp i g1 men ikke g2
    assert.deepEqual(svc.listPlayersWithPurchasedTickets("ROCKET", "g1"), ["p1"]);
    assert.deepEqual(svc.listPlayersWithPurchasedTickets("ROCKET", "g2"), []);
  });

  test("clearGame fjerner pools for én gameId fra cache", async () => {
    const svc = new Game2TicketPoolService();
    await svc.getOrCreatePool("ROCKET", "p1", "g1");
    await svc.getOrCreatePool("ROCKET", "p2", "g1");
    await svc.getOrCreatePool("ROCKET", "p1", "g2");
    svc.clearGame("g1");
    assert.equal(svc.getPurchasedGridsFromCache("ROCKET", "p1", "g1"), null);
    assert.equal(svc.getPurchasedGridsFromCache("ROCKET", "p2", "g1"), null);
    // g2 forblir
    await svc.buy({ roomCode: "ROCKET", playerId: "p1", gameId: "g2", indices: [0] });
    assert.ok(svc.getPurchasedGridsFromCache("ROCKET", "p1", "g2"));
  });

  test("deletePoolForGame fjerner pools for én gameId (async)", async () => {
    const svc = new Game2TicketPoolService();
    await svc.getOrCreatePool("ROCKET", "p1", "g1");
    await svc.buy({ roomCode: "ROCKET", playerId: "p1", gameId: "g1", indices: [0] });
    assert.ok(svc.getPurchasedGridsFromCache("ROCKET", "p1", "g1"));
    await svc.deletePoolForGame("g1");
    assert.equal(svc.getPurchasedGridsFromCache("ROCKET", "p1", "g1"), null);
  });

  test("ulike gameId-er gir ulike pool-grids", async () => {
    const svc = new Game2TicketPoolService();
    const a = await svc.getOrCreatePool("ROCKET", "p1", "g1");
    const b = await svc.getOrCreatePool("ROCKET", "p1", "g2");
    // Determinisme er per (room, player, gameId) — ulik gameId → ulik grids
    assert.notDeepEqual(a.tickets[0]?.grid, b.tickets[0]?.grid);
  });
});

// ── Tests: DB-mode med mocket pool ────────────────────────────────────────

describe("Game2TicketPoolService — DB-mode", () => {
  test("getOrCreatePool gjør SELECT + INSERT på cold-start", async () => {
    const { pool, queries } = makeMockPool();
    const svc = new Game2TicketPoolService({ pool });
    const snap = await svc.getOrCreatePool("ROCKET", "p1", "g1");
    assert.equal(snap.tickets.length, 32);
    // Forventet: én SELECT (cold-load — ingen rows) + én INSERT (persist)
    const selectCalls = queries.filter((q) => q.text.includes("SELECT"));
    const insertCalls = queries.filter((q) => q.text.includes("INSERT INTO app_game2_ticket_pools"));
    assert.equal(selectCalls.length, 1);
    assert.equal(insertCalls.length, 1);
  });

  test("getOrCreatePool hydrerer cache fra DB-row hvis den finnes", async () => {
    const dbRow = {
      room_code: "ROCKET",
      player_id: "p1",
      game_id: "g1",
      ticket_grids: [[[1, 2, 3], [4, 5, 6], [7, 8, 9]]],
      purchased_indices: [0],
      pick_any_number: 7,
    };
    const { pool, queries } = makeMockPool({
      "SELECT room_code, player_id, game_id, ticket_grids": [dbRow],
    });
    const svc = new Game2TicketPoolService({ pool });
    const snap = await svc.getOrCreatePool("ROCKET", "p1", "g1");
    assert.equal(snap.tickets.length, 1);
    assert.deepEqual(snap.tickets[0]?.grid, [[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    assert.deepEqual(snap.purchasedIndices, [0]);
    assert.equal(snap.pickAnyNumber, 7);
    // Skal IKKE ha kjørt INSERT siden DB hadde rad
    const insertCalls = queries.filter((q) => q.text.includes("INSERT INTO app_game2_ticket_pools"));
    assert.equal(insertCalls.length, 0);
  });

  test("buy() gjør UPSERT mot DB", async () => {
    const { pool, queries } = makeMockPool();
    const svc = new Game2TicketPoolService({ pool });
    await svc.getOrCreatePool("ROCKET", "p1", "g1");
    queries.length = 0; // Tøm log
    await svc.buy({
      roomCode: "ROCKET",
      playerId: "p1",
      gameId: "g1",
      indices: [0, 5, 10],
      pickAnyNumber: 13,
    });
    const upserts = queries.filter((q) => q.text.includes("ON CONFLICT"));
    assert.equal(upserts.length, 1, "én UPSERT");
    const upsert = upserts[0]!;
    assert.deepEqual(upsert.values[4], [0, 5, 10], "purchased_indices");
    assert.equal(upsert.values[5], 13, "pick_any_number");
  });

  test("deletePoolForGame gjør DELETE mot DB", async () => {
    const { pool, queries } = makeMockPool();
    const svc = new Game2TicketPoolService({ pool });
    await svc.getOrCreatePool("ROCKET", "p1", "g1");
    queries.length = 0;
    await svc.deletePoolForGame("g1");
    const deletes = queries.filter((q) => q.text.includes("DELETE FROM app_game2_ticket_pools"));
    assert.equal(deletes.length, 1);
    assert.deepEqual(deletes[0]!.values, ["g1"]);
  });

  test("DB-feil ved load → fall tilbake til generering (fail-soft)", async () => {
    const failingPool = {
      query: async () => {
        throw new Error("DB connection lost");
      },
    } as unknown as PgPool;
    const svc = new Game2TicketPoolService({ pool: failingPool });
    // Skal ikke kaste — fail-soft til in-memory generering
    const snap = await svc.getOrCreatePool("ROCKET", "p1", "g1");
    assert.equal(snap.tickets.length, 32);
  });

  test("malformed ticket_grids fra DB → regenerer pool", async () => {
    const dbRow = {
      room_code: "ROCKET",
      player_id: "p1",
      game_id: "g1",
      ticket_grids: "this-is-not-json", // malformed
      purchased_indices: [],
      pick_any_number: null,
    };
    const { pool } = makeMockPool({
      "SELECT room_code, player_id, game_id, ticket_grids": [dbRow],
    });
    const svc = new Game2TicketPoolService({ pool });
    const snap = await svc.getOrCreatePool("ROCKET", "p1", "g1");
    // Regenerert pool har 32 brett
    assert.equal(snap.tickets.length, 32);
  });

  test("purchased_indices fra DB filtrerer ut ugyldige tall", async () => {
    // Generer en pool først, så vi vet at vi har 32 tickets — sjekk at DB-load
    // filtrerer ut indices utenfor [0, 32)
    const { pool: genPool } = makeMockPool();
    const generator = new Game2TicketPoolService({ pool: genPool });
    const original = await generator.getOrCreatePool("ROCKET", "p1", "g1");
    const ticketGridsAsJson = original.tickets.map((t) => t.grid);

    const dbRow = {
      room_code: "ROCKET",
      player_id: "p1",
      game_id: "g1",
      ticket_grids: ticketGridsAsJson,
      purchased_indices: [0, 5, 999, -1, 10], // 999 og -1 filtreres bort
      pick_any_number: null,
    };
    const { pool } = makeMockPool({
      "SELECT room_code, player_id, game_id, ticket_grids": [dbRow],
    });
    const svc = new Game2TicketPoolService({ pool });
    const snap = await svc.getOrCreatePool("ROCKET", "p1", "g1");
    assert.deepEqual(snap.purchasedIndices, [0, 5, 10]);
  });
});
