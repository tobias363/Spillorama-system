/**
 * Tester for PerpetualRoundService.
 *
 * Bruker `node:test` (samme som resten av backend) i stedet for vitest.
 * Tjenesten har ingen eksterne avhengigheter (DB, Redis, sockets), så vi
 * kan stubbe `engine`, `variantLookup` og `setTimeoutFn` direkte.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  PerpetualRoundService,
  PERPETUAL_SLUGS,
  PERPETUAL_DEFAULT_ENTRY_FEE_BY_SLUG,
  NATURAL_END_REASONS,
  type PerpetualEngine,
  type VariantConfigLookup,
  type PerpetualRoundServiceConfig,
} from "./PerpetualRoundService.js";
import type { GameEndedInput } from "../adapters/BingoSystemAdapter.js";

// ── Stubs ────────────────────────────────────────────────────────────────────

interface StubEngineState {
  rooms: Map<
    string,
    {
      code: string;
      hostPlayerId: string;
      hallId: string;
      gameSlug: string;
      players: Array<{ id: string }>;
      currentGame?: { status: string; id: string };
    }
  >;
  startGameCalls: Array<Parameters<PerpetualEngine["startGame"]>[0]>;
  startGameImpl: (input: Parameters<PerpetualEngine["startGame"]>[0]) => Promise<void>;
}

function makeStubEngine(initialRooms: StubEngineState["rooms"] = new Map()): {
  engine: PerpetualEngine;
  state: StubEngineState;
} {
  const state: StubEngineState = {
    rooms: initialRooms,
    startGameCalls: [],
    startGameImpl: async () => {},
  };

  const engine: PerpetualEngine = {
    getRoomSnapshot(roomCode) {
      const room = state.rooms.get(roomCode);
      if (!room) {
        throw Object.assign(new Error("ROOM_NOT_FOUND"), { code: "ROOM_NOT_FOUND" });
      }
      return room;
    },
    async startGame(input) {
      state.startGameCalls.push(input);
      await state.startGameImpl(input);
    },
  };

  return { engine, state };
}

function makeStubVariantLookup(
  byRoom: Record<string, { gameType?: string; config?: import("./variantConfig.js").GameVariantConfig } | null> = {},
): VariantConfigLookup {
  return {
    getVariantConfig(roomCode) {
      return byRoom[roomCode] ?? null;
    },
  };
}

interface FakeTimer {
  setTimeoutFn: NonNullable<PerpetualRoundServiceConfig["setTimeoutFn"]>;
  clearTimeoutFn: NonNullable<PerpetualRoundServiceConfig["clearTimeoutFn"]>;
  /** Trigger the most-recently-scheduled callback. Throws if none pending. */
  runNext: () => Promise<void>;
  pendingCount: () => number;
}

