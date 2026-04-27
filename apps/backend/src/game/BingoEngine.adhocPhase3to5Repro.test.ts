/**
 * Repro-test for Tobias-bug 2026-04-27 ad-hoc Spill 1 "BINGO1":
 *
 * User testet ad-hoc med 4 tickets, fikk credits for 1 Rad (100 kr) +
 * 2 Rader (200 kr), MEN end-screen viste "Ikke vunnet" for 3 Rader,
 * 4 Rader og Fullt Hus — selv om user påstår de faktisk fullførte
 * alle phaser før spillet endte.
 *
 * Forventet (basert på BIN-694 + #604): alle 5 phaser markeres won
 * når 24 baller (alle PLAYER_A_GRID-tall) er trukket.
 *
 * Test verifiserer både den eksakte scenarioen og en variant der
 * ad-hoc-flyten bruker `gameType: "bingo"` slug (matcher BINGO1
 * canonical room-creation i `roomEvents.ts`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "./variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

const PLAYER_A_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class FixedTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: PLAYER_A_GRID.map((row) => [...row]) };
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

test("BUG-2026-04-27 repro: solo-spiller med 4 tickets, ad-hoc bingo — ALLE 5 phaser MÅ markeres won", async () => {
  const engine = new BingoEngine(
    new FixedTicketAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  // Match ad-hoc BINGO1-flyten: gameSlug "bingo" → DEFAULT_NORSK_BINGO_CONFIG
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 45,
    ticketsPerPlayer: 4, // ← user kjøpte 4 tickets (men alle får samme grid for repro)
    payoutPercent: 80,
    gameType: "bingo",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Alle 24 tall fra PLAYER_A_GRID (free center=0 ekskludert) → fyller alle 5 rader
  const allAlice: number[] = [];
  for (const row of PLAYER_A_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
  prioritiseDrawBag(engine, roomCode, allAlice);

  // Track phase-status etter hver ball for å se nøyaktig hvor recursion evt. stopper
  type Snapshot = { afterBall: number; wonPhases: string[]; status: string };
  const snapshots: Snapshot[] = [];
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
    const snap = engine.getRoomSnapshot(roomCode);
    snapshots.push({
      afterBall: i + 1,
      wonPhases: (snap.currentGame?.patternResults ?? []).filter((r) => r.isWon).map((r) => r.patternName),
      status: snap.currentGame?.status ?? "?",
    });
    if (snap.currentGame?.status === "ENDED") break;
  }

  const final = engine.getRoomSnapshot(roomCode).currentGame!;

  // Print debug-info hvis assertion feiler — gjør det enkelt å se hvor det stoppet
  const phaseDebug = (final.patternResults ?? []).map(
    (r) => `${r.patternName}=${r.isWon ? `won@${r.wonAtDraw}/${r.payoutAmount}kr` : "NOT-WON"}`,
  ).join(", ");
  const ballsDrawn = final.drawnNumbers.length;
  const lastSnap = snapshots[snapshots.length - 1];

  assert.equal(
    final.status,
    "ENDED",
    `Status skal være ENDED. Faktisk: ${final.status}. endedReason=${final.endedReason}. Phases: ${phaseDebug}. Balls drawn: ${ballsDrawn}. Last snap: ${JSON.stringify(lastSnap)}`,
  );
  assert.equal(
    final.endedReason,
    "BINGO_CLAIMED",
    `endedReason skal være BINGO_CLAIMED. Faktisk: ${final.endedReason}. Phases: ${phaseDebug}`,
  );

  const phaseByName = new Map<string, { isWon: boolean; payoutAmount?: number }>();
  for (const r of final.patternResults ?? []) {
    phaseByName.set(r.patternName, { isWon: r.isWon, payoutAmount: r.payoutAmount });
  }

  // Hver enkelt phase MÅ være won — dette er det user-rapporterte problem
  assert.equal(phaseByName.get("1 Rad")?.isWon, true, `1 Rad skal være won. Phases: ${phaseDebug}`);
  assert.equal(phaseByName.get("2 Rader")?.isWon, true, `2 Rader skal være won. Phases: ${phaseDebug}`);
  assert.equal(phaseByName.get("3 Rader")?.isWon, true, `3 Rader skal være won. Phases: ${phaseDebug}`);
  assert.equal(phaseByName.get("4 Rader")?.isWon, true, `4 Rader skal være won. Phases: ${phaseDebug}`);
  assert.equal(phaseByName.get("Fullt Hus")?.isWon, true, `Fullt Hus skal være won. Phases: ${phaseDebug}`);
});

test("PHASE3-FIX (2026-04-27): endGame kjører last-chance evaluateActivePhase før MANUAL_END", async () => {
  // Scenario: alle 24 PLAYER_A_GRID-baller er trukket → spilleren har
  // alle 5 phaser oppfylt. Men recursion stopper etter Phase 2 (simulerer
  // en transient ledger-feil). Når host kaller endGame manuelt, MÅ
  // endGame kjøre last-chance evaluering så Phase 3+ blir registrert.
  const engine = new BingoEngine(
    new FixedTicketAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Alice",
    walletId: "w-alice",
    gameSlug: "bingo",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 45,
    ticketsPerPlayer: 4,
    payoutPercent: 80,
    gameType: "bingo",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Først trekk 10 baller (Phase 1+2 vinnes via auto-claim)
  prioritiseDrawBag(engine, roomCode, [
    1, 16, 31, 46, 61,    // rad 0
    2, 17, 32, 47, 62,    // rad 1
  ]);
  for (let i = 0; i < 10; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
  }

  // Nå manuelt fyll opp drawnNumbers med rad 2, 3, 4 (uten å gå gjennom
  // drawNextNumber → ingen auto-claim). Dette simulerer "phaser oppfylt
  // men recursion svelget" — verifier at endGame fanger opp.
  const rooms = (engine as unknown as { rooms: Map<string, { currentGame?: { drawnNumbers: number[] } }> }).rooms;
  const game = rooms.get(roomCode)?.currentGame;
  if (game) {
    for (const n of [3, 18, 48, 63, 4, 19, 33, 49, 64, 5, 20, 34, 50, 65]) {
      game.drawnNumbers.push(n);
    }
  }

  // endGame skal trigge last-chance evaluering → Phase 3, 4, FH alle markert won
  await engine.endGame({ roomCode, actorPlayerId: hostId! });

  const final = engine.getRoomSnapshot(roomCode).currentGame!;
  const phaseDebug = (final.patternResults ?? []).map(
    (r) => `${r.patternName}=${r.isWon ? `won@${r.wonAtDraw}` : "NOT-WON"}`,
  ).join(", ");

  // PHASE3-FIX skal trigge så Fullt Hus vinnes via last-chance:
  assert.equal(final.endedReason, "BINGO_CLAIMED", `endedReason etter last-chance skal være BINGO_CLAIMED. Phases: ${phaseDebug}`);
  const phaseByName = new Map<string, boolean>();
  for (const r of final.patternResults ?? []) {
    phaseByName.set(r.patternName, r.isWon);
  }
  assert.equal(phaseByName.get("3 Rader"), true, `3 Rader skal være won via last-chance. Phases: ${phaseDebug}`);
  assert.equal(phaseByName.get("4 Rader"), true, `4 Rader skal være won via last-chance. Phases: ${phaseDebug}`);
  assert.equal(phaseByName.get("Fullt Hus"), true, `Fullt Hus skal være won via last-chance. Phases: ${phaseDebug}`);
});

test("BUG-2026-04-27 repro: variantConfig undefined (binding mangler) — om STANDARD-fallback brukes uten autoClaim", async () => {
  // Hva skjer hvis variantConfig IKKE er satt på roomet (bind glipper),
  // og startGame defaulter til "standard" uten autoClaimPhaseMode?
  // Dette ville matche ad-hoc-flyten der bindDefaultVariantConfig glipper
  // og evaluateActivePhase aldri kjøres.
  const engine = new BingoEngine(
    new FixedTicketAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Alice",
    walletId: "w-alice",
    // INGEN gameSlug = defaulter til "bingo" i createRoom (sjekkes nedenfor)
  });

  // Start uten variantConfig → defaulter til DEFAULT_STANDARD_CONFIG som
  // IKKE har autoClaimPhaseMode → evaluateActivePhase kjører aldri.
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: 45,
    ticketsPerPlayer: 4,
    payoutPercent: 80,
    // gameType + variantConfig eksplisitt undefined → fallback til "standard"
  });

  const allAlice: number[] = [];
  for (const row of PLAYER_A_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
  prioritiseDrawBag(engine, roomCode, allAlice);

  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! }).catch(() => {/* MAX_DRAWS-feil ignoreres */});
    const snap = engine.getRoomSnapshot(roomCode);
    if (snap.currentGame?.status === "ENDED") break;
  }

  const final = engine.getRoomSnapshot(roomCode).currentGame!;
  const phaseDebug = (final.patternResults ?? []).map(
    (r) => `${r.patternName}=${r.isWon ? `won@${r.wonAtDraw}/${r.payoutAmount}kr` : "NOT-WON"}`,
  ).join(", ");
  console.log(`[STANDARD-FALLBACK] status=${final.status}, endedReason=${final.endedReason}, phases=${phaseDebug}`);
  // Ikke assert noe spesifikt her — bare logger for å se om fallback-pathen
  // er det som rammer prod (ingen autoClaim → ingen wins).
});
