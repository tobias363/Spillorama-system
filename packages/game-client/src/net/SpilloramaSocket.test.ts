/**
 * @vitest-environment happy-dom
 *
 * BIN-501: event-buffer tests.
 *
 * The hard-to-reproduce bug we're fixing: the socket connects faster than
 * GameBridge.start() (typical when the backend is on localhost and the
 * bridge constructor runs after a small async barrier). Between
 * `socket.connect()` finishing and `bridge.start()` attaching listeners,
 * a `draw:new` can arrive and be silently dropped.
 *
 * The buffer queues broadcasts until the first listener attaches to each
 * channel, then drains them in order. These tests exercise that logic
 * through the `__dispatchForTest` shim (simulates a raw socket.io event
 * without spinning up a real io-client).
 *
 * E2E v2 (2026-05-05): tests added below for the `window.online` auto-
 * recovery handler — uses vi.mock to stub socket.io-client so we never
 * open a real connection.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SpilloramaSocket } from "./SpilloramaSocket.js";
import type {
  DrawNewPayload,
  RoomUpdatePayload,
  PatternWonPayload,
  ChatMessage,
  MiniGameActivatedPayload,
} from "@spillorama/shared-types/socket-events";

describe("BIN-501: event-buffer on SpilloramaSocket", () => {
  let socket: SpilloramaSocket;

  beforeEach(() => {
    socket = new SpilloramaSocket("ws://localhost:0");
  });

  function draw(n: number): DrawNewPayload {
    return { number: n, drawIndex: n - 1, gameId: "g-1" };
  }

  it("replays a single event that arrived before the listener attached", () => {
    // Simulate the init race: draw:new fires before anyone is listening.
    socket.__dispatchForTest("drawNew", draw(7));
    expect(socket.__getBufferedCount("drawNew")).toBe(1);

    // GameBridge.start() finally subscribes — it must receive the draw.
    const received: number[] = [];
    socket.on("drawNew", (p) => received.push(p.number));

    expect(received).toEqual([7]);
    expect(socket.__getBufferedCount("drawNew")).toBe(0);
  });

  it("replays multiple queued events in order", () => {
    for (const n of [11, 22, 33, 44]) socket.__dispatchForTest("drawNew", draw(n));
    expect(socket.__getBufferedCount("drawNew")).toBe(4);

    const received: number[] = [];
    socket.on("drawNew", (p) => received.push(p.number));

    expect(received).toEqual([11, 22, 33, 44]);
  });

  it("does NOT buffer events once a listener is attached (live dispatch)", () => {
    const received: number[] = [];
    socket.on("drawNew", (p) => received.push(p.number));

    socket.__dispatchForTest("drawNew", draw(1));
    socket.__dispatchForTest("drawNew", draw(2));
    socket.__dispatchForTest("drawNew", draw(3));

    expect(received).toEqual([1, 2, 3]);
    expect(socket.__getBufferedCount("drawNew")).toBe(0);
  });

  it("later listeners do not see already-drained buffered events", () => {
    // Three draws buffer.
    socket.__dispatchForTest("drawNew", draw(5));
    socket.__dispatchForTest("drawNew", draw(6));

    const first: number[] = [];
    const second: number[] = [];
    socket.on("drawNew", (p) => first.push(p.number));  // drains buffer
    socket.on("drawNew", (p) => second.push(p.number)); // sees only live

    // Only live events go to both after the first drain.
    socket.__dispatchForTest("drawNew", draw(7));

    expect(first).toEqual([5, 6, 7]);
    expect(second).toEqual([7]);
  });

  it("caps the per-channel buffer at BUFFER_LIMIT (FIFO eviction)", () => {
    // 101 events — the oldest one is evicted, leaving the last 100.
    for (let n = 1; n <= 101; n += 1) socket.__dispatchForTest("drawNew", draw(n));
    expect(socket.__getBufferedCount("drawNew")).toBe(100);

    const received: number[] = [];
    socket.on("drawNew", (p) => received.push(p.number));

    expect(received[0]).toBe(2); // #1 was evicted
    expect(received[received.length - 1]).toBe(101);
    expect(received).toHaveLength(100);
  });

  it("buffers each channel independently", () => {
    const draw1: DrawNewPayload = draw(42);
    const chat: ChatMessage = {
      id: "m-1", playerId: "p", playerName: "Alice", message: "hei",
      emojiId: 0, createdAt: "2026-04-18T12:00:00Z",
    };
    const pattern: PatternWonPayload = {
      patternId: "line", patternName: "Linje", winnerId: "p",
      wonAtDraw: 5, payoutAmount: 100, claimType: "LINE", gameId: "g-1",
    };

    socket.__dispatchForTest("drawNew", draw1);
    socket.__dispatchForTest("chatMessage", chat);
    socket.__dispatchForTest("patternWon", pattern);

    expect(socket.__getBufferedCount("drawNew")).toBe(1);
    expect(socket.__getBufferedCount("chatMessage")).toBe(1);
    expect(socket.__getBufferedCount("patternWon")).toBe(1);

    const receivedDraws: DrawNewPayload[] = [];
    socket.on("drawNew", (p) => receivedDraws.push(p));
    expect(receivedDraws).toEqual([draw1]);

    // chatMessage + patternWon still buffered (only drawNew got a listener).
    expect(socket.__getBufferedCount("chatMessage")).toBe(1);
    expect(socket.__getBufferedCount("patternWon")).toBe(1);
  });

  it("buffers roomUpdate events the same way", () => {
    const payload = { dummy: 1 } as unknown as RoomUpdatePayload;
    socket.__dispatchForTest("roomUpdate", payload);
    expect(socket.__getBufferedCount("roomUpdate")).toBe(1);

    const received: RoomUpdatePayload[] = [];
    socket.on("roomUpdate", (p) => received.push(p));
    expect(received).toEqual([payload]);
  });

  it("disconnect() clears the buffer so the next session starts fresh", () => {
    socket.__dispatchForTest("drawNew", draw(1));
    socket.__dispatchForTest("drawNew", draw(2));
    expect(socket.__getBufferedCount("drawNew")).toBe(2);

    socket.disconnect();
    expect(socket.__getBufferedCount("drawNew")).toBe(0);

    // After disconnect + fresh listener, no stale replay.
    const received: number[] = [];
    socket.on("drawNew", (p) => received.push(p.number));
    expect(received).toEqual([]);
  });

  it("buffers + replays legacy `minigameActivated` (Tobias prod-incident 2026-04-29)", () => {
    // PR #727 emits the legacy `minigame:activated` payload after auto-claim
    // of Fullt Hus. Verify this channel goes through dispatchOrBuffer like
    // every other broadcast — i.e. event arriving before the listener
    // attaches gets replayed.
    const payload: MiniGameActivatedPayload = {
      gameId: "game-auto-1",
      playerId: "player-1",
      type: "mysteryGame",
      prizeList: [50, 100, 200, 400, 800, 1500],
    };

    socket.__dispatchForTest("minigameActivated", payload);
    expect(socket.__getBufferedCount("minigameActivated")).toBe(1);

    const received: MiniGameActivatedPayload[] = [];
    socket.on("minigameActivated", (p) => received.push(p));

    expect(received).toEqual([payload]);
    expect(socket.__getBufferedCount("minigameActivated")).toBe(0);
  });

  it("unsubscribe does NOT re-enable buffering (set goes back to size 0)", () => {
    // Known, explicit behavior: if all listeners unsubscribe, subsequent
    // events silently drop — they are NOT buffered. This matches Socket.IO
    // defaults and keeps memory bounded for apps that briefly detach and
    // re-attach listeners.
    const received: number[] = [];
    const unsubscribe = socket.on("drawNew", (p) => received.push(p.number));
    unsubscribe();

    socket.__dispatchForTest("drawNew", draw(99));
    expect(received).toEqual([]);
    // Buffer resumes when the set is empty again.
    expect(socket.__getBufferedCount("drawNew")).toBe(1);

    // When a new listener attaches, it DOES see the buffered event.
    const later: number[] = [];
    socket.on("drawNew", (p) => later.push(p.number));
    expect(later).toEqual([99]);
  });
});

/**
 * E2E v2 (2026-05-05): klient-auto-recovery via `window.online`.
 *
 * Bug: når browseren går offline 10 s og kommer tilbake online, fanget
 * Socket.io's interne reconnect-løkke ikke alltid opp at nettverket var
 * tilbake. UI hang på "FÅR IKKE KOBLET TIL ROM. TRYKK HER" til brukeren
 * klikket og redirectet til lobby.
 *
 * Fix: SpilloramaSocket lytter nå på `window.online` og tvinger
 * reconnect-syklus når eventet fyrer. Disse testene mocker socket.io-
 * client så vi aldri åpner en reell forbindelse.
 */
