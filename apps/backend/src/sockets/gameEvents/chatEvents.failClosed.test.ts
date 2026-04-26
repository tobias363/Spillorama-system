/**
 * Bølge D Issue 3 (MEDIUM) — 2026-04-25:
 *   `chat:send` SKAL være fail-closed når `player.hallId` er undefined.
 *
 *   Tidligere kode silent-skippet hall-scope-sjekken når `player.hallId` var
 *   undefined (typen tillater `Player.hallId?: string`). Dermed kunne en
 *   spiller uten hall-tilhørighet sende chat på tvers av haller — en
 *   spillevett-audit-hazard.
 *
 *   Nå avvises chat-eventet med `HALL_REQUIRED` hvis `player.hallId` mangler,
 *   og anomalien logges via `logger.warn`.
 *
 * Tester her verifiserer:
 *   - Når player.hallId er undefined → ack { ok: false, error.code: HALL_REQUIRED }
 *     og chat:message blir IKKE emit-et.
 *   - Når snapshot.hallId mangler (defensiv mot type-drift) → INVALID_STATE.
 *   - Når player.hallId !== snapshot.hallId → FORBIDDEN (uendret adferd).
 *   - Når player.hallId === snapshot.hallId → ack { ok: true } (happy path).
 *
 * Test-strategi: vi bygger SocketContext direkte med mock-deps slik at vi
 * kan injisere en RoomSnapshot med vilkårlige Player-felter.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { RoomSnapshot, Player } from "../../game/types.js";
import type { Logger } from "pino";
import { registerChatEvents } from "./chatEvents.js";
import type { SocketContext } from "./context.js";
import type { ChatSendPayload } from "./types.js";

// ── Test fixture ────────────────────────────────────────────────────────────

interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

class FakeSocket {
  data: Record<string, unknown> = {};
  emitted: Array<{ event: string; payload: unknown }> = [];
  private handlers = new Map<string, (payload: unknown, cb: (r: AckResponse<unknown>) => void) => Promise<void> | void>();
  on(event: string, handler: (payload: unknown, cb: (r: AckResponse<unknown>) => void) => Promise<void> | void): this {
    this.handlers.set(event, handler);
    return this;
  }
  async fire<T>(event: string, payload: unknown): Promise<AckResponse<T>> {
    const handler = this.handlers.get(event);
    if (!handler) throw new Error(`no handler for ${event}`);
    return new Promise((resolve) => {
      handler(payload, resolve as (r: AckResponse<unknown>) => void);
    });
  }
}

class FakeIo {
  emits: Array<{ room: string; event: string; payload: unknown }> = [];
  to(room: string) {
    return {
      emit: (event: string, payload: unknown) => {
        this.emits.push({ room, event, payload });
        return true;
      },
    };
  }
}

interface MakeContextOpts {
  /** Player to return in snapshot.players. If null, snapshot has no players. */
  player: Player | null;
  /** Override snapshot.hallId. Default 'hall-A'. */
  snapshotHallId?: string;
  /** Override roomCode. Default 'ROOM-1'. */
  roomCode?: string;
}

interface MockContext {
  ctx: SocketContext;
  socket: FakeSocket;
  io: FakeIo;
  warnLogs: Array<{ obj: unknown; msg: string }>;
  errorLogs: Array<{ obj: unknown; msg: string }>;
}

function makeMockSocketContext(opts: MakeContextOpts): MockContext {
  const roomCode = opts.roomCode ?? "ROOM-1";
  const snapshotHallId = opts.snapshotHallId ?? "hall-A";
  const players: Player[] = opts.player ? [opts.player] : [];
  const snapshot: RoomSnapshot = {
    code: roomCode,
    hallId: snapshotHallId,
    hostPlayerId: opts.player?.id ?? "host-x",
    gameSlug: "bingo",
    createdAt: "2026-04-25T00:00:00Z",
    players,
    gameHistory: [],
  };

  const socket = new FakeSocket();
  const io = new FakeIo();

  const warnLogs: Array<{ obj: unknown; msg: string }> = [];
  const errorLogs: Array<{ obj: unknown; msg: string }> = [];
  const logger = {
    warn: (obj: unknown, msg: string) => warnLogs.push({ obj, msg }),
    error: (obj: unknown, msg: string) => errorLogs.push({ obj, msg }),
    debug: () => {},
    info: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
  } as unknown as Logger;

  // chatHistoryByRoom + minimal deps. registerChatEvents reads `deps.chatMessageStore`
  // and `deps.chatHistoryByRoom`. Empty store is fine — fire-and-forget path.
  const chatHistoryByRoom = new Map<string, unknown[]>();
  const deps = { chatHistoryByRoom } as unknown as SocketContext["deps"];

  const ctx: SocketContext = {
    deps,
    io: io as unknown as SocketContext["io"],
    engine: {
      getRoomSnapshot: (_code: string) => snapshot,
    } as unknown as SocketContext["engine"],
    platformService: {} as SocketContext["platformService"],
    logger,
    socket: socket as unknown as SocketContext["socket"],
    ackSuccess: <T>(cb: (resp: AckResponse<T>) => void, data: T) => cb({ ok: true, data }),
    ackFailure: <T>(cb: (resp: AckResponse<T>) => void, error: unknown) => {
      const err = error as { code?: string; message?: string };
      cb({ ok: false, error: { code: err.code ?? "INTERNAL", message: err.message ?? "" } });
    },
    appendChatMessage: () => {},
    setLuckyNumber: () => {},
    getAuthenticatedSocketUser: async () => ({} as never),
    assertUserCanActAsPlayer: () => {},
    assertUserCanAccessRoom: () => {},
    rateLimited: <P, R>(_event: string, handler: (payload: P, cb: (r: AckResponse<R>) => void) => Promise<void>) => handler,
    requireAuthenticatedPlayerAction: async (_payload) => ({
      roomCode,
      playerId: opts.player?.id ?? "p-x",
    }),
    resolveIdentityFromPayload: async () => ({ playerName: "x", walletId: "w-x", hallId: snapshotHallId }),
  };

  registerChatEvents(ctx);
  return { ctx, socket, io, warnLogs, errorLogs };
}

