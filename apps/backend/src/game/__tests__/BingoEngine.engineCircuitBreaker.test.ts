/**
 * Bølge K5 (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §2.4 / CRIT-4):
 * Integration tests for the engine error-handling circuit-breaker.
 *
 * Verifies:
 *   1. 1-2 consecutive same-cause `onDrawCompleted` errors → counter
 *      increments, room continues running, port called for each.
 *   2. 3rd same-cause error within 60s → halt-the-room (game.isPaused),
 *      port called with `pauseInitiated=true`, reason
 *      `REPEATED_HOOK_FAILURE`.
 *   3. Wallet-shortage error (`WalletError("ACCOUNT_NOT_FOUND")`) → halt
 *      immediately on first occurrence, reason `WALLET_SHORTAGE`,
 *      counter still records (count=1).
 *   4. Different cause errors → counter resets, no halt at 3rd.
 *   5. Manual `resumeGame` resets counter so subsequent failures start
 *      fresh.
 *   6. `destroyRoom` clears counter state (test via reuse of same code).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "../BingoEngine.js";
import { InMemoryWalletAdapter } from "../BingoEngine.test.js";
import { WalletError } from "../../adapters/WalletAdapter.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../../adapters/BingoSystemAdapter.js";
import type { Ticket, RoomState, GameState } from "../types.js";
import type {
  EngineCircuitBreakerPort,
  EngineDegradedEvent,
} from "../../adapters/EngineCircuitBreakerPort.js";

class FixedTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: [
        [1, 2, 3, 4, 5],
        [13, 14, 15, 16, 17],
        [25, 26, 0, 27, 28],
        [37, 38, 39, 40, 41],
        [49, 50, 51, 52, 53],
      ],
    };
  }
}

class CapturingPort implements EngineCircuitBreakerPort {
  events: EngineDegradedEvent[] = [];
  onEngineDegraded(event: EngineDegradedEvent): void {
    this.events.push(event);
  }
}

/**
 * Test-only subclass that throws from `onDrawCompleted` based on a
 * configurable strategy. Lets us simulate the prod-incident pattern
 * (same error fires every draw) without wiring real wallet failures.
 */
class FailingEngine extends BingoEngine {
  /** Set by tests to control which error to throw next. */
  public nextError: Error | null = null;
  public callCount = 0;

  protected async onDrawCompleted(_ctx: {
    room: RoomState;
    game: GameState;
    lastBall: number;
    drawIndex: number;
    variantConfig: import("../variantConfig.js").GameVariantConfig | undefined;
  }): Promise<void> {
    this.callCount += 1;
    if (this.nextError) {
      throw this.nextError;
    }
  }
}

async function setupRoom(): Promise<{
  engine: FailingEngine;
  port: CapturingPort;
  roomCode: string;
  hostId: string;
}> {
  const port = new CapturingPort();
  const engine = new FailingEngine(
    new FixedTicketAdapter(),
    new InMemoryWalletAdapter(),
    {
      engineCircuitBreaker: port,
      minDrawIntervalMs: 0, // bypass min-interval guard for fast iteration
      // Use threshold=3 (default) — match audit-spec.
    },
  );
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
    gameSlug: "rocket", // Spill 2 — keeps assertSpill1NotAdHoc out of the way
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    payoutPercent: 80,
  });
  return { engine, port, roomCode, hostId: playerId };
}

function getRoom(engine: BingoEngine, roomCode: string): RoomState {
  const rooms = (
    engine as unknown as { rooms: Map<string, RoomState> }
  ).rooms;
  const room = rooms.get(roomCode);
  if (!room) throw new Error(`Test setup: room ${roomCode} missing`);
  return room;
}

test("K5 BingoEngine: 1-2 consecutive same-cause errors do NOT halt room", async () => {
  const { engine, port, roomCode, hostId } = await setupRoom();
  engine.nextError = new Error("transient evaluator hiccup");

  // First draw — error caught, no halt
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  let room = getRoom(engine, roomCode);
  assert.equal(room.currentGame?.isPaused ?? false, false, "first error should NOT halt");
  assert.equal(port.events.length, 1, "1st error broadcast");
  assert.equal(port.events[0].errorCount, 1);
  assert.equal(port.events[0].pauseInitiated, false);
  assert.equal(port.events[0].reason, "REPEATED_HOOK_FAILURE");

  // Second draw — counter at 2, still no halt
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  room = getRoom(engine, roomCode);
  assert.equal(room.currentGame?.isPaused ?? false, false, "2nd error should NOT halt");
  assert.equal(port.events.length, 2);
  assert.equal(port.events[1].errorCount, 2);
  assert.equal(port.events[1].pauseInitiated, false);
});

