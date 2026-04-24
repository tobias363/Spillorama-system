// Wireframe 17.7 + 17.8 — tester for Add-Money / Withdraw Registered User
// modaler. Fokus: rendering, autocomplete-debounce, balance-display etter
// bruker-valg, submit-flow med Yes-confirm, og CONFIRMATION_REQUIRED-retry
// for uttak > 10 000 NOK.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { openAddMoneyRegisteredUserModal } from "../src/pages/cash-inout/modals/AddMoneyRegisteredUserModal.js";
import { openWithdrawRegisteredUserModal } from "../src/pages/cash-inout/modals/WithdrawRegisteredUserModal.js";
import type { AgentUserSearchRow } from "../src/api/agent-cash.js";

interface Route {
  match: RegExp;
  method?: string;
  handler: (url: string, init: RequestInit | undefined) => unknown;
  status?: number;
}

function mockApiRouter(routes: Route[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  fn.mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const route = routes.find(
      (r) => r.match.test(url) && (r.method === undefined || r.method === method),
    );
    if (!route) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_MOCKED", message: url } }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    const body = route.handler(url, init);
    const status = route.status ?? 200;
    const ok = status < 400;
    const payload = ok
      ? { ok: true, data: body }
      : (body as Record<string, unknown>);
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

/** Vent på debounce-timer (300 ms). */
async function waitForDebounce(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 320));
  await tick();
}

const SAMPLE_USERS: AgentUserSearchRow[] = [
  { id: "p-alice", email: "alice@test.no", displayName: "Alice", phone: null, walletBalance: 500 },
  { id: "p-bob", email: "bob@test.no", displayName: "Bob", phone: "99887766", walletBalance: 150 },
];

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  window.localStorage.setItem("bingo_admin_access_token", "tok");
});

