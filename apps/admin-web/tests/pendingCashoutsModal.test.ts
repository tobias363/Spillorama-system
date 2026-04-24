// Wireframe Gap #9 (PDF 17.6): PendingCashoutsModal (View Cashout Details).
//
// Tester:
//   - Modal kaller GET /api/agent/shift/pending-cashouts ved åpning
//   - Rendrer tabell med rader for hver pending
//   - Tom liste viser "ingen ventende"-melding
//   - admin_approval_required-flagg vises som label-warning

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import { openPendingCashoutsModal } from "../src/pages/agent-portal/PendingCashoutsModal.js";

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
    const body = route ? route.handler(url, init) : { ok: false, error: { code: "NOT_MOCKED", message: url } };
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

async function tick(rounds = 15): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(() => {
  initI18n();
  document.body.innerHTML = "";
  setSession(agentSession());
  window.localStorage.setItem("bingo_admin_access_token", "tok");
});

afterEach(() => {
  document.querySelectorAll(".modal, .modal-backdrop").forEach((el) => el.remove());
  document.body.classList.remove("modal-open");
});

describe("PendingCashoutsModal", () => {
  it("kaller /api/agent/shift/pending-cashouts ved åpning", async () => {
    const fn = mockApiRouter([
      {
        match: /\/api\/agent\/shift\/pending-cashouts/,
        handler: () => ({
          ok: true,
          data: { pendingCashouts: [], count: 0 },
        }),
      },
    ]);
    openPendingCashoutsModal();
    await tick();
    const call = fn.mock.calls.find((c) => String(c[0]).includes("/pending-cashouts"));
    expect(call).toBeTruthy();
  });

  it("viser 'ingen ventende'-melding når tom liste", async () => {
    mockApiRouter([
      {
        match: /\/api\/agent\/shift\/pending-cashouts/,
        handler: () => ({ ok: true, data: { pendingCashouts: [], count: 0 } }),
      },
    ]);
    openPendingCashoutsModal();
    await tick();
    const empty = document.body.querySelector("[data-marker='pending-empty']");
    expect(empty).toBeTruthy();
    expect(document.body.textContent).toContain("Ingen ventende cashouts");
  });

  it("rendrer tabell med én rad per pending cashout", async () => {
    mockApiRouter([
      {
        match: /\/api\/agent\/shift\/pending-cashouts/,
        handler: () => ({
          ok: true,
          data: {
            pendingCashouts: [
              {
                id: "p1",
                ticketId: "tkt-42",
                hallId: "hall-a",
                scheduledGameId: "game-7",
                patternPhase: "row_1",
                expectedPayoutCents: 25000,
                color: "large",
                detectedAt: "2026-04-24T12:00:00.000Z",
                verifiedAt: null,
                adminApprovalRequired: false,
              },
              {
                id: "p2",
                ticketId: "tkt-99",
                hallId: "hall-a",
                scheduledGameId: "game-7",
                patternPhase: "full_house",
                expectedPayoutCents: 600000,
                color: "large",
                detectedAt: "2026-04-24T11:00:00.000Z",
                verifiedAt: null,
                adminApprovalRequired: true,
              },
            ],
            count: 2,
          },
        }),
      },
    ]);
    openPendingCashoutsModal();
    await tick();
    const table = document.body.querySelector("[data-marker='pending-table']");
    expect(table).toBeTruthy();
    const rows = document.body.querySelectorAll("[data-marker='pending-table'] tbody tr");
    expect(rows.length).toBe(2);
    // Første rad: beløp, bong-id.
    expect(rows[0]?.textContent).toContain("250.00");
    expect(rows[0]?.textContent).toContain("tkt-42");
    // Andre rad: admin-approval label synlig.
    expect(rows[1]?.textContent).toContain("tkt-99");
    const adminLabel = rows[1]?.querySelector(".label-warning");
    expect(adminLabel).toBeTruthy();
  });

  it("Go to Physical Cashout-knappen kaller onNavigateToCashout-callback", async () => {
    mockApiRouter([
      {
        match: /\/api\/agent\/shift\/pending-cashouts/,
        handler: () => ({ ok: true, data: { pendingCashouts: [], count: 0 } }),
      },
    ]);
    const navigateSpy = vi.fn();
    openPendingCashoutsModal({ onNavigateToCashout: navigateSpy });
    await tick();
    const gotoBtn = document.body.querySelector<HTMLButtonElement>('[data-action="goto-cashout"]');
    expect(gotoBtn).toBeTruthy();
    gotoBtn!.click();
    expect(navigateSpy).toHaveBeenCalled();
  });
});
