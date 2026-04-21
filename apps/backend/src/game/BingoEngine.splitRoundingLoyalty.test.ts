/**
 * GAME1_SCHEDULE PR 5: split-rounding house-retention + loyalty-hook-tests.
 *
 * Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3.7
 * Brief: GAME1_SCHEDULE PR 5 (split-rounding + loyalty hook).
 *
 * Tests:
 *   1. Split-matrise: 1, 2, 3, 7 vinnere — verifiser prize-per-winner + rest-
 *      øre til huset ved `floor(totalPrize / n)`.
 *   2. House-retained-audit: port kalles kun når rest > 0.
 *   3. Loyalty ticket.purchase: kalles én gang per spiller ved buy-in.
 *   4. Loyalty game.win: kalles én gang per vinner ved fase-win.
 *   5. Hook-exception sluker seg: spill-flyt rammes ikke av loyalty-feil.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "./variantConfig.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../adapters/BingoSystemAdapter.js";
import type {
  LoyaltyHookInput,
  LoyaltyPointsHookPort,
} from "../adapters/LoyaltyPointsHookPort.js";
import type {
  SplitRoundingAuditPort,
  SplitRoundingHouseRetainedEvent,
} from "../adapters/SplitRoundingAuditPort.js";
import type { Ticket } from "./types.js";

// Identisk grid så alle spillere vinner fase 1 på samme ball — trigger
// split-splittingen deterministisk.
const SHARED_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class SharedTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: SHARED_GRID.map((row) => [...row]) };
  }
}

class RecordingLoyaltyHook implements LoyaltyPointsHookPort {
  public readonly events: LoyaltyHookInput[] = [];
  async onLoyaltyEvent(input: LoyaltyHookInput): Promise<void> {
    this.events.push(input);
  }
}

class ThrowingLoyaltyHook implements LoyaltyPointsHookPort {
  async onLoyaltyEvent(_input: LoyaltyHookInput): Promise<void> {
    throw new Error("simulated loyalty outage");
  }
}

class RecordingSplitAudit implements SplitRoundingAuditPort {
  public readonly events: SplitRoundingHouseRetainedEvent[] = [];
  async onSplitRoundingHouseRetained(
    event: SplitRoundingHouseRetainedEvent,
  ): Promise<void> {
    this.events.push(event);
  }
}

/** Overstyr drawBag — setter de gitte tallene først for deterministiske trekk. */
function prioritiseDrawBag(
  engine: BingoEngine,
  roomCode: string,
  numbers: number[],
): void {
  const rooms = (engine as unknown as {
    rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
  }).rooms;
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

async function setupRoomWithNPlayers(
  n: number,
  loyaltyHook?: LoyaltyPointsHookPort,
  splitAudit?: SplitRoundingAuditPort,
): Promise<{ engine: BingoEngine; roomCode: string; playerIds: string[] }> {
  const engine = new BingoEngine(
    new SharedTicketAdapter(),
    new InMemoryWalletAdapter(),
    {
      minDrawIntervalMs: 0,
      minPlayersToStart: 1,
      ...(loyaltyHook ? { loyaltyHook } : {}),
      ...(splitAudit ? { splitRoundingAudit: splitAudit } : {}),
    },
  );
  const { roomCode, playerId: firstId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: `P0`,
    walletId: `w-0`,
  });
  const playerIds: string[] = [firstId!];
  for (let i = 1; i < n; i += 1) {
    const { playerId } = await engine.joinRoom({
      roomCode,
      hallId: "hall-1",
      playerName: `P${i}`,
      walletId: `w-${i}`,
    });
    playerIds.push(playerId!);
  }
  return { engine, roomCode, playerIds };
}

/**
 * Hjelp: kjør fase 1-vinn for N identiske spillere.
 *
 * DEFAULT_NORSK_BINGO_CONFIG bruker fast premie for "1 Rad" (100 kr fast via
 * `winningType: "fixed"` + `prize1`). totalPhasePrize er dermed uavhengig av
 * poolen og lik `prize1`, så lenge entryFee × N dekker utbetalingen (ellers
 * capes den av `remainingPrizePool` / `remainingPayoutBudget` i
 * payoutPhaseWinner — callers bør velge entryFee slik at pool > fixed-premie).
 *
 * Returnerer alle claims fra game snapshot + totalPhasePrize + rest.
 */
