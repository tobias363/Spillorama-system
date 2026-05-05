/**
 * Audit-fix 2026-05-06 (SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05 §2.1, §2.7):
 *
 * Verifiserer at `assertHost` (privat metode i BingoEngine) håndhever
 * korrekt ACL for både Spill 1 (master-flow) og Spill 2/3 (perpetual,
 * ETT globalt rom uten master).
 *
 * Mål:
 *   1. Spill 2/3-rom + actor=`SYSTEM_ACTOR_ID` → no-op (auto-draw-tick
 *      og perpetual-loop får mutere uten host-check).
 *   2. Spill 2/3-rom + actor=arbitrary player → no-op (PR #942-bypass
 *      beholdes som parallel mekanisme — fjernes i Fase 3).
 *   3. Spill 1-rom (`bingo`) + actor=`SYSTEM_ACTOR_ID` → kaster NOT_HOST
 *      (system-actor er KUN gyldig for perpetual).
 *   4. Spill 1-rom (`bingo`) + actor=ekte host-id → no-op.
 *   5. Spill 1-rom (`bingo`) + actor=non-host-spiller → kaster NOT_HOST.
 *   6. Slug-aliaser dekkes (`tallspill`, `mønsterbingo`, `game_2`,
 *      `game_3`).
 *
 * Testene bruker offentlige metoder (`startGame`/`endGame`) som indirekte
 * trigger `assertHost`. Ingen privat-API-tilgang nødvendig.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BingoEngine } from "./BingoEngine.js";
import { DomainError } from "../errors/DomainError.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { SYSTEM_ACTOR_ID } from "./SystemActor.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

const FIXED_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class FixedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: FIXED_GRID.map((r) => [...r]) };
  }
}

function makeEngine(): BingoEngine {
  return new BingoEngine(new FixedGridAdapter(), new InMemoryWalletAdapter(), {
    minDrawIntervalMs: 0,
    minPlayersToStart: 1,
    dailyLossLimit: 1_000_000,
    monthlyLossLimit: 10_000_000,
    minRoundIntervalMs: 0,
  });
}

// ── 1: ROCKET-rom + system-actor → no-op (assertHost passerer) ─────────────

test("ROCKET + SYSTEM_ACTOR_ID → startGame passerer assertHost", async () => {
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "rocket",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: SYSTEM_ACTOR_ID,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.status, "RUNNING");
});

test("MONSTERBINGO + SYSTEM_ACTOR_ID → startGame passerer assertHost", async () => {
  // Symmetrisk med ROCKET-testen — verifiserer at slug-aliaser fungerer.
  // Vi tester KUN startGame (som ikke kaller requirePlayer for actor).
  // endGame har ekstra requirePlayer-call som krever en faktisk spiller —
  // den koden kjøres med players[0]?.id-fallback i auto-draw-tick, ikke
  // SYSTEM_ACTOR_ID direkte. ACL-bypassen er det som dekkes her.
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "monsterbingo",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: SYSTEM_ACTOR_ID,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.status, "RUNNING");
});

// ── 2: ROCKET + arbitrær spiller → assertHost passerer (PR #942-bypass) ───

test("ROCKET + non-host arbitrary player → startGame passerer (PR #942 slug-bypass)", async () => {
  // PR #942 sin slug-bypass beholdes som parallel mekanisme inntil Fase 3.
  // En spiller som IKKE er host kan starte runden i ROCKET — sikkerheten
  // ivaretas via socket-/HTTP-laget (slug-gate avviser game:start for
  // perpetual-rom uansett actor).
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "rocket",
  });
  // Join a second player to use as the actor.
  const joinResult = await engine.joinRoom({
    roomCode,
    hallId: "h",
    playerName: "Bob",
    walletId: "w-bob",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: joinResult.playerId,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.status, "RUNNING");
});

// ── 3: Spill 1 + system-actor → kaster NOT_HOST (audit krav) ──────────────

test("BINGO (Spill 1) + SYSTEM_ACTOR_ID → assertHost kaster NOT_HOST", async () => {
  // System-actor er KUN gyldig for perpetual-rom. Hvis en buggy call-site
  // sender SYSTEM_ACTOR_ID til Spill 1, skal det feile høyt — ikke skje
  // stille som om alt var ok.
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h-test", // test-hall slik at K3-guard ikke fyrer
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
    isTestHall: true,
  });

  await assert.rejects(
    () =>
      engine.startGame({
        roomCode,
        actorPlayerId: SYSTEM_ACTOR_ID,
        entryFee: 0,
        ticketsPerPlayer: 1,
        payoutPercent: 100,
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "NOT_HOST");
      return true;
    },
  );
});

// ── 4: Spill 1 + ekte host-id → assertHost passerer ─────────────────────

test("BINGO (Spill 1) + ekte host-id → startGame passerer", async () => {
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h-test",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
    isTestHall: true,
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  await engine.startGame({
    roomCode,
    actorPlayerId: snapshot.hostPlayerId,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });

  const after = engine.getRoomSnapshot(roomCode);
  assert.equal(after.currentGame?.status, "RUNNING");
});

// ── 5: Spill 1 + non-host → kaster NOT_HOST ─────────────────────────────

test("BINGO (Spill 1) + non-host spillerId → kaster NOT_HOST", async () => {
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h-test",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
    isTestHall: true,
  });
  const bob = await engine.joinRoom({
    roomCode,
    hallId: "h-test",
    playerName: "Bob",
    walletId: "w-bob",
  });

  await assert.rejects(
    () =>
      engine.startGame({
        roomCode,
        actorPlayerId: bob.playerId,
        entryFee: 0,
        ticketsPerPlayer: 1,
        payoutPercent: 100,
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "NOT_HOST");
      return true;
    },
  );
});

// ── 6: Slug-aliaser → samme oppførsel (audit §2.7) ──────────────────────

test("slug-alias 'tallspill' + SYSTEM_ACTOR_ID → assertHost passerer (audit §2.7)", async () => {
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "tallspill", // alias for rocket
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: SYSTEM_ACTOR_ID,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.status, "RUNNING");
});

test("slug-alias 'mønsterbingo' + SYSTEM_ACTOR_ID → assertHost passerer (audit §2.7)", async () => {
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "mønsterbingo", // alias for monsterbingo (norsk ø)
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: SYSTEM_ACTOR_ID,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.status, "RUNNING");
});

test("slug-alias 'game_2' + SYSTEM_ACTOR_ID → assertHost passerer (audit §2.7)", async () => {
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "game_2",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: SYSTEM_ACTOR_ID,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.status, "RUNNING");
});

test("slug-alias 'game_3' + SYSTEM_ACTOR_ID → assertHost passerer (audit §2.7)", async () => {
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "game_3",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: SYSTEM_ACTOR_ID,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot.currentGame?.status, "RUNNING");
});
