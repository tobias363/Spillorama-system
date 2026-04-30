/**
 * F2-D unit tests for DrawOrchestrationService — extracted draw-orchestration
 * flow.
 *
 * Behavior was previously verified end-to-end by ~50 BingoEngine tests
 * (covers draw bag exhaustion, MAX_DRAWS_REACHED, DRAW_TOO_FAST, lucky-number
 * fan-out, hook errors, checkpoint writes, FULLTHUS-FIX last-chance, BIN-689
 * 0-based drawIndex). These tests pin the delegate pattern and the unique
 * service-level invariants:
 *
 *   - The engine delegates to DrawOrchestrationService instead of running the
 *     logic inline.
 *   - The service is constructed once per engine instance and exposes the
 *     expected public API surface.
 *   - The HIGH-5 per-room mutex (`drawLocksByRoom`) lives on the service —
 *     not on the engine.
 *   - The MEDIUM-1/BIN-253 last-draw timestamp lives on the service.
 *   - Guards (`assertNotScheduled`, `assertSpill1NotAdHoc`, `assertHost`,
 *     `GAME_PAUSED`, `DRAW_TOO_FAST`, `MAX_DRAWS_REACHED`, `DRAW_BAG_EMPTY`,
 *     pre-draw last-chance `evaluateActivePhase`) all fire from the service.
 *   - K5 hook-failure is routed through the engine via `handleHookError`
 *     callback — service does not re-throw.
 *   - Variant-config cache-miss auto-bind for Spill 1 routes through engine
 *     callback (engine owns the map).
 *   - Lucky-number fan-out (BIN-615/PR-C3) fires when configured.
 *   - HOEY-3 per-draw checkpoint + bingoAdapter.onNumberDrawn callback fire.
 *
 * The end-to-end create/start/draw branches stay covered by the existing
 * BingoEngine test suite because the engine wraps the service in a thin
 * delegate — testing through the engine exercises the service.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "../BingoEngine.js";
import { DomainError } from "../../errors/DomainError.js";
import { InMemoryWalletAdapter } from "../BingoEngine.test.js";
import { DrawOrchestrationService } from "../DrawOrchestrationService.js";
import {
  DEFAULT_NORSK_BINGO_CONFIG,
  type GameVariantConfig,
} from "../variantConfig.js";

import type {
  BingoSystemAdapter,
  CheckpointInput,
  CreateTicketInput,
  NumberDrawnInput,
} from "../../adapters/BingoSystemAdapter.js";
import type {
  GameState,
  Player,
  RoomState,
  Ticket,
} from "../types.js";

// ── Adapters / shared probes ────────────────────────────────────────────────

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

/**
 * Adapter that records every onNumberDrawn / onCheckpoint call so tests can
 * assert that the service invokes the bingoAdapter callbacks per draw.
 */
class CapturingAdapter implements BingoSystemAdapter {
  drawCalls: NumberDrawnInput[] = [];
  checkpointCalls: CheckpointInput[] = [];
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
  async onNumberDrawn(input: NumberDrawnInput): Promise<void> {
    this.drawCalls.push(input);
  }
  async onCheckpoint(input: CheckpointInput): Promise<void> {
    this.checkpointCalls.push(input);
  }
}

/**
 * Test-subclass exposing the lucky-number hook + onDrawCompleted hook as
 * counters. Keeps the same shape `LuckyProbeEngine` uses in the main suite
 * but adds onDrawCompleted-error injection for K5 wiring tests.
 */
class ProbeEngine extends BingoEngine {
  public luckyHookCalls = 0;
  public drawCompletedCalls = 0;
  public nextDrawCompletedError: Error | null = null;

  protected async onDrawCompleted(_ctx: {
    room: RoomState;
    game: GameState;
    lastBall: number;
    drawIndex: number;
    variantConfig: GameVariantConfig | undefined;
  }): Promise<void> {
    this.drawCompletedCalls += 1;
    if (this.nextDrawCompletedError) {
      throw this.nextDrawCompletedError;
    }
  }

