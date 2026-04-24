// PR-A4b (BIN-659) + Wireframe Gap #2 — Settlement PDF + Receipt integration tests.
//
// Verifies that clicking the PDF/receipt buttons in the settlement list triggers
// window.open() with the correct backend URLs. The binary streams are served by
// backend routes at /api/admin/shifts/:shiftId/settlement.pdf and
// /api/admin/shifts/:shiftId/settlement/receipt — we only assert the client
// integration here (URL-building + action-wiring).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../../src/i18n/I18n.js";
import { renderSettlementPage } from "../../src/pages/hallAccountReport/SettlementPage.js";
import {
  buildSettlementPdfUrl,
  buildSettlementReceiptUrl,
} from "../../src/api/admin-settlement.js";

const mkSettlementRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
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
  machineBreakdown: { rows: {}, ending_opptall_kassie_cents: 0, innskudd_drop_safe_cents: 0, difference_in_shifts_cents: 0 },
  bilagReceipt: null,
  createdAt: "",
  updatedAt: "",
  ...overrides,
});

const mockListResponse = (settlements: Record<string, unknown>[]): typeof fetch =>
  (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        data: { settlements, limit: 200, offset: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

describe("Settlement PDF + Receipt integration", () => {
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

  it("Gap#2 buildSettlementReceiptUrl() constructs correct admin-shift receipt URL", () => {
    expect(buildSettlementReceiptUrl("shift-123")).toBe(
      "/api/admin/shifts/shift-123/settlement/receipt"
    );
    expect(buildSettlementReceiptUrl("shift with slash/")).toBe(
      "/api/admin/shifts/shift%20with%20slash%2F/settlement/receipt"
    );
  });

  it("clicking PDF button calls window.open with pdf URL", async () => {
    globalThis.fetch = mockListResponse([mkSettlementRow()]);
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

  it("Gap#2 renders 4 action-buttons per row (view/edit/pdf/receipt)", async () => {
    globalThis.fetch = mockListResponse([mkSettlementRow()]);
    const c = document.createElement("div");
    await renderSettlementPage(c, "hall-a");

    const viewBtn = c.querySelector<HTMLButtonElement>('button[data-act="view"][data-shift="shift-42"]');
    const editBtn = c.querySelector<HTMLButtonElement>('button[data-act="edit"][data-shift="shift-42"]');
    const pdfBtn = c.querySelector<HTMLButtonElement>('button[data-act="pdf"][data-shift="shift-42"]');
    const receiptBtn = c.querySelector<HTMLButtonElement>('button[data-act="receipt"][data-shift="shift-42"]');

    expect(viewBtn).not.toBeNull();
    expect(editBtn).not.toBeNull();
    expect(pdfBtn).not.toBeNull();
    expect(receiptBtn).not.toBeNull();
  });

  it("Gap#2 receipt-button disabled når bilag mangler", async () => {
    globalThis.fetch = mockListResponse([mkSettlementRow({ bilagReceipt: null })]);
    const c = document.createElement("div");
    await renderSettlementPage(c, "hall-a");

    const receiptBtn = c.querySelector<HTMLButtonElement>(
      'button[data-act="receipt"][data-shift="shift-42"]'
    );
    expect(receiptBtn).not.toBeNull();
    expect(receiptBtn!.disabled).toBe(true);

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    receiptBtn!.click();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("Gap#2 receipt-button enabled + window.open når bilag finnes", async () => {
    globalThis.fetch = mockListResponse([
      mkSettlementRow({
        bilagReceipt: {
          mime: "application/pdf",
          filename: "bilag.pdf",
          dataUrl: "data:application/pdf;base64,JVBERi0=",
          sizeBytes: 500,
          uploadedAt: "2026-04-23T10:00:00Z",
          uploadedByUserId: "agent-1",
        },
      }),
    ]);
    const c = document.createElement("div");
    await renderSettlementPage(c, "hall-a");

    const receiptBtn = c.querySelector<HTMLButtonElement>(
      'button[data-act="receipt"][data-shift="shift-42"]'
    );
    expect(receiptBtn).not.toBeNull();
    expect(receiptBtn!.disabled).toBe(false);

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    receiptBtn!.click();
    expect(openSpy).toHaveBeenCalledWith(
      "/api/admin/shifts/shift-42/settlement/receipt",
      "_blank"
    );
    openSpy.mockRestore();
  });
});
