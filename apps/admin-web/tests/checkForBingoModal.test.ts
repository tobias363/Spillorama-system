// Unit-tests for `CheckForBingoModal` — wireframe §17.16 / FOLLOWUP-12.
//
// Dekker pilot-blokker-flyten:
//   1. PAUSE-call ved åpning av modal.
//   2. RESUME-call ved lukking (alle close-grunner).
//   3. Forskjellige render-tilstander basert på CheckBingoQuickResponse:
//        - found=false              → not-found-alert
//        - requiresFullCheck=true   → requires-full-alert (med link)
//        - hasWon=true              → 5×5-grid + pattern-status + Reward-knapp
//        - hasWon=false             → not-won-alert
//        - hasWon=true men allerede utbetalt → grid uten Reward-knapp
//   4. Reward-knapp → POST /api/agent/physical/:uniqueId/reward + re-fetch.
//
// Test-strategi: vi mock-er `global.fetch` direkte (samme mønster som
// `cashInOutSettlementWiring.test.ts`) og åpner modal via
// `openCheckForBingoModal()`. DOM-en queries via `data-marker`-attributter
// satt i modalen.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { openCheckForBingoModal } from "../src/pages/cash-inout/modals/CheckForBingoModal.js";
import type { CheckBingoQuickResponse } from "../src/pages/cash-inout/modals/CheckForBingoModal.js";

const ROOM_CODE = "ROOM-1";
const TICKET_ID = "T-1234";