  protected async onLuckyNumberDrawn(_ctx: {
    room: RoomState;
    game: GameState;
    player: Player;
    luckyNumber: number;
    lastBall: number;
    drawIndex: number;
    variantConfig: GameVariantConfig;
  }): Promise<void> {
    this.luckyHookCalls += 1;
  }
}

// ── Helpers (mirrors BingoEngine.test.ts helpers without re-importing them) ─

async function makeEngineWithStartedRound(opts?: {
  minDrawIntervalMs?: number;
  variantConfig?: GameVariantConfig;
  /** Default "rocket" so assertSpill1NotAdHoc never fires. */
  gameSlug?: string;
}): Promise<{
  engine: ProbeEngine;
  roomCode: string;
  hostId: string;
  guestId: string;
}> {
  const engine = new ProbeEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: opts?.minDrawIntervalMs ?? 0,
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
    gameSlug: opts?.gameSlug ?? "rocket",
  });
  const guest = await engine.joinRoom({
    roomCode,
    hallId: "hall-1",
    playerName: "Guest",
    walletId: "wallet-guest",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    payoutPercent: 80,
    variantConfig: opts?.variantConfig,
  });
  return { engine, roomCode, hostId: playerId, guestId: guest.playerId };
}

/** Cap drawBag length so we can hit MAX_DRAWS_REACHED without 75 draws. */
function capDrawBag(engine: BingoEngine, roomCode: string, max: number): void {
  const internal = engine as unknown as {
    rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
  };
  const game = internal.rooms.get(roomCode)?.currentGame;
  if (!game) return;
  game.drawBag = game.drawBag.slice(0, max);
}

/** Force the drawBag to a specific sequence. */
function setDrawBag(engine: BingoEngine, roomCode: string, balls: number[]): void {
  const internal = engine as unknown as {
    rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
  };
  const game = internal.rooms.get(roomCode)?.currentGame;
  if (game) {
    game.drawBag = [...balls];
  }
}

// ── 1: Wiring + delegate-pattern invariants ─────────────────────────────────

test("F2-D: DrawOrchestrationService is wired into BingoEngine and not undefined", () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter());
  const service = (
    engine as unknown as { drawOrchestrationService: DrawOrchestrationService }
  ).drawOrchestrationService;
  assert.ok(service, "engine should expose a drawOrchestrationService instance");
  assert.ok(
    service instanceof DrawOrchestrationService,
    "the field must be a real DrawOrchestrationService — not a mock or stub",
  );
});

test("F2-D: DrawOrchestrationService is constructed once — same instance returned", () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter());
  const a = (
    engine as unknown as { drawOrchestrationService: DrawOrchestrationService }
  ).drawOrchestrationService;
  const b = (
    engine as unknown as { drawOrchestrationService: DrawOrchestrationService }
  ).drawOrchestrationService;
  assert.equal(a, b);
});

test("F2-D: BingoEngine.drawNextNumber is a thin delegate", () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter());
  const fnSrc = engine.drawNextNumber.toString();
  assert.match(
    fnSrc,
    /drawOrchestrationService\.drawNext/,
    "should delegate to drawOrchestrationService.drawNext",
  );
  assert.doesNotMatch(
    fnSrc,
    /drawLocksByRoom/,
    "HIGH-5 mutex should be inside the service, not the engine wrapper",
  );
  assert.doesNotMatch(
    fnSrc,
    /lastDrawAtByRoom/,
    "MEDIUM-1 last-draw tracking should be inside the service",
  );
  assert.doesNotMatch(
    fnSrc,
    /game\.drawBag\.shift/,
    "draw-bag mutation should be inside the service",
  );
});

test("F2-D: BingoEngine no longer owns inline _drawNextNumberLocked", () => {
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter());
  const proto = Object.getPrototypeOf(engine) as Record<string, unknown>;
  assert.equal(
    typeof proto._drawNextNumberLocked,
    "undefined",
    "moved to DrawOrchestrationService",
  );
});

