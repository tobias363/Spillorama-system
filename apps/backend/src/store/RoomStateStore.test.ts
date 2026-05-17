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
    gameSlug: "bingo",
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

// ── Spill 1-recovery hardening (2026-05-17) ────────────────────────────
//
// Regresjons-tester for kritiske live-room-felter som tidligere gikk tapt
// på Redis-restart. Hver assert representerer en konkret pilot-blokker:
//
// - scheduledGameId: scheduled Spill 1-binding mot app_game1_scheduled_games
// - isHallShared:    GoH-rom (per-link Spill 1, global Spill 2/3) skipper
//                    HALL_MISMATCH-sjekk i BingoEngine.joinRoom
// - isTestHall:      demo-haller går gjennom alle 5 faser i stedet for å
//                    ende på Fullt Hus
// - pendingMiniGame: uspilt mini-game overlever archiveIfEnded-wipe
//                    (Tobias prod-incident 2026-04-30)

test("serializeRoom/deserializeRoom: bevarer scheduledGameId (Spill 1 scheduled binding)", () => {
  const room = makeRoom();
  room.scheduledGameId = "sg-pilot-001";

  const roundtripped = deserializeRoom(
    JSON.parse(JSON.stringify(serializeRoom(room))),
  );

  assert.equal(roundtripped.scheduledGameId, "sg-pilot-001");
});

test("serializeRoom/deserializeRoom: bevarer isHallShared=true (GoH-rom)", () => {
  const room = makeRoom();
  room.isHallShared = true;

  const roundtripped = deserializeRoom(
    JSON.parse(JSON.stringify(serializeRoom(room))),
  );

  assert.equal(roundtripped.isHallShared, true);
});

test("serializeRoom/deserializeRoom: bevarer isTestHall=true (demo-hall)", () => {
  const room = makeRoom();
  room.isTestHall = true;

  const roundtripped = deserializeRoom(
    JSON.parse(JSON.stringify(serializeRoom(room))),
  );

  assert.equal(roundtripped.isTestHall, true);
});

test("serializeRoom/deserializeRoom: bevarer pendingMiniGame (Tobias prod-incident 2026-04-30)", () => {
  const room = makeRoom();
  room.pendingMiniGame = {
    gameId: "game-archived-1",
    playerId: "p1",
    type: "wheelOfFortune",
    prizeList: [100, 200, 500],
    isPlayed: false,
  };

  const roundtripped = deserializeRoom(
    JSON.parse(JSON.stringify(serializeRoom(room))),
  );

  assert.ok(roundtripped.pendingMiniGame);
  assert.equal(roundtripped.pendingMiniGame.gameId, "game-archived-1");
  assert.equal(roundtripped.pendingMiniGame.playerId, "p1");
  assert.equal(roundtripped.pendingMiniGame.type, "wheelOfFortune");
  assert.deepEqual(roundtripped.pendingMiniGame.prizeList, [100, 200, 500]);
  assert.equal(roundtripped.pendingMiniGame.isPlayed, false);
});

test("serializeRoom/deserializeRoom: ALLE kritiske felter samtidig (scheduled GoH-demo)", () => {
  const room = makeRoom();
  room.scheduledGameId = "sg-pilot-001";
  room.isHallShared = true;
  room.isTestHall = true;
  room.pendingMiniGame = {
    gameId: "game-archived-1",
    playerId: "p1",
    type: "mysteryGame",
    prizeList: [50, 100],
    isPlayed: false,
  };

  const roundtripped = deserializeRoom(
    JSON.parse(JSON.stringify(serializeRoom(room))),
  );

  assert.equal(roundtripped.scheduledGameId, "sg-pilot-001");
  assert.equal(roundtripped.isHallShared, true);
  assert.equal(roundtripped.isTestHall, true);
  assert.equal(roundtripped.pendingMiniGame?.gameId, "game-archived-1");
});

