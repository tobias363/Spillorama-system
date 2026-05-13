/**
 * I15-fix (2026-05-13): unit-test for re-attach-guard i `joinScheduledGame`.
 *
 * Verifiserer at `game1:join-scheduled` IKKE kaster `PLAYER_ALREADY_IN_ROOM`
 * når samme walletId joiner et eksisterende rom på nytt (typisk re-entry
 * etter back-to-lobby mid-runde). I stedet skal handleren bruke
 * `findPlayerInRoomByWallet` + `attachPlayerSocket` for å oppdatere
 * socketId på den eksisterende player-record-en, og returnere samme
 * `playerId` to ganger.
 *
 * Speiler det etablerte mønsteret fra `room:join` / `room:create`-handlerne
 * (`apps/backend/src/sockets/gameEvents/roomEvents.ts:372-397` + `:771-806`).
 *
 * Repro-test (E2E): `tests/e2e/spill1-reentry-during-draw.spec.ts`.
 * Diagnose-doc: `docs/architecture/REENTRY_BUG_DIAGNOSE_2026-05-13.md`.
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

/**
 * Stub-builder med fokus på re-attach-pathen. Modellerer at engine har et
 * eksisterende rom (`EXISTING-ROOM`) som inneholder ÉN player med
 * `walletId === "wallet-1"` — slik som det ville sett ut etter at
 * spilleren først joinet og deretter disconnected (detachSocket beholder
 * player-record).
 */
function makeReconnectStubs() {
  const existingPlayerId = "player-existing-from-prev-session";

  // Spore alle attachPlayerSocket-kall så testen kan verifisere at
  // re-attach faktisk ble brukt i stedet for joinRoom.
  const attachCalls: Array<{
    roomCode: string;
    playerId: string;
    socketId: string;
  }> = [];
  // Spore joinRoom-kall så testen kan verifisere at den IKKE ble kalt
  // når re-attach var korrekt sti.
  const joinRoomCalls: Array<{ socketId: string }> = [];
  // Spore mark-scheduled-kall (samme som happy-path-tester).
  const markScheduledCalls: Array<{ code: string; scheduledGameId: string }> =
    [];

  const pool = {
    query: async () => ({
      rows: [
        {
          id: "sg-1",
          status: "running",
          room_code: "EXISTING-ROOM",
          participating_halls_json: ["hall-a"],
        },
      ],
      rowCount: 1,
    }),
  };

  const engine = {
    assertWalletAllowedForGameplay: () => {},
    getRoomSnapshot: (code: string) => ({
      code,
      hallId: "hall-a",
      hostPlayerId: existingPlayerId,
      createdAt: new Date().toISOString(),
      // Existing player med samme walletId som testen kaller med.
      players: [
        {
          id: existingPlayerId,
          name: "Anna",
          walletId: "wallet-1",
          socketId: undefined, // detachSocket nullstilte
          joinedAt: new Date().toISOString(),
        },
      ],
      currentGame: undefined,
      gameHistory: [],
    }),
    attachPlayerSocket: (
      roomCode: string,
      playerId: string,
      socketId: string
    ) => {
      attachCalls.push({ roomCode, playerId, socketId });
    },
    joinRoom: async (input: { socketId: string }) => {
      // Hvis testen havner her er guarden ikke aktivert — markér så
      // assertion kan fange feil.
      joinRoomCalls.push({ socketId: input.socketId });
      throw new Error("joinRoom skal ikke kalles ved re-attach");
    },
    setRoomHallSharedAndPersist: async () => {},
    setRoomTestHallAndPersist: async () => {},
    markRoomAsScheduledAndPersist: async (
      code: string,
      scheduledGameId: string
    ) => {
      markScheduledCalls.push({ code, scheduledGameId });
    },
    destroyRoom: () => {},
  };

  const game1DrawEngine = {
    assignRoomCode: async (_id: string, code: string) => code,
  };

  const platformService = {
    getUserFromAccessToken: async () => ({
      walletId: "wallet-1",
      role: "PLAYER",
      displayName: "Anna",
    }),
    assertUserEligibleForGameplay: async () => {},
    getHall: async () => ({ isTestHall: false }),
    getPool: () => pool,
  };

  const socketRateLimiter = { check: () => true };

  const emitCalls: string[] = [];
  const emitRoomUpdate = async (code: string) => {
    emitCalls.push(code);
    return {} as never;
  };

  const factory = createGame1ScheduledEventHandlers({
    pool: pool as never,
    engine: engine as never,
    game1DrawEngine: game1DrawEngine as never,
    platformService: platformService as never,
    socketRateLimiter: socketRateLimiter as never,
    emitRoomUpdate: emitRoomUpdate as never,
  });

  return {
    factory,
    existingPlayerId,
    getAttachCalls: () => attachCalls,
    getJoinRoomCalls: () => joinRoomCalls,
    getMarkScheduledCalls: () => markScheduledCalls,
    getEmitCalls: () => emitCalls,
  };
}