describe("AddMoneyRegisteredUserModal (WF 17.7)", () => {
  it("renderer modal med username + amount + paymentType", () => {
    mockApiRouter([]);
    openAddMoneyRegisteredUserModal();
    expect(document.querySelector("#am-username")).toBeTruthy();
    expect(document.querySelector("#am-amount")).toBeTruthy();
    expect(document.querySelector<HTMLSelectElement>("#am-paymentType")).toBeTruthy();
    const opts = Array.from(document.querySelectorAll<HTMLOptionElement>("#am-paymentType option")).map((o) => o.value);
    expect(opts).toEqual(["Cash", "Card"]);
  });

  it("autocomplete-debounce — kaller search kun én gang for rask input", async () => {
    const api = mockApiRouter([
      {
        match: /\/api\/agent\/transactions\/search-users/,
        method: "GET",
        handler: () => ({ users: SAMPLE_USERS, query: "a" }),
      },
    ]);
    openAddMoneyRegisteredUserModal();
    const input = document.querySelector<HTMLInputElement>("#am-username")!;
    input.value = "a";
    input.dispatchEvent(new Event("input"));
    input.value = "al";
    input.dispatchEvent(new Event("input"));
    input.value = "ali";
    input.dispatchEvent(new Event("input"));
    // Før debounce: ingen kall.
    expect(api.mock.calls.length).toBe(0);
    await waitForDebounce();
    // Etter debounce: ett samlet kall.
    expect(api.mock.calls.length).toBe(1);
  });

  it("viser autocomplete-dropdown og fyller username + balance ved valg", async () => {
    mockApiRouter([
      {
        match: /search-users/,
        method: "GET",
        handler: () => ({ users: SAMPLE_USERS, query: "alice" }),
      },
    ]);
    openAddMoneyRegisteredUserModal();
    const input = document.querySelector<HTMLInputElement>("#am-username")!;
    input.value = "alice";
    input.dispatchEvent(new Event("input"));
    await waitForDebounce();
    const dropdown = document.querySelector<HTMLDivElement>("#am-autocomplete");
    expect(dropdown).toBeTruthy();
    expect(dropdown!.style.display).toBe("block");
    const aliceRow = dropdown!.querySelector<HTMLAnchorElement>('[data-user-id="p-alice"]');
    expect(aliceRow).toBeTruthy();
    aliceRow!.click();
    expect(input.value).toBe("Alice");
    const balanceText = document.querySelector("#am-balance-result")!.textContent!;
    expect(balanceText).toContain("500.00");
    // Dropdown er lukket etter valg.
    expect(dropdown!.style.display).toBe("none");
  });

  it("AML-warn vises kun når amount > 10 000", async () => {
    mockApiRouter([]);
    openAddMoneyRegisteredUserModal();
    const amount = document.querySelector<HTMLInputElement>("#am-amount")!;
    const warn = document.querySelector<HTMLElement>("#am-aml-warn")!;
    amount.value = "5000";
    amount.dispatchEvent(new Event("input"));
    expect(warn.style.display).toBe("none");
    amount.value = "10001";
    amount.dispatchEvent(new Event("input"));
    expect(warn.style.display).toBe("block");
  });

  it("submit-flow — Yes-confirm → POST add-money-user", async () => {
    const api = mockApiRouter([
      {
        match: /search-users/,
        method: "GET",
        handler: () => ({ users: [SAMPLE_USERS[0]!], query: "alice" }),
      },
      {
        match: /\/api\/agent\/transactions\/add-money-user/,
        method: "POST",
        handler: (_url, init) => {
          const body = JSON.parse(String(init?.body ?? "{}"));
          return {
            transaction: {
              id: "tx-1",
              actionType: "CASH_IN",
              amount: body.amount,
              paymentMethod: "CASH",
              previousBalance: 500,
              afterBalance: 500 + body.amount,
              hallId: "hall-a",
              shiftId: "shift-1",
              createdAt: "2026-04-24T00:00:00Z",
            },
            amlFlagged: false,
          };
        },
      },
    ]);
    openAddMoneyRegisteredUserModal();
    const input = document.querySelector<HTMLInputElement>("#am-username")!;
    input.value = "alice";
    input.dispatchEvent(new Event("input"));
    await waitForDebounce();
    const aliceRow = document.querySelector<HTMLAnchorElement>('[data-user-id="p-alice"]')!;
    aliceRow.click();
    const amount = document.querySelector<HTMLInputElement>("#am-amount")!;
    amount.value = "200";
    amount.dispatchEvent(new Event("input"));
    // Klikk "Add Money"-knappen.
    const addBtn = document.querySelector<HTMLButtonElement>(".modal-footer [data-action='confirm']")!;
    addBtn.click();
    await tick();
    // Yes/No-confirm-modalen åpner seg — klikk "yes_add_money".
    const confirmModal = document.querySelectorAll<HTMLElement>(".modal")[1]!;
    const yesBtn = confirmModal.querySelector<HTMLButtonElement>("[data-action='confirm']")!;
    yesBtn.click();
    await tick(6);
    // POST-kallet ble gjort med riktig body.
    const postCall = api.mock.calls.find(([url, init]) => {
      return String(url).includes("add-money-user") && (init as RequestInit)?.method === "POST";
    });
    expect(postCall).toBeDefined();
    const body = JSON.parse(String((postCall![1] as RequestInit).body ?? "{}"));
    expect(body.targetUserId).toBe("p-alice");
    expect(body.amount).toBe(200);
    expect(body.paymentType).toBe("Cash");
    expect(typeof body.clientRequestId).toBe("string");
  });
});

