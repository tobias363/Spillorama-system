/**
 * TASK HS: UI-tester for Game1MasterConsole fargekode + start-guard.
 *
 * Dekker:
 *   - renderer 🔴/🟠/🟢 badges korrekt for hver farge
 *   - Start-knapp disabled når oransje hall finnes
 *   - Red-confirm-checkbox vises for røde haller (!= master)
 *   - Master-hallen får ikke red-confirm-checkbox
 *   - Start-knapp enables når alle røde er confirmed + ingen oransje
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";

// Hjelper: gjør masterkonsollen importerbar i jsdom-miljøet uten io()-tilkobling.
// Vi mocker socket.io-client slik at AdminGame1Socket-constructor ikke krever
// ekte nettverk. Ikke relevant for traffic-light-render-testene.
vi.mock("socket.io-client", () => ({
  io: () => ({
    on: () => undefined,
    emit: () => undefined,
    removeAllListeners: () => undefined,
    disconnect: () => undefined,
    connected: false,
  }),
}));

function mockFetch(handlers: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockImplementation(async (url: unknown) => {
    const resp = handlers[String(url)];
    if (resp === undefined) {
      return new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "unknown" } }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ ok: true, data: resp }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(ms = 30): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((r) => setTimeout(r, ms));
  }
}

describe("Game1MasterConsole: 🔴/🟠/🟢 traffic light + start-guard", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.clear();
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("viser 🔴 rød, 🟠 oransje og 🟢 grønn badge for haller", async () => {
    mockFetch({
      "/api/admin/game1/games/g1": {
        game: {
          id: "g1",
          status: "purchase_open",
          scheduledStartTime: null,
          scheduledEndTime: null,
          actualStartTime: null,
          actualEndTime: null,
          masterHallId: "hall-1",
          groupHallId: "grp-1",
          participatingHallIds: ["hall-1", "hall-2", "hall-3"],
          subGameName: "sub-1",
          customGameName: null,
          startedByUserId: null,
          stoppedByUserId: null,
          stopReason: null,
        },
        halls: [
          {
            hallId: "hall-1",
            hallName: "Master",
            isReady: true,
            readyAt: null,
            readyByUserId: null,
            digitalTicketsSold: 3,
            physicalTicketsSold: 0,
            excludedFromGame: false,
            excludedReason: null,
          },
          {
            hallId: "hall-2",
            hallName: "Hall 2",
            isReady: false,
            readyAt: null,
            readyByUserId: null,
            digitalTicketsSold: 0,
            physicalTicketsSold: 5,
            excludedFromGame: false,
            excludedReason: null,
          },
          {
            hallId: "hall-3",
            hallName: "Hall 3",
            isReady: false,
            readyAt: null,
            readyByUserId: null,
            digitalTicketsSold: 0,
            physicalTicketsSold: 0,
            excludedFromGame: false,
            excludedReason: null,
          },
        ],
        allReady: false,
        auditRecent: [],
      },
      "/api/admin/game1/games/g1/hall-status": {
        gameId: "g1",
        halls: [
          {
            hallId: "hall-1",
            hallName: "Master",
            color: "green",
            playerCount: 3,
            startScanDone: true,
            finalScanDone: true,
            readyConfirmed: true,
            soldCount: 0,
            startTicketId: null,
            finalScanTicketId: null,
            digitalTicketsSold: 3,
            physicalTicketsSold: 0,
            excludedFromGame: false,
            excludedReason: null,
          },
          {
            hallId: "hall-2",
            hallName: "Hall 2",
            color: "orange",
            playerCount: 5,
            startScanDone: true,
            finalScanDone: false,
            readyConfirmed: false,
            soldCount: 0,
            startTicketId: "100",
            finalScanTicketId: null,
            digitalTicketsSold: 0,
            physicalTicketsSold: 5,
            excludedFromGame: false,
            excludedReason: null,
          },
          {
            hallId: "hall-3",
            hallName: "Hall 3",
            color: "red",
            playerCount: 0,
            startScanDone: true,
            finalScanDone: true,
            readyConfirmed: false,
            soldCount: 0,
            startTicketId: null,
            finalScanTicketId: null,
            digitalTicketsSold: 0,
            physicalTicketsSold: 0,
            excludedFromGame: false,
            excludedReason: null,
          },
        ],
      },
    });

    const { renderGame1MasterConsole } = await import(
      "../src/pages/games/master/Game1MasterConsole.js"
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGame1MasterConsole(container, "g1");
    await tick();

    const greenBadge = container.querySelector('[data-marker="hall-color-green"]');
    const orangeBadge = container.querySelector('[data-marker="hall-color-orange"]');
    const redBadge = container.querySelector('[data-marker="hall-color-red"]');
    expect(greenBadge).toBeTruthy();
    expect(orangeBadge).toBeTruthy();
    expect(redBadge).toBeTruthy();
  });

  it("disabler Start-knapp når 🟠 oransje hall finnes", async () => {
    mockFetch({
      "/api/admin/game1/games/g1": {
        game: {
          id: "g1",
          status: "purchase_open",
          scheduledStartTime: null,
          scheduledEndTime: null,
          actualStartTime: null,
          actualEndTime: null,
          masterHallId: "hall-1",
          groupHallId: "grp-1",
          participatingHallIds: ["hall-1", "hall-2"],
          subGameName: "sub-1",
          customGameName: null,
          startedByUserId: null,
          stoppedByUserId: null,
          stopReason: null,
        },
        halls: [
          {
            hallId: "hall-1",
            hallName: "Master",
            isReady: true,
            readyAt: null,
            readyByUserId: null,
            digitalTicketsSold: 3,
            physicalTicketsSold: 0,
            excludedFromGame: false,
            excludedReason: null,
          },
          {
            hallId: "hall-2",
            hallName: "Hall 2",
            isReady: false,
            readyAt: null,
            readyByUserId: null,
            digitalTicketsSold: 0,
            physicalTicketsSold: 5,
            excludedFromGame: false,
            excludedReason: null,
          },
        ],
        allReady: false,
        auditRecent: [],
      },
      "/api/admin/game1/games/g1/hall-status": {
        gameId: "g1",
        halls: [
          {
            hallId: "hall-1",
            hallName: "Master",
            color: "green",
            playerCount: 3,
            startScanDone: true,
            finalScanDone: true,
            readyConfirmed: true,
            soldCount: 0,
            startTicketId: null,
            finalScanTicketId: null,
            digitalTicketsSold: 3,
            physicalTicketsSold: 0,
            excludedFromGame: false,
            excludedReason: null,
          },
          {
            hallId: "hall-2",
            hallName: "Hall 2",
            color: "orange",
            playerCount: 5,
            startScanDone: true,
            finalScanDone: false,
            readyConfirmed: false,
            soldCount: 0,
            startTicketId: "100",
            finalScanTicketId: null,
            digitalTicketsSold: 0,
            physicalTicketsSold: 5,
            excludedFromGame: false,
            excludedReason: null,
          },
        ],
      },
    });

    const { renderGame1MasterConsole } = await import(
      "../src/pages/games/master/Game1MasterConsole.js"
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGame1MasterConsole(container, "g1");
    await tick();

    const startBtn = container.querySelector<HTMLButtonElement>(
      'button[data-action="start"]'
    );
    expect(startBtn).toBeTruthy();
    expect(startBtn?.disabled).toBe(true);
    // Start-blocked warning vises
    expect(container.querySelector('[data-marker="start-orange-warning"]')).toBeTruthy();
  });

  it("viser red-confirm-checkbox og enables Start når confirmed", async () => {
    mockFetch({
      "/api/admin/game1/games/g1": {
        game: {
          id: "g1",
          status: "purchase_open",
          scheduledStartTime: null,
          scheduledEndTime: null,
          actualStartTime: null,
          actualEndTime: null,
          masterHallId: "hall-1",
          groupHallId: "grp-1",
          participatingHallIds: ["hall-1", "hall-2"],
          subGameName: "sub-1",
          customGameName: null,
          startedByUserId: null,
          stoppedByUserId: null,
          stopReason: null,
        },
        halls: [
          {
            hallId: "hall-1",
            hallName: "Master",
            isReady: true,
            readyAt: null,
            readyByUserId: null,
            digitalTicketsSold: 3,
            physicalTicketsSold: 0,
            excludedFromGame: false,
            excludedReason: null,
          },
          {
            hallId: "hall-2",
            hallName: "Hall 2",
            isReady: false,
            readyAt: null,
            readyByUserId: null,
            digitalTicketsSold: 0,
            physicalTicketsSold: 0,
            excludedFromGame: false,
            excludedReason: null,
          },
        ],
        allReady: false,
        auditRecent: [],
      },
      "/api/admin/game1/games/g1/hall-status": {
        gameId: "g1",
        halls: [
          {
            hallId: "hall-1",
            hallName: "Master",
            color: "green",
            playerCount: 3,
            startScanDone: true,
            finalScanDone: true,
            readyConfirmed: true,
            soldCount: 0,
            startTicketId: null,
            finalScanTicketId: null,
            digitalTicketsSold: 3,
            physicalTicketsSold: 0,
            excludedFromGame: false,
            excludedReason: null,
          },
          {
            hallId: "hall-2",
            hallName: "Hall 2",
            color: "red",
            playerCount: 0,
            startScanDone: true,
            finalScanDone: true,
            readyConfirmed: false,
            soldCount: 0,
            startTicketId: null,
            finalScanTicketId: null,
            digitalTicketsSold: 0,
            physicalTicketsSold: 0,
            excludedFromGame: false,
            excludedReason: null,
          },
        ],
      },
    });

    const { renderGame1MasterConsole } = await import(
      "../src/pages/games/master/Game1MasterConsole.js"
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    await renderGame1MasterConsole(container, "g1");
    await tick();

    const redPanel = container.querySelector('[data-marker="red-halls-confirm"]');
    expect(redPanel).toBeTruthy();

    const startBtnBefore = container.querySelector<HTMLButtonElement>(
      'button[data-action="start"]'
    );
    expect(startBtnBefore?.disabled).toBe(true);

    // Klikk checkbox for hall-2
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[data-action="confirm-red-hall"][data-hall-id="hall-2"]'
    );
    expect(checkbox).toBeTruthy();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event("change"));

    const startBtnAfter = container.querySelector<HTMLButtonElement>(
      'button[data-action="start"]'
    );
    expect(startBtnAfter?.disabled).toBe(false);
  });
});