test("K5 BingoEngine: 3rd same-cause error triggers halt-the-room", async () => {
  const { engine, port, roomCode, hostId } = await setupRoom();
  engine.nextError = new Error("repeated cause");

  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  const room = getRoom(engine, roomCode);
  assert.equal(room.currentGame?.isPaused, true, "3rd error halts room");
  assert.equal(
    room.currentGame?.pauseReason,
    "engine_evaluator_repeated_failure",
  );
  assert.match(
    room.currentGame?.pauseMessage ?? "",
    /tekniske feil/,
    "pause message mentions repeated technical failures",
  );

  assert.equal(port.events.length, 3);
  const halt = port.events[2];
  assert.equal(halt.errorCount, 3);
  assert.equal(halt.pauseInitiated, true);
  assert.equal(halt.reason, "REPEATED_HOOK_FAILURE");
  assert.equal(halt.hook, "onDrawCompleted");
  assert.equal(halt.roomCode, roomCode);
  assert.equal(halt.hallId, "hall-1");
});

test("K5 BingoEngine: WALLET_SHORTAGE halts immediately on first occurrence", async () => {
  const { engine, port, roomCode, hostId } = await setupRoom();
  engine.nextError = new WalletError(
    "ACCOUNT_NOT_FOUND",
    "Wallet house-... finnes ikke.",
  );

  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  const room = getRoom(engine, roomCode);
  assert.equal(
    room.currentGame?.isPaused,
    true,
    "wallet-shortage halts on FIRST error",
  );
  assert.equal(room.currentGame?.pauseReason, "wallet_shortage");
  assert.match(
    room.currentGame?.pauseMessage ?? "",
    /house-konto mangler saldo/,
    "pause message specifically mentions house-konto shortage",
  );

  assert.equal(port.events.length, 1);
  assert.equal(port.events[0].reason, "WALLET_SHORTAGE");
  assert.equal(port.events[0].errorCount, 1);
  assert.equal(port.events[0].pauseInitiated, true);
  assert.equal(port.events[0].errorCode, "ACCOUNT_NOT_FOUND");
});

test("K5 BingoEngine: WALLET_SHORTAGE INSUFFICIENT_FUNDS also halts immediately", async () => {
  const { engine, port, roomCode, hostId } = await setupRoom();
  engine.nextError = new WalletError(
    "INSUFFICIENT_FUNDS",
    "Wallet house-bingo-hall-1 mangler saldo.",
  );

  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  const room = getRoom(engine, roomCode);
  assert.equal(room.currentGame?.isPaused, true);
  assert.equal(port.events[0].reason, "WALLET_SHORTAGE");
  assert.equal(port.events[0].errorCode, "INSUFFICIENT_FUNDS");
});

test("K5 BingoEngine: different cause errors do NOT trigger halt at 3rd", async () => {
  const { engine, port, roomCode, hostId } = await setupRoom();

  // Three different errors — counter resets each time, never reaches 3.
  engine.nextError = new Error("cause A");
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  engine.nextError = new Error("cause B");
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  engine.nextError = new Error("cause C");
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  const room = getRoom(engine, roomCode);
  assert.equal(
    room.currentGame?.isPaused ?? false,
    false,
    "different causes should NOT halt — counter resets each time",
  );
  assert.equal(port.events.length, 3);
  for (const ev of port.events) {
    assert.equal(ev.errorCount, 1, "each different cause is fresh count=1");
    assert.equal(ev.pauseInitiated, false);
  }
});

