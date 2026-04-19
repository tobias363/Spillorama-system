// PR-A4b (BIN-659) — hallAccountReport page render tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderHallAccountListPage } from "../../src/pages/hallAccountReport/HallAccountListPage.js";
import { renderHallAccountReportPage } from "../../src/pages/hallAccountReport/HallAccountReportPage.js";
import { renderSettlementPage } from "../../src/pages/hallAccountReport/SettlementPage.js";

function okJson(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("hallAccountReport pages", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    initI18n();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("HallAccountListPage renders table + hall rows", async () => {
    globalThis.fetch = (async () =>
      okJson([
        { id: "hall-a", name: "Hall A", isActive: true },
        { id: "hall-b", name: "Hall B", isActive: true },
      ])) as typeof fetch;

    const c = document.createElement("div");
    await renderHallAccountListPage(c);
    expect(c.querySelector(".content-header h1")?.textContent).toBeTruthy();
    const rows = c.querySelectorAll("table tbody tr");
    expect(rows.length).toBe(2);
    // Each row has a view-link + settlement-link to the right routes.
    const viewA = c.querySelector('a[href="#/hallAccountReport/hall-a"]');
    const setA = c.querySelector('a[href="#/report/settlement/hall-a"]');
    expect(viewA).not.toBeNull();
    expect(setA).not.toBeNull();
  });

  it("HallAccountReportPage renders filter-bar + extra gameType selector", async () => {
    // Daily + balance + manual-entries — return empty for each.
    let call = 0;
    globalThis.fetch = (async () => {
      call++;
      if (call === 1) return okJson({ hallId: "hall-a", rows: [], count: 0 });
      if (call === 2)
        return okJson({
          hallId: "hall-a",
          hallCashBalance: 0,
          dropsafeBalance: 0,
          periodTotalCashInCents: 0,
          periodTotalCashOutCents: 0,
          periodTotalCardInCents: 0,
          periodTotalCardOutCents: 0,
          periodSellingByCustomerNumberCents: 0,
          periodManualAdjustmentCents: 0,
          periodNetCashFlowCents: 0,
        });
      return okJson({ hallId: "hall-a", rows: [], count: 0 });
    }) as typeof fetch;

    const c = document.createElement("div");
    await renderHallAccountReportPage(c, "hall-a");
    expect(c.querySelectorAll("input[type=date]").length).toBe(2);
    expect(c.querySelector(".datatable-csv-btn")).not.toBeNull();
    // gameType select added via toolbar.extra
    expect(c.querySelector(".datatable-toolbar-extra select")).not.toBeNull();
  });

  it("SettlementPage renders filter-bar + action buttons wire up correctly", async () => {
    globalThis.fetch = (async () =>
      okJson({
        settlements: [
          {
            id: "s1",
            shiftId: "shift-1",
            agentUserId: "agent-1",
            hallId: "hall-a",
            businessDate: "2026-04-18",
            dailyBalanceAtStart: 0,
            dailyBalanceAtEnd: 0,
            reportedCashCount: 0,
            dailyBalanceDifference: 0,
            settlementToDropSafe: 0,
            withdrawFromTotalBalance: 0,
            totalDropSafe: 0,
            shiftCashInTotal: 0,
            shiftCashOutTotal: 0,
            shiftCardInTotal: 0,
            shiftCardOutTotal: 0,
            settlementNote: null,
            closedByUserId: "agent-1",
            isForced: false,
            editedByUserId: null,
            editedAt: null,
            editReason: null,
            otherData: {},
            createdAt: "",
            updatedAt: "",
          },
        ],
        limit: 200,
        offset: 0,
      })) as typeof fetch;

    const c = document.createElement("div");
    await renderSettlementPage(c, "hall-a");
    // Rows rendered + action buttons present
    const pdfBtn = c.querySelector('button[data-act="pdf"][data-shift="shift-1"]');
    const viewBtn = c.querySelector('button[data-act="view"][data-shift="shift-1"]');
    const editBtn = c.querySelector('button[data-act="edit"][data-shift="shift-1"]');
    expect(pdfBtn).not.toBeNull();
    expect(viewBtn).not.toBeNull();
    expect(editBtn).not.toBeNull();
  });
});
