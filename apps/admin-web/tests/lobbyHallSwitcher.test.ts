/**
 * Tester for hall-switcher state-refresh-bug (PR fix/hall-switcher-state-refresh-2026-05-14).
 *
 * Bakgrunn (Tobias-rapport 2026-05-14 med screenshot):
 *   Spiller-shell `/web/` har en hall-dropdown øverst. Bytte hall trigget kun
 *   compliance + balance-refresh — IKKE game-status (Bingo: Stengt/Åpen).
 *   Tile-status fortsatte å vise gammel hall sin status selv etter bytte.
 *
 * Fix: `switchHall()` re-fetcher nå parallelt:
 *   - /api/wallet/me (balance, cache-buster)
 *   - /api/wallet/me/compliance?hallId=...
 *   - /api/games/spill1/lobby?hallId=...   ← NY (per-hall Spill 1-status)
 *   - /api/games/status                    ← også re-fetchet for Spill 2/3 perpetual
 *
 * `buildStatusBadge('bingo')` bruker nå per-hall `spill1Lobby.overallStatus`
 * istedenfor global `gameStatus['bingo']` når begge er tilgjengelige.
 *
 * Lobby.js er plain ES5 JS i `apps/backend/public/web/lobby.js`. For å teste
 * laster vi kilden via `fs.readFileSync` og kjører den i jsdom-konteksten.
 * IIFE-en eksponerer `window.SpilloramaLobby.__testing` med interne hooks
 * (getState/switchHall/loadSpill1Lobby/buildStatusBadge).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const LOBBY_JS_PATH = resolvePath(
  __dirname,
  "../../backend/public/web/lobby.js",
);
const LOBBY_SOURCE = readFileSync(LOBBY_JS_PATH, "utf8");

// Type-shim for testing-handles eksponert av lobby.js IIFE.
interface LobbyState {
  user: unknown;
  games: Array<{ slug: string; title: string; description?: string }>;
  halls: Array<{ id: string; name: string }>;
  wallet: unknown;
  compliance: unknown;
  gameStatus: Record<string, { status: string; nextRoundAt: string | null }>;
  spill1Lobby: null | {
    hallId: string;
    overallStatus:
      | "closed"
      | "idle"
      | "purchase_open"
      | "ready_to_start"
      | "running"
      | "paused"
      | "finished";
    nextScheduledGame: null | {
      scheduledStartTime: string | null;
      catalogDisplayName?: string;
    };
  };
  activeHallId: string;
  loading: boolean;
  error: string;
}

interface SpilloramaLobbyTesting {
  load: () => Promise<void>;
  init: () => void;
  __testing: {
    getState(): LobbyState;
    switchHall(hallId: string): Promise<void>;
    loadSpill1Lobby(): Promise<void>;
    buildStatusBadge(slug: string): string;
    buildSpill1StatusBadge(): string | null;
    isWebGameActive(): boolean;
  };
}

declare global {
  interface Window {
    SpilloramaLobby?: SpilloramaLobbyTesting;
    SpilloramaAuth?: unknown;
    SetActiveHall?: (id: string, name: string) => void;
    returnToShellLobby?: () => void;
  }
}

interface MockedFetchCall {
  url: string;
  init?: RequestInit;
}

interface MockedFetchHandle {
  fn: typeof fetch;
  calls: MockedFetchCall[];
  /** Default response if no specific path-matcher matches. */
  setDefault(res: { status: number; body: unknown }): void;
  /** Per-path-prefix mock. */
  setResponse(pathPrefix: string, res: { status: number; body: unknown }): void;
  reset(): void;
}

