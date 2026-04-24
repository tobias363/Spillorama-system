// Wireframe Gap #9 (PDF 17.6): Shift Log Out-popup (2 checkboxer + View Details).
//
// Tester:
//   - mountAgentCashInOut rendrer Shift Log Out-knappen
//   - Klikk på knappen åpner en modal med 2 checkboxer + notes + view-link
//   - Submit uten avkrysning sender body { distributeWinnings: false, transferRegisterTickets: false }
//   - Submit med begge avkrysset sender body { distributeWinnings: true, transferRegisterTickets: true }
//   - "View Cashout Details"-lenke åpner sekundær modal som kaller /pending-cashouts
//   - Pending-liste: tom tilstand viser "ingen ventende"
//   - Pending-liste: rader rendres med dato, spill, mønster, beløp, bong-ID

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import { mountAgentCashInOut } from "../src/pages/agent-portal/AgentCashInOutPage.js";

function agentSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ag-1",
    name: "Agent",
    email: "a@x.no",
    role: "agent",
    isSuperAdmin: false,
    avatar: "",
    hall: [{ id: "hall-a", name: "Test Hall" }],
    dailyBalance: null,
    permissions: {},
    ...overrides,
  };
}

type Responder = (url: string, init: RequestInit | undefined) => { ok: boolean; data?: unknown; error?: { code: string; message: string } };

function mockApiRouter(routes: Array<{ match: RegExp; handler: Responder }>): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  fn.mockImplementation((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match.test(url));
    const body = route
      ? route.handler(url, init)
      : { ok: false, error: { code: "NOT_MOCKED", message: url } };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: body.ok ? 200 : 400,
        headers: { "Content-Type": "application/json" },
      })
    );
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  setSession(agentSession());
  window.localStorage.setItem("bingo_admin_access_token", "tok");
});

afterEach(() => {
  // Lukk alle modaler mellom testene for å unngå lekkasje.
  document.querySelectorAll(".modal, .modal-backdrop").forEach((el) => el.remove());
  document.body.classList.remove("modal-open");
});

describe("AgentCashInOutPage — rendering", () => {
  it("rendrer Shift Log Out-knappen", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentCashInOut(root);
    const btn = root.querySelector<HTMLButtonElement>('[data-action="shift-log-out"]');
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toContain("Logg ut skift");
  });

  it("ingen coming-soon-marker (full implementation)", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentCashInOut(root);
    expect(root.querySelector("[data-marker='coming-soon']")).toBeNull();
  });
});

describe("AgentCashInOutPage — Shift Log Out modal (logoutModal)", () => {
  it("klikk på Shift Log Out-knappen åpner modal med 2 checkboxer", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentCashInOut(root);
    const btn = root.querySelector<HTMLButtonElement>('[data-action="shift-log-out"]');
    btn!.click();
    const distributeCb = document.body.querySelector<HTMLInputElement>('[data-field="distributeWinnings"]');
    const transferCb = document.body.querySelector<HTMLInputElement>('[data-field="transferRegisterTickets"]');
    expect(distributeCb).toBeTruthy();
    expect(transferCb).toBeTruthy();
    expect(distributeCb!.type).toBe("checkbox");
    expect(transferCb!.type).toBe("checkbox");
    expect(distributeCb!.checked).toBe(false);
    expect(transferCb!.checked).toBe(false);
  });

  it("modalen har 'View Cashout Details'-lenke", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentCashInOut(root);
    root.querySelector<HTMLButtonElement>('[data-action="shift-log-out"]')!.click();
    const viewLink = document.body.querySelector('[data-action="view-cashout-details"]');
    expect(viewLink).toBeTruthy();
  });

  it("modalen har et notat-tekstfelt (valgfri)", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentCashInOut(root);
    root.querySelector<HTMLButtonElement>('[data-action="shift-log-out"]')!.click();
    const textarea = document.body.querySelector<HTMLTextAreaElement>('[data-field="logoutNotes"]');
    expect(textarea).toBeTruthy();
    expect(textarea!.tagName).toBe("TEXTAREA");
  });

  it("Confirm sender { distributeWinnings: false, transferRegisterTickets: false } uten avkrysning", async () => {
    let capturedBody: unknown = null;
    mockApiRouter([
      {
        match: /\/api\/agent\/shift\/logout$/,
        handler: (_url, init) => {
          capturedBody = JSON.parse(String(init?.body ?? "{}"));
          return {
            ok: true,
            data: {
              shift: { id: "s1", isActive: false, distributedWinnings: false, transferredRegisterTickets: false },
              pendingCashoutsFlagged: 0,
              ticketRangesFlagged: 0,
            },
          };
        },
      },
    ]);

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentCashInOut(root);
    root.querySelector<HTMLButtonElement>('[data-action="shift-log-out"]')!.click();
    const confirmBtn = document.body.querySelector<HTMLButtonElement>('[data-action="confirm-logout"]');
    expect(confirmBtn).toBeTruthy();
    confirmBtn!.click();
    await tick();
    expect(capturedBody).toEqual({ distributeWinnings: false, transferRegisterTickets: false });
  });

  it("Confirm sender begge flag=true når avkrysset", async () => {
    let capturedBody: unknown = null;
    mockApiRouter([
      {
        match: /\/api\/agent\/shift\/logout$/,
        handler: (_url, init) => {
          capturedBody = JSON.parse(String(init?.body ?? "{}"));
          return {
            ok: true,
            data: {
              shift: { id: "s1", isActive: false },
              pendingCashoutsFlagged: 2,
              ticketRangesFlagged: 1,
            },
          };
        },
      },
    ]);

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentCashInOut(root);
    root.querySelector<HTMLButtonElement>('[data-action="shift-log-out"]')!.click();
    document.body.querySelector<HTMLInputElement>('[data-field="distributeWinnings"]')!.checked = true;
    document.body.querySelector<HTMLInputElement>('[data-field="transferRegisterTickets"]')!.checked = true;
    document.body.querySelector<HTMLTextAreaElement>('[data-field="logoutNotes"]')!.value = "Overleverer";
    document.body.querySelector<HTMLButtonElement>('[data-action="confirm-logout"]')!.click();
    await tick();
    expect(capturedBody).toEqual({
      distributeWinnings: true,
      transferRegisterTickets: true,
      logoutNotes: "Overleverer",
    });
  });

  it("tomt notat-felt inkluderes ikke i body", async () => {
    let capturedBody: unknown = null;
    mockApiRouter([
      {
        match: /\/api\/agent\/shift\/logout$/,
        handler: (_url, init) => {
          capturedBody = JSON.parse(String(init?.body ?? "{}"));
          return { ok: true, data: { shift: {}, pendingCashoutsFlagged: 0, ticketRangesFlagged: 0 } };
        },
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentCashInOut(root);
    root.querySelector<HTMLButtonElement>('[data-action="shift-log-out"]')!.click();
    // Ikke sett verdi på textarea — forbli tom.
    document.body.querySelector<HTMLButtonElement>('[data-action="confirm-logout"]')!.click();
    await tick();
    expect(capturedBody).not.toHaveProperty("logoutNotes");
  });
});
