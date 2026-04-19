// PR-A4b (BIN-659) — Settlement PDF integration test.
//
// Verifies that clicking the PDF button in the settlement list triggers
// window.open() with the correct backend URL. PDF stream itself is served by
// BIN-588 infra at /api/admin/shifts/:shiftId/settlement.pdf — we only
// assert the client integration here.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderSettlementPage } from "../../src/pages/hallAccountReport/SettlementPage.js";
import { buildSettlementPdfUrl } from "../../src/api/admin-settlement.js";

describe("Settlement PDF integration", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    initI18n();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("buildSettlementPdfUrl() constructs correct admin-shift URL", () => {
    expect(buildSettlementPdfUrl("shift-123")).toBe(
      "/api/admin/shifts/shift-123/settlement.pdf"
    );
    expect(buildSettlementPdfUrl("shift with space/slash")).toBe(
      "/api/admin/shifts/shift%20with%20space%2Fslash/settlement.pdf"
    );
  });

  it("clicking PDF button calls window.open with pdf URL", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            settlements: [
              {
                id: "s1",
                shiftId: "shift-42",
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
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    const c = document.createElement("div");
    await renderSettlementPage(c, "hall-a");

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const pdfBtn = c.querySelector<HTMLButtonElement>(
      'button[data-act="pdf"][data-shift="shift-42"]'
    );
    expect(pdfBtn).not.toBeNull();
    pdfBtn!.click();
    expect(openSpy).toHaveBeenCalledWith(
      "/api/admin/shifts/shift-42/settlement.pdf",
      "_blank"
    );
    openSpy.mockRestore();
  });
});
