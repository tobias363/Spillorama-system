// Hall Management: list + Add Money modal smoke-test.
//
// Dekker:
//   - renderHallListPage fetch-er `/api/admin/halls` og viser Hall Number +
//     Available Balance-kolonner.
//   - `+`-action åpner Modal med current balance.
//   - Submit med positiv amount treffer POST /api/admin/halls/:id/add-money
//     med korrekt payload og lukker modalen.
//   - Submit med 0 eller negativt beløp blokkerer backend-kallet.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { renderHallListPage } from "../src/pages/hall/HallListPage.js";
import type { AdminHall } from "../src/api/admin-halls.js";

type FetchCall = { url: string; init: RequestInit };

function mockApi(): { fetchFn: ReturnType<typeof vi.fn>; calls: FetchCall[]; queue: Array<{ body: unknown; status?: number }> } {
  const calls: FetchCall[] = [];
  const queue: Array<{ body: unknown; status?: number }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn: any = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const next = queue.shift();
    if (!next) {
      return new Response(JSON.stringify({ ok: true, data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return { fetchFn: fn, calls, queue };
}

function tick(ms = 0): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const SAMPLE_HALL: AdminHall = {
  id: "hall-1",
  slug: "oslo-sentrum",
  name: "Oslo Sentrum",
  region: "NO",
  address: "Karl Johans gate 1",
  isActive: true,
  clientVariant: "web",
  hallNumber: 101,
  cashBalance: 3000,
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
};

describe("HallListPage", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  it("renders Hall Number and Available Balance columns with correct values", async () => {
    const { queue } = mockApi();
    queue.push({ body: { ok: true, data: [SAMPLE_HALL] } });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHallListPage(root);

    // wait for fetch + render
    for (let i = 0; i < 10 && !root.querySelector("table"); i++) {
      await tick(5);
    }

    const table = root.querySelector("table")!;
    expect(table).toBeTruthy();
    const headerCells = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim());
    expect(headerCells).toContain("Hallnummer");
    expect(headerCells).toContain("Tilgjengelig saldo");

    const rowCells = Array.from(table.querySelectorAll("tbody td")).map((td) => td.textContent?.trim());
    // Hall number = 101 vises som tekst
    expect(rowCells.some((c) => c === "101")).toBe(true);
    // "kr 3 000" eller "kr 3000" (space er non-breaking i Intl)
    expect(rowCells.some((c) => c?.replace(/\s/g, "").startsWith("kr3000"))).toBe(true);
  });

  it("`+` action opens Add Money modal showing current balance", async () => {
    const { queue } = mockApi();
    queue.push({ body: { ok: true, data: [SAMPLE_HALL] } });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHallListPage(root);
    for (let i = 0; i < 10 && !root.querySelector("table"); i++) {
      await tick(5);
    }

    const addMoneyBtn = root.querySelector<HTMLButtonElement>('button[data-action="add-money"]')!;
    expect(addMoneyBtn).toBeTruthy();
    addMoneyBtn.click();

    const modal = document.querySelector<HTMLElement>(".modal")!;
    expect(modal).toBeTruthy();
    expect(modal.querySelector(".modal-title")?.textContent?.trim()).toBe("Legg til penger");

    const currentBalance = modal.querySelector('[data-testid="add-money-current-balance"]');
    // Intl.NumberFormat kan injisere non-breaking space — sjekk siffer-sekvensen.
    expect(currentBalance?.textContent?.replace(/\s/g, "")).toContain("3000");

    const amountInput = modal.querySelector<HTMLInputElement>('[data-testid="add-money-amount"]');
    expect(amountInput).toBeTruthy();
    const cancelBtn = modal.querySelector<HTMLButtonElement>('button[data-action="cancel"]');
    const addBtn = modal.querySelector<HTMLButtonElement>('button[data-action="add"]');
    expect(cancelBtn).toBeTruthy();
    expect(addBtn).toBeTruthy();
  });

  it("submitting positive amount POSTs to /add-money endpoint and closes modal", async () => {
    const { queue, calls, fetchFn } = mockApi();
    // Initial list
    queue.push({ body: { ok: true, data: [SAMPLE_HALL] } });
    // Add money response
    queue.push({
      body: {
        ok: true,
        data: {
          hallId: "hall-1",
          amount: 500,
          previousBalance: 3000,
          balanceAfter: 3500,
          transaction: { id: "tx-1", txType: "MANUAL_ADJUSTMENT", direction: "CREDIT" },
        },
      },
    });
    // Refresh after success
    queue.push({ body: { ok: true, data: [{ ...SAMPLE_HALL, cashBalance: 3500 }] } });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHallListPage(root);
    for (let i = 0; i < 10 && !root.querySelector("table"); i++) {
      await tick(5);
    }
    expect(fetchFn).toHaveBeenCalled();

    // Open modal
    root.querySelector<HTMLButtonElement>('button[data-action="add-money"]')!.click();
    const modal = document.querySelector<HTMLElement>(".modal")!;
    const amountInput = modal.querySelector<HTMLInputElement>('[data-testid="add-money-amount"]')!;
    const reasonInput = modal.querySelector<HTMLInputElement>('[data-testid="add-money-reason"]')!;
    amountInput.value = "500";
    reasonInput.value = "Skift-start";

    // Click Add
    const addBtn = modal.querySelector<HTMLButtonElement>('button[data-action="add"]')!;
    addBtn.click();

    // Wait for POST + refresh
    for (let i = 0; i < 20 && calls.length < 3; i++) {
      await tick(5);
    }

    // Find the add-money POST call
    const postCall = calls.find((c) => c.url.includes("/add-money"));
    expect(postCall).toBeTruthy();
    expect(postCall!.init.method).toBe("POST");
    const body = JSON.parse(String(postCall!.init.body));
    expect(body.amount).toBe(500);
    expect(body.reason).toBe("Skift-start");

    // Modal should have closed
    expect(document.querySelector(".modal")).toBeFalsy();
  });

  it("rejects amount <= 0 client-side without hitting backend", async () => {
    const { queue, calls } = mockApi();
    queue.push({ body: { ok: true, data: [SAMPLE_HALL] } });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHallListPage(root);
    for (let i = 0; i < 10 && !root.querySelector("table"); i++) {
      await tick(5);
    }

    root.querySelector<HTMLButtonElement>('button[data-action="add-money"]')!.click();
    const modal = document.querySelector<HTMLElement>(".modal")!;
    const amountInput = modal.querySelector<HTMLInputElement>('[data-testid="add-money-amount"]')!;
    const addBtn = modal.querySelector<HTMLButtonElement>('button[data-action="add"]')!;

    // Amount = 0
    amountInput.value = "0";
    addBtn.click();
    await tick(5);
    const hasPostCall = calls.some((c) => c.url.includes("/add-money"));
    expect(hasPostCall).toBe(false);
    // Modal is still open
    expect(document.querySelector(".modal")).toBeTruthy();

    // Amount = negativ
    amountInput.value = "-100";
    addBtn.click();
    await tick(5);
    expect(calls.some((c) => c.url.includes("/add-money"))).toBe(false);

    // Amount = tom
    amountInput.value = "";
    addBtn.click();
    await tick(5);
    expect(calls.some((c) => c.url.includes("/add-money"))).toBe(false);
  });

  it("handles hall without hallNumber (null) as '—'", async () => {
    const { queue } = mockApi();
    queue.push({
      body: {
        ok: true,
        data: [{ ...SAMPLE_HALL, hallNumber: null, cashBalance: 0 }],
      },
    });

    const root = document.createElement("div");
    document.body.appendChild(root);
    renderHallListPage(root);
    for (let i = 0; i < 10 && !root.querySelector("table"); i++) {
      await tick(5);
    }

    const rowCells = Array.from(root.querySelectorAll("tbody td")).map((td) => td.textContent?.trim());
    expect(rowCells).toContain("—");
    expect(rowCells.some((c) => c?.replace(/\s/g, "") === "kr0")).toBe(true);
  });
});
