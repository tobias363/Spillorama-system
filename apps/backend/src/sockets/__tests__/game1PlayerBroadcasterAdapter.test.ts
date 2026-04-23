/**
 * PR-C4: unit-tester for default-namespace player-broadcaster-adapter.
 *
 * Verifiserer at `createGame1PlayerBroadcaster` mapper domene-events til
 * riktige socket-emits (`draw:new` / `pattern:won`) og delegerer
 * `onRoomUpdate` til injisert emitRoomUpdate-hook.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createGame1PlayerBroadcaster } from "../game1PlayerBroadcasterAdapter.js";

interface CapturedEmit {
  room: string;
  event: string;
  payload: unknown;
}

function makeFakeIo(): {
  io: {
    to: (room: string) => { emit: (event: string, payload: unknown) => void };
  };
  emits: CapturedEmit[];
} {
  const emits: CapturedEmit[] = [];
  return {
    io: {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => {
          emits.push({ room, event, payload });
        },
      }),
    },
    emits,
  };
}

test("onDrawNew: emitter draw:new til roomCode med wire-shape { number, drawIndex, gameId }", () => {
  const { io, emits } = makeFakeIo();
  const broadcaster = createGame1PlayerBroadcaster({
    io: io as never,
    emitRoomUpdate: async () => ({}),
  });

  broadcaster.onDrawNew({
    roomCode: "ROOM-C4",
    number: 42,
    drawIndex: 0,
    gameId: "sg-1",
  });

  assert.equal(emits.length, 1);
  assert.equal(emits[0]!.room, "ROOM-C4");
  assert.equal(emits[0]!.event, "draw:new");
  assert.deepEqual(emits[0]!.payload, {
    number: 42,
    drawIndex: 0,
    gameId: "sg-1",
  });
});

test("onPatternWon: emitter pattern:won til roomCode med winnerIds + winnerCount", () => {
  const { io, emits } = makeFakeIo();
  const broadcaster = createGame1PlayerBroadcaster({
    io: io as never,
    emitRoomUpdate: async () => ({}),
  });

  broadcaster.onPatternWon({
    roomCode: "ROOM-C4",
    gameId: "sg-1",
    patternName: "row_1",
    phase: 1,
    winnerIds: ["u-a", "u-b"],
    winnerCount: 2,
    drawIndex: 5,
  });

  assert.equal(emits.length, 1);
  assert.equal(emits[0]!.room, "ROOM-C4");
  assert.equal(emits[0]!.event, "pattern:won");
  const payload = emits[0]!.payload as Record<string, unknown>;
  assert.equal(payload.patternId, "row_1");
  assert.equal(payload.patternName, "row_1");
  assert.equal(payload.wonAtDraw, 5);
  assert.equal(payload.gameId, "sg-1");
  assert.deepEqual(payload.winnerIds, ["u-a", "u-b"]);
  assert.equal(payload.winnerCount, 2);
  // Legacy-kompat: `winnerId` (singular) = første winner.
  assert.equal(payload.winnerId, "u-a");
});

test("onRoomUpdate: kaller emitRoomUpdate-hooken fire-and-forget", async () => {
  const { io } = makeFakeIo();
  const calls: string[] = [];
  const emitRoomUpdate = async (code: string) => {
    calls.push(code);
    return { roomCode: code };
  };

  const broadcaster = createGame1PlayerBroadcaster({
    io: io as never,
    emitRoomUpdate,
  });

  broadcaster.onRoomUpdate("ROOM-C4");

  // Fire-and-forget — må vente litt før vi sjekker.
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ["ROOM-C4"]);
});

test("onDrawNew: feil fra io.to svelges (fire-and-forget)", () => {
  const throwingIo = {
    to: () => {
      throw new Error("socket down");
    },
  };
  const broadcaster = createGame1PlayerBroadcaster({
    io: throwingIo as never,
    emitRoomUpdate: async () => ({}),
  });

  // Skal ikke kaste — service-transaksjonen er allerede committed.
  broadcaster.onDrawNew({
    roomCode: "ROOM-C4",
    number: 42,
    drawIndex: 0,
    gameId: "sg-1",
  });
});

test("onRoomUpdate: feil fra emitRoomUpdate svelges (fire-and-forget)", async () => {
  const { io } = makeFakeIo();
  const broadcaster = createGame1PlayerBroadcaster({
    io: io as never,
    emitRoomUpdate: async () => {
      throw new Error("room gone");
    },
  });

  // Skal ikke kaste.
  broadcaster.onRoomUpdate("ROOM-C4");
  await new Promise((r) => setTimeout(r, 10));
});
