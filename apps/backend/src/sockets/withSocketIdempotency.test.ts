/**
 * BIN-813 R5: Unit-tests for `withSocketIdempotency` wrapper.
 *
 * Dekker:
 *   - Manglende clientRequestId → handler kjører uten dedupe (legacy mode)
 *   - Manglende clientRequestId med requireClientRequestId=true → INVALID_INPUT
 *   - Ugyldig clientRequestId-format → INVALID_INPUT
 *   - Manglende userId (uautentisert) → handler kjører uten dedupe
 *   - Første kall kjører handler og lagrer respons i cachen
 *   - Andre kall med samme clientRequestId returnerer cached respons
 *     uten å kjøre handler
 *   - Handler kaster → release() kalles, retry slipper gjennom
 *   - Handler glemmer å kalle callback → release() kalles
 *   - store.claim() kaster (Redis nede) → fail-soft, handler kjører
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Socket } from "socket.io";
import {
  withSocketIdempotency,
  buildIdempotencyKey,
  extractClientRequestId,
  isValidClientRequestId,
  type AckResponse,
} from "./withSocketIdempotency.js";
import {
  InMemorySocketIdempotencyStore,
  type SocketIdempotencyStore,
} from "./SocketIdempotencyStore.js";

interface MockSocket {
  id: string;
  data: { user?: { walletId?: string } };
}

function makeSocket(walletId?: string): MockSocket {
  const ee = new EventEmitter() as unknown as MockSocket;
  ee.id = "socket-test";
  ee.data = walletId ? { user: { walletId } } : {};
  return ee;
}

// ── Helper utilities ─────────────────────────────────────────────────────

test("extractClientRequestId returns trimmed string", () => {
  assert.equal(extractClientRequestId({ clientRequestId: "abc-123" }), "abc-123");
  assert.equal(extractClientRequestId({ clientRequestId: "  abc-123  " }), "abc-123");
  assert.equal(extractClientRequestId({ clientRequestId: "" }), null);
  assert.equal(extractClientRequestId({}), null);
  assert.equal(extractClientRequestId(null), null);
  assert.equal(extractClientRequestId(undefined), null);
  assert.equal(extractClientRequestId({ clientRequestId: 123 }), null);
});

test("isValidClientRequestId accepts UUID v4 format (v1-5)", () => {
  // crypto.randomUUID() output (v4)
  assert.equal(isValidClientRequestId("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isValidClientRequestId("550e8400-e29b-41d4-a716-446655440000".toUpperCase()), true);
  // Reject non-UUIDs
  assert.equal(isValidClientRequestId(""), false);
  assert.equal(isValidClientRequestId("abc"), false);
  assert.equal(isValidClientRequestId("1234"), false);
  assert.equal(isValidClientRequestId("not-a-uuid-at-all"), false);
  // Reject wrong version (v6 doesn't exist in 1-5 range)
  assert.equal(isValidClientRequestId("550e8400-e29b-61d4-a716-446655440000"), false);
  // Reject wrong variant (must be 8/9/a/b in position 19)
  assert.equal(isValidClientRequestId("550e8400-e29b-41d4-c716-446655440000"), false);
});

test("buildIdempotencyKey concatenates with colon separator", () => {
  assert.equal(
    buildIdempotencyKey("wallet-abc", "claim:submit", "550e8400-e29b-41d4-a716-446655440000"),
    "wallet-abc:claim:submit:550e8400-e29b-41d4-a716-446655440000",
  );
});

// ── Wrapper behavior ──────────────────────────────────────────────────────

test("missing clientRequestId — handler runs without dedupe (legacy mode)", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const socket = makeSocket("wallet-1");
  let handlerCalls = 0;
  const handler = withSocketIdempotency(
    { store, eventName: "ticket:mark", socket: socket as unknown as Socket },
    async (_p, cb) => {
      handlerCalls++;
      cb({ ok: true, data: { number: 1 } });
    },
  );
  const acks: AckResponse<unknown>[] = [];
  await handler({ roomCode: "R1", number: 1 }, (r) => acks.push(r));
  await handler({ roomCode: "R1", number: 1 }, (r) => acks.push(r));
  assert.equal(handlerCalls, 2, "handler runs every time without clientRequestId");
  assert.equal(acks.length, 2);
  assert.deepEqual(acks[0], { ok: true, data: { number: 1 } });
});

test("missing clientRequestId with requireClientRequestId=true → INVALID_INPUT", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const socket = makeSocket("wallet-1");
  let handlerCalls = 0;
  const handler = withSocketIdempotency(
    {
      store,
      eventName: "claim:submit",
      socket: socket as unknown as Socket,
      requireClientRequestId: true,
    },
    async (_p, cb) => {
      handlerCalls++;
      cb({ ok: true, data: 1 });
    },
  );
  const acks: AckResponse<unknown>[] = [];
  await handler({ roomCode: "R1" }, (r) => acks.push(r));
  assert.equal(handlerCalls, 0, "handler should NOT run");
  assert.equal(acks[0]!.ok, false);
  assert.equal(acks[0]!.error?.code, "INVALID_INPUT");
});

test("invalid clientRequestId format → INVALID_INPUT", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const socket = makeSocket("wallet-1");
  let handlerCalls = 0;
  const handler = withSocketIdempotency(
    { store, eventName: "claim:submit", socket: socket as unknown as Socket },
    async (_p, cb) => {
      handlerCalls++;
      cb({ ok: true, data: 1 });
    },
  );
  const acks: AckResponse<unknown>[] = [];
  await handler(
    { roomCode: "R1", clientRequestId: "not-a-uuid" },
    (r) => acks.push(r),
  );
  assert.equal(handlerCalls, 0);
  assert.equal(acks[0]!.ok, false);
  assert.equal(acks[0]!.error?.code, "INVALID_INPUT");
});

test("unauthenticated socket — handler runs without dedupe", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const socket = makeSocket(); // no walletId
  let handlerCalls = 0;
  const handler = withSocketIdempotency(
    { store, eventName: "claim:submit", socket: socket as unknown as Socket },
    async (_p, cb) => {
      handlerCalls++;
      cb({ ok: true, data: 1 });
    },
  );
  const acks: AckResponse<unknown>[] = [];
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  await handler({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));
  await handler({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));
  assert.equal(handlerCalls, 2, "no userId means no dedupe");
});

test("first call runs handler, second call returns cached", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const socket = makeSocket("wallet-A");
  let handlerCalls = 0;
  const handler = withSocketIdempotency(
    { store, eventName: "claim:submit", socket: socket as unknown as Socket },
    async (_p, cb) => {
      handlerCalls++;
      cb({ ok: true, data: { run: handlerCalls } });
    },
  );
  const acks: AckResponse<unknown>[] = [];
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  await handler({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));
  // Second call: same clientRequestId — should hit cache.
  await handler({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));
  // Third call for good measure — also cached.
  await handler({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));

  assert.equal(handlerCalls, 1, "handler runs only once");
  assert.equal(acks.length, 3);
  assert.deepEqual(acks[0], { ok: true, data: { run: 1 } });
  assert.deepEqual(acks[1], acks[0], "second ack equals first");
  assert.deepEqual(acks[2], acks[0], "third ack equals first");
});

test("different clientRequestIds are independent", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const socket = makeSocket("wallet-A");
  let handlerCalls = 0;
  const handler = withSocketIdempotency(
    { store, eventName: "claim:submit", socket: socket as unknown as Socket },
    async (_p, cb) => {
      handlerCalls++;
      cb({ ok: true, data: { run: handlerCalls } });
    },
  );
  const acks: AckResponse<unknown>[] = [];
  const u1 = "550e8400-e29b-41d4-a716-446655440000";
  const u2 = "660e8400-e29b-41d4-a716-446655440001";
  await handler({ roomCode: "R1", clientRequestId: u1 }, (r) => acks.push(r));
  await handler({ roomCode: "R1", clientRequestId: u2 }, (r) => acks.push(r));
  assert.equal(handlerCalls, 2, "different keys run handler twice");
  assert.deepEqual((acks[0] as { data: { run: number } }).data, { run: 1 });
  assert.deepEqual((acks[1] as { data: { run: number } }).data, { run: 2 });
});

test("different userIds with same clientRequestId are isolated", async () => {
  const store = new InMemorySocketIdempotencyStore();
  let handlerCalls = 0;
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const baseHandler = async (_p: unknown, cb: (r: AckResponse<unknown>) => void) => {
    handlerCalls++;
    cb({ ok: true, data: { run: handlerCalls } });
  };
  const handlerA = withSocketIdempotency(
    {
      store,
      eventName: "claim:submit",
      socket: makeSocket("wallet-A") as unknown as Socket,
    },
    baseHandler,
  );
  const handlerB = withSocketIdempotency(
    {
      store,
      eventName: "claim:submit",
      socket: makeSocket("wallet-B") as unknown as Socket,
    },
    baseHandler,
  );
  const acks: AckResponse<unknown>[] = [];
  await handlerA({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));
  await handlerB({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));
  assert.equal(handlerCalls, 2, "different users → independent dedupe");
});

test("handler throws — release() called, retry slips through", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const socket = makeSocket("wallet-A");
  let handlerCalls = 0;
  const handler = withSocketIdempotency(
    { store, eventName: "claim:submit", socket: socket as unknown as Socket },
    async (_p, _cb) => {
      handlerCalls++;
      if (handlerCalls === 1) {
        throw new Error("transient failure");
      }
      _cb({ ok: true, data: { run: handlerCalls } });
    },
  );
  const acks: AckResponse<unknown>[] = [];
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  let firstThrew = false;
  try {
    await handler({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));
  } catch {
    firstThrew = true;
  }
  assert.equal(firstThrew, true, "first call should rethrow");

  // Second call: same key. Since release() was called, retry should run handler.
  await handler({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));
  assert.equal(handlerCalls, 2, "handler runs twice — first failed, retry succeeded");
  assert.equal(acks.length, 1, "only the successful ack was captured");
  assert.deepEqual((acks[0] as { data: { run: number } }).data, { run: 2 });
});

test("handler does not call callback — release() called", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const socket = makeSocket("wallet-A");
  let handlerCalls = 0;
  const handler = withSocketIdempotency(
    { store, eventName: "claim:submit", socket: socket as unknown as Socket },
    async (_p, _cb) => {
      handlerCalls++;
      // Forget to call callback.
    },
  );
  const acks: AckResponse<unknown>[] = [];
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  await handler({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));
  // Second call — should be fresh because release() was called.
  await handler({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));
  assert.equal(handlerCalls, 2);
});

test("store.claim() throws (Redis down) → fail-soft, handler runs", async () => {
  const failingStore: SocketIdempotencyStore = {
    async claim(): Promise<never> {
      throw new Error("Redis connection lost");
    },
    async store() {},
    async release() {},
  };
  const socket = makeSocket("wallet-A");
  let handlerCalls = 0;
  const handler = withSocketIdempotency(
    { store: failingStore, eventName: "claim:submit", socket: socket as unknown as Socket },
    async (_p, cb) => {
      handlerCalls++;
      cb({ ok: true, data: { run: handlerCalls } });
    },
  );
  const acks: AckResponse<unknown>[] = [];
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  await handler({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));
  await handler({ roomCode: "R1", clientRequestId: uuid }, (r) => acks.push(r));
  // No dedupe possible → both calls run handler.
  assert.equal(handlerCalls, 2);
});

// ── Critical regression test: 3-replay scenario from acceptance criteria ─

test("acceptance criterion: 3 identical events → only 1 handler call, 2 cached", async () => {
  const store = new InMemorySocketIdempotencyStore();
  const socket = makeSocket("wallet-pilot-1");
  let payoutTriggered = 0;
  const handler = withSocketIdempotency(
    { store, eventName: "claim:submit", socket: socket as unknown as Socket },
    async (_p, cb) => {
      // Simulate side effect: payout to compliance ledger.
      payoutTriggered++;
      cb({ ok: true, data: { snapshot: { code: "ROOM-X" } } });
    },
  );
  const acks: AckResponse<unknown>[] = [];
  const uuid = "fad84f3e-29b4-4d4a-9716-44665544aaaa";

  // Simulate reconnect-replay: same payload sent 3 times.
  await handler({ roomCode: "R1", type: "BINGO", clientRequestId: uuid }, (r) => acks.push(r));
  await handler({ roomCode: "R1", type: "BINGO", clientRequestId: uuid }, (r) => acks.push(r));
  await handler({ roomCode: "R1", type: "BINGO", clientRequestId: uuid }, (r) => acks.push(r));

  assert.equal(payoutTriggered, 1, "PAYOUT side effect happened EXACTLY ONCE");
  assert.equal(acks.length, 3, "all 3 calls got an ack");
  assert.deepEqual(acks[0], acks[1], "ack 2 matches ack 1");
  assert.deepEqual(acks[1], acks[2], "ack 3 matches ack 2");
});
