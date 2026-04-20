/**
 * BIN-694: Norsk 75-ball bingo — 5-fase fase-overgang + multi-winner split.
 *
 * Avklart av Tobias 2026-04-20:
 *   - Fase 1 ("1 Rad"): ≥1 horisontal rad ELLER ≥1 vertikal kolonne
 *   - Fase 2 ("2 Rader"): ≥2 hele vertikale kolonner (KUN loddrett)
 *   - Fase 3 ("3 Rader"): ≥3 hele vertikale kolonner
 *   - Fase 4 ("4 Rader"): ≥4 hele vertikale kolonner
 *   - Fase 5 ("Fullt Hus"): alle 25 felt merket
 *
 *   Ingen diagonaler teller i noen fase.
 *   Samtidige vinnere i samme fase deler premien likt.
 *   Kun Fullt Hus-fasen avslutter runden.
 *
 * Dekning (alle tester bruker DEFAULT_NORSK_BINGO_CONFIG):
 *   1. Fase 1 vunnet av horisontal rad → runde fortsetter
 *   2. Fase 1 vunnet av vertikal kolonne → også godkjent
 *   3. Fase 5 (Fullt Hus) avslutter runden
 *   4. Multi-winner split — 2 spillere vinner fase 1 samtidig
 *   5. Runde avsluttes IKKE ved fase 1 win
 *   6. Fase 2 krever 2 vertikale kolonner (horisontale rader teller ikke)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "./variantConfig.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

/**
 * Fixed-ticket adapter som gir ulike brett til hver spiller. Indekser i
 * `CreateTicketInput.ticketIndex` er ikke stabile per-spiller, så vi
 * rotérer grid-varianter basert på player-id og ticketIndex.
 */
const PLAYER_A_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

const PLAYER_B_GRID = [
  [6, 21, 35, 51, 66],
  [7, 22, 36, 52, 67],
  [8, 23, 0, 53, 68],
  [9, 24, 37, 54, 69],
  [10, 25, 38, 55, 70],
];

class PerPlayerTicketAdapter implements BingoSystemAdapter {
  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    // Deterministisk: alfabetisk sortert spiller → første grid, andre →
    // andre. Tester kontrollerer draw-bag sånn at spillere vinner på
    // forskjellige punkter.
    const nameHash = input.player.name.charCodeAt(0);
    const grid = nameHash < "M".charCodeAt(0) ? PLAYER_A_GRID : PLAYER_B_GRID;
    return { grid: grid.map((row) => [...row]) };
  }
}

async function setupRoom(): Promise<{
  engine: BingoEngine;
  roomCode: string;
  hostId: string;
  guestId: string;
}> {
  const engine = new BingoEngine(
    new PerPlayerTicketAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1", playerName: "Alice", walletId: "w-alice",
  });
  const { playerId: guestId } = await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "Zoe", walletId: "w-zoe",
  });
  return { engine, roomCode, hostId: hostId!, guestId: guestId! };
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
  // Sikrer nøyaktig rekkefølge for preferred-numbers (numbers[0] først osv).
  preferred.sort((a, b) => numbers.indexOf(a) - numbers.indexOf(b));
  bag.length = 0;
  bag.push(...preferred, ...rest);
}

test("BIN-694: fase 1 vunnet av fase-1-rad → runden fortsetter (status RUNNING)", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Alice har PLAYER_A_GRID. Første rad: 1, 16, 31, 46, 61.
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);

  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  assert.equal(game.status, "RUNNING", "runden skal fortsette etter 1. rad");
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true, "fase 1 skal være markert som vunnet");
  const phase2 = game.patternResults?.find((r) => r.patternName === "2 Rader");
  assert.equal(phase2?.isWon, false, "fase 2 skal fortsatt være aktiv");
});