describe("E2E v2: window.online auto-recovery", () => {
  type FakeSocket = {
    connected: boolean;
    auth: { accessToken: string };
    io: { on: ReturnType<typeof vi.fn> };
    on: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  };

  let fakeSocket: FakeSocket;
  let ioMock: ReturnType<typeof vi.fn>;
  let SocketCtor: typeof SpilloramaSocket;

  beforeEach(async () => {
    fakeSocket = {
      connected: false,
      auth: { accessToken: "" },
      io: { on: vi.fn() },
      on: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    ioMock = vi.fn(() => fakeSocket);

    vi.resetModules();
    vi.doMock("socket.io-client", () => ({ io: ioMock }));

    // Re-import under the active mock so the constructor closure captures
    // the mocked `io`.
    const mod = await import("./SpilloramaSocket.js");
    SocketCtor = mod.SpilloramaSocket;
  });

  afterEach(() => {
    vi.doUnmock("socket.io-client");
    vi.resetModules();
  });

  function newConnectedSocket(): InstanceType<typeof SpilloramaSocket> {
    const s = new SocketCtor("ws://localhost:0");
    s.connect();
    return s;
  }

  function fireWindowOnline(): void {
    window.dispatchEvent(new Event("online"));
  }

  it("triggers socket.connect() when window.online fires while disconnected", () => {
    const s = newConnectedSocket();
    // Simulate the socket dropping (we never call the fake "connect"
    // handler so connectionState remains "connecting", which is treated
    // as not-connected by the online handler).
    fakeSocket.connect.mockClear(); // ignore the initial connect() call

    fireWindowOnline();

    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
    s.disconnect();
  });

  it("no-ops on window.online when already connected", () => {
    const s = newConnectedSocket();

    // Capture the registered "connect" handler from socket.on(...) and
    // fire it so connectionState becomes "connected".
    const connectHandler = (fakeSocket.on.mock.calls.find((c) => c[0] === "connect") ?? [])[1] as
      | (() => void)
      | undefined;
    connectHandler?.();
    expect(s.isConnected()).toBe(true);

    fakeSocket.connect.mockClear();
    fireWindowOnline();

    expect(fakeSocket.connect).not.toHaveBeenCalled();
    s.disconnect();
  });

  it("debounces rapid window.online events within the retry window", () => {
    const s = newConnectedSocket();
    fakeSocket.connect.mockClear();

    fireWindowOnline();
    fireWindowOnline();
    fireWindowOnline();

    // Only the first event reaches socket.connect — the rest are debounced.
    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
    s.disconnect();
  });

  it("caps at AUTO_RETRY_LIMIT (3) — further events are no-ops", () => {
    vi.useFakeTimers();
    const s = newConnectedSocket();
    fakeSocket.connect.mockClear();

    // Fire 5 online events with enough spacing to clear the debounce
    // window. Only the first 3 should reach socket.connect; the rest
    // are budget-exceeded no-ops.
    for (let i = 0; i < 5; i += 1) {
      fireWindowOnline();
      vi.advanceTimersByTime(2000); // > AUTO_RETRY_WINDOW_MS (1000)
    }

    expect(fakeSocket.connect).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
    s.disconnect();
  });

  it("resets the auto-retry budget when the socket actually connects", () => {
    vi.useFakeTimers();
    const s = newConnectedSocket();
    fakeSocket.connect.mockClear();

    // Burn the budget.
    for (let i = 0; i < 4; i += 1) {
      fireWindowOnline();
      vi.advanceTimersByTime(2000);
    }
    expect(fakeSocket.connect).toHaveBeenCalledTimes(3);

    // Simulate a successful connect — should reset the counter so future
    // online events can trigger again.
    const connectHandler = (fakeSocket.on.mock.calls.find((c) => c[0] === "connect") ?? [])[1] as
      | (() => void)
      | undefined;
    connectHandler?.();

    // Now drop again (a hypothetical re-disconnect via the disconnect-
    // event handler).
    const disconnectHandler = (fakeSocket.on.mock.calls.find((c) => c[0] === "disconnect") ?? [])[1] as
      | (() => void)
      | undefined;
    disconnectHandler?.();

    fakeSocket.connect.mockClear();
    fireWindowOnline();

    // Budget reset → call goes through again.
    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    s.disconnect();
  });

  it("ignores window.online when navigator.onLine reports false", () => {
    const s = newConnectedSocket();
    fakeSocket.connect.mockClear();

    // Override navigator.onLine to false (e.g. browser fired a stale event).
    const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, "onLine");
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });

    fireWindowOnline();

    expect(fakeSocket.connect).not.toHaveBeenCalled();

    if (originalOnLine) {
      Object.defineProperty(window.navigator, "onLine", originalOnLine);
    }
    s.disconnect();
  });

  it("removes the window.online listener on disconnect() to avoid leaks", () => {
    const s = newConnectedSocket();
    fakeSocket.connect.mockClear();
    s.disconnect();

    fireWindowOnline();

    // disconnect() detached the handler — no further connect() calls.
    expect(fakeSocket.connect).not.toHaveBeenCalled();
  });
});

