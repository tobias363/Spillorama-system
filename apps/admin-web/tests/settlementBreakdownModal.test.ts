// K1 wire-up — tests for SettlementBreakdownModal (full 15-row layout, shift-
// delta live calculation, edit/view modes, submit validation).
//
// Covers the acceptance-criteria wire-up for the wireframe 17.40 popup:
//   - Layout: 15 rows + 3-col (IN/OUT/Sum) + total-row
//   - Shift-delta: 4 felter (start-end, drop-safe, ending, difference) med
//     difference auto-kalkulert
//   - Norsk Tipping/Rikstoto Dag + Totalt begge summeres inn i total
//   - Submit-button present for create/edit, skjult for view

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import {
  calculateShiftDelta,
  openSettlementBreakdownModal,
} from "../src/pages/cash-inout/modals/SettlementBreakdownModal.js";
import type { AdminSettlement } from "../src/api/admin-settlement.js";

function baseSettlement(): AdminSettlement {
  return {
    id: "set-1",
    shiftId: "shift-1",
    agentUserId: "agent-1",
    hallId: "hall-a",
    businessDate: "2026-04-24",
    dailyBalanceAtStart: 0,
    dailyBalanceAtEnd: 1000,
    reportedCashCount: 950,
    dailyBalanceDifference: -50,
    settlementToDropSafe: 0,
    withdrawFromTotalBalance: 0,
    totalDropSafe: 0,
    shiftCashInTotal: 1500,
    shiftCashOutTotal: 500,
    shiftCardInTotal: 0,
    shiftCardOutTotal: 0,
    settlementNote: "baseline note",
    closedByUserId: "agent-1",
    isForced: false,
    editedByUserId: null,
    editedAt: null,
    editReason: null,
    otherData: {},
    machineBreakdown: {
      rows: {
        metronia: { in_cents: 100_00, out_cents: 50_00 },
        ok_bingo: { in_cents: 75_00, out_cents: 25_00 },
        franco: { in_cents: 50_00, out_cents: 10_00 },
        otium: { in_cents: 0, out_cents: 0 },
        norsk_tipping_dag: { in_cents: 40_00, out_cents: 0 },
        norsk_tipping_totall: { in_cents: 60_00, out_cents: 0 },
        rikstoto_dag: { in_cents: 30_00, out_cents: 0 },
        rikstoto_totall: { in_cents: 70_00, out_cents: 0 },
        rekvisita: { in_cents: 5_00, out_cents: 0 },
        servering: { in_cents: 20_00, out_cents: 0 },
        bilag: { in_cents: 0, out_cents: 0 },
        bank: { in_cents: 0, out_cents: 0 },
        gevinst_overfoering_bank: { in_cents: 0, out_cents: 0 },
        annet: { in_cents: 0, out_cents: 0 },
      },
      ending_opptall_kassie_cents: 500_00,
      innskudd_drop_safe_cents: 200_00,
      difference_in_shifts_cents: 0,
    },
    bilagReceipt: null,
    createdAt: "",
    updatedAt: "",
  };
}

describe("SettlementBreakdownModal — layout (15 rows + 3 columns + total row)", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    document.body.className = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders all 14 maskin-rader + Total-rad (= 15 rader totalt)", () => {
    openSettlementBreakdownModal({
      agentUserId: "agent-1",
      agentName: "Agent",
      hallName: "Hall A",
      businessDate: "2026-04-24",
    });
    const table = document.querySelector("#sb-table");
    expect(table).not.toBeNull();
    const tbodyRows = table!.querySelectorAll("tbody tr");
    // 14 maskin-rader + 1 total-rad = 15
    expect(tbodyRows.length).toBe(15);
  });

  it("renders 3 kolonner per rad (IN, OUT, Sum) + maskin-navn", () => {
    openSettlementBreakdownModal({
      agentUserId: "agent-1",
      agentName: "Agent",
      hallName: "Hall A",
      businessDate: "2026-04-24",
    });
    const header = document.querySelectorAll("#sb-table thead th");
    expect(header.length).toBe(4); // navn + IN + OUT + Sum
  });

  it("Norsk Tipping Dag og Totalt er SEPARATE rader (begge inkluderes i total-rad)", () => {
    openSettlementBreakdownModal({
      existingSettlement: baseSettlement(),
      mode: "view",
      agentUserId: "agent-1",
      agentName: "Agent",
      hallName: "Hall A",
      businessDate: "2026-04-24",
    });
    expect(document.querySelector('tr[data-row-key="norsk_tipping_dag"]')).not.toBeNull();
    expect(document.querySelector('tr[data-row-key="norsk_tipping_totall"]')).not.toBeNull();
    expect(document.querySelector('tr[data-row-key="rikstoto_dag"]')).not.toBeNull();
    expect(document.querySelector('tr[data-row-key="rikstoto_totall"]')).not.toBeNull();

    const totalInCell = document.querySelector<HTMLElement>("#sb-total-in");
    // 100+75+50+40+60+30+70+5+20 = 450 NOK → 450.00 kr (bilag/bank/others = 0)
    expect(totalInCell?.textContent).toContain("450.00");
  });
});

