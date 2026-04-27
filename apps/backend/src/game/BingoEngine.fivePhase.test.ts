/**
 * BIN-694: Norsk 75-ball bingo — 5-fase fase-overgang + multi-winner split.
 *
 * Avklart av Tobias 2026-04-20:
 *   - Fase 1 ("1 Rad"): ≥1 horisontal rad ELLER ≥1 vertikal kolonne
 *   - Fase 2 ("2 Rader"): ≥2 hele horisontale rader (KUN vannrett)
 *   - Fase 3 ("3 Rader"): ≥3 hele horisontale rader
 *   - Fase 4 ("4 Rader"): ≥4 hele horisontale rader
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

/**
 * Tobias-direktiv 2026-04-27: Spill 1 ad-hoc-engine auto-pauser etter fase-vinning
 * slik at master eksplisitt må starte spillet igjen ("etter hver rad som blir
 * vunnet skal master starte spillet igjen"). Test-helperen simulerer master-
 * resume etter hver pause så multi-fase-tester kan iterere drawNextNumber over
 * fase-grenser uten å måtte spre `engine.resumeGame()`-kall i hver test.
 *
 * Helperen er semantisk identisk med produksjonsflyten: scheduler / draw-event
 * trigger drawNextNumber, ser auto-pause i room-state, og master klikker
 * "Resume" som setter game.isPaused=false før neste draw.
 */