const VALID_PAYLOAD = {
  scheduledGameId: "sg-1",
  accessToken: "tok-abc",
  hallId: "hall-a",
  playerName: "Anna",
};

test("I15-fix: re-attach when same wallet already in room — returns existing playerId, no joinRoom call", async () => {
  const stubs = makeReconnectStubs();
  const sock = mockSocket("sock-new");
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, true, `expected ok, got: ${JSON.stringify(resp)}`);
  const data = resp.data as { roomCode: string; playerId: string };

  assert.equal(data.roomCode, "EXISTING-ROOM");
  assert.equal(
    data.playerId,
    stubs.existingPlayerId,
    "skal returnere existing player-record sin id (re-attach), ikke ny join"
  );

  // Verifiser at attachPlayerSocket ble kalt med ny socketId.
  const attachCalls = stubs.getAttachCalls();
  assert.equal(attachCalls.length, 1, "attachPlayerSocket skal kalles én gang");
  assert.deepEqual(attachCalls[0], {
    roomCode: "EXISTING-ROOM",
    playerId: stubs.existingPlayerId,
    socketId: "sock-new",
  });

  // Verifiser at joinRoom IKKE ble kalt (re-attach erstatter joinRoom).
  assert.equal(
    stubs.getJoinRoomCalls().length,
    0,
    "engine.joinRoom skal IKKE kalles når re-attach er aktiv (ellers kaster den PLAYER_ALREADY_IN_ROOM)"
  );

  // markScheduledRoom skal fortsatt kalles for å sikre at scheduled-mapping
  // er konsistent etter re-attach (samme defensive pattern som happy-path).
  assert.deepEqual(stubs.getMarkScheduledCalls(), [
    { code: "EXISTING-ROOM", scheduledGameId: "sg-1" },
  ]);
});

test("I15-fix: two rapid re-joins from same wallet return same playerId (idempotent)", async () => {
  const stubs = makeReconnectStubs();
  const sock1 = mockSocket("sock-A");
  const sock2 = mockSocket("sock-B");
  stubs.factory(sock1 as never);
  stubs.factory(sock2 as never);

  const resp1 = await callHandler(sock1, "game1:join-scheduled", VALID_PAYLOAD);
  const resp2 = await callHandler(sock2, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp1.ok, true, `first re-join failed: ${JSON.stringify(resp1)}`);
  assert.equal(resp2.ok, true, `second re-join failed: ${JSON.stringify(resp2)}`);

  const data1 = resp1.data as { roomCode: string; playerId: string };
  const data2 = resp2.data as { roomCode: string; playerId: string };

  assert.equal(
    data1.playerId,
    data2.playerId,
    "to raske re-joins fra samme wallet skal returnere samme playerId"
  );
  assert.equal(data1.roomCode, data2.roomCode);
  assert.equal(data1.playerId, stubs.existingPlayerId);

  // Begge skal attache socket-id; ingen skal kalle joinRoom.
  const attachCalls = stubs.getAttachCalls();
  assert.equal(attachCalls.length, 2);
  assert.equal(attachCalls[0]?.socketId, "sock-A");
  assert.equal(attachCalls[1]?.socketId, "sock-B");
  assert.equal(stubs.getJoinRoomCalls().length, 0);
});