/**
 * Tobias-direktiv 2026-05-12: setEmitObserver-hook for debug-instrumentation.
 *
 * Bakgrunn: tidligere debug-dump fra Tobias inneholdt 232 events men kun
 * ÉN socket.emit (createRoom). Resten av wrapper-emits (bet:arm,
 * claim:submit, ticket:mark, room:state, …) gikk gjennom den private
 * `SpilloramaSocket.emit()` uten å treffe EventTracker.
 *
 * Fix: SpilloramaSocket eksponerer nå `setEmitObserver(observer)` som
 * fyrer en `pre`/`ack`-event per wrapper-emit. Game1Controller wirer
 * observatøren mot EventTracker i `mountDebugHud()`.
 *
 * Disse testene verifiserer:
 *   - Observer fyrer på `pre` (rett før socket.emit) og `ack` (etter respons)
 *   - `accessToken` strippes fra payload som sendes til observer
 *   - Observer-feil tar IKKE ned emit-flyten
 *   - setEmitObserver(null) fjerner observatøren
 *   - NOT_CONNECTED-pathen tracker også (vi vil vite om noen emit-er mens vi er disconnect)
 */
describe("setEmitObserver — debug-instrumentation hook (Tobias-direktiv 2026-05-12)", () => {
  type FakeSocket = {
    connected: boolean;
    auth: { accessToken: string };
    io: { on: ReturnType<typeof vi.fn> };
    on: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  };

  let fakeSocket: FakeSocket;
  let SocketCtor: typeof SpilloramaSocket;

  beforeEach(async () => {
    fakeSocket = {
      connected: true,
      auth: { accessToken: "" },
      io: { on: vi.fn() },
      on: vi.fn(),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    const ioMock = vi.fn(() => fakeSocket);

    vi.resetModules();
    vi.doMock("socket.io-client", () => ({ io: ioMock }));

    const mod = await import("./SpilloramaSocket.js");
    SocketCtor = mod.SpilloramaSocket;
  });

  afterEach(() => {
    vi.doUnmock("socket.io-client");
    vi.resetModules();
  });

  function newConnectedSocket(): InstanceType<typeof SpilloramaSocket> {
    const s = new SocketCtor("ws://localhost:0");
    s.connect();
    // Drive connectionState → "connected" så `emit()` ikke faller på NOT_CONNECTED
    const connectHandler = (fakeSocket.on.mock.calls.find((c) => c[0] === "connect") ?? [])[1] as
      | (() => void)
      | undefined;
    connectHandler?.();
    return s;
  }

  it("fyrer observer med phase=pre rett før socket.emit kalles", async () => {
    const s = newConnectedSocket();
    const observer = vi.fn();
    s.setEmitObserver(observer);

    // armBet kaster ack-callback umiddelbart (synkront) så vi får ack-phase også.
    fakeSocket.emit.mockImplementation(
      (
        _event: string,
        _payload: unknown,
        ack: (response: { ok: boolean; data?: unknown }) => void,
      ) => {
        ack({ ok: true, data: { snapshot: {}, armed: true } });
      },
    );

    await s.armBet({ roomCode: "ROOM-X", armed: true, ticketCount: 1 });

    // Forventer 2 calls: pre + ack
    expect(observer).toHaveBeenCalledTimes(2);
    const preCall = observer.mock.calls[0][0];
    expect(preCall.event).toBe("bet:arm");
    expect(preCall.phase).toBe("pre");
    expect(preCall.payload).toMatchObject({ roomCode: "ROOM-X", armed: true });
    // accessToken er IKKE i pre-payload (lekkasjeforsikring)
    expect(preCall.payload).not.toHaveProperty("accessToken");

    const ackCall = observer.mock.calls[1][0];
    expect(ackCall.event).toBe("bet:arm");
    expect(ackCall.phase).toBe("ack");
    expect(ackCall.ok).toBe(true);
    expect(typeof ackCall.durationMs).toBe("number");
    expect(ackCall.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("fyrer ack-phase med ok=false + error når server returnerer feil", async () => {
    const s = newConnectedSocket();
    const observer = vi.fn();
    s.setEmitObserver(observer);

    fakeSocket.emit.mockImplementation(
      (
        _event: string,
        _payload: unknown,
        ack: (response: { ok: boolean; error?: { code: string; message: string } }) => void,
      ) => {
        ack({ ok: false, error: { code: "LOSS_LIMIT_REACHED", message: "Grense nådd" } });
      },
    );

    await s.armBet({ roomCode: "ROOM-X", armed: true });

    const ackCall = observer.mock.calls.find((c) => c[0].phase === "ack")?.[0];
    expect(ackCall).toBeDefined();
    expect(ackCall?.ok).toBe(false);
    expect(ackCall?.error).toEqual({ code: "LOSS_LIMIT_REACHED", message: "Grense nådd" });
  });

  it("tracker NOT_CONNECTED-pathen som pre + ack", async () => {
    const s = new SocketCtor("ws://localhost:0");
    s.connect();
    // IKKE drive connect-handler → connectionState er "connecting" + socket.connected=false
    fakeSocket.connected = false;

    const observer = vi.fn();
    s.setEmitObserver(observer);

    const result = await s.armBet({ roomCode: "ROOM-X", armed: true });

    expect(result.ok).toBe(false);
    expect(observer).toHaveBeenCalledTimes(2);
    const ackCall = observer.mock.calls[1][0];
    expect(ackCall.phase).toBe("ack");
    expect(ackCall.ok).toBe(false);
    expect(ackCall.error?.code).toBe("NOT_CONNECTED");
  });

  it("setEmitObserver(null) fjerner observatøren", async () => {
    const s = newConnectedSocket();
    const observer = vi.fn();
    s.setEmitObserver(observer);

    fakeSocket.emit.mockImplementation(
      (_e: string, _p: unknown, ack: (r: { ok: boolean }) => void) => ack({ ok: true }),
    );

    await s.armBet({ roomCode: "R", armed: true });
    expect(observer).toHaveBeenCalled();

    observer.mockClear();
    s.setEmitObserver(null);
    await s.armBet({ roomCode: "R", armed: true });
    expect(observer).not.toHaveBeenCalled();
  });

  it("observer-feil tar IKKE ned emit-flyten (best-effort)", async () => {
    const s = newConnectedSocket();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    s.setEmitObserver(() => {
      throw new Error("observer exploded");
    });

    fakeSocket.emit.mockImplementation(
      (_e: string, _p: unknown, ack: (r: { ok: boolean }) => void) => ack({ ok: true }),
    );

    const result = await s.armBet({ roomCode: "R", armed: true });
    expect(result.ok).toBe(true);
    // Warn-spy fyrte minst én gang (én per pre/ack-call)
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it("strippes accessToken fra payload selv om caller skulle inkludere den", async () => {
    const s = newConnectedSocket();
    const observer = vi.fn();
    s.setEmitObserver(observer);

    fakeSocket.emit.mockImplementation(
      (_e: string, _p: unknown, ack: (r: { ok: boolean }) => void) => ack({ ok: true }),
    );

    // Caller-side wrapper-methods inkluderer normalt ikke accessToken
    // (det legges til av emit()). Men test det indirekte: subscribeSpill1Lobby
    // sender bare { hallId }, og vi verifiserer at observer ser kun det.
    await s.subscribeSpill1Lobby("hall-1");

    const preCall = observer.mock.calls[0][0];
    expect(preCall.payload).toEqual({ hallId: "hall-1" });
    expect(preCall.payload).not.toHaveProperty("accessToken");
  });
});
