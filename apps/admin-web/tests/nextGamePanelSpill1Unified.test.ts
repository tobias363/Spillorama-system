/**
 * Task 1.4 (2026-04-24): tester for agent-portal unified Spill 1-view.
 *
 * Dekker:
 *   - NextGamePanel rendrer Spill 1-statusblokken når state.spill1 er satt
 *   - Spill1AgentStatus rendrer hall-stripe + role-badge
 *   - Spill1AgentControls rendrer start/resume-knapper for master-agent
 *   - Slave-agent ser disabled/hidden kontroller + "kun master kan starte"-melding
 *   - Room-basert view (Spill 2/3) forblir uendret når spill1=null
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";

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

// AgentGame1Socket mock for isolasjon fra ekte socket.io-client.
vi.mock("../src/pages/agent-portal/agentGame1Socket.js", () => {
  return {
    AgentGame1Socket: class {
      constructor() {
        /* no-op */
      }
      subscribe() {
        /* no-op */
      }
      dispose() {
        /* no-op */
      }
      isFallbackActive() {
        return false;
      }
      isConnected() {
        return false;
      }
    },
  };
});

vi.mock("../src/pages/agent-portal/agentHallSocket.js", () => {
  return {
    AgentHallSocket: class {
      constructor() {
        /* no-op */
      }
      subscribe() {
        /* no-op */
      }
      dispose() {
        /* no-op */
      }
      isFallbackActive() {
        return false;
      }
      isConnected() {
        return false;
      }
    },
  };
});

import type { Spill1CurrentGameResponse } from "../src/api/agent-game1.js";

function spill1MasterFixture(): Spill1CurrentGameResponse {
  return {
    hallId: "hall-master",
    isMasterAgent: true,
    currentGame: {
      id: "g1",
      status: "purchase_open",
      masterHallId: "hall-master",
      groupHallId: "grp-1",
      participatingHallIds: ["hall-master", "hall-slave"],
      subGameName: "Jackpot",
      customGameName: null,
      scheduledStartTime: "2026-04-24T10:00:00Z",
      scheduledEndTime: "2026-04-24T11:00:00Z",
      actualStartTime: null,
      actualEndTime: null,
    },
    halls: [
      {
        hallId: "hall-master",
        hallName: "Master Hall",
        isReady: true,
        readyAt: "2026-04-24T09:55:00Z",
        digitalTicketsSold: 10,
        physicalTicketsSold: 5,
        excludedFromGame: false,
        excludedReason: null,
      },
      {
        hallId: "hall-slave",
        hallName: "Slave Hall",
        isReady: false,
        readyAt: null,
        digitalTicketsSold: 0,
        physicalTicketsSold: 0,
        excludedFromGame: false,
        excludedReason: null,
      },
    ],
    allReady: false,
  };
}