test("I15-fix: socket joins canonical room after re-attach (so subsequent broadcasts reach it)", async () => {
  const stubs = makeReconnectStubs();
  const sock = mockSocket("sock-new");
  stubs.factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, true);
  assert.ok(
    sock.rooms.has("EXISTING-ROOM"),
    "socket skal joine canonical roomCode etter re-attach"
  );
});

/**
 * Defense-in-depth: hvis snapshot-lookup returnerer rom uten matching
 * player (helt ny wallet) skal handleren falle gjennom til normal joinRoom
 * — re-attach-guarden skal kun aktiveres når player faktisk eksisterer.
 */
test("I15-fix: fresh wallet (no existing player) falls through to joinRoom", async () => {
  const newPlayerId = "freshly-joined-player";
  const joinRoomCalls: Array<{ roomCode: string; walletId: string }> = [];
  const attachCalls: Array<{ playerId: string }> = [];

  const pool = {
    query: async () => ({
      rows: [
        {
          id: "sg-1",
          status: "running",
          room_code: "EXISTING-ROOM",
          participating_halls_json: ["hall-a"],
        },
      ],
      rowCount: 1,
    }),
  };

  const engine = {
    assertWalletAllowedForGameplay: () => {},
    getRoomSnapshot: (code: string) => ({
      code,
      hallId: "hall-a",
      hostPlayerId: "other-player",
      createdAt: new Date().toISOString(),
      // Rom finnes, men HAR IKKE wallet-1 → guard skal ikke trigge.
      players: [
        {
          id: "other-player",
          name: "Other",
          walletId: "wallet-other",
          socketId: "sock-other",
          joinedAt: new Date().toISOString(),
        },
      ],
      currentGame: undefined,
      gameHistory: [],
    }),
    attachPlayerSocket: (_code: string, playerId: string) => {
      attachCalls.push({ playerId });
    },
    joinRoom: async (input: { roomCode: string; walletId: string }) => {
      joinRoomCalls.push({ roomCode: input.roomCode, walletId: input.walletId });
      return { roomCode: input.roomCode, playerId: newPlayerId };
    },
    setRoomHallSharedAndPersist: async () => {},
    setRoomTestHallAndPersist: async () => {},
    markRoomAsScheduledAndPersist: async () => {},
    destroyRoom: () => {},
  };

  const factory = createGame1ScheduledEventHandlers({
    pool: pool as never,
    engine: engine as never,
    game1DrawEngine: { assignRoomCode: async (_id: string, c: string) => c } as never,
    platformService: {
      getUserFromAccessToken: async () => ({
        walletId: "wallet-1",
        role: "PLAYER",
        displayName: "Anna",
      }),
      assertUserEligibleForGameplay: async () => {},
      getHall: async () => ({ isTestHall: false }),
      getPool: () => pool,
    } as never,
    socketRateLimiter: { check: () => true } as never,
    emitRoomUpdate: (async () => ({})) as never,
  });

  const sock = mockSocket("sock-new");
  factory(sock as never);

  const resp = await callHandler(sock, "game1:join-scheduled", VALID_PAYLOAD);

  assert.equal(resp.ok, true, `expected ok, got: ${JSON.stringify(resp)}`);
  const data = resp.data as { roomCode: string; playerId: string };
  assert.equal(data.playerId, newPlayerId, "fresh wallet skal få ny playerId fra joinRoom");

  // joinRoom skal kalles for fresh wallets.
  assert.equal(joinRoomCalls.length, 1);
  // attachPlayerSocket skal IKKE kalles (re-attach-pathen brukt kun ved
  // existing player).
  assert.equal(attachCalls.length, 0);
});
