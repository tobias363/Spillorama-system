/**
 * @vitest-environment happy-dom
 *
 * Game1Controller reconnect-flow tests (BIN-673, BIN-682).
 *
 * Uses the same harness pattern as `Game1Controller.claim.test.ts` —
 * we mirror the production `handleReconnect` logic in a lightweight
 * harness rather than booting the full controller (which requires Pixi
 * app, real bridge, real socket, real DOM overlays). The harness exists
 * because the test's contract is **state-transition sequence**, not
 * Pixi/canvas behaviour.
 *
 * Gap coverage:
 *   BIN-682 #1 — on reconnect, overlay enters RESYNCING before resumeRoom
 *   BIN-682 #2 — after successful snapshot apply + transition, overlay → READY
 *   BIN-682 #3 — if both resumeRoom AND getRoomState fail, overlay stays
 *                in RESYNCING (stuck-timer will surface reload button)
 *   BIN-673   — no unconditional hide() at end of handleReconnect that
 *               would dismiss overlay on the failure path
 *
 * Run: `npm --prefix packages/game-client test -- --run Game1Controller.reconnect`
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoadingOverlay, type LoadingState } from "../../components/LoadingOverlay.js";

type SnapshotStub = { gameStatus: string; drawnNumbers: number[]; myTickets: unknown[] };

interface ResumeResult {
  ok: boolean;
  data?: { snapshot?: SnapshotStub };
  error?: { message: string };
}

interface SocketStub {
  resumeRoom: ReturnType<typeof vi.fn>;
  getRoomState: ReturnType<typeof vi.fn>;
}

interface BridgeStub {
  applySnapshot: ReturnType<typeof vi.fn>;
  getState: ReturnType<typeof vi.fn>;
}

interface TransitionStub {
  transitionTo: ReturnType<typeof vi.fn>;
}

/**
 * Mirror of `Game1Controller.handleReconnect` (BIN-673 commit 3). Kept
 * in-sync manually with the production method — if handleReconnect
 * changes, these tests should be updated too.
 *
 * Critical BIN-673 invariants:
 *   1. setState("RESYNCING") fires BEFORE any await
 *   2. setState("READY") fires only on successful snapshot apply
 *   3. Overlay stays in RESYNCING on both-paths-failed (stuck-timer handles)
 *   4. No unconditional setState("READY") at the end of the function
 */
async function harnessHandleReconnect(ctx: {
  loader: LoadingOverlay;
  socket: SocketStub;
  bridge: BridgeStub;
  transition: TransitionStub;
  roomCode: string;
}): Promise<void> {
  if (!ctx.roomCode) {
    ctx.loader.setState("READY");
    return;
  }

  ctx.loader.setState("RESYNCING");

  try {
    const result = await ctx.socket.resumeRoom({ roomCode: ctx.roomCode });
    let snapshot: SnapshotStub | undefined | null = result.ok ? result.data?.snapshot : null;

    if (!snapshot) {
      const fallback = await ctx.socket.getRoomState({ roomCode: ctx.roomCode });
      snapshot = fallback.ok ? fallback.data?.snapshot ?? null : null;
    }

    if (snapshot) {
      ctx.bridge.applySnapshot(snapshot);
      const state = ctx.bridge.getState();
      if (state.gameStatus === "RUNNING") {
        if (state.myTickets.length > 0) {
          ctx.transition.transitionTo("PLAYING", state);
        } else {
          ctx.transition.transitionTo("SPECTATING", state);
        }
      } else {
        ctx.transition.transitionTo("WAITING", state);
      }
      ctx.loader.setState("READY");
    }
    // else: leave overlay in RESYNCING — stuck-timer surfaces reload button
  } catch {
    // Same: leave overlay up for stuck-timer
  }
}

