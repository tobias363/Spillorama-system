/**
 * BingoEngine.variantConfigGuard.test.ts
 *
 * Defense-in-depth guard (Tobias 2026-04-27): hvis Spill 1-rommet har
 * mistet `variantConfigByRoom`-entry (f.eks. etter Render-restart der
 * BingoEngine-instansen ble re-instansiert mens scheduled-game-rom
 * fortsatt har klienter koblet til), skal `drawNextNumber` auto-binde
 * `DEFAULT_NORSK_BINGO_CONFIG` slik at 3-fase auto-claim (BIN-694)
 * fortsatt fungerer.
 *
 * Andre spill (rocket/monsterbingo/spillorama) skal IKKE få auto-bind —
 * de har sine egne variant-konfigurasjoner og må feile fail-loud
 * istedenfor å få Spill 1-default.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

const PLAYER_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class FixedTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: PLAYER_GRID.map((row) => [...row]) };
  }
}

test("VARIANT-CONFIG GUARD: Spill 1 (slug=bingo) auto-binder DEFAULT_NORSK_BINGO_CONFIG hvis cache er tom", async () => {
  const engine = new BingoEngine(
    new FixedTicketAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );

  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-guard-1",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 45,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
  });

  // Simuler Render-restart: slett variantConfigByRoom-entry FØR neste draw.
  const internals = engine as unknown as {
    variantConfigByRoom: Map<string, unknown>;
    variantGameTypeByRoom: Map<string, string>;
  };
  internals.variantConfigByRoom.delete(roomCode);
  internals.variantGameTypeByRoom.delete(roomCode);

  // Draw én ball — guarden skal kicke inn og auto-binde default.
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });

  const reboundConfig = internals.variantConfigByRoom.get(roomCode) as
    | { autoClaimPhaseMode?: boolean }
    | undefined;
  assert.ok(reboundConfig, "variantConfigByRoom skal være re-bundet etter draw");
  assert.equal(
    reboundConfig.autoClaimPhaseMode,
    true,
    "auto-bundet config skal ha autoClaimPhaseMode=true (DEFAULT_NORSK_BINGO_CONFIG)",
  );
  assert.equal(
    internals.variantGameTypeByRoom.get(roomCode),
    "bingo",
    "variantGameType skal også re-bindes til 'bingo'",
  );
});

test("VARIANT-CONFIG GUARD: Non-Spill-1 (slug=rocket) skipper auto-bind", async () => {
  const engine = new BingoEngine(
    new FixedTicketAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );

  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-guard-2",
    playerName: "Bob",
    walletId: "w-bob",
    gameSlug: "rocket",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 45,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
  });

  // Slett cache.
  const internals = engine as unknown as {
    variantConfigByRoom: Map<string, unknown>;
    variantGameTypeByRoom: Map<string, string>;
  };
  internals.variantConfigByRoom.delete(roomCode);
  internals.variantGameTypeByRoom.delete(roomCode);

  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });

  // For rocket skal cache forbli tom (ingen auto-bind for non-Spill-1).
  assert.equal(
    internals.variantConfigByRoom.get(roomCode),
    undefined,
    "rocket-rom skal IKKE få auto-bundet DEFAULT_NORSK_BINGO_CONFIG",
  );
});
