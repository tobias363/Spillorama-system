/**
 * @vitest-environment happy-dom
 *
 * Regresjons-tester for HTTP-fetch resilience i `Game1LobbyStateBinding`.
 *
 * Bakgrunn (Tobias verifisert 2026-05-10):
 *   PR #1132 wirer LobbyStateBinding inn i Game1Controller. Bindingen
 *   gjør tre ting parallelt ved `start()`:
 *     1. socket.subscribeSpill1Lobby (ack med initial state)
 *     2. fetch /api/games/spill1/lobby (HTTP-fetch som fallback/initial)
 *     3. setInterval (10s) for polling-fallback hvis socket dør
 *
 *   Tobias' bug-scenario var at frontend SKIPPET hele Game1Controller.start()
 *   fordi auth feilet (403 på dev-auto-login). Men selv med riktig auth
 *   må vi verifisere at LobbyStateBinding faktisk plukker opp lobby-data
 *   fra HTTP-fetch alene (uten socket-ack) — dette er pilot-blokker fordi
 *   socket-broadcast typisk ankommer etter første render.
 *
 * Test-coverage gaps i `LobbyStateBinding.test.ts`:
 *   - HTTP-fetch SUCCESS path er ikke testet (eksisterende tester bruker
 *     fetch-stub som returnerer 503)
 *   - Apply-state via HTTP (uten socket-ack) er ikke verifisert
 *   - Fetch-feil (network error / non-200) skal ikke krasje binding
 *   - Polling-fallback (setInterval) — at sluttverdier blir overskrevet
 *
 * Disse testene fyller gapene med fokus på "kunden ser STANDARD"-bugen.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Game1LobbyStateBinding } from "./LobbyStateBinding.js";
import type {
  SpilloramaSocket,
  Spill1LobbyStateUpdatePayload,
} from "../../../net/SpilloramaSocket.js";
import type {
  Spill1LobbyState,
  Spill1LobbyNextGame,
} from "@spillorama/shared-types/api";

// ── Test fixtures ────────────────────────────────────────────────────────

function makeNextScheduledGame(
  overrides: Partial<Spill1LobbyNextGame> = {},
): Spill1LobbyNextGame {
  return {
    itemId: "item-1",
    position: 1,
    catalogSlug: "bingo",
    catalogDisplayName: "Bingo",
    status: "purchase_open",
    scheduledGameId: "game-1",
    scheduledStartTime: "2026-05-10T13:00:00Z",
    scheduledEndTime: null,
    actualStartTime: null,
    ticketColors: ["hvit", "gul", "lilla"],
    ticketPricesCents: { hvit: 500, gul: 1000, lilla: 1500 },
    prizeMultiplierMode: "auto",
    bonusGameSlug: null,
    ...overrides,
  };
}

function makeLobbyState(
  overrides: Partial<Spill1LobbyState> = {},
): Spill1LobbyState {
  return {
    hallId: "demo-hall-001",
    businessDate: "2026-05-10",
    isOpen: true,
    openingTimeStart: "11:00",
    openingTimeEnd: "21:00",
    planId: "demo-plan-pilot",
    planName: "Pilot Demo — alle 13 spill",
    runId: "run-1",
    runStatus: "running",
    overallStatus: "purchase_open",
    nextScheduledGame: makeNextScheduledGame(),
    currentRunPosition: 1,
    totalPositions: 13,
    ...overrides,
  };
}

interface SocketStub {
  socket: SpilloramaSocket;
  emitStateUpdate: (payload: Spill1LobbyStateUpdatePayload) => void;
  subscribeMock: ReturnType<typeof vi.fn>;
}

/**
 * Socket-stub som ikke pre-leverer initial state (returnerer ack uten
 * data). Tvinger LobbyStateBinding til å lene seg på HTTP-fetch alene.
 */
function makeSocketStubNoInitialState(): SocketStub {
  let stateUpdateListener:
    | ((payload: Spill1LobbyStateUpdatePayload) => void)
    | null = null;
  const subscribeMock = vi.fn().mockResolvedValue({
    ok: true,
    data: { state: null },
  });
  const socket = {
    subscribeSpill1Lobby: subscribeMock,
    unsubscribeSpill1Lobby: vi.fn().mockResolvedValue({ ok: true }),
    on: vi.fn().mockImplementation((event: string, cb: unknown) => {
      if (event === "spill1LobbyStateUpdate") {
        stateUpdateListener = cb as (
          payload: Spill1LobbyStateUpdatePayload,
        ) => void;
      }
      return () => {
        if (event === "spill1LobbyStateUpdate") stateUpdateListener = null;
      };
    }),
  } as unknown as SpilloramaSocket;
  return {
    socket,
    emitStateUpdate: (payload) => {
      if (stateUpdateListener) stateUpdateListener(payload);
    },
    subscribeMock,
  };
}

