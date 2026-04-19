/**
 * BIN-615 / PR-C3b: Unit tests for emitG3DrawEvents — the socket-level
 * translator from Game3Engine's G3DrawEffects stash to wire events.
 *
 * Covers:
 *   - `g3:pattern:changed` emitted ONLY when `patternsChanged === true`
 *   - `g3:pattern:changed` filters out already-won patterns from activePatterns
 *   - `g3:pattern:auto-won` emitted once per winning pattern batch
 *   - `g3:pattern:auto-won` lists all winnerPlayerIds + pricePerWinner
 *   - Emit order: changed → auto-won (pattern UI updates before win banners)
 *   - Empty winners → no auto-won fires
 *   - Empty ticketWinners inside a winner record → skipped
 *
 * Uses a minimal Server stub that records `to(room).emit(event, payload)` calls
 * in insertion order — no real Socket.IO needed.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import type { Server } from "socket.io";
import { emitG3DrawEvents } from "../gameEvents.js";
import type { G3DrawEffects, G3PatternSnapshot, G3WinnerRecord } from "../../game/Game3Engine.js";

// ── Test helpers ────────────────────────────────────────────────────────────

interface CapturedEmit {
  room: string;
  event: string;
  payload: unknown;
}

/** Minimal Server stub that records to(room).emit(event, payload) in order. */
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

function makePatternSnapshot(partial: Partial<G3PatternSnapshot> & { id: string; name: string }): G3PatternSnapshot {
  return {
    ballThreshold: 75,
    isFullHouse: false,
    isWon: false,
    design: 0,
    patternDataList: Array(25).fill(0),
    amount: 0,
    ...partial,
  };
}

