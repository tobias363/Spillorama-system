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

  it("rendrer alle 11 ticket-type-rader med Initial ID fra carry-forward (PR #639 11-color palette)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okJson(mockInitialIds())) as typeof fetch;

    const mod = await import("../src/pages/agent-portal/modals/RegisterSoldTicketsModal.js");
    mod.openRegisterSoldTicketsModal({ gameId: "g-1" });
    await flush();

    const rows = document.querySelectorAll('[data-marker="register-sold-tickets-table"] tbody tr');
    // 11-color palette etter PR #639: 6 originale + Red + Green + Blue (samt Small/Large-varianter)
    expect(rows.length).toBe(11);

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

  it("REQ-091: når en rad har existingRange.id, blir initial-cellen et input som agenten kan redigere, og submit kaller PUT /api/agent/ticket-ranges/:rangeId", async () => {
    const initialIdsWithExisting = {
      gameId: "g-1",
      hallId: "hall-a",
      entries: [
        // small_yellow har eksisterende rad → må kunne redigeres
        {
          ticketType: "small_yellow",
          initialId: 1,
          roundNumber: 1,
          carriedFromGameId: null,
          existingRange: {
            id: "range-sy-1",
            gameId: "g-1",
            hallId: "hall-a",
            ticketType: "small_yellow",
            initialId: 1,
            finalId: 10,
            soldCount: 10,
            roundNumber: 1,
            carriedFromGameId: null,
            recordedByUserId: "agent-1",
            recordedAt: "2026-04-26T12:00:00Z",
            createdAt: "2026-04-26T12:00:00Z",
            updatedAt: "2026-04-26T12:00:00Z",
          },
        },
        { ticketType: "small_white", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
        { ticketType: "large_yellow", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
        { ticketType: "large_white", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
        { ticketType: "small_purple", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
        { ticketType: "large_purple", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
      ],
    };

    const fetchMock = vi.fn()
      // GET initial-ids
      .mockResolvedValueOnce(okJson(initialIdsWithExisting))
      // PUT ticket-ranges/:rangeId
      .mockResolvedValueOnce(okJson({
        range: {
          id: "range-sy-1",
          gameId: "g-1",
          hallId: "hall-a",
          ticketType: "small_yellow",
          initialId: 5,
          finalId: 25,
          soldCount: 21,
          roundNumber: 1,
          carriedFromGameId: null,
          recordedByUserId: "agent-1",
          recordedAt: "2026-04-26T12:30:00Z",
          createdAt: "2026-04-26T12:00:00Z",
          updatedAt: "2026-04-26T12:30:00Z",
        },
        before: {
          id: "range-sy-1",
          gameId: "g-1",
          hallId: "hall-a",
          ticketType: "small_yellow",
          initialId: 1,
          finalId: 10,
          soldCount: 10,
          roundNumber: 1,
          carriedFromGameId: null,
          recordedByUserId: "agent-1",
          recordedAt: "2026-04-26T12:00:00Z",
          createdAt: "2026-04-26T12:00:00Z",
          updatedAt: "2026-04-26T12:00:00Z",
        },
      }));
    globalThis.fetch = fetchMock as typeof fetch;

    const onSuccess = vi.fn();
    const mod = await import("../src/pages/agent-portal/modals/RegisterSoldTicketsModal.js");
    mod.openRegisterSoldTicketsModal({ gameId: "g-1", onSuccess });
    await flush();

    // Initial-cellen skal nå være et input (ikke ren tekst) for small_yellow
    const initialInput = document.querySelector<HTMLInputElement>(
      '[data-marker="initial-input-small_yellow"]',
    );
    expect(initialInput).toBeTruthy();
    expect(initialInput!.tagName).toBe("INPUT");
    expect(initialInput!.value).toBe("1");

    // Endre initial til 5
    initialInput!.value = "5";
    initialInput!.dispatchEvent(new Event("input", { bubbles: true }));

    // Endre final til 25
    const finalInput = document.querySelector<HTMLInputElement>(
      '[data-marker="final-input-small_yellow"]',
    )!;
    finalInput.value = "25";
    finalInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Sold-cellen skal vise 21 (25 - 5 + 1)
    expect(document.querySelector('[data-marker="sold-small_yellow"]')?.textContent).toBe("21");

    // Submit
    const submitBtn = document.querySelector<HTMLButtonElement>('[data-action="submit"]')!;
    submitBtn.click();
    await flush();
    await flush();

    // Andre fetch-kall skal være PUT mot ticket-ranges-endepunktet
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const putCall = fetchMock.mock.calls[1]!;
    expect(putCall[0]).toBe("/api/agent/ticket-ranges/range-sy-1");
    expect((putCall[1] as RequestInit).method).toBe("PUT");
    const body = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(body.gameId).toBe("g-1");
    expect(body.initialId).toBe(5);
    expect(body.finalId).toBe(25);

    // onSuccess ble kalt
    expect(onSuccess).toHaveBeenCalled();
    const arg = onSuccess.mock.calls[0]![0] as { totalSoldCount: number };
    expect(arg.totalSoldCount).toBe(21);
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

describe("AgentCashInOutPage — Register More Tickets button (PDF 17 §17.13)", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = '<div id="c"></div>';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Modal.closeAll(true);
    window.localStorage.removeItem("bingo_admin_access_token");
    vi.unstubAllGlobals();
  });

  it("rendrer Register More Tickets-knappen ved siden av Register Sold", async () => {
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-portal/AgentCashInOutPage.js");
    mod.mountAgentCashInOut(container);
    const moreBtn = container.querySelector('[data-marker="btn-register-more-tickets"]');
    expect(moreBtn).toBeTruthy();
    // Knappen skal vise (F1) for å indikere hotkey, og bruke i18n-nøkkelen.
    expect(moreBtn?.textContent ?? "").toMatch(/Registrér flere bonger|Register More Tickets/);
    expect(moreBtn?.textContent ?? "").toContain("F1");
  });

  it("knappen åpner Register More-modal når klikket (via prompt for gameId)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okJson(mockInitialIds())) as typeof fetch;
    window.localStorage.setItem("bingo_admin_access_token", "tok-test");
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-portal/AgentCashInOutPage.js");
    mod.mountAgentCashInOut(container);

    vi.stubGlobal("prompt", () => "g-1");

    const btn = container.querySelector<HTMLButtonElement>(
      '[data-marker="btn-register-more-tickets"]',
    )!;
    btn.click();
    await flush();

    expect(document.querySelector('[data-marker="register-more-tickets-modal"]'))
      .toBeTruthy();
  });

  it("F1-hotkey åpner Register More-modal når ingen modal er åpen", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okJson(mockInitialIds())) as typeof fetch;
    window.localStorage.setItem("bingo_admin_access_token", "tok-test");
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-portal/AgentCashInOutPage.js");
    mod.mountAgentCashInOut(container);

    vi.stubGlobal("prompt", () => "g-1");

    // F1 gjennom document — page-level hotkey.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", bubbles: true }));
    await flush();

    expect(document.querySelector('[data-marker="register-more-tickets-modal"]'))
      .toBeTruthy();
  });

  it("F1-hotkey er gated mens annen modal er åpen (modal-open class på body)", async () => {
    const container = document.getElementById("c")!;
    const mod = await import("../src/pages/agent-portal/AgentCashInOutPage.js");
    mod.mountAgentCashInOut(container);

    // Simuler at en modal er åpen ved å legge `modal-open`-klassen på body.
    // (Modal.open setter denne klassen — vi simulerer her uten å åpne en
    // ekte modal for å isolere F1-gating-logikken.)
    document.body.classList.add("modal-open");

    vi.stubGlobal("prompt", () => "should-not-be-called");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", bubbles: true }));
    await flush();

    expect(document.querySelector('[data-marker="register-more-tickets-modal"]'))
      .toBeNull();

    document.body.classList.remove("modal-open");
  });
});