describe("WithdrawRegisteredUserModal (WF 17.8)", () => {
  it("renderer modal med readonly balance + Cash-only paymentType", () => {
    mockApiRouter([]);
    openWithdrawRegisteredUserModal();
    const balance = document.querySelector<HTMLInputElement>("#wd-balance")!;
    expect(balance.readOnly).toBe(true);
    const payment = document.querySelector<HTMLSelectElement>("#wd-paymentType")!;
    expect(payment.disabled).toBe(true);
    const opts = Array.from(payment.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toEqual(["Cash"]);
  });

  it("fyller balance ved brukervalg + max-validering", async () => {
    mockApiRouter([
      {
        match: /search-users/,
        method: "GET",
        handler: () => ({ users: [SAMPLE_USERS[1]!], query: "bob" }),
      },
    ]);
    openWithdrawRegisteredUserModal();
    const input = document.querySelector<HTMLInputElement>("#wd-username")!;
    input.value = "bob";
    input.dispatchEvent(new Event("input"));
    await waitForDebounce();
    const bobRow = document.querySelector<HTMLAnchorElement>('[data-user-id="p-bob"]')!;
    bobRow.click();
    const balance = document.querySelector<HTMLInputElement>("#wd-balance")!;
    expect(balance.value).toBe("150.00 kr");
    const amount = document.querySelector<HTMLInputElement>("#wd-amount")!;
    amount.value = "200"; // over balance
    amount.dispatchEvent(new Event("input"));
    const warn = document.querySelector<HTMLElement>("#wd-amount-warn")!;
    expect(warn.style.display).toBe("block");
    amount.value = "100"; // under balance
    amount.dispatchEvent(new Event("input"));
    expect(warn.style.display).toBe("none");
  });

  it("uttak > 10 000 utløser CONFIRMATION_REQUIRED og retry med requireConfirm=true", async () => {
    const api = mockApiRouter([
      {
        match: /search-users/,
        method: "GET",
        handler: () => ({
          users: [{ ...SAMPLE_USERS[0]!, walletBalance: 20_000 }],
          query: "alice",
        }),
      },
      {
        match: /\/api\/agent\/transactions\/withdraw-user/,
        method: "POST",
        handler: (_url, init) => {
          const body = JSON.parse(String(init?.body ?? "{}"));
          if (body.requireConfirm === true) {
            return {
              transaction: {
                id: "tx-2",
                actionType: "CASH_OUT",
                amount: body.amount,
                paymentMethod: "CASH",
                previousBalance: 20_000,
                afterBalance: 20_000 - body.amount,
                hallId: "hall-a",
                shiftId: "shift-1",
                createdAt: "2026-04-24T00:00:00Z",
              },
              amlFlagged: true,
            };
          }
          // Uten flagget: 400 CONFIRMATION_REQUIRED.
          return { ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "ekstra bekreftelse kreves" } };
        },
        // status settes i handler via payload-shape ovenfor
      },
    ]);
    // Vi må styre 400-svaret spesifikt — overstyrer mock for første POST.
    let postCount = 0;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
      (url: string, init?: RequestInit) => {
        const u = String(url);
        const method = (init?.method ?? "GET").toUpperCase();
        if (u.includes("search-users")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                data: {
                  users: [{ ...SAMPLE_USERS[0]!, walletBalance: 20_000 }],
                  query: "alice",
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        if (u.includes("withdraw-user") && method === "POST") {
          postCount++;
          const body = JSON.parse(String(init?.body ?? "{}"));
          if (body.requireConfirm === true) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  ok: true,
                  data: {
                    transaction: {
                      id: "tx-2",
                      actionType: "CASH_OUT",
                      amount: body.amount,
                      paymentMethod: "CASH",
                      previousBalance: 20_000,
                      afterBalance: 20_000 - body.amount,
                      hallId: "hall-a",
                      shiftId: "shift-1",
                      createdAt: "2026-04-24T00:00:00Z",
                    },
                    amlFlagged: true,
                  },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: false,
                error: { code: "CONFIRMATION_REQUIRED", message: "ekstra bekreftelse" },
              }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: { code: "NOT_MOCKED" } }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    ) as unknown as typeof fetch;
    void api; // silence unused in this test

    openWithdrawRegisteredUserModal();
    const input = document.querySelector<HTMLInputElement>("#wd-username")!;
    input.value = "alice";
    input.dispatchEvent(new Event("input"));
    await waitForDebounce();
    document.querySelector<HTMLAnchorElement>('[data-user-id="p-alice"]')!.click();
    const amount = document.querySelector<HTMLInputElement>("#wd-amount")!;
    amount.value = "15000";
    amount.dispatchEvent(new Event("input"));
    document.querySelector<HTMLButtonElement>(".modal-footer [data-action='confirm']")!.click();
    await tick();
    // Yes-confirm for withdraw
    const yesBtn1 = document.querySelectorAll<HTMLButtonElement>("[data-action='confirm']")[1]!;
    yesBtn1.click();
    await tick(10);
    // Nå åpnes second-opinion-dialog (AML) — klikk yes
    const modals = document.querySelectorAll<HTMLElement>(".modal");
    const lastModal = modals[modals.length - 1]!;
    const yesBtn2 = lastModal.querySelector<HTMLButtonElement>("[data-action='confirm']")!;
    yesBtn2.click();
    await tick(10);
    // Backend ble kalt to ganger: første uten flagget, andre med.
    expect(postCount).toBe(2);
  });
});