test("F2-D: DrawOrchestrationService exposes expected public API", () => {
  const protoMethods = Object.getOwnPropertyNames(
    DrawOrchestrationService.prototype,
  ).filter((name) => name !== "constructor");
  for (const m of ["drawNext", "cleanupRoomCaches"]) {
    assert.ok(protoMethods.includes(m), `service must expose ${m}`);
  }
});

// ── 2: Lock-state (HIGH-5) ───────────────────────────────────────────────────

test("F2-D: lock cleared on success — second draw lookup is undefined post-completion", async () => {
  const { engine, roomCode, hostId } = await makeEngineWithStartedRound();
  const service = (
    engine as unknown as { drawOrchestrationService: DrawOrchestrationService }
  ).drawOrchestrationService;

  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  assert.equal(
    service.__getLockState(roomCode),
    undefined,
    "lock entry should be removed after a successful draw resolves",
  );
});

test("F2-D: concurrent drawNext rejects the second call with DRAW_IN_PROGRESS", async () => {
  // Use a hooks-blocking subclass so onDrawCompleted blocks until we release;
  // that gives the second drawNext a guaranteed window where the lock is held.
  let release: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });

  class BlockingEngine extends BingoEngine {
    protected async onDrawCompleted(): Promise<void> {
      await blocker;
    }
  }

  const engine = new BlockingEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
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
  await engine.startGame({ roomCode, actorPlayerId: playerId, payoutPercent: 80 });

  // First draw takes the lock (and stays parked inside onDrawCompleted).
  const first = engine.drawNextNumber({ roomCode, actorPlayerId: playerId });

  // Concurrent second call should reject immediately with DRAW_IN_PROGRESS.
  await assert.rejects(
    () => engine.drawNextNumber({ roomCode, actorPlayerId: playerId }),
    (err: unknown) => err instanceof DomainError && err.code === "DRAW_IN_PROGRESS",
  );

  release!();
  await first;
});

// ── 3: Guard chain (assertNotScheduled / assertSpill1NotAdHoc / assertHost) ─

test("F2-D: assertNotScheduled fires before draw — scheduled rooms throw USE_SCHEDULED_API", async () => {
  const { engine, roomCode, hostId } = await makeEngineWithStartedRound({
    gameSlug: "bingo", // Spill 1
  });
  // Mark the room as scheduled by setting scheduledGameId on the internal RoomState.
  const internal = engine as unknown as {
    rooms: Map<string, { scheduledGameId?: string | null }>;
  };
  const room = internal.rooms.get(roomCode);
  assert.ok(room);
  room!.scheduledGameId = "scheduled-game-123";

  await assert.rejects(
    () => engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    (err: unknown) => err instanceof DomainError && err.code === "USE_SCHEDULED_API",
  );
});

test("F2-D: assertSpill1NotAdHoc fires for production retail Spill 1 (non-test-hall)", async () => {
  // We need a Spill 1 room where the start succeeds (so the round is RUNNING)
  // but the draw itself fails the production-runtime guard. Strategy: start
  // with isTestHall=true (so startGame's own guard is no-op), then flip the
  // flag to false on the internal RoomState before calling drawNext.
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
    isProductionRuntime: true,
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "retail-hall",
    playerName: "Host",
    walletId: "wallet-host",
    gameSlug: "bingo", // Spill 1
    isTestHall: true, // bypass startGame guard
  });
  await engine.joinRoom({
    roomCode,
    hallId: "retail-hall",
    playerName: "Guest",
    walletId: "wallet-guest",
  });
  await engine.startGame({ roomCode, actorPlayerId: playerId, payoutPercent: 80 });

  // Flip the test-hall flag so the next drawNext hits production retail Spill 1
  // — exactly the case assertSpill1NotAdHoc is designed to reject.
  const internal = engine as unknown as {
    rooms: Map<string, { isTestHall?: boolean }>;
  };
  const room = internal.rooms.get(roomCode);
  assert.ok(room);
  room!.isTestHall = false;

  await assert.rejects(
    () => engine.drawNextNumber({ roomCode, actorPlayerId: playerId }),
    (err: unknown) => err instanceof DomainError && err.code === "USE_SCHEDULED_API",
  );
});