describe("SettlementBreakdownModal — shift-delta live calculation", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    document.body.className = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("calculateShiftDelta: difference = start_til_slut - drop_safe - ending", () => {
    const r1 = calculateShiftDelta({
      shiftStartToEndCents: 100_000,
      innskuddDropSafeCents: 30_000,
      endingOpptallKassieCents: 60_000,
    });
    expect(r1.differenceInShiftsCents).toBe(10_000); // 100k - 30k - 60k = 10k
  });

  it("calculateShiftDelta: negative difference støttes (overlevering-underskudd)", () => {
    const r = calculateShiftDelta({
      shiftStartToEndCents: 50_000,
      innskuddDropSafeCents: 30_000,
      endingOpptallKassieCents: 25_000,
    });
    expect(r.differenceInShiftsCents).toBe(-5_000);
  });

  it("live oppdatering av #sb-diff når drop-safe endres", () => {
    openSettlementBreakdownModal({
      existingSettlement: baseSettlement(),
      mode: "edit",
      shiftId: "shift-1",
      agentUserId: "agent-1",
      agentName: "Agent",
      hallName: "Hall A",
      businessDate: "2026-04-24",
    });
    const diffInput = document.querySelector<HTMLInputElement>("#sb-diff");
    const dropInput = document.querySelector<HTMLInputElement>("#sb-drop");
    const startInput = document.querySelector<HTMLInputElement>("#sb-start-end");
    const endingInput = document.querySelector<HTMLInputElement>("#sb-ending");
    expect(diffInput).not.toBeNull();
    expect(dropInput).not.toBeNull();
    expect(startInput).not.toBeNull();
    expect(endingInput).not.toBeNull();

    // Simuler bruker endrer drop-safe: start=1500 NOK, drop=300, ending=500 -> diff = 1500 - 300 - 500 = 700
    startInput!.value = "1500.00";
    startInput!.dispatchEvent(new Event("input", { bubbles: true }));
    dropInput!.value = "300.00";
    dropInput!.dispatchEvent(new Event("input", { bubbles: true }));
    endingInput!.value = "500.00";
    endingInput!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(diffInput!.value).toBe("700.00");
  });

  it("difference-feltet er read-only (bruker kan ikke overstyre)", () => {
    openSettlementBreakdownModal({
      agentUserId: "agent-1",
      agentName: "Agent",
      hallName: "Hall A",
      businessDate: "2026-04-24",
    });
    const diffInput = document.querySelector<HTMLInputElement>("#sb-diff");
    expect(diffInput).not.toBeNull();
    expect(diffInput!.readOnly).toBe(true);
  });
});

