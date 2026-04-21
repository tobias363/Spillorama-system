/**
 * Audit-funn #8 hull 2: Auto-claim-on-draw kontrakt.
 *
 * DEFAULT_NORSK_BINGO_CONFIG setter `patternEvalMode: "auto-claim-on-draw"`
 * + `autoClaimPhaseMode: true`. Dette skal bety:
 *
 *   a) Evaluering trigges etter HVER ball (ikke kun ved eksplisitt claim).
 *   b) Evaluering bruker `game.drawnNumbers` som vinner-grunnlag,
 *      IKKE `game.marks` — spiller som ikke aktivt trykker "merk" skal
 *      fortsatt kunne vinne automatisk.
 *   c) Evaluering påvirkes ikke om spilleren har færre/ingen marks.
 *
 * Disse aspektene testes indirekte i BingoEngine.fivePhase.test.ts (som
 * aldri kaller markNumber), men hull-dekningen i audit #8 ba om
 * eksplisitte tester som dokumenterer kontrakten — og som fanger opp
 * regresjoner der noen legger inn en feilaktig `if (marks.has(n))`-
 * guard i evaluateActivePhase.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG, DEFAULT_STANDARD_CONFIG } from "./variantConfig.js";
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

async function setupSoloRoom(): Promise<{ engine: BingoEngine; roomCode: string; hostId: string }> {
  const engine = new BingoEngine(
    new FixedGridAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1", playerName: "Solo", walletId: "w-solo",
  });
  return { engine, roomCode, hostId: hostId! };
}

test("auto-claim: fase-evaluering kjører etter HVER ball, ikke bare ved claim", async () => {
  const { engine, roomCode, hostId } = await setupSoloRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 100, ticketsPerPlayer: 1,
    payoutPercent: 100, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Trekk første 4 baller av rad 0 → fase 1 skal IKKE være vunnet ennå.
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 4; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
    const snap = engine.getRoomSnapshot(roomCode);
    const phase1 = snap.currentGame?.patternResults?.find((r) => r.patternName === "1 Rad");
    assert.equal(phase1?.isWon, false, `etter ${i + 1} baller skal fase 1 IKKE være vunnet ennå`);
  }

  // 5. ball fullfører rad 0 → fase 1 skal være markert vunnet UMIDDELBART,
  // uten at spilleren har kalt submitClaim eller markNumber.
  await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  const snapAfter = engine.getRoomSnapshot(roomCode);
  const phase1After = snapAfter.currentGame?.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1After?.isWon, true, "fase 1 skal være auto-vunnet straks 5. ball trukket");
  assert.equal(phase1After?.winnerId, hostId);
});

test("auto-claim: vinner bestemmes av drawnNumbers, IKKE av spiller-marks", async () => {
  // Regresjonstest mot en tenkt bug: hvis noen innfører en sjekk som krever
  // at spilleren har merket brettet (game.marks) før evaluateActivePhase
  // godkjenner et vinnende mønster, vil dette bryte kontrakten —
  // AFK/reconnectede spillere skal fortsatt få premien automatisk.
  const { engine, roomCode, hostId } = await setupSoloRoom();
  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 100, ticketsPerPlayer: 1,
    payoutPercent: 100, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Verifiser at ingen marks er satt før vi starter.
  const rooms = (engine as unknown as { rooms: Map<string, { currentGame?: { marks: Map<string, Set<number>[]> } }> }).rooms;
  const marksBefore = rooms.get(roomCode)?.currentGame?.marks.get(hostId);
  assert.ok(marksBefore, "marks skal være initialisert per spiller");
  assert.equal(marksBefore!.length, 1, "én billett → én marks-set");
  assert.equal(marksBefore![0].size, 0, "ingen marks satt innledningsvis");

  // Trekk full rad 0 — spilleren kaller ALDRI markNumber.
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  // Verifiser at spiller-marks fortsatt er TOM (ingen markNumber-kall),
  // men fase 1 ER vunnet.
  const marksAfter = rooms.get(roomCode)?.currentGame?.marks.get(hostId);
  assert.equal(marksAfter![0].size, 0, "spiller merket aldri brettet — marks skal være tom");

  const snap = engine.getRoomSnapshot(roomCode);
  const phase1 = snap.currentGame?.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true, "fase 1 vunnet via drawnNumbers uavhengig av marks");
  assert.equal(phase1?.winnerId, hostId);
  assert.ok(
    (phase1?.payoutAmount ?? 0) > 0,
    "utbetaling skal ha skjedd automatisk uten submitClaim",
  );
});

test("auto-claim: `autoClaimPhaseMode=false` skrur AV auto-evaluering per draw", async () => {
  // Motsatt kontraktsverifikasjon: når variant-configen IKKE har
  // autoClaimPhaseMode, skal evaluateActivePhase ikke trigges av
  // drawNextNumber — fase 1 forblir isWon=false selv når en hel rad er
  // trukket. (Spillere må da kalle submitClaim selv.)
  const { engine, roomCode, hostId } = await setupSoloRoom();

  // DEFAULT_STANDARD_CONFIG har verken patternEvalMode eller
  // autoClaimPhaseMode — legacy manual-claim.
  assert.equal(DEFAULT_STANDARD_CONFIG.autoClaimPhaseMode, undefined);

  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 10, ticketsPerPlayer: 1,
    payoutPercent: 80, gameType: "standard", variantConfig: DEFAULT_STANDARD_CONFIG,
  });

  // Trekk hele første rad
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snap = engine.getRoomSnapshot(roomCode);
  const game = snap.currentGame!;
  // Uten autoClaimPhaseMode skal ingen pattern være auto-markert.
  const anyAutoWon = (game.patternResults ?? []).some((r) => r.isWon);
  assert.equal(anyAutoWon, false, "uten autoClaimPhaseMode skal ingen fase vinnes automatisk");
  assert.equal(game.status, "RUNNING", "runden fortsetter — ingen auto-end");
});
