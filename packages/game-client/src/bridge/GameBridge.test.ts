/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  /** BIN-502: records resync-requests from bridge, and lets tests stub the response. */
  public getRoomStateCalls: Array<{ roomCode: string; hallId?: string }> = [];
  public getRoomStateResponse: { ok: boolean; data?: { snapshot: RoomSnapshot }; error?: string } = {
    ok: false,
    error: "not-stubbed",
  };

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

  /** BIN-502: stubs SpilloramaSocket.getRoomState. */
  async getRoomState(payload: { roomCode: string; hallId?: string }) {
    this.getRoomStateCalls.push(payload);
    return this.getRoomStateResponse;
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
    armedPlayerIds: [],
    playerStakes: {},
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

      // Snapshot has drawnNumbers=[1,2,3] → lastAppliedDrawIndex=2; next is 3.
      socket.fire("drawNew", { number: 7, drawIndex: 3, gameId: "game-1" });
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

    it("round-state-isolation: myStake reflects active-round stake from playerStakes", () => {
      // RUNNING + 4 live brett → stake = 80 kr.
      bridge.start("player-1");
      socket.fire(
        "roomUpdate",
        makeRoomUpdate({ playerStakes: { "player-1": 80 } }),
      );
      expect(bridge.getState().myStake).toBe(80);
    });

    it("round-state-isolation: myPendingStake reflects pre-round commitment", () => {
      // RUNNING + 50 brett armet for neste runde → pending = 1000 kr.
      bridge.start("player-1");
      socket.fire(
        "roomUpdate",
        makeRoomUpdate({
          playerStakes: { "player-1": 80 },
          playerPendingStakes: { "player-1": 1000 },
        }),
      );
      expect(bridge.getState().myStake).toBe(80);
      expect(bridge.getState().myPendingStake).toBe(1000);
    });

    it("round-state-isolation: missing playerPendingStakes defaults to 0 (older backend)", () => {
      bridge.start("player-1");
      socket.fire(
        "roomUpdate",
        makeRoomUpdate({ playerStakes: { "player-1": 40 } }),
        // playerPendingStakes intentionally omitted
      );
      expect(bridge.getState().myStake).toBe(40);
      expect(bridge.getState().myPendingStake).toBe(0);
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

  // BIN-502: drawIndex gap-deteksjon
  describe("drawIndex gap-deteksjon (BIN-502)", () => {
    beforeEach(() => {
      bridge.start("player-1");
      // Baseline: snapshot med drawnNumbers=[1,2,3] → lastAppliedDrawIndex=2
      bridge.applySnapshot(
        makeRoomSnapshot({ currentGame: makeGameSnapshot({ drawnNumbers: [1, 2, 3] }) }),
      );
    });

    it("accepts ordered drawNew (drawIndex = expected)", () => {
      const listener = vi.fn();
      bridge.on("numberDrawn", listener);

      socket.fire("drawNew", { number: 42, drawIndex: 3, gameId: "game-1" });

      expect(listener).toHaveBeenCalledWith(42, 3, expect.any(Object));
      expect(bridge.getState().drawnNumbers).toEqual([1, 2, 3, 42]);
      expect(bridge.getGapMetrics().lastAppliedDrawIndex).toBe(3);
      expect(bridge.getGapMetrics().gaps).toBe(0);
      expect(bridge.getGapMetrics().duplicates).toBe(0);
      expect(socket.getRoomStateCalls).toHaveLength(0);
    });

    it("ignores duplicate drawNew (drawIndex < expected)", () => {
      const listener = vi.fn();
      bridge.on("numberDrawn", listener);

      // drawIndex 2 is already applied (lastAppliedDrawIndex=2)
      socket.fire("drawNew", { number: 99, drawIndex: 2, gameId: "game-1" });

      expect(listener).not.toHaveBeenCalled();
      expect(bridge.getState().drawnNumbers).toEqual([1, 2, 3]); // unchanged
      expect(bridge.getGapMetrics().duplicates).toBe(1);
      expect(socket.getRoomStateCalls).toHaveLength(0);
    });

    it("detects gap and triggers getRoomState resync (drawIndex > expected)", () => {
      const listener = vi.fn();
      bridge.on("numberDrawn", listener);

      // Expected drawIndex=3, got 5 → gap of 2 missed draws
      socket.fire("drawNew", { number: 77, drawIndex: 5, gameId: "game-1" });

      expect(listener).not.toHaveBeenCalled();
      expect(bridge.getState().drawnNumbers).toEqual([1, 2, 3]); // unchanged
      expect(bridge.getGapMetrics().gaps).toBe(1);
      expect(socket.getRoomStateCalls).toHaveLength(1);
      expect(socket.getRoomStateCalls[0].roomCode).toBe("ROOM-1");
    });

    it("resync applies snapshot and updates lastAppliedDrawIndex", async () => {
      // Stub resync to return snapshot with drawnNumbers=[1..5]
      socket.getRoomStateResponse = {
        ok: true,
        data: {
          snapshot: makeRoomSnapshot({
            currentGame: makeGameSnapshot({ drawnNumbers: [1, 2, 3, 4, 5] }),
          }),
        },
      };

      socket.fire("drawNew", { number: 77, drawIndex: 5, gameId: "game-1" });
      // Wait for async resync promise to resolve
      await new Promise((r) => setTimeout(r, 0));

      expect(bridge.getState().drawnNumbers).toEqual([1, 2, 3, 4, 5]);
      expect(bridge.getGapMetrics().lastAppliedDrawIndex).toBe(4);

      // After resync, next ordered drawNew (drawIndex=5) should apply cleanly
      const listener = vi.fn();
      bridge.on("numberDrawn", listener);
      socket.fire("drawNew", { number: 77, drawIndex: 5, gameId: "game-1" });
      expect(listener).toHaveBeenCalledWith(77, 5, expect.any(Object));
      expect(bridge.getState().drawnNumbers).toEqual([1, 2, 3, 4, 5, 77]);
    });

    it("does not trigger concurrent resyncs", () => {
      // Fire two gaps back-to-back — only one resync should be issued.
      socket.fire("drawNew", { number: 77, drawIndex: 5, gameId: "game-1" });
      socket.fire("drawNew", { number: 88, drawIndex: 7, gameId: "game-1" });

      expect(socket.getRoomStateCalls).toHaveLength(1);
      expect(bridge.getGapMetrics().gaps).toBe(2); // both gaps counted
    });

    it("accepts ordered drawNew from drawIndex=0 on fresh game (no prior snapshot)", () => {
      // Simulate room without active game, then first drawNew arrives
      const freshSocket = new MockSocket();
      const freshBridge = new GameBridge(freshSocket as any);
      freshBridge.start("player-1");
      freshBridge.applySnapshot(makeRoomSnapshot()); // no currentGame

      const listener = vi.fn();
      freshBridge.on("numberDrawn", listener);
      // lastAppliedDrawIndex is still -1 (no snapshot game), so drawIndex=0 is expected
      freshSocket.fire("drawNew", { number: 5, drawIndex: 0, gameId: "game-1" });

      // This currently is expected to fall into the "no roomCode/no game" edge case.
      // After applySnapshot(no-game), roomCode is set but lastAppliedDrawIndex remains -1.
      // So drawIndex=0 matches expected=0 → applies.
      expect(listener).toHaveBeenCalledWith(5, 0, expect.any(Object));
      expect(freshBridge.getGapMetrics().lastAppliedDrawIndex).toBe(0);
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

  describe("BIN-686: room:update/draw:new race — no false gap detection", () => {
    it("room:update within an active round does NOT reset lastAppliedDrawIndex", () => {
      // Setup: apply snapshot with 5 balls drawn → lastAppliedDrawIndex = 4
      bridge.start("player-1");
      bridge.applySnapshot(makeRoomSnapshot({
        currentGame: makeGameSnapshot({ id: "game-42", drawnNumbers: [1, 2, 3, 4, 5] }),
      }));
      expect(bridge.getGapMetrics().lastAppliedDrawIndex).toBe(4);

      // draw:new for index=5 arrives — applied normally
      socket.fire("drawNew", { number: 6, drawIndex: 5, gameId: "game-42" });
      expect(bridge.getGapMetrics().lastAppliedDrawIndex).toBe(5);

      // Now room:update arrives AFTER draw:new with 6 balls drawn (same game).
      // Pre-BIN-686: this reset lastAppliedDrawIndex = 5 (drawnNumbers.length - 1),
      // but then the NEXT draw:new would look like a gap. We assert the index
      // stays untouched so the next draw:new applies cleanly.
      socket.fire("roomUpdate", makeRoomUpdate({
        currentGame: makeGameSnapshot({ id: "game-42", drawnNumbers: [1, 2, 3, 4, 5, 6] }),
      }));
      expect(bridge.getGapMetrics().lastAppliedDrawIndex).toBe(5);
      expect(bridge.getGapMetrics().gaps).toBe(0);
    });

    it("draw:new after a series of room:updates is applied, not flagged as gap", () => {
      bridge.start("player-1");
      bridge.applySnapshot(makeRoomSnapshot({
        currentGame: makeGameSnapshot({ id: "g1", drawnNumbers: [1, 2, 3] }),
      }));

      // Simulate: 5 consecutive room:updates each advancing drawn-count
      // (scheduler broadcasts). Between each, a draw:new arrives.
      // The sequence interleaves — room:update-first, then draw:new.
      for (let i = 0; i < 5; i++) {
        const count = 4 + i; // 4, 5, 6, 7, 8
        const newBall = count;
        const drawn = Array.from({ length: count }, (_, j) => j + 1);
        // room:update advances server-state view
        socket.fire("roomUpdate", makeRoomUpdate({
          currentGame: makeGameSnapshot({ id: "g1", drawnNumbers: drawn }),
        }));
        // draw:new for that ball arrives
        socket.fire("drawNew", { number: newBall, drawIndex: count - 1, gameId: "g1" });
      }

      // All 5 draw:new events must have applied — no gaps, no duplicates.
      const metrics = bridge.getGapMetrics();
      expect(metrics.gaps).toBe(0);
      expect(metrics.duplicates).toBe(0);
      expect(metrics.lastAppliedDrawIndex).toBe(7); // 2 (initial) + 5 draws = index 7
    });

    it("NEW game via room:update (different gameId) DOES reset index", () => {
      bridge.start("player-1");
      bridge.applySnapshot(makeRoomSnapshot({
        currentGame: makeGameSnapshot({ id: "game-A", drawnNumbers: [1, 2, 3, 4, 5] }),
      }));
      expect(bridge.getGapMetrics().lastAppliedDrawIndex).toBe(4);

      // New game — different id. draw:new-events will restart from drawIndex=0,
      // so the bridge MUST reset its baseline or it'd flag the first draw as
      // a duplicate.
      socket.fire("roomUpdate", makeRoomUpdate({
        currentGame: makeGameSnapshot({ id: "game-B", drawnNumbers: [] }),
      }));
      expect(bridge.getGapMetrics().lastAppliedDrawIndex).toBe(-1);

      // First draw of new game applies cleanly
      socket.fire("drawNew", { number: 17, drawIndex: 0, gameId: "game-B" });
      expect(bridge.getGapMetrics().lastAppliedDrawIndex).toBe(0);
      expect(bridge.getGapMetrics().gaps).toBe(0);
    });

    it("WAITING → RUNNING transition resets index (fresh round start)", () => {
      bridge.start("player-1");
      // Start in ENDED — server says last game is over
      bridge.applySnapshot(makeRoomSnapshot({
        currentGame: makeGameSnapshot({ id: "game-prev", status: "ENDED", drawnNumbers: [1, 2, 3] }),
      }));

      // room:update fires with a fresh RUNNING game (new gameId, no draws yet)
      socket.fire("roomUpdate", makeRoomUpdate({
        currentGame: makeGameSnapshot({ id: "game-new", status: "RUNNING", drawnNumbers: [] }),
      }));
      expect(bridge.getGapMetrics().lastAppliedDrawIndex).toBe(-1);
    });
  });

  /**
   * Saldo-flash fix (Tobias 2026-04-26): Wallet rarely changes per-ball,
   * but `room:update` fires on every draw. Without de-duplication, the
   * lobby shell did an optimistic re-render with a wrong split (PR #512
   * vs total balance from game-client) for ~0.5 s every ball. Bridge now
   * caches last-emitted balance and skips identical re-emits.
   */
  describe("spillorama:balanceChanged dedup (saldo-flash fix)", () => {
    let events: Array<{ balance: number }>;
    let listener: (evt: Event) => void;

    beforeEach(() => {
      events = [];
      listener = (evt: Event) => {
        if (evt.type === "spillorama:balanceChanged") {
          const detail = (evt as CustomEvent).detail as { balance: number };
          events.push({ balance: detail.balance });
        }
      };
      window.addEventListener("spillorama:balanceChanged", listener);
    });

    afterEach(() => {
      window.removeEventListener("spillorama:balanceChanged", listener);
    });

    it("emits on first room:update", () => {
      bridge.start("player-1");
      socket.fire("roomUpdate", makeRoomUpdate());
      expect(events).toEqual([{ balance: 100 }]);
    });

    it("skips re-emit when 100 room:update events carry identical balance", () => {
      bridge.start("player-1");
      for (let i = 0; i < 100; i++) {
        socket.fire("roomUpdate", makeRoomUpdate({ serverTimestamp: Date.now() + i }));
      }
      // Only the first room:update produced an emit; the other 99 are deduped.
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ balance: 100 });
    });

    it("re-emits when balance actually changes", () => {
      bridge.start("player-1");
      socket.fire("roomUpdate", makeRoomUpdate());
      socket.fire(
        "roomUpdate",
        makeRoomUpdate({
          players: [{ id: "player-1", name: "Test", walletId: "w1", balance: 80 }],
        }),
      );
      socket.fire(
        "roomUpdate",
        makeRoomUpdate({
          players: [{ id: "player-1", name: "Test", walletId: "w1", balance: 80 }],
        }),
      );
      socket.fire(
        "roomUpdate",
        makeRoomUpdate({
          players: [{ id: "player-1", name: "Test", walletId: "w1", balance: 60 }],
        }),
      );
      expect(events).toEqual([
        { balance: 100 },
        { balance: 80 },
        // identical 80 deduped
        { balance: 60 },
      ]);
    });

    it("stop() resets cache so a fresh start re-emits the first balance", () => {
      bridge.start("player-1");
      socket.fire("roomUpdate", makeRoomUpdate());
      expect(events).toHaveLength(1);

      bridge.stop();
      bridge.start("player-1");
      socket.fire("roomUpdate", makeRoomUpdate());
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ balance: 100 });
    });
  });
});
