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

function input(gameSlug: string | undefined, color?: string, type?: string) {
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

  test("Undefined slug → 3x5 (defensive default)", async () => {
    const ticket = await adapter.createTicket(input(undefined));
    assert.equal(ticket.grid.length, 3);
    assert.equal(ticket.grid[0].length, 5);
  });
});