test("deserializeRoom: pre-hardening Redis-snapshot (manglende felter) er bakoverkompatibel", () => {
  // Simulér en payload skrevet til Redis FØR 2026-05-17-hardening.
  // serializeRoom ville den gang ikke ha emittert disse feltene.
  // deserializeRoom skal IKKE krasje og skal IKKE tvinge inn default-verdier
  // som endrer adferd — feltene skal forbli `undefined`.
  const legacyPayload = {
    code: "LEGACY01",
    hallId: "hall-1",
    hostPlayerId: "p1",
    gameSlug: "bingo",
    players: { p1: { id: "p1", name: "Alice", walletId: "w1", balance: 100 } },
    gameHistory: [],
    createdAt: "2026-04-08T11:00:00.000Z",
  };

  const room = deserializeRoom(legacyPayload as never);

  assert.equal(room.code, "LEGACY01");
  assert.equal(room.scheduledGameId, undefined);
  assert.equal(room.isHallShared, undefined);
  assert.equal(room.isTestHall, undefined);
  assert.equal(room.pendingMiniGame, undefined);
});

test("serializeRoom: rom UTEN optional felter emitter ikke undefined-keys", () => {
  // En vanlig ad-hoc Spill 2 ROCKET-rom har ingen scheduledGameId men
  // isHallShared=true. Vi skal ikke blåse opp payloaden med undefined keys.
  const room = makeRoom();
  room.isHallShared = true;
  // scheduledGameId, isTestHall, pendingMiniGame settes IKKE.

  const serialized = serializeRoom(room);

  // isHallShared er satt eksplisitt.
  assert.equal(serialized.isHallShared, true);
  // De andre keys skal IKKE være tilstede i serialized.
  assert.equal(
    Object.prototype.hasOwnProperty.call(serialized, "scheduledGameId"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(serialized, "isTestHall"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(serialized, "pendingMiniGame"),
    false,
  );
});

test("serializeRoom/deserializeRoom: bevarer GameState spill3PhaseState (R10)", () => {
  const room = makeRoom();
  if (!room.currentGame) throw new Error("test-fixture mangler currentGame");
  room.currentGame.spill3PhaseState = {
    currentPhaseIndex: 2,
    pausedUntilMs: 1_700_000_000_000,
    phasesWon: [0, 1],
    status: "ACTIVE",
    endedReason: null,
  };

  const roundtripped = deserializeRoom(
    JSON.parse(JSON.stringify(serializeRoom(room))),
  );

  const phase = roundtripped.currentGame?.spill3PhaseState;
  assert.ok(phase);
  assert.equal(phase.currentPhaseIndex, 2);
  assert.equal(phase.pausedUntilMs, 1_700_000_000_000);
  assert.deepEqual(phase.phasesWon, [0, 1]);
  assert.equal(phase.status, "ACTIVE");
  assert.equal(phase.endedReason, null);
});

test("serializeRoom/deserializeRoom: bevarer GameState pause-state (BIN-460/MED-11)", () => {
  const room = makeRoom();
  if (!room.currentGame) throw new Error("test-fixture mangler currentGame");
  room.currentGame.isPaused = true;
  room.currentGame.pauseMessage = "Master tar pause";
  room.currentGame.pauseUntil = "2026-05-17T12:34:56.000Z";
  room.currentGame.pauseReason = "AWAITING_OPERATOR";

  const roundtripped = deserializeRoom(
    JSON.parse(JSON.stringify(serializeRoom(room))),
  );

  assert.equal(roundtripped.currentGame?.isPaused, true);
  assert.equal(roundtripped.currentGame?.pauseMessage, "Master tar pause");
  assert.equal(roundtripped.currentGame?.pauseUntil, "2026-05-17T12:34:56.000Z");
  assert.equal(roundtripped.currentGame?.pauseReason, "AWAITING_OPERATOR");
});

test("serializeRoom/deserializeRoom: bevarer GameState participatingPlayerIds (KRITISK-8) + isTestGame", () => {
  const room = makeRoom();
  if (!room.currentGame) throw new Error("test-fixture mangler currentGame");
  room.currentGame.participatingPlayerIds = ["p1", "p2", "p3"];
  room.currentGame.isTestGame = true;

  const roundtripped = deserializeRoom(
    JSON.parse(JSON.stringify(serializeRoom(room))),
  );

  assert.deepEqual(roundtripped.currentGame?.participatingPlayerIds, ["p1", "p2", "p3"]);
  assert.equal(roundtripped.currentGame?.isTestGame, true);
});
