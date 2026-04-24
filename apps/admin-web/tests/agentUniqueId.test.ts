// Wireframe gaps #8/#10/#11 (2026-04-24): Agent Unique ID UI tests.
//
// Covers the four modals (Create, Add Money, Withdraw) and the Details view
// (with Re-Generate). Pure DOM assertions — fetch is mocked.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initI18n, t } from "../src/i18n/I18n.js";
import {
  buildCreateUniqueIdForm,
  openCreateUniqueIdModal,
} from "../src/pages/agent-portal/unique-id/CreateUniqueIdModal.js";
import {
  buildAddMoneyForm,
  openAddMoneyUniqueIdModal,
} from "../src/pages/agent-portal/unique-id/AddMoneyUniqueIdModal.js";
import {
  buildWithdrawForm,
  openWithdrawUniqueIdModal,
} from "../src/pages/agent-portal/unique-id/WithdrawUniqueIdModal.js";
import {
  renderDetailsHtml,
  mountUniqueIdDetailsView,
} from "../src/pages/agent-portal/unique-id/UniqueIdDetailsView.js";
import type {
  UniqueIdCard,
  UniqueIdDetailsResponse,
  UniqueIdTransaction,
} from "../src/api/agent-unique-ids.js";

function mockFetch(response: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: status < 400, data: response }), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFetchError(code: string, message: string, status = 400): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: false, error: { code, message } }), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

const CARD: UniqueIdCard = {
  id: "123456789",
  hallId: "hall-a",
  balanceCents: 17_000,
  purchaseDate: "2026-04-24T12:00:00Z",
  expiryDate: "2026-04-25T12:00:00Z",
  hoursValidity: 24,
  paymentType: "CASH",
  createdByAgentId: "agent-1",
  printedAt: "2026-04-24T12:00:00Z",
  reprintedCount: 0,
  lastReprintedAt: null,
  lastReprintedBy: null,
  status: "ACTIVE",
  regeneratedFromId: null,
  createdAt: "2026-04-24T12:00:00Z",
  updatedAt: "2026-04-24T12:00:00Z",
};

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.localStorage.setItem("bingo_admin_access_token", "tok");
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ───────── CreateUniqueIdModal ─────────

describe("CreateUniqueIdModal", () => {
  it("form has required fields (purchase, hours, expiry, amount, payment)", () => {
    const form = buildCreateUniqueIdForm();
    expect(form.querySelector('[data-testid="purchase-date"]')).toBeTruthy();
    expect(form.querySelector('[data-testid="hours-validity"]')).toBeTruthy();
    expect(form.querySelector('[data-testid="expiry-date"]')).toBeTruthy();
    expect(form.querySelector('[data-testid="amount"]')).toBeTruthy();
    expect(form.querySelector('[data-testid="payment-type"]')).toBeTruthy();
  });

  it("recomputes expiry when hours changes", () => {
    const form = buildCreateUniqueIdForm();
    const hoursEl = form.querySelector<HTMLInputElement>("#cuid-hours")!;
    const expiryEl = form.querySelector<HTMLInputElement>("#cuid-expiry")!;
    const before = expiryEl.value;
    hoursEl.value = "48";
    hoursEl.dispatchEvent(new Event("input"));
    expect(expiryEl.value).not.toBe(before);
    expect(expiryEl.value).toBeTruthy();
  });

  it("PRINT button rejects hours < 24", async () => {
    const fetchMock = mockFetch({});
    openCreateUniqueIdModal({ hallId: "hall-a" });
    const form = document.querySelector<HTMLElement>('[data-testid="create-unique-id-form"]')!;
    const hoursEl = form.querySelector<HTMLInputElement>("#cuid-hours")!;
    const amountEl = form.querySelector<HTMLInputElement>("#cuid-amount")!;
    hoursEl.value = "12";
    amountEl.value = "100";
    const printBtn = document.querySelector<HTMLButtonElement>('button[data-action="print"]')!;
    printBtn.click();
    await flushMicrotasks();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PRINT button submits with correct payload on success", async () => {
    const fetchMock = mockFetch({
      card: { ...CARD, balanceCents: 25_000 },
      transaction: { id: "tx-1", uniqueId: CARD.id, actionType: "CREATE", amountCents: 25_000, previousBalance: 0, newBalance: 25_000, paymentType: "CASH", agentUserId: "a", gameType: null, reason: null, createdAt: "" },
    });
    const onSuccess = vi.fn();
    openCreateUniqueIdModal({ hallId: "hall-a", onSuccess });
    const form = document.querySelector<HTMLElement>('[data-testid="create-unique-id-form"]')!;
    (form.querySelector<HTMLInputElement>("#cuid-hours")!).value = "24";
    (form.querySelector<HTMLInputElement>("#cuid-amount")!).value = "250";
    (form.querySelector<HTMLSelectElement>("#cuid-payment")!).value = "CASH";
    const printBtn = document.querySelector<HTMLButtonElement>('button[data-action="print"]')!;
    printBtn.click();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/agent/unique-ids");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ hallId: "hall-a", amount: 250, hoursValidity: 24, paymentType: "CASH" });
    expect(onSuccess).toHaveBeenCalled();
  });
});