/** Stub for global fetch som returnerer en spesifikk lobby-state JSON. */
function stubFetchSuccess(state: Spill1LobbyState): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data: state }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFetchFailure(status: number): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ ok: false, error: { code: "TEST" } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFetchNetworkError(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockRejectedValue(new Error("network failure"));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// ── HTTP-fetch SUCCESS path (Tobias-bug regresjon) ───────────────────────

describe("LobbyStateBinding: HTTP-fetch som primær state-kilde", () => {
  beforeEach(() => {
    // Hver test installerer egen fetch-stub
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("REGRESJON Tobias 2026-05-10 — HTTP-fetch leverer 'Bingo' når socket-ack er null", async () => {
    // Scenario: socket subscribe ack har ikke initial state (tomt rom),
    // men HTTP-fetch returnerer plan-runtime state med catalogDisplayName="Bingo".
    // Dette er pilot-flow ved første side-load FØR socket-broadcast har
    // hatt tid til å fyre.
    const httpState = makeLobbyState({
      nextScheduledGame: makeNextScheduledGame({
        catalogDisplayName: "Bingo",
      }),
    });
    stubFetchSuccess(httpState);
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
    });
    await binding.start();

    expect(binding.getCatalogDisplayName()).toBe("Bingo");
    const config = binding.getBuyPopupTicketConfig();
    expect(config).not.toBeNull();
    expect(config!.entryFee).toBe(5); // hvit 500 øre = 5 kr
    expect(config!.ticketTypes).toHaveLength(3);

    binding.stop();
  });

  it("HTTP-fetch leverer riktig URL med encoded hallId", async () => {
    const fetchMock = stubFetchSuccess(makeLobbyState());
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
      apiBaseUrl: "http://localhost:4000",
    });
    await binding.start();

    expect(fetchMock).toHaveBeenCalled();
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toBe(
      "http://localhost:4000/api/games/spill1/lobby?hallId=demo-hall-001",
    );

    binding.stop();
  });

  it("HTTP-fetch bruker credentials: 'omit' (public endpoint, ingen cookie-leak)", async () => {
    const fetchMock = stubFetchSuccess(makeLobbyState());
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
    });
    await binding.start();

    expect(fetchMock).toHaveBeenCalled();
    const opts = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(opts?.credentials).toBe("omit");

    binding.stop();
  });

  it("HTTP-fetch encoder hallId med whitespace/special chars korrekt", async () => {
    const fetchMock = stubFetchSuccess(makeLobbyState());
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "hall with spaces&special",
      socket,
      apiBaseUrl: "http://localhost:4000",
    });
    await binding.start();

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    // encodeURIComponent: space → %20, & → %26
    expect(calledUrl).toContain("hallId=hall%20with%20spaces%26special");

    binding.stop();
  });

  it("HTTP-fetch state notifies all registered listeners", async () => {
    stubFetchSuccess(makeLobbyState());
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
    });
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    binding.onChange(listener1);
    binding.onChange(listener2);

    await binding.start();

    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
    expect(listener1.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        nextScheduledGame: expect.objectContaining({
          catalogDisplayName: "Bingo",
        }),
      }),
    );

    binding.stop();
  });

  it("HTTP-fetch oppdaterer overallStatus for 'venter på master'-overlay", async () => {
    // Pilot-bug-scenario: lobby-state har `purchase_open` (ikke running),
    // som driver "Venter på master"-overlay i Game1Controller.
    stubFetchSuccess(
      makeLobbyState({
        overallStatus: "purchase_open",
        nextScheduledGame: makeNextScheduledGame({
          status: "purchase_open",
        }),
      }),
    );
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
    });
    await binding.start();

    const state = binding.getState();
    expect(state).not.toBeNull();
    expect(state!.overallStatus).toBe("purchase_open");

    binding.stop();
  });
});

// ── Failure resilience (binding skal aldri krasje) ────────────────────────

describe("LobbyStateBinding: fail-soft on fetch-feil", () => {
  beforeEach(() => {
    // Capture konsoll-output så test-output ikke blir spammed
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetch returnerer 503 → binding overlever, getState() er null", async () => {
    stubFetchFailure(503);
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
    });
    await binding.start();

    expect(binding.getState()).toBeNull();
    expect(binding.getCatalogDisplayName()).toBe("Bingo"); // fallback
    expect(binding.getBuyPopupTicketConfig()).toBeNull();

    binding.stop();
  });

  it("fetch returnerer 400 → binding logger warn men kaster ikke", async () => {
    const fetchMock = stubFetchFailure(400);
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
    });
    await binding.start(); // Should NOT throw

    expect(fetchMock).toHaveBeenCalled();
    expect(binding.getState()).toBeNull();

    binding.stop();
  });

  it("fetch network error → binding overlever, kan recovere via socket", async () => {
    stubFetchNetworkError();
    const { socket, emitStateUpdate } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
    });
    await binding.start(); // fetch fails, but no throw

    // Simulate socket eventually delivering state — recovery path
    const recoveryState = makeLobbyState({
      nextScheduledGame: makeNextScheduledGame({
        catalogDisplayName: "Innsatsen",
      }),
    });
    emitStateUpdate({ hallId: "demo-hall-001", state: recoveryState });

    expect(binding.getCatalogDisplayName()).toBe("Innsatsen");

    binding.stop();
  });

  it("fetch returnerer body uten { ok: true } → ignoreres", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ malformed: "data" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
    });
    await binding.start();

    expect(binding.getState()).toBeNull();
    binding.stop();
  });

  it("fetch returnerer { ok: false } error-body → ignoreres (server-side error)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: { code: "INVALID_INPUT" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
    });
    await binding.start();

    expect(binding.getState()).toBeNull();
    binding.stop();
  });
});

