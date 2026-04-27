/**
 * REGRESSION 2026-04-27 — Demo Hall phase-progression bug.
 *
 * Tobias rapporterte 2026-04-27 at /web/-spillere i Demo Hall opplever at
 * spillet henger etter Phase 1 ("1 Rad"). Bilde fra
 * https://spillorama-system.onrender.com/web/ viste 55/75 baller trukket,
 * boards merket "1 Rad — klar!" men engine progresserte ikke til Phase 2.
 *
 * Forensikk:
 *   - PR #643 (`fix(spill1)`) introduserte `game.isPaused = true` etter hver
 *     fase-vinning for Spill 1 — master må manuelt resume mellom faser.
 *   - PR #660 (`feat(spill1) Demo Hall bypass`) la til `room.isTestHall`-
 *     bypass i `BingoEnginePatternEval.evaluateActivePhase` slik at
 *     test-haller kjører gjennom alle faser uten pause.
 *   - Disse to fixene fungerer ISOLERT i unit-test (se
 *     `BingoEngine.demoHallBypass.test.ts`) der `engine.createRoom` kalles
 *     direkte med `isTestHall: true`.
 *
 * ROOT CAUSE: socket-laget (`roomEvents.ts` + `game1ScheduledEvents.ts`)
 * propagerer IKKE `isTestHall`-flagget til `engine.createRoom`. Resultat:
 *   - `RoomState.isTestHall` er `undefined` for alle player-flow-rom
 *   - Bypassen i `evaluateActivePhase` (linje 463) trigger aldri
 *   - For Spill 1 (`bingo`-slug) hopper engine inn i `isPaused = true`-
 *     pathen (linje 521) og spillet henger til master resumer manuelt
 *   - I /web/-flyten med auto-draw + ingen master = stall
 */

import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine, DomainError } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "./variantConfig.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

const ALICE_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class FixedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: ALICE_GRID.map((r) => [...r]) };
  }
}

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

/**
 * Reproduksjon av regresjons-scenariet (PRE-FIX adferd):
 * Når socket-laget IKKE propagerer `isTestHall`, oppfører engine seg
 * som om hallen er en normal prod-hall — auto-pause etter hver fase.
 */
test(
  "regresjon — Spill 1 + isTestHall MANGLER: pauses etter Phase 1 (master må resume)",
  async () => {
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
      // isTestHall IKKE satt — etterligner pre-fix socket-flyt
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

    // Trekk hele rad 0 → Phase 1 ("1 Rad") vunnet på ball 5.
    prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
    for (let i = 0; i < 5; i += 1) {
      await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
    }

    const game = engine.getRoomSnapshot(roomCode).currentGame!;
    const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
    assert.equal(phase1?.isWon, true, "Phase 1 må være markert vunnet");
    assert.equal(
      game.isPaused,
      true,
      "uten isTestHall skal Spill 1 auto-pause etter Phase 1",
    );

    // Neste draw skal feile med GAME_PAUSED — bekrefter regresjons-kontrakten.
    await assert.rejects(
      engine.drawNextNumber({ roomCode, actorPlayerId: hostId! }),
      (err: unknown) =>
        err instanceof DomainError &&
        (err as DomainError).code === "GAME_PAUSED",
      "uten isTestHall skal drawNextNumber kaste GAME_PAUSED",
    );
  },
);

/**
 * Positiv test — full phase-progression for Demo Hall (isTestHall=true).
 */
test(
  "demo-hall — Spill 1 + isTestHall=true: progresserer alle 5 faser uten pause",
  async () => {
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
    await engine.startGame({
      roomCode,
      actorPlayerId: hostId!,
      entryFee: 10,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      gameType: "standard",
      variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    });

    const allAlice: number[] = [];
    for (const row of ALICE_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
    prioritiseDrawBag(engine, roomCode, allAlice);

    let drawAttempts = 0;
    for (let i = 0; i < 24; i += 1) {
      const game = engine.getRoomSnapshot(roomCode).currentGame!;
      assert.notEqual(
        game.isPaused,
        true,
        `Demo Hall skal ikke pause — sjekk #${i + 1} (drew ${drawAttempts}/24)`,
      );
      assert.equal(
        game.status,
        "RUNNING",
        `Demo Hall skal forbli RUNNING — sjekk #${i + 1}`,
      );
      await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
      drawAttempts += 1;
    }

    const finalGame = engine.getRoomSnapshot(roomCode).currentGame!;
    const wonPhaseCount = finalGame.patternResults?.filter((r) => r.isWon).length ?? 0;
    assert.equal(
      wonPhaseCount,
      5,
      `Alle 5 faser skal være vunnet (1 Rad → Fullt Hus). Faktisk: ${wonPhaseCount}`,
    );
    assert.equal(
      finalGame.status,
      "RUNNING",
      "Demo Hall: status forblir RUNNING selv etter Fullt Hus",
    );
  },
);

/**
 * Forensisk test — gjør det eksplisitt at `isTestHall === undefined`
 * (snarere enn `=== false`) trigger pause.
 */
test(
  "regresjon-detalj — undefined isTestHall pauses atomært etter Phase 1 (ikke Phase 2)",
  async () => {
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
    });
    const rooms = (
      engine as unknown as {
        rooms: Map<string, { isTestHall?: boolean }>;
      }
    ).rooms;
    assert.equal(
      rooms.get(roomCode)?.isTestHall,
      undefined,
      "før fix: roomEvents.ts setter ikke isTestHall — det er undefined",
    );

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
    const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
    const phase2 = game.patternResults?.find((r) => r.patternName === "2 Rader");
    assert.equal(phase1?.isWon, true, "Phase 1 vunnet");
    assert.equal(
      phase2?.isWon,
      false,
      "Phase 2 IKKE vunnet — auto-pause stopper recursion atomært",
    );
    assert.equal(game.isPaused, true, "auto-pause aktiv");
  },
);