// ───────── AddMoneyUniqueIdModal ─────────

describe("AddMoneyUniqueIdModal", () => {
  it("form has Unique ID input, amount, payment-type", () => {
    const form = buildAddMoneyForm("");
    expect(form.querySelector('[data-testid="unique-id-input"]')).toBeTruthy();
    expect(form.querySelector('[data-testid="amount"]')).toBeTruthy();
    expect(form.querySelector('[data-testid="payment-type"]')).toBeTruthy();
  });

  it("pre-fills Unique ID when initialId is provided", () => {
    const form = buildAddMoneyForm("123456789");
    const uidInput = form.querySelector<HTMLInputElement>('[data-testid="unique-id-input"]')!;
    expect(uidInput.value).toBe("123456789");
  });

  it("Confirm button posts to /add-money with accumulating amount", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = mockFetch({
      card: { ...CARD, balanceCents: 37_000 },
      transaction: { id: "tx", uniqueId: CARD.id, actionType: "ADD_MONEY", amountCents: 20_000, previousBalance: 17_000, newBalance: 37_000, paymentType: "CASH", agentUserId: "a", gameType: null, reason: null, createdAt: "" },
    });
    openAddMoneyUniqueIdModal({ initialId: CARD.id });
    const form = document.querySelector<HTMLElement>('[data-testid="add-money-form"]')!;
    (form.querySelector<HTMLInputElement>('[data-testid="amount"]')!).value = "200";
    (form.querySelector<HTMLSelectElement>('[data-testid="payment-type"]')!).value = "CASH";
    const confirmBtn = document.querySelector<HTMLButtonElement>('button[data-action="confirm"]')!;
    confirmBtn.click();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/agent/unique-ids/${CARD.id}/add-money`);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ amount: 200, paymentType: "CASH" });
  });

  it("aborts submit when user cancels the confirm dialog", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = mockFetch({ card: CARD, transaction: {} });
    openAddMoneyUniqueIdModal({ initialId: CARD.id });
    const form = document.querySelector<HTMLElement>('[data-testid="add-money-form"]')!;
    (form.querySelector<HTMLInputElement>('[data-testid="amount"]')!).value = "100";
    const confirmBtn = document.querySelector<HTMLButtonElement>('button[data-action="confirm"]')!;
    confirmBtn.click();
    await flushMicrotasks();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ───────── WithdrawUniqueIdModal ─────────

describe("WithdrawUniqueIdModal", () => {
  it("form shows readonly Unique ID and current balance", () => {
    const form = buildWithdrawForm(CARD);
    const uid = form.querySelector<HTMLInputElement>('[data-testid="unique-id-input"]')!;
    const bal = form.querySelector<HTMLInputElement>('[data-testid="current-balance"]')!;
    expect(uid.value).toBe(CARD.id);
    expect(uid.readOnly).toBe(true);
    expect(bal.value).toBe("170.00");
    expect(bal.readOnly).toBe(true);
  });

  it("renders cash-only hint", () => {
    const form = buildWithdrawForm(CARD);
    const hint = form.querySelector('[data-testid="cash-only-hint"]');
    expect(hint?.textContent).toContain(t("agent_unique_id_cash_only_hint"));
  });

  it("Withdraw button posts paymentType=CASH only", async () => {
    const fetchMock = mockFetch({
      card: { ...CARD, balanceCents: 7_000 },
      transaction: { id: "tx", uniqueId: CARD.id, actionType: "WITHDRAW", amountCents: 10_000, previousBalance: 17_000, newBalance: 7_000, paymentType: "CASH", agentUserId: "a", gameType: null, reason: null, createdAt: "" },
    });
    openWithdrawUniqueIdModal({ uniqueId: CARD.id, card: CARD });
    await flushMicrotasks();
    const form = document.querySelector<HTMLElement>('[data-testid="withdraw-form"]')!;
    (form.querySelector<HTMLInputElement>('[data-testid="amount"]')!).value = "100";
    const withdrawBtn = document.querySelector<HTMLButtonElement>('button[data-action="withdraw"]')!;
    withdrawBtn.click();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/agent/unique-ids/${CARD.id}/withdraw`);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ amount: 100, paymentType: "CASH" });
  });

  it("rejects amount > balance client-side", async () => {
    const fetchMock = mockFetch({});
    openWithdrawUniqueIdModal({ uniqueId: CARD.id, card: CARD });
    await flushMicrotasks();
    const form = document.querySelector<HTMLElement>('[data-testid="withdraw-form"]')!;
    (form.querySelector<HTMLInputElement>('[data-testid="amount"]')!).value = "999";
    const withdrawBtn = document.querySelector<HTMLButtonElement>('button[data-action="withdraw"]')!;
    withdrawBtn.click();
    await flushMicrotasks();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ───────── UniqueIdDetailsView ─────────

describe("UniqueIdDetailsView", () => {
  it("renderDetailsHtml shows card metadata + game-filter dropdown", () => {
    const tx: UniqueIdTransaction = {
      id: "tx-1", uniqueId: CARD.id, actionType: "CREATE",
      amountCents: 17_000, previousBalance: 0, newBalance: 17_000,
      paymentType: "CASH", agentUserId: "a", gameType: "game-1",
      reason: null, createdAt: "2026-04-24T12:00:00Z",
    };
    const details: UniqueIdDetailsResponse = {
      card: CARD,
      transactions: [tx],
      gameHistory: [tx],
    };
    const html = renderDetailsHtml(details, null, ["game-1", "game-2"]);
    expect(html).toContain(CARD.id);
    expect(html).toContain("data-testid=\"game-type-filter\"");
    expect(html).toContain("170.00"); // balance
    expect(html).toContain("game-1");
    expect(html).toContain("game-2");
    expect(html).toContain("data-testid=\"btn-regenerate\"");
    expect(html).toContain("data-testid=\"btn-reprint\"");
  });

  it("Re-Generate button is disabled on non-ACTIVE cards", () => {
    const withdrawnCard = { ...CARD, status: "WITHDRAWN" as const };
    const details: UniqueIdDetailsResponse = { card: withdrawnCard, transactions: [], gameHistory: [] };
    const html = renderDetailsHtml(details, null, []);
    expect(html).toMatch(/data-action="regenerate"[^>]*disabled/);
  });

  it("mount fetches details and wires Regenerate click", async () => {
    const details: UniqueIdDetailsResponse = {
      card: CARD,
      transactions: [],
      gameHistory: [],
    };
    mockFetch(details);
    const host = document.createElement("div");
    document.body.append(host);
    await mountUniqueIdDetailsView(host, CARD.id, { gameTypes: ["game-1"] });
    await flushMicrotasks();
    expect(host.querySelector('[data-testid="unique-id-details"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="status-badge"]')?.textContent?.trim())
      .toBe(t("agent_unique_id_status_active"));
  });

  it("Reprint success shows count in button label after reload", async () => {
    // First call: initial details. Second call: reprint POST. Third call: reload.
    const initial: UniqueIdDetailsResponse = { card: CARD, transactions: [], gameHistory: [] };
    const afterReprint: UniqueIdDetailsResponse = {
      card: { ...CARD, reprintedCount: 1 },
      transactions: [],
      gameHistory: [],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: initial })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { card: afterReprint.card, transaction: {} } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: afterReprint })));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    const host = document.createElement("div");
    document.body.append(host);
    await mountUniqueIdDetailsView(host, CARD.id);
    await flushMicrotasks();
    const reprintBtn = host.querySelector<HTMLButtonElement>('[data-testid="btn-reprint"]')!;
    reprintBtn.click();
    await flushMicrotasks();
    const after = host.querySelector<HTMLButtonElement>('[data-testid="btn-reprint"]')!;
    expect(after.textContent).toContain("(1)");
  });
});

