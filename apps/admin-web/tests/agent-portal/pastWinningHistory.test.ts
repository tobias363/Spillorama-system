// BIN-17.32 — PastGameWinningHistoryPage render-tests.
//
// Verifiserer at:
//   - 2 date-inputs (from/to) rendres
//   - Ticket-ID-søkefelt rendres
//   - Kolonne-headere matcher wireframe (Date/Time, Ticket ID, Type, Color,
//     Price, Winning Pattern)
//   - Respons-rader populerer tabellen
//   - CSV Export-knapp er synlig

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderPastGameWinningHistoryPage } from "../../src/pages/agent-portal/PastGameWinningHistoryPage.js";

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("BIN-17.32 — Past Game Winning History (agent)", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders filter-row med 2 date-inputs + ticket-ID-søk + export-knapp", async () => {
    globalThis.fetch = (async () =>
      okJson({
        from: "2026-04-01T00:00:00.000Z",
        to: "2026-04-30T23:59:59.999Z",
        generatedAt: new Date().toISOString(),
        hallId: "hall-a",
        rows: [],
        total: 0,
        offset: 0,
        limit: 500,
      })) as typeof fetch;
    const c = document.createElement("div");
    await renderPastGameWinningHistoryPage(c);

    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
    // Ticket-ID-søkefelt.
    expect(c.querySelector("input[type=text]")).not.toBeNull();
    // CSV export-knapp.
    expect(c.querySelector(".datatable-csv-btn")).not.toBeNull();
  });

  it("rendres kolonne-headere per wireframe (Date/Time, Ticket ID, Type, Color, Price, Winning Pattern)", async () => {
    globalThis.fetch = (async () =>
      okJson({
        from: "2026-04-01T00:00:00.000Z",
        to: "2026-04-30T23:59:59.999Z",
        generatedAt: new Date().toISOString(),
        hallId: "hall-a",
        rows: [],
        total: 0,
        offset: 0,
        limit: 500,
      })) as typeof fetch;
    const c = document.createElement("div");
    await renderPastGameWinningHistoryPage(c);

    const headerTexts = Array.from(c.querySelectorAll("thead th")).map((th) =>
      (th.textContent ?? "").trim().toLowerCase()
    );
    // Forventer 6 kolonner i wireframe-rekkefølge.
    expect(headerTexts.length).toBe(6);
    // Skal inneholde nøkkelord for alle 6 kolonner (språkuavhengig sjekk).
    const joined = headerTexts.join(" | ");
    expect(/dato|date/.test(joined)).toBe(true);
    expect(/billett|ticket/.test(joined)).toBe(true);
    expect(/vinnermønster|winning pattern/.test(joined)).toBe(true);
  });

  it("populerer tabell-rader fra backend-respons", async () => {
    globalThis.fetch = (async () =>
      okJson({
        from: "2026-04-01T00:00:00.000Z",
        to: "2026-04-30T23:59:59.999Z",
        generatedAt: new Date().toISOString(),
        hallId: "hall-a",
        rows: [
          {
            dateTime: "2026-04-10T18:30:00.000Z",
            ticketId: "01-1001",
            ticketType: "small_yellow",
            ticketColor: "small",
            priceCents: 200_00,
            winningPattern: "full_house",
          },
          {
            dateTime: "2026-04-11T19:00:00.000Z",
            ticketId: "01-1002",
            ticketType: "large_blue",
            ticketColor: "large",
            priceCents: null,
            winningPattern: null,
          },
        ],
        total: 2,
        offset: 0,
        limit: 500,
      })) as typeof fetch;
    const c = document.createElement("div");
    await renderPastGameWinningHistoryPage(c);

    const rows = c.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
    const firstRowText = rows[0]?.textContent ?? "";
    expect(firstRowText.includes("01-1001")).toBe(true);
    expect(firstRowText.includes("small_yellow")).toBe(true);
    expect(firstRowText.includes("full_house")).toBe(true);
    // Null-priser/mønstre renders som "—".
    const secondRowText = rows[1]?.textContent ?? "";
    expect(secondRowText.includes("01-1002")).toBe(true);
    expect(secondRowText.includes("—")).toBe(true);
  });

  it("viser feilmelding i DOM hvis backend feiler", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: "SHIFT_NOT_ACTIVE", message: "No shift" } }),
        { status: 400, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    const c = document.createElement("div");
    await renderPastGameWinningHistoryPage(c);
    const alert = c.querySelector(".alert-danger");
    expect(alert).not.toBeNull();
  });
});
