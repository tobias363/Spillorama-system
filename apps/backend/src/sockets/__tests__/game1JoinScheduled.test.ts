/**
 * GAME1_SCHEDULE PR 4d.2: socket player-join for schedulert Spill 1 (unit).
 *
 * Tester `createGame1ScheduledEventHandlers` via direkte mock-Socket —
 * raskere og mer isolert enn full socket-roundtrip gjennom testServer.
 * Dekker:
 *   - Happy path: room_code er NULL → engine.createRoom + assignRoomCode
 *   - Happy path: room_code satt → engine.joinRoom (reconnect)
 *   - Race: assignRoomCode returnerer annen kode → destroyRoom + joinRoom
 *     inn i vinneren
 *   - Multi-hall: valid hallId → OK; ikke-deltagende hall → HALL_NOT_ALLOWED
 *   - Status-gate: scheduled/ready_to_start → GAME_NOT_JOINABLE
 *   - Ukjent scheduledGameId → GAME_NOT_FOUND
 *   - Invalid payload → INVALID_INPUT
 *   - Rate-limit → RATE_LIMITED
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createGame1ScheduledEventHandlers } from "../game1ScheduledEvents.js";

type EventHandler = (payload: unknown, callback: (resp: unknown) => void) => void;

interface MockSocket {
  id: string;
  handlers: Map<string, EventHandler>;
  rooms: Set<string>;
  on(event: string, handler: EventHandler): void;
  join(room: string): void;
  emit: (event: string, payload: unknown) => void;
}

function mockSocket(id = "sock-1"): MockSocket {
  const handlers = new Map<string, EventHandler>();
  const rooms = new Set<string>();
  return {
    id,
    handlers,
    rooms,
    on(event, handler) {
      handlers.set(event, handler);
    },
    join(room) {
      rooms.add(room);
    },
    emit() {},
  };
}

interface AckResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function callHandler(
  sock: MockSocket,
  event: string,
  payload: unknown
): Promise<AckResponse> {
  const handler = sock.handlers.get(event);
  assert.ok(handler, `no handler for ${event}`);
  return new Promise((resolve) => {
    handler(payload, (resp: unknown) => resolve(resp as AckResponse));
  });
}

// ── Minimal stubs for deps ──────────────────────────────────────────────────

function makeStubs(overrides: Partial<StubOptions> = {}) {
  const defaults: StubOptions = {
    scheduledGameRow: {
      id: "sg-1",
      status: "purchase_open",
      room_code: null,
      participating_halls_json: ["hall-a", "hall-b"],
    },
    scheduledGameExists: true,
    assignReturns: null, // null = returner samme kode som ble sendt inn (happy path)
    engineCreateRoomCode: "ROOM-X1",
    engineCreateRoomPlayerId: "player-created",
    engineJoinRoomPlayerId: "player-joined",
    user: {
      walletId: "wallet-1",
      role: "PLAYER",
      displayName: "Anna",
    } as unknown as Record<string, unknown>,
    rateLimitAllow: true,
  };
  const opts: StubOptions = { ...defaults, ...overrides };

  const poolQueries: unknown[][] = [];
  const pool = {
    query: async (_sql: string, params: unknown[]) => {
      poolQueries.push(params);
      if (!opts.scheduledGameExists) return { rows: [], rowCount: 0 };
      return { rows: [opts.scheduledGameRow], rowCount: 1 };
    },
  };

  let destroyCalledWith: string | null = null;
  // CRIT-4: spore markRoomAsScheduled-kall så testene kan verifisere
  // at scheduled-flyten merker rom som scheduled (defensiv guard mot
  // dual-engine state-divergens).
  const markScheduledCalls: Array<{ code: string; scheduledGameId: string }> = [];
  const engine = {
    assertWalletAllowedForGameplay: () => {},
    createRoom: async () => ({
      roomCode: opts.engineCreateRoomCode,
      playerId: opts.engineCreateRoomPlayerId,
    }),
    joinRoom: async (input: { roomCode: string }) => ({
      roomCode: input.roomCode,
      playerId: opts.engineJoinRoomPlayerId,
    }),
    getRoomSnapshot: (code: string) => ({
      code,
      hallId: "hall-a",
      hostPlayerId: "host",
      createdAt: new Date().toISOString(),
      players: [],
      currentGame: undefined,
      gameHistory: [],
    }),
    destroyRoom: (code: string) => {
      destroyCalledWith = code;
    },
    markRoomAsScheduled: (code: string, scheduledGameId: string) => {
      markScheduledCalls.push({ code, scheduledGameId });
    },
  };

  const game1DrawEngine = {
    assignRoomCode: async (scheduledGameId: string, roomCode: string) => {
      return opts.assignReturns ?? roomCode;
    },
  };

  const platformService = {
    getUserFromAccessToken: async () => opts.user,
    assertUserEligibleForGameplay: async () => {},
    getPool: () => pool,
  };

  const socketRateLimiter = {
    check: () => opts.rateLimitAllow,
  };

  const emitCalls: string[] = [];
  const emitRoomUpdate = async (code: string) => {
    emitCalls.push(code);
    return {} as never;
  };

  const bindCalls: Array<{ code: string; slug: string }> = [];
  const bindDefaultVariantConfig = (code: string, slug: string) => {
    bindCalls.push({ code, slug });
  };

  const factory = createGame1ScheduledEventHandlers({
    pool: pool as never,
    engine: engine as never,
    game1DrawEngine: game1DrawEngine as never,
    platformService: platformService as never,
    socketRateLimiter: socketRateLimiter as never,
    emitRoomUpdate: emitRoomUpdate as never,
    bindDefaultVariantConfig,
  });

  return {
    factory,
    getDestroyCalledWith: () => destroyCalledWith,
    poolQueries,
    emitCalls,
    bindCalls,
    markScheduledCalls,
  };
}

interface StubOptions {
  scheduledGameRow: {
    id: string;
    status: string;
    room_code: string | null;
    participating_halls_json: unknown;
  };
  scheduledGameExists: boolean;
  assignReturns: string | null;
  engineCreateRoomCode: string;
  engineCreateRoomPlayerId: string;
  engineJoinRoomPlayerId: string;
  user: Record<string, unknown>;
  rateLimitAllow: boolean;
}

const VALID_PAYLOAD = {
  scheduledGameId: "sg-1",
  accessToken: "tok-abc",
  hallId: "hall-a",
  playerName: "Anna",
};

// ── Tester ──────────────────────────────────────────────────────────────────

test("4d.2: happy path — room_code NULL → createRoom + assignRoomCode", async () => {
  const stubs = makeStubs();
  const sock = mockSocket();
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, true, `expected ok, got: ${JSON.stringify(resp)}`);
  const data = resp.data as { roomCode: string; playerId: string };
  assert.equal(data.roomCode, "ROOM-X1");
  assert.equal(data.playerId, "player-created");
  assert.deepEqual(stubs.bindCalls, [{ code: "ROOM-X1", slug: "bingo" }]);
  assert.deepEqual(stubs.emitCalls, ["ROOM-X1"]);
  assert.ok(sock.rooms.has("ROOM-X1"), "socket skal joine rommet");
  // CRIT-4: rommet skal markeres som scheduled så BingoEngine.startGame /
  // drawNextNumber / submitClaim kaster USE_SCHEDULED_API.
  assert.deepEqual(stubs.markScheduledCalls, [
    { code: "ROOM-X1", scheduledGameId: "sg-1" },
  ]);
});

test("4d.2: happy path — eksisterende room_code → joinRoom (reconnect)", async () => {
  const stubs = makeStubs({
    scheduledGameRow: {
      id: "sg-1",
      status: "running",
      room_code: "EXISTING",
      participating_halls_json: ["hall-a"],
    },
  });
  const sock = mockSocket();
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, true);
  const data = resp.data as { roomCode: string; playerId: string };
  assert.equal(data.roomCode, "EXISTING");
  assert.equal(data.playerId, "player-joined");
  // Ingen bind-call fordi rommet er allerede bundet.
  assert.equal(stubs.bindCalls.length, 0);
  // CRIT-4: reconnect-flyten skal også markere rommet som scheduled —
  // dekker tilfellet "Render-instance restart hydrater RoomState fra
  // Redis-store uten å vite om scheduled-mappingen".
  assert.deepEqual(stubs.markScheduledCalls, [
    { code: "EXISTING", scheduledGameId: "sg-1" },
  ]);
});

test("4d.2: race — assignRoomCode returnerer annen kode → destroyRoom + joinRoom inn i vinneren", async () => {
  const stubs = makeStubs({
    assignReturns: "ROOM-WINNER",
    engineCreateRoomCode: "ROOM-LOSER",
  });
  const sock = mockSocket();
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, true);
  const data = resp.data as { roomCode: string; playerId: string };
  assert.equal(data.roomCode, "ROOM-WINNER", "skal havne i vinner-rommet");
  assert.equal(data.playerId, "player-joined");
  assert.equal(stubs.getDestroyCalledWith(), "ROOM-LOSER", "taper-rom destroyes");
  // CRIT-4: vinner-rommet skal også markeres som scheduled. Race-loser
  // ble destroy'd før det fikk markering — det er forventet.
  assert.deepEqual(stubs.markScheduledCalls, [
    { code: "ROOM-WINNER", scheduledGameId: "sg-1" },
  ]);
});

test("4d.2: multi-hall — hallId ikke i participating_halls → HALL_NOT_ALLOWED", async () => {
  const stubs = makeStubs({
    scheduledGameRow: {
      id: "sg-1",
      status: "purchase_open",
      room_code: null,
      participating_halls_json: ["hall-only-this-one"],
    },
  });
  const sock = mockSocket();
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, false);
  assert.equal(resp.error!.code, "HALL_NOT_ALLOWED");
});

test("4d.2: multi-hall — tom participating_halls-array → HALL_NOT_ALLOWED", async () => {
  const stubs = makeStubs({
    scheduledGameRow: {
      id: "sg-1",
      status: "purchase_open",
      room_code: null,
      participating_halls_json: [],
    },
  });
  const sock = mockSocket();
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, false);
  assert.equal(resp.error!.code, "HALL_NOT_ALLOWED");
});

test("4d.2: status-gate — scheduled → GAME_NOT_JOINABLE", async () => {
  const stubs = makeStubs({
    scheduledGameRow: {
      id: "sg-1",
      status: "scheduled",
      room_code: null,
      participating_halls_json: ["hall-a"],
    },
  });
  const sock = mockSocket();
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, false);
  assert.equal(resp.error!.code, "GAME_NOT_JOINABLE");
});

test("4d.2: status-gate — completed → GAME_NOT_JOINABLE", async () => {
  const stubs = makeStubs({
    scheduledGameRow: {
      id: "sg-1",
      status: "completed",
      room_code: "ENDED",
      participating_halls_json: ["hall-a"],
    },
  });
  const sock = mockSocket();
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, false);
  assert.equal(resp.error!.code, "GAME_NOT_JOINABLE");
});

test("4d.2: ukjent scheduledGameId → GAME_NOT_FOUND", async () => {
  const stubs = makeStubs({ scheduledGameExists: false });
  const sock = mockSocket();
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, false);
  assert.equal(resp.error!.code, "GAME_NOT_FOUND");
});

test("4d.2: invalid payload (manglende scheduledGameId) → INVALID_INPUT", async () => {
  const stubs = makeStubs();
  const sock = mockSocket();
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", {
    accessToken: "tok",
    hallId: "hall-a",
    playerName: "Anna",
  });

  assert.equal(resp.ok, false);
  assert.equal(resp.error!.code, "INVALID_INPUT");
});

test("4d.2: invalid payload (tom playerName) → INVALID_INPUT", async () => {
  const stubs = makeStubs();
  const sock = mockSocket();
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", {
    ...VALID_PAYLOAD,
    playerName: "",
  });

  assert.equal(resp.ok, false);
  assert.equal(resp.error!.code, "INVALID_INPUT");
});

test("4d.2: rate-limit blokkerer → RATE_LIMITED uten DB-oppslag", async () => {
  const stubs = makeStubs({ rateLimitAllow: false });
  const sock = mockSocket();
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, false);
  assert.equal(resp.error!.code, "RATE_LIMITED");
  assert.equal(stubs.poolQueries.length, 0, "ingen DB-queries etter rate-limit-reject");
});

test("4d.2: participating_halls med ikke-string-entry → HALL_NOT_ALLOWED", async () => {
  const stubs = makeStubs({
    scheduledGameRow: {
      id: "sg-1",
      status: "purchase_open",
      room_code: null,
      participating_halls_json: ["hall-a", 42 as unknown as string], // en integer snek seg inn
    },
  });
  const sock = mockSocket();
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, false);
  assert.equal(resp.error!.code, "HALL_NOT_ALLOWED");
});
