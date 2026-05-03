import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { LocalBingoSystemAdapter } from "./LocalBingoSystemAdapter.js";
import type { Player } from "../game/types.js";

const dummyPlayer: Player = {
  id: "p1",
  name: "Tester",
  walletId: "w1",
  hallId: "h1",
  balance: 1000,
};

function input(gameSlug: string, color?: string, type?: string) {
  return {
    roomCode: "BINGO1",
    gameId: "g1",
    gameSlug,
    player: dummyPlayer,
    ticketIndex: 0,
    ticketsPerPlayer: 1,
    color,
    type,
  };
}

describe("LocalBingoSystemAdapter.createTicket", () => {
  const adapter = new LocalBingoSystemAdapter();

  test("Game 1 (bingo) → 5x5 ticket with free centre cell", async () => {
    const ticket = await adapter.createTicket(input("bingo", "Small Yellow", "small"));
    assert.equal(ticket.grid.length, 5);
    assert.equal(ticket.grid[0].length, 5);
    assert.equal(ticket.grid[2][2], 0);
  });

  test("Game 1 (game_1 alias) → 5x5 ticket", async () => {
    const ticket = await adapter.createTicket(input("game_1"));
    assert.equal(ticket.grid.length, 5);
    assert.equal(ticket.grid[2][2], 0);
  });

  test("Game 2 (rocket) → 3x3 1..21 ticket", async () => {
    const ticket = await adapter.createTicket(input("rocket"));
    assert.equal(ticket.grid.length, 3);
    assert.equal(ticket.grid[0].length, 3);
  });

  test("Other games → 3x5 Databingo60 ticket", async () => {
    const ticket = await adapter.createTicket(input("databingo"));
    assert.equal(ticket.grid.length, 3);
    assert.equal(ticket.grid[0].length, 5);
  });

  // BIN-672: Removed "Undefined slug → 3x5 (defensive default)" test.
  // The old defensive fallback was the root cause of BIN-619/BIN-671 —
  // a missing gameSlug anywhere silently produced 3×5 tickets in a
  // Bingo75 game. generateTicketForGame now throws DomainError on
  // unknown slugs (see BIN-672 commit 6 tests).

  // ── Spill 2 v2 (2026-12-06): presetGrid override ──────────────────────

  test("presetGrid bruker EXACT grid uten å re-generere (rocket)", async () => {
    const presetGrid = [
      [3, 7, 11],
      [5, 9, 13],
      [1, 17, 21],
    ];
    const ticket = await adapter.createTicket({
      ...input("rocket"),
      presetGrid,
    });
    assert.deepEqual(ticket.grid, presetGrid);
  });

  test("presetGrid bevarer color + type", async () => {
    const presetGrid = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const ticket = await adapter.createTicket({
      ...input("rocket", "Small Yellow", "small"),
      presetGrid,
    });
    assert.equal(ticket.color, "Small Yellow");
    assert.equal(ticket.type, "small");
    assert.deepEqual(ticket.grid, presetGrid);
  });

  test("presetGrid kopierer rader (mutasjoner i input lekker ikke til ticket)", async () => {
    const presetGrid = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const ticket = await adapter.createTicket({
      ...input("rocket"),
      presetGrid,
    });
    // Muter input — ticket skal være uendret
    presetGrid[0]![0] = 99;
    assert.equal(ticket.grid[0]![0], 1, "ticket-grid er upåvirket av input-mutation");
  });

  test("uten presetGrid → standard generering (default-oppførsel uendret)", async () => {
    const ticket = await adapter.createTicket(input("rocket"));
    assert.equal(ticket.grid.length, 3);
    assert.equal(ticket.grid[0].length, 3);
    // Tallene skal være i 1-21 range, ikke matche en spesifikk preset
    for (const row of ticket.grid) {
      for (const cell of row) {
        assert.ok(cell >= 1 && cell <= 21);
      }
    }
  });
});
