// Task 1.5 — "Agents not ready"-popup + override.
//
// Integration-tester for Game1MasterConsole sin nye `onStart`-flyt:
//   1. 409/400-respons med code=HALLS_NOT_READY + details.unreadyHalls →
//      modal "Noen haller er ikke klare" vises med hall-navn i lista.
//   2. "Start uansett"-klikk re-kaller /start med `confirmUnreadyHalls`.
//   3. "Avbryt"-klikk lukker modalen uten nytt /start-kall.
//
// Mønstret etter tests/games/pr4e2AdminPolish.test.ts.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderGame1MasterConsole } from "../../src/pages/games/master/Game1MasterConsole.js";

// AdminGame1Socket no-op (REST-only-flow nok for disse testene).
vi.mock("../../src/pages/games/master/adminGame1Socket.js", () => {
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

function domainErrorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  status = 400
): Response {
  return jsonResponse(
    {
      ok: false,
      error: details ? { code, message, details } : { code, message },
    },
    status
  );
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

const FAKE_DETAIL = {
  game: {
    id: "g1",
    status: "ready_to_start",
    scheduledStartTime: "2026-04-24T10:00:00Z",
    scheduledEndTime: null,
    actualStartTime: null,
    actualEndTime: null,
    masterHallId: "hall-master",
    groupHallId: "grp-north",
    participatingHallIds: ["hall-master", "hall-2", "hall-3"],
    subGameName: "Spill 1",
    customGameName: null,
    startedByUserId: null,
    stoppedByUserId: null,
    stopReason: null,
  },
  halls: [
    {
      hallId: "hall-master",
      hallName: "Master Hall",
      isReady: true,
      readyAt: null,
      readyByUserId: null,
      digitalTicketsSold: 0,
      physicalTicketsSold: 0,
      excludedFromGame: false,
      excludedReason: null,
    },
    {
      hallId: "hall-2",
      hallName: "Gullerene Bingos",
      isReady: false,
      readyAt: null,
      readyByUserId: null,
      digitalTicketsSold: 5,
      physicalTicketsSold: 0,
      excludedFromGame: false,
      excludedReason: null,
    },
    {
      hallId: "hall-3",
      hallName: "Centre",
      isReady: false,
      readyAt: null,
      readyByUserId: null,
      digitalTicketsSold: 3,
      physicalTicketsSold: 0,
      excludedFromGame: false,
      excludedReason: null,
    },
  ],
  allReady: false,
  auditRecent: [],
};

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.localStorage.setItem("bingo_admin_access_token", "tok");
});

