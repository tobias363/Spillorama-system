import { describe, it, expect, vi, beforeEach } from "vitest";
import { GameBridge } from "./GameBridge.js";
import type { SpilloramaSocketListeners } from "../net/SpilloramaSocket.js";
import type { RoomSnapshot, GameSnapshot } from "@spillorama/shared-types/game";
import type {
  RoomUpdatePayload,
  DrawNewPayload,
  PatternWonPayload,
} from "@spillorama/shared-types/socket-events";

// ── Mock socket ─────────────────────────────────────────────────────────────

class MockSocket {
  private listeners: Record<string, Set<(...args: any[]) => void>> = {};

  on<K extends keyof SpilloramaSocketListeners>(
    event: K,
    listener: SpilloramaSocketListeners[K],
  ): () => void {
    if (!this.listeners[event]) this.listeners[event] = new Set();
    this.listeners[event].add(listener as any);
    return () => this.listeners[event]?.delete(listener as any);
  }

  /** Fire an event to simulate server broadcast. */
  fire<K extends keyof SpilloramaSocketListeners>(
    event: K,
    ...args: Parameters<SpilloramaSocketListeners[K]>
  ): void {
    for (const fn of this.listeners[event] || []) {
      (fn as (...a: any[]) => void)(...args);
    }
  }
}

// ── Fixture factories ───────────────────────────────────────────────────────

function makeGameSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    id: "game-1",
    status: "RUNNING",
    entryFee: 10,
    ticketsPerPlayer: 1,
    prizePool: 100,
    remainingPrizePool: 100,
    payoutPercent: 80,
    maxPayoutBudget: 80,
    remainingPayoutBudget: 80,
    drawBag: [10, 20, 30, 40, 50],
    drawnNumbers: [1, 2, 3],
    remainingNumbers: 5,
    claims: [],
    tickets: { "player-1": [{ grid: [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]] }] },
    marks: { "player-1": [[1, 2, 3]] },
    startedAt: "2026-04-14T08:00:00Z",
    ...overrides,
  };
}

function makeRoomSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ROOM-1",
    hallId: "hall-1",
    hostPlayerId: "player-1",
    createdAt: "2026-04-14T08:00:00Z",
    players: [{ id: "player-1", name: "Test", walletId: "w1", balance: 100 }],
    gameHistory: [],
    ...overrides,
  };
}