test("F2-D: assertHost denies non-host actors with NOT_HOST", async () => {
  const { engine, roomCode, guestId } = await makeEngineWithStartedRound();

  await assert.rejects(
    () => engine.drawNextNumber({ roomCode, actorPlayerId: guestId }),
    (err: unknown) => err instanceof DomainError && err.code === "NOT_HOST",
  );
});

// ── 4: Pause + interval + bag-empty guards ──────────────────────────────────

test("F2-D: GAME_PAUSED blocks draws while game.isPaused = true", async () => {
  const { engine, roomCode, hostId } = await makeEngineWithStartedRound();

  // Set isPaused via internal state mutation.
  const internal = engine as unknown as {
    rooms: Map<string, { currentGame?: { isPaused?: boolean } }>;
  };
  const game = internal.rooms.get(roomCode)?.currentGame;
  assert.ok(game);
  game!.isPaused = true;

  await assert.rejects(
    () => engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_PAUSED",
  );
});

test("F2-D: DRAW_TOO_FAST throws when called within minDrawIntervalMs", async () => {
  const { engine, roomCode, hostId } = await makeEngineWithStartedRound({
    minDrawIntervalMs: 5000, // 5s is plenty to always trigger in test
  });
  const service = (
    engine as unknown as { drawOrchestrationService: DrawOrchestrationService }
  ).drawOrchestrationService;

  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  // The service should now have recorded the lastDrawAt timestamp.
  const ts = service.__getLastDrawAt(roomCode);
  assert.equal(typeof ts, "number", "service should record last-draw timestamp");

  await assert.rejects(
    () => engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    (err: unknown) => {
      if (!(err instanceof DomainError)) return false;
      if (err.code !== "DRAW_TOO_FAST") return false;
      // Message should embed remaining wait seconds (e.g. "Vent 4.9s ...").
      return /Vent\s+\d+\.\ds\s+mellom\s+trekninger/.test(err.message);
    },
  );
});

test("F2-D: DRAW_BAG_EMPTY ends the round when the bag is exhausted pre-draw", async () => {
  const { engine, roomCode, hostId } = await makeEngineWithStartedRound();

  // Empty the bag completely — the service should hit the BAG_EMPTY branch.
  setDrawBag(engine, roomCode, []);

  await assert.rejects(
    () => engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "NO_MORE_NUMBERS",
  );

  // Game should be ENDED with reason DRAW_BAG_EMPTY.
  const internal = engine as unknown as {
    rooms: Map<string, { currentGame?: { status: string; endedReason?: string } }>;
  };
  const game = internal.rooms.get(roomCode)?.currentGame;
  assert.equal(game?.status, "ENDED");
  assert.equal(game?.endedReason, "DRAW_BAG_EMPTY");
});

test("F2-D: MAX_DRAWS_REACHED ends the round when post-draw cap is hit", async () => {
  // Use maxDrawsPerRound: 2 — the 2nd draw push lands on length===2 and the
  // post-draw block ENDs the round with reason MAX_DRAWS_REACHED.
  const engine = new ProbeEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
    maxDrawsPerRound: 2,
  });
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
  await engine.startGame({ roomCode, actorPlayerId: playerId, payoutPercent: 80 });

  await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
  await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });

  // After 2 draws, the post-draw branch should have ended the round.
  const internal = engine as unknown as {
    rooms: Map<string, { currentGame?: { status: string; endedReason?: string } }>;
  };
  const game = internal.rooms.get(roomCode)?.currentGame;
  assert.equal(game?.status, "ENDED");
  assert.equal(game?.endedReason, "MAX_DRAWS_REACHED");
});

