/**
 * Audit-funn #8 hull 4: Sen-join under aktiv runde.
 *
 * Scenario: Spiller A har startet spillet, trekking er i gang. Spiller B
 * dropper innom rommet midt i fase 1 (via `joinRoom`).
 *
 * Kontrakt:
 *
 *   a) Sen-joiner legges til `room.players`, men IKKE til `game.tickets`
 *      eller `game.participatingPlayerIds` — startGame snapshot-et deltaker-
 *      listen da runden begynte.
 *   b) Sen-joiner blir IKKE belastet `entryFee` — ingen wallet-operasjon
 *      for late-joiners.
 *   c) Hvis sen-joiner tilfeldigvis har et vinnende brett-mønster (urealistisk
 *      siden han ikke har noen brett i spillet), skal evaluateActivePhase
 *      ALDRI regne ham som vinner. Fase-premier går kun til armed/
 *      participating-spillere.
 *   d) Sen-joiners inntog endrer ikke `drawnNumbers`, `patternResults` eller
 *      `prizePool` for den aktive runden — spillet er orthogonalt til
 *      rom-medlemskap etter startGame.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "./variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

const SHARED_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class SharedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: SHARED_GRID.map((row) => [...row]) };
  }
}

function prioritiseDrawBag(engine: BingoEngine, roomCode: string, numbers: number[]): void {
  const rooms = (engine as unknown as { rooms: Map<string, { currentGame?: { drawBag: number[] } }> }).rooms;
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

test("late-joiner: blir i room.players, men IKKE i game.tickets eller participatingPlayerIds", async () => {
  const engine = new BingoEngine(
    new SharedGridAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: aliceId } = await engine.createRoom({
    hallId: "hall-1", playerName: "Alice", walletId: "w-alice",
  });

  await engine.startGame({
    roomCode, actorPlayerId: aliceId!, entryFee: 100, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31]);
  for (let i = 0; i < 2; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: aliceId! });
  }

  // Bob joins mid-game.
  const { playerId: bobId } = await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "Bob", walletId: "w-bob",
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  const playerIds = snapshot.players.map((p) => p.id);
  assert.ok(playerIds.includes(aliceId!), "Alice er i room.players");
  assert.ok(playerIds.includes(bobId!), "Bob skal være i room.players (lagt til via joinRoom)");

  // Men game.tickets og participatingPlayerIds skal bare inneholde Alice.
  const game = snapshot.currentGame!;
  assert.ok(game.tickets[aliceId!], "Alice har tickets");
  assert.equal(
    game.tickets[bobId!],
    undefined,
    "Bob skal IKKE ha tickets i den aktive runden",
  );
  assert.ok(game.participatingPlayerIds?.includes(aliceId!), "Alice i participatingPlayerIds");
  assert.equal(
    game.participatingPlayerIds?.includes(bobId!),
    false,
    "Bob skal IKKE være i participatingPlayerIds",
  );
});

test("late-joiner: wallet belastes ikke entryFee", async () => {
  const wallet = new InMemoryWalletAdapter();
  // Bob har 1000 kr startbalanse — sjekk at dette ikke endres når han joiner.
  await wallet.createAccount({ accountId: "w-bob", initialBalance: 1000 });

  const engine = new BingoEngine(
    new SharedGridAdapter(),
    wallet,
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: aliceId } = await engine.createRoom({
    hallId: "hall-1", playerName: "Alice", walletId: "w-alice",
  });

  await engine.startGame({
    roomCode, actorPlayerId: aliceId!, entryFee: 250, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Bob joiner mid-game.
  await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "Bob", walletId: "w-bob",
  });

  // Bobs wallet-balanse skal være uendret (ingen entryFee debitert).
  const balance = await wallet.getBalance("w-bob");
  assert.equal(balance, 1000, "sen-joiner skal IKKE belastes entryFee");
});

test("late-joiner: auto-claim ekskluderer late-joiner selv om hans tenkte brett ville oppfylt fasen", async () => {
  // Selv om SharedGridAdapter kunne gitt Bob et vinnende brett hvis han
  // hadde fått deltatt, så skal han IKKE telle som vinner fordi
  // `evaluateActivePhase` iterer bare over `game.tickets` — og Bob er
  // ikke der siden han joinet etter startGame.
  const engine = new BingoEngine(
    new SharedGridAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: aliceId } = await engine.createRoom({
    hallId: "hall-1", playerName: "Alice", walletId: "w-alice",
  });

  await engine.startGame({
    roomCode, actorPlayerId: aliceId!, entryFee: 500, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Trekk 2 baller, la Bob joine, trekk 3 siste for å lukke fase 1.
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  await engine.drawNextNumber({ roomCode, actorPlayerId: aliceId! });
  await engine.drawNextNumber({ roomCode, actorPlayerId: aliceId! });

  const { playerId: bobId } = await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "Bob", walletId: "w-bob",
  });

  await engine.drawNextNumber({ roomCode, actorPlayerId: aliceId! });
  await engine.drawNextNumber({ roomCode, actorPlayerId: aliceId! });
  await engine.drawNextNumber({ roomCode, actorPlayerId: aliceId! });

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true, "fase 1 vunnet av Alice");
  assert.equal(phase1?.winnerId, aliceId, "vinneren er Alice");
  assert.ok(
    !phase1?.winnerIds?.includes(bobId!),
    `Bob skal ikke være i winnerIds — faktisk: ${JSON.stringify(phase1?.winnerIds)}`,
  );

  // Bob skal heller ikke ha noen claim i game.claims.
  const bobClaims = game.claims.filter((c) => c.playerId === bobId);
  assert.equal(bobClaims.length, 0, "Bob skal ikke ha claim-entries");
});

test("late-joiner: drawnNumbers + patternResults uendret av join-hendelsen", async () => {
  // Regresjonstest: ingen side-effekt fra joinRoom på aktivt spill.
  const engine = new BingoEngine(
    new SharedGridAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: aliceId } = await engine.createRoom({
    hallId: "hall-1", playerName: "Alice", walletId: "w-alice",
  });

  await engine.startGame({
    roomCode, actorPlayerId: aliceId!, entryFee: 100, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31]);
  await engine.drawNextNumber({ roomCode, actorPlayerId: aliceId! });
  await engine.drawNextNumber({ roomCode, actorPlayerId: aliceId! });
  await engine.drawNextNumber({ roomCode, actorPlayerId: aliceId! });

  const snapBefore = engine.getRoomSnapshot(roomCode);
  const gameBefore = snapBefore.currentGame!;
  const drawnBefore = [...gameBefore.drawnNumbers];
  const poolBefore = gameBefore.remainingPrizePool;
  const phaseResultsBefore = JSON.stringify(gameBefore.patternResults);

  await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "Bob", walletId: "w-bob",
  });

  const snapAfter = engine.getRoomSnapshot(roomCode);
  const gameAfter = snapAfter.currentGame!;
  assert.deepEqual(gameAfter.drawnNumbers, drawnBefore, "drawnNumbers uendret");
  assert.equal(gameAfter.remainingPrizePool, poolBefore, "prizePool uendret");
  assert.equal(
    JSON.stringify(gameAfter.patternResults),
    phaseResultsBefore,
    "patternResults uendret",
  );
});