function makeEffects(partial: Partial<G3DrawEffects> = {}): G3DrawEffects {
  return {
    roomCode: "ROOM-1",
    gameId: "game-abc",
    drawIndex: 5,
    lastBall: 61,
    patternsChanged: false,
    patternSnapshot: [],
    winners: [],
    gameEnded: false,
    ...partial,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("emitG3DrawEvents — g3:pattern:changed gating", () => {
  test("patternsChanged=false → no g3:pattern:changed emit", () => {
    const { io, emits } = makeRecorderIo();
    emitG3DrawEvents(io, makeEffects({ patternsChanged: false }));
    assert.equal(emits.filter((e) => e.event === "g3:pattern:changed").length, 0);
  });

  test("patternsChanged=true with empty winners → single g3:pattern:changed, no auto-won", () => {
    const { io, emits } = makeRecorderIo();
    emitG3DrawEvents(io, makeEffects({
      patternsChanged: true,
      patternSnapshot: [
        makePatternSnapshot({ id: "p-row2", name: "Row 2", ballThreshold: 25 }),
        makePatternSnapshot({ id: "p-fh", name: "Full House", isFullHouse: true }),
      ],
    }));
    const changed = emits.filter((e) => e.event === "g3:pattern:changed");
    const won = emits.filter((e) => e.event === "g3:pattern:auto-won");
    assert.equal(changed.length, 1);
    assert.equal(won.length, 0);
    assert.equal(changed[0].room, "ROOM-1");
    const payload = changed[0].payload as { activePatterns: Array<{ id: string }> };
    assert.equal(payload.activePatterns.length, 2, "both non-won patterns included");
  });

  test("patternsChanged=true filters out patterns where isWon=true", () => {
    const { io, emits } = makeRecorderIo();
    emitG3DrawEvents(io, makeEffects({
      patternsChanged: true,
      patternSnapshot: [
        makePatternSnapshot({ id: "p-row1", name: "Row 1", isWon: true }),  // filtered
        makePatternSnapshot({ id: "p-row2", name: "Row 2" }),
      ],
    }));
    const changed = emits.find((e) => e.event === "g3:pattern:changed");
    assert.ok(changed);
    const payload = changed.payload as { activePatterns: Array<{ id: string }> };
    assert.equal(payload.activePatterns.length, 1);
    assert.equal(payload.activePatterns[0].id, "p-row2");
  });

  test("g3:pattern:changed payload carries drawIndex + gameId + roomCode", () => {
    const { io, emits } = makeRecorderIo();
    emitG3DrawEvents(io, makeEffects({
      roomCode: "R-42",
      gameId: "game-xyz",
      drawIndex: 12,
      patternsChanged: true,
      patternSnapshot: [makePatternSnapshot({ id: "p-x", name: "X" })],
    }));
    const changed = emits.find((e) => e.event === "g3:pattern:changed");
    const payload = changed?.payload as { roomCode: string; gameId: string; drawIndex: number };
    assert.equal(payload.roomCode, "R-42");
    assert.equal(payload.gameId, "game-xyz");
    assert.equal(payload.drawIndex, 12);
  });
});

describe("emitG3DrawEvents — g3:pattern:auto-won emission", () => {
  function makeWinner(partial: Partial<G3WinnerRecord> & { patternId: string; patternName: string }): G3WinnerRecord {
    return {
      isFullHouse: false,
      pricePerWinner: 0,
      ticketWinners: [],
      ...partial,
    };
  }

  test("one g3:pattern:auto-won per winning pattern", () => {
    const { io, emits } = makeRecorderIo();
    emitG3DrawEvents(io, makeEffects({
      winners: [
        makeWinner({
          patternId: "p-row1",
          patternName: "Row 1",
          pricePerWinner: 20,
          ticketWinners: [
            { playerId: "alice", ticketIndex: 0, claimId: "c1", payoutAmount: 20, luckyBonus: 0 },
          ],
        }),
        makeWinner({
          patternId: "p-row2",
          patternName: "Row 2",
          pricePerWinner: 15,
          ticketWinners: [
            { playerId: "bob", ticketIndex: 0, claimId: "c2", payoutAmount: 15, luckyBonus: 0 },
          ],
        }),
      ],
    }));
    const won = emits.filter((e) => e.event === "g3:pattern:auto-won");
    assert.equal(won.length, 2);
    const first = won[0].payload as { patternId: string; patternName: string };
    const second = won[1].payload as { patternId: string; patternName: string };
    assert.equal(first.patternId, "p-row1");
    assert.equal(first.patternName, "Row 1");
    assert.equal(second.patternId, "p-row2");
    assert.equal(second.patternName, "Row 2");
  });

  test("empty ticketWinners in a record → that pattern is skipped", () => {
    const { io, emits } = makeRecorderIo();
    emitG3DrawEvents(io, makeEffects({
      winners: [
        makeWinner({ patternId: "p-empty", patternName: "Empty", pricePerWinner: 0, ticketWinners: [] }),
        makeWinner({
          patternId: "p-real",
          patternName: "Real",
          pricePerWinner: 25,
          ticketWinners: [
            { playerId: "alice", ticketIndex: 0, claimId: "c1", payoutAmount: 25, luckyBonus: 0 },
          ],
        }),
      ],
    }));
    const won = emits.filter((e) => e.event === "g3:pattern:auto-won");
    assert.equal(won.length, 1);
    assert.equal((won[0].payload as { patternId: string }).patternId, "p-real");
  });

  test("multi-winner split: winnerPlayerIds lists every (ticket, pattern) winner", () => {
    const { io, emits } = makeRecorderIo();
    emitG3DrawEvents(io, makeEffects({
      winners: [
        makeWinner({
          patternId: "p-row1",
          patternName: "Row 1",
          pricePerWinner: 10,
          ticketWinners: [
            { playerId: "alice", ticketIndex: 0, claimId: "c1", payoutAmount: 10, luckyBonus: 0 },
            { playerId: "bob", ticketIndex: 0, claimId: "c2", payoutAmount: 10, luckyBonus: 0 },
            { playerId: "alice", ticketIndex: 1, claimId: "c3", payoutAmount: 10, luckyBonus: 0 },
          ],
        }),
      ],
    }));
    const won = emits.find((e) => e.event === "g3:pattern:auto-won");
    const payload = won?.payload as { winnerPlayerIds: string[]; prizePerWinner: number };
    assert.deepEqual(payload.winnerPlayerIds, ["alice", "bob", "alice"], "includes dup when same player wins 2 tickets");
    assert.equal(payload.prizePerWinner, 10);
  });

  test("winners[] empty → no g3:pattern:auto-won fires", () => {
    const { io, emits } = makeRecorderIo();
    emitG3DrawEvents(io, makeEffects({ winners: [] }));
    assert.equal(emits.filter((e) => e.event === "g3:pattern:auto-won").length, 0);
  });
});

describe("emitG3DrawEvents — emit ordering", () => {
  test("g3:pattern:changed fires before g3:pattern:auto-won on the same draw", () => {
    const { io, emits } = makeRecorderIo();
    emitG3DrawEvents(io, makeEffects({
      patternsChanged: true,
      patternSnapshot: [
        // Row 1 already won this draw — filtered out of activePatterns.
        { id: "p-row1", name: "Row 1", ballThreshold: 15, isFullHouse: false, isWon: true, design: 0, patternDataList: Array(25).fill(0), amount: 0 },
        { id: "p-row2", name: "Row 2", ballThreshold: 25, isFullHouse: false, isWon: false, design: 0, patternDataList: Array(25).fill(0), amount: 0 },
      ],
      winners: [{
        patternId: "p-row1",
        patternName: "Row 1",
        isFullHouse: false,
        pricePerWinner: 20,
        ticketWinners: [
          { playerId: "alice", ticketIndex: 0, claimId: "c1", payoutAmount: 20, luckyBonus: 0 },
        ],
      }],
    }));
    assert.equal(emits.length, 2, "exactly one changed + one auto-won");
    assert.equal(emits[0].event, "g3:pattern:changed", "changed MUST emit first");
    assert.equal(emits[1].event, "g3:pattern:auto-won", "auto-won MUST emit after");
  });

  test("patternsChanged=false + winners → only auto-won fires (no change event)", () => {
    const { io, emits } = makeRecorderIo();
    emitG3DrawEvents(io, makeEffects({
      patternsChanged: false,
      winners: [{
        patternId: "p-row1",
        patternName: "Row 1",
        isFullHouse: false,
        pricePerWinner: 20,
        ticketWinners: [
          { playerId: "alice", ticketIndex: 0, claimId: "c1", payoutAmount: 20, luckyBonus: 0 },
        ],
      }],
    }));
    assert.equal(emits.length, 1);
    assert.equal(emits[0].event, "g3:pattern:auto-won");
  });
});

describe("emitG3DrawEvents — Full House termination draw", () => {
  test("Full House win with patternsChanged=true → changed + auto-won for FH", () => {
    const { io, emits } = makeRecorderIo();
    emitG3DrawEvents(io, makeEffects({
      patternsChanged: true,
      gameEnded: true,
      endedReason: "G3_FULL_HOUSE",
      patternSnapshot: [
        { id: "p-fh", name: "Full House", ballThreshold: 75, isFullHouse: true, isWon: true, design: 0, patternDataList: Array(25).fill(1), amount: 1000 },
      ],
      winners: [{
        patternId: "p-fh",
        patternName: "Full House",
        isFullHouse: true,
        pricePerWinner: 1000,
        ticketWinners: [
          { playerId: "alice", ticketIndex: 0, claimId: "c-fh", payoutAmount: 1000, luckyBonus: 0 },
        ],
      }],
    }));
    assert.equal(emits.length, 2);
    assert.equal(emits[0].event, "g3:pattern:changed");
    const changedPayload = emits[0].payload as { activePatterns: unknown[] };
    assert.equal(changedPayload.activePatterns.length, 0, "FH is marked won → filtered out of activePatterns");
    assert.equal(emits[1].event, "g3:pattern:auto-won");
    const wonPayload = emits[1].payload as { patternName: string; prizePerWinner: number };
    assert.equal(wonPayload.patternName, "Full House");
    assert.equal(wonPayload.prizePerWinner, 1000);
  });
});