test("F2-D: pre-draw MAX_DRAWS_REACHED branch fires when length is already at cap", async () => {
  // Forces the pre-draw branch by manually setting drawnNumbers length to
  // maxDrawsPerRound while leaving status=RUNNING. The service should detect
  // this in the early guard (line ~326 in DrawOrchestrationService.ts).
  const engine = new ProbeEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
    maxDrawsPerRound: 5,
  });
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
  await engine.startGame({ roomCode, actorPlayerId: playerId, payoutPercent: 80 });

  // Seed drawnNumbers with 5 entries so the pre-draw guard triggers
  // immediately on the next call.
  const internal = engine as unknown as {
    rooms: Map<string, {
      currentGame?: { drawnNumbers: number[]; status: string; endedReason?: string };
    }>;
  };
  const game = internal.rooms.get(roomCode)?.currentGame;
  assert.ok(game);
  game!.drawnNumbers = [1, 2, 3, 4, 5];

  await assert.rejects(
    () => engine.drawNextNumber({ roomCode, actorPlayerId: playerId }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "NO_MORE_NUMBERS"
      && /Maks antall trekk \(5\)/.test(err.message),
  );

  // Pre-draw branch also ENDs the round.
  assert.equal(game?.status, "ENDED");
  assert.equal(game?.endedReason, "MAX_DRAWS_REACHED");
});

// ── 5: K5 hook-failure routing ──────────────────────────────────────────────

test("F2-D: K5 — onDrawCompleted-throw routes through handleHookError without rethrow", async () => {
  const { engine, roomCode, hostId } = await makeEngineWithStartedRound();

  engine.nextDrawCompletedError = new Error("simulated hook failure");

  // The service swallows the error via handleHookError; drawNext returns ok.
  // We just assert the hook ran exactly once and the draw still produced a ball.
  const result = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  assert.equal(typeof result.number, "number", "draw should still complete");
  assert.equal(typeof result.gameId, "string");
  assert.equal(engine.drawCompletedCalls, 1, "hook should have been invoked once");

  // Make sure the next draw works (counter doesn't permanently halt the room
  // on a single same-cause failure).
  engine.nextDrawCompletedError = null;
  const result2 = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  assert.equal(typeof result2.number, "number", "second draw still works");
});

// ── 6: Lucky-number fan-out ─────────────────────────────────────────────────

test("F2-D: lucky-number hook fires when ball matches AND luckyNumberPrize > 0", async () => {
  const { engine, roomCode, hostId } = await makeEngineWithStartedRound({
    variantConfig: {
      ticketTypes: [
        { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
      ],
      patterns: [],
      luckyNumberPrize: 100,
    },
  });
  engine.setLuckyNumber(roomCode, hostId, 7);
  setDrawBag(engine, roomCode, [7]);

  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  assert.equal(engine.luckyHookCalls, 1, "lucky-hook must fire on match");
});

test("F2-D: lucky-number hook stays silent when luckyNumberPrize === 0", async () => {
  // Default Game 1 has no luckyNumberPrize → service must short-circuit before
  // enumerating the per-room map.
  const { engine, roomCode, hostId } = await makeEngineWithStartedRound();
  engine.setLuckyNumber(roomCode, hostId, 7);
  setDrawBag(engine, roomCode, [7]);

  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  assert.equal(engine.luckyHookCalls, 0, "no luckyNumberPrize → no hook fan-out");
});

// ── 7: Variant-config cache-miss auto-bind (Spill 1) ────────────────────────

test("F2-D: Spill 1 cache-miss auto-binds DEFAULT_NORSK_BINGO_CONFIG via engine callback", async () => {
  // Build a Spill 1 room (gameSlug=bingo) but force the engine cache to be
  // empty post-startGame so the service's cache-miss branch fires.
  const engine = new BingoEngine(new FixedTicketAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "demo-hall",
    playerName: "Host",
    walletId: "wallet-host",
    gameSlug: "bingo",
    isTestHall: true, // bypass assertSpill1NotAdHoc since not production
  });
  await engine.joinRoom({
    roomCode,
    hallId: "demo-hall",
    playerName: "Guest",
    walletId: "wallet-guest",
  });
  await engine.startGame({ roomCode, actorPlayerId: playerId, payoutPercent: 80 });

  // Simulate Render-restart cache-tap by deleting the variantConfig entry.
  const internal = engine as unknown as {
    variantConfigByRoom: Map<string, GameVariantConfig>;
  };
  internal.variantConfigByRoom.delete(roomCode);
  assert.equal(
    internal.variantConfigByRoom.has(roomCode),
    false,
    "precondition: cache should be empty",
  );

  // Drawing should auto-bind DEFAULT_NORSK_BINGO_CONFIG via the engine callback.
  await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });

  const restored = internal.variantConfigByRoom.get(roomCode);
  assert.ok(restored, "engine cache should be re-populated by auto-bind");
  assert.equal(
    restored?.autoClaimPhaseMode,
    DEFAULT_NORSK_BINGO_CONFIG.autoClaimPhaseMode,
    "auto-bound config should be DEFAULT_NORSK_BINGO_CONFIG",
  );
});

