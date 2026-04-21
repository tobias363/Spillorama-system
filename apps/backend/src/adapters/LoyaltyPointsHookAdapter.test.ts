/**
 * GAME1_SCHEDULE PR 5: tester for LoyaltyPointsHookAdapter.
 *
 * Dekker:
 *   - Default points-formel: 1 pt/kr ticket.purchase, 2 pt/kr game.win
 *   - metadata-mapping (roomCode, gameId, amount i kr, etc.)
 *   - Fire-and-forget: service-feil svelges, ingen exception propagerer
 *   - Tilpasset points-formel (override via constructor)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { LoyaltyPointsHookAdapter } from "./LoyaltyPointsHookAdapter.js";

interface RecordedCall {
  userId: string;
  eventType: string;
  pointsDelta: number;
  metadata?: Record<string, unknown>;
}

function createRecordingService(shouldThrow = false) {
  const calls: RecordedCall[] = [];
  return {
    calls,
    awardPointsForActivity: async (input: RecordedCall): Promise<unknown> => {
      calls.push(input);
      if (shouldThrow) throw new Error("simulated DB outage");
      return { id: "evt-x" };
    },
  };
}

test("PR5 adapter: ticket.purchase → 1 pt/kr (default)", async () => {
  const service = createRecordingService();
  const adapter = new LoyaltyPointsHookAdapter({ service });
  await adapter.onLoyaltyEvent({
    kind: "ticket.purchase",
    userId: "u-1",
    amount: 99,
    ticketCount: 3,
    roomCode: "ROOM1",
    gameId: "g-1",
    hallId: "h-1",
    gameSlug: "bingo",
  });
  assert.equal(service.calls.length, 1);
  const call = service.calls[0]!;
  assert.equal(call.userId, "u-1");
  assert.equal(call.eventType, "ticket.purchase");
  assert.equal(call.pointsDelta, 99, "1 pt per kr (floor 99 = 99)");
  assert.equal(call.metadata?.amountKr, 99);
  assert.equal(call.metadata?.ticketCount, 3);
  assert.equal(call.metadata?.roomCode, "ROOM1");
  assert.equal(call.metadata?.gameId, "g-1");
  assert.equal(call.metadata?.hallId, "h-1");
  assert.equal(call.metadata?.gameSlug, "bingo");
});

test("PR5 adapter: ticket.purchase floor-rounder øre-input", async () => {
  const service = createRecordingService();
  const adapter = new LoyaltyPointsHookAdapter({ service });
  await adapter.onLoyaltyEvent({
    kind: "ticket.purchase",
    userId: "u-1",
    amount: 49.99, // klient kan sende decimal
    ticketCount: 1,
    roomCode: "ROOM",
    gameId: "g",
    hallId: "h",
    gameSlug: "bingo",
  });
  assert.equal(service.calls[0]!.pointsDelta, 49, "floor(49.99) = 49");
});

test("PR5 adapter: game.win → 2 pt/kr (default)", async () => {
  const service = createRecordingService();
  const adapter = new LoyaltyPointsHookAdapter({ service });
  await adapter.onLoyaltyEvent({
    kind: "game.win",
    userId: "u-2",
    amount: 50,
    patternName: "Fullt Hus",
    roomCode: "ROOM2",
    gameId: "g-2",
    hallId: "h-2",
  });
  assert.equal(service.calls.length, 1);
  const call = service.calls[0]!;
  assert.equal(call.eventType, "game.win");
  assert.equal(call.pointsDelta, 100, "2 pt per kr: 50 × 2 = 100");
  assert.equal(call.metadata?.amountKr, 50);
  assert.equal(call.metadata?.patternName, "Fullt Hus");
});

test("PR5 adapter: negativ-amount clampes til 0 (defensivt)", async () => {
  const service = createRecordingService();
  const adapter = new LoyaltyPointsHookAdapter({ service });
  await adapter.onLoyaltyEvent({
    kind: "ticket.purchase",
    userId: "u-x",
    amount: -10,
    ticketCount: 1,
    roomCode: "R",
    gameId: "g",
    hallId: "h",
    gameSlug: "bingo",
  });
  assert.equal(service.calls[0]!.pointsDelta, 0, "negativ input → 0 points");
});

test("PR5 adapter: service-feil svelges, ingen exception propagerer", async () => {
  const service = createRecordingService(true);
  const adapter = new LoyaltyPointsHookAdapter({ service });
  await assert.doesNotReject(
    adapter.onLoyaltyEvent({
      kind: "game.win",
      userId: "u-3",
      amount: 10,
      patternName: "1 Rad",
      roomCode: "R",
      gameId: "g",
      hallId: "h",
    }),
    "service-feil må ikke propagere ut av adapter"
  );
  assert.equal(service.calls.length, 1, "service ble kalt, men feil svelges");
});

test("PR5 adapter: custom points-formel respekteres", async () => {
  const service = createRecordingService();
  const adapter = new LoyaltyPointsHookAdapter({
    service,
    pointsForPurchase: (kr, ticketCount) => kr * ticketCount * 10,
    pointsForWin: (kr) => kr * 5,
  });
  await adapter.onLoyaltyEvent({
    kind: "ticket.purchase",
    userId: "u-4",
    amount: 10,
    ticketCount: 3,
    roomCode: "R",
    gameId: "g",
    hallId: "h",
    gameSlug: "bingo",
  });
  assert.equal(service.calls[0]!.pointsDelta, 10 * 3 * 10);

  await adapter.onLoyaltyEvent({
    kind: "game.win",
    userId: "u-4",
    amount: 20,
    patternName: "1 Rad",
    roomCode: "R",
    gameId: "g",
    hallId: "h",
  });
  assert.equal(service.calls[1]!.pointsDelta, 20 * 5);
});
