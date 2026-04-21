/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Game1ReconnectFlow, type ReconnectFlowDeps } from "./ReconnectFlow.js";
import type { GameBridge, GameState } from "../../../bridge/GameBridge.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import type { LoadingOverlay } from "../../../components/LoadingOverlay.js";

function makeBridge(initialState: Partial<GameState> = {}) {
  let state = {
    gameStatus: "WAITING",
    drawnNumbers: [] as number[],
    myTickets: [],
    ...initialState,
  } as GameState;
  const drawListeners: Array<() => void> = [];
  const stateListeners: Array<(s: GameState) => void> = [];

  const bridge: Partial<GameBridge> = {
    getState: () => state,
    applySnapshot: vi.fn((snapshot: unknown) => {
      state = { ...state, ...(snapshot as Partial<GameState>) };
    }),
    on: vi.fn((event: string, cb: unknown) => {
      if (event === "numberDrawn") drawListeners.push(cb as () => void);
      if (event === "stateChanged") stateListeners.push(cb as (s: GameState) => void);
      return () => {};
    }),
  };

  return {
    bridge: bridge as GameBridge,
    emitDraw: () => drawListeners.forEach((l) => l()),
    emitStateChanged: (s: GameState) => stateListeners.forEach((l) => l(s)),
    setState: (patch: Partial<GameState>) => { state = { ...state, ...patch } as GameState; },
  };
}

function makeDeps(overrides: Partial<ReconnectFlowDeps> = {}) {
  const socket = {
    resumeRoom: vi.fn().mockResolvedValue({ ok: true, data: { snapshot: { gameStatus: "WAITING" } } }),
    getRoomState: vi.fn().mockResolvedValue({ ok: false }),
  } as unknown as SpilloramaSocket & {
    resumeRoom: ReturnType<typeof vi.fn>;
    getRoomState: ReturnType<typeof vi.fn>;
  };
  const loader = { setState: vi.fn() } as unknown as LoadingOverlay;
  const { bridge } = makeBridge();
  return {
    deps: { socket, bridge, loader, ...overrides },
    socket,
    loader,
  };
}