describe("Task 1.5 — Game1MasterConsole 'Agents not ready'-popup", () => {
  it("HALLS_NOT_READY-respons åpner modal med hall-navn", async () => {
    // Første GET-detail + første POST-start returnerer HALLS_NOT_READY.
    installFetch(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/games/g1/start") && init?.method === "POST") {
        return domainErrorResponse(
          "HALLS_NOT_READY",
          "Haller er ikke klare: hall-2, hall-3.",
          { unreadyHalls: ["hall-2", "hall-3"] }
        );
      }
      return successResponse(FAKE_DETAIL);
    });

    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderGame1MasterConsole(c, "g1");
    await flush();

    const startBtn = c.querySelector<HTMLButtonElement>(
      '#g1-master-actions button[data-action="start"]'
    );
    expect(startBtn).not.toBeNull();
    startBtn!.click();
    await flush();

    const dialog = document.querySelector<HTMLElement>(".modal-g1-not-ready");
    expect(dialog).not.toBeNull();
    const list = dialog!.querySelector<HTMLElement>(
      '[data-testid="g1-master-not-ready-list"]'
    );
    expect(list).not.toBeNull();
    const items = list!.querySelectorAll("li");
    expect(items.length).toBe(2);
    // Hall-navn (ikke hall-ID) skal vises.
    const labels = Array.from(items).map((li) => li.textContent?.trim());
    expect(labels).toContain("Gullerene Bingos");
    expect(labels).toContain("Centre");
  });

  it("'Start uansett' re-kaller /start med confirmUnreadyHalls", async () => {
    let startCalls: Array<{ body: Record<string, unknown> }> = [];
    installFetch(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/games/g1/start") && init?.method === "POST") {
        const bodyRaw = init.body;
        const body =
          typeof bodyRaw === "string" ? (JSON.parse(bodyRaw) as Record<string, unknown>) : {};
        startCalls.push({ body });
        if (!Array.isArray(body.confirmUnreadyHalls)) {
          return domainErrorResponse(
            "HALLS_NOT_READY",
            "Haller er ikke klare: hall-2, hall-3.",
            { unreadyHalls: ["hall-2", "hall-3"] }
          );
        }
        return successResponse({
          gameId: "g1",
          status: "running",
          actualStartTime: "2026-04-24T10:00:05Z",
          auditId: "aud-xyz",
        });
      }
      return successResponse(FAKE_DETAIL);
    });

    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderGame1MasterConsole(c, "g1");
    await flush();

    const startBtn = c.querySelector<HTMLButtonElement>(
      '#g1-master-actions button[data-action="start"]'
    );
    startBtn!.click();
    await flush();

    const dialog = document.querySelector<HTMLElement>(".modal-g1-not-ready");
    expect(dialog).not.toBeNull();
    const confirmBtn = Array.from(
      dialog!.querySelectorAll<HTMLButtonElement>(".modal-footer button")
    ).find((b) => b.getAttribute("data-action") === "confirm");
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flush();

    expect(startCalls.length).toBeGreaterThanOrEqual(2);
    const firstCall = startCalls[0]!.body;
    const secondCall = startCalls[1]!.body;
    // Første kall skal IKKE inneholde confirmUnreadyHalls
    expect(firstCall.confirmUnreadyHalls).toBeUndefined();
    // Andre kall skal inneholde begge orange hall-IDer.
    expect(Array.isArray(secondCall.confirmUnreadyHalls)).toBe(true);
    expect(secondCall.confirmUnreadyHalls).toEqual(["hall-2", "hall-3"]);
  });

  it("'Avbryt' lukker modalen uten å re-kalle /start", async () => {
    let startCallCount = 0;
    installFetch(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/games/g1/start") && init?.method === "POST") {
        startCallCount += 1;
        return domainErrorResponse(
          "HALLS_NOT_READY",
          "Haller er ikke klare: hall-2.",
          { unreadyHalls: ["hall-2"] }
        );
      }
      return successResponse(FAKE_DETAIL);
    });

    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderGame1MasterConsole(c, "g1");
    await flush();

    const startBtn = c.querySelector<HTMLButtonElement>(
      '#g1-master-actions button[data-action="start"]'
    );
    startBtn!.click();
    await flush();

    const dialog = document.querySelector<HTMLElement>(".modal-g1-not-ready");
    expect(dialog).not.toBeNull();
    const cancelBtn = Array.from(
      dialog!.querySelectorAll<HTMLButtonElement>(".modal-footer button")
    ).find((b) => b.getAttribute("data-action") === "cancel");
    expect(cancelBtn).not.toBeNull();
    cancelBtn!.click();
    await flush();

    // Bare første forsøk skal ha gått ut (ingen re-kall).
    expect(startCallCount).toBe(1);
  });

  it("HALLS_NOT_READY uten details rendrer ikke tom modal (fallback til toast)", async () => {
    installFetch(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/games/g1/start") && init?.method === "POST") {
        // Legacy-respons uten details — klient skal ikke åpne popup.
        return domainErrorResponse(
          "HALLS_NOT_READY",
          "Haller er ikke klare."
        );
      }
      return successResponse(FAKE_DETAIL);
    });

    const c = document.createElement("div");
    document.body.appendChild(c);
    await renderGame1MasterConsole(c, "g1");
    await flush();

    const startBtn = c.querySelector<HTMLButtonElement>(
      '#g1-master-actions button[data-action="start"]'
    );
    startBtn!.click();
    await flush();

    // Ingen popup med v-ikke-klare-marker.
    const dialog = document.querySelector<HTMLElement>(".modal-g1-not-ready");
    expect(dialog).toBeNull();
  });
});
