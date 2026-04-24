/**
 * Task 1.1: admin-web master-console UI-tester for auto-pause-flyt.
 *
 * Gap #1 i docs/architecture/MASTER_HALL_DASHBOARD_GAP_2026-04-24.md.
 *
 * Dekker:
 *   1. Engine-state `isPaused=true + pausedAtPhase=1` → paused-banner
 *      rendres + Resume-knapp aktivert.
 *   2. Engine-state uten pause → ingen banner, Resume-knapp disabled.
 *   3. Manuell pause (game.status='paused') → banner + Resume-knapp.
 *   4. Klikk på Resume → POST /api/admin/game1/games/:gameId/resume.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../../../src/i18n/I18n.js";
import { renderGame1MasterConsole } from "../../../src/pages/games/master/Game1MasterConsole.js";

// Socket-klienten skal ikke prøve å koble til i testene.
vi.mock("../../../src/pages/games/master/adminGame1Socket.js", () => {
  return {
    AdminGame1Socket: class {
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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successResponse<T>(data: T, status = 200): Response {
  return jsonResponse({ ok: status < 400, data }, status);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

type FetchMock = ReturnType<typeof vi.fn>;
function installFetch(
  impl: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>
): FetchMock {
  const fn = vi
    .fn()
    .mockImplementation(async (input: string | URL | Request, init?: RequestInit) =>
      impl(input, init)
    );
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

function baseDetail(
  overrides: {
    status?: string;
    engineState?: {
      isPaused: boolean;
      pausedAtPhase: number | null;
      currentPhase: number;
      drawsCompleted: number;
      isFinished: boolean;
    } | null;
  } = {}
): Record<string, unknown> {
  return {
    game: {
      id: "g1",
      status: overrides.status ?? "running",
      scheduledStartTime: "2026-04-24T10:00:00Z",
      scheduledEndTime: null,
      actualStartTime: "2026-04-24T10:00:05Z",
      actualEndTime: null,
      masterHallId: "hall-1",
      groupHallId: "grp-north",
      participatingHallIds: ["hall-1", "hall-2"],
      subGameName: "Spill 1",
      customGameName: null,
      startedByUserId: "admin-1",
      stoppedByUserId: null,
      stopReason: null,
    },
    halls: [
      {
        hallId: "hall-1",
        hallName: "Hall Oslo",
        isReady: true,
        readyAt: null,
        readyByUserId: null,
        digitalTicketsSold: 10,
        physicalTicketsSold: 2,
        excludedFromGame: false,
        excludedReason: null,
      },
    ],
    allReady: true,
    auditRecent: [],
    engineState:
      overrides.engineState === undefined
        ? {
            isPaused: false,
            pausedAtPhase: null,
            currentPhase: 1,
            drawsCompleted: 5,
            isFinished: false,
          }
        : overrides.engineState,
  };
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.localStorage.setItem("bingo_admin_access_token", "tok");
});

// ── Tester ─────────────────────────────────────────────────────────────────

describe("Task 1.1: Game1MasterConsole auto-pause UI", () => {
  it("auto-pause (engineState.isPaused=true + pausedAtPhase=1) → banner rendres", async () => {
    installFetch(() =>
      successResponse(
        baseDetail({
          status: "running", // auto-pause = running + paused=true
          engineState: {
            isPaused: true,
            pausedAtPhase: 1,
            currentPhase: 2,
            drawsCompleted: 5,
            isFinished: false,
          },
        })
      )
    );
    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderGame1MasterConsole(c, "g1");
    await flush();

    const banner = c.querySelector<HTMLElement>("#g1-master-auto-pause-banner");
    expect(banner).not.toBeNull();
    expect(banner!.style.display).not.toBe("none");
    const text = c.querySelector<HTMLElement>(
      '[data-testid="g1-master-pause-banner-text"]'
    );
    expect(text).not.toBeNull();
    // Banner skal referere fase 1
    expect(text!.textContent).toContain("1");
  });

  it("auto-pause-state → Resume-knapp aktivert, Pause-knapp disabled", async () => {
    installFetch(() =>
      successResponse(
        baseDetail({
          status: "running",
          engineState: {
            isPaused: true,
            pausedAtPhase: 1,
            currentPhase: 2,
            drawsCompleted: 5,
            isFinished: false,
          },
        })
      )
    );
    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderGame1MasterConsole(c, "g1");
    await flush();

    const resumeBtn = c.querySelector<HTMLButtonElement>(
      '#g1-master-actions button[data-action="resume"]'
    );
    expect(resumeBtn).not.toBeNull();
    expect(resumeBtn!.disabled).toBe(false);

    const pauseBtn = c.querySelector<HTMLButtonElement>(
      '#g1-master-actions button[data-action="pause"]'
    );
    expect(pauseBtn).not.toBeNull();
    expect(pauseBtn!.disabled).toBe(true);
  });

  it("normal running (ikke paused) → banner skjult, Resume disabled", async () => {
    installFetch(() => successResponse(baseDetail({ status: "running" })));
    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderGame1MasterConsole(c, "g1");
    await flush();

    const banner = c.querySelector<HTMLElement>("#g1-master-auto-pause-banner");
    expect(banner).not.toBeNull();
    expect(banner!.style.display).toBe("none");

    const resumeBtn = c.querySelector<HTMLButtonElement>(
      '#g1-master-actions button[data-action="resume"]'
    );
    expect(resumeBtn).not.toBeNull();
    expect(resumeBtn!.disabled).toBe(true);
  });

  it("manuell pause (status='paused') → banner + Resume-knapp aktiv", async () => {
    installFetch(() =>
      successResponse(
        baseDetail({
          status: "paused",
          engineState: {
            isPaused: true,
            pausedAtPhase: null, // manuell pause har ikke paused_at_phase
            currentPhase: 1,
            drawsCompleted: 3,
            isFinished: false,
          },
        })
      )
    );
    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderGame1MasterConsole(c, "g1");
    await flush();

    const banner = c.querySelector<HTMLElement>("#g1-master-auto-pause-banner");
    expect(banner!.style.display).not.toBe("none");

    const resumeBtn = c.querySelector<HTMLButtonElement>(
      '#g1-master-actions button[data-action="resume"]'
    );
    expect(resumeBtn!.disabled).toBe(false);
  });

  it("klikk på Resume → POST /api/admin/game1/games/:gameId/resume", async () => {
    const fetchCalls: Array<{ url: string; method: string }> = [];
    installFetch((url, init) => {
      const u = String(url);
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      fetchCalls.push({ url: u, method });
      if (u.endsWith("/api/admin/game1/games/g1/resume") && method === "POST") {
        return successResponse({
          gameId: "g1",
          status: "running",
          auditId: "audit-resume-1",
        });
      }
      // Default GET response (auto-paused)
      return successResponse(
        baseDetail({
          status: "running",
          engineState: {
            isPaused: true,
            pausedAtPhase: 1,
            currentPhase: 2,
            drawsCompleted: 5,
            isFinished: false,
          },
        })
      );
    });

    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderGame1MasterConsole(c, "g1");
    await flush();

    const resumeBtn = c.querySelector<HTMLButtonElement>(
      '#g1-master-actions button[data-action="resume"]'
    );
    expect(resumeBtn).not.toBeNull();
    expect(resumeBtn!.disabled).toBe(false);

    resumeBtn!.click();
    await flush();

    const resumeCall = fetchCalls.find(
      (c) => c.method === "POST" && c.url.includes("/resume")
    );
    expect(resumeCall).toBeDefined();
    expect(resumeCall!.url).toContain("/api/admin/game1/games/g1/resume");
  });

  it("ingen engineState i response → faller tilbake til status-basert banner", async () => {
    // Backend uten drawEngine injisert → engineState=null. UI skal da bruke
    // status='paused' som fallback.
    installFetch(() =>
      successResponse(
        baseDetail({
          status: "paused",
          engineState: null,
        })
      )
    );
    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderGame1MasterConsole(c, "g1");
    await flush();

    const banner = c.querySelector<HTMLElement>("#g1-master-auto-pause-banner");
    expect(banner!.style.display).not.toBe("none");
    const resumeBtn = c.querySelector<HTMLButtonElement>(
      '#g1-master-actions button[data-action="resume"]'
    );
    expect(resumeBtn!.disabled).toBe(false);
  });
});