describe("NextGamePanel — Spill 1 unified-view", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = '<div id="c"></div>';
  });

  it("rendrer Spill 1-statusblokken når state.spill1 er satt", async () => {
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
      spill1: spill1MasterFixture(),
      spill1Error: null,
      spill1LastStatusEvent: null,
    } as never);
    __test.render(container);
    expect(container.querySelector("[data-marker='spill1-block']")).toBeTruthy();
    expect(
      container.querySelector("[data-marker='spill1-agent-status']")
    ).toBeTruthy();
    expect(
      container.querySelector("[data-marker='spill1-agent-controls']")
    ).toBeTruthy();
  });

  it("ingen Spill 1-block når state.spill1 = null (kun room-basert view)", async () => {
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
      spill1: null,
      spill1Error: null,
      spill1LastStatusEvent: null,
    } as never);
    __test.render(container);
    expect(container.querySelector("[data-marker='spill1-block']")).toBeNull();
    // Room-basert view fortsatt synlig via no-room placeholder.
    expect(container.querySelector("[data-marker='agent-ng-no-room']")).toBeTruthy();
  });

  it("ingen Spill 1-block når currentGame = null (ingen aktiv runde)", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const spill1 = spill1MasterFixture();
    spill1.currentGame = null;
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
      spill1,
      spill1Error: null,
      spill1LastStatusEvent: null,
    } as never);
    __test.render(container);
    expect(container.querySelector("[data-marker='spill1-block']")).toBeNull();
  });

  it("master-agent viser role-badge + start+resume-knapper", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const spill1 = spill1MasterFixture();
    spill1.allReady = true;
    spill1.currentGame!.status = "ready_to_start";
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
      spill1,
      spill1Error: null,
      spill1LastStatusEvent: null,
    } as never);
    __test.render(container);
    expect(container.querySelector("[data-marker='spill1-role-master']")).toBeTruthy();
    const startBtn = container.querySelector<HTMLButtonElement>('[data-action="spill1-start"]');
    expect(startBtn).toBeTruthy();
    expect(startBtn?.disabled).toBe(false);
    const resumeBtn = container.querySelector<HTMLButtonElement>('[data-action="spill1-resume"]');
    expect(resumeBtn?.disabled).toBe(true); // ikke paused
  });

  it("slave-agent viser 'kun master'-melding uten knapper", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const spill1 = spill1MasterFixture();
    spill1.isMasterAgent = false;
    spill1.hallId = "hall-slave";
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
      spill1,
      spill1Error: null,
      spill1LastStatusEvent: null,
    } as never);
    __test.render(container);
    expect(container.querySelector("[data-marker='spill1-role-slave']")).toBeTruthy();
    expect(container.querySelector("[data-marker='spill1-slave-notice']")).toBeTruthy();
    expect(
      container.querySelector<HTMLButtonElement>('[data-action="spill1-start"]')
    ).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('[data-action="spill1-resume"]')
    ).toBeNull();
  });

  it("status=purchase_open + allReady=true → Start enabled", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const spill1 = spill1MasterFixture();
    spill1.allReady = true;
    spill1.currentGame!.status = "purchase_open";
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
      spill1,
      spill1Error: null,
      spill1LastStatusEvent: null,
    } as never);
    __test.render(container);
    const startBtn = container.querySelector<HTMLButtonElement>('[data-action="spill1-start"]');
    expect(startBtn?.disabled).toBe(false);
  });

  it("status=purchase_open + allReady=false → Start disabled", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const spill1 = spill1MasterFixture();
    spill1.allReady = false;
    spill1.currentGame!.status = "purchase_open";
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
      spill1,
      spill1Error: null,
      spill1LastStatusEvent: null,
    } as never);
    __test.render(container);
    const startBtn = container.querySelector<HTMLButtonElement>('[data-action="spill1-start"]');
    expect(startBtn?.disabled).toBe(true);
  });

  it("status=paused → Resume enabled, Start disabled", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const spill1 = spill1MasterFixture();
    spill1.currentGame!.status = "paused";
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
      spill1,
      spill1Error: null,
      spill1LastStatusEvent: null,
    } as never);
    __test.render(container);
    const startBtn = container.querySelector<HTMLButtonElement>('[data-action="spill1-start"]');
    const resumeBtn = container.querySelector<HTMLButtonElement>('[data-action="spill1-resume"]');
    expect(startBtn?.disabled).toBe(true);
    expect(resumeBtn?.disabled).toBe(false);
  });

  it("hall-stripe viser dot per deltakende hall med data-ready/data-excluded", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const spill1 = spill1MasterFixture();
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
      spill1,
      spill1Error: null,
      spill1LastStatusEvent: null,
    } as never);
    __test.render(container);
    const stripe = container.querySelector("[data-marker='spill1-hall-stripe']");
    expect(stripe).toBeTruthy();
    const dots = stripe!.querySelectorAll(".spill1-hall-dot");
    expect(dots.length).toBe(2);
    const master = stripe!.querySelector('[data-hall-id="hall-master"].spill1-hall-dot');
    expect(master?.getAttribute("data-ready")).toBe("1");
    const slave = stripe!.querySelector('[data-hall-id="hall-slave"].spill1-hall-dot');
    expect(slave?.getAttribute("data-ready")).toBe("0");
  });

  it("allReady=true viser ALLE KLARE-badge; allReady=false viser VENTER", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const spill1 = spill1MasterFixture();
    spill1.allReady = true;
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
      spill1,
      spill1Error: null,
      spill1LastStatusEvent: null,
    } as never);
    __test.render(container);
    expect(container.querySelector("[data-marker='spill1-all-ready']")).toBeTruthy();
    expect(container.querySelector("[data-marker='spill1-some-waiting']")).toBeNull();
  });

  it("spill1Error rendres som warning-banner", async () => {
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
      spill1: spill1MasterFixture(),
      spill1Error: "network down",
      spill1LastStatusEvent: null,
    } as never);
    __test.render(container);
    const banner = container.querySelector<HTMLElement>("[data-marker='spill1-error-banner']");
    expect(banner?.textContent?.trim()).toContain("network down");
  });

  it("ekskluderte haller vises med data-excluded=1 og viser notice til master", async () => {
    const container = document.getElementById("c")!;
    const { __test } = await import("../src/pages/agent-portal/NextGamePanel.js");
    const spill1 = spill1MasterFixture();
    spill1.halls[1]!.excludedFromGame = true;
    spill1.halls[1]!.excludedReason = "Tekniske problemer";
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
      spill1,
      spill1Error: null,
      spill1LastStatusEvent: null,
    } as never);
    __test.render(container);
    const slaveDot = container.querySelector('[data-hall-id="hall-slave"].spill1-hall-dot');
    expect(slaveDot?.getAttribute("data-excluded")).toBe("1");
    const notice = container.querySelector("[data-marker='spill1-excluded-notice']");
    expect(notice).toBeTruthy();
  });
});