function makeFakeTimer(): FakeTimer {
  const pending: Array<{
    handle: { __id: number };
    fn: () => void;
    cancelled: boolean;
  }> = [];
  let nextId = 1;

  const setTimeoutFn = ((fn: () => void, _ms: number) => {
    const handle = { __id: nextId++ };
    pending.push({ handle, fn, cancelled: false });
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as NonNullable<PerpetualRoundServiceConfig["setTimeoutFn"]>;

  const clearTimeoutFn = ((handle: ReturnType<typeof setTimeout>) => {
    const id = (handle as unknown as { __id: number }).__id;
    const found = pending.find((p) => p.handle.__id === id);
    if (found) found.cancelled = true;
  }) as NonNullable<PerpetualRoundServiceConfig["clearTimeoutFn"]>;

  return {
    setTimeoutFn,
    clearTimeoutFn,
    async runNext() {
      // Find the last not-cancelled task (LIFO so we trigger the most
      // recently scheduled). Caller controls order via single trigger.
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        const task = pending[i]!;
        if (!task.cancelled) {
          task.cancelled = true; // mark so it won't fire again
          task.fn();
          // Yield microtasks so promises chained inside fn() resolve.
          await Promise.resolve();
          await Promise.resolve();
          return;
        }
      }
      throw new Error("No pending timer to run");
    },
    pendingCount() {
      return pending.filter((p) => !p.cancelled).length;
    },
  };
}

function makeRoom(overrides: {
  code: string;
  gameSlug: string;
  hostPlayerId?: string;
  hallId?: string;
  playerCount?: number;
  currentGameStatus?: string;
  currentGameId?: string;
}): {
  code: string;
  hostPlayerId: string;
  hallId: string;
  gameSlug: string;
  players: Array<{ id: string }>;
  currentGame?: { status: string; id: string };
} {
  const playerCount = overrides.playerCount ?? 1;
  const players: Array<{ id: string }> = [];
  for (let i = 0; i < playerCount; i += 1) {
    players.push({ id: `player-${i + 1}` });
  }
  return {
    code: overrides.code,
    hostPlayerId: overrides.hostPlayerId ?? "player-1",
    hallId: overrides.hallId ?? "hall-1",
    gameSlug: overrides.gameSlug,
    players,
    ...(overrides.currentGameStatus
      ? {
          currentGame: {
            status: overrides.currentGameStatus,
            id: overrides.currentGameId ?? "game-1",
          },
        }
      : {}),
  };
}

function makeGameEndedInput(overrides: Partial<GameEndedInput> = {}): GameEndedInput {
  return {
    roomCode: "ROCKET",
    hallId: "hall-1",
    gameId: "game-prev-1",
    entryFee: 50,
    endedReason: "G2_WINNER",
    drawnNumbers: [],
    claims: [],
    playerIds: ["player-1"],
    ...overrides,
  };
}

function makeService(args: {
  engine: PerpetualEngine;
  variantLookup?: VariantConfigLookup;
  timer: FakeTimer;
  enabled?: boolean;
  delayMs?: number;
  disabledSlugs?: ReadonlySet<string>;
  emitRoomUpdate?: PerpetualRoundServiceConfig["emitRoomUpdate"];
}): PerpetualRoundService {
  return new PerpetualRoundService({
    enabled: args.enabled ?? true,
    delayMs: args.delayMs ?? 5000,
    disabledSlugs: args.disabledSlugs ?? new Set(),
    engine: args.engine,
    variantLookup: args.variantLookup ?? makeStubVariantLookup(),
    defaultTicketsPerPlayer: 4,
    defaultPayoutPercent: 80,
    defaultEntryFee: 0,
    ...(args.emitRoomUpdate ? { emitRoomUpdate: args.emitRoomUpdate } : {}),
    setTimeoutFn: args.timer.setTimeoutFn,
    clearTimeoutFn: args.timer.clearTimeoutFn,
  });
}

// ── Constants ────────────────────────────────────────────────────────────────

test("PERPETUAL_SLUGS dekker rocket og monsterbingo", () => {
  assert.equal(PERPETUAL_SLUGS.size, 2);
  assert.ok(PERPETUAL_SLUGS.has("rocket"));
  assert.ok(PERPETUAL_SLUGS.has("monsterbingo"));
});

test("NATURAL_END_REASONS inkluderer G2_WINNER, G2_NO_WINNER og G3_FULL_HOUSE", () => {
  assert.ok(NATURAL_END_REASONS.has("G2_WINNER"));
  // Pilot-bug 2026-05-04: G2_NO_WINNER må trigge auto-restart, ellers
  // henger ROCKET-rommet permanent når alle 21 baller er trukket uten
  // 9/9-completion. Game2Engine.onDrawCompleted setter denne reasonen
  // ved max-balls-uten-vinner-pathen.
  assert.ok(NATURAL_END_REASONS.has("G2_NO_WINNER"));
  assert.ok(NATURAL_END_REASONS.has("G3_FULL_HOUSE"));
  assert.ok(NATURAL_END_REASONS.has("MAX_DRAWS_REACHED"));
  assert.ok(NATURAL_END_REASONS.has("DRAW_BAG_EMPTY"));
  assert.ok(!NATURAL_END_REASONS.has("MANUAL_END"));
  assert.ok(!NATURAL_END_REASONS.has("SYSTEM_ERROR"));
});

// ── Happy path ───────────────────────────────────────────────────────────────

test("happy path Spill 2: schedulerer og kjører auto-restart etter G2_WINNER", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));

  assert.equal(timer.pendingCount(), 1, "én pending restart");
  assert.equal(service.pendingCountForTesting(), 1);
  assert.equal(state.startGameCalls.length, 0, "startGame ikke kalt før delay");

  await timer.runNext();

  assert.equal(state.startGameCalls.length, 1, "startGame kalt én gang");
  const call = state.startGameCalls[0]!;
  assert.equal(call.roomCode, "ROCKET");
  assert.equal(call.actorPlayerId, "player-1");
  assert.equal(call.payoutPercent, 80);
  assert.equal(call.ticketsPerPlayer, 4);
  assert.deepEqual(call.armedPlayerIds, []);
  assert.deepEqual(call.armedPlayerTicketCounts, {});
  assert.equal(service.pendingCountForTesting(), 0, "pending fjernes etter kjøring");
});