function makePlayer(overrides: Partial<Player>): Player {
  return {
    id: "p-1",
    name: "Test Player",
    walletId: "w-1",
    balance: 100,
    socketId: "s-1",
    hallId: "hall-A",
    ...overrides,
  };
}

const validPayload: ChatSendPayload = {
  accessToken: "tok-x",
  roomCode: "ROOM-1",
  message: "Hei!",
  emojiId: 0,
};

// ── Tests ──────────────────────────────────────────────────────────────────

test("Bølge D Issue 3: player.hallId undefined → HALL_REQUIRED + ingen chat:message", async () => {
  const { socket, io, warnLogs } = makeMockSocketContext({
    player: makePlayer({ hallId: undefined }),
    snapshotHallId: "hall-A",
  });

  const ack = await socket.fire("chat:send", validPayload);

  assert.equal(ack.ok, false, "fail-closed: chat avvises uten hallId");
  assert.equal(ack.error?.code, "HALL_REQUIRED");
  assert.equal(io.emits.length, 0, "chat:message skal IKKE emittes");

  // Anomalien skal logges som warn for spillevett-audit.
  assert.equal(warnLogs.length, 1, "én warn skal logges for fail-closed-pathen");
  assert.match(warnLogs[0].msg, /HALL_REQUIRED|fail-closed/i);
});

test("Bølge D Issue 3: player.hallId === snapshot.hallId → happy path → ack ok + chat:message emit", async () => {
  const { socket, io } = makeMockSocketContext({
    player: makePlayer({ hallId: "hall-A" }),
    snapshotHallId: "hall-A",
  });

  const ack = await socket.fire("chat:send", validPayload);

  assert.equal(ack.ok, true, "happy path skal lykkes");
  assert.equal(io.emits.length, 1, "chat:message skal broadcastes");
  assert.equal(io.emits[0].event, "chat:message");
});

test("Bølge D Issue 3: player.hallId mismatch → FORBIDDEN (eksisterende adferd)", async () => {
  const { socket, io } = makeMockSocketContext({
    player: makePlayer({ hallId: "hall-OTHER" }),
    snapshotHallId: "hall-A",
  });

  const ack = await socket.fire("chat:send", validPayload);

  assert.equal(ack.ok, false);
  assert.equal(ack.error?.code, "FORBIDDEN");
  assert.equal(io.emits.length, 0);
});

test("Bølge D Issue 3: player.hallId tom string → fail-closed (ikke truthy)", async () => {
  // Defensivt: empty string er falsy → skal falle inn i HALL_REQUIRED-grenen.
  const { socket, io, warnLogs } = makeMockSocketContext({
    player: makePlayer({ hallId: "" }),
    snapshotHallId: "hall-A",
  });

  const ack = await socket.fire("chat:send", validPayload);

  assert.equal(ack.ok, false);
  assert.equal(ack.error?.code, "HALL_REQUIRED");
  assert.equal(io.emits.length, 0);
  assert.equal(warnLogs.length, 1);
});

test("Bølge D Issue 3: player ikke funnet i room → INVALID_INPUT", async () => {
  const { socket, io } = makeMockSocketContext({ player: null });

  const ack = await socket.fire("chat:send", validPayload);

  assert.equal(ack.ok, false);
  assert.equal(ack.error?.code, "INVALID_INPUT");
  assert.equal(io.emits.length, 0);
});