function makeRoomUpdate(overrides: Partial<RoomUpdatePayload> = {}): RoomUpdatePayload {
  const snap = makeRoomSnapshot();
  return {
    ...snap,
    scheduler: {},
    preRoundTickets: {},
    luckyNumbers: {},
    serverTimestamp: Date.now(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("GameBridge", () => {
  let socket: MockSocket;
  let bridge: GameBridge;

  beforeEach(() => {
    socket = new MockSocket();
    bridge = new GameBridge(socket as any);
  });

  describe("applySnapshot", () => {
    it("populates state from room snapshot without game", () => {
      bridge.start("player-1");
      bridge.applySnapshot(makeRoomSnapshot());

      const state = bridge.getState();
      expect(state.roomCode).toBe("ROOM-1");
      expect(state.hallId).toBe("hall-1");
      expect(state.playerCount).toBe(1);
      expect(state.gameStatus).toBe("NONE");
      expect(state.myPlayerId).toBe("player-1");
    });

    it("populates state from room snapshot with active game", () => {
      bridge.start("player-1");
      bridge.applySnapshot(
        makeRoomSnapshot({ currentGame: makeGameSnapshot() }),
      );

      const state = bridge.getState();
      expect(state.gameStatus).toBe("RUNNING");
      expect(state.gameId).toBe("game-1");
      expect(state.drawnNumbers).toEqual([1, 2, 3]);
      expect(state.drawCount).toBe(3);
      expect(state.lastDrawnNumber).toBe(3);
      expect(state.myTickets).toHaveLength(1);
      expect(state.myMarks).toEqual([[1, 2, 3]]);
      expect(state.prizePool).toBe(100);
      expect(state.totalDrawCapacity).toBe(8); // 5 bag + 3 drawn
    });

    it("emits stateChanged on applySnapshot", () => {
      bridge.start("player-1");
      const listener = vi.fn();
      bridge.on("stateChanged", listener);

      bridge.applySnapshot(makeRoomSnapshot());
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe("game lifecycle transitions", () => {
    it("emits gameStarted when status transitions to RUNNING", () => {
      bridge.start("player-1");
      const onStarted = vi.fn();
      bridge.on("gameStarted", onStarted);

      // First update: no game
      socket.fire("roomUpdate", makeRoomUpdate());
      expect(onStarted).not.toHaveBeenCalled();

      // Second update: game starts
      socket.fire(
        "roomUpdate",
        makeRoomUpdate({ currentGame: makeGameSnapshot({ status: "RUNNING" }) }),
      );
      expect(onStarted).toHaveBeenCalledOnce();
    });

    it("emits gameEnded when status transitions from RUNNING to ENDED", () => {
      bridge.start("player-1");
      const onEnded = vi.fn();
      bridge.on("gameEnded", onEnded);

      // Start game
      socket.fire(
        "roomUpdate",
        makeRoomUpdate({ currentGame: makeGameSnapshot({ status: "RUNNING" }) }),
      );

      // End game
      socket.fire(
        "roomUpdate",
        makeRoomUpdate({ currentGame: makeGameSnapshot({ status: "ENDED" }) }),
      );
      expect(onEnded).toHaveBeenCalledOnce();
    });

    it("emits gameEnded when game disappears from update", () => {
      bridge.start("player-1");
      const onEnded = vi.fn();
      bridge.on("gameEnded", onEnded);

      // Start game
      socket.fire(
        "roomUpdate",
        makeRoomUpdate({ currentGame: makeGameSnapshot({ status: "RUNNING" }) }),
      );

      // Game removed (no currentGame)
      socket.fire("roomUpdate", makeRoomUpdate({ currentGame: undefined }));
      expect(onEnded).toHaveBeenCalledOnce();
    });

    it("does not emit gameStarted for WAITING → ENDED", () => {
      bridge.start("player-1");
      const onStarted = vi.fn();
      bridge.on("gameStarted", onStarted);

      socket.fire(
        "roomUpdate",
        makeRoomUpdate({ currentGame: makeGameSnapshot({ status: "WAITING" }) }),
      );
      socket.fire(
        "roomUpdate",
        makeRoomUpdate({ currentGame: makeGameSnapshot({ status: "ENDED" }) }),
      );
      expect(onStarted).not.toHaveBeenCalled();
    });
  });

  describe("handleDrawNew", () => {
    it("appends drawn number to state", () => {
      bridge.start("player-1");
      bridge.applySnapshot(
        makeRoomSnapshot({ currentGame: makeGameSnapshot({ drawnNumbers: [] }) }),
      );

      const payload: DrawNewPayload = { number: 42, drawIndex: 0, gameId: "game-1" };
      socket.fire("drawNew", payload);

      const state = bridge.getState();
      expect(state.drawnNumbers).toEqual([42]);
      expect(state.lastDrawnNumber).toBe(42);
      expect(state.drawCount).toBe(1);
    });

    it("emits numberDrawn with correct args", () => {
      bridge.start("player-1");
      bridge.applySnapshot(makeRoomSnapshot({ currentGame: makeGameSnapshot() }));

      const listener = vi.fn();
      bridge.on("numberDrawn", listener);

      const payload: DrawNewPayload = { number: 55, drawIndex: 3, gameId: "game-1" };
      socket.fire("drawNew", payload);

      expect(listener).toHaveBeenCalledWith(55, 3, expect.any(Object));
    });

    it("emits stateChanged after numberDrawn", () => {
      bridge.start("player-1");
      bridge.applySnapshot(makeRoomSnapshot({ currentGame: makeGameSnapshot() }));

      const events: string[] = [];
      bridge.on("numberDrawn", () => events.push("numberDrawn"));
      bridge.on("stateChanged", () => events.push("stateChanged"));

      socket.fire("drawNew", { number: 7, drawIndex: 0, gameId: "game-1" });
      expect(events).toEqual(["numberDrawn", "stateChanged"]);
    });
  });

  describe("handlePatternWon", () => {
    it("updates matching pattern result", () => {
      const gameSnapshot = makeGameSnapshot({
        patternResults: [
          { patternId: "p1", patternName: "LINE", claimType: "LINE", isWon: false },
          { patternId: "p2", patternName: "BINGO", claimType: "BINGO", isWon: false },
        ],
      });

      bridge.start("player-1");
      bridge.applySnapshot(makeRoomSnapshot({ currentGame: gameSnapshot }));

      const wonPayload: PatternWonPayload = {
        patternId: "p1",
        patternName: "LINE",
        winnerId: "player-1",
        wonAtDraw: 5,
        payoutAmount: 50,
        claimType: "LINE",
        gameId: "game-1",
      };
      socket.fire("patternWon", wonPayload);

      const result = bridge.getState().patternResults.find((r) => r.patternId === "p1");
      expect(result?.isWon).toBe(true);
      expect(result?.winnerId).toBe("player-1");
      expect(result?.payoutAmount).toBe(50);
    });

    it("emits patternWon event", () => {
      bridge.start("player-1");
      bridge.applySnapshot(makeRoomSnapshot({ currentGame: makeGameSnapshot() }));

      const listener = vi.fn();
      bridge.on("patternWon", listener);

      const payload: PatternWonPayload = {
        patternId: "p1",
        patternName: "LINE",
        winnerId: "player-2",
        wonAtDraw: 3,
        payoutAmount: 40,
        claimType: "LINE",
        gameId: "game-1",
      };
      socket.fire("patternWon", payload);
      expect(listener).toHaveBeenCalledWith(payload, expect.any(Object));
    });
  });

  describe("lucky numbers and pre-round tickets", () => {
    it("picks up lucky number for current player", () => {
      bridge.start("player-1");

      socket.fire(
        "roomUpdate",
        makeRoomUpdate({ luckyNumbers: { "player-1": 7, "player-2": 13 } }),
      );

      expect(bridge.getState().myLuckyNumber).toBe(7);
    });

    it("picks up pre-round tickets for current player", () => {
      bridge.start("player-1");
      const tickets = [{ grid: [[1, 2, 3, 4, 5]] }];

      socket.fire(
        "roomUpdate",
        makeRoomUpdate({ preRoundTickets: { "player-1": tickets } }),
      );

      expect(bridge.getState().preRoundTickets).toEqual(tickets);
    });
  });

  describe("event subscription", () => {
    it("unsubscribe removes listener", () => {
      bridge.start("player-1");
      bridge.applySnapshot(makeRoomSnapshot({ currentGame: makeGameSnapshot() }));

      const listener = vi.fn();
      const unsub = bridge.on("numberDrawn", listener);
      unsub();

      socket.fire("drawNew", { number: 1, drawIndex: 0, gameId: "game-1" });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("resets state to empty", () => {
      bridge.start("player-1");
      bridge.applySnapshot(
        makeRoomSnapshot({ currentGame: makeGameSnapshot() }),
      );
      expect(bridge.getState().gameStatus).toBe("RUNNING");

      bridge.stop();
      expect(bridge.getState().gameStatus).toBe("NONE");
      expect(bridge.getState().drawnNumbers).toEqual([]);
      expect(bridge.getState().myPlayerId).toBeNull();
    });

    it("stops receiving events after stop", () => {
      bridge.start("player-1");
      bridge.applySnapshot(makeRoomSnapshot({ currentGame: makeGameSnapshot() }));

      const listener = vi.fn();
      bridge.on("numberDrawn", listener);
      bridge.stop();

      socket.fire("drawNew", { number: 99, drawIndex: 0, gameId: "game-1" });
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
