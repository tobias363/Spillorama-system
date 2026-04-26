/**
 * Bølge D coverage: emitG2DrawEvents — den socket-level oversetteren fra
 * Game2Engine sin G2DrawEffects-stash til wire-events.
 *
 * Wire-kontrakt (legacy parity):
 *   - g2:jackpot:list-update   → ALLTID (hvert G2-trekk, regardless of winners)
 *   - g2:rocket:launch         → kun når winners.length > 0 (én per winner)
 *   - g2:ticket:completed      → kun når winners.length > 0 (én per winner)
 *
 * Counterpart til g3Events.test.ts. Bruker samme recorder-IO-pattern.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import type { Server } from "socket.io";
import { emitG2DrawEvents } from "../gameEvents/drawEmits.js";
import type { G2DrawEffects, G2WinnerRecord } from "../../game/Game2Engine.js";

interface CapturedEmit {
  room: string;
  event: string;
  payload: unknown;
}

function makeRecorderIo(): { io: Server; emits: CapturedEmit[] } {
  const emits: CapturedEmit[] = [];
  const io = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emits.push({ room, event, payload });
        },
      };
    },
  } as unknown as Server;
  return { io, emits };
}

function makeEffects(partial: Partial<G2DrawEffects> = {}): G2DrawEffects {
  return {
    roomCode: "ROOM-G2",
    gameId: "g2-game-1",
    drawIndex: 9,
    lastBall: 42,
    jackpotList: [],
    winners: [],
    gameEnded: false,
    ...partial,
  };
}

function makeWinner(partial: Partial<G2WinnerRecord> = {}): G2WinnerRecord {
  return {
    playerId: "alice",
    ticketIndex: 0,
    ticketId: "t-1",
    claimId: "claim-1",
    jackpotPrize: 1000,
    luckyBonus: 0,
    totalPayout: 1000,
    ...partial,
  };
}

// ── g2:jackpot:list-update — alltid ──────────────────────────────────────

describe("emitG2DrawEvents — g2:jackpot:list-update emission", () => {
  test("uten winners: kun jackpot:list-update fires (ingen rocket/ticket-events)", () => {
    const { io, emits } = makeRecorderIo();
    emitG2DrawEvents(io, makeEffects({ winners: [] }));
    assert.equal(emits.length, 1);
    assert.equal(emits[0].event, "g2:jackpot:list-update");
    assert.equal(emits[0].room, "ROOM-G2");
  });

  test("jackpot:list-update payload bærer roomCode, gameId, jackpotList, currentDraw", () => {
    const { io, emits } = makeRecorderIo();
    emitG2DrawEvents(io, makeEffects({
      roomCode: "ROOM-X",
      gameId: "game-xyz",
      drawIndex: 12,
      jackpotList: [
        { number: 5, prize: 100, payouts: [] },
        { number: 7, prize: 200, payouts: [] },
      ] as unknown as G2DrawEffects["jackpotList"],
    }));
    const update = emits.find((e) => e.event === "g2:jackpot:list-update");
    assert.ok(update);
    const payload = update.payload as {
      roomCode: string;
      gameId: string;
      jackpotList: unknown[];
      currentDraw: number;
    };
    assert.equal(payload.roomCode, "ROOM-X");
    assert.equal(payload.gameId, "game-xyz");
    assert.equal(payload.currentDraw, 12);
    assert.equal(payload.jackpotList.length, 2);
  });

  test("tom jackpotList — fortsatt emit (hver G2-draw skal trigge update)", () => {
    const { io, emits } = makeRecorderIo();
    emitG2DrawEvents(io, makeEffects({ jackpotList: [] }));
    assert.equal(emits.filter((e) => e.event === "g2:jackpot:list-update").length, 1);
  });
});

// ── g2:rocket:launch + g2:ticket:completed ────────────────────────────────

describe("emitG2DrawEvents — winner emissions", () => {
  test("én winner: jackpot:list + rocket:launch + ticket:completed (3 events)", () => {
    const { io, emits } = makeRecorderIo();
    emitG2DrawEvents(io, makeEffects({
      winners: [makeWinner({ playerId: "alice", ticketId: "t-1" })],
    }));
    assert.equal(emits.length, 3);
    assert.equal(emits[0].event, "g2:jackpot:list-update");
    assert.equal(emits[1].event, "g2:rocket:launch");
    assert.equal(emits[2].event, "g2:ticket:completed");
  });

  test("rocket:launch payload bærer playerId, ticketId, drawIndex, totalDraws", () => {
    const { io, emits } = makeRecorderIo();
    emitG2DrawEvents(io, makeEffects({
      drawIndex: 15,
      winners: [makeWinner({ playerId: "alice", ticketId: "t-1" })],
    }));
    const rocket = emits.find((e) => e.event === "g2:rocket:launch");
    const payload = rocket?.payload as {
      playerId: string;
      ticketId: string;
      drawIndex: number;
      totalDraws: number;
    };
    assert.equal(payload.playerId, "alice");
    assert.equal(payload.ticketId, "t-1");
    assert.equal(payload.drawIndex, 15);
    assert.equal(payload.totalDraws, 15, "totalDraws = drawIndex (legacy parity)");
  });

  test("multi-winner: én rocket + én ticket-completed per winner", () => {
    const { io, emits } = makeRecorderIo();
    emitG2DrawEvents(io, makeEffects({
      winners: [
        makeWinner({ playerId: "alice", ticketId: "t-1" }),
        makeWinner({ playerId: "bob", ticketId: "t-2" }),
        makeWinner({ playerId: "charlie", ticketId: "t-3" }),
      ],
    }));
    assert.equal(emits.filter((e) => e.event === "g2:rocket:launch").length, 3);
    assert.equal(emits.filter((e) => e.event === "g2:ticket:completed").length, 3);

    const rockets = emits.filter((e) => e.event === "g2:rocket:launch");
    const playerIds = rockets.map((e) => (e.payload as { playerId: string }).playerId);
    assert.deepEqual(playerIds, ["alice", "bob", "charlie"]);
  });

  test("ticket:completed payload bærer playerId og ticketId per winner", () => {
    const { io, emits } = makeRecorderIo();
    emitG2DrawEvents(io, makeEffects({
      winners: [makeWinner({ playerId: "bob", ticketId: "t-9" })],
    }));
    const completed = emits.find((e) => e.event === "g2:ticket:completed");
    const payload = completed?.payload as {
      playerId: string;
      ticketId: string;
      gameId: string;
      drawIndex: number;
    };
    assert.equal(payload.playerId, "bob");
    assert.equal(payload.ticketId, "t-9");
  });
});

// ── Emit ordering ──────────────────────────────────────────────────────────

describe("emitG2DrawEvents — emit ordering", () => {
  test("jackpot:list-update fires FØR rocket:launch og ticket:completed", () => {
    const { io, emits } = makeRecorderIo();
    emitG2DrawEvents(io, makeEffects({
      winners: [makeWinner()],
    }));
    // Klient-flyt: jackpot-list må oppdateres FØR rocket-animasjon kjører
    // — ellers ser brukeren rocket på en utdatert jackpot-display.
    const jackpotIdx = emits.findIndex((e) => e.event === "g2:jackpot:list-update");
    const rocketIdx = emits.findIndex((e) => e.event === "g2:rocket:launch");
    const completedIdx = emits.findIndex((e) => e.event === "g2:ticket:completed");
    assert.equal(jackpotIdx, 0, "jackpot:list-update må fire først");
    assert.ok(rocketIdx > jackpotIdx, "rocket etter jackpot");
    assert.ok(completedIdx > rocketIdx, "completed etter rocket");
  });

  test("multi-winner ordering: rocket1 → completed1 → rocket2 → completed2", () => {
    const { io, emits } = makeRecorderIo();
    emitG2DrawEvents(io, makeEffects({
      winners: [
        makeWinner({ playerId: "alice", ticketId: "t-1" }),
        makeWinner({ playerId: "bob", ticketId: "t-2" }),
      ],
    }));
    // Forventet rekkefølge: jackpot, rocket(alice), ticket(alice), rocket(bob), ticket(bob)
    assert.equal(emits[0].event, "g2:jackpot:list-update");
    assert.equal(emits[1].event, "g2:rocket:launch");
    assert.equal((emits[1].payload as { playerId: string }).playerId, "alice");
    assert.equal(emits[2].event, "g2:ticket:completed");
    assert.equal((emits[2].payload as { playerId: string }).playerId, "alice");
    assert.equal(emits[3].event, "g2:rocket:launch");
    assert.equal((emits[3].payload as { playerId: string }).playerId, "bob");
    assert.equal(emits[4].event, "g2:ticket:completed");
    assert.equal((emits[4].payload as { playerId: string }).playerId, "bob");
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────

describe("emitG2DrawEvents — edge cases", () => {
  test("alle emit-kalls bruker effects.roomCode (ikke en annen room)", () => {
    const { io, emits } = makeRecorderIo();
    emitG2DrawEvents(io, makeEffects({
      roomCode: "ROOM-Z",
      winners: [makeWinner(), makeWinner({ playerId: "bob" })],
    }));
    for (const emit of emits) {
      assert.equal(emit.room, "ROOM-Z", `event ${emit.event} skal route til ROOM-Z`);
    }
  });

  test("gameEnded=true påvirker ikke wire-events (jackpot+rocket+ticket fortsatt)", () => {
    const { io, emits } = makeRecorderIo();
    emitG2DrawEvents(io, makeEffects({
      gameEnded: true,
      endedReason: "G2_NINE_OF_NINE",
      winners: [makeWinner()],
    }));
    // gameEnded leder ikke til ekstra eller færre wire-events i emit-er.
    assert.equal(emits.length, 3);
  });
});
