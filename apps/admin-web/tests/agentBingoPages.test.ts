// Agent-portal Check-for-Bingo + Physical Cashout (P0 pilot-blokker).
//
// Tester at begge sidene rendrer riktig skjema, kaller backend-endpointene
// med riktig body, og håndterer resultat-popup med 5×5-grid + vinnende
// mønstre + reward-knapper.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import { mountAgentCheckForBingo } from "../src/pages/agent-portal/AgentCheckForBingoPage.js";
import { mountAgentPhysicalCashout } from "../src/pages/agent-portal/AgentPhysicalCashoutPage.js";

function agentSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ag-1",
    name: "Agent Test",
    email: "agent@test.no",
    role: "agent",
    isSuperAdmin: false,
    avatar: "",
    hall: [{ id: "hall-a", name: "Test Hall" }],
    dailyBalance: null,
    permissions: {},
    ...overrides,
  };
}

type JsonResponder = (url: string, init: RequestInit | undefined) => unknown;

function mockApiRouter(routes: Array<{ match: RegExp; handler: JsonResponder }>): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  fn.mockImplementation((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match.test(url));
    const body = route ? route.handler(url, init) : { ok: false, error: { code: "NOT_MOCKED", message: url } };
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, data: body }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

async function tick(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

describe("AgentCheckForBingoPage", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    setSession(agentSession());
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  it("rendrer skjema med 25-celle-grid (senter readOnly = 0)", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentCheckForBingo(root);
    expect(root.querySelector("#agent-cb-form")).toBeTruthy();
    expect(root.querySelector("#agent-cb-uniqueId")).toBeTruthy();
    expect(root.querySelector("#agent-cb-gameId")).toBeTruthy();
    const cells = root.querySelectorAll<HTMLInputElement>("#agent-cb-grid input[data-idx]");
    expect(cells.length).toBe(25);
    expect(cells[12]?.value).toBe("0");
    expect(cells[12]?.readOnly).toBe(true);
  });

  it("poster uniqueId + gameId + numbers[25] til /api/agent/bingo/check", async () => {
    let postBody: unknown = null;
    let capturedUrl = "";
    mockApiRouter([
      {
        match: /\/api\/agent\/bingo\/check/,
        handler: (url, init) => {
          capturedUrl = url;
          postBody = JSON.parse(String(init?.body ?? "{}"));
          return {
            uniqueId: "100042",
            gameId: "game-7",
            gameStatus: "ENDED",
            hasWon: true,
            winningPattern: "row_1",
            winningPatterns: ["row_1"],
            matchedCellIndexes: [0, 1, 2, 3, 4, 12],
            drawnNumbersCount: 10,
            payoutEligible: true,
            alreadyEvaluated: false,
            evaluatedAt: "2026-04-20T11:00:00Z",
            wonAmountCents: null,
            isWinningDistributed: false,
          };
        },
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentCheckForBingo(root);
    root.querySelector<HTMLInputElement>("#agent-cb-uniqueId")!.value = "100042";
    root.querySelector<HTMLInputElement>("#agent-cb-gameId")!.value = "game-7";
    const cells = root.querySelectorAll<HTMLInputElement>("#agent-cb-grid input[data-idx]");
    cells.forEach((cell, i) => {
      if (i !== 12) cell.value = String(i + 1);
    });
    root.querySelector<HTMLFormElement>("#agent-cb-form")!.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );
    await tick();
    expect(capturedUrl).toContain("/api/agent/bingo/check");
    const body = postBody as { uniqueId: string; gameId: string; numbers: number[] };
    expect(body.uniqueId).toBe("100042");
    expect(body.gameId).toBe("game-7");
    expect(body.numbers.length).toBe(25);
    expect(body.numbers[12]).toBe(0);
    // Resultat-popup åpnet med "Bingo"-tekst.
    expect(document.body.textContent).toContain("Bingo");
  });
});

describe("AgentPhysicalCashoutPage", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    setSession(agentSession());
    window.localStorage.setItem("bingo_admin_access_token", "tok");
  });

  it("rendrer game-id-skjema uten coming-soon-marker", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentPhysicalCashout(root);
    expect(root.querySelector("#agent-cashout-form")).toBeTruthy();
    expect(root.querySelector("#agent-cashout-gameId")).toBeTruthy();
    expect(root.querySelector("[data-marker='coming-soon']")).toBeNull();
    // Breadcrumb linker tilbake til agent-dashboard.
    expect(root.querySelector(".breadcrumb a[href='#/agent/dashboard']")).toBeTruthy();
  });

  it("kaller /api/agent/physical/pending med gameId ved innsending", async () => {
    let capturedUrl = "";
    mockApiRouter([
      {
        match: /\/api\/agent\/physical\/pending/,
        handler: (url) => {
          capturedUrl = url;
          return {
            gameId: "game-7",
            pending: [
              {
                id: "t1",
                batchId: "b1",
                uniqueId: "100042",
                hallId: "hall-a",
                status: "SOLD",
                priceCents: 2000,
                assignedGameId: "game-7",
                soldAt: "2026-04-23T10:00:00Z",
                soldBy: "ag-1",
                buyerUserId: null,
                voidedAt: null,
                voidedBy: null,
                voidedReason: null,
                createdAt: "2026-04-23T09:00:00Z",
                updatedAt: "2026-04-23T10:00:00Z",
                numbersJson: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
                patternWon: "row_1",
                wonAmountCents: 50000,
                evaluatedAt: "2026-04-23T10:05:00Z",
                isWinningDistributed: false,
                winningDistributedAt: null,
              },
            ],
            rewarded: [],
            pendingCount: 1,
            rewardedCount: 0,
          };
        },
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentPhysicalCashout(root);
    root.querySelector<HTMLInputElement>("#agent-cashout-gameId")!.value = "game-7";
    root.querySelector<HTMLFormElement>("#agent-cashout-form")!.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );
    await tick();
    expect(capturedUrl).toContain("/api/agent/physical/pending");
    expect(capturedUrl).toContain("gameId=game-7");
    // Tabell med den eneste pending-billetten vises.
    expect(root.textContent).toContain("100042");
    // Reward-All-knapp er synlig fordi det er 1 pending.
    expect(root.querySelector<HTMLButtonElement>('[data-action="reward-all"]')).toBeTruthy();
    // Per-ticket reward-knapp er synlig.
    expect(root.querySelector<HTMLButtonElement>('[data-action="reward-ticket"]')).toBeTruthy();
  });

  it("viser tom-state hvis ingen pending eller rewarded", async () => {
    mockApiRouter([
      {
        match: /\/api\/agent\/physical\/pending/,
        handler: () => ({
          gameId: "game-7",
          pending: [],
          rewarded: [],
          pendingCount: 0,
          rewardedCount: 0,
        }),
      },
    ]);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAgentPhysicalCashout(root);
    root.querySelector<HTMLInputElement>("#agent-cashout-gameId")!.value = "game-7";
    root.querySelector<HTMLFormElement>("#agent-cashout-form")!.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );
    await tick();
    // Ingen reward-all-knapp når ingen pending.
    expect(root.querySelector<HTMLButtonElement>('[data-action="reward-all"]')).toBeNull();
  });
});

describe("sidebar + routes wiring", () => {
  beforeEach(() => {
    initI18n();
  });

  it("agentSidebar inkluderer agent-bingo-check", async () => {
    const { agentSidebar } = await import("../src/shell/sidebarSpec.js");
    const ids = agentSidebar
      .filter((n) => n.kind !== "header")
      .map((n) => (n.kind === "leaf" || n.kind === "group" ? n.id : ""));
    expect(ids).toContain("agent-bingo-check");
    expect(ids).toContain("agent-physical-cashout");
  });

  it("routes inneholder /agent/bingo-check med agent-role", async () => {
    const { routes, findRoute } = await import("../src/router/routes.js");
    const route = findRoute("/agent/bingo-check");
    expect(route).toBeDefined();
    expect(route?.roles).toContain("agent");
    expect(route?.roles).toContain("hall-operator");
    // Duplicate check — ensure no collision.
    const bingoCheckRoutes = routes.filter((r) => r.path === "/agent/bingo-check");
    expect(bingoCheckRoutes.length).toBe(1);
  });
});