describe("SettlementBreakdownModal — submit-button sichtbarkeit pr modus", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    document.body.className = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mode=create: Submit-knapp er synlig", () => {
    openSettlementBreakdownModal({
      agentUserId: "agent-1",
      agentName: "Agent",
      hallName: "Hall A",
      businessDate: "2026-04-24",
    });
    const footer = document.querySelector(".modal-footer");
    // i18n: "Send inn" (no) eller "Submit" (en)
    expect(footer?.textContent?.toLowerCase()).toMatch(/submit|send inn/);
    const buttons = footer?.querySelectorAll("button") ?? [];
    // Minst 2: cancel + submit
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it("mode=edit: Lagre-knapp og grunn-felt er synlig", () => {
    openSettlementBreakdownModal({
      existingSettlement: baseSettlement(),
      mode: "edit",
      shiftId: "shift-1",
      agentUserId: "agent-1",
      agentName: "Agent",
      hallName: "Hall A",
      businessDate: "2026-04-24",
    });
    expect(document.querySelector("#sb-edit-reason")).not.toBeNull();
    const footer = document.querySelector(".modal-footer");
    expect(footer?.textContent?.toLowerCase()).toMatch(/save|lagre/);
  });

  it("mode=view: ingen submit-knapp, alle inputs disabled", () => {
    openSettlementBreakdownModal({
      existingSettlement: baseSettlement(),
      mode: "view",
      agentUserId: "agent-1",
      agentName: "Agent",
      hallName: "Hall A",
      businessDate: "2026-04-24",
    });
    const footer = document.querySelector(".modal-footer");
    // Kun cancel-knapp
    const buttons = footer?.querySelectorAll("button") ?? [];
    expect(buttons.length).toBe(1);
    // Rad-inputs er disabled
    const firstRowIn = document.querySelector<HTMLInputElement>(
      'input[data-field="in"][data-key="metronia"]'
    );
    expect(firstRowIn?.disabled).toBe(true);
  });
});

describe("SettlementBreakdownModal — bilag upload validation", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    document.body.className = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("file-input har riktig accept-attribut (PDF/JPG/PNG)", () => {
    openSettlementBreakdownModal({
      agentUserId: "agent-1",
      agentName: "Agent",
      hallName: "Hall A",
      businessDate: "2026-04-24",
    });
    const fileInput = document.querySelector<HTMLInputElement>("#sb-bilag-file");
    expect(fileInput).not.toBeNull();
    expect(fileInput!.accept).toContain("application/pdf");
    expect(fileInput!.accept).toContain("image/jpeg");
    expect(fileInput!.accept).toContain("image/png");
  });

  it("prefill viser eksisterende bilag-filnavn når settlement har bilag", () => {
    const s = baseSettlement();
    s.bilagReceipt = {
      mime: "image/jpeg",
      filename: "kvittering.jpg",
      dataUrl: "data:image/jpeg;base64,AAA=",
      sizeBytes: 1234,
      uploadedAt: "2026-04-24T10:00:00Z",
      uploadedByUserId: "agent-1",
    };
    openSettlementBreakdownModal({
      existingSettlement: s,
      mode: "view",
      agentUserId: "agent-1",
      agentName: "Agent",
      hallName: "Hall A",
      businessDate: "2026-04-24",
    });
    const status = document.querySelector("#sb-bilag-status");
    expect(status?.textContent).toContain("kvittering.jpg");
  });
});

describe("SettlementPage — edit-action åpner full breakdown modal", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    document.body.className = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("klikk på edit-knapp trigger henting av settlement + åpner modal i edit-modus", async () => {
    const { renderSettlementPage } = await import(
      "../src/pages/hallAccountReport/SettlementPage.js"
    );

    let callCount = 0;
    globalThis.fetch = (async (url: unknown) => {
      callCount++;
      const u = String(url);
      if (u.includes("/api/admin/shifts/settlements")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              settlements: [baseSettlement()],
              limit: 200,
              offset: 0,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (u.includes("/api/admin/shifts/shift-1/settlement")) {
        return new Response(
          JSON.stringify({ ok: true, data: baseSettlement() }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    const c = document.createElement("div");
    document.body.append(c);
    await renderSettlementPage(c, "hall-a");

    const editBtn = c.querySelector<HTMLButtonElement>(
      'button[data-act="edit"][data-shift="shift-1"]'
    );
    expect(editBtn).not.toBeNull();
    editBtn!.click();
    // Vent 1 mikrotask for getSettlement
    await new Promise((r) => setTimeout(r, 20));

    // Modal burde være åpen med breakdown-klassen
    const modal = document.querySelector(".modal-settlement-breakdown");
    expect(modal).not.toBeNull();
    // Edit-reason felt skal finnes
    expect(document.querySelector("#sb-edit-reason")).not.toBeNull();
    expect(callCount).toBeGreaterThanOrEqual(2); // list + get
  });
});
