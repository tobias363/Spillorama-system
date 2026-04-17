/**
 * BIN-516: ChatMessageStore unit tests.
 *
 * Postgres-implementation tests use a mocked pg.Pool — no live DB needed.
 * The in-memory implementation tests use the real class (it never throws).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryChatMessageStore,
  PostgresChatMessageStore,
  type PersistedChatMessage,
} from "../ChatMessageStore.js";

// ── In-memory store ────────────────────────────────────────────────────────

test("BIN-516 in-memory: insert + listRecent round-trips a message", async () => {
  const store = new InMemoryChatMessageStore();
  await store.insert({
    hallId: "hall-1",
    roomCode: "ROOM-A",
    playerId: "p-1",
    playerName: "Alice",
    message: "hei",
    emojiId: 0,
  });
  const list = await store.listRecent("ROOM-A");
  assert.equal(list.length, 1);
  assert.equal(list[0].message, "hei");
  assert.equal(list[0].playerName, "Alice");
});

test("BIN-516 in-memory: listRecent caps at the requested limit (oldest-first)", async () => {
  const store = new InMemoryChatMessageStore();
  for (let i = 0; i < 10; i += 1) {
    await store.insert({
      hallId: "hall-1", roomCode: "ROOM-B", playerId: "p", playerName: "P", message: `m${i}`, emojiId: 0,
    });
  }
  const list = await store.listRecent("ROOM-B", 3);
  // last 3 inserted, oldest-first
  assert.deepEqual(list.map((m) => m.message), ["m7", "m8", "m9"]);
});

test("BIN-516 in-memory: messages are scoped per roomCode", async () => {
  const store = new InMemoryChatMessageStore();
  await store.insert({ hallId: "h", roomCode: "ROOM-A", playerId: "p", playerName: "P", message: "a", emojiId: 0 });
  await store.insert({ hallId: "h", roomCode: "ROOM-B", playerId: "p", playerName: "P", message: "b", emojiId: 0 });
  const a = await store.listRecent("ROOM-A");
  const b = await store.listRecent("ROOM-B");
  assert.deepEqual(a.map((m) => m.message), ["a"]);
  assert.deepEqual(b.map((m) => m.message), ["b"]);
});

test("BIN-516 in-memory: messages are truncated to 500 chars on insert", async () => {
  const store = new InMemoryChatMessageStore();
  const long = "x".repeat(600);
  await store.insert({ hallId: "h", roomCode: "R", playerId: "p", playerName: "P", message: long, emojiId: 0 });
  const list = await store.listRecent("R");
  assert.equal(list[0].message.length, 500);
});

// ── Postgres store with mocked pool ────────────────────────────────────────

interface MockPool {
  query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
  calls: Array<{ sql: string; params: unknown[] }>;
  insertedRows: Array<{ sql: string; params: unknown[] }>;
  selectResponse: PersistedChatMessage[];
  shouldThrow: boolean;
}

function makeMockPool(): MockPool {
  const calls: MockPool["calls"] = [];
  const insertedRows: MockPool["insertedRows"] = [];
  const mock: MockPool = {
    calls,
    insertedRows,
    selectResponse: [],
    shouldThrow: false,
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (mock.shouldThrow) throw new Error("simulated db outage");
      if (sql.includes("INSERT")) {
        insertedRows.push({ sql, params });
        return { rows: [] };
      }
      return {
        rows: mock.selectResponse.map((m) => ({
          id: m.id,
          player_id: m.playerId,
          player_name: m.playerName,
          message: m.message,
          emoji_id: m.emojiId,
          created_at: m.createdAt,
        })),
      };
    },
  };
  return mock;
}

test("BIN-516 postgres: insert calls INSERT with truncated message", async () => {
  const mock = makeMockPool();
  const store = new PostgresChatMessageStore({ pool: mock as unknown as ConstructorParameters<typeof PostgresChatMessageStore>[0]["pool"] });
  await store.insert({
    hallId: "hall-x", roomCode: "ROOM-X", playerId: "p", playerName: "P",
    message: "z".repeat(700), emojiId: 0,
  });
  assert.equal(mock.insertedRows.length, 1);
  const insertedMessage = mock.insertedRows[0].params[4] as string;
  assert.equal(insertedMessage.length, 500, "store must truncate before INSERT");
});

test("BIN-516 postgres: insert is fire-and-forget — does not throw on db error", async () => {
  const mock = makeMockPool();
  mock.shouldThrow = true;
  const store = new PostgresChatMessageStore({ pool: mock as unknown as ConstructorParameters<typeof PostgresChatMessageStore>[0]["pool"] });
  await assert.doesNotReject(() => store.insert({
    hallId: "h", roomCode: "R", playerId: "p", playerName: "P", message: "m", emojiId: 0,
  }), "insert must swallow db errors so chat keeps flowing");
});

test("BIN-516 postgres: listRecent returns rows oldest-first (reversed from DESC query)", async () => {
  const mock = makeMockPool();
  // pg returns DESC; the store must reverse for display.
  mock.selectResponse = [
    { id: "3", playerId: "p", playerName: "P", message: "third",  emojiId: 0, createdAt: "2026-04-18T03:00:00Z" },
    { id: "2", playerId: "p", playerName: "P", message: "second", emojiId: 0, createdAt: "2026-04-18T02:00:00Z" },
    { id: "1", playerId: "p", playerName: "P", message: "first",  emojiId: 0, createdAt: "2026-04-18T01:00:00Z" },
  ];
  const store = new PostgresChatMessageStore({ pool: mock as unknown as ConstructorParameters<typeof PostgresChatMessageStore>[0]["pool"] });
  const list = await store.listRecent("R", 50);
  assert.deepEqual(list.map((m) => m.message), ["first", "second", "third"], "must be oldest-first");
});

test("BIN-516 postgres: listRecent returns [] on db error", async () => {
  const mock = makeMockPool();
  mock.shouldThrow = true;
  const store = new PostgresChatMessageStore({ pool: mock as unknown as ConstructorParameters<typeof PostgresChatMessageStore>[0]["pool"] });
  const list = await store.listRecent("R");
  assert.deepEqual(list, [], "must return [] not throw — chat history is best-effort");
});

test("BIN-516 postgres: listRecent enforces sane bounds on limit", async () => {
  const mock = makeMockPool();
  const store = new PostgresChatMessageStore({ pool: mock as unknown as ConstructorParameters<typeof PostgresChatMessageStore>[0]["pool"] });
  await store.listRecent("R", 9_999);
  const limitParam = mock.calls[mock.calls.length - 1].params[1] as number;
  assert.equal(limitParam, 200, "must cap at MAX_HISTORY_LIMIT (200)");

  await store.listRecent("R", 0);
  const lowParam = mock.calls[mock.calls.length - 1].params[1] as number;
  assert.equal(lowParam, 1, "must floor at 1");
});