async function runPhase1ForNPlayers(
  n: number,
  entryFee: number,
  payoutPercent: number,
): Promise<{
  engine: BingoEngine;
  claims: Array<{ playerId: string; payoutAmount?: number }>;
  totalPhasePrize: number;
  prizePerWinner: number;
  houseRetainedRest: number;
  splitEvents: SplitRoundingHouseRetainedEvent[];
  loyaltyEvents: LoyaltyHookInput[];
}> {
  const loyalty = new RecordingLoyaltyHook();
  const split = new RecordingSplitAudit();
  const { engine, roomCode, playerIds } = await setupRoomWithNPlayers(n, loyalty, split);
  const hostId = playerIds[0];

  await engine.startGame({
    roomCode,
    actorPlayerId: hostId,
    entryFee,
    ticketsPerPlayer: 1,
    payoutPercent,
    gameType: "standard",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // Fase 1 — første rad av SHARED_GRID: 1, 16, 31, 46, 61
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const game = snapshot.currentGame!;
  // 2026-04-21: fast-premie-mønster — les `winningType` + `prize1` i stedet for
  // `prizePercent × pool`. Faller tilbake til legacy-math hvis variantConfig
  // skiftes til "percent"-mode i fremtidige tester.
  const phase1 = game.patterns?.find((p) => p.name === "1 Rad");
  const prizePool = entryFee * n;
  const totalPhasePrize = phase1?.winningType === "fixed"
    ? Math.max(0, phase1.prize1 ?? 0)
    : Math.floor(prizePool * (phase1?.prizePercent ?? 0) / 100);
  const prizePerWinner = Math.floor(totalPhasePrize / n);
  const houseRetainedRest = totalPhasePrize - n * prizePerWinner;

  const claims = game.claims
    .filter((c) => c.type === "LINE")
    .map((c) => ({ playerId: c.playerId, payoutAmount: c.payoutAmount }));

  return {
    engine,
    claims,
    totalPhasePrize,
    prizePerWinner,
    houseRetainedRest,
    splitEvents: split.events,
    loyaltyEvents: loyalty.events,
  };
}

// ── Split-matrise ────────────────────────────────────────────────────────────

// Kontekst: DEFAULT_NORSK_BINGO_CONFIG bruker fast premie for "1 Rad" = 100 kr
// (via `winningType: "fixed"` + `prize1`, Tobias-godkjent 2026-04-21). Alle
// split-tester regnes derfor som `totalPhasePrize = 100 kr` uavhengig av pool —
// `prizePerWinner = floor(100 / N)` + rest til huset. payoutPercent=100 gir
// full pool som utbetalingsbudsjett, og entryFee velges slik at pool ≥ 100 kr
// så ingen RTP-cap trigger i payoutPhaseWinner.

test("PR5: split-matrise — 1 vinner på 100 kr får hele fase 1 (ingen rest)", async () => {
  // 1 × 100 kr = 100 kr pool. Fase 1 = fast 100 kr. Per spiller = 100. Rest = 0.
  const { claims, totalPhasePrize, prizePerWinner, houseRetainedRest, splitEvents } =
    await runPhase1ForNPlayers(1, 200, 100);
  assert.equal(claims.length, 1);
  assert.equal(totalPhasePrize, 100);
  assert.equal(prizePerWinner, 100);
  assert.equal(claims[0]!.payoutAmount, 100, "vinner får hele fase-premien");
  assert.equal(houseRetainedRest, 0, "ingen rest ved 1 vinner");
  assert.equal(splitEvents.length, 0, "audit kun når rest > 0");
});

test("PR5: split-matrise — 2 vinnere på 100 kr → 50-50 split, 0 rest", async () => {
  // 2 × 100 = 200 kr pool. Fase 1 = fast 100 kr. Per spiller = 50. Rest = 0.
  const { claims, totalPhasePrize, prizePerWinner, houseRetainedRest, splitEvents } =
    await runPhase1ForNPlayers(2, 200, 100);
  assert.equal(claims.length, 2);
  assert.equal(totalPhasePrize, 100);
  assert.equal(prizePerWinner, 50);
  for (const c of claims) {
    assert.equal(c.payoutAmount, 50, "hver vinner får halvparten");
  }
  assert.equal(houseRetainedRest, 0, "100/2 går opp");
  assert.equal(splitEvents.length, 0, "ingen audit ved 0 rest");
});

test("PR5: split-matrise — 4 vinnere, total deler jevnt → ingen rest", async () => {
  // 4 × 100 = 400 kr pool. Fase 1 = fast 100 kr. Per spiller = 25. Rest = 0.
  // (Tidligere N=3 — endret til N=4 etter variantConfig-skifte til fast 100 kr
  // for å bevare "deler jevnt → 0 rest"-semantikken. Uneven N=3/N=7 dekkes
  // av den påfølgende testen.)
  const { claims, totalPhasePrize, prizePerWinner, houseRetainedRest, splitEvents } =
    await runPhase1ForNPlayers(4, 100, 100);
  assert.equal(claims.length, 4);
  assert.equal(totalPhasePrize, 100);
  assert.equal(prizePerWinner, 25);
  assert.equal(houseRetainedRest, 0);
  assert.equal(splitEvents.length, 0);
});

test("PR5: split-matrise — 7 vinnere med uneven split → rest til huset", async () => {
  // 7 × 103 = 721 kr pool. Fase 1 = fast 100 kr.
  // Per spiller: floor(100/7) = 14 kr. Rest = 100 - 7×14 = 2 kr til huset.
  const { claims, totalPhasePrize, prizePerWinner, houseRetainedRest, splitEvents } =
    await runPhase1ForNPlayers(7, 103, 100);
  assert.equal(claims.length, 7);
  assert.equal(totalPhasePrize, 100, "fast 100 kr fase-premie uavhengig av pool");
  assert.equal(prizePerWinner, 14, "floor(100/7) = 14");
  assert.equal(houseRetainedRest, 2, "100 - 7×14 = 2 kr rest til huset");
  for (const c of claims) {
    assert.equal(c.payoutAmount, 14, "hver vinner får lik floor-verdi");
  }
  assert.equal(splitEvents.length, 1, "audit logget én gang når rest > 0");
  const ev = splitEvents[0]!;
  assert.equal(ev.amount, 2);
  assert.equal(ev.winnerCount, 7);
  assert.equal(ev.totalPhasePrize, 100);
  assert.equal(ev.prizePerWinner, 14);
  assert.equal(ev.patternName, "1 Rad");
});

// ── Loyalty hooks ────────────────────────────────────────────────────────────

test("PR5: loyalty ticket.purchase — hook kalles én gang per spiller ved buy-in", async () => {
  const { loyaltyEvents } = await runPhase1ForNPlayers(3, 200, 100);
  const purchaseEvents = loyaltyEvents.filter((e) => e.kind === "ticket.purchase");
  assert.equal(purchaseEvents.length, 3, "3 ticket.purchase-events for 3 spillere");
  for (const ev of purchaseEvents) {
    assert.equal(ev.kind, "ticket.purchase");
    if (ev.kind === "ticket.purchase") {
      assert.equal(ev.amount, 200, "buy-in-beløp = 200 kr");
      assert.equal(ev.ticketCount, 1);
      assert.ok(ev.roomCode);
      assert.ok(ev.gameId);
      assert.equal(ev.hallId, "hall-1");
    }
  }
});

test("PR5: loyalty game.win — hook kalles én gang per vinner ved fase-win", async () => {
  const { loyaltyEvents, prizePerWinner } = await runPhase1ForNPlayers(3, 200, 100);
  const winEvents = loyaltyEvents.filter((e) => e.kind === "game.win");
  // Med 3 identiske spillere som vinner fase 1 samtidig, forventer vi 3
  // game.win-events. Fase 2 og videre faser vil også trigge hook-kall, men
  // test-drawet stopper etter fase 1 (bare 5 tall trukket).
  assert.ok(winEvents.length >= 3, `minst 3 game.win-events, fikk ${winEvents.length}`);
  const phase1Wins = winEvents.filter((e) => e.kind === "game.win" && e.patternName === "1 Rad");
  assert.equal(phase1Wins.length, 3);
  for (const ev of phase1Wins) {
    if (ev.kind === "game.win") {
      assert.equal(ev.amount, prizePerWinner, "game.win-amount = prizePerWinner");
      assert.equal(ev.patternName, "1 Rad");
    }
  }
});

test("PR5: loyalty hook-feil rammer ikke spill-flyt", async () => {
  const engine = new BingoEngine(
    new SharedTicketAdapter(),
    new InMemoryWalletAdapter(),
    {
      minDrawIntervalMs: 0,
      minPlayersToStart: 1,
      loyaltyHook: new ThrowingLoyaltyHook(),
    },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Solo",
    walletId: "w-solo",
  });

  // Buy-in skal lykkes selv om loyalty-hooken kaster.
  await assert.doesNotReject(
    engine.startGame({
      roomCode,
      actorPlayerId: hostId!,
      entryFee: 10,
      ticketsPerPlayer: 1,
      payoutPercent: 100,
      gameType: "standard",
      variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    }),
    "startGame må ikke kaste når loyalty-hook svikter",
  );

  // Fase 1-vinn skal også lykkes selv om loyalty-hook kaster.
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await assert.doesNotReject(
      engine.drawNextNumber({ roomCode, actorPlayerId: hostId! }),
      "drawNextNumber må ikke kaste når loyalty-hook svikter",
    );
  }

  const snapshot = engine.getRoomSnapshot(roomCode);
  const phase1 = snapshot.currentGame?.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true, "fase 1 skal være vunnet tross hook-exception");
});