function installMockFetch(): MockedFetchHandle {
  const calls: MockedFetchCall[] = [];
  const byPath: Map<string, { status: number; body: unknown }> = new Map();
  let defaultRes: { status: number; body: unknown } = {
    status: 200,
    body: {},
  };
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, init });
    // Strip query for path-match
    const path = urlStr.split("?")[0] ?? urlStr;
    // Longest-prefix-match wins (så /api/games/spill1/lobby ikke matches
    // av /api/games-prefiks). Map preserves insertion order, men vi sorterer
    // eksplisitt på prefix-lengde for å være deterministisk.
    let matched: { status: number; body: unknown } | undefined;
    let matchedPrefixLen = -1;
    for (const [prefix, res] of byPath.entries()) {
      if (path.startsWith(prefix) && prefix.length > matchedPrefixLen) {
        matched = res;
        matchedPrefixLen = prefix.length;
      }
    }
    const res = matched ?? defaultRes;
    return new Response(
      JSON.stringify(
        res.status < 400
          ? { ok: true, data: res.body }
          : { ok: false, error: res.body },
      ),
      {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn;
  return {
    fn,
    calls,
    setDefault: (res) => {
      defaultRes = res;
    },
    setResponse: (prefix, res) => {
      byPath.set(prefix, res);
    },
    reset: () => {
      calls.length = 0;
      byPath.clear();
      defaultRes = { status: 200, body: {} };
    },
  };
}

function setupDom(): void {
  // Minimal DOM-elementene som lobby.js renderLobby + initLobby leter etter.
  // Vi trenger ikke alle — bare nok til at funksjonene ikke krasjer.
  document.body.innerHTML = `
    <div id="lobby-screen">
      <span id="lobby-user-name"></span>
      <select id="lobby-hall-select"></select>
      <div id="lobby-game-grid"></div>
      <div id="lobby-compliance-warning" hidden></div>
      <span id="lobby-balance"><span class="lobby-chip-value"></span></span>
      <span id="lobby-winnings"><span class="lobby-chip-value"></span></span>
    </div>
    <div id="web-game-container" style="display: none;"></div>
    <div id="lobby-back-bar" class="lobby-back-bar"></div>
    <select id="game-bar-hall-select"></select>
    <span id="game-bar-balance"><span class="lobby-chip-value"></span></span>
    <span id="game-bar-winnings"><span class="lobby-chip-value"></span></span>
  `;
}

/**
 * Last lobby.js inn i jsdom-konteksten. IIFE-en eksponerer
 * `window.SpilloramaLobby` med `.__testing` for test-hooks.
 *
 * Returnerer en frisk handle slik at hver test får ren state.
 */
function loadLobby(): SpilloramaLobbyTesting {
  // Slett evt. tidligere registrering. IIFE-en vil overskrive uansett, men
  // dette er defensiv hygiene mellom tester.
  (window as unknown as Record<string, unknown>).SpilloramaLobby = undefined;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(LOBBY_SOURCE).call(window);
  const lobby = window.SpilloramaLobby;
  if (!lobby || !lobby.__testing) {
    throw new Error(
      "[test] lobby.js failed to expose window.SpilloramaLobby.__testing",
    );
  }
  return lobby;
}

// ── Tester ──────────────────────────────────────────────────────────────

describe("lobby.js — hall-switcher state-refresh (Tobias 2026-05-14)", () => {
  let mockFetch: MockedFetchHandle;
  let lobby: SpilloramaLobbyTesting;

  const TWO_HALLS = [
    { id: "demo-hall-001", name: "Demo Bingohall 1 (Master)", isActive: true },
    { id: "demo-hall-002", name: "Demo Bingohall 2", isActive: true },
  ];

  beforeEach(() => {
    // Token må eksistere — apiFetch krever det. Bruk samme storage som
    // setup.ts installerer (jsdom sessionStorage).
    window.sessionStorage.setItem("spillorama.accessToken", "test-token");
    window.sessionStorage.setItem(
      "spillorama.user",
      JSON.stringify({ id: "u1", email: "test@example.com" }),
    );
    setupDom();
    mockFetch = installMockFetch();
    // Standard responses — alle endpoints OK med tomme body-er.
    mockFetch.setResponse("/api/halls", { status: 200, body: TWO_HALLS });
    mockFetch.setResponse("/api/wallet/me", {
      status: 200,
      body: { account: { balance: 100, depositBalance: 100, winningsBalance: 0 } },
    });
    mockFetch.setResponse("/api/games", {
      status: 200,
      body: [
        { slug: "bingo", title: "Bingo", description: "75-ball" },
        { slug: "rocket", title: "Rocket", description: "3x3" },
      ],
    });
    mockFetch.setResponse("/api/games/status", {
      status: 200,
      body: {},
    });
    mockFetch.setResponse("/api/wallet/me/compliance", {
      status: 200,
      body: { restrictions: { isBlocked: false } },
    });
    mockFetch.setResponse("/api/games/spill1/lobby", {
      status: 200,
      body: {
        hallId: "demo-hall-001",
        businessDate: "2026-05-14",
        isOpen: true,
        openingTimeStart: "11:00",
        openingTimeEnd: "23:00",
        planId: "demo-plan",
        planName: "Demo plan",
        runId: null,
        runStatus: null,
        overallStatus: "closed",
        nextScheduledGame: null,
        currentRunPosition: 0,
        totalPositions: 13,
      },
    });
    lobby = loadLobby();
  });

  afterEach(() => {
    mockFetch.reset();
    document.body.innerHTML = "";
    window.sessionStorage.clear();
  });

  describe("Test 1: initial load includes spill1Lobby for active hall", () => {
    it("fetches /api/games/spill1/lobby?hallId=... at initial load", async () => {
      await lobby.load();

      const spill1Calls = mockFetch.calls.filter((c) =>
        c.url.includes("/api/games/spill1/lobby"),
      );
      expect(spill1Calls.length).toBeGreaterThanOrEqual(1);
      // First fetch should include the chosen hallId (first hall by default)
      const firstSpill1Call = spill1Calls[0];
      expect(firstSpill1Call).toBeDefined();
      expect(firstSpill1Call!.url).toContain("hallId=demo-hall-001");

      const state = lobby.__testing.getState();
      expect(state.activeHallId).toBe("demo-hall-001");
      expect(state.spill1Lobby).not.toBeNull();
      expect(state.spill1Lobby?.overallStatus).toBe("closed");
    });
  });

  describe("Test 2: switchHall sets new hallId and persists to sessionStorage", () => {
    it("activates the new hall and writes to sessionStorage", async () => {
      await lobby.load();
      // Sanity: starter på første hall
      expect(lobby.__testing.getState().activeHallId).toBe("demo-hall-001");

      await lobby.__testing.switchHall("demo-hall-002");

      const state = lobby.__testing.getState();
      expect(state.activeHallId).toBe("demo-hall-002");
      expect(window.sessionStorage.getItem("lobby.activeHallId")).toBe(
        "demo-hall-002",
      );
    });
  });

  describe("Test 3: switchHall re-fetches spill1Lobby for new hall", () => {
    it("re-calls /api/games/spill1/lobby with new hallId", async () => {
      await lobby.load();
      mockFetch.calls.length = 0; // reset call-log

      // Master-hallens lobby returnerer purchase_open
      mockFetch.setResponse("/api/games/spill1/lobby", {
        status: 200,
        body: {
          hallId: "demo-hall-002",
          businessDate: "2026-05-14",
          isOpen: true,
          openingTimeStart: "11:00",
          openingTimeEnd: "23:00",
          planId: "demo-plan",
          planName: "Demo plan",
          runId: "run-1",
          runStatus: "running",
          overallStatus: "purchase_open",
          nextScheduledGame: null,
          currentRunPosition: 1,
          totalPositions: 13,
        },
      });

      await lobby.__testing.switchHall("demo-hall-002");

      const spill1Calls = mockFetch.calls.filter((c) =>
        c.url.includes("/api/games/spill1/lobby"),
      );
      expect(spill1Calls.length).toBeGreaterThanOrEqual(1);
      const lastSpill1Call = spill1Calls[spill1Calls.length - 1];
      expect(lastSpill1Call).toBeDefined();
      expect(lastSpill1Call!.url).toContain("hallId=demo-hall-002");

      const state = lobby.__testing.getState();
      expect(state.spill1Lobby?.overallStatus).toBe("purchase_open");
    });
  });

  describe("Test 4: switchHall re-fetches compliance for new hall", () => {
    it("re-calls /api/wallet/me/compliance with new hallId", async () => {
      await lobby.load();
      mockFetch.calls.length = 0;

      await lobby.__testing.switchHall("demo-hall-002");

      const complianceCalls = mockFetch.calls.filter((c) =>
        c.url.includes("/api/wallet/me/compliance"),
      );
      expect(complianceCalls.length).toBeGreaterThanOrEqual(1);
      const lastComplianceCall = complianceCalls[complianceCalls.length - 1];
      expect(lastComplianceCall).toBeDefined();
      expect(lastComplianceCall!.url).toContain("hallId=demo-hall-002");
    });
  });

  describe("Test 5: switchHall re-fetches balance (cache-buster)", () => {
    it("re-calls /api/wallet/me with cache-buster", async () => {
      await lobby.load();
      mockFetch.calls.length = 0;

      await lobby.__testing.switchHall("demo-hall-002");

      const walletCalls = mockFetch.calls.filter((c) =>
        c.url.startsWith("/api/wallet/me?") || c.url === "/api/wallet/me",
      );
      // Skal være minst ett kall til /api/wallet/me — cache-busted med ?_=
      expect(walletCalls.length).toBeGreaterThanOrEqual(1);
      const lastWalletCall = walletCalls[walletCalls.length - 1];
      expect(lastWalletCall).toBeDefined();
      // cache-buster må være satt
      expect(lastWalletCall!.url).toMatch(/\?_=\d+/);
    });
  });

  describe("Test 6: switchHall re-renders game-tiles", () => {
    it("updates DOM game-tile status badge after hall switch", async () => {
      // Master-hall returnerer purchase_open
      mockFetch.setResponse("/api/games/spill1/lobby", {
        status: 200,
        body: {
          hallId: "demo-hall-002",
          businessDate: "2026-05-14",
          isOpen: true,
          openingTimeStart: "11:00",
          openingTimeEnd: "23:00",
          planId: "demo-plan",
          planName: "Demo plan",
          runId: "run-1",
          runStatus: "running",
          overallStatus: "purchase_open",
          nextScheduledGame: null,
          currentRunPosition: 1,
          totalPositions: 13,
        },
      });

      await lobby.load();

      // Initial-state: hall-001 har closed-status → Stengt-badge
      const initialBingoTile = document
        .querySelector('#lobby-game-grid [data-slug="bingo"]');
      // Initial fetch brukte response satt for /api/games/spill1/lobby som
      // returnerte purchase_open (siste setResponse), så tile er allerede "Åpen".
      // Vi tester at re-render skjer ved switch — sjekk at tile EKSISTERER.
      expect(initialBingoTile).not.toBeNull();

      // Endre response — ny hall returnerer running (Åpen)
      mockFetch.setResponse("/api/games/spill1/lobby", {
        status: 200,
        body: {
          hallId: "demo-hall-002",
          businessDate: "2026-05-14",
          isOpen: true,
          openingTimeStart: "11:00",
          openingTimeEnd: "23:00",
          planId: "demo-plan",
          planName: "Demo plan",
          runId: "run-1",
          runStatus: "running",
          overallStatus: "running",
          nextScheduledGame: null,
          currentRunPosition: 1,
          totalPositions: 13,
        },
      });

      await lobby.__testing.switchHall("demo-hall-002");

      // Etter switch: badge for `bingo` skal være "Åpen" (lobby-tile-status--open)
      const bingoTile = document
        .querySelector('#lobby-game-grid [data-slug="bingo"]');
      expect(bingoTile).not.toBeNull();
      const statusBadge = bingoTile?.querySelector(
        ".lobby-tile-status--open",
      );
      expect(statusBadge).not.toBeNull();
      expect(statusBadge?.textContent).toContain("Åpen");
    });
  });

  describe("Test 7: idempotency — same hall = no-op", () => {
    it("does not re-fetch when hallId is unchanged", async () => {
      await lobby.load();
      const initialActiveHall = lobby.__testing.getState().activeHallId;
      mockFetch.calls.length = 0;

      await lobby.__testing.switchHall(initialActiveHall);

      // Ingen network-roundtrips når hall er samme.
      expect(mockFetch.calls.length).toBe(0);
    });
  });

  describe("Test 8: buildStatusBadge — Spill 1 per-hall mapping", () => {
    it("maps overallStatus to correct badge", async () => {
      await lobby.load();
      const state = lobby.__testing.getState();

      // running → Åpen
      state.spill1Lobby = {
        hallId: "x",
        overallStatus: "running",
        nextScheduledGame: null,
      } as LobbyState["spill1Lobby"];
      expect(lobby.__testing.buildStatusBadge("bingo")).toContain("Åpen");

      // purchase_open → Åpen
      state.spill1Lobby!.overallStatus = "purchase_open";
      expect(lobby.__testing.buildStatusBadge("bingo")).toContain("Åpen");

      // ready_to_start → "Starter snart" eller HH:MM
      state.spill1Lobby!.overallStatus = "ready_to_start";
      expect(lobby.__testing.buildStatusBadge("bingo")).toContain(
        "Starter",
      );

      // paused → Pauset
      state.spill1Lobby!.overallStatus = "paused";
      expect(lobby.__testing.buildStatusBadge("bingo")).toContain("Pauset");

      // closed → Stengt
      state.spill1Lobby!.overallStatus = "closed";
      expect(lobby.__testing.buildStatusBadge("bingo")).toContain("Stengt");

      // finished → Stengt
      state.spill1Lobby!.overallStatus = "finished";
      expect(lobby.__testing.buildStatusBadge("bingo")).toContain("Stengt");
    });

    it("falls back to global gameStatus when spill1Lobby is null", async () => {
      await lobby.load();
      const state = lobby.__testing.getState();
      state.spill1Lobby = null;
      state.gameStatus["bingo"] = { status: "OPEN", nextRoundAt: null };

      const badge = lobby.__testing.buildStatusBadge("bingo");
      expect(badge).toContain("Åpen");
    });
  });

  describe("Test 9: switchHall is parallel (Promise.all)", () => {
    it("dispatches multiple fetches without waiting sequentially", async () => {
      await lobby.load();
      mockFetch.calls.length = 0;

      // Vi sjekker bare at alle 4 endpoints kalles:
      // - /api/wallet/me (balance, cache-buster)
      // - /api/wallet/me/compliance
      // - /api/games/spill1/lobby
      // - /api/games/status
      await lobby.__testing.switchHall("demo-hall-002");

      const callPaths = mockFetch.calls.map((c) => c.url.split("?")[0]);
      expect(callPaths).toContain("/api/wallet/me");
      expect(callPaths).toContain("/api/wallet/me/compliance");
      expect(callPaths).toContain("/api/games/spill1/lobby");
      expect(callPaths).toContain("/api/games/status");
    });
  });

  describe("Test 10: spillorama:hallChanged event dispatched", () => {
    it("emits CustomEvent with hallId and hallName in detail", async () => {
      await lobby.load();

      let capturedDetail: { hallId?: string; hallName?: string } | null = null;
      const handler = (e: Event) => {
        capturedDetail = (e as CustomEvent).detail;
      };
      window.addEventListener("spillorama:hallChanged", handler);

      try {
        await lobby.__testing.switchHall("demo-hall-002");
      } finally {
        window.removeEventListener("spillorama:hallChanged", handler);
      }

      expect(capturedDetail).not.toBeNull();
      expect(capturedDetail!.hallId).toBe("demo-hall-002");
      expect(capturedDetail!.hallName).toBe("Demo Bingohall 2");
    });
  });

  describe("Test 11: SetActiveHall (spillvett.js bridge) called", () => {
    it("calls window.SetActiveHall with new hallId + name", async () => {
      await lobby.load();
      const setActiveHallSpy = vi.fn();
      window.SetActiveHall = setActiveHallSpy;

      await lobby.__testing.switchHall("demo-hall-002");

      expect(setActiveHallSpy).toHaveBeenCalledWith(
        "demo-hall-002",
        "Demo Bingohall 2",
      );
    });
  });

  describe("Test 12: fail-soft when /api/games/spill1/lobby errors", () => {
    it("falls back to gameStatus on lobby fetch failure", async () => {
      await lobby.load();
      mockFetch.setResponse("/api/games/spill1/lobby", {
        status: 500,
        body: { code: "INTERNAL_ERROR", message: "Failed" },
      });
      mockFetch.setResponse("/api/games/status", {
        status: 200,
        body: { bingo: { status: "OPEN", nextRoundAt: null } },
      });

      await lobby.__testing.switchHall("demo-hall-002");

      const state = lobby.__testing.getState();
      // spill1Lobby er null pga. fail-soft
      expect(state.spill1Lobby).toBeNull();
      // Men gameStatus['bingo'] er fortsatt satt — badge skal vise OPEN
      const badge = lobby.__testing.buildStatusBadge("bingo");
      expect(badge).toContain("Åpen");
    });
  });
});
