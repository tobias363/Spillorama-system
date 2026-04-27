/**
 * Tobias-direktiv 2026-04-27: Spill 1 ad-hoc-engine MÅ pause etter hver
 * fase-vinning så master kan starte spillet igjen.
 *
 *   "Etter hver rad som blir vunnet skal master starte spillet igjen, så
 *    legg inn at spillet stopper for hver rad som blir vunnet. Dette
 *    gjelder da kun for spill 1."
 *
 * Dekning:
 *   1) Spill 1 (slug=`bingo`): fase 1 vunnet → game.isPaused=true,
 *      drawNextNumber blokkerer GAME_PAUSED ved neste call.
 *   2) Spill 1: master `resumeGame()` → drawNextNumber tilgjengelig igjen.
 *   3) Spill 2 (slug=`rocket`) + Spill 3 (slug=`monsterbingo`): fase
 *      vunnet → spillet fortsetter, INGEN pause (deres kontrakt er
 *      annerledes — Spill 2/3 har egne engines, men evaluateActivePhase
 *      i base-klassen skal IKKE auto-pause for ikke-Spill-1-slugs).
 *   4) Spill 1 Fullt Hus: avslutter runden, IKKE pause (ENDED-state har
 *      forrang).
 *
 * Kontekst:
 *   - Scheduled-stien (Game1DrawEngineService) auto-pauser allerede via
 *     paused/paused_at_phase i DB (se Game1DrawEngineService.autoPause.test.ts).
 *   - Ad-hoc-stien (BingoEnginePatternEval.evaluateActivePhase) rekursjon
 *     ble før fall-through til neste fase i samme draw — denne testen
 *     verifiserer at den nå STOPPER atomært etter én fase for Spill 1.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine, DomainError } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import {
  DEFAULT_NORSK_BINGO_CONFIG,
} from "./variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
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

/** Overstyr drawBag — setter de gitte tallene først så testen blir deterministisk. */
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

async function setupSpill1Room(): Promise<{ engine: BingoEngine; roomCode: string; hostId: string }> {
  const engine = new BingoEngine(
    new FixedGridAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo", // ← Spill 1 slug
  });
  return { engine, roomCode, hostId: hostId! };
}

test("Tobias-direktiv 2026-04-27 — Spill 1: fase 1 vunnet → game.isPaused=true + drawNextNumber blokkerer", async () => {
  const { engine, roomCode, hostId } = await setupSpill1Room();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Trekk hele rad 0 → fase 1 ("1 Rad") vunnet på ball 5.
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  // Verifiser fase 1 vunnet + game auto-pauset.
  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true, "fase 1 skal være markert som vunnet");
  assert.equal(game.status, "RUNNING", "status forblir RUNNING — runden er ikke avsluttet");
  assert.equal(game.isPaused, true, "Spill 1 MÅ auto-pause etter fase-vinning");
  assert.match(
    game.pauseMessage ?? "",
    /1 Rad/,
    "pauseMessage skal nevne fasen som ble vunnet",
  );

  // drawNextNumber MÅ blokkere med GAME_PAUSED til master resumer.
  await assert.rejects(
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "skal kaste DomainError");
      assert.equal((err as DomainError).code, "GAME_PAUSED", "feil-kode skal være GAME_PAUSED");
      return true;
    },
  );
});

test("Tobias-direktiv 2026-04-27 — Spill 1: master resumeGame() → drawNextNumber tilgjengelig igjen", async () => {
  const { engine, roomCode, hostId } = await setupSpill1Room();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61, 2]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  // Auto-pauset etter fase 1.
  assert.equal(engine.getRoomSnapshot(roomCode).currentGame?.isPaused, true);

  // Master klikker "Resume" → drawNextNumber må fungere på neste call.
  engine.resumeGame(roomCode);
  const snapshotAfterResume = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshotAfterResume.currentGame?.isPaused, false, "isPaused skal være false etter resume");

  await assert.doesNotReject(
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    "neste draw skal fungere etter master-resume",
  );
});

