/**
 * BIN-GAP#4 — admin-web tester for Register Sold Tickets modal + page-wiring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { Modal } from "../src/components/Modal.js";

const originalFetch = globalThis.fetch;

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function failJson(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message } }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function mockInitialIds(hallId = "hall-a"): unknown {
  return {
    gameId: "g-1",
    hallId,
    entries: [
      { ticketType: "small_yellow", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
      { ticketType: "small_white", initialId: 50, roundNumber: 2, carriedFromGameId: "g-0", existingRange: null },
      { ticketType: "large_yellow", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
      { ticketType: "large_white", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
      { ticketType: "small_purple", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
      { ticketType: "large_purple", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
    ],
  };
}

async function flush(): Promise<void> {
  // Flush microtasks to let async modal init complete
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe("RegisterSoldTicketsModal", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = '<div id="c"></div>';
    window.localStorage.setItem("bingo_admin_access_token", "tok-test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Modal.closeAll(true);
    window.localStorage.removeItem("bingo_admin_access_token");
  });

  it("rendrer alle 6 ticket-type-rader med Initial ID fra carry-forward", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okJson(mockInitialIds())) as typeof fetch;

    const mod = await import("../src/pages/agent-portal/modals/RegisterSoldTicketsModal.js");
    mod.openRegisterSoldTicketsModal({ gameId: "g-1" });
    await flush();

    const rows = document.querySelectorAll('[data-marker="register-sold-tickets-table"] tbody tr');
    expect(rows.length).toBe(6);

    // Small Yellow: initial=1
    const syInitial = document.querySelector('[data-marker="initial-small_yellow"]');
    expect(syInitial?.textContent).toBe("1");

    // Small White: initial=50 (carry-forward), med tooltip
    const swInitial = document.querySelector<HTMLElement>(
      '[data-marker="initial-small_white"]',
    );
    expect(swInitial?.textContent).toBe("50");
    expect(swInitial?.getAttribute("title")).toContain("g-0");

    // Alle typer finnes
    for (const type of [
      "small_yellow",
      "small_white",
      "large_yellow",
      "large_white",
      "small_purple",
      "large_purple",
    ]) {
      expect(document.querySelector(`[data-marker="label-${type}"]`)).toBeTruthy();
      expect(document.querySelector(`[data-marker="final-input-${type}"]`)).toBeTruthy();
      expect(document.querySelector(`[data-marker="sold-${type}"]`)).toBeTruthy();
    }
  });

  it("Tickets Sold beregnes automatisk når Final ID endres", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okJson(mockInitialIds())) as typeof fetch;

    const mod = await import("../src/pages/agent-portal/modals/RegisterSoldTicketsModal.js");
    mod.openRegisterSoldTicketsModal({ gameId: "g-1" });
    await flush();

    // Small Yellow: initial=1, sett final=10 → sold=10
    const syInput = document.querySelector<HTMLInputElement>(
      '[data-marker="final-input-small_yellow"]',
    )!;
    syInput.value = "10";
    syInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector('[data-marker="sold-small_yellow"]')?.textContent).toBe("10");

    // Small White: initial=50, sett final=100 → sold=51
    const swInput = document.querySelector<HTMLInputElement>(
      '[data-marker="final-input-small_white"]',
    )!;
    swInput.value = "100";
    swInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector('[data-marker="sold-small_white"]')?.textContent).toBe("51");

    // Total = 10 + 51 = 61
    expect(document.querySelector('[data-marker="total-sold-value"]')?.textContent).toBe("61");
  });

  it("viser feilmelding når Final < Initial", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okJson(mockInitialIds())) as typeof fetch;

    const mod = await import("../src/pages/agent-portal/modals/RegisterSoldTicketsModal.js");
    mod.openRegisterSoldTicketsModal({ gameId: "g-1" });
    await flush();

    // Small White: initial=50. Sett final=30 → invalid
    const swInput = document.querySelector<HTMLInputElement>(
      '[data-marker="final-input-small_white"]',
    )!;
    swInput.value = "30";
    swInput.dispatchEvent(new Event("input", { bubbles: true }));
    const soldCell = document.querySelector<HTMLElement>('[data-marker="sold-small_white"]');
    expect(soldCell?.classList.contains("text-danger")).toBe(true);
  });

  it("Submit-knapp POSTer perTypeFinalIds til backend", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson(mockInitialIds()))
      .mockResolvedValueOnce(okJson({
        gameId: "g-1",
        hallId: "hall-a",
        totalSoldCount: 20,
        ranges: [],
        hallReadyStatus: { isReady: true },
      }));
    globalThis.fetch = fetchMock as typeof fetch;

    const onSuccess = vi.fn();
    const mod = await import("../src/pages/agent-portal/modals/RegisterSoldTicketsModal.js");
    mod.openRegisterSoldTicketsModal({ gameId: "g-1", onSuccess });
    await flush();

    const syInput = document.querySelector<HTMLInputElement>(
      '[data-marker="final-input-small_yellow"]',
    )!;
    syInput.value = "20";
    syInput.dispatchEvent(new Event("input", { bubbles: true }));

    const submitBtn = document.querySelector<HTMLButtonElement>(
      '[data-action="submit"]',
    )!;
    expect(submitBtn).toBeTruthy();
    submitBtn.click();
    await flush();
    await flush();

    // Andre fetch-kall var submit
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const submitCall = fetchMock.mock.calls[1]!;
    expect(submitCall[0]).toBe("/api/agent/ticket-registration/g-1/final-ids");
    expect((submitCall[1] as RequestInit).method).toBe("POST");
    const bodyStr = (submitCall[1] as RequestInit).body as string;
    const body = JSON.parse(bodyStr);
    expect(body.perTypeFinalIds.small_yellow).toBe(20);

    expect(onSuccess).toHaveBeenCalledWith({
      totalSoldCount: 20,
      hallReadyStatus: { isReady: true },
    });
  });

  it("viser fetch-error som alert når backend returnerer 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      failJson(404, "GAME_NOT_FOUND", "Spillet finnes ikke"),
    ) as typeof fetch;

    const mod = await import("../src/pages/agent-portal/modals/RegisterSoldTicketsModal.js");
    mod.openRegisterSoldTicketsModal({ gameId: "ghost" });
    await flush();

    const err = document.querySelector('[data-marker="error"]');
    expect(err).toBeTruthy();
    expect(err?.textContent).toContain("Spillet finnes ikke");
  });
});

describe("AgentCashInOutPage — Register Sold Tickets button", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = '<div id="c"></div>';
  });

  afterEach(() => {
    Modal.closeAll(true);
  });

  it("rendrer Register Sold Tickets-knappen", async () => {
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-portal/AgentCashInOutPage.js");
    mod.mountAgentCashInOut(container);
    const btn = container.querySelector('[data-marker="btn-register-sold-tickets"]');
    expect(btn).toBeTruthy();
    // Default locale er Norwegian — sjekk at i18n-nøkkelen resolved
    expect(btn?.textContent?.trim()).toMatch(/Registrér solgte bonger|Register Sold Tickets/);
  });

  it("knappen åpner modal når klikket (via prompt for gameId)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okJson(mockInitialIds())) as typeof fetch;
    window.localStorage.setItem("bingo_admin_access_token", "tok-test");
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-portal/AgentCashInOutPage.js");
    mod.mountAgentCashInOut(container);

    // Mock prompt til å returnere en gameId
    vi.stubGlobal("prompt", () => "g-1");

    const btn = container.querySelector<HTMLButtonElement>(
      '[data-marker="btn-register-sold-tickets"]',
    )!;
    btn.click();
    await flush();

    expect(document.querySelector('[data-marker="register-sold-tickets-modal"]'))
      .toBeTruthy();
  });
});
