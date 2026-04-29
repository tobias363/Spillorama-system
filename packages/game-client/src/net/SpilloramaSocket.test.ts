/**
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
 */
import { describe, it, expect, beforeEach } from "vitest";
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