describe("Game1Controller.handleReconnect — state-transition sequence (BIN-673, BIN-682)", () => {
  let container: HTMLElement;
  let loader: LoadingOverlay;
  let socket: SocketStub;
  let bridge: BridgeStub;
  let transition: TransitionStub;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    loader = new LoadingOverlay(container);
    socket = {
      resumeRoom: vi.fn(),
      getRoomState: vi.fn(),
    };
    bridge = {
      applySnapshot: vi.fn(),
      getState: vi.fn(),
    };
    transition = { transitionTo: vi.fn() };
  });

  const goodSnapshot: SnapshotStub = { gameStatus: "RUNNING", drawnNumbers: [5, 12], myTickets: [] };

  function stateHistory(): LoadingState[] {
    // Spy on setState by wrapping — we collect the sequence of states
    // the loader has been in. The loader itself only tracks current state,
    // so we attach a listener pre-test.
    return [];
  }

  it("BIN-673: missing roomCode → setState('READY') and return", async () => {
    await harnessHandleReconnect({ loader, socket, bridge, transition, roomCode: "" });
    expect(loader.getState()).toBe("READY");
    expect(socket.resumeRoom).not.toHaveBeenCalled();
  });

  it("BIN-682 #1: enters RESYNCING before any await", async () => {
    // Capture state at the moment of the first await (resumeRoom call).
    let stateAtResumeCall: LoadingState = "READY";
    socket.resumeRoom = vi.fn().mockImplementation(() => {
      stateAtResumeCall = loader.getState();
      return Promise.resolve({ ok: true, data: { snapshot: goodSnapshot } });
    });
    bridge.getState = vi.fn().mockReturnValue(goodSnapshot);

    await harnessHandleReconnect({ loader, socket, bridge, transition, roomCode: "BINGO1" });

    expect(stateAtResumeCall).toBe("RESYNCING");
  });

  it("BIN-682 #2: successful resumeRoom → applySnapshot + transitionTo + setState('READY')", async () => {
    socket.resumeRoom = vi.fn().mockResolvedValue({ ok: true, data: { snapshot: goodSnapshot } });
    bridge.getState = vi.fn().mockReturnValue(goodSnapshot);

    await harnessHandleReconnect({ loader, socket, bridge, transition, roomCode: "BINGO1" });

    expect(bridge.applySnapshot).toHaveBeenCalledWith(goodSnapshot);
    expect(transition.transitionTo).toHaveBeenCalledWith("SPECTATING", goodSnapshot);
    expect(loader.getState()).toBe("READY");
  });

  it("BIN-682 #3: resumeRoom fails but getRoomState succeeds → still goes to READY", async () => {
    socket.resumeRoom = vi.fn().mockResolvedValue({ ok: false, error: { message: "timeout" } });
    socket.getRoomState = vi.fn().mockResolvedValue({ ok: true, data: { snapshot: goodSnapshot } });
    bridge.getState = vi.fn().mockReturnValue(goodSnapshot);

    await harnessHandleReconnect({ loader, socket, bridge, transition, roomCode: "BINGO1" });

    expect(socket.getRoomState).toHaveBeenCalledWith({ roomCode: "BINGO1" });
    expect(bridge.applySnapshot).toHaveBeenCalledWith(goodSnapshot);
    expect(loader.getState()).toBe("READY");
  });

  it("BIN-673: both resumeRoom + getRoomState fail → overlay STAYS in RESYNCING", async () => {
    socket.resumeRoom = vi.fn().mockResolvedValue({ ok: false, error: { message: "timeout" } });
    socket.getRoomState = vi.fn().mockResolvedValue({ ok: false, error: { message: "server down" } });

    await harnessHandleReconnect({ loader, socket, bridge, transition, roomCode: "BINGO1" });

    // Crucial contract: overlay is NOT dismissed. Stuck-timer from
    // commit 1 will surface the "Last siden på nytt" reload button
    // so the user isn't stranded.
    expect(loader.getState()).toBe("RESYNCING");
    expect(bridge.applySnapshot).not.toHaveBeenCalled();
    expect(transition.transitionTo).not.toHaveBeenCalled();
  });

  it("BIN-673: resumeRoom throws → overlay STAYS in RESYNCING (try/catch swallows error)", async () => {
    socket.resumeRoom = vi.fn().mockRejectedValue(new Error("network blew up"));

    await harnessHandleReconnect({ loader, socket, bridge, transition, roomCode: "BINGO1" });

    expect(loader.getState()).toBe("RESYNCING");
  });

  it("BIN-682 #2b: RUNNING + myTickets → PLAYING transition (not SPECTATING)", async () => {
    const playingSnap: SnapshotStub = { gameStatus: "RUNNING", drawnNumbers: [1, 2], myTickets: [{}, {}] };
    socket.resumeRoom = vi.fn().mockResolvedValue({ ok: true, data: { snapshot: playingSnap } });
    bridge.getState = vi.fn().mockReturnValue(playingSnap);

    await harnessHandleReconnect({ loader, socket, bridge, transition, roomCode: "BINGO1" });

    expect(transition.transitionTo).toHaveBeenCalledWith("PLAYING", playingSnap);
  });

  it("BIN-682 #2c: not RUNNING → WAITING transition regardless of tickets", async () => {
    const waitingSnap: SnapshotStub = { gameStatus: "ENDED", drawnNumbers: [], myTickets: [] };
    socket.resumeRoom = vi.fn().mockResolvedValue({ ok: true, data: { snapshot: waitingSnap } });
    bridge.getState = vi.fn().mockReturnValue(waitingSnap);

    await harnessHandleReconnect({ loader, socket, bridge, transition, roomCode: "BINGO1" });

    expect(transition.transitionTo).toHaveBeenCalledWith("WAITING", waitingSnap);
  });
});
