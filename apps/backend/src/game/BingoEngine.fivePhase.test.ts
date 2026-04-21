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

  // entryFee=200 → prizePool=400, payoutBudget=320 — nok til at begge
  // vinnerne får full split av fast 100 kr 1 Rad-premie (50 kr hver).
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 200, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Fast premie for 1 Rad = 100 kr (DEFAULT_NORSK_BINGO_CONFIG).
  // 2 vinnere → Math.floor(100 / 2) = 50 kr per spiller. Rest til huset.
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
  // Premien er splittet likt (50 kr hver av fast 100 kr).
  assert.equal(aliceClaim!.payoutAmount, 50, "Alice skal få 50 kr (halv split)");
  assert.equal(zoeClaim!.payoutAmount, 50, "Zoe skal få 50 kr (halv split)");
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

/**
 * 2026-04-21 (Tobias): faste premier 100/200/200/200/1000 kr via
 * `winningType: "fixed"` + `prize1`. Verifiser at evaluatoren leser
 * disse feltene i stedet for prizePercent.
 */
test("fast premie — 1 Rad betaler 100 kr, Fullt Hus 1000 kr (enkel vinner, stor pool)", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  // entryFee=500 → prizePool=1000, payoutBudget=950 (95%) — nok til at alle
  // fase-premier (100+200+200+200+1000 = 1700 kr) KAN capes. Første 4 faser
  // (=700 kr) betales fullt, Fullt Hus (=1000 kr) cap'es mot resterende
  // pool/budget og ender ≈ 250 kr. Testen fokuserer på rad 1-4 som IKKE
  // cap'es. Fullt Hus sjekkes bare at den betaler > 0 og avslutter runden.
  // (entryFee=1000 avvises av compliance-limits — holder oss under det.)
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 500, ticketsPerPlayer: 1,
    payoutPercent: 95, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Alle 24 tall i PLAYER_A_GRID (uten free-midten) → alle 5 faser vunnet.
  const allAlice: number[] = [];
  for (const row of PLAYER_A_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
  prioritiseDrawBag(engine, roomCode, allAlice);
  for (let i = 0; i < 24; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  assert.equal(game.status, "ENDED", "Fullt Hus skal avslutte runden");

  const phaseByName = new Map<string, number | undefined>();
  for (const r of game.patternResults ?? []) {
    phaseByName.set(r.patternName, r.payoutAmount);
  }

  // 1-4 Rad betales fullt (100+200+200+200 = 700 kr totalt, budget=950 holder).
  assert.equal(phaseByName.get("1 Rad"), 100,   "1 Rad = 100 kr fast");
  assert.equal(phaseByName.get("2 Rader"), 200, "2 Rader = 200 kr fast");
  assert.equal(phaseByName.get("3 Rader"), 200, "3 Rader = 200 kr fast");
  assert.equal(phaseByName.get("4 Rader"), 200, "4 Rader = 200 kr fast");
  // Fullt Hus: 1000 kr fast — under 2-player-pool (1000 kr) / budget (950)
  // blir det capet til resterende pool etter 1-4 Rad (300 kr) / resterende
  // budget (250). Assertér bare at noe ble utbetalt; total=1000 kr-verifisering
  // krever større pool (se 3-way-split-test).
  const fhPayout = phaseByName.get("Fullt Hus") ?? 0;
  assert.ok(fhPayout > 0, "Fullt Hus skal ha utbetalt noe (>0)");
  assert.ok(fhPayout <= 1000, "Fullt Hus skal aldri utbetale mer enn fast 1000 kr");
});

/**
 * Vinner-splitt med fast premie: floor(100/3) = 33 per spiller, rest til
 * huset. Dokumenterer både split-matematikken og house-rounding-intensjonen.
 */
test("fast premie — 3 vinnere på 1 Rad splitter 100 kr til 33 hver (huset beholder rest)", async () => {
  const engine = new BingoEngine(
    new PerPlayerTicketAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0 },
  );
  // Spawn 3 spillere med identisk grid → alle vinner på samme ball.
  (engine as unknown as { bingoAdapter: { createTicket: (input: CreateTicketInput) => Promise<Ticket> } }).bingoAdapter = {
    createTicket: async () => ({ grid: PLAYER_A_GRID.map((r) => [...r]) }),
  };
  const { roomCode, playerId: p1 } = await engine.createRoom({
    hallId: "hall-1", playerName: "Alice", walletId: "w-alice",
  });
  const { playerId: p2 } = await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "Bob", walletId: "w-bob",
  });
  const { playerId: p3 } = await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "Carol", walletId: "w-carol",
  });

  await engine.startGame({
    roomCode, actorPlayerId: p1!, entryFee: 500, ticketsPerPlayer: 1,
    payoutPercent: 95, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: p1! });
  }

  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true);

  // floor(100 / 3) = 33 — 1 kr til huset (rounding).
  const claims = game.claims.filter((c) => c.type === "LINE" && c.valid);
  assert.equal(claims.length, 3, "3 spillere har vinner-claim");
  for (const c of claims) {
    assert.equal(c.payoutAmount, 33, `${c.playerId} skal få 33 kr (floor-split av 100 / 3)`);
  }
  // winnerIds på patternResult skal inneholde alle 3.
  assert.equal(phase1?.winnerIds?.length, 3, "winnerIds har alle 3 vinnere");
  assert.ok(phase1?.winnerIds?.includes(p1!));
  assert.ok(phase1?.winnerIds?.includes(p2!));
  assert.ok(phase1?.winnerIds?.includes(p3!));
});