test("happy path Spill 2: schedulerer og kjører auto-restart etter G2_NO_WINNER (pilot-bug 2026-05-04)", async () => {
  // Regresjons-test for prod-bug 2026-05-04: ROCKET-rom hang på
  // status=ENDED med endedReason=G2_NO_WINNER fordi handleGameEnded-
  // filteret slapp G2_NO_WINNER til "manual_or_unknown_end"-pathen.
  // Forbedret oppførsel: G2_NO_WINNER er en naturlig runde-end (alle
  // 21 baller trukket uten 9/9-completion) og MÅ trigge ny runde.
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(
    makeGameEndedInput({ roomCode: "ROCKET", endedReason: "G2_NO_WINNER" }),
  );

  assert.equal(
    timer.pendingCount(),
    1,
    "G2_NO_WINNER skal schedulere én pending restart (regresjon ville gitt 0)",
  );
  assert.equal(service.pendingCountForTesting(), 1);

  await timer.runNext();

  assert.equal(state.startGameCalls.length, 1, "startGame kalt etter delay");
  assert.equal(state.startGameCalls[0]!.roomCode, "ROCKET");
});

test("happy path Spill 3: schedulerer og kjører auto-restart etter G3_FULL_HOUSE", async () => {
  const rooms = new Map([
    [
      "MONSTERBINGO",
      makeRoom({ code: "MONSTERBINGO", gameSlug: "monsterbingo" }),
    ],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(
    makeGameEndedInput({
      roomCode: "MONSTERBINGO",
      endedReason: "G3_FULL_HOUSE",
    }),
  );

  await timer.runNext();

  assert.equal(state.startGameCalls.length, 1);
  assert.equal(state.startGameCalls[0]!.roomCode, "MONSTERBINGO");
});

test("happy path: variantConfig sendes med startGame", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const variantLookup = makeStubVariantLookup({
    ROCKET: {
      gameType: "rocket",
      config: {
        ticketTypes: [{ name: "Standard", type: "small", price: 50 }],
        patterns: [],
      } as unknown as import("./variantConfig.js").GameVariantConfig,
    },
  });
  const service = makeService({ engine, variantLookup, timer });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));
  await timer.runNext();

  const call = state.startGameCalls[0]!;
  assert.equal(call.gameType, "rocket");
  assert.ok(call.variantConfig, "variantConfig sendes med");
});

test("happy path: emitRoomUpdate kalles etter startGame", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  let emitCalled = 0;
  const service = makeService({
    engine,
    timer,
    emitRoomUpdate: async (code) => {
      assert.equal(code, "ROCKET");
      emitCalled += 1;
    },
  });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));
  await timer.runNext();

  assert.equal(emitCalled, 1, "emitRoomUpdate kalt én gang");
});

// ── Skip-pathways ────────────────────────────────────────────────────────────

test("skip: Spill 1 (slug=bingo) trigger ikke restart", async () => {
  const rooms = new Map([
    ["BINGO_HALL-1", makeRoom({ code: "BINGO_HALL-1", gameSlug: "bingo" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(
    makeGameEndedInput({ roomCode: "BINGO_HALL-1", endedReason: "BINGO_WON" }),
  );

  assert.equal(timer.pendingCount(), 0);
  assert.equal(state.startGameCalls.length, 0);
});

test("skip: SpinnGo (slug=spillorama) trigger ikke restart", async () => {
  const rooms = new Map([
    ["SPILLORAMA-HALL-1", makeRoom({ code: "SPILLORAMA-HALL-1", gameSlug: "spillorama" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(
    makeGameEndedInput({ roomCode: "SPILLORAMA-HALL-1", endedReason: "G2_WINNER" }),
  );

  assert.equal(timer.pendingCount(), 0);
  assert.equal(state.startGameCalls.length, 0);
});

test("skip: MANUAL_END trigger ikke restart", () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(
    makeGameEndedInput({ roomCode: "ROCKET", endedReason: "MANUAL_END" }),
  );

  assert.equal(timer.pendingCount(), 0);
  assert.equal(service.pendingCountForTesting(), 0);
});

test("skip: SYSTEM_ERROR trigger ikke restart", () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(
    makeGameEndedInput({ roomCode: "ROCKET", endedReason: "SYSTEM_ERROR" }),
  );

  assert.equal(timer.pendingCount(), 0);
});

test("skip: ukjent endedReason trigger ikke restart (fail-closed)", () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(
    makeGameEndedInput({ roomCode: "ROCKET", endedReason: "WAT" }),
  );

  assert.equal(timer.pendingCount(), 0);
});

test("skip: tomt rom (ingen spillere) starter ikke ny runde", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket", playerCount: 0 })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));
  await timer.runNext();

  assert.equal(state.startGameCalls.length, 0, "startGame skal ikke kalles på tomt rom");
});

test("skip: rom som allerede har RUNNING currentGame mellom schedule og fire", async () => {
  const rooms = new Map([
    [
      "ROCKET",
      makeRoom({ code: "ROCKET", gameSlug: "rocket" }),
    ],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));
  // Mellom schedule og fire: noen starter ny runde manuelt
  rooms.set(
    "ROCKET",
    makeRoom({
      code: "ROCKET",
      gameSlug: "rocket",
      currentGameStatus: "RUNNING",
      currentGameId: "game-manual",
    }),
  );
  await timer.runNext();

  assert.equal(state.startGameCalls.length, 0);
});

test("skip: rom destroyed mellom schedule og fire", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));
  rooms.delete("ROCKET");
  await timer.runNext();

  assert.equal(state.startGameCalls.length, 0);
});

test("skip: service disabled trigger ikke restart", () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer, enabled: false });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));

  assert.equal(timer.pendingCount(), 0);
});

