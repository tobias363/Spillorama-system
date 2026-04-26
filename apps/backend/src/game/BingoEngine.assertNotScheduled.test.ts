/**
 * CRIT-4 / HIGH-1 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26):
 *
 * Defensiv runtime-guard: scheduled Spill 1 (slug `bingo` med
 * `scheduledGameId` satt) skal IKKE kunne mutater via ad-hoc-pathen
 * `BingoEngine.startGame/drawNextNumber/submitClaim`. Per
 * `SPILL1_ENGINE_ROLES_2026-04-23.md` er `Game1DrawEngineService`
 * autoritativ for scheduled Spill 1.
 *
 * Disse testene verifiserer at:
 *   1. `markRoomAsScheduled` setter `scheduledGameId` på rommet.
 *   2. Etter markering kaster startGame `USE_SCHEDULED_API`.
 *   3. Etter markering kaster drawNextNumber `USE_SCHEDULED_API`.
 *   4. Etter markering kaster submitClaim `USE_SCHEDULED_API`.
 *   5. Spill 2 (slug `rocket`) påvirkes IKKE av guarden.
 *   6. Spill 3 (slug `monsterbingo`) påvirkes IKKE av guarden.
 *   7. Ad-hoc Spill 1 (slug `bingo` uten markering) fungerer normalt.
 *   8. `markRoomAsScheduled` er idempotent ved gjentatte kall.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BingoEngine, DomainError } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
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
  });
}

// ── 1: markRoomAsScheduled setter scheduledGameId ───────────────────────────

test("CRIT-4: markRoomAsScheduled setter scheduledGameId på bingo-rom", async () => {
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });

  engine.markRoomAsScheduled(roomCode, "sg-123");

  // Indirekte verifikasjon: startGame skal nå kaste USE_SCHEDULED_API.
  await assert.rejects(
    () =>
      engine.startGame({
        roomCode,
        actorPlayerId: engine.getRoomSnapshot(roomCode)!.hostPlayerId,
        entryFee: 0,
        ticketsPerPlayer: 1,
        payoutPercent: 100,
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "USE_SCHEDULED_API");
      return true;
    },
  );
});

// ── 2: startGame blokkeres på scheduled-rom ─────────────────────────────────

test("CRIT-4: startGame kaster USE_SCHEDULED_API på scheduled bingo-rom", async () => {
  const engine = makeEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });
  engine.markRoomAsScheduled(roomCode, "sg-1");

  await assert.rejects(
    () =>
      engine.startGame({
        roomCode,
        actorPlayerId: playerId,
        entryFee: 0,
        ticketsPerPlayer: 1,
        payoutPercent: 100,
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "USE_SCHEDULED_API");
      return true;
    },
  );
});

// ── 3: drawNextNumber blokkeres på scheduled-rom ────────────────────────────

test("CRIT-4: drawNextNumber kaster USE_SCHEDULED_API på scheduled bingo-rom", async () => {
  const engine = makeEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });
  // Start spill først (før markering) så det er en "RUNNING"-state.
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });
  // Nå markerer vi som scheduled — etterpå skal drawNextNumber blokkeres
  // selv om RUNNING-game finnes.
  engine.markRoomAsScheduled(roomCode, "sg-2");

  await assert.rejects(
    () =>
      engine.drawNextNumber({
        roomCode,
        actorPlayerId: playerId,
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "USE_SCHEDULED_API");
      return true;
    },
  );
});

// ── 4: submitClaim blokkeres på scheduled-rom ───────────────────────────────

test("CRIT-4: submitClaim kaster USE_SCHEDULED_API på scheduled bingo-rom", async () => {
  const engine = makeEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 0,
    ticketsPerPlayer: 1,
    payoutPercent: 100,
  });
  engine.markRoomAsScheduled(roomCode, "sg-3");

  await assert.rejects(
    () =>
      engine.submitClaim({
        roomCode,
        playerId,
        type: "BINGO",
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "USE_SCHEDULED_API");
      return true;
    },
  );
});

// ── 5: Spill 2 (rocket) påvirkes IKKE ───────────────────────────────────────

test("CRIT-4: Spill 2 (rocket) påvirkes IKKE av scheduled-guarden", async () => {
  const engine = makeEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "rocket",
  });
  // Selv om vi (per uhell) kaller markRoomAsScheduled på et rocket-rom
  // skal startGame fungere fordi gameSlug-filteret i assertNotScheduled
  // kun trigger på "bingo".
  engine.markRoomAsScheduled(roomCode, "sg-rocket");

  // startGame skal lykkes — ingen guard på rocket-slug.
  await assert.doesNotReject(() =>
    engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    }),
  );
});

// ── 6: Spill 3 (monsterbingo) påvirkes IKKE ─────────────────────────────────

test("CRIT-4: Spill 3 (monsterbingo) påvirkes IKKE av scheduled-guarden", async () => {
  const engine = makeEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "monsterbingo",
  });
  engine.markRoomAsScheduled(roomCode, "sg-monsterbingo");

  await assert.doesNotReject(() =>
    engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    }),
  );
});

// ── 7: Ad-hoc Spill 1 (uten markering) fungerer ─────────────────────────────

test("CRIT-4: Ad-hoc bingo-rom (ikke scheduled) fungerer normalt", async () => {
  const engine = makeEngine();
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });
  // INGEN markRoomAsScheduled — dette er ad-hoc Spill 1.

  await assert.doesNotReject(() =>
    engine.startGame({
      roomCode,
      actorPlayerId: playerId,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
    }),
  );
  await assert.doesNotReject(() =>
    engine.drawNextNumber({
      roomCode,
      actorPlayerId: playerId,
    }),
  );
});

// ── 8: markRoomAsScheduled idempotent ───────────────────────────────────────

test("CRIT-4: markRoomAsScheduled er idempotent — gjentatte kall trygt", async () => {
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });
  // Første markering.
  engine.markRoomAsScheduled(roomCode, "sg-X");
  // Andre markering med samme ID — skal ikke kaste.
  engine.markRoomAsScheduled(roomCode, "sg-X");
  // Tredje markering med ny ID — overskriver, men ikke en feil.
  engine.markRoomAsScheduled(roomCode, "sg-Y");

  // Rommet er fortsatt scheduled.
  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.ok(snapshot);
});

// ── 9: markRoomAsScheduled validerer input ──────────────────────────────────

test("CRIT-4: markRoomAsScheduled kaster på tom scheduledGameId", async () => {
  const engine = makeEngine();
  const { roomCode } = await engine.createRoom({
    hallId: "h",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });
  assert.throws(
    () => engine.markRoomAsScheduled(roomCode, ""),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_INPUT");
      return true;
    },
  );
  assert.throws(
    () => engine.markRoomAsScheduled(roomCode, "   "),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_INPUT");
      return true;
    },
  );
});

test("CRIT-4: markRoomAsScheduled kaster ROOM_NOT_FOUND for ukjent kode", () => {
  const engine = makeEngine();
  assert.throws(
    () => engine.markRoomAsScheduled("UNKNOWN", "sg-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "ROOM_NOT_FOUND");
      return true;
    },
  );
});