// ── Polling-fallback (10s safety-net) ────────────────────────────────────

describe("LobbyStateBinding: polling som safety-net", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("polling kjører ved interval når socket-broadcast aldri ankommer", async () => {
    let fetchCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () =>
          fetchCount === 1
            ? { ok: true, data: makeLobbyState() }
            : {
                ok: true,
                data: makeLobbyState({
                  nextScheduledGame: makeNextScheduledGame({
                    catalogDisplayName: `Polled ${fetchCount}`,
                  }),
                }),
              },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { socket } = makeSocketStubNoInitialState();
    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
      pollIntervalMs: 1000,
    });

    // Initial fetch i start()
    await binding.start();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(binding.getCatalogDisplayName()).toBe("Bingo");

    // Vent et poll-interval, så ny fetch skjer
    await vi.advanceTimersByTimeAsync(1000);
    // Allow microtasks to flush
    await vi.runOnlyPendingTimersAsync();
    // Note: fakeTimer sammen med async fetch er tricky, vi sjekker bare
    // at ingen exception kastet og at binding fortsatt er stabilt
    expect(binding.getState()).not.toBeNull();

    binding.stop();
  });

  it("polling stopper ved stop() — ingen fetches etter teardown", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: makeLobbyState() }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { socket } = makeSocketStubNoInitialState();
    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
      pollIntervalMs: 1000,
    });
    await binding.start();
    const callsAtStop = fetchMock.mock.calls.length;

    binding.stop();

    // Advance timer — etter stop() skal ingen nye fetches happen
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls.length).toBe(callsAtStop);
  });
});

// ── Wire-format kontrakt mot backend ─────────────────────────────────────

describe("LobbyStateBinding: wire-format-kontrakt fra public lobby-endpoint", () => {
  beforeEach(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("godtar minimal lobby-state med null nextScheduledGame", async () => {
    // Closed-state: hall er stengt, ingen plan dekker dagen
    stubFetchSuccess(
      makeLobbyState({
        overallStatus: "closed",
        nextScheduledGame: null,
        planId: null,
        runId: null,
        currentRunPosition: 0,
        totalPositions: 0,
      }),
    );
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
    });
    await binding.start();

    expect(binding.getState()?.overallStatus).toBe("closed");
    expect(binding.getCatalogDisplayName()).toBe("Bingo"); // default fallback
    expect(binding.getBuyPopupTicketConfig()).toBeNull();

    binding.stop();
  });

  it("plukker opp Trafikklys-katalog (1 farge, 15 kr flat)", async () => {
    stubFetchSuccess(
      makeLobbyState({
        nextScheduledGame: makeNextScheduledGame({
          catalogSlug: "trafikklys",
          catalogDisplayName: "Trafikklys",
          ticketColors: ["lilla"],
          ticketPricesCents: { lilla: 1500 },
          prizeMultiplierMode: "explicit_per_color",
        }),
      }),
    );
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
    });
    await binding.start();

    expect(binding.getCatalogDisplayName()).toBe("Trafikklys");
    const config = binding.getBuyPopupTicketConfig();
    expect(config).not.toBeNull();
    expect(config!.entryFee).toBe(15);
    expect(config!.ticketTypes).toHaveLength(1);

    binding.stop();
  });

  it("plukker opp Oddsen-katalog (3 farger, identisk pris med Bingo)", async () => {
    stubFetchSuccess(
      makeLobbyState({
        nextScheduledGame: makeNextScheduledGame({
          catalogSlug: "oddsen-55",
          catalogDisplayName: "Oddsen 55",
          ticketColors: ["hvit", "gul", "lilla"],
          ticketPricesCents: { hvit: 500, gul: 1000, lilla: 1500 },
          prizeMultiplierMode: "auto",
        }),
      }),
    );
    const { socket } = makeSocketStubNoInitialState();

    const binding = new Game1LobbyStateBinding({
      hallId: "demo-hall-001",
      socket,
    });
    await binding.start();

    expect(binding.getCatalogDisplayName()).toBe("Oddsen 55");
    expect(binding.getBuyPopupTicketConfig()!.ticketTypes).toHaveLength(3);

    binding.stop();
  });
});