function makeFetchMock(handlers: {
  pause?: () => Response;
  resume?: () => Response;
  check?: (body: { ticketId: string }) => Response;
  reward?: (uniqueId: string, body: { gameId: string; amountCents: number }) => Response;
}) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      init?.body && typeof init.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : ({} as Record<string, unknown>);

    if (method === "POST" && url.endsWith("/game/pause")) {
      return handlers.pause
        ? handlers.pause()
        : new Response(JSON.stringify({ ok: true, data: { isPaused: true } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
    }
    if (method === "POST" && url.endsWith("/game/resume")) {
      return handlers.resume
        ? handlers.resume()
        : new Response(JSON.stringify({ ok: true, data: { isPaused: false } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
    }
    if (method === "POST" && url.endsWith("/check-bingo")) {
      return handlers.check
        ? handlers.check(body as { ticketId: string })
        : new Response(JSON.stringify({ ok: true, data: { found: false } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
    }
    if (method === "POST" && url.includes("/api/agent/physical/") && url.endsWith("/reward")) {
      const uniqueId = decodeURIComponent(url.split("/api/agent/physical/")[1]!.split("/")[0]!);
      return handlers.reward
        ? handlers.reward(uniqueId, body as { gameId: string; amountCents: number })
        : new Response(
            JSON.stringify({
              ok: true,
              data: { uniqueId, status: "rewarded", amountCents: body.amountCents ?? 0 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
    }

    return new Response(
      JSON.stringify({ ok: false, error: { code: "UNHANDLED", message: url } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  });
}

function jsonOk<T>(data: T): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Vent på fire-and-forget micro-tasks etter modal-åpning. */
async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await Promise.resolve();
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.localStorage.setItem("bingo_admin_access_token", "tok");
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("CheckForBingoModal — initial render", () => {
  it("renderer ticket-input + GO-knapp + Avbryt-knapp", async () => {
    makeFetchMock({});
    openCheckForBingoModal({ roomCode: ROOM_CODE, skipPauseResume: true });
    await flushAsync();

    // Modal må eksistere
    const modal = document.querySelector(".modal-check-for-bingo");
    expect(modal).not.toBeNull();

    // Ticket-input
    const input = document.querySelector<HTMLInputElement>(
      '[data-marker="cfb-ticket-input"]',
    );
    expect(input).not.toBeNull();
    expect(input!.required).toBe(true);

    // GO-knapp + Avbryt-knapp
    const goBtn = modal!.closest(".modal")
      ?.querySelector<HTMLButtonElement>('[data-action="check"]');
    const cancelBtn = modal!.closest(".modal")
      ?.querySelector<HTMLButtonElement>('[data-action="cancel"]');
    expect(goBtn).not.toBeNull();
    expect(cancelBtn).not.toBeNull();
  });

  it("ingen result-element synlig før agenten har trykket GO", async () => {
    makeFetchMock({});
    openCheckForBingoModal({ roomCode: ROOM_CODE, skipPauseResume: true });
    await flushAsync();

    const result = document.querySelector('[data-marker="cfb-result"]');
    expect(result).not.toBeNull();
    expect(result!.innerHTML.trim()).toBe("");
  });
});

describe("CheckForBingoModal — PAUSE/RESUME-livscyklus", () => {
  it("kaller POST /api/admin/rooms/:roomCode/game/pause ved åpning", async () => {
    let pauseCalls = 0;
    const fetchSpy = makeFetchMock({
      pause: () => {
        pauseCalls += 1;
        return jsonOk({ isPaused: true });
      },
    });

    openCheckForBingoModal({ roomCode: ROOM_CODE });
    await flushAsync();

    expect(pauseCalls).toBe(1);
    // Verifiser URL-en
    const pauseCall = fetchSpy.mock.calls.find((c) => {
      const url = typeof c[0] === "string" ? c[0] : (c[0] as URL | Request).toString();
      return url.includes("/game/pause");
    });
    expect(pauseCall).toBeTruthy();
    const url =
      typeof pauseCall![0] === "string"
        ? pauseCall![0]
        : (pauseCall![0] as URL | Request).toString();
    expect(url).toBe(`/api/admin/rooms/${ROOM_CODE}/game/pause`);
  });

  it("kaller POST /api/admin/rooms/:roomCode/game/resume når modal lukkes", async () => {
    let resumeCalls = 0;
    makeFetchMock({
      resume: () => {
        resumeCalls += 1;
        return jsonOk({ isPaused: false });
      },
    });

    openCheckForBingoModal({ roomCode: ROOM_CODE });
    await flushAsync();

    // Trykk Avbryt for å lukke modal — kan finnes i flere modal-stacks så
    // vi tar den første.
    const allCancel = document.querySelectorAll<HTMLButtonElement>(
      '[data-action="cancel"]',
    );
    expect(allCancel.length).toBeGreaterThan(0);
    allCancel[0]!.click();
    await flushAsync();

    expect(resumeCalls).toBe(1);
  });

  it("skipPauseResume=true → ingen pause/resume-kall", async () => {
    let pauseCalls = 0;
    let resumeCalls = 0;
    makeFetchMock({
      pause: () => {
        pauseCalls += 1;
        return jsonOk({ isPaused: true });
      },
      resume: () => {
        resumeCalls += 1;
        return jsonOk({ isPaused: false });
      },
    });

    openCheckForBingoModal({ roomCode: ROOM_CODE, skipPauseResume: true });
    await flushAsync();

    // Lukk
    const cancelBtns = document.querySelectorAll<HTMLButtonElement>(
      '[data-action="cancel"]',
    );
    cancelBtns[0]!.click();
    await flushAsync();

    expect(pauseCalls).toBe(0);
    expect(resumeCalls).toBe(0);
  });
});

describe("CheckForBingoModal — null roomCode", () => {
  it("åpner ikke modal når roomCode er null", async () => {
    makeFetchMock({});
    openCheckForBingoModal({ roomCode: null, skipPauseResume: true });
    await flushAsync();

    const modal = document.querySelector(".modal-check-for-bingo");
    expect(modal).toBeNull();
  });
});

describe("CheckForBingoModal — render etter GO", () => {
  it("found=false → not-found-alert", async () => {
    makeFetchMock({
      check: () => jsonOk<CheckBingoQuickResponse>({ found: false }),
    });
    openCheckForBingoModal({ roomCode: ROOM_CODE, skipPauseResume: true });
    await flushAsync();

    const input = document.querySelector<HTMLInputElement>(
      '[data-marker="cfb-ticket-input"]',
    )!;
    input.value = TICKET_ID;
    const goBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="check"]',
    )!;
    goBtn.click();
    await flushAsync();

    const notFound = document.querySelector('[data-marker="cfb-not-found"]');
    expect(notFound).not.toBeNull();
    expect(notFound!.textContent).toContain(TICKET_ID);
  });

  it("requiresFullCheck=true → warning-alert med link til full-flyt", async () => {
    makeFetchMock({
      check: () =>
        jsonOk<CheckBingoQuickResponse>({
          found: true,
          gameId: "g-1",
          requiresFullCheck: true,
          hasWon: null,
          gameStatus: "RUNNING",
        }),
    });
    openCheckForBingoModal({ roomCode: ROOM_CODE, skipPauseResume: true });
    await flushAsync();

    document.querySelector<HTMLInputElement>(
      '[data-marker="cfb-ticket-input"]',
    )!.value = TICKET_ID;
    document.querySelector<HTMLButtonElement>('[data-action="check"]')!.click();
    await flushAsync();

    const requiresFull = document.querySelector('[data-marker="cfb-requires-full"]');
    expect(requiresFull).not.toBeNull();
    const link = requiresFull!.querySelector<HTMLAnchorElement>("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("#/agent/bingo-check");
  });

  it("hasWon=true (ikke utbetalt) → 5×5-grid + Reward-knapp", async () => {
    // 25 tall: rad 1 alle vinnende numre, sentercelle 0 (free).
    const numbers = [
      1, 2, 3, 4, 5,
      11, 12, 13, 14, 15,
      21, 22, 0, 24, 25,
      31, 32, 33, 34, 35,
      41, 42, 43, 44, 45,
    ];
    makeFetchMock({
      check: () =>
        jsonOk<CheckBingoQuickResponse>({
          found: true,
          gameId: "g-1",
          requiresFullCheck: false,
          hasWon: true,
          winningPattern: "row_1",
          wonAmountCents: 100_00, // 100 NOK
          isWinningDistributed: false,
          numbersJson: numbers,
          gameStatus: "RUNNING",
        }),
    });
    openCheckForBingoModal({ roomCode: ROOM_CODE, skipPauseResume: true });
    await flushAsync();

    document.querySelector<HTMLInputElement>(
      '[data-marker="cfb-ticket-input"]',
    )!.value = TICKET_ID;
    document.querySelector<HTMLButtonElement>('[data-action="check"]')!.click();
    await flushAsync();

    // Has-won-alert
    const hasWon = document.querySelector('[data-marker="cfb-has-won"]');
    expect(hasWon).not.toBeNull();

    // 5×5 grid med 25 celler
    const grid = document.querySelector('[data-marker="cfb-grid"]');
    expect(grid).not.toBeNull();
    const cells = grid!.querySelectorAll(".cfb-cell");
    expect(cells.length).toBe(25);

    // Pattern-celler (row_1 → indexes 0-4) skal ha cfb-cell-pattern-class
    const patternCells = grid!.querySelectorAll(".cfb-cell-pattern");
    expect(patternCells.length).toBe(5);

    // Center-celle (idx 12) skal ha cfb-cell-center-class
    const centerCells = grid!.querySelectorAll(".cfb-cell-center");
    expect(centerCells.length).toBe(1);

    // Reward-knapp finnes (ikke utbetalt + wonAmount > 0)
    const rewardBtn = document.querySelector('[data-marker="cfb-reward-btn"]');
    expect(rewardBtn).not.toBeNull();
  });

  it("hasWon=true (allerede utbetalt) → grid uten Reward-knapp", async () => {
    makeFetchMock({
      check: () =>
        jsonOk<CheckBingoQuickResponse>({
          found: true,
          gameId: "g-1",
          requiresFullCheck: false,
          hasWon: true,
          winningPattern: "full_house",
          wonAmountCents: 250_00,
          isWinningDistributed: true,
          numbersJson: Array.from({ length: 25 }, (_, i) => i + 1),
          gameStatus: "ENDED",
        }),
    });
    openCheckForBingoModal({ roomCode: ROOM_CODE, skipPauseResume: true });
    await flushAsync();

    document.querySelector<HTMLInputElement>(
      '[data-marker="cfb-ticket-input"]',
    )!.value = TICKET_ID;
    document.querySelector<HTMLButtonElement>('[data-action="check"]')!.click();
    await flushAsync();

    const hasWon = document.querySelector('[data-marker="cfb-has-won"]');
    expect(hasWon).not.toBeNull();

    // Grid finnes
    const grid = document.querySelector('[data-marker="cfb-grid"]');
    expect(grid).not.toBeNull();

    // Reward-knapp skal IKKE være rendret (allerede utbetalt)
    const rewardBtn = document.querySelector('[data-marker="cfb-reward-btn"]');
    expect(rewardBtn).toBeNull();
  });

  it("hasWon=false → not-won-alert (ingen grid, ingen Reward)", async () => {
    makeFetchMock({
      check: () =>
        jsonOk<CheckBingoQuickResponse>({
          found: true,
          gameId: "g-1",
          requiresFullCheck: false,
          hasWon: false,
          winningPattern: null,
          wonAmountCents: null,
          isWinningDistributed: false,
          gameStatus: "RUNNING",
        }),
    });
    openCheckForBingoModal({ roomCode: ROOM_CODE, skipPauseResume: true });
    await flushAsync();

    document.querySelector<HTMLInputElement>(
      '[data-marker="cfb-ticket-input"]',
    )!.value = TICKET_ID;
    document.querySelector<HTMLButtonElement>('[data-action="check"]')!.click();
    await flushAsync();

    const notWon = document.querySelector('[data-marker="cfb-not-won"]');
    expect(notWon).not.toBeNull();
    expect(document.querySelector('[data-marker="cfb-grid"]')).toBeNull();
    expect(document.querySelector('[data-marker="cfb-reward-btn"]')).toBeNull();
  });
});

describe("CheckForBingoModal — Reward-action", () => {
  it("Reward-knapp → POST /api/agent/physical/:uniqueId/reward med riktig payload + re-fetch", async () => {
    const rewardCalls: Array<{ uniqueId: string; gameId: string; amountCents: number }> = [];
    let checkCalls = 0;
    let isDistributed = false;

    makeFetchMock({
      check: () => {
        checkCalls += 1;
        return jsonOk<CheckBingoQuickResponse>({
          found: true,
          gameId: "game-xyz",
          requiresFullCheck: false,
          hasWon: true,
          winningPattern: "row_2",
          wonAmountCents: 500_00,
          isWinningDistributed: isDistributed,
          numbersJson: Array.from({ length: 25 }, (_, i) => i + 1),
          gameStatus: "RUNNING",
        });
      },
      reward: (uniqueId, body) => {
        rewardCalls.push({
          uniqueId,
          gameId: body.gameId,
          amountCents: body.amountCents,
        });
        isDistributed = true; // Neste check skal vise ny status
        return jsonOk({
          uniqueId,
          status: "rewarded",
          amountCents: body.amountCents,
        });
      },
    });

    openCheckForBingoModal({ roomCode: ROOM_CODE, skipPauseResume: true });
    await flushAsync();

    // Step 1: Sjekk billett
    document.querySelector<HTMLInputElement>(
      '[data-marker="cfb-ticket-input"]',
    )!.value = TICKET_ID;
    document.querySelector<HTMLButtonElement>('[data-action="check"]')!.click();
    await flushAsync();

    expect(checkCalls).toBe(1);

    // Step 2: Trykk Reward-knapp
    const rewardBtn = document.querySelector<HTMLButtonElement>(
      '[data-marker="cfb-reward-btn"]',
    );
    expect(rewardBtn).not.toBeNull();
    rewardBtn!.click();
    await flushAsync();

    expect(rewardCalls.length).toBe(1);
    expect(rewardCalls[0]!.uniqueId).toBe(TICKET_ID);
    expect(rewardCalls[0]!.gameId).toBe("game-xyz");
    expect(rewardCalls[0]!.amountCents).toBe(500_00);

    // Step 3: Etter reward skal det være kjørt en ny check (re-fetch).
    // Det betyr checkCalls === 2 (initial + post-reward refresh).
    expect(checkCalls).toBe(2);
  });

  it("Reward-knapp deaktiveres mens utbetaling er in-flight", async () => {
    let resolveReward!: (value: Response) => void;
    const rewardPromise = new Promise<Response>((r) => {
      resolveReward = r;
    });

    // Override fetch for /reward med pending-promise.
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url.endsWith("/check-bingo")) {
        return jsonOk<CheckBingoQuickResponse>({
          found: true,
          gameId: "g-1",
          requiresFullCheck: false,
          hasWon: true,
          winningPattern: "row_3",
          wonAmountCents: 200_00,
          isWinningDistributed: false,
          numbersJson: Array.from({ length: 25 }, (_, i) => i + 1),
          gameStatus: "RUNNING",
        });
      }
      if (method === "POST" && url.includes("/reward")) {
        return rewardPromise;
      }
      return new Response(JSON.stringify({ ok: true, data: null }), { status: 200 });
    });

    openCheckForBingoModal({ roomCode: ROOM_CODE, skipPauseResume: true });
    await flushAsync();

    document.querySelector<HTMLInputElement>(
      '[data-marker="cfb-ticket-input"]',
    )!.value = TICKET_ID;
    document.querySelector<HTMLButtonElement>('[data-action="check"]')!.click();
    await flushAsync();

    const rewardBtn = document.querySelector<HTMLButtonElement>(
      '[data-marker="cfb-reward-btn"]',
    )!;
    expect(rewardBtn.disabled).toBe(false);
    rewardBtn.click();
    await flushAsync();

    // Etter klikk skal knappen være deaktivert + spinner-ikon
    expect(rewardBtn.disabled).toBe(true);
    expect(rewardBtn.innerHTML).toContain("spinner");

    // Cleanup: la promisen resolve så testen ikke leaker
    resolveReward(jsonOk({ uniqueId: TICKET_ID, status: "rewarded", amountCents: 200_00 }));
  });
});