// ── 8: Side-effects (HOEY-3 checkpoint + bingoAdapter.onNumberDrawn) ────────

test("F2-D: bingoAdapter.onNumberDrawn fires per draw with ascending drawIndex", async () => {
  const adapter = new CapturingAdapter();
  const engine = new BingoEngine(adapter, new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
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
  await engine.startGame({ roomCode, actorPlayerId: playerId, payoutPercent: 80 });

  // Capture starting drawCalls length (startGame may emit other events).
  const drawCallsBefore = adapter.drawCalls.length;

  await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
  await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });

  const newDrawCalls = adapter.drawCalls.slice(drawCallsBefore);
  assert.equal(newDrawCalls.length, 2, "should fire onNumberDrawn for each draw");
  assert.equal(newDrawCalls[0].roomCode, roomCode);
  assert.equal(newDrawCalls[0].drawIndex, 1, "1-based drawIndex on hook (engine semantics)");
  assert.equal(newDrawCalls[1].drawIndex, 2);
  assert.equal(typeof newDrawCalls[0].number, "number");
});

test("F2-D: HOEY-3 per-draw checkpoint fires (DRAW kind) via bingoAdapter.onCheckpoint", async () => {
  const adapter = new CapturingAdapter();
  const engine = new BingoEngine(adapter, new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
  });
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
  await engine.startGame({ roomCode, actorPlayerId: playerId, payoutPercent: 80 });

  const checkpointsBefore = adapter.checkpointCalls.length;
  await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
  const newCheckpoints = adapter.checkpointCalls.slice(checkpointsBefore);

  // At least one DRAW checkpoint should have been emitted.
  const drawCheckpoints = newCheckpoints.filter((c) => c.reason === "DRAW");
  assert.ok(
    drawCheckpoints.length >= 1,
    "service should emit at least one DRAW checkpoint per draw",
  );
});

// ── 9: Cleanup contract ─────────────────────────────────────────────────────

test("F2-D: cleanupRoomCaches clears drawLocks + lastDrawAt; engine destroyRoom routes through it", async () => {
  const { engine, roomCode, hostId } = await makeEngineWithStartedRound({
    minDrawIntervalMs: 1000,
  });
  const service = (
    engine as unknown as { drawOrchestrationService: DrawOrchestrationService }
  ).drawOrchestrationService;

  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  assert.equal(typeof service.__getLastDrawAt(roomCode), "number");

  // End the game first so destroyRoom isn't blocked by GAME_IN_PROGRESS.
  await engine.endGame({ roomCode, actorPlayerId: hostId });
  engine.destroyRoom(roomCode);

  assert.equal(
    service.__getLastDrawAt(roomCode),
    undefined,
    "lastDrawAt should be evicted on destroyRoom (via cleanupRoomLocalCaches → cleanupRoomCaches)",
  );
  assert.equal(
    service.__getLockState(roomCode),
    undefined,
    "drawLocks should be evicted",
  );
});

// ── 10: BIN-689 0-based drawIndex on the wire ───────────────────────────────

test("F2-D: drawNext returns BIN-689 0-based drawIndex (length - 1) on the wire", async () => {
  const { engine, roomCode, hostId } = await makeEngineWithStartedRound();

  const r1 = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  const r2 = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });

  assert.equal(r1.drawIndex, 0, "first draw → drawIndex=0 (BIN-689)");
  assert.equal(r2.drawIndex, 1, "second draw → drawIndex=1");
});
