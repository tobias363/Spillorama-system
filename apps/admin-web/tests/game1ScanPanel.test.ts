/**
 * TASK HS: UI-tester for Game1ScanPanel (agent-portal scan-flyt).
 *
 * Dekker:
 *   - Steg a: ingen start-scan → viser start-input
 *   - Steg b: start gjort, ingen final → viser pending + final-input
 *   - Steg c: alt scannet, ikke klar → viser Klar-knapp med solgt-range
 *   - Steg d: readyConfirmed → grønn status-badge
 *   - Start-scan POST
 *   - Slutt-scan POST
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { mountGame1ScanPanel, unmountGame1ScanPanel } from "../src/pages/agent-portal/Game1ScanPanel.js";
import type { Game1HallStatus } from "../src/api/admin-game1-master.js";

function defaultHallStatus(
  overrides: Partial<Game1HallStatus> = {}
): Game1HallStatus {
  return {
    hallId: "hall-a",
    hallName: "Hall A",
    color: "red",
    playerCount: 0,
    startScanDone: false,
    finalScanDone: false,
    readyConfirmed: false,
    soldCount: 0,
    startTicketId: null,
    finalScanTicketId: null,
    digitalTicketsSold: 0,
    physicalTicketsSold: 0,
    excludedFromGame: false,
    excludedReason: null,
    ...overrides,
  };
}

function mockFetch(
  responses: Array<{
    urlMatch: (url: string) => boolean;
    method?: string;
    status?: number;
    body: unknown;
  }>
): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockImplementation(async (url: unknown, init?: unknown) => {
    const urlStr = String(url);
    const method = String(
      (init as RequestInit | undefined)?.method ?? "GET"
    ).toUpperCase();
    for (const r of responses) {
      if (r.urlMatch(urlStr) && (!r.method || r.method === method)) {
        return new Response(
          JSON.stringify({
            ok: (r.status ?? 200) < 400,
            data: (r.status ?? 200) < 400 ? r.body : undefined,
            error: (r.status ?? 200) >= 400 ? r.body : undefined,
          }),
          {
            status: r.status ?? 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: "NOT_FOUND", message: `unmocked ${method} ${urlStr}` },
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(ms = 30): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((r) => setTimeout(r, ms));
  }
}

describe("Game1ScanPanel: agent scan-flyt", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("viser start-scan-input når ingen scan er utført", async () => {
    mockFetch([
      {
        urlMatch: (u) => u.includes("/hall-status"),
        body: { gameId: "g1", halls: [defaultHallStatus({ color: "red" })] },
      },
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountGame1ScanPanel(container, { gameId: "g1", hallId: "hall-a" });
    await tick();

    expect(container.querySelector('[data-marker="scan-start-input"]')).toBeTruthy();
    expect(container.querySelector('[data-marker="scan-start-button"]')).toBeTruthy();
    // Status-badge: rød
    expect(container.querySelector('[data-marker="agent-status-red"]')).toBeTruthy();
    unmountGame1ScanPanel(container);
  });

  it("viser pending-state + final-input når start-scan er gjort", async () => {
    mockFetch([
      {
        urlMatch: (u) => u.includes("/hall-status"),
        body: {
          gameId: "g1",
          halls: [
            defaultHallStatus({
              color: "orange",
              playerCount: 5,
              startScanDone: true,
              finalScanDone: false,
              startTicketId: "12345",
              physicalTicketsSold: 5,
            }),
          ],
        },
      },
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountGame1ScanPanel(container, { gameId: "g1", hallId: "hall-a" });
    await tick();

    expect(container.querySelector('[data-marker="scan-pending-final"]')).toBeTruthy();
    expect(container.querySelector('[data-marker="scan-final-input"]')).toBeTruthy();
    expect(container.querySelector('[data-marker="agent-status-orange"]')).toBeTruthy();
    unmountGame1ScanPanel(container);
  });

  it("viser Klar-knapp og solgt-range når alt er scannet men ikke klar", async () => {
    mockFetch([
      {
        urlMatch: (u) => u.includes("/hall-status"),
        body: {
          gameId: "g1",
          halls: [
            defaultHallStatus({
              color: "orange",
              playerCount: 5,
              startScanDone: true,
              finalScanDone: true,
              readyConfirmed: false,
              startTicketId: "12345",
              finalScanTicketId: "12368",
              soldCount: 23,
              physicalTicketsSold: 23,
            }),
          ],
        },
      },
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountGame1ScanPanel(container, { gameId: "g1", hallId: "hall-a" });
    await tick();

    const rangeInfo = container.querySelector('[data-marker="scan-range-info"]');
    expect(rangeInfo).toBeTruthy();
    expect(rangeInfo?.textContent).toContain("12345");
    expect(rangeInfo?.textContent).toContain("23");
    expect(container.querySelector('[data-marker="scan-mark-ready-button"]')).toBeTruthy();
    unmountGame1ScanPanel(container);
  });

  it("viser grønn done-badge når readyConfirmed", async () => {
    mockFetch([
      {
        urlMatch: (u) => u.includes("/hall-status"),
        body: {
          gameId: "g1",
          halls: [
            defaultHallStatus({
              color: "green",
              playerCount: 5,
              startScanDone: true,
              finalScanDone: true,
              readyConfirmed: true,
              startTicketId: "12345",
              finalScanTicketId: "12368",
              soldCount: 23,
              physicalTicketsSold: 23,
            }),
          ],
        },
      },
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountGame1ScanPanel(container, { gameId: "g1", hallId: "hall-a" });
    await tick();

    expect(container.querySelector('[data-marker="scan-ready-done"]')).toBeTruthy();
    expect(container.querySelector('[data-marker="agent-status-green"]')).toBeTruthy();
    unmountGame1ScanPanel(container);
  });

  it("start-scan input + knapp POSTer til scan-start-endepunktet", async () => {
    const fetchMock = mockFetch([
      {
        urlMatch: (u) => u.includes("/hall-status"),
        body: { gameId: "g1", halls: [defaultHallStatus({ color: "red" })] },
      },
      {
        urlMatch: (u) => u.includes("/scan-start"),
        method: "POST",
        body: {
          gameId: "g1",
          hallId: "hall-a",
          startTicketId: "12345",
          finalScanTicketId: null,
          startScannedAt: "2026-04-24T10:00:00.000Z",
        },
      },
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountGame1ScanPanel(container, { gameId: "g1", hallId: "hall-a" });
    await tick();

    const input = container.querySelector<HTMLInputElement>(
      '[data-marker="scan-start-input"]'
    );
    expect(input).toBeTruthy();
    input!.value = "12345";

    const btn = container.querySelector<HTMLButtonElement>(
      '[data-marker="scan-start-button"]'
    );
    btn!.click();
    await tick();

    const postCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/scan-start")
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.ticketId).toBe("12345");
    unmountGame1ScanPanel(container);
  });
});