async function drawWithMasterResume(
  engine: BingoEngine,
  roomCode: string,
  actorPlayerId: string,
): Promise<void> {
  const snap = engine.getRoomSnapshot(roomCode);
  if (snap.currentGame?.isPaused) {
    engine.resumeGame(roomCode);
  }
  await engine.drawNextNumber({ roomCode, actorPlayerId });
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

  // Tobias-direktiv 2026-04-27: master-resume mellom fase-pauseringer.
  for (let i = 0; i < 24; i += 1) {
    await drawWithMasterResume(engine, roomCode, hostId);
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

  // Tobias-direktiv 2026-04-27: etter fase 1 vunnet auto-pauses Spill 1.
  // Master må eksplisitt resume før neste draw — runden er IKKE avsluttet.
  const snapAfterPhase1 = engine.getRoomSnapshot(roomCode);
  assert.equal(snapAfterPhase1.currentGame?.isPaused, true, "runden skal være auto-pauset etter fase 1");
  assert.equal(snapAfterPhase1.currentGame?.status, "RUNNING", "status skal fortsatt være RUNNING (ikke ENDED)");
  engine.resumeGame(roomCode);
  await assert.doesNotReject(
    engine.drawNextNumber({ roomCode, actorPlayerId: hostId }),
    "neste draw skal fungere etter master-resume",
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

test("BIN-694: Fase 2 krever 2 HORISONTALE rader — 2 vertikale kolonner er IKKE nok", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Først: trekk hele kol 0 (fase 1 vunnet via vertikal)
  // Deretter: trekk hele kol 1 (bruker har 2 vertikale kolonner nå — MEN fase 2 krever rader)
  prioritiseDrawBag(engine, roomCode, [
    1, 2, 3, 4, 5,         // kol 0
    16, 17, 18, 19, 20,    // kol 1
  ]);

  // Tobias-direktiv 2026-04-27: master-resume mellom fase-pauseringer.
  for (let i = 0; i < 10; i += 1) {
    await drawWithMasterResume(engine, roomCode, hostId);
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  const phase2 = game.patternResults?.find((r) => r.patternName === "2 Rader");
  assert.equal(phase1?.isWon, true, "fase 1 skal være vunnet av kol 0");
  assert.equal(phase2?.isWon, false, "fase 2 skal IKKE være vunnet — vertikale kolonner teller ikke");
});

test("BIN-694: E2E full sekvens — 1 Rad → 2 → 3 → 4 Rader → Fullt Hus, kun Fullt Hus avslutter", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Merk rad 0, 1, 2, 3, 4 i rekkefølge → fase 1 etter rad 0, fase 2
  // etter rad 1, fase 3 etter rad 2, fase 4 etter rad 3, Fullt Hus etter rad 4.
  // (Fase 1 aksepterer også vertikal kolonne, men rad 0 oppfyller også det).
  // Ticket GRID_A: grid[r][c] = ((r * 5 + c)) mapped to real tall. Rad r har tall
  // { (r+1), 16+r, 31+r, 46+r, 61+r } (kol c kommer fra (c*15)+r+1-serien).
  prioritiseDrawBag(engine, roomCode, [
    1, 16, 31, 46, 61,     // rad 0  → fase 1 vunnet (1 rad ≥ 1)
    2, 17, 32, 47, 62,     // rad 1  → fase 2 vunnet (2 rader)
    3, 18, 48, 63,         // rad 2 (midtcellen er free, så 4 tall holder) → fase 3
    4, 19, 33, 49, 64,     // rad 3  → fase 4
    5, 20, 34, 50, 65,     // rad 4  → Fullt Hus
  ]);

  // Tobias-direktiv 2026-04-27: drawWithMasterResume simulerer master-klikk
  // "Resume" etter hver auto-pause (Spill 1 stopper for hver vunnet fase).
  const phaseSnapshots: Array<{ afterBall: number; wonPhases: string[]; status: string }> = [];
  for (let i = 0; i < 24; i += 1) {
    await drawWithMasterResume(engine, roomCode, hostId);
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

  // Etter 5 baller (rad 0 komplett) skal fase 1 være vunnet, runden fortsetter.
  assert.deepEqual(phaseSnapshots[4].wonPhases, ["1 Rad"]);
  assert.equal(phaseSnapshots[4].status, "RUNNING");

  // Etter 10 baller (rad 0 + 1 komplett) skal fase 1 + 2 være vunnet.
  assert.deepEqual(phaseSnapshots[9].wonPhases, ["1 Rad", "2 Rader"]);
  assert.equal(phaseSnapshots[9].status, "RUNNING");

  // Etter 14 baller (rad 0 + 1 + 2 komplett — midten er free) skal fase 3 også være vunnet.
  assert.deepEqual(phaseSnapshots[13].wonPhases, ["1 Rad", "2 Rader", "3 Rader"]);
  assert.equal(phaseSnapshots[13].status, "RUNNING");

  // Etter 19 baller (rad 0 + 1 + 2 + 3) skal fase 4 også være vunnet.
  assert.deepEqual(phaseSnapshots[18].wonPhases, ["1 Rad", "2 Rader", "3 Rader", "4 Rader"]);
  assert.equal(phaseSnapshots[18].status, "RUNNING", "runden skal IKKE ha sluttet før Fullt Hus");

  // Etter 24 baller (alle 5 rader komplett = Fullt Hus) skal runden være avsluttet.
  const last = phaseSnapshots[phaseSnapshots.length - 1];
  assert.deepEqual(last.wonPhases, ["1 Rad", "2 Rader", "3 Rader", "4 Rader", "Fullt Hus"]);
  assert.equal(last.status, "ENDED", "Fullt Hus skal avslutte runden");
});

test("BIN-694: Fase 2 vinnes av 2 hele HORISONTALE rader", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Rad 0 (1,16,31,46,61) → fase 1 vunnet. Rad 1 (2,17,32,47,62) → fase 2 vunnet.
  prioritiseDrawBag(engine, roomCode, [
    1, 16, 31, 46, 61,    // rad 0
    2, 17, 32, 47, 62,    // rad 1
  ]);

  // Tobias-direktiv 2026-04-27: master-resume mellom fase-pauseringer.
  for (let i = 0; i < 10; i += 1) {
    await drawWithMasterResume(engine, roomCode, hostId);
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  const phase2 = game.patternResults?.find((r) => r.patternName === "2 Rader");
  assert.equal(phase1?.isWon, true, "fase 1 vunnet av rad 0");
  assert.equal(phase2?.isWon, true, "fase 2 vunnet av rad 0+1");
  assert.equal(game.status, "RUNNING", "fase 3 gjenstår");
});

/**
 * 2026-04-21 (Tobias): faste premier 100/200/200/200/1000 kr via
 * `winningType: "fixed"` + `prize1`. Verifiser at evaluatoren leser
 * disse feltene i stedet for prizePercent.
 *
 * 2026-04-26 (FIXED-PRIZE-FIX): Faste premier MÅ utbetales fullt
 * uavhengig av pool — huset garanterer dem (legacy spillorama-paritet).
 * Tidligere ble Fullt Hus capet mot resterende pool; nå betales hele
 * 1000 kr og §11 single-prize-cap (2500 kr) er den eneste regulatoriske
 * grensen.
 */
test("fast premie — alle 5 faser betales fullt selv når pool er mindre (hus garanterer)", async () => {
  const { engine, roomCode, hostId } = await setupRoom();
  // entryFee=500, 2 spillere → pool=1000, payoutBudget=950. Annonserte
  // faste premier summerer til 1700 kr — pool dekker IKKE alle. Hus
  // garanterer differansen via system-konto (kan gå negativt).
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 500, ticketsPerPlayer: 1,
    payoutPercent: 95, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Alle 24 tall i PLAYER_A_GRID (uten free-midten) → alle 5 faser vunnet.
  const allAlice: number[] = [];
  for (const row of PLAYER_A_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
  prioritiseDrawBag(engine, roomCode, allAlice);
  // Tobias-direktiv 2026-04-27: master-resume mellom fase-pauseringer.
  for (let i = 0; i < 24; i += 1) {
    await drawWithMasterResume(engine, roomCode, hostId);
  }

  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  assert.equal(game.status, "ENDED", "Fullt Hus skal avslutte runden");

  const phaseByName = new Map<string, number | undefined>();
  for (const r of game.patternResults ?? []) {
    phaseByName.set(r.patternName, r.payoutAmount);
  }

  // FIXED-PRIZE-FIX: alle faser betales fullt — pool/budget irrelevant.
  assert.equal(phaseByName.get("1 Rad"), 100,   "1 Rad = 100 kr fast");
  assert.equal(phaseByName.get("2 Rader"), 200, "2 Rader = 200 kr fast");
  assert.equal(phaseByName.get("3 Rader"), 200, "3 Rader = 200 kr fast");
  assert.equal(phaseByName.get("4 Rader"), 200, "4 Rader = 200 kr fast");
  // Fullt Hus 1000 kr — HUS GARANTERER, ikke capet mot pool.
  assert.equal(phaseByName.get("Fullt Hus"), 1000, "Fullt Hus = 1000 kr fast (hus garanterer)");
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

/**
 * FIXED-PRIZE-FIX (2026-04-26): regresjon for Tobias' XGFLXH-bug.
 *
 * Solo-spiller med 4 brett, lav buy-in (ca 45 kr/brett = 180 kr) og
 * 80% payoutPercent → pool=144 kr. Fast-premie-konfig (1 Rad: 100,
 * 2-4: 200, FH: 1000) summerer til 1700 kr. Pre-fix: spilleren fikk
 * kun 100 + 44 + 0 + 0 + 0 = 144 kr (pool tom). Post-fix: alle
 * annonserte beløp utbetales, hus-konto går negativt og HOUSE_DEFICIT
 * audit-event logges.
 */
test("FIXED-PRIZE-FIX: solo-spiller med liten pool får alle 5 faste premier (1700 kr totalt)", async () => {
  const engine = new BingoEngine(
    new PerPlayerTicketAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1", playerName: "Alice", walletId: "w-alice",
  });
  // Solo: bare én spiller med 4 brett. entryFee=45, 4 tickets → pool=180.
  // payoutPercent=80 → budget=144. Faste premier 1700 kr >> 144 kr.
  // Pre-fix: payouts ble cappet ved 144 kr. Post-fix: alle annonserte
  // beløp utbetales fullt; hus-konto kan gå negativt.
  await engine.startGame({
    roomCode, actorPlayerId: hostId!, entryFee: 45, ticketsPerPlayer: 4,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  const allAlice: number[] = [];
  for (const row of PLAYER_A_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
  prioritiseDrawBag(engine, roomCode, allAlice);
  // Tobias-direktiv 2026-04-27: master-resume mellom fase-pauseringer.
  for (let i = 0; i < 24; i += 1) {
    await drawWithMasterResume(engine, roomCode, hostId!);
  }

  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  assert.equal(game.status, "ENDED");

  const phaseByName = new Map<string, number | undefined>();
  for (const r of game.patternResults ?? []) {
    phaseByName.set(r.patternName, r.payoutAmount);
  }
  assert.equal(phaseByName.get("1 Rad"), 100,   "1 Rad fullt utbetalt");
  assert.equal(phaseByName.get("2 Rader"), 200, "2 Rader fullt utbetalt");
  assert.equal(phaseByName.get("3 Rader"), 200, "3 Rader fullt utbetalt (pre-fix: 0 pga pool tom)");
  assert.equal(phaseByName.get("4 Rader"), 200, "4 Rader fullt utbetalt (pre-fix: 0)");
  assert.equal(phaseByName.get("Fullt Hus"), 1000, "Fullt Hus fullt utbetalt — HUS GARANTERER");

  // Sum total skal være 1700 kr — annonsert til spilleren.
  const totalPaid = (phaseByName.get("1 Rad") ?? 0)
    + (phaseByName.get("2 Rader") ?? 0)
    + (phaseByName.get("3 Rader") ?? 0)
    + (phaseByName.get("4 Rader") ?? 0)
    + (phaseByName.get("Fullt Hus") ?? 0);
  assert.equal(totalPaid, 1700, "Totalt utbetalt til spilleren = 1700 kr (annonsert)");

  // Ingen claim skal være rtpCapped — pool/RTP-cap gjelder ikke faste premier.
  const claims = game.claims.filter((c) => c.valid);
  for (const c of claims) {
    assert.equal(c.rtpCapped, false, `claim ${c.id} skal IKKE være rtpCapped`);
  }
});

/**
 * FIXED-PRIZE-FIX: rtpCapped-flagget settes aldri for faste premier.
 * Speiler kontrakten i `claim.rtpCapped` for ad-hoc-engine.
 */
test("FIXED-PRIZE-FIX: claim.rtpCapped er false for fixed-prize claims", async () => {
  const engine = new BingoEngine(
    new PerPlayerTicketAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1", playerName: "Alice", walletId: "w-alice",
  });
  await engine.startGame({
    roomCode, actorPlayerId: hostId!, entryFee: 45, ticketsPerPlayer: 4,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });
  const allAlice: number[] = [];
  for (const row of PLAYER_A_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
  prioritiseDrawBag(engine, roomCode, allAlice);
  // Tobias-direktiv 2026-04-27: master-resume mellom fase-pauseringer.
  for (let i = 0; i < 24; i += 1) {
    await drawWithMasterResume(engine, roomCode, hostId!);
  }
  const game = engine.getRoomSnapshot(roomCode).currentGame!;
  // Alle 5 claims skal være valid + rtpCapped=false (faste premier
  // bypasser RTP-cap; kun §11 single-prize-cap kan slå inn — og 1000 kr
  // er under 2500 kr-cap).
  const claims = game.claims.filter((c) => c.valid);
  assert.equal(claims.length, 5, "5 fase-vinner-claims (1-4 Rad + Fullt Hus)");
  for (const c of claims) {
    assert.equal(c.rtpCapped, false, `claim ${c.id} (${c.type}) skal IKKE være rtpCapped`);
    assert.equal(c.payoutWasCapped, false, `claim ${c.id} skal heller ikke være §11-capet`);
  }
});