test("BIN-694: fase 3 (Fullt Hus) avslutter runden", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Alle 24 tall (unntatt free=0) fra PLAYER_A_GRID.
  const allAlice: number[] = [];
  for (const row of PLAYER_A_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
  prioritiseDrawBag(engine, roomCode, allAlice);

  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  assert.equal(game.status, "ENDED", "runden skal være avsluttet ved Fullt Hus");
  assert.equal(game.endedReason, "BINGO_CLAIMED");
  const phase3 = game.patternResults?.find((r) => r.patternName === "Fullt Hus");
  assert.equal(phase3?.isWon, true);
  assert.equal(phase3?.winnerId, hostId);
});

test("BIN-694: multi-winner split — 2 spillere vinner fase 1 på samme ball", async () => {
  const { engine, roomCode, hostId, guestId } = await setupRoom();
  // Zoe får PLAYER_B_GRID. Hvis vi setter identisk grid for begge vil de
  // vinne samtidig. La oss bruke en spesial-adapter der begge har samme grid.
  (engine as unknown as { bingoAdapter: { createTicket: (input: CreateTicketInput) => Promise<Ticket> } }).bingoAdapter = {
    createTicket: async () => ({ grid: PLAYER_A_GRID.map((r) => [...r]) }),
  };

  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // prizePool = 2 players × 10 kr = 20 kr. payoutBudget = 20 × 80% = 16 kr.
  // Fase 1 = 25% = 5 kr totalt → 2.5 kr per spiller → Math.floor = 2 kr.
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);

  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true);

  // Begge spillere skal ha fått claim av type "LINE" med valid=true
  const aliceClaim = game.claims.find((c) => c.playerId === hostId && c.type === "LINE");
  const zoeClaim = game.claims.find((c) => c.playerId === guestId && c.type === "LINE");
  assert.ok(aliceClaim, "Alice skal ha LINE-claim");
  assert.ok(zoeClaim, "Zoe skal ha LINE-claim");
  assert.equal(aliceClaim!.valid, true);
  assert.equal(zoeClaim!.valid, true);
  // Premien er splittet likt
  assert.equal(aliceClaim!.payoutAmount, zoeClaim!.payoutAmount, "begge skal få samme beløp");
  assert.ok((aliceClaim!.payoutAmount ?? 0) > 0, "beløp skal være positivt");
});

test("BIN-694: regresjon — runden avsluttes IKKE ved fase 1 win (dagens bug før BIN-694)", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);

  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  // Etter fase 1 vunnet, skal vi kunne fortsette å trekke.
  await assert.doesNotReject(
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    "neste draw skal fungere selv etter fase 1 vunnet",
  );
});

test("BIN-694: Fase 1 vinnes av VERTIKAL kolonne (ikke bare horisontal)", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Kolonne 0 i PLAYER_A_GRID: 1, 2, 3, 4, 5
  prioritiseDrawBag(engine, roomCode, [1, 2, 3, 4, 5]);

  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true, "fase 1 skal være vunnet av hel kolonne");
  assert.equal(game.status, "RUNNING");
});

test("BIN-694: Fase 2 krever 2 VERTIKALE kolonner — 2 horisontale rader er IKKE nok", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Først: trekk hele rad 0 (fase 1 vunnet via horisontal)
  // Deretter: trekk hele rad 1 (bruker har 2 horisontale rader nå — MEN fase 2 krever kolonner)
  prioritiseDrawBag(engine, roomCode, [
    1, 16, 31, 46, 61,   // rad 0
    2, 17, 32, 47, 62,   // rad 1
  ]);

  for (let i = 0; i < 10; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  const phase2 = game.patternResults?.find((r) => r.patternName === "2 Rader");
  assert.equal(phase1?.isWon, true, "fase 1 skal være vunnet av rad 0");
  assert.equal(phase2?.isWon, false, "fase 2 skal IKKE være vunnet — horisontale rader teller ikke");
});