describe("Game1ReconnectFlow", () => {
  describe("waitForSyncReady", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("skips sync when not RUNNING at entry (WAITING/ENDED)", async () => {
      const { bridge } = makeBridge({ gameStatus: "WAITING" });
      const { deps, loader } = makeDeps({ bridge });
      const flow = new Game1ReconnectFlow(deps);
      await flow.waitForSyncReady();
      // Did NOT set SYNCING
      expect(loader.setState).not.toHaveBeenCalledWith("SYNCING");
    });

    it("sets SYNCING and resolves on numberDrawn when RUNNING", async () => {
      const bridgeCtx = makeBridge({ gameStatus: "RUNNING" });
      const { deps, loader } = makeDeps({ bridge: bridgeCtx.bridge });
      const flow = new Game1ReconnectFlow(deps);
      const p = flow.waitForSyncReady();
      // Let the promise subscribe to events
      await Promise.resolve();
      bridgeCtx.emitDraw();
      await p;
      expect(loader.setState).toHaveBeenCalledWith("SYNCING");
    });

    it("resolves on stateChanged when drawnNumbers-length grows", async () => {
      const bridgeCtx = makeBridge({ gameStatus: "RUNNING", drawnNumbers: [1, 2] });
      const { deps } = makeDeps({ bridge: bridgeCtx.bridge });
      const flow = new Game1ReconnectFlow(deps);
      const p = flow.waitForSyncReady();
      await Promise.resolve();
      bridgeCtx.emitStateChanged({ gameStatus: "RUNNING", drawnNumbers: [1, 2, 3] } as GameState);
      await p;
      // Fulfilled — no assertion beyond "doesn't hang past timeout"
    });

    it("times out after 5 s if no live event arrives", async () => {
      const bridgeCtx = makeBridge({ gameStatus: "RUNNING" });
      const { deps } = makeDeps({ bridge: bridgeCtx.bridge });
      const flow = new Game1ReconnectFlow(deps);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const p = flow.waitForSyncReady();
      vi.advanceTimersByTime(5001);
      await p;
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("handleReconnect", () => {
    it("no-ops when roomCode is empty", async () => {
      const { deps, socket, loader } = makeDeps();
      const onTransition = vi.fn();
      await new Game1ReconnectFlow(deps).handleReconnect("", onTransition);
      expect(socket.resumeRoom).not.toHaveBeenCalled();
      expect(loader.setState).toHaveBeenCalledWith("READY");
      expect(onTransition).not.toHaveBeenCalled();
    });

    it("applies snapshot + transitions to WAITING when game not running", async () => {
      const { bridge, setState } = makeBridge({ gameStatus: "WAITING" });
      const socket = {
        resumeRoom: vi.fn().mockResolvedValue({ ok: true, data: { snapshot: { gameStatus: "WAITING" } as unknown as GameState } }),
        getRoomState: vi.fn(),
      } as unknown as SpilloramaSocket;
      // apply-snapshot should move state into bridge; our fake does the set
      (bridge.applySnapshot as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => setState({ gameStatus: "WAITING" }));
      const { deps, loader } = makeDeps({ socket, bridge });
      const onTransition = vi.fn();
      await new Game1ReconnectFlow(deps).handleReconnect("ROOM-1", onTransition);
      expect(onTransition).toHaveBeenCalledWith("WAITING", expect.any(Object));
      expect(loader.setState).toHaveBeenCalledWith("READY");
    });

    it("transitions to PLAYING when RUNNING with myTickets", async () => {
      const { bridge, setState } = makeBridge();
      const socket = {
        resumeRoom: vi.fn().mockResolvedValue({ ok: true, data: { snapshot: {} } }),
        getRoomState: vi.fn(),
      } as unknown as SpilloramaSocket;
      (bridge.applySnapshot as unknown as ReturnType<typeof vi.fn>).mockImplementation(() =>
        setState({ gameStatus: "RUNNING", myTickets: [{ id: "t1" } as never] }),
      );
      const { deps } = makeDeps({ socket, bridge });
      const onTransition = vi.fn();
      await new Game1ReconnectFlow(deps).handleReconnect("ROOM-1", onTransition);
      expect(onTransition).toHaveBeenCalledWith("PLAYING", expect.any(Object));
    });

    it("transitions to SPECTATING when RUNNING with no tickets (BIN-507)", async () => {
      const { bridge, setState } = makeBridge();
      const socket = {
        resumeRoom: vi.fn().mockResolvedValue({ ok: true, data: { snapshot: {} } }),
        getRoomState: vi.fn(),
      } as unknown as SpilloramaSocket;
      (bridge.applySnapshot as unknown as ReturnType<typeof vi.fn>).mockImplementation(() =>
        setState({ gameStatus: "RUNNING", myTickets: [] }),
      );
      const { deps } = makeDeps({ socket, bridge });
      const onTransition = vi.fn();
      await new Game1ReconnectFlow(deps).handleReconnect("ROOM-1", onTransition);
      expect(onTransition).toHaveBeenCalledWith("SPECTATING", expect.any(Object));
    });

    it("falls back to getRoomState when resumeRoom has no snapshot", async () => {
      const { bridge, setState } = makeBridge();
      const socket = {
        resumeRoom: vi.fn().mockResolvedValue({ ok: false, error: { message: "stale" } }),
        getRoomState: vi.fn().mockResolvedValue({ ok: true, data: { snapshot: {} } }),
      } as unknown as SpilloramaSocket;
      (bridge.applySnapshot as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => setState({ gameStatus: "WAITING" }));
      const { deps } = makeDeps({ socket, bridge });
      await new Game1ReconnectFlow(deps).handleReconnect("ROOM-1", vi.fn());
      expect(socket.getRoomState).toHaveBeenCalledWith({ roomCode: "ROOM-1" });
    });

    it("leaves loader in RESYNCING when both paths fail (shows 'Last siden på nytt' via stuck-timer)", async () => {
      const socket = {
        resumeRoom: vi.fn().mockResolvedValue({ ok: false }),
        getRoomState: vi.fn().mockResolvedValue({ ok: false }),
      } as unknown as SpilloramaSocket;
      const { deps, loader } = makeDeps({ socket });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await new Game1ReconnectFlow(deps).handleReconnect("ROOM-1", vi.fn());
      expect(loader.setState).toHaveBeenCalledWith("RESYNCING");
      // READY is NOT called on the failure path — deliberate so stuck-timer surfaces reload.
      expect(loader.setState).not.toHaveBeenCalledWith("READY");
      errSpy.mockRestore();
    });
  });
});