test("Tobias-direktiv 2026-04-27 — Spill 2 (rocket): fase vunnet → INGEN pause (kontrakten gjelder kun Spill 1)", async () => {
  // Spill 2 (Rocket) bruker DEFAULT_GAME2_CONFIG som har autoClaimPhaseMode=true
  // men gjennom Game2Engine.onDrawCompleted-override, IKKE via evaluateActivePhase.
  // Vi tester her at evaluateActivePhase (base-klasse) ikke auto-pauser for
  // ikke-Spill-1-slugs i fall en custom variantConfig peker hit.
  const engine = new BingoEngine(
    new FixedGridAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-2",
    playerName: "Bob",
    walletId: "w-bob",
    gameSlug: "rocket", // ← Spill 2 slug — IKKE Spill 1
  });

  // Bruk norsk-bingo variantConfig på et rocket-rom for å teste at
  // gameSlug (ikke variantConfig) avgjør auto-pause.
  await engine.startGame({
    roomCode, actorPlayerId: hostId!, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
  }

  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true, "fase 1 skal være vunnet");
  assert.notEqual(game.isPaused, true, "Spill 2-rom skal IKKE auto-pause etter fase-vinning");

  // Neste draw må fungere uten resume — Spill 2-kontrakten beholder eksisterende flyt.
  await assert.doesNotReject(
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId! }),
    "Spill 2-rom skal fortsatt kunne trekke uten master-resume",
  );
});

test("Tobias-direktiv 2026-04-27 — Spill 1: Fullt Hus avslutter runden, IKKE pause", async () => {
  const { engine, roomCode, hostId } = await setupSpill1Room();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Trekk alle 24 tall i rekkefølge → master må resume mellom hver fase
  // (1 Rad, 2 Rader, 3 Rader, 4 Rader). Etter Fullt Hus: ENDED-state, ingen pause.
  const allAlice: number[] = [];
  for (const row of PLAYER_A_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
  prioritiseDrawBag(engine, roomCode, allAlice);

  for (let i = 0; i < 24; i += 1) {
    const snap = engine.getRoomSnapshot(roomCode);
    if (snap.currentGame?.isPaused) {
      engine.resumeGame(roomCode);
    }
    if (snap.currentGame?.status === "ENDED") break;
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  assert.equal(game.status, "ENDED", "Fullt Hus skal avslutte runden");
  assert.equal(game.endedReason, "BINGO_CLAIMED");

  // Fullt Hus-pattern markert som vunnet uten å sette isPaused (ENDED-state har forrang).
  const fullHus = game.patternResults?.find((r) => r.patternName === "Fullt Hus");
  assert.equal(fullHus?.isWon, true, "Fullt Hus skal være vunnet");

  // ENDED-state betyr ingen flere draws — isPaused-flagget er irrelevant her.
  // Verifiser at runden faktisk er stengt: drawNextNumber skal kaste GAME_NOT_RUNNING.
  await assert.rejects(
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "skal kaste DomainError");
      // Enten GAME_NOT_RUNNING eller NO_MORE_NUMBERS — runden er over uansett.
      const code = (err as DomainError).code;
      assert.ok(
        code === "GAME_NOT_RUNNING" || code === "NO_MORE_NUMBERS",
        `forventet GAME_NOT_RUNNING eller NO_MORE_NUMBERS, fikk ${code}`,
      );
      return true;
    },
  );
});

test("Tobias-direktiv 2026-04-27 — Spill 1 alle slugs: bingo, game_1, norsk-bingo auto-pauser likt", async () => {
  // Verifiser at canonical Spill 1-slug-listen (bingo, game_1, norsk-bingo)
  // alle trigger auto-pause. Hvis senere kode legger til alias må disse
  // også settes opp i isSpill1Slug-helperen.
  for (const slug of ["bingo", "game_1", "norsk-bingo"] as const) {
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      { minDrawIntervalMs: 0, minPlayersToStart: 1 },
    );
    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-x",
      playerName: "Alice",
      walletId: "w-alice",
      gameSlug: slug,
    });
    await engine.startGame({
      roomCode, actorPlayerId: hostId!, entryFee: 10, ticketsPerPlayer: 1,
      payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    });
    prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
    for (let i = 0; i < 5; i += 1) {
      await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
    }
    const game = engine.getRoomSnapshot(roomCode).currentGame!;
    assert.equal(
      game.isPaused,
      true,
      `slug=${slug} skal auto-pause etter fase-vinning (Tobias-direktiv 2026-04-27)`,
    );
  }
});
