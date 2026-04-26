/**
 * Bølge D coverage: socket-event `chat:send` + `chat:history`.
 *
 * Tester via `registerChatEvents(ctx)` med en mock-socket, mock-engine,
 * og test-store/io-recorder. Fokus:
 *   - happy path: emit `chat:message` til rommet + ack med ChatMessage
 *   - hall-scoping (BIN-516): cross-hall avvises FORBIDDEN
 *   - tom melding (uten emoji): INVALID_INPUT
 *   - tom melding men emojiId>0: tillatt
 *   - melding > 500 tegn: trunker til 500
 *   - persistence fire-and-forget (chatMessageStore.insert kalles async, ikke awaited)
 *   - chat:history med chatMessageStore: leser fra store
 *   - chat:history uten store: faller tilbake til in-memory cache
 *   - chat:history uten cache: returnerer tom array
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { Server, Socket } from "socket.io";
import { registerChatEvents } from "../gameEvents/chatEvents.js";
import type { SocketContext } from "../gameEvents/context.js";
import type { GameEventsDeps } from "../gameEvents/deps.js";
import type { ChatMessage } from "../gameEvents/types.js";
import type { ChatMessageStore, PersistedChatMessage } from "../../store/ChatMessageStore.js";
import { DomainError } from "../../game/BingoEngine.js";

interface CapturedEmit {
  room: string;
  event: string;
  payload: unknown;
}

interface MockSocket extends EventEmitter {
  id: string;
}

function makeSocket(): MockSocket {
  const ee = new EventEmitter() as MockSocket;
  ee.id = "socket-1";
  return ee;
}

interface MockEngineOptions {
  hallId?: string | null;
  playerHallId?: string | null;
  playerName?: string;
}

function makeMockEngine(opts: MockEngineOptions = {}) {
  return {
    getRoomSnapshot(_code: string) {
      return {
        hallId: opts.hallId === undefined ? "hall-1" : opts.hallId,
        players: [
          {
            id: "p1",
            name: opts.playerName ?? "Alice",
            hallId: opts.playerHallId === undefined ? "hall-1" : opts.playerHallId,
            walletId: "w-1",
          },
        ],
      };
    },
  };
}

function makeRecorderIo(): { io: Server; emits: CapturedEmit[] } {
  const emits: CapturedEmit[] = [];
  const io = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emits.push({ room, event, payload });
        },
      };
    },
  } as unknown as Server;
  return { io, emits };
}

interface CtxOptions {
  chatMessageStore?: ChatMessageStore;
  chatHistoryByRoom?: Map<string, ChatMessage[]>;
  hallId?: string | null;
  playerHallId?: string | null;
  playerName?: string;
}

function makeCtx(opts: CtxOptions = {}): {
  ctx: SocketContext;
  socket: MockSocket;
  emits: CapturedEmit[];
  acks: Array<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }>;
} {
  const socket = makeSocket();
  const { io, emits } = makeRecorderIo();
  const acks: Array<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }> = [];
  const chatHistoryByRoom = opts.chatHistoryByRoom ?? new Map<string, ChatMessage[]>();

  const deps = {
    chatHistoryByRoom,
    chatMessageStore: opts.chatMessageStore,
  } as unknown as GameEventsDeps;

  const engine = makeMockEngine({
    hallId: opts.hallId,
    playerHallId: opts.playerHallId,
    playerName: opts.playerName,
  });

  const ctx = {
    socket: socket as unknown as Socket,
    io,
    deps,
    engine,
    ackSuccess<T>(cb: (r: { ok: boolean; data: T }) => void, data: T) {
      const r = { ok: true as const, data };
      acks.push(r);
      cb(r);
    },
    ackFailure<T>(cb: (r: { ok: boolean; error: { code: string; message: string } }) => void, err: unknown) {
      const pub = err instanceof DomainError
        ? { code: err.code, message: err.message }
        : { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) };
      const r = { ok: false as const, error: pub };
      acks.push(r);
      cb(r as never);
    },
    appendChatMessage(roomCode: string, msg: ChatMessage) {
      let h = chatHistoryByRoom.get(roomCode);
      if (!h) {
        h = [];
        chatHistoryByRoom.set(roomCode, h);
      }
      h.push(msg);
    },
    rateLimited<P, R>(
      _name: string,
      handler: (payload: P, cb: (response: unknown) => void) => Promise<void>,
    ): (payload: P, cb: (response: unknown) => void) => void {
      return (payload, cb) => {
        handler(payload, cb).catch((err) => {
          cb({ ok: false, error: { code: "INTERNAL_ERROR", message: String(err) } });
        });
      };
    },
    requireAuthenticatedPlayerAction: async (payload: { roomCode?: string; playerId?: string }) => {
      const roomCode = (payload?.roomCode ?? "").toUpperCase();
      const playerId = payload?.playerId ?? "p1";
      return { roomCode, playerId };
    },
  } as unknown as SocketContext;

  return { ctx, socket, emits, acks };
}

function invokeChatSend(
  socket: MockSocket,
  payload: Record<string, unknown>,
): Promise<{ response: { ok: boolean; data?: unknown; error?: { code: string; message: string } } }> {
  return new Promise((resolve) => {
    socket.emit("chat:send", payload, (response: unknown) => {
      resolve({ response: response as { ok: boolean; data?: unknown; error?: { code: string; message: string } } });
    });
  });
}

function invokeChatHistory(
  socket: MockSocket,
  payload: Record<string, unknown>,
): Promise<{ response: { ok: boolean; data?: unknown; error?: { code: string; message: string } } }> {
  return new Promise((resolve) => {
    socket.emit("chat:history", payload, (response: unknown) => {
      resolve({ response: response as { ok: boolean; data?: unknown; error?: { code: string; message: string } } });
    });
  });
}

function makeStubStore(): { store: ChatMessageStore; inserts: unknown[]; recent: PersistedChatMessage[] } {
  const inserts: unknown[] = [];
  const recent: PersistedChatMessage[] = [];
  const store: ChatMessageStore = {
    async insert(input) {
      inserts.push(input);
    },
    async listRecent(_roomCode: string) {
      return recent;
    },
  };
  return { store, inserts, recent };
}

// ── chat:send: happy path ─────────────────────────────────────────────────

test("chat:send — happy path emitter chat:message til rommet og ack med data", async () => {
  const { ctx, socket, emits } = makeCtx();
  registerChatEvents(ctx);

  const { response } = await invokeChatSend(socket, {
    roomCode: "ROOM1",
    message: "Hei alle!",
    emojiId: 0,
  });

  assert.equal(response.ok, true);
  const data = response.data as { message: ChatMessage };
  assert.equal(data.message.message, "Hei alle!");
  assert.equal(data.message.playerName, "Alice");
  assert.equal(data.message.emojiId, 0);
  assert.ok(data.message.id, "id skal bli generert (UUID)");
  assert.ok(data.message.createdAt, "createdAt skal være ISO-string");

  const sent = emits.find((e) => e.event === "chat:message");
  assert.ok(sent, "chat:message skal bli emitted til rommet");
  assert.equal(sent.room, "ROOM1");
  assert.equal((sent.payload as ChatMessage).message, "Hei alle!");
});

// ── chat:send: hall-scoping ────────────────────────────────────────────────

test("chat:send — BIN-516: spiller fra annen hall avvises med FORBIDDEN", async () => {
  const { ctx, socket, emits } = makeCtx({
    hallId: "hall-A",
    playerHallId: "hall-B",
  });
  registerChatEvents(ctx);

  const { response } = await invokeChatSend(socket, {
    roomCode: "ROOM1",
    message: "Hei",
    emojiId: 0,
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "FORBIDDEN");
  assert.equal(emits.length, 0, "chat:message skal ikke bli emitted ved hall-mismatch");
});

test("chat:send — samme hall tillates", async () => {
  const { ctx, socket, emits } = makeCtx({
    hallId: "hall-A",
    playerHallId: "hall-A",
  });
  registerChatEvents(ctx);

  const { response } = await invokeChatSend(socket, {
    roomCode: "ROOM1",
    message: "Hei",
    emojiId: 0,
  });

  assert.equal(response.ok, true);
  assert.equal(emits.length, 1);
});

test("chat:send — playerHallId=null + hallId=null tillates (legacy/utvalgte rom)", async () => {
  const { ctx, socket, emits } = makeCtx({
    hallId: null,
    playerHallId: null,
  });
  registerChatEvents(ctx);

  const { response } = await invokeChatSend(socket, {
    roomCode: "ROOM1",
    message: "Hei",
    emojiId: 0,
  });

  assert.equal(response.ok, true);
  assert.equal(emits.length, 1);
});

// ── chat:send: input validation ───────────────────────────────────────────

test("chat:send — tom melding uten emoji avvises med INVALID_INPUT", async () => {
  const { ctx, socket, emits } = makeCtx();
  registerChatEvents(ctx);

  const { response } = await invokeChatSend(socket, {
    roomCode: "ROOM1",
    message: "",
    emojiId: 0,
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_INPUT");
  assert.equal(emits.length, 0);
});

test("chat:send — kun whitespace-melding uten emoji avvises", async () => {
  const { ctx, socket } = makeCtx();
  registerChatEvents(ctx);

  const { response } = await invokeChatSend(socket, {
    roomCode: "ROOM1",
    message: "   \t\n  ",
    emojiId: 0,
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_INPUT");
});

test("chat:send — tom melding MED emoji-id > 0 tillates (emoji-only-mode)", async () => {
  const { ctx, socket, emits } = makeCtx();
  registerChatEvents(ctx);

  const { response } = await invokeChatSend(socket, {
    roomCode: "ROOM1",
    message: "",
    emojiId: 42,
  });

  assert.equal(response.ok, true);
  const data = response.data as { message: ChatMessage };
  assert.equal(data.message.emojiId, 42);
  assert.equal(data.message.message, "");
  assert.equal(emits.length, 1);
});

test("chat:send — melding lengre enn 500 tegn trunkeres til 500", async () => {
  const { ctx, socket } = makeCtx();
  registerChatEvents(ctx);

  const longMsg = "a".repeat(800);
  const { response } = await invokeChatSend(socket, {
    roomCode: "ROOM1",
    message: longMsg,
    emojiId: 0,
  });

  assert.equal(response.ok, true);
  const data = response.data as { message: ChatMessage };
  assert.equal(data.message.message.length, 500, "melding skal trunkeres til 500 tegn");
});

// ── chat:send: persistence (fire-and-forget) ──────────────────────────────

test("chat:send — chatMessageStore.insert kalles fire-and-forget", async () => {
  const { store, inserts } = makeStubStore();
  const { ctx, socket } = makeCtx({ chatMessageStore: store });
  registerChatEvents(ctx);

  await invokeChatSend(socket, {
    roomCode: "ROOM1",
    message: "Persistent hello",
    emojiId: 0,
  });

  // void-kallet i handleren queue-er promise-en. Gi event-loop én tick.
  await new Promise((r) => setImmediate(r));

  assert.equal(inserts.length, 1);
  const insert = inserts[0] as {
    roomCode: string; playerId: string; playerName: string; message: string; emojiId: number;
  };
  assert.equal(insert.roomCode, "ROOM1");
  assert.equal(insert.playerId, "p1");
  assert.equal(insert.playerName, "Alice");
  assert.equal(insert.message, "Persistent hello");
});

test("chat:send — selv om store.insert er treg/asynkron, ack svarer suksess umiddelbart", async () => {
  // Fire-and-forget: handler MÅ ikke awaite insert. Bruker en insert som er
  // treg og verifiserer at ack kommer før insert resolver. Dette dekker
  // kontrakten i BIN-516 ("chat must keep flowing even if the DB is sick").
  let insertResolve: (() => void) | null = null;
  const slowStore: ChatMessageStore = {
    insert() {
      return new Promise<void>((resolve) => {
        insertResolve = resolve;
      });
    },
    async listRecent() {
      return [];
    },
  };
  const { ctx, socket } = makeCtx({ chatMessageStore: slowStore });
  registerChatEvents(ctx);

  const ackPromise = invokeChatSend(socket, {
    roomCode: "ROOM1",
    message: "Hei",
    emojiId: 0,
  });

  // Ack skal komme uten å vente på insert
  const { response } = await ackPromise;
  assert.equal(response.ok, true, "BIN-516: ack ikke awaiter persistens");

  // Rydd opp pending-promise så testen ikke etterlater dangling resource
  if (insertResolve) (insertResolve as () => void)();
});

// ── chat:history ──────────────────────────────────────────────────────────

test("chat:history — uten store returnerer in-memory cache", async () => {
  const cache = new Map<string, ChatMessage[]>();
  cache.set("ROOM1", [
    { id: "m1", playerId: "p1", playerName: "Alice", message: "Tidligere", emojiId: 0, createdAt: "2026-04-25T00:00:00.000Z" },
  ]);
  const { ctx, socket } = makeCtx({ chatHistoryByRoom: cache });
  registerChatEvents(ctx);

  const { response } = await invokeChatHistory(socket, { roomCode: "ROOM1" });
  assert.equal(response.ok, true);
  const data = response.data as { messages: ChatMessage[] };
  assert.equal(data.messages.length, 1);
  assert.equal(data.messages[0].message, "Tidligere");
});

test("chat:history — uten store og uten cache returnerer tom array", async () => {
  const { ctx, socket } = makeCtx();
  registerChatEvents(ctx);

  const { response } = await invokeChatHistory(socket, { roomCode: "EMPTY-ROOM" });
  assert.equal(response.ok, true);
  const data = response.data as { messages: ChatMessage[] };
  assert.equal(data.messages.length, 0);
});

test("chat:history — med store leser fra store IKKE in-memory cache", async () => {
  const { store, recent } = makeStubStore();
  recent.push({
    id: "stored-1",
    playerId: "p1",
    playerName: "Alice",
    message: "Persistert",
    emojiId: 0,
    createdAt: "2026-04-25T01:00:00.000Z",
  });

  // Cache har annen historikk — sjekk at store vinner.
  const cache = new Map<string, ChatMessage[]>();
  cache.set("ROOM1", [
    { id: "cached-1", playerId: "p2", playerName: "Bob", message: "kun-cache", emojiId: 0, createdAt: "2026-04-25T00:00:00.000Z" },
  ]);

  const { ctx, socket } = makeCtx({ chatMessageStore: store, chatHistoryByRoom: cache });
  registerChatEvents(ctx);

  const { response } = await invokeChatHistory(socket, { roomCode: "ROOM1" });
  assert.equal(response.ok, true);
  const data = response.data as { messages: PersistedChatMessage[] };
  assert.equal(data.messages.length, 1);
  assert.equal(data.messages[0].message, "Persistert", "store har prioritet over in-memory cache");
});

test("chat:history — manglende roomCode avvises med INVALID_INPUT", async () => {
  const { ctx, socket } = makeCtx();
  // Override requireAuthenticatedPlayerAction for å simulere validation-feil
  (ctx as unknown as { requireAuthenticatedPlayerAction: (p: unknown) => Promise<unknown> })
    .requireAuthenticatedPlayerAction = async () => {
      throw new DomainError("INVALID_INPUT", "roomCode er påkrevd.");
    };
  registerChatEvents(ctx);

  const { response } = await invokeChatHistory(socket, {});
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "INVALID_INPUT");
});
