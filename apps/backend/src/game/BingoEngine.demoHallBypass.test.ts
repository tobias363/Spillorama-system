/**
 * Demo Hall bypass — Tobias 2026-04-27.
 *
 *   "Vi har satt at spillet stopper når man treffer 1 rad, kan du endre
 *    at når den står på hallen som er Demo Hall (lokal testing) så stopper
 *    den ikke? det er da kun for å teste spillet."
 *
 * Når `RoomState.isTestHall === true` skal Spill 1 ad-hoc-engine
 * (BingoEnginePatternEval.evaluateActivePhase) IKKE auto-pause på phase-won
 * og IKKE avslutte runden på Fullt Hus. Runden går helt til alle baller
 * er trukket (MAX_DRAWS_REACHED / DRAW_BAG_EMPTY i drawNextNumber).
 *
 * Dekning:
 *   1) Spill 1 + isTestHall=true: fase 1 vunnet → game.isPaused IKKE satt,
 *      drawNextNumber kan kalles videre.
 *   2) Spill 1 + isTestHall=true: Fullt Hus vunnet → game.status forblir
 *      RUNNING, bingoWinnerId settes (klient kan vise pop-up).
 *   3) Spill 1 + isTestHall=true: runden ender til slutt via NO_MORE_NUMBERS
 *      (MAX_DRAWS_REACHED når draw-bag er tom).
 *   4) Spill 1 UTEN isTestHall: pause + end-on-Fullt-Hus uendret (regresjon).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { DomainError } from "../errors/DomainError.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "./variantConfig.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

const PLAYER_A_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class FixedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: PLAYER_A_GRID.map((r) => [...r]) };
  }
}

/**
 * Setter de gitte tallene først i draw-bag-en så testen blir deterministisk.
 * Resten beholdes i opprinnelig random-rekkefølge.
 */
function prioritiseDrawBag(
  engine: BingoEngine,
  roomCode: string,
  numbers: number[],
): void {
  const rooms = (
    engine as unknown as {
      rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
    }
  ).rooms;
  const bag = rooms.get(roomCode)?.currentGame?.drawBag;
  if (!bag) return;
  const preferred: number[] = [];
  const rest: number[] = [];
  const wanted = new Set(numbers);
  for (const n of bag) {
    if (wanted.has(n)) preferred.push(n);
    else rest.push(n);
  }
  preferred.sort((a, b) => numbers.indexOf(a) - numbers.indexOf(b));
  bag.length = 0;
  bag.push(...preferred, ...rest);
}

async function setupSpill1TestHallRoom(): Promise<{
  engine: BingoEngine;
  roomCode: string;
  hostId: string;
}> {
  const engine = new BingoEngine(
    new FixedGridAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-demo",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
    isTestHall: true,
  });
  return { engine, roomCode, hostId: hostId! };
}

test("demo-hall-bypass — Spill 1 + isTestHall=true: fase 1 vunnet → INGEN auto-pause", async () => {
  const { engine, roomCode, hostId } = await setupSpill1TestHallRoom();
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    gameType: "standard",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Trekk hele rad 0 → fase 1 ("1 Rad") vunnet på ball 5.
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true, "fase 1 skal være markert som vunnet");
  assert.equal(game.status, "RUNNING", "status forblir RUNNING");
  assert.notEqual(
    game.isPaused,
    true,
    "test-hall skal IKKE auto-pause etter fase-vinning",
  );

  // Neste draw skal fungere uten manuell resume.
  await assert.doesNotReject(
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    "test-hall skal kunne trekke videre uten resume",
  );
});

test("demo-hall-bypass — Spill 1 + isTestHall=true: Fullt Hus vunnet → IKKE end-of-round", async () => {
  const { engine, roomCode, hostId } = await setupSpill1TestHallRoom();
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    gameType: "standard",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Trekk alle 24 ikke-nullceller → Fullt Hus oppnås men runden skal
  // fortsette pga test-hall-bypass.
  const allAlice: number[] = [];
  for (const row of PLAYER_A_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
  prioritiseDrawBag(engine, roomCode, allAlice);

  // Trekk alle 24 baller. Test-hall: ingen pause mellom faser, ingen end
  // på Fullt Hus.
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const fullHus = game.patternResults?.find(
    (r) => r.patternName === "Fullt Hus",
  );
  assert.equal(fullHus?.isWon, true, "Fullt Hus skal være vunnet");
  assert.equal(
    game.status,
    "RUNNING",
    "test-hall skal IKKE settes til ENDED på Fullt Hus",
  );
  assert.equal(
    game.bingoWinnerId,
    hostId,
    "bingoWinnerId skal settes så klient kan vise vinner-popup",
  );
  assert.notEqual(
    game.endedReason,
    "BINGO_CLAIMED",
    "endedReason skal ikke settes — runden er ikke avsluttet ennå",
  );
});

test("demo-hall-bypass — Spill 1 + isTestHall=true: runden ender til slutt via NO_MORE_NUMBERS", async () => {
  const { engine, roomCode, hostId } = await setupSpill1TestHallRoom();
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    gameType: "standard",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Trekk så mange ganger som engine tillater. Engine har default
  // maxDrawsPerRound=30; etter draw 30 settes game.status=ENDED med
  // endedReason="MAX_DRAWS_REACHED" (post-draw branch i drawNextNumber).
  // Test-hall skal IKKE ha endedReason="BINGO_CLAIMED" — det ville bety
  // bypassen ikke virket.
  let draws = 0;
  for (let i = 0; i < 100; i += 1) {
    try {
      await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
      draws += 1;
    } catch (err) {
      if (
        err instanceof DomainError &&
        (err.code === "NO_MORE_NUMBERS" || err.code === "GAME_NOT_RUNNING")
      ) {
        // Begge utfall betyr at runden er over på en naturlig måte:
        //   - NO_MORE_NUMBERS: pre-draw MAX-sjekk eller bag-tom-sjekk
        //   - GAME_NOT_RUNNING: runden ble ENDED i forrige iter via
        //     post-draw MAX_DRAWS_REACHED-grenen
        break;
      }
      throw err;
    }
  }

  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  assert.equal(
    game.status,
    "ENDED",
    `status skal være ENDED til slutt. Trekk gjennomført: ${draws}`,
  );
  assert.ok(
    game.endedReason === "MAX_DRAWS_REACHED" ||
      game.endedReason === "DRAW_BAG_EMPTY",
    `endedReason skal være MAX_DRAWS_REACHED eller DRAW_BAG_EMPTY (fikk ${game.endedReason}). Bypass virker hvis ikke "BINGO_CLAIMED".`,
  );
  assert.notEqual(
    game.endedReason,
    "BINGO_CLAIMED",
    "test-hall skal IKKE ende på BINGO_CLAIMED",
  );
});

test("demo-hall-bypass — Spill 1 UTEN isTestHall: regresjon — pause + end-on-Fullt-Hus uendret", async () => {
  // Sjekk at flagget kun aktiveres når eksplisitt satt — eksisterende
  // prod-haller (uten isTestHall) skal beholde dagens oppførsel.
  const engine = new BingoEngine(
    new FixedGridAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-prod",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
    // isTestHall ikke satt → eksisterende prod-oppførsel
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    gameType: "standard",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
  }

  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  assert.equal(game.isPaused, true, "prod-hall skal fortsatt auto-pause");
  await assert.rejects(
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId! }),
    (err: unknown) =>
      err instanceof DomainError && (err as DomainError).code === "GAME_PAUSED",
    "prod-hall skal fortsatt blokkere drawNext mens paused",
  );
});
