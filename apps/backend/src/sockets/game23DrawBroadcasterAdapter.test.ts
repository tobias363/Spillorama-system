/**
 * Tester for Game23DrawBroadcasterAdapter.
 *
 * Dekker (Tobias-bug-fix 2026-05-04):
 *   - `draw:new` emittes med rett payload (number, drawIndex, gameId).
 *   - `room:update` triggeres via injected `emitRoomUpdate`.
 *   - Engine-spesifikke effekter (G2/G3) drainerer KUN når engine er
 *     instans av matching subklasse — speiler `instanceof`-mønsteret i
 *     `gameEvents/drawEvents.ts:114-127`.
 *   - Fail-soft: feil i `io.emit` eller `emitRoomUpdate` kaster IKKE
 *     videre til caller.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createGame23DrawBroadcaster } from "./game23DrawBroadcasterAdapter.js";

// ── Test-helpers ────────────────────────────────────────────────────────────

interface FakeEmittedEvent {
  room: string;
  event: string;
  payload: unknown;
}

interface FakeIo {
  to: (room: string) => { emit: (event: string, payload: unknown) => void };
}

function makeFakeIo(): { io: FakeIo; events: FakeEmittedEvent[] } {
  const events: FakeEmittedEvent[] = [];
  const io: FakeIo = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ room, event, payload });
        },
      };
    },
  };
  return { io, events };
}

// ── draw:new ────────────────────────────────────────────────────────────────

test("draw:new emittes med rett payload til riktig roomCode", async () => {
  const { io, events } = makeFakeIo();
  const emittedRoomUpdates: string[] = [];
  const broadcaster = createGame23DrawBroadcaster({
    // typecast til socket.io-Server — vi gir kun 'to'-API.
    io: io as unknown as Parameters<
      typeof createGame23DrawBroadcaster
    >[0]["io"],
    engine: {}, // ikke instans av Game2Engine/Game3Engine — kun draw:new + room:update
    emitRoomUpdate: async (roomCode) => {
      emittedRoomUpdates.push(roomCode);
      return null;
    },
  });

  broadcaster.onDrawCompleted({
    roomCode: "ROCKET",
    number: 17,
    drawIndex: 5,
    gameId: "g-abc",
  });

  // `draw:new` skal være første emit.
  const drawNew = events.find((e) => e.event === "draw:new");
  assert.ok(drawNew, "draw:new må være emittet");
  assert.equal(drawNew!.room, "ROCKET");
  assert.deepEqual(drawNew!.payload, {
    number: 17,
    drawIndex: 5,
    gameId: "g-abc",
  });

  // `emitRoomUpdate` er fire-and-forget — vent en mikrotask så promise
  // kjører.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(emittedRoomUpdates, ["ROCKET"]);
});

test("draw:new emittes selv om emitRoomUpdate kaster", async () => {
  const { io, events } = makeFakeIo();
  const broadcaster = createGame23DrawBroadcaster({
    io: io as unknown as Parameters<
      typeof createGame23DrawBroadcaster
    >[0]["io"],
    engine: {},
    emitRoomUpdate: async () => {
      throw new Error("snapshot build failed");
    },
  });

  // Skal ikke kaste — fail-soft.
  broadcaster.onDrawCompleted({
    roomCode: "R",
    number: 1,
    drawIndex: 0,
    gameId: "g",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  // draw:new skal fortsatt være emittet.
  assert.ok(events.some((e) => e.event === "draw:new"));
});

test("io.emit-kast krasjer ikke — emitRoomUpdate skjer fortsatt", async () => {
  // Hvis socket-laget kaster ved emit (f.eks. server lukket midt i
  // ticken), skal vi fortsatt kalle emitRoomUpdate så late-joining
  // klienter får snapshot ved neste tick.
  let roomUpdateFired = false;
  const broadcaster = createGame23DrawBroadcaster({
    io: {
      to: () => ({
        emit: () => {
          throw new Error("socket lukket");
        },
      }),
    } as unknown as Parameters<
      typeof createGame23DrawBroadcaster
    >[0]["io"],
    engine: {},
    emitRoomUpdate: async () => {
      roomUpdateFired = true;
      return null;
    },
  });

  broadcaster.onDrawCompleted({
    roomCode: "R",
    number: 1,
    drawIndex: 0,
    gameId: "g",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(roomUpdateFired, true);
});

// ── Engine-effekter (G2/G3) ─────────────────────────────────────────────────

test("engine ikke instans av Game2Engine/Game3Engine: ingen engine-effekter emittes", async () => {
  // Plain object er ikke instans av noen engine-subklasse — bare
  // draw:new + room:update skal fyre.
  const { io, events } = makeFakeIo();
  const broadcaster = createGame23DrawBroadcaster({
    io: io as unknown as Parameters<
      typeof createGame23DrawBroadcaster
    >[0]["io"],
    engine: {},
    emitRoomUpdate: async () => null,
  });
  broadcaster.onDrawCompleted({
    roomCode: "R",
    number: 1,
    drawIndex: 0,
    gameId: "g",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  // Ingen g2:* eller g3:* events skal være emittet.
  for (const e of events) {
    assert.ok(
      !e.event.startsWith("g2:") && !e.event.startsWith("g3:"),
      `uventet engine-event ${e.event}`,
    );
  }
});

test("draw:new-payload inkluderer eksakt {number, drawIndex, gameId} — ingen ekstra felt", async () => {
  // Wire-paritet med drawEvents.ts:60-61:
  //   io.to(roomCode).emit("draw:new", { number, drawIndex, gameId });
  // Klient (GameBridge) parser disse 3 feltene; ekstra felt ville støy.
  const { io, events } = makeFakeIo();
  const broadcaster = createGame23DrawBroadcaster({
    io: io as unknown as Parameters<
      typeof createGame23DrawBroadcaster
    >[0]["io"],
    engine: {},
    emitRoomUpdate: async () => null,
  });
  broadcaster.onDrawCompleted({
    roomCode: "R",
    number: 42,
    drawIndex: 3,
    gameId: "g-1",
  });

  const drawNew = events.find((e) => e.event === "draw:new");
  assert.ok(drawNew);
  assert.deepEqual(Object.keys(drawNew!.payload as object).sort(), [
    "drawIndex",
    "gameId",
    "number",
  ]);
});
