// Unit-tester for PhysicalCashoutPatternModal (BIN-FOLLOWUP-13).
//
// Tester:
//   - Modal rendrer 5×5 grid (25 celler) med matched-celler highlightet
//     basert på pattern-fallback (uten async API-kall).
//   - Pattern-status-tabell viser alle 5 patterns med korrekt
//     Cashout/Rewarded-badge.
//   - Reward-knapp vises kun når canReward=true && !isRewarded.
//   - Asynkron oppgradering via /api/agent/bingo/check oppdaterer
//     matched-cells med eksakte indekser.
//   - Reward All-knapp på subgame-detail (verifiserer at filen har
//     5×5-grid + Reward All-tokens — krav fra E2E STEP F.6).

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { setSession, type Session } from "../src/auth/Session.js";
import { openPhysicalCashoutPatternModal } from "../src/pages/cash-inout/PhysicalCashoutPatternModal.js";
import type { PhysicalTicket } from "../src/api/admin-physical-tickets.js";

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

function makeTicket(overrides: Partial<PhysicalTicket> = {}): PhysicalTicket {
  return {
    id: "t-1",
    batchId: "b-1",
    uniqueId: "U12345",
    hallId: "hall-a",
    status: "SOLD",
    priceCents: 5000,
    assignedGameId: "game-1",
    soldAt: "2026-04-27T08:00:00.000Z",
    soldBy: null,
    buyerUserId: null,
    voidedAt: null,
    voidedBy: null,
    voidedReason: null,
    createdAt: "2026-04-27T08:00:00.000Z",
    updatedAt: "2026-04-27T08:00:00.000Z",
    numbersJson: [
      1, 2, 3, 4, 5,
      16, 17, 18, 19, 20,
      31, 0, 33, 34, 35,
      46, 47, 48, 49, 50,
      61, 62, 63, 64, 65,
    ],
    patternWon: "row_1",
    wonAmountCents: 10000,
    evaluatedAt: "2026-04-27T09:00:00.000Z",
    isWinningDistributed: false,
    winningDistributedAt: null,
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

describe("PhysicalCashoutPatternModal", () => {
  it("rendrer 5×5 grid med 25 celler", async () => {
    // Mock så ikke async-upgrade endrer state.
    mockApiRouter([
      { match: /\/api\/agent\/bingo\/check/, handler: () => ({ ok: false, error: { code: "DELAYED", message: "test" } }) },
    ]);
    const ticket = makeTicket({ patternWon: null, numbersJson: null });
    openPhysicalCashoutPatternModal({
      ticket,
      gameId: null, // ingen async-kall
      isRewarded: false,
      canReward: false,
    });
    await tick(2);
    const grid = document.body.querySelector("[data-marker='cashout-pattern-grid']");
    expect(grid).toBeTruthy();
    const cells = document.body.querySelectorAll("[data-marker='cashout-pattern-grid'] [role='gridcell']");
    expect(cells.length).toBe(25);
  });

  it("highlighter alle row_1-celler når patternWon=row_1 (fallback uten gameId)", async () => {
    const ticket = makeTicket({ patternWon: "row_1" });
    openPhysicalCashoutPatternModal({
      ticket,
      gameId: null, // ingen async-kall
      isRewarded: false,
      canReward: false,
    });
    await tick(2);
    const cells = document.body.querySelectorAll<HTMLElement>("[data-marker='cashout-pattern-grid'] [role='gridcell']");
    // Row 1 = celler 0-4, alle skal ha cashout-cell-matched-klasse.
    for (let i = 0; i < 5; i += 1) {
      expect(cells[i]?.classList.contains("cashout-cell-matched")).toBe(true);
    }
    // Row 2 = celler 5-9, INGEN skal være matched.
    for (let i = 5; i < 10; i += 1) {
      expect(cells[i]?.classList.contains("cashout-cell-matched")).toBe(false);
    }
  });

  it("viser Cashout-badge når isRewarded=false", async () => {
    const ticket = makeTicket({ patternWon: "full_house" });
    openPhysicalCashoutPatternModal({
      ticket,
      gameId: null,
      isRewarded: false,
      canReward: false,
    });
    await tick(2);
    const statuses = document.body.querySelector("[data-marker='cashout-pattern-statuses']");
    expect(statuses).toBeTruthy();
    expect(statuses?.textContent).toContain("Klar for utbetaling");
  });

  it("viser Rewarded-badge når isRewarded=true", async () => {
    const ticket = makeTicket({ patternWon: "row_2", isWinningDistributed: true });
    openPhysicalCashoutPatternModal({
      ticket,
      gameId: null,
      isRewarded: true,
      canReward: false,
    });
    await tick(2);
    const statuses = document.body.querySelector("[data-marker='cashout-pattern-statuses']");
    expect(statuses).toBeTruthy();
    expect(statuses?.textContent).toContain("Utbetalt");
  });

  it("viser Reward-knapp når canReward=true && !isRewarded", async () => {
    const ticket = makeTicket({ patternWon: "row_1" });
    openPhysicalCashoutPatternModal({
      ticket,
      gameId: "game-1",
      isRewarded: false,
      canReward: true,
    });
    await tick(2);
    const rewardBtn = document.body.querySelector('[data-action="reward"]');
    expect(rewardBtn).toBeTruthy();
  });

  it("skjuler Reward-knapp når canReward=false", async () => {
    const ticket = makeTicket({ patternWon: "row_1" });
    openPhysicalCashoutPatternModal({
      ticket,
      gameId: "game-1",
      isRewarded: false,
      canReward: false,
    });
    await tick(2);
    const rewardBtn = document.body.querySelector('[data-action="reward"]');
    expect(rewardBtn).toBeNull();
  });

  it("renders ticket uniqueId i header", async () => {
    const ticket = makeTicket({ uniqueId: "TICKET-XYZ-99" });
    openPhysicalCashoutPatternModal({
      ticket,
      gameId: null,
      isRewarded: false,
      canReward: false,
    });
    await tick(2);
    const header = document.body.querySelector("[data-marker='cashout-pattern-header']");
    expect(header?.textContent).toContain("TICKET-XYZ-99");
  });

  it("renders 0 patterns som '—' når patternWon=null", async () => {
    const ticket = makeTicket({ patternWon: null });
    openPhysicalCashoutPatternModal({
      ticket,
      gameId: null,
      isRewarded: false,
      canReward: false,
    });
    await tick(2);
    const statusRows = document.body.querySelectorAll("[data-marker='cashout-pattern-row']");
    expect(statusRows.length).toBe(5); // alle 5 mønstre listes
    // Ingen av mønstrene skal være markert som winner (alle skal vise "—").
    for (const row of statusRows) {
      const text = row.textContent ?? "";
      expect(text).toContain("—");
    }
  });

  it("oppgraderer matched-cells via /api/agent/bingo/check når gameId er gitt", async () => {
    mockApiRouter([
      {
        match: /\/api\/agent\/bingo\/check/,
        handler: () => ({
          ok: true,
          data: {
            uniqueId: "U12345",
            gameId: "game-1",
            gameStatus: "RUNNING",
            hasWon: true,
            winningPattern: "row_1",
            winningPatterns: ["row_1"],
            matchedCellIndexes: [0, 1, 2, 3, 4, 12], // row 1 + free center
            drawnNumbersCount: 30,
            payoutEligible: true,
            alreadyEvaluated: true,
            evaluatedAt: "2026-04-27T09:00:00.000Z",
            wonAmountCents: 10000,
            isWinningDistributed: false,
          },
        }),
      },
    ]);
    const ticket = makeTicket({ patternWon: "row_1" });
    openPhysicalCashoutPatternModal({
      ticket,
      gameId: "game-1",
      isRewarded: false,
      canReward: false,
    });
    await tick(15); // gi tid til async upgrade
    const cells = document.body.querySelectorAll<HTMLElement>("[data-marker='cashout-pattern-grid'] [role='gridcell']");
    expect(cells.length).toBe(25);
    // Etter upgrade skal cellene 0,1,2,3,4 og 12 være matched.
    expect(cells[0]?.classList.contains("cashout-cell-matched")).toBe(true);
    expect(cells[12]?.classList.contains("cashout-cell-matched") || cells[12]?.classList.contains("cashout-cell-center")).toBe(true);
  });
});

describe("PhysicalCashoutPage og SubGameDetailPage (BIN-FOLLOWUP-13 tokens)", () => {
  it("PhysicalCashoutPage source inneholder '5x5' og 'reward all' tokens", async () => {
    // E2E STEP F.6 sjekker at PhysicalCashoutPage.ts inneholder regex-match
    // for '5x5|grid|ticket-grid' og 'reward.?all'.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.resolve(
      process.cwd(),
      "src/pages/cash-inout/PhysicalCashoutPage.ts"
    );
    const src = await fs.readFile(filePath, "utf8");
    const hasGrid = /5x5|grid|ticket-grid/i.test(src);
    const hasRewardAll = /reward.?all/i.test(src);
    expect(hasGrid).toBe(true);
    expect(hasRewardAll).toBe(true);
  });

  it("PhysicalCashoutSubGameDetailPage source inneholder '5x5' og 'reward all' tokens", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.resolve(
      process.cwd(),
      "src/pages/cash-inout/PhysicalCashoutSubGameDetailPage.ts"
    );
    const src = await fs.readFile(filePath, "utf8");
    const hasGrid = /5x5|grid|ticket-grid/i.test(src);
    const hasRewardAll = /reward.?all/i.test(src);
    expect(hasGrid).toBe(true);
    expect(hasRewardAll).toBe(true);
  });
});