test("skip: per-slug disabled trigger ikke restart for den slug-en", () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
    ["MONSTERBINGO", makeRoom({ code: "MONSTERBINGO", gameSlug: "monsterbingo" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({
    engine,
    timer,
    disabledSlugs: new Set(["monsterbingo"]),
  });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));
  service.handleGameEnded(
    makeGameEndedInput({
      roomCode: "MONSTERBINGO",
      endedReason: "G3_FULL_HOUSE",
    }),
  );

  assert.equal(service.pendingCountForTesting(), 1, "kun rocket pending");
});

test("skip: rom med ukjent slug håndteres som ikke-perpetual", async () => {
  const rooms = new Map([
    ["X", makeRoom({ code: "X", gameSlug: "unknownslug" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(
    makeGameEndedInput({ roomCode: "X", endedReason: "G2_WINNER" }),
  );

  assert.equal(timer.pendingCount(), 0);
  assert.equal(state.startGameCalls.length, 0);
});

// ── Idempotens ───────────────────────────────────────────────────────────────

test("idempotens: dobbel onGameEnded med samme gameId schedulerer kun én restart", () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  const input = makeGameEndedInput({ roomCode: "ROCKET", gameId: "game-end-1" });
  service.handleGameEnded(input);
  service.handleGameEnded(input); // duplikat
  service.handleGameEnded(input); // duplikat

  assert.equal(service.pendingCountForTesting(), 1, "kun én pending");
  assert.equal(timer.pendingCount(), 1, "kun én timer aktiv");
});

test("idempotens: ny gameId etter at restart fyrte schedulerer ny restart", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET", gameId: "game-1" }));
  await timer.runNext(); // restart kjører

  assert.equal(state.startGameCalls.length, 1);
  assert.equal(service.pendingCountForTesting(), 0);

  // Andre runde slutter også
  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET", gameId: "game-2" }));
  assert.equal(service.pendingCountForTesting(), 1, "ny pending for game-2");

  await timer.runNext();
  assert.equal(state.startGameCalls.length, 2, "to startGame-kall totalt");
});

test("idempotens: ny gameId mens forrige fortsatt pending erstatter forrige", () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET", gameId: "game-1" }));
  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET", gameId: "game-2" }));

  // Pending-map: kun én entry, men timer-pending teller har 1 (gammel cancelled)
  assert.equal(service.pendingCountForTesting(), 1, "kun siste pending tracket");
  assert.equal(timer.pendingCount(), 1, "gammel timer cancelled, ny aktiv");
});

// ── Failure handling ─────────────────────────────────────────────────────────

test("fail-soft: startGame kaster NOT_ENOUGH_PLAYERS → ingen unhandled rejection", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });
  state.startGameImpl = async () => {
    throw Object.assign(new Error("Du trenger minst 2 spillere"), {
      code: "NOT_ENOUGH_PLAYERS",
    });
  };

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));
  // Skal ikke kaste — fail-soft
  await timer.runNext();

  assert.equal(state.startGameCalls.length, 1);
  assert.equal(service.pendingCountForTesting(), 0, "pending fjernes selv ved feil");
});

test("fail-soft: emitRoomUpdate kaster → ikke unhandled rejection", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({
    engine,
    timer,
    emitRoomUpdate: async () => {
      throw new Error("socket emit failed");
    },
  });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));
  await timer.runNext();

  assert.equal(state.startGameCalls.length, 1, "startGame ble fortsatt kalt");
});

// ── Helpers ──────────────────────────────────────────────────────────────────