// ───────── API error-mapping ─────────

describe("API error handling", () => {
  it("Add Money surfaces UNIQUE_ID_NOT_FOUND message to the user", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetchError("UNIQUE_ID_NOT_FOUND", "Unique ID not found.", 400);
    openAddMoneyUniqueIdModal({ initialId: "999999999" });
    const form = document.querySelector<HTMLElement>('[data-testid="add-money-form"]')!;
    (form.querySelector<HTMLInputElement>('[data-testid="amount"]')!).value = "50";
    const confirmBtn = document.querySelector<HTMLButtonElement>('button[data-action="confirm"]')!;
    confirmBtn.click();
    await flushMicrotasks();
    const toast = document.querySelector("#toast-container .alert-danger");
    expect(toast?.textContent).toContain("Unique ID not found");
  });

  it("Withdraw surfaces PAYMENT_TYPE_NOT_ALLOWED when backend rejects non-cash", async () => {
    mockFetchError(
      "PAYMENT_TYPE_NOT_ALLOWED",
      "Only cash payment is allowed for unique ID withdrawal.",
      400
    );
    openWithdrawUniqueIdModal({ uniqueId: CARD.id, card: CARD });
    await flushMicrotasks();
    const form = document.querySelector<HTMLElement>('[data-testid="withdraw-form"]')!;
    (form.querySelector<HTMLInputElement>('[data-testid="amount"]')!).value = "50";
    const withdrawBtn = document.querySelector<HTMLButtonElement>('button[data-action="withdraw"]')!;
    withdrawBtn.click();
    await flushMicrotasks();
    const toast = document.querySelector("#toast-container .alert-danger");
    expect(toast?.textContent).toContain("Only cash payment");
  });
});
