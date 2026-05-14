/**
 * Tester for StateDumpTool (Tobias-direktiv 2026-05-14).
 *
 * Dekker:
 *   1. buildStateDump returnerer JSON-objekt med alle 5 hovedseksjoner +
 *      derived + env
 *   2. lobbyState inkluderer activeHallId + halls + games
 *   3. derivedState.pricePerColor regner riktig (entryFee × multiplier)
 *   4. derivedState.innsatsVsForhandskjop klassifiserer per timing
 *   5. Idempotent — flere dumps gir ulik timestamp/id men samme structure
 *   6. autoMultiplikatorApplied detects multiplier ≠ 1
 *   7. pricingSourcesComparison flagger divergent sources
 *   8. dumpState publiserer til window-global + localStorage + console
 *   9. Server-POST kalles med token og JSON body
 *  10. Server-POST feiler ikke synkront ved fetch-feil (fail-soft)
 *  11. Provider-feil håndteres uten throw
 *  12. centsToKr-helper konverterer korrekt
 *  13. normaliseTicketPricesCents filtrerer ugyldige verdier
 *  14. ticketTypes uten priceMultiplier defaulter til 1
 *  15. Stable top-level keys for diff-vennlig output
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildStateDump,
  dumpState,
  __TEST_ONLY__,
  STATE_DUMP_GLOBAL_NAME,
  STATE_DUMP_LOCALSTORAGE_KEY,
  STATE_DUMP_LOG_TAG,
  type StateDumpProviders,
  type FrontendStateDump,
} from "./StateDumpTool.js";

// ── Globalt mini-DOM-mock for tester ────────────────────────────────────────

interface GlobalScope {
  window?: any;
  localStorage?: any;
  fetch?: any;
}

function setupMockWindow(): {
  consoleLogs: Array<{ args: unknown[] }>;
  consoleWarns: Array<{ args: unknown[] }>;
  localStorageMap: Map<string, string>;
  restore: () => void;
} {
  const g = globalThis as unknown as GlobalScope;
  const original = {
    window: g.window,
    fetch: g.fetch,
  };
  const localStorageMap = new Map<string, string>();
  const mockLs = {
    getItem(k: string): string | null {
      return localStorageMap.get(k) ?? null;
    },
    setItem(k: string, v: string): void {
      localStorageMap.set(k, v);
    },
    removeItem(k: string): void {
      localStorageMap.delete(k);
    },
    clear(): void {
      localStorageMap.clear();
    },
  };
  const mockWindow = {
    location: { search: "", href: "https://test.example/web/?dev=1" },
    navigator: { userAgent: "test-agent/1.0" },
    innerWidth: 1280,
    innerHeight: 800,
    localStorage: mockLs,
  };
  g.window = mockWindow;

  const consoleLogs: Array<{ args: unknown[] }> = [];
  const consoleWarns: Array<{ args: unknown[] }> = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args: unknown[]) => {
    consoleLogs.push({ args });
  };
  console.warn = (...args: unknown[]) => {
    consoleWarns.push({ args });
  };

  return {
    consoleLogs,
    consoleWarns,
    localStorageMap,
    restore: () => {
      g.window = original.window;
      g.fetch = original.fetch;
      console.log = origLog;
      console.warn = origWarn;
    },
  };
}

function makeMockGameState(overrides: Record<string, unknown> = {}): unknown {
  return {
    roomCode: "ROOM-001",
    hallId: "demo-hall-001",
    gameStatus: "RUNNING",
    gameId: "game-abc",
    gameType: "bingo",
    playerCount: 5,
    drawCount: 12,
    totalDrawCapacity: 75,
    lastDrawnNumber: 42,
    prizePool: 1500,
    entryFee: 5,
    ticketTypes: [
      { name: "yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
      { name: "white", type: "small", priceMultiplier: 2, ticketCount: 1 },
      { name: "purple", type: "small", priceMultiplier: 3, ticketCount: 1 },
    ],
    jackpot: null,
    isPaused: false,
    pauseReason: null,
    pauseUntil: null,
    millisUntilNextStart: null,
    canStartNow: false,
    myPlayerId: "player-1",
    myTickets: [{ id: 1, type: "yellow" }],
    preRoundTickets: [],
    myMarks: [[1, 2, 3], [4, 5]],
    isArmed: false,
    myStake: 5,
    myPendingStake: 0,
    myLuckyNumber: 7,
    walletBalanceKr: 100,
    ...overrides,
  };
}

function makeMockLobbyState(overrides: Record<string, unknown> = {}): unknown {
  return {
    activeHallId: "demo-hall-001",
    halls: [
      { id: "demo-hall-001", name: "Demo Hall 1" },
      { id: "demo-hall-002", name: "Demo Hall 2" },
    ],
    games: [
      { slug: "bingo", name: "Bingo", status: "open" },
      { slug: "rocket", name: "Rocket", status: "running" },
    ],
    ticketPricesCents: { yellow: 500, white: 1000, purple: 1500 },
    nextGame: {
      catalogSlug: "bingo",
      displayName: "Bingo Runde 1",
      scheduledStartTime: "2026-05-14T18:00:00Z",
      ticketPricesCents: { yellow: 500, white: 1000, purple: 1500 },
    },
    compliance: { canPlay: true, selfExcluded: false, timedPauseUntil: null },
    balanceKr: 100,
    ...overrides,
  };
}

function makeProviders(
  game: unknown,
  lobby: unknown,
  extra: Partial<StateDumpProviders> = {},
): StateDumpProviders {
  return {
    getGameState: () => game,
    getLobbyState: () => lobby,
    getScreenState: () => ({
      current: "play",
      history: [
        { at: 1000, to: "lobby" },
        { at: 2000, from: "lobby", to: "buy" },
        { at: 3000, from: "buy", to: "play" },
      ],
    }),
    getSocketState: () => ({
      connected: true,
      connectionState: "connected",
      lastEvents: [
        { timestamp: 1000, direction: "in", type: "room:update" },
        { timestamp: 2000, direction: "out", type: "ticket:mark" },
      ],
    }),
    getGameSlug: () => "bingo",
    ...extra,
  };
}

describe("StateDumpTool", () => {
  let ctx: ReturnType<typeof setupMockWindow>;

  beforeEach(() => {
    ctx = setupMockWindow();
  });

  afterEach(() => {
    ctx.restore();
  });

  it("Test 1: buildStateDump returnerer JSON-objekt med alle 5 hovedseksjoner + derived + env", () => {
    const dump = buildStateDump({
      providers: makeProviders(makeMockGameState(), makeMockLobbyState()),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    expect(dump.timestamp).toBeGreaterThan(0);
    expect(dump.timestampIso.length).toBeGreaterThan(0);
    expect(dump.dumpId.length).toBeGreaterThan(0);
    expect(dump.gameSlug).toBe("bingo");
    expect(dump.lobbyState).not.toBeNull();
    expect(dump.roomState).not.toBeNull();
    expect(dump.playerState).not.toBeNull();
    expect(dump.screenState).not.toBeNull();
    expect(dump.socketState).not.toBeNull();
    expect(dump.derivedState).not.toBeNull();
    expect(dump.env).not.toBeNull();
  });

  it("Test 2: lobbyState inkluderer activeHallId + halls + games + nextGame + compliance", () => {
    const dump = buildStateDump({
      providers: makeProviders(makeMockGameState(), makeMockLobbyState()),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    const lobby = dump.lobbyState!;
    expect(lobby.activeHallId).toBe("demo-hall-001");
    expect(lobby.halls).toHaveLength(2);
    expect(lobby.halls[0]!.id).toBe("demo-hall-001");
    expect(lobby.halls[0]!.name).toBe("Demo Hall 1");
    expect(lobby.games).toHaveLength(2);
    expect(lobby.games[0]!.slug).toBe("bingo");
    expect(lobby.ticketPricesCents).toEqual({
      yellow: 500,
      white: 1000,
      purple: 1500,
    });
    expect(lobby.nextGame).not.toBeNull();
    expect(lobby.nextGame!.catalogSlug).toBe("bingo");
    expect(lobby.compliance).not.toBeNull();
    expect(lobby.compliance!.canPlay).toBe(true);
    expect(lobby.balanceKr).toBe(100);
  });

  it("Test 3: derivedState.pricePerColor regner riktig (entryFee × priceMultiplier)", () => {
    const dump = buildStateDump({
      providers: makeProviders(makeMockGameState(), makeMockLobbyState()),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    const ppc = dump.derivedState.pricePerColor;
    expect("__empty" in ppc).toBe(false);
    const map = ppc as Record<string, number>;
    expect(map["yellow"]).toBe(5);
    expect(map["white"]).toBe(10);
    expect(map["purple"]).toBe(15);

    const dump2 = buildStateDump({
      providers: makeProviders(
        makeMockGameState({ entryFee: 10 }),
        makeMockLobbyState(),
      ),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    const map2 = dump2.derivedState.pricePerColor as Record<string, number>;
    expect(map2["yellow"]).toBe(10);
    expect(map2["white"]).toBe(20);
    expect(map2["purple"]).toBe(30);
  });

  it("Test 4: derivedState.innsatsVsForhandskjop klassifiserer per timing", () => {
    const d1 = buildStateDump({
      providers: makeProviders(
        makeMockGameState({ myStake: 15, myPendingStake: 0 }),
        makeMockLobbyState(),
      ),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    expect(d1.derivedState.innsatsVsForhandskjop.classification).toBe("active");
    expect(d1.derivedState.innsatsVsForhandskjop.activeStakeKr).toBe(15);
    expect(d1.derivedState.innsatsVsForhandskjop.summedKr).toBe(15);

    const d2 = buildStateDump({
      providers: makeProviders(
        makeMockGameState({ myStake: 0, myPendingStake: 10 }),
        makeMockLobbyState(),
      ),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    expect(d2.derivedState.innsatsVsForhandskjop.classification).toBe("pre-round");

    const d3 = buildStateDump({
      providers: makeProviders(
        makeMockGameState({ myStake: 15, myPendingStake: 10 }),
        makeMockLobbyState(),
      ),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    expect(d3.derivedState.innsatsVsForhandskjop.classification).toBe("both");
    expect(d3.derivedState.innsatsVsForhandskjop.summedKr).toBe(25);

    const d4 = buildStateDump({
      providers: makeProviders(
        makeMockGameState({ myStake: 0, myPendingStake: 0 }),
        makeMockLobbyState(),
      ),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    expect(d4.derivedState.innsatsVsForhandskjop.classification).toBe("none");
  });

  it("Test 5: Idempotent — flere dumps gir ulik timestamp + dumpId men identisk structure", () => {
    let ts = 1000;
    let n = 0;
    const opts = {
      providers: makeProviders(makeMockGameState(), makeMockLobbyState()),
      skipServerPost: true,
      skipConsoleLog: true,
      now: () => ++ts,
      generateId: () => `test-id-${++n}`,
    };
    const d1 = buildStateDump(opts);
    const d2 = buildStateDump(opts);
    const d3 = buildStateDump(opts);

    expect(d1.timestamp).not.toBe(d2.timestamp);
    expect(d1.dumpId).not.toBe(d2.dumpId);
    expect(d2.dumpId).not.toBe(d3.dumpId);
    expect(Object.keys(d1).sort()).toEqual(Object.keys(d2).sort());
    expect(Object.keys(d1.derivedState).sort()).toEqual(
      Object.keys(d2.derivedState).sort(),
    );
  });

  it("Test 6: autoMultiplikatorApplied=true når multiplier ≠ 1; false når alle =1", () => {
    const d1 = buildStateDump({
      providers: makeProviders(makeMockGameState(), makeMockLobbyState()),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    expect(d1.derivedState.autoMultiplikatorApplied).toBe(true);

    const d2 = buildStateDump({
      providers: makeProviders(
        makeMockGameState({
          ticketTypes: [
            { name: "yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
            { name: "white", type: "small", priceMultiplier: 1, ticketCount: 1 },
          ],
        }),
        makeMockLobbyState(),
      ),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    expect(d2.derivedState.autoMultiplikatorApplied).toBe(false);
  });

  it("Test 7: pricingSourcesComparison flagger divergent sources", () => {
    const d1 = buildStateDump({
      providers: makeProviders(makeMockGameState(), makeMockLobbyState()),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    expect(d1.derivedState.pricingSourcesComparison.consistency).toBe(
      "consistent",
    );

    const d2 = buildStateDump({
      providers: makeProviders(
        makeMockGameState(),
        makeMockLobbyState({
          ticketPricesCents: { yellow: 700, white: 1200, purple: 1500 },
          nextGame: {
            catalogSlug: "bingo",
            displayName: "Bingo",
            scheduledStartTime: "2026-05-14T18:00:00Z",
            ticketPricesCents: { yellow: 700, white: 1200, purple: 1500 },
          },
        }),
      ),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    expect(d2.derivedState.pricingSourcesComparison.consistency).toBe(
      "divergent",
    );
  });

  it("Test 8: dumpState publiserer til window-global + localStorage + console", async () => {
    const dump = await dumpState({
      providers: makeProviders(makeMockGameState(), makeMockLobbyState()),
      skipServerPost: true,
    });
    const winRef = (
      globalThis as unknown as { window?: Record<string, unknown> }
    ).window;
    expect(winRef).toBeDefined();
    expect(winRef![STATE_DUMP_GLOBAL_NAME]).toEqual(dump);

    const stored = ctx.localStorageMap.get(STATE_DUMP_LOCALSTORAGE_KEY);
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!);
    expect(parsed.dumpId).toBe(dump.dumpId);

    const taggedLog = ctx.consoleLogs.find(
      (l) => l.args[0] === STATE_DUMP_LOG_TAG,
    );
    expect(taggedLog).toBeDefined();
  });

  it("Test 9: dumpState kaller fetch med token og JSON body (server-POST)", async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
    const mockFetch: typeof fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      fetchCalls.push({ url: String(url), init: init ?? {} });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await dumpState({
      providers: makeProviders(makeMockGameState(), makeMockLobbyState()),
      skipConsoleLog: true,
      fetchFn: mockFetch,
      token: "test-token-abc",
    });

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0]!;
    expect(call.url).toMatch(/\/api\/_dev\/debug\/frontend-state-dump/);
    expect(call.url).toMatch(/token=test-token-abc/);
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(call.init.body as string);
    expect(body.dumpId).toBeDefined();
  });

  it("Test 10: Server-POST fail-soft — fetch-feil throw'er ikke", async () => {
    const mockFetch: typeof fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const dump = await dumpState({
      providers: makeProviders(makeMockGameState(), makeMockLobbyState()),
      skipConsoleLog: true,
      fetchFn: mockFetch,
    });
    expect(dump.dumpId).toBeTruthy();
    const fetchWarn = ctx.consoleWarns.find((w) =>
      String(w.args.join(" ")).includes("server-POST feilet"),
    );
    expect(fetchWarn).toBeDefined();
  });

  it("Test 11: Provider-feil håndteres uten throw — null-felter populert", () => {
    const providers: StateDumpProviders = {
      getGameState: () => {
        throw new Error("game-state corrupt");
      },
      getLobbyState: () => {
        throw new Error("lobby-state corrupt");
      },
      getScreenState: () => {
        throw new Error("screen corrupt");
      },
      getSocketState: () => null,
      getGameSlug: () => "bingo",
    };
    const dump = buildStateDump({
      providers,
      skipServerPost: true,
      skipConsoleLog: true,
    });
    expect(dump.lobbyState).toBeNull();
    expect(dump.roomState).toBeNull();
    expect(dump.playerState).toBeNull();
    expect(dump.screenState).toBeNull();
    expect(dump.socketState).toBeNull();
    expect(dump.derivedState).toBeDefined();
    expect(dump.derivedState.innsatsVsForhandskjop.classification).toBe("none");
  });

  it("Test 12: centsToKr-helper konverterer korrekt", () => {
    const { centsToKr } = __TEST_ONLY__;
    expect(centsToKr(null)).toBeNull();
    expect(centsToKr({ yellow: 500, white: 1000 })).toEqual({
      yellow: 5,
      white: 10,
    });
    expect(centsToKr({})).toEqual({});
  });

  it("Test 13: normaliseTicketPricesCents filtrerer ugyldige verdier", () => {
    const { normaliseTicketPricesCents } = __TEST_ONLY__;
    expect(normaliseTicketPricesCents(null)).toBeNull();
    expect(normaliseTicketPricesCents("not-object")).toBeNull();
    expect(normaliseTicketPricesCents({ a: "500", b: 1000 })).toEqual({
      a: 500,
      b: 1000,
    });
    expect(
      normaliseTicketPricesCents({ a: 500, b: null, c: "junk", d: 1000 }),
    ).toEqual({ a: 500, d: 1000 });
    expect(normaliseTicketPricesCents({ a: null, b: "junk" })).toBeNull();
  });

  it("Test 14: ticketTypes uten priceMultiplier defaulter til 1", () => {
    const dump = buildStateDump({
      providers: makeProviders(
        makeMockGameState({
          entryFee: 5,
          ticketTypes: [{ name: "test", type: "small", ticketCount: 1 }],
        }),
        makeMockLobbyState(),
      ),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    const map = dump.derivedState.pricePerColor as Record<string, number>;
    expect(map["test"]).toBe(5);
  });

  it("Test 15: stable shape — top-level keys er deterministiske", () => {
    const dump = buildStateDump({
      providers: makeProviders(makeMockGameState(), makeMockLobbyState()),
      skipServerPost: true,
      skipConsoleLog: true,
    });
    const expected = [
      "timestamp",
      "timestampIso",
      "dumpId",
      "gameSlug",
      "lobbyState",
      "roomState",
      "playerState",
      "screenState",
      "socketState",
      "derivedState",
      "env",
    ];
    for (const key of expected) {
      expect(key in dump).toBe(true);
    }
    expect(typeof dump.derivedState).toBe("object");
    expect(dump.derivedState).not.toBeNull();
  });
});

describe("StateDumpTool — gameSlug fallback", () => {
  let ctx: ReturnType<typeof setupMockWindow>;
  beforeEach(() => {
    ctx = setupMockWindow();
  });
  afterEach(() => {
    ctx.restore();
  });

  it("defaulter gameSlug til 'bingo' når provider ikke returnerer noe", () => {
    const dump = buildStateDump({
      providers: {
        getGameState: () => makeMockGameState(),
        getLobbyState: () => makeMockLobbyState(),
      },
      skipServerPost: true,
      skipConsoleLog: true,
    });
    expect(dump.gameSlug).toBe("bingo");
  });

  it("respekterer custom gameSlug fra provider", () => {
    const dump = buildStateDump({
      providers: {
        getGameState: () => makeMockGameState(),
        getLobbyState: () => makeMockLobbyState(),
        getGameSlug: () => "rocket",
      },
      skipServerPost: true,
      skipConsoleLog: true,
    });
    expect(dump.gameSlug).toBe("rocket");
  });
});