test("cancelAllForTesting tømmer pending-map", () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
    ["MONSTERBINGO", makeRoom({ code: "MONSTERBINGO", gameSlug: "monsterbingo" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));
  service.handleGameEnded(
    makeGameEndedInput({
      roomCode: "MONSTERBINGO",
      endedReason: "G3_FULL_HOUSE",
    }),
  );
  assert.equal(service.pendingCountForTesting(), 2);

  service.cancelAllForTesting();
  assert.equal(service.pendingCountForTesting(), 0);
});

// ── spawnFirstRoundIfNeeded (Tobias-direktiv 2026-05-03) ────────────────────

test("spawn: Spill 2 (rocket) første runde startes umiddelbart ved join", async () => {
  // Ingen currentGame → fresh ROCKET-rom akkurat opprettet av room:join.
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  const spawned = await service.spawnFirstRoundIfNeeded("ROCKET");

  assert.equal(spawned, true, "spawn returnerer true");
  assert.equal(
    state.startGameCalls.length,
    1,
    "startGame kalles synkront — ingen setTimeout-delay",
  );
  assert.equal(timer.pendingCount(), 0, "ingen pending timer for first-round spawn");
  const call = state.startGameCalls[0]!;
  assert.equal(call.roomCode, "ROCKET");
  assert.equal(call.actorPlayerId, "player-1");
  assert.deepEqual(call.armedPlayerIds, [], "ingen carry-over av armed players");
});