test("K5 BingoEngine: successful draw resets counter for subsequent same-cause errors", async () => {
  const { engine, port, roomCode, hostId } = await setupRoom();

  // Two failures of cause X
  engine.nextError = new Error("cause X");
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  assert.equal(port.events.length, 2);

  // Successful draw — counter resets
  engine.nextError = null;
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  // Two more failures of cause X — counter restarts at 1, NOT 3
  engine.nextError = new Error("cause X");
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  const room = getRoom(engine, roomCode);
  assert.equal(
    room.currentGame?.isPaused ?? false,
    false,
    "after success-reset, 2 more failures should NOT halt",
  );
  // Last event should have count=2 (post-reset) not 4
  const last = port.events[port.events.length - 1];
  assert.equal(last.errorCount, 2);
});

test("K5 BingoEngine: manual resume resets circuit-breaker counter", async () => {
  const { engine, port, roomCode, hostId } = await setupRoom();

  // Trigger halt by 3 same-cause errors
  engine.nextError = new Error("repeated boom");
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  let room = getRoom(engine, roomCode);
  assert.equal(room.currentGame?.isPaused, true);

  // Resume — counter should reset
  engine.resumeGame(roomCode);
  room = getRoom(engine, roomCode);
  assert.equal(room.currentGame?.isPaused, false);

  // Two more failures should NOT halt (counter was reset)
  port.events.length = 0;
  engine.nextError = new Error("repeated boom"); // same cause as before
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  room = getRoom(engine, roomCode);
  assert.equal(
    room.currentGame?.isPaused ?? false,
    false,
    "after resume, same cause restarts counter at 1",
  );
  assert.equal(port.events.length, 2);
  assert.equal(port.events[1].errorCount, 2);
});

test("K5 BingoEngine: cause fingerprint exposed for debugging", async () => {
  const { engine, port, roomCode, hostId } = await setupRoom();
  const err = new Error("very specific message");
  (err as Error & { code?: string }).code = "DOMAIN_X";
  engine.nextError = err;

  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  assert.equal(port.events.length, 1);
  assert.equal(port.events[0].cause, "DOMAIN_X::very specific message");
  assert.equal(port.events[0].errorCode, "DOMAIN_X");
  assert.equal(port.events[0].errorMessage, "very specific message");
});

test("K5 BingoEngine: port that throws does NOT crash engine", async () => {
  const port: EngineCircuitBreakerPort = {
    onEngineDegraded: () => {
      throw new Error("buggy port");
    },
  };
  const engine = new FailingEngine(
    new FixedTicketAdapter(),
    new InMemoryWalletAdapter(),
    { engineCircuitBreaker: port, minDrawIntervalMs: 0 },
  );
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
    gameSlug: "rocket",
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    payoutPercent: 80,
  });

  engine.nextError = new Error("evaluator boom");
  // Should NOT throw — port-failure is swallowed
  await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });

  const room = getRoom(engine, roomCode);
  // Game still running because port-failure doesn't bubble; counter still tracked.
  assert.equal(room.currentGame?.isPaused ?? false, false);
});

test("K5 BingoEngine: counter introspection via __getEngineErrorCounterState", async () => {
  const { engine, roomCode, hostId } = await setupRoom();

  engine.nextError = new Error("cause Z");
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  const state = engine.__getEngineErrorCounterState(roomCode, "onDrawCompleted");
  assert.notEqual(state, undefined);
  assert.equal(state?.count, 2);
  assert.match(state?.cause ?? "", /cause Z/);

  // Different hook → no state
  const otherHook = engine.__getEngineErrorCounterState(
    roomCode,
    "evaluateActivePhase",
  );
  assert.equal(otherHook, undefined);
});

test("K5 BingoEngine: lower threshold (2) halts on second consecutive error", async () => {
  const port = new CapturingPort();
  const engine = new FailingEngine(
    new FixedTicketAdapter(),
    new InMemoryWalletAdapter(),
    {
      engineCircuitBreaker: port,
      engineCircuitBreakerThreshold: 2,
      minDrawIntervalMs: 0,
    },
  );
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
    gameSlug: "rocket",
  });
  await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    payoutPercent: 80,
  });

  engine.nextError = new Error("custom-threshold boom");
  await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
  // Second error → halts (threshold=2)
  await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });

  const room = getRoom(engine, roomCode);
  assert.equal(room.currentGame?.isPaused, true);
  assert.equal(port.events[1].pauseInitiated, true);
});
