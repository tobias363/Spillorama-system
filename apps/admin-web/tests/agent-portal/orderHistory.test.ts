// PDF 17 §17.29 — OrderHistoryPage render-tests.
//
// Verifiserer at:
//   - 2 date-inputs (from/to) rendres
//   - Search-felt + payment-method dropdown rendres
//   - Kolonne-headere matcher wireframe (Order ID, Date/Time, Payment, Total, Action)
//   - Respons-rader populerer tabellen
//   - Action-knapp ("View") trigger detail-modal

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderOrderHistoryPage } from "../../src/pages/agent-portal/OrderHistoryPage.js";

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("PDF 17 §17.29 — Order History (agent)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    initI18n();
    // Tøm body for å unngå modal-leftover mellom tester.
    document.body.innerHTML = "";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = "";
  });

  it("rendrer filter-rad med date-inputs, search-felt og payment dropdown", async () => {
    globalThis.fetch = (async () =>
      okJson({
        sales: [],
        total: 0,
        from: "2026-04-01T00:00:00.000Z",
        to: "2026-04-30T23:59:59.999Z",
        hallId: "hall-a",
        offset: 0,
        limit: 500,
        generatedAt: new Date().toISOString(),
      })) as typeof fetch;
    const c = document.createElement("div");
    await renderOrderHistoryPage(c);

    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
    expect(c.querySelector("input[type=text]")).not.toBeNull();
    // Payment-method dropdown.
    expect(c.querySelector("select")).not.toBeNull();
    // CSV-export.
    expect(c.querySelector(".datatable-csv-btn")).not.toBeNull();
  });

  it("populerer tabell med Order ID, Payment Type og Total", async () => {
    globalThis.fetch = (async () =>
      okJson({
        sales: [
          {
            id: "sale-1",
            cartId: "cart-1",
            orderId: "ORD-AAA-100",
            hallId: "hall-a",
            shiftId: "s-1",
            agentUserId: "ag-1",
            playerUserId: null,
            paymentMethod: "CASH",
            totalCents: 7500,
            walletTxId: null,
            agentTxId: "atx-1",
            createdAt: "2026-04-10T12:00:00.000Z",
          },
          {
            id: "sale-2",
            cartId: "cart-2",
            orderId: "ORD-AAA-101",
            hallId: "hall-a",
            shiftId: "s-1",
            agentUserId: "ag-1",
            playerUserId: "p-1",
            paymentMethod: "CARD",
            totalCents: 12500,
            walletTxId: null,
            agentTxId: "atx-2",
            createdAt: "2026-04-11T10:00:00.000Z",
          },
        ],
        total: 2,
        from: "2026-04-01T00:00:00.000Z",
        to: "2026-04-30T23:59:59.999Z",
        hallId: "hall-a",
        offset: 0,
        limit: 500,
        generatedAt: new Date().toISOString(),
      })) as typeof fetch;
    const c = document.createElement("div");
    await renderOrderHistoryPage(c);

    const rows = c.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
    const firstRowText = rows[0]?.textContent ?? "";
    expect(firstRowText.includes("ORD-AAA-100")).toBe(true);
    // Each row should have a "View"-button (data-view-order attribute).
    const viewButtons = c.querySelectorAll("[data-view-order]");
    expect(viewButtons.length).toBe(2);
  });

  it("rendrer wireframe-kolonner (Order ID, Date/Time, Payment, Total, Action)", async () => {
    globalThis.fetch = (async () =>
      okJson({
        sales: [],
        total: 0,
        from: "2026-04-01T00:00:00.000Z",
        to: "2026-04-30T23:59:59.999Z",
        hallId: "hall-a",
        offset: 0,
        limit: 500,
        generatedAt: new Date().toISOString(),
      })) as typeof fetch;
    const c = document.createElement("div");
    await renderOrderHistoryPage(c);

    const headerTexts = Array.from(c.querySelectorAll("thead th")).map((th) =>
      (th.textContent ?? "").trim().toLowerCase(),
    );
    expect(headerTexts.length).toBe(5);
    const joined = headerTexts.join(" | ");
    expect(/bestilling|order/.test(joined)).toBe(true);
    expect(/dato|date/.test(joined)).toBe(true);
    expect(/betaling|payment/.test(joined)).toBe(true);
    expect(/total/.test(joined)).toBe(true);
    expect(/handling|action/.test(joined)).toBe(true);
  });

  it("viser feilmelding ved backend-feil", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: "SHIFT_NOT_ACTIVE", message: "No shift" },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    const c = document.createElement("div");
    await renderOrderHistoryPage(c);
    const alert = c.querySelector(".alert-danger");
    expect(alert).not.toBeNull();
  });
});