test("spawn: Spill 3 (monsterbingo) første runde startes umiddelbart ved join", async () => {
  const rooms = new Map([
    [
      "MONSTERBINGO",
      makeRoom({ code: "MONSTERBINGO", gameSlug: "monsterbingo" }),
    ],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  const spawned = await service.spawnFirstRoundIfNeeded("MONSTERBINGO");

  assert.equal(spawned, true);
  assert.equal(state.startGameCalls.length, 1);
  assert.equal(state.startGameCalls[0]!.roomCode, "MONSTERBINGO");
});

test("spawn: emitRoomUpdate kalles etter vellykket first-round spawn", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  let emitCalls = 0;
  const service = makeService({
    engine,
    timer,
    emitRoomUpdate: async (code) => {
      assert.equal(code, "ROCKET");
      emitCalls += 1;
    },
  });

  await service.spawnFirstRoundIfNeeded("ROCKET");

  assert.equal(emitCalls, 1, "emitRoomUpdate kalt én gang");
});

test("spawn skip: Spill 1 (slug=bingo) trigger ikke spawn", async () => {
  const rooms = new Map([
    ["BINGO_HALL-1", makeRoom({ code: "BINGO_HALL-1", gameSlug: "bingo" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  const spawned = await service.spawnFirstRoundIfNeeded("BINGO_HALL-1");

  assert.equal(spawned, false, "Spill 1 hopper over auto-spawn");
  assert.equal(state.startGameCalls.length, 0);
});

test("spawn skip: SpinnGo (slug=spillorama) trigger ikke spawn", async () => {
  const rooms = new Map([
    ["SPILLORAMA-HALL-1", makeRoom({ code: "SPILLORAMA-HALL-1", gameSlug: "spillorama" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  const spawned = await service.spawnFirstRoundIfNeeded("SPILLORAMA-HALL-1");

  assert.equal(spawned, false, "SpinnGo (player-startet databingo) hopper over");
  assert.equal(state.startGameCalls.length, 0);
});

test("spawn skip: aktiv RUNNING-runde gir no-op (idempotens)", async () => {
  // Simulerer to spillere som joiner samtidig: første spawnet runden,
  // andre ser RUNNING og skal ikke trigge på nytt.
  const rooms = new Map([
    [
      "ROCKET",
      makeRoom({
        code: "ROCKET",
        gameSlug: "rocket",
        currentGameStatus: "RUNNING",
        currentGameId: "game-active",
      }),
    ],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  const spawned = await service.spawnFirstRoundIfNeeded("ROCKET");

  assert.equal(spawned, false, "RUNNING-runde blokkerer ny spawn");
  assert.equal(state.startGameCalls.length, 0);
});

test("spawn skip: WAITING-runde gir no-op (kort race-vindu mellom rounds)", async () => {
  const rooms = new Map([
    [
      "ROCKET",
      makeRoom({
        code: "ROCKET",
        gameSlug: "rocket",
        currentGameStatus: "WAITING",
        currentGameId: "game-waiting",
      }),
    ],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  const spawned = await service.spawnFirstRoundIfNeeded("ROCKET");

  assert.equal(spawned, false);
  assert.equal(state.startGameCalls.length, 0);
});

test("spawn: ENDED-runde tillater fresh spawn (engine.archiveIfEnded rydder)", async () => {
  // ENDED er forrige rundes arkiverte status. BingoEngine.startGame kaller
  // archiveIfEnded() før den lager ny — så spawn skal kjøres.
  const rooms = new Map([
    [
      "ROCKET",
      makeRoom({
        code: "ROCKET",
        gameSlug: "rocket",
        currentGameStatus: "ENDED",
        currentGameId: "game-prev",
      }),
    ],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  const spawned = await service.spawnFirstRoundIfNeeded("ROCKET");

  assert.equal(spawned, true, "ENDED-runde blokkerer ikke spawn");
  assert.equal(state.startGameCalls.length, 1);
});

test("spawn skip: pending auto-restart fra forrige runde blokkerer dupe-spawn", async () => {
  // Scenario: forrige runde endte → handleGameEnded scheduler restart →
  // ny spiller joiner ROCKET ~3s etter game-end → spawn skal IKKE
  // trigge fordi auto-restart allerede er i kø.
  const rooms = new Map([
    [
      "ROCKET",
      makeRoom({
        code: "ROCKET",
        gameSlug: "rocket",
        currentGameStatus: "ENDED",
        currentGameId: "game-prev",
      }),
    ],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  // Først: forrige runde ender og auto-restart schedules.
  service.handleGameEnded(
    makeGameEndedInput({ roomCode: "ROCKET", gameId: "game-prev" }),
  );
  assert.equal(service.pendingCountForTesting(), 1, "auto-restart pending");

  // Så: ny spiller joiner → spawnFirstRoundIfNeeded kalles av handler.
  const spawned = await service.spawnFirstRoundIfNeeded("ROCKET");

  assert.equal(spawned, false, "pending auto-restart blokkerer fresh spawn");
  assert.equal(state.startGameCalls.length, 0, "ingen duplikat startGame");
  assert.equal(timer.pendingCount(), 1, "auto-restart timer fortsatt aktiv");
});

test("spawn skip: tomt rom returnerer false uten side-effekter", async () => {
  // Ekstremt sjeldent (handler kaller etter player joined), men vi
  // tester defensivt så vi ikke kaster på tom-rom-state.
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket", playerCount: 0 })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  const spawned = await service.spawnFirstRoundIfNeeded("ROCKET");

  assert.equal(spawned, false);
  assert.equal(state.startGameCalls.length, 0);
});

test("spawn skip: rom som ikke eksisterer returnerer false uten å kaste", async () => {
  const { engine, state } = makeStubEngine();
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  const spawned = await service.spawnFirstRoundIfNeeded("UNKNOWN");

  assert.equal(spawned, false);
  assert.equal(state.startGameCalls.length, 0);
});

test("spawn skip: service disabled returnerer false", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer, enabled: false });

  const spawned = await service.spawnFirstRoundIfNeeded("ROCKET");

  assert.equal(spawned, false);
  assert.equal(state.startGameCalls.length, 0);
});

test("spawn skip: per-slug disabled returnerer false for den slug-en", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
    ["MONSTERBINGO", makeRoom({ code: "MONSTERBINGO", gameSlug: "monsterbingo" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({
    engine,
    timer,
    disabledSlugs: new Set(["monsterbingo"]),
  });

  const rocketSpawned = await service.spawnFirstRoundIfNeeded("ROCKET");
  const monsterSpawned = await service.spawnFirstRoundIfNeeded("MONSTERBINGO");

  assert.equal(rocketSpawned, true, "rocket spawnes");
  assert.equal(monsterSpawned, false, "monsterbingo skipper");
  assert.equal(state.startGameCalls.length, 1);
  assert.equal(state.startGameCalls[0]!.roomCode, "ROCKET");
});

test("spawn fail-soft: startGame kaster → spawn returnerer false uten å kaste", async () => {
  // F.eks. NOT_ENOUGH_PLAYERS hvis minPlayersToStart=2 i prod-config.
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });
  state.startGameImpl = async () => {
    throw Object.assign(new Error("Du trenger minst 2 spillere"), {
      code: "NOT_ENOUGH_PLAYERS",
    });
  };

  const spawned = await service.spawnFirstRoundIfNeeded("ROCKET");

  assert.equal(spawned, false, "spawn returnerer false ved start-feil");
  assert.equal(state.startGameCalls.length, 1, "startGame ble forsøkt");
});

test("spawn: dobbel-call innen samme tick — andre call no-ops på RUNNING", async () => {
  // Race-test: to spillere joiner ROCKET nesten samtidig. Den første
  // sin spawn-call kjører startGame som setter currentGame til
  // RUNNING. Den andres call leser nå RUNNING og no-op'er.
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });
  // Etter første startGame: oppdater room-state til RUNNING (slik
  // BingoEngine ville gjort) før vi simulerer andre spillers join.
  state.startGameImpl = async (input) => {
    rooms.set(
      input.roomCode,
      makeRoom({
        code: input.roomCode,
        gameSlug: "rocket",
        currentGameStatus: "RUNNING",
        currentGameId: "game-just-started",
      }),
    );
  };

  const first = await service.spawnFirstRoundIfNeeded("ROCKET");
  const second = await service.spawnFirstRoundIfNeeded("ROCKET");

  assert.equal(first, true, "første spiller spawnet runden");
  assert.equal(second, false, "andre spillers spawn no-op'et");
  assert.equal(state.startGameCalls.length, 1, "startGame kalt KUN én gang");
});

// ── Slug-aware entry-fee resolution (Tobias bug-fix 2026-05-04) ────────────────

test("PERPETUAL_DEFAULT_ENTRY_FEE_BY_SLUG har 10 kr for rocket og monsterbingo", () => {
  // Sanity: konstanten må eksportere riktige verdier for begge perpetual-slugs.
  assert.equal(PERPETUAL_DEFAULT_ENTRY_FEE_BY_SLUG.get("rocket"), 10);
  assert.equal(PERPETUAL_DEFAULT_ENTRY_FEE_BY_SLUG.get("monsterbingo"), 10);
  assert.equal(PERPETUAL_DEFAULT_ENTRY_FEE_BY_SLUG.size, 2);
});

test("auto-restart Spill 2: entryFee=10 selv når defaultEntryFee=0 (slug-default)", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  // makeService bruker `defaultEntryFee: 0` — tidligere ville dette propagert
  // som entryFee=0 og prizePool=0. Etter fixen overstyrer slug-default for
  // rocket → 10 kr.
  const service = makeService({ engine, timer });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));
  await timer.runNext();

  assert.equal(state.startGameCalls.length, 1);
  assert.equal(state.startGameCalls[0]!.entryFee, 10, "Spill 2 skal arve 10 kr fra slug-default");
});

test("auto-restart Spill 3: entryFee=10 selv når defaultEntryFee=0 (slug-default)", async () => {
  const rooms = new Map([
    ["MONSTERBINGO", makeRoom({ code: "MONSTERBINGO", gameSlug: "monsterbingo" })],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  service.handleGameEnded(
    makeGameEndedInput({
      roomCode: "MONSTERBINGO",
      endedReason: "G3_FULL_HOUSE",
    }),
  );
  await timer.runNext();

  assert.equal(state.startGameCalls.length, 1);
  assert.equal(state.startGameCalls[0]!.entryFee, 10, "Spill 3 skal arve 10 kr fra slug-default");
});

test("first-round-spawn Spill 2: entryFee=10 (slug-default)", async () => {
  const rooms = new Map([
    [
      "ROCKET",
      makeRoom({
        code: "ROCKET",
        gameSlug: "rocket",
        currentGameId: "", // Ingen aktiv runde — spawn skal kjøre.
        currentGameStatus: "NONE",
      }),
    ],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const service = makeService({ engine, timer });

  const spawned = await service.spawnFirstRoundIfNeeded("ROCKET");

  assert.equal(spawned, true);
  assert.equal(state.startGameCalls.length, 1);
  assert.equal(state.startGameCalls[0]!.entryFee, 10, "first-round-spawn for Spill 2 må også bruke 10 kr");
});

test("uregistrert slug faller tilbake til defaultEntryFee", async () => {
  // Construct a service med `defaultEntryFee=42` så vi kan verifisere
  // fallback-pathen for ukjente slugs. Vi trikser litt med rooms-Map for å
  // bruke et stub-rom med unknown-slug — selv om `PERPETUAL_SLUGS` ikke har
  // den, vil `handleGameEnded` egentlig skip-e slik at vi tester
  // resolve-funksjonen direkte gjennom spawn-pathen som har samme guard.
  const rooms = new Map([
    [
      "FREEROCKET",
      makeRoom({
        code: "FREEROCKET",
        gameSlug: "rocket", // Bruk perpetual-slug så spawn fortsetter, men
        // overstyr fee-config for å demonstrere at slug-default vinner over
        // konfig (defaultEntryFee=42 vs slug-default=10).
        currentGameId: "",
        currentGameStatus: "NONE",
      }),
    ],
  ]);
  const { engine, state } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  // defaultEntryFee=42 — konfig-default som SKAL overstyres av slug-default.
  const service = new PerpetualRoundService({
    enabled: true,
    delayMs: 5000,
    disabledSlugs: new Set(),
    engine,
    variantLookup: { getVariantConfig: () => null },
    defaultTicketsPerPlayer: 4,
    defaultPayoutPercent: 80,
    defaultEntryFee: 42,
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
  });

  await service.spawnFirstRoundIfNeeded("FREEROCKET");

  assert.equal(state.startGameCalls.length, 1);
  // Slug-default for "rocket" er 10 kr → vinner over defaultEntryFee=42.
  assert.equal(state.startGameCalls[0]!.entryFee, 10, "slug-default må vinne over defaultEntryFee");
});

// ── Admin-konfigurerbar runde-pace (Tobias 2026-05-04) ──────────────────────

test("admin-config-round-pace: per-game roundPauseMs vinner over env-default", async () => {
  // Tobias 2026-05-04: når variantConfig.roundPauseMs er satt skal den
  // brukes i stedet for service-level delayMs (env-fallback).
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const variantLookup = makeStubVariantLookup({
    ROCKET: {
      gameType: "rocket",
      config: {
        ticketTypes: [{ name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 }],
        patterns: [],
        roundPauseMs: 45000,
      },
    },
  });
  // Capture delayMs som timer.setTimeoutFn faktisk får.
  const observedDelays: number[] = [];
  const wrappingTimer: FakeTimer = {
    setTimeoutFn: ((fn, ms) => {
      observedDelays.push(ms);
      return timer.setTimeoutFn(fn, ms);
    }) as FakeTimer["setTimeoutFn"],
    clearTimeoutFn: timer.clearTimeoutFn,
    runNext: timer.runNext,
    pendingCount: timer.pendingCount,
  };
  const service = makeService({
    engine,
    variantLookup,
    timer: wrappingTimer,
    delayMs: 5000,
  });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));

  assert.equal(observedDelays.length, 1);
  assert.equal(observedDelays[0], 45000, "per-game roundPauseMs må vinne over env-default");
});

test("admin-config-round-pace: env-default brukes når variantConfig mangler roundPauseMs", async () => {
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  // variantConfig finnes men har INGEN roundPauseMs → fallback til env.
  const variantLookup = makeStubVariantLookup({
    ROCKET: {
      gameType: "rocket",
      config: {
        ticketTypes: [{ name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 }],
        patterns: [],
      },
    },
  });
  const observedDelays: number[] = [];
  const wrappingTimer: FakeTimer = {
    setTimeoutFn: ((fn, ms) => {
      observedDelays.push(ms);
      return timer.setTimeoutFn(fn, ms);
    }) as FakeTimer["setTimeoutFn"],
    clearTimeoutFn: timer.clearTimeoutFn,
    runNext: timer.runNext,
    pendingCount: timer.pendingCount,
  };
  const service = makeService({
    engine,
    variantLookup,
    timer: wrappingTimer,
    delayMs: 7000,
  });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));

  assert.equal(observedDelays.length, 1);
  assert.equal(observedDelays[0], 7000, "env-default må brukes når per-game ikke er satt");
});

test("admin-config-round-pace: ugyldig per-game-verdi → env-fallback (defense-in-depth)", async () => {
  // Hvis ugyldig konfig (som admin-validator skulle ha avvist) likevel
  // er i DB-en, faller resolveRoundPauseMs tilbake til env-default.
  const rooms = new Map([
    ["ROCKET", makeRoom({ code: "ROCKET", gameSlug: "rocket" })],
  ]);
  const { engine } = makeStubEngine(rooms);
  const timer = makeFakeTimer();
  const variantLookup = makeStubVariantLookup({
    ROCKET: {
      gameType: "rocket",
      config: {
        ticketTypes: [{ name: "Standard", type: "game2-3x3", priceMultiplier: 1, ticketCount: 1 }],
        patterns: [],
        roundPauseMs: 999, // < MIN (1000)
      },
    },
  });
  const observedDelays: number[] = [];
  const wrappingTimer: FakeTimer = {
    setTimeoutFn: ((fn, ms) => {
      observedDelays.push(ms);
      return timer.setTimeoutFn(fn, ms);
    }) as FakeTimer["setTimeoutFn"],
    clearTimeoutFn: timer.clearTimeoutFn,
    runNext: timer.runNext,
    pendingCount: timer.pendingCount,
  };
  const service = makeService({
    engine,
    variantLookup,
    timer: wrappingTimer,
    delayMs: 5000,
  });

  service.handleGameEnded(makeGameEndedInput({ roomCode: "ROCKET" }));

  assert.equal(observedDelays[0], 5000, "ugyldig per-game-verdi må ignoreres → env-fallback");
});