test("BIN-694: E2E full sekvens — 1 Rad → 2 → 3 → 4 Rader → Fullt Hus, kun Fullt Hus avslutter", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Merk kolonne 0, 1, 2, 3, 4 i rekkefølge → fase 1 etter kol 0, fase 2
  // etter kol 1, fase 3 etter kol 2, fase 4 etter kol 3, Fullt Hus etter kol 4.
  // (Fase 1 aksepterer også horisontal rad, men kolonne 0 oppfyller også det).
  prioritiseDrawBag(engine, roomCode, [
    1, 2, 3, 4, 5,         // kol 0  → fase 1 vunnet (1 kolonne ≥ 1)
    16, 17, 18, 19, 20,    // kol 1  → fase 2 vunnet (2 kolonner)
    31, 32, 33, 34,        // kol 2 (midtcellen er free, så 4 tall holder) → fase 3
    46, 47, 48, 49, 50,    // kol 3  → fase 4
    61, 62, 63, 64, 65,    // kol 4  → Fullt Hus
  ]);

  const phaseSnapshots: Array<{ afterBall: number; wonPhases: string[]; status: string }> = [];
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
    const snap = engine.getRoomSnapshot(roomCode);
    phaseSnapshots.push({
      afterBall: i + 1,
      wonPhases: (snap.currentGame?.patternResults ?? [])
        .filter((r) => r.isWon)
        .map((r) => r.patternName),
      status: snap.currentGame?.status ?? "?",
    });
    if (snap.currentGame?.status === "ENDED") break;
  }

  // Etter 5 baller (kol 0 komplett) skal fase 1 være vunnet, runden fortsetter.
  assert.deepEqual(phaseSnapshots[4].wonPhases, ["1 Rad"]);
  assert.equal(phaseSnapshots[4].status, "RUNNING");

  // Etter 10 baller (kol 0 + 1 komplett) skal fase 1 + 2 være vunnet.
  assert.deepEqual(phaseSnapshots[9].wonPhases, ["1 Rad", "2 Rader"]);
  assert.equal(phaseSnapshots[9].status, "RUNNING");

  // Etter 14 baller (kol 0 + 1 + 2 komplett — midten er free) skal fase 3 også være vunnet.
  assert.deepEqual(phaseSnapshots[13].wonPhases, ["1 Rad", "2 Rader", "3 Rader"]);
  assert.equal(phaseSnapshots[13].status, "RUNNING");

  // Etter 19 baller (kol 0 + 1 + 2 + 3) skal fase 4 også være vunnet.
  assert.deepEqual(phaseSnapshots[18].wonPhases, ["1 Rad", "2 Rader", "3 Rader", "4 Rader"]);
  assert.equal(phaseSnapshots[18].status, "RUNNING", "runden skal IKKE ha sluttet før Fullt Hus");

  // Etter 24 baller (alle 5 kolonner komplett = Fullt Hus) skal runden være avsluttet.
  const last = phaseSnapshots[phaseSnapshots.length - 1];
  assert.deepEqual(last.wonPhases, ["1 Rad", "2 Rader", "3 Rader", "4 Rader", "Fullt Hus"]);
  assert.equal(last.status, "ENDED", "Fullt Hus skal avslutte runden");
});

test("BIN-694: Fase 2 vinnes av 2 hele VERTIKALE kolonner", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Kolonne 0 (1,2,3,4,5) → fase 1 vunnet. Kolonne 1 (16,17,18,19,20) → fase 2 vunnet.
  prioritiseDrawBag(engine, roomCode, [
    1, 2, 3, 4, 5,        // kolonne 0
    16, 17, 18, 19, 20,   // kolonne 1
  ]);

  for (let i = 0; i < 10; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  const phase2 = game.patternResults?.find((r) => r.patternName === "2 Rader");
  assert.equal(phase1?.isWon, true, "fase 1 vunnet av kolonne 0");
  assert.equal(phase2?.isWon, true, "fase 2 vunnet av kolonne 0+1");
  assert.equal(game.status, "RUNNING", "fase 3 gjenstår");
});
