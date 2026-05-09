/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Game1LobbyStateBinding } from "./LobbyStateBinding.js";
import type {
  SpilloramaSocket,
  Spill1LobbyStateUpdatePayload,
} from "../../../net/SpilloramaSocket.js";
import type { Spill1LobbyState } from "@spillorama/shared-types/api";

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
    nextScheduledGame: {
      itemId: "item-1",
      position: 1,
      catalogSlug: "bingo",
      catalogDisplayName: "Bingo",
      status: "purchase_open",
      scheduledGameId: null,
      scheduledStartTime: "2026-05-10T13:00:00Z",
      scheduledEndTime: null,
      actualStartTime: null,
    },
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
      nextScheduledGame: {
        itemId: "item-1",
        position: 1,
        catalogSlug: "bingo",
        catalogDisplayName: "Bingo",
        status: "purchase_open",
        scheduledGameId: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
        actualStartTime: null,
      },
    });
    const { socket, emitStateUpdate } = makeSocketStub(initial);
    const binding = new Game1LobbyStateBinding({ hallId: "hall-1", socket });
    await binding.start();

    const listener = vi.fn();
    binding.onChange(listener);
    listener.mockClear();

    const updated = makeLobbyState({
      nextScheduledGame: {
        itemId: "item-2",
        position: 2,
        catalogSlug: "innsatsen",
        catalogDisplayName: "Innsatsen",
        status: "purchase_open",
        scheduledGameId: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
        actualStartTime: null,
      },
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
      nextScheduledGame: {
        itemId: "item-x",
        position: 1,
        catalogSlug: "oddsen-55",
        catalogDisplayName: "Oddsen 55",
        status: "purchase_open",
        scheduledGameId: null,
        scheduledStartTime: null,
        scheduledEndTime: null,
        actualStartTime: null,
      },
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
});
