import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryRoomStateStore,
  serializeRoom,
  deserializeRoom
} from "./RoomStateStore.js";
import type { RoomState } from "../game/types.js";

function makeRoom(code = "TEST01"): RoomState {
  return {
    code,
    hallId: "hall-1",
    hostPlayerId: "p1",
    players: new Map([["p1", { id: "p1", name: "Alice", walletId: "w1", balance: 100 }]]),
    currentGame: {
      id: "game-1",
      status: "RUNNING",
      entryFee: 10,
      ticketsPerPlayer: 2,
      prizePool: 20,
      remainingPrizePool: 20,
      payoutPercent: 80,
      maxPayoutBudget: 16,
      remainingPayoutBudget: 16,
      drawBag: [5, 10, 15],
      drawnNumbers: [1, 2, 3],
      tickets: new Map([["p1", [{ grid: [[1, 13, 25, 37, 49], [2, 14, 26, 38, 50], [3, 15, 27, 39, 51]] }]]]),
      marks: new Map([["p1", [new Set([1, 2]), new Set([3])]]]),
      claims: [],
      startedAt: "2026-04-08T12:00:00.000Z"
    },
    gameHistory: [],
    createdAt: "2026-04-08T11:00:00.000Z"
  };
}

test("InMemoryRoomStateStore: basic CRUD", async () => {
  const store = new InMemoryRoomStateStore();
  const room = makeRoom();

  assert.equal(store.size, 0);
  store.set("TEST01", room);
  assert.equal(store.size, 1);
  assert.equal(store.has("TEST01"), true);
  assert.equal(store.get("TEST01"), room);

  store.delete("TEST01");
  assert.equal(store.size, 0);
  assert.equal(store.has("TEST01"), false);
});

test("serializeRoom/deserializeRoom: round-trip preserves data", () => {
  const room = makeRoom();
  const serialized = serializeRoom(room);
  const json = JSON.stringify(serialized);
  const parsed = JSON.parse(json);
  const deserialized = deserializeRoom(parsed);

  // Room-level fields
  assert.equal(deserialized.code, room.code);
  assert.equal(deserialized.hallId, room.hallId);
  assert.equal(deserialized.hostPlayerId, room.hostPlayerId);
  assert.equal(deserialized.createdAt, room.createdAt);

  // Players (Map)
  assert.equal(deserialized.players.size, 1);
  assert.equal(deserialized.players.get("p1")?.name, "Alice");

  // Game state
  assert.ok(deserialized.currentGame);
  assert.equal(deserialized.currentGame.id, "game-1");
  assert.equal(deserialized.currentGame.status, "RUNNING");
  assert.deepEqual(deserialized.currentGame.drawnNumbers, [1, 2, 3]);
  assert.deepEqual(deserialized.currentGame.drawBag, [5, 10, 15]);

  // Tickets (Map)
  assert.equal(deserialized.currentGame.tickets.size, 1);
  assert.ok(deserialized.currentGame.tickets.get("p1"));

  // Marks (Map<string, Set<number>[]>)
  assert.equal(deserialized.currentGame.marks.size, 1);
  const p1Marks = deserialized.currentGame.marks.get("p1");
  assert.ok(p1Marks);
  assert.equal(p1Marks.length, 2);
  assert.ok(p1Marks[0].has(1));
  assert.ok(p1Marks[0].has(2));
  assert.ok(p1Marks[1].has(3));
});

test("serializeRoom: handles room without currentGame", () => {
  const room = makeRoom();
  room.currentGame = undefined;
  const serialized = serializeRoom(room);
  const deserialized = deserializeRoom(serialized);

  assert.equal(deserialized.currentGame, undefined);
  assert.equal(deserialized.code, "TEST01");
});
