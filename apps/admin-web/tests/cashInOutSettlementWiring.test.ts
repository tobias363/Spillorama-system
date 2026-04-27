// Verifiserer at klikk på "Oppgjør"-knappen (data-action="settlement") i
// Cash In/Out-siden åpner full Settlement-breakdown-modal med alle 14 maskin-
// rader + 3 sub-seksjoner + bilag-upload — IKKE den gamle 2-felts-modalen.
//
// Wireframe-paritet: PDF 13 §13.5 + PDF 15 §15.8 + PDF 17 §17.4.
// Erstatter den gamle `openSettlementModal()` (slettet 2026-04-27).
//
// Async-håndtering: `openSettlementFromCashInOut()` henter `getCurrentShift()`
// (fire-and-forget) før modal-en åpnes. Vi mock-er API-klienten + venter på
// at modal-DOM-en er prosessert med en mikrotask-flush.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import { renderCashInOutPage } from "../src/pages/cash-inout/CashInOutPage.js";

function agentSession(): Session {
  return {
    id: "ag-1",
    name: "Michael",
    email: "m@x.no",
    role: "agent",
    isSuperAdmin: false,
    avatar: "",
    hall: [{ id: "hall-a", name: "Oslo bingo" }],
    dailyBalance: null,
    permissions: {},
  };
}

/**
 * Vent på at fire-and-forget-promise-kjeden i `openSettlementFromCashInOut`
 * er ferdig: getCurrentShift() → openSettlementBreakdownModal(). Bruker
 * `setTimeout(0)` to ganger for å gi `fetch`-mocken tid til å resolve og
 * micro-tasks tid til å kjøre.
 */
async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await Promise.resolve();
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  setSession(agentSession());
  window.localStorage.setItem("bingo_admin_access_token", "tok");

  // Mock /api/agent/shift/current — returner null så businessDate fallback
  // til today (det er hovedflyten for ny modal).
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/api/agent/shift/current")) {
      return new Response(JSON.stringify({ ok: true, data: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "n/a" } }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("CashInOutPage — Oppgjør-knapp åpner full Settlement-breakdown-modal", () => {
  it("klikk på 'Oppgjør' (data-action=settlement) åpner modal med 14 maskin-rader + Total", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderCashInOutPage(root);

    const settlementBtn = root.querySelector<HTMLButtonElement>(
      '[data-action="settlement"]'
    );
    expect(settlementBtn).toBeTruthy();
    settlementBtn!.click();

    await flushAsync();

    // Full breakdown-modal har en spesifikk klasse + #sb-table-id.
    const modal = document.querySelector(".modal-settlement-breakdown");
    expect(modal).not.toBeNull();
    const table = document.querySelector("#sb-table");
    expect(table).not.toBeNull();
    // 14 maskin-rader + 1 total-rad = 15
    const rows = table!.querySelectorAll("tbody tr");
    expect(rows.length).toBe(15);
  });

  it("modal-en mottar agent-navn fra session ('Michael') og hall-navn ('Oslo bingo')", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderCashInOutPage(root);

    root.querySelector<HTMLButtonElement>('[data-action="settlement"]')!.click();
    await flushAsync();

    // Header-dl viser hall + agent-navn.
    const modal = document.querySelector(".modal-settlement-breakdown");
    expect(modal).not.toBeNull();
    const dl = modal!.querySelector("dl.dl-horizontal");
    expect(dl?.textContent).toContain("Michael");
    expect(dl?.textContent).toContain("Oslo bingo");
  });

  it("modal-en åpnes i 'create'-modus (har submit-knapp, ingen edit-reason-felt)", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderCashInOutPage(root);

    root.querySelector<HTMLButtonElement>('[data-action="settlement"]')!.click();
    await flushAsync();

    const modal = document.querySelector(".modal-settlement-breakdown");
    expect(modal).not.toBeNull();
    // Edit-reason-felt skal IKKE finnes i create-modus.
    expect(modal!.querySelector("#sb-edit-reason")).toBeNull();
    // Submit-knapp skal finnes (action="submit").
    const submitBtn = modal!
      .closest(".modal")
      ?.querySelector('[data-action="submit"]');
    expect(submitBtn).not.toBeNull();
  });

  it("alle 3 sub-seksjoner er tilstede: Endring opptall + Fordeling + Difference in shifts", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    renderCashInOutPage(root);

    root.querySelector<HTMLButtonElement>('[data-action="settlement"]')!.click();
    await flushAsync();

    const modal = document.querySelector(".modal-settlement-breakdown");
    expect(modal).not.toBeNull();
    // Seksjon 2: Endring opptall kasse — Kasse start + Kasse endt + Endring (read-only)
    expect(modal!.querySelector("#sb-kasse-start")).not.toBeNull();
    expect(modal!.querySelector("#sb-ending")).not.toBeNull();
    const endring = modal!.querySelector<HTMLInputElement>("#sb-endring");
    expect(endring).not.toBeNull();
    expect(endring!.readOnly).toBe(true);
    // Seksjon 3: Fordeling — Innskudd dropsafe + Påfyll/ut kasse + Totalt (read-only)
    expect(modal!.querySelector("#sb-drop")).not.toBeNull();
    expect(modal!.querySelector("#sb-paafyll")).not.toBeNull();
    const totaltDropsafe = modal!.querySelector<HTMLInputElement>("#sb-totalt-dropsafe");
    expect(totaltDropsafe).not.toBeNull();
    expect(totaltDropsafe!.readOnly).toBe(true);
    // Seksjon 4: Difference in shifts (read-only) + bilag-upload + notes
    const diff = modal!.querySelector<HTMLInputElement>("#sb-diff");
    expect(diff).not.toBeNull();
    expect(diff!.readOnly).toBe(true);
    expect(modal!.querySelector("#sb-bilag-file")).not.toBeNull();
    expect(modal!.querySelector("#sb-notes")).not.toBeNull();
  });
});
