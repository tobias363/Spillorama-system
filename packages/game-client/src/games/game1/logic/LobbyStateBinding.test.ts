/**
 * @vitest-environment happy-dom
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

/**
 * Spillerklient-rebuild Fase 2 (2026-05-10): Default `nextScheduledGame`
 * inkluderer ticket-config (`ticketColors` + `ticketPricesCents`) som
 * representerer en standard 3-farge Bingo-rad (hvit 5kr / gul 10kr /
 * lilla 15kr) per `SPILL_REGLER_OG_PAYOUT.md` §2. Auto-multiplikator er
 * allerede anvendt i prisene.
 */
function makeNextScheduledGame(
  overrides: Partial<Spill1LobbyNextGame> = {},
): Spill1LobbyNextGame {
  return {
    itemId: "item-1",
    position: 1,
    catalogSlug: "bingo",
    catalogDisplayName: "Bingo",
    status: "purchase_open",
    scheduledGameId: null,
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
    hallId: "hall-1",
    businessDate: "2026-05-10",
    isOpen: true,
    openingTimeStart: "11:00",
    openingTimeEnd: "21:00",
    planId: "plan-1",
    planName: "Test plan",
    runId: null,
    runStatus: null,
    overallStatus: "purchase_open",
    nextScheduledGame: makeNextScheduledGame(),
    currentRunPosition: 1,
    totalPositions: 13,
    ...overrides,
  };
}

interface SocketStubControls {
  socket: SpilloramaSocket;
  emitStateUpdate: (payload: Spill1LobbyStateUpdatePayload) => void;
  subscribeMock: ReturnType<typeof vi.fn>;
  unsubscribeMock: ReturnType<typeof vi.fn>;
}

function makeSocketStub(initialAck?: Spill1LobbyState | null): SocketStubControls {
  let stateUpdateListener:
    | ((payload: Spill1LobbyStateUpdatePayload) => void)
    | null = null;
  const subscribeMock = vi.fn().mockResolvedValue({
    ok: true,
    data: { state: initialAck ?? null },
  });
  const unsubscribeMock = vi.fn().mockResolvedValue({
    ok: true,
    data: { unsubscribed: true },
  });
  const socket = {
    subscribeSpill1Lobby: subscribeMock,
    unsubscribeSpill1Lobby: unsubscribeMock,
    on: vi.fn().mockImplementation((event: string, cb: unknown) => {
      if (event === "spill1LobbyStateUpdate") {
        stateUpdateListener = cb as (
          payload: Spill1LobbyStateUpdatePayload,
        ) => void;
      }
      return () => {
        if (event === "spill1LobbyStateUpdate") {
          stateUpdateListener = null;
        }
      };
    }),
  } as unknown as SpilloramaSocket;
  return {
    socket,
    emitStateUpdate: (payload) => {
      if (stateUpdateListener) {
        stateUpdateListener(payload);
      }
    },
    subscribeMock,
    unsubscribeMock,
  };
}

