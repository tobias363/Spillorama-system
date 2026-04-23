/**
 * Agent-portal Next Game-panel + socket-wrapper.
 *
 * Dekker:
 *   - Panel-render: no-room, current-game-boks, actions-knapper
 *   - Actions: enable/disable per game-status
 *   - Ready/Not-ready popup vises hvis selfReady=false
 *   - Jackpot-confirm vises hvis jackpotArmed=true
 *   - AgentHallSocket: connect/disconnect/fallback-timer + event-filter
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";

// Stub getToken så socketen kan initialiseres uten auth-modul.
vi.mock("../src/api/client.js", () => {
  class ApiError extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    getToken: () => "tok-agent",
    setToken: () => {},
    clearToken: () => {},
    apiRequest: vi.fn(async () => ({})),
    ApiError,
  };
});

// ── AgentHallSocket ──────────────────────────────────────────────────────

type Listener = (payload: unknown) => void;

class FakeSocket {
  public connected = false;
  public readonly emitted: Array<{ event: string; payload: unknown }> = [];
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, cb: Listener): this {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
    return this;
  }

  emit(event: string, payload?: unknown): this {
    this.emitted.push({ event, payload });
    return this;
  }

  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }

  disconnect(): this {
    this.connected = false;
    this.trigger("disconnect", null);
    return this;
  }

  trigger(event: string, payload: unknown): void {
    const arr = this.listeners.get(event) ?? [];
    for (const cb of arr) cb(payload);
  }

  simulateConnect(): void {
    this.connected = true;
    this.trigger("connect", null);
  }

  simulateDisconnect(): void {
    this.connected = false;
    this.trigger("disconnect", null);
  }
}

describe("AgentHallSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leverer admin:hall-event for matchende roomCode", async () => {
    const { AgentHallSocket } = await import("../src/pages/agent-portal/agentHallSocket.js");
    const fake = new FakeSocket();
    const onHallEvent = vi.fn();
    const sock = new AgentHallSocket({
      disconnectGraceMs: 100,
      onHallEvent,
      _ioFactory: (() => fake as never) as never,
    });
    sock.subscribe("BINGO1");
    fake.simulateConnect();
    const evt = {
      kind: "paused",
      roomCode: "BINGO1",
      hallId: "hall-1",
      at: 1,
      actor: { id: "u1", displayName: "Vert" },
    };
    fake.trigger("admin:hall-event", evt);
    expect(onHallEvent).toHaveBeenCalledWith(evt);
  });

  it("filtrerer admin:hall-event for annen roomCode", async () => {
    const { AgentHallSocket } = await import("../src/pages/agent-portal/agentHallSocket.js");
    const fake = new FakeSocket();
    const onHallEvent = vi.fn();
    const sock = new AgentHallSocket({
      disconnectGraceMs: 100,
      onHallEvent,
      _ioFactory: (() => fake as never) as never,
    });
    sock.subscribe("BINGO1");
    fake.simulateConnect();
    fake.trigger("admin:hall-event", {
      kind: "paused",
      roomCode: "BINGO2",
      hallId: "hall-2",
      at: 1,
      actor: { id: "u1", displayName: "Vert" },
    });
    expect(onHallEvent).not.toHaveBeenCalled();
  });

  it("leverer room:update for matchende roomCode", async () => {
    const { AgentHallSocket } = await import("../src/pages/agent-portal/agentHallSocket.js");
    const fake = new FakeSocket();
    const onRoomUpdate = vi.fn();
    const sock = new AgentHallSocket({
      disconnectGraceMs: 100,
      onHallEvent: () => {},
      onRoomUpdate,
      _ioFactory: (() => fake as never) as never,
    });
    sock.subscribe("BINGO1");
    fake.simulateConnect();
    fake.trigger("room:update", { roomCode: "BINGO1", status: "RUNNING" });
    expect(onRoomUpdate).toHaveBeenCalledWith({ roomCode: "BINGO1", status: "RUNNING" });
  });

  it("fallback-timer: onFallbackActive(true) etter disconnectGraceMs uten reconnect", async () => {
    const { AgentHallSocket } = await import("../src/pages/agent-portal/agentHallSocket.js");
    const fake = new FakeSocket();
    const onFallbackActive = vi.fn();
    new AgentHallSocket({
      disconnectGraceMs: 100,
      onHallEvent: () => {},
      onFallbackActive,
      _ioFactory: (() => fake as never) as never,
    });
    fake.simulateConnect();
    fake.simulateDisconnect();
    vi.advanceTimersByTime(100);
    expect(onFallbackActive).toHaveBeenCalledWith(true);
  });

  it("reconnect avlyser fallback hvis før grace + rapporterer false", async () => {
    const { AgentHallSocket } = await import("../src/pages/agent-portal/agentHallSocket.js");
    const fake = new FakeSocket();
    const onFallbackActive = vi.fn();
    new AgentHallSocket({
      disconnectGraceMs: 100,
      onHallEvent: () => {},
      onFallbackActive,
      _ioFactory: (() => fake as never) as never,
    });
    fake.simulateConnect();
    fake.simulateDisconnect();
    vi.advanceTimersByTime(50);
    fake.simulateConnect();
    expect(onFallbackActive).not.toHaveBeenCalled();
  });

  it("dispose rydder socket + ignorerer videre events", async () => {
    const { AgentHallSocket } = await import("../src/pages/agent-portal/agentHallSocket.js");
    const fake = new FakeSocket();
    const onHallEvent = vi.fn();
    const sock = new AgentHallSocket({
      disconnectGraceMs: 100,
      onHallEvent,
      _ioFactory: (() => fake as never) as never,
    });
    sock.subscribe("BINGO1");
    fake.simulateConnect();
    sock.dispose();
    // Etter dispose: fake sine listeners skal være fjernet, så trigger gjør ingenting.
    fake.trigger("admin:hall-event", {
      kind: "paused",
      roomCode: "BINGO1",
      hallId: "hall-1",
      at: 1,
      actor: { id: "u1", displayName: "Vert" },
    });
    expect(onHallEvent).not.toHaveBeenCalled();
  });
});

// ── NextGamePanel rendering ───────────────────────────────────────────────

describe("NextGamePanel rendering", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = '<div id="c"></div>';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("picker aktivt rom via RUNNING > PAUSED > første", async () => {
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const rooms = [
      { code: "R1", hallId: "h-1", currentGame: { id: "g1", status: "ENDED" } },
      { code: "R2", hallId: "h-1", currentGame: { id: "g2", status: "PAUSED" } },
      { code: "R3", hallId: "h-1", currentGame: { id: "g3", status: "RUNNING" } },
    ];
    const picked = __test.pickActiveRoom(rooms as never);
    expect(picked?.code).toBe("R3");
  });

  it("picker PAUSED hvis ingen RUNNING", async () => {
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const rooms = [
      { code: "R1", hallId: "h-1", currentGame: { id: "g1", status: "ENDED" } },
      { code: "R2", hallId: "h-1", currentGame: { id: "g2", status: "PAUSED" } },
    ];
    const picked = __test.pickActiveRoom(rooms as never);
    expect(picked?.code).toBe("R2");
  });

  it("returnerer null for tom liste", async () => {
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    expect(__test.pickActiveRoom([] as never)).toBeNull();
  });

  it("render viser no-room-boks når ingen rom + ingen feil", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    __test.setState({
      rooms: [],
      activeRoom: null,
      lastFetchError: null,
      lastHallEvent: null,
      socketFallback: false,
      countdownEndsAt: null,
      countdownTick: 0,
      selfReady: false,
      jackpotArmed: false,
    });
    __test.render(container);
    expect(container.querySelector("[data-marker='agent-next-game-panel']")).toBeTruthy();
    expect(container.querySelector("[data-marker='agent-ng-no-room']")).toBeTruthy();
    expect(container.querySelector("[data-marker='agent-ng-current-game']")).toBeNull();
  });

  it("render viser error-banner når lastFetchError er satt", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    __test.setState({
      rooms: [],
      activeRoom: null,
      lastFetchError: "boom",
      lastHallEvent: null,
      socketFallback: false,
      countdownEndsAt: null,
      countdownTick: 0,
      selfReady: false,
      jackpotArmed: false,
    });
    __test.render(container);
    const banner = container.querySelector<HTMLElement>("[data-marker='agent-ng-error']");
    expect(banner?.textContent?.trim()).toContain("boom");
  });

  it("render viser socket-fallback-banner når socketFallback=true", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    __test.setState({
      rooms: [],
      activeRoom: null,
      lastFetchError: null,
      lastHallEvent: null,
      socketFallback: true,
      countdownEndsAt: null,
      countdownTick: 0,
      selfReady: false,
      jackpotArmed: false,
    });
    __test.render(container);
    expect(container.querySelector("[data-marker='agent-ng-socket-fallback']")).toBeTruthy();
  });

  it("render viser current-game + actions-knapper med IDLE-state (Start enabled)", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const room = {
      code: "BINGO1",
      hallId: "hall-1",
      hallName: "Test-hall",
      gameSlug: "bingo",
      status: "ACTIVE",
      currentGame: null,
    };
    __test.setState({
      rooms: [room],
      activeRoom: room,
      lastFetchError: null,
      lastHallEvent: null,
      socketFallback: false,
      countdownEndsAt: null,
      countdownTick: 0,
      selfReady: false,
      jackpotArmed: false,
    } as never);
    __test.render(container);
    expect(container.querySelector("[data-marker='agent-ng-current-game']")).toBeTruthy();
    const startBtn = container.querySelector<HTMLButtonElement>('[data-action="start-next"]');
    const pauseBtn = container.querySelector<HTMLButtonElement>('[data-action="pause"]');
    const resumeBtn = container.querySelector<HTMLButtonElement>('[data-action="resume"]');
    const forceEndBtn = container.querySelector<HTMLButtonElement>('[data-action="force-end"]');
    expect(startBtn?.disabled).toBe(false);
    expect(pauseBtn?.disabled).toBe(true);
    expect(resumeBtn?.disabled).toBe(true);
    expect(forceEndBtn?.disabled).toBe(true);
  });

  it("RUNNING-state: PAUSE + Force End enabled, Start + Resume disabled", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const room = {
      code: "BINGO1",
      hallId: "hall-1",
      gameSlug: "bingo",
      status: "ACTIVE",
      currentGame: { id: "g1", status: "RUNNING" },
    };
    __test.setState({
      rooms: [room],
      activeRoom: room,
      lastFetchError: null,
      lastHallEvent: null,
      socketFallback: false,
      countdownEndsAt: null,
      countdownTick: 0,
      selfReady: false,
      jackpotArmed: false,
    } as never);
    __test.render(container);
    const startBtn = container.querySelector<HTMLButtonElement>('[data-action="start-next"]');
    const pauseBtn = container.querySelector<HTMLButtonElement>('[data-action="pause"]');
    const resumeBtn = container.querySelector<HTMLButtonElement>('[data-action="resume"]');
    const forceEndBtn = container.querySelector<HTMLButtonElement>('[data-action="force-end"]');
    expect(startBtn?.disabled).toBe(true);
    expect(pauseBtn?.disabled).toBe(false);
    expect(resumeBtn?.disabled).toBe(true);
    expect(forceEndBtn?.disabled).toBe(false);
  });

  it("PAUSED-state: Resume + Force End enabled", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const room = {
      code: "BINGO1",
      hallId: "hall-1",
      gameSlug: "bingo",
      status: "ACTIVE",
      currentGame: { id: "g1", status: "PAUSED" },
    };
    __test.setState({
      rooms: [room],
      activeRoom: room,
      lastFetchError: null,
      lastHallEvent: null,
      socketFallback: false,
      countdownEndsAt: null,
      countdownTick: 0,
      selfReady: false,
      jackpotArmed: false,
    } as never);
    __test.render(container);
    const pauseBtn = container.querySelector<HTMLButtonElement>('[data-action="pause"]');
    const resumeBtn = container.querySelector<HTMLButtonElement>('[data-action="resume"]');
    const forceEndBtn = container.querySelector<HTMLButtonElement>('[data-action="force-end"]');
    expect(pauseBtn?.disabled).toBe(true);
    expect(resumeBtn?.disabled).toBe(false);
    expect(forceEndBtn?.disabled).toBe(false);
  });

  it("countdown-label vises når countdownEndsAt er i fremtiden", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const room = {
      code: "BINGO1",
      hallId: "hall-1",
      gameSlug: "bingo",
      status: "ACTIVE",
      currentGame: null,
    };
    __test.setState({
      rooms: [room],
      activeRoom: room,
      lastFetchError: null,
      lastHallEvent: null,
      socketFallback: false,
      countdownEndsAt: Date.now() + 115_000, // 1:55
      countdownTick: 0,
      selfReady: true,
      jackpotArmed: false,
    } as never);
    __test.render(container);
    const countdown = container.querySelector<HTMLElement>("[data-marker='agent-ng-countdown']");
    expect(countdown?.textContent).toMatch(/1:\d{2}/);
  });

  it("jackpot-indikator vises når jackpotArmed=true", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const room = {
      code: "BINGO1",
      hallId: "hall-1",
      gameSlug: "bingo",
      status: "ACTIVE",
      currentGame: null,
    };
    __test.setState({
      rooms: [room],
      activeRoom: room,
      lastFetchError: null,
      lastHallEvent: null,
      socketFallback: false,
      countdownEndsAt: null,
      countdownTick: 0,
      selfReady: true,
      jackpotArmed: true,
    } as never);
    __test.render(container);
    expect(container.querySelector("[data-marker='agent-ng-jackpot-armed']")).toBeTruthy();
  });

  it("ready-panel viser 'ikke klar' når selfReady=false", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const room = {
      code: "BINGO1",
      hallId: "hall-1",
      gameSlug: "bingo",
      status: "ACTIVE",
      currentGame: null,
    };
    __test.setState({
      rooms: [room],
      activeRoom: room,
      lastFetchError: null,
      lastHallEvent: null,
      socketFallback: false,
      countdownEndsAt: null,
      countdownTick: 0,
      selfReady: false,
      jackpotArmed: false,
    } as never);
    __test.render(container);
    expect(container.querySelector("[data-marker='agent-ng-self-ready-no']")).toBeTruthy();
    expect(container.querySelector("[data-marker='agent-ng-self-ready-yes']")).toBeNull();
  });

  it("ready-panel viser 'klar' når selfReady=true", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const room = {
      code: "BINGO1",
      hallId: "hall-1",
      gameSlug: "bingo",
      status: "ACTIVE",
      currentGame: null,
    };
    __test.setState({
      rooms: [room],
      activeRoom: room,
      lastFetchError: null,
      lastHallEvent: null,
      socketFallback: false,
      countdownEndsAt: null,
      countdownTick: 0,
      selfReady: true,
      jackpotArmed: false,
    } as never);
    __test.render(container);
    expect(container.querySelector("[data-marker='agent-ng-self-ready-yes']")).toBeTruthy();
  });

  it("last-hall-event vises når lastHallEvent er satt", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const room = {
      code: "BINGO1",
      hallId: "hall-1",
      gameSlug: "bingo",
      status: "ACTIVE",
      currentGame: null,
    };
    __test.setState({
      rooms: [room],
      activeRoom: room,
      lastFetchError: null,
      lastHallEvent: {
        kind: "paused",
        roomCode: "BINGO1",
        hallId: "hall-1",
        at: Date.now() - 30_000,
        message: "Kaffepause",
        actor: { id: "u1", displayName: "Anne" },
      },
      socketFallback: false,
      countdownEndsAt: null,
      countdownTick: 0,
      selfReady: true,
      jackpotArmed: false,
    } as never);
    __test.render(container);
    const el = container.querySelector<HTMLElement>("[data-marker='agent-ng-last-event']");
    expect(el?.textContent).toContain("paused");
    expect(el?.textContent).toContain("Kaffepause");
  });
});