describe("Game1LobbyStateBinding", () => {
  beforeEach(() => {
    // happy-dom needs a window.location for binding default-baseURL
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ ok: false }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returnerer 'Bingo' som default når ingen state er hentet", () => {
    const { socket } = makeSocketStub();
    const binding = new Game1LobbyStateBinding({ hallId: "hall-1", socket });
    expect(binding.getCatalogDisplayName()).toBe("Bingo");
    binding.stop();
  });

  it("emitter initial state synkront til onChange-listener når state allerede er kjent", async () => {
    const initial = makeLobbyState();
    const { socket } = makeSocketStub(initial);
    const binding = new Game1LobbyStateBinding({ hallId: "hall-1", socket });
    await binding.start();

    const listener = vi.fn();
    binding.onChange(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        nextScheduledGame: expect.objectContaining({
          catalogDisplayName: "Bingo",
        }),
      }),
    );
    binding.stop();
  });

  it("oppdaterer state når socket-broadcast `spill1LobbyStateUpdate` ankommer", async () => {
    const initial = makeLobbyState({
      nextScheduledGame: makeNextScheduledGame({
        scheduledStartTime: null,
      }),
    });
    const { socket, emitStateUpdate } = makeSocketStub(initial);
    const binding = new Game1LobbyStateBinding({ hallId: "hall-1", socket });
    await binding.start();

    const listener = vi.fn();
    binding.onChange(listener);
    listener.mockClear();

    const updated = makeLobbyState({
      nextScheduledGame: makeNextScheduledGame({
        itemId: "item-2",
        position: 2,
        catalogSlug: "innsatsen",
        catalogDisplayName: "Innsatsen",
        scheduledStartTime: null,
      }),
    });
    emitStateUpdate({ hallId: "hall-1", state: updated });

    expect(binding.getCatalogDisplayName()).toBe("Innsatsen");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        nextScheduledGame: expect.objectContaining({
          catalogDisplayName: "Innsatsen",
        }),
      }),
    );
    binding.stop();
  });

  it("ignorerer broadcasts for andre haller", async () => {
    const { socket, emitStateUpdate } = makeSocketStub(makeLobbyState());
    const binding = new Game1LobbyStateBinding({ hallId: "hall-1", socket });
    await binding.start();

    const listener = vi.fn();
    binding.onChange(listener);
    listener.mockClear();

    const otherHallState = makeLobbyState({
      hallId: "hall-2",
      nextScheduledGame: makeNextScheduledGame({
        itemId: "item-x",
        catalogSlug: "oddsen-55",
        catalogDisplayName: "Oddsen 55",
        scheduledStartTime: null,
      }),
    });
    emitStateUpdate({ hallId: "hall-2", state: otherHallState });

    expect(listener).not.toHaveBeenCalled();
    expect(binding.getCatalogDisplayName()).toBe("Bingo"); // stays on hall-1's value
    binding.stop();
  });

  it("returnerer 'Bingo' når nextScheduledGame er null (closed/finished state)", async () => {
    const closed = makeLobbyState({
      overallStatus: "closed",
      nextScheduledGame: null,
    });
    const { socket } = makeSocketStub(closed);
    const binding = new Game1LobbyStateBinding({ hallId: "hall-1", socket });
    await binding.start();
    expect(binding.getCatalogDisplayName()).toBe("Bingo");
    binding.stop();
  });

  it("stop() unsubscriber socket-rom og rydder opp polling-timer", async () => {
    const { socket, unsubscribeMock } = makeSocketStub(makeLobbyState());
    const binding = new Game1LobbyStateBinding({
      hallId: "hall-1",
      socket,
      pollIntervalMs: 1000,
    });
    await binding.start();

    binding.stop();
    expect(unsubscribeMock).toHaveBeenCalledWith("hall-1");
  });

  it("er idempotent — flere start() / stop() er trygge", async () => {
    const { socket, subscribeMock } = makeSocketStub(makeLobbyState());
    const binding = new Game1LobbyStateBinding({ hallId: "hall-1", socket });
    await binding.start();
    await binding.start(); // second call should be no-op
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    binding.stop();
    binding.stop(); // second stop should be no-op
  });

  // ── Fase 2 (2026-05-10): bongfarger fra plan-runtime catalog ────────────
  describe("getBuyPopupTicketConfig (Fase 2 — bongfarger fra plan-runtime)", () => {
    it("returnerer 3-farge-config for standard Bingo", async () => {
      const initial = makeLobbyState();
      const { socket } = makeSocketStub(initial);
      const binding = new Game1LobbyStateBinding({ hallId: "hall-1", socket });
      await binding.start();

      const config = binding.getBuyPopupTicketConfig();
      expect(config).not.toBeNull();
      expect(config!.entryFee).toBe(5);
      expect(config!.ticketTypes).toHaveLength(3);
      // Backend-canonical names matcher `spill1VariantMapper.COLOR_SLUG_TO_NAME`
      // — kritisk for at `bet:arm`-resolution skal lykkes.
      expect(config!.ticketTypes.map((t) => t.name)).toEqual([
        "Small White",
        "Small Yellow",
        "Small Purple",
      ]);
      binding.stop();
    });

    it("returnerer 1-farge-config for Trafikklys", async () => {
      const initial = makeLobbyState({
        nextScheduledGame: makeNextScheduledGame({
          catalogSlug: "trafikklys",
          catalogDisplayName: "Trafikklys",
          ticketColors: ["lilla"],
          ticketPricesCents: { lilla: 1500 },
          prizeMultiplierMode: "explicit_per_color",
        }),
      });
      const { socket } = makeSocketStub(initial);
      const binding = new Game1LobbyStateBinding({ hallId: "hall-1", socket });
      await binding.start();

      const config = binding.getBuyPopupTicketConfig();
      expect(config).not.toBeNull();
      expect(config!.entryFee).toBe(15);
      expect(config!.ticketTypes).toHaveLength(1);
      expect(config!.ticketTypes[0].name).toBe("Small Purple");
      binding.stop();
    });

    it("returnerer null når nextScheduledGame er null (closed/finished)", async () => {
      const closed = makeLobbyState({
        overallStatus: "closed",
        nextScheduledGame: null,
      });
      const { socket } = makeSocketStub(closed);
      const binding = new Game1LobbyStateBinding({ hallId: "hall-1", socket });
      await binding.start();

      expect(binding.getBuyPopupTicketConfig()).toBeNull();
      binding.stop();
    });

    it("oppdateres når socket-broadcast bytter til ny katalog-rad", async () => {
      const initial = makeLobbyState();
      const { socket, emitStateUpdate } = makeSocketStub(initial);
      const binding = new Game1LobbyStateBinding({ hallId: "hall-1", socket });
      await binding.start();

      // Verifiser initial 3-farge state
      expect(binding.getBuyPopupTicketConfig()!.ticketTypes).toHaveLength(3);

      // Master skifter til Trafikklys
      const trafikklys = makeLobbyState({
        nextScheduledGame: makeNextScheduledGame({
          catalogSlug: "trafikklys",
          catalogDisplayName: "Trafikklys",
          ticketColors: ["lilla"],
          ticketPricesCents: { lilla: 1500 },
          prizeMultiplierMode: "explicit_per_color",
        }),
      });
      emitStateUpdate({ hallId: "hall-1", state: trafikklys });

      const config = binding.getBuyPopupTicketConfig();
      expect(config!.ticketTypes).toHaveLength(1);
      expect(config!.entryFee).toBe(15);
      binding.stop();
    });
  });
});
