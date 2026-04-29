/**
 * PHASE-PROGRESSION-ZERO-BUDGET — regression test for Tobias' prod incident
 * 2026-04-29 ~17:30 (game `87635663-0d98-468b-807b-fc444870f052`).
 *
 * **Bug observed in prod (BEFORE PR #726 was deployed):**
 *
 *   Spill 1 ad-hoc Demo Hall round with 5-phase config:
 *     1 Rad face=100  2 Rader face=200  3 Rader face=200  4 Rader face=200
 *     Fullt Hus face=1000
 *
 *   Pool=120 kr, payoutPercent=80% → RTP-budget=96 kr.
 *
 *   Round drew all 75 balls but only Phase 1 (1 Rad) was marked won
 *   (payoutAmount=96, capped from face=100). Phases 2-5 stayed
 *   `isWon=false`. ended_reason=`MAX_DRAWS_REACHED`. No mini-game
 *   triggered.
 *
 * **How PR #726 (commit 89aab7d2) fixed it:**
 *
 *   1. `payoutPhaseWinner` now caps payout at
 *      `min(face, remainingPayoutBudget, houseAvailableBalance)`.
 *   2. When payout=0 (budget exhausted), the function still:
 *        - Creates a claim with `payoutAmount=0, payoutSkipped=true`
 *        - Sets `patternResult.payoutAmount=0, payoutSkipped=true,
 *          payoutSkippedReason='budget-exhausted'`
 *        - Returns successfully without throwing
 *   3. `evaluateActivePhase` then unconditionally sets
 *      `activeResult.isWon = true` (line 534) regardless of payout
 *      amount — so subsequent phases keep evaluating on the next draw.
 *
 * **Why these regression tests matter:**
 *
 *   These tests lock in PR #726 + PR #727 (mini-game hook) + PR #729
 *   (overlay text) behavior so future refactors can't reintroduce the
 *   bug. They cover BOTH the test-hall bypass path (Demo Hall — round
 *   continues through MAX_DRAWS) AND the production retail path
 *   (Spill 1 with auto-pause + master-resume → BINGO_CLAIMED ends round).
 *
 * **What a regression in any of these tests would catch:**
 *
 *   Any change to `evaluateActivePhase` (or its callees) that:
 *     - Stops phase progression early when budget=0
 *     - Throws on payout=0 instead of marking phase won
 *     - Skips mini-game trigger for Fullt Hus when payout=0
 *     - Drops `endedReason=BINGO_CLAIMED` for the non-test-hall Fullt Hus
 *       path when payout was capped
 */

// PR #736-konflikt-fix: deaktiver test-hall RTP-cap-bypass for denne
// test-fila slik at vi kan teste at RTP-cap _faktisk_ håndheves selv
// når isTestHall=true. (isTestHall=true er nødvendig for at testen skal
// kunne teste multi-phase-progresjon i ett enkelt draw — bypass for
// auto-pause-på-phase-won er separat fra RTP-cap-bypass.)
//
// Må settes FØR BingoEngine importeres siden engine-modulen leser
// env-vars ved første evaluering.
process.env.BINGO_TEST_HALL_BYPASS_RTP_CAP = "false";

import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "../BingoEngine.js";
import { InMemoryWalletAdapter } from "../BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "../variantConfig.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../types.js";
import { DomainError } from "../../errors/DomainError.js";

/**
 * Solo player with a single deterministic 5×5 grid. All non-zero numbers
 * are drawn → ticket reaches full house at draw 24 (25 cells minus 1 free).
 */
const SOLO_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class FixedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: SOLO_GRID.map((r) => [...r]) };
  }
}

/** Push the listed numbers to the front of drawBag for deterministic draws. */
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

async function setupTestHallSpill1Room(opts: {
  entryFee: number;
  payoutPercent: number;
}): Promise<{
  engine: BingoEngine;
  roomCode: string;
  hostId: string;
}> {
  const engine = new BingoEngine(
    new FixedGridAdapter(),
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1, maxDrawsPerRound: 75 },
  );
  const { roomCode, playerId: hostId } = await engine.createRoom({
    hallId: "hall-demo",
    playerName: "Tobias",
    walletId: "w-tobias",
    gameSlug: "bingo",
    isTestHall: true, // Demo Hall — bypasses auto-pause
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: hostId!,
    entryFee: opts.entryFee,
    ticketsPerPlayer: 1,
    payoutPercent: opts.payoutPercent,
    gameType: "standard",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });
  return { engine, roomCode, hostId: hostId! };
}

test(
  "PROD-INCIDENT 2026-04-29 game 87635663: budget=96 cap on Phase 1 must NOT stop Phase 2-5 progression",
  async () => {
    // entryFee=120, 1 ticket → pool=120 kr, payoutBudget=120*0.8=96 kr.
    // DEFAULT_NORSK_BINGO_CONFIG: 1 Rad=100 (cap→96), 2 Rader=200,
    // 3 Rader=200, 4 Rader=200, Fullt Hus=1000.
    const { engine, roomCode, hostId } = await setupTestHallSpill1Room({
      entryFee: 120,
      payoutPercent: 80,
    });

    // Trekk alle 24 numre fra grid → fullt hus oppfylles på draw 24.
    const allCells: number[] = [];
    for (const row of SOLO_GRID) for (const n of row) if (n !== 0) allCells.push(n);
    prioritiseDrawBag(engine, roomCode, allCells);

    // Trekk én ball om gangen — engine evaluerer + mark phases automatisk.
    // Test-hall bypass skipper pause, så vi trenger ingen master-resume.
    let drawCount = 0;
    for (let i = 0; i < 75; i += 1) {
      try {
        await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
        drawCount += 1;
      } catch (err) {
        if (
          err instanceof DomainError &&
          (err.code === "NO_MORE_NUMBERS" ||
            err.code === "GAME_NOT_RUNNING" ||
            err.code === "GAME_PAUSED")
        ) {
          // Naturlig slutt — runden avsluttet via Fullt Hus eller MAX_DRAWS.
          break;
        }
        throw err;
      }
    }

    const game = engine.getRoomSnapshot(roomCode).currentGame!;

    // Lookup phases by name.
    const phaseByName = new Map<string, { isWon: boolean; payoutAmount?: number; payoutSkipped?: boolean; payoutSkippedReason?: string }>();
    for (const r of game.patternResults ?? []) {
      phaseByName.set(r.patternName, {
        isWon: r.isWon,
        payoutAmount: r.payoutAmount,
        payoutSkipped: r.payoutSkipped,
        payoutSkippedReason: r.payoutSkippedReason,
      });
    }

    // ── Assertion 1: All 5 phases must be marked won ─────────────────────
    // This is the CORE prod bug — phases 2-5 stayed isWon=false.
    assert.equal(phaseByName.get("1 Rad")?.isWon, true, "1 Rad må være vunnet");
    assert.equal(
      phaseByName.get("2 Rader")?.isWon,
      true,
      "2 Rader MÅ være vunnet (selv med budget=0) — prod-bug var isWon=false",
    );
    assert.equal(
      phaseByName.get("3 Rader")?.isWon,
      true,
      "3 Rader MÅ være vunnet (selv med budget=0) — prod-bug var isWon=false",
    );
    assert.equal(
      phaseByName.get("4 Rader")?.isWon,
      true,
      "4 Rader MÅ være vunnet (selv med budget=0) — prod-bug var isWon=false",
    );
    assert.equal(
      phaseByName.get("Fullt Hus")?.isWon,
      true,
      "Fullt Hus MÅ være vunnet (selv med budget=0) — prod-bug var isWon=false",
    );

    // ── Assertion 2: Phase 1 paid 96 kr (capped from face=100) ──────────
    assert.equal(
      phaseByName.get("1 Rad")?.payoutAmount,
      96,
      "1 Rad payout=96 (capped fra face=100 til budget=96)",
    );

    // ── Assertion 3: Phase 2-5 paid 0 with payoutSkipped flag ──────────
    for (const phaseName of ["2 Rader", "3 Rader", "4 Rader", "Fullt Hus"]) {
      const p = phaseByName.get(phaseName);
      assert.equal(p?.payoutAmount, 0, `${phaseName} payoutAmount=0 (budget tom)`);
      assert.equal(
        p?.payoutSkipped,
        true,
        `${phaseName} payoutSkipped=true (budget exhausted)`,
      );
      assert.equal(
        p?.payoutSkippedReason,
        "budget-exhausted",
        `${phaseName} payoutSkippedReason='budget-exhausted'`,
      );
    }

    // ── Assertion 4: Game endedReason — depends on Fullt Hus claim path ──
    // For test hall, Fullt Hus auto-claim does NOT end the game (bypass
    // continues drawing). Game ends via MAX_DRAWS_REACHED / DRAW_BAG_EMPTY
    // when bag is exhausted (75 balls drawn). bingoWinnerId must be set
    // so client can show winner popup.
    assert.equal(game.status, "ENDED", "Spillet skal være avsluttet");
    assert.ok(
      game.endedReason === "MAX_DRAWS_REACHED" || game.endedReason === "DRAW_BAG_EMPTY",
      `Test-hall: endedReason=${game.endedReason} skal være MAX_DRAWS_REACHED eller DRAW_BAG_EMPTY (test-hall fortsetter etter Fullt Hus)`,
    );
    assert.equal(
      game.bingoWinnerId,
      hostId,
      "bingoWinnerId må være satt så klient kan rendre vinner-popup",
    );

    // ── Assertion 5: Total payout = budget (96 kr) ──────────────────────
    const totalPaid = (phaseByName.get("1 Rad")?.payoutAmount ?? 0)
      + (phaseByName.get("2 Rader")?.payoutAmount ?? 0)
      + (phaseByName.get("3 Rader")?.payoutAmount ?? 0)
      + (phaseByName.get("4 Rader")?.payoutAmount ?? 0)
      + (phaseByName.get("Fullt Hus")?.payoutAmount ?? 0);
    assert.equal(totalPaid, 96, `Total payout=${totalPaid} skal matche RTP-budget 96 kr`);
  },
);

test(
  "PROD-INCIDENT 2026-04-29 (NON-test-hall): Fullt Hus auto-claim MUST end round + trigger mini-game even with payout=0",
  async () => {
    // Same scenario but WITHOUT test hall — production retail bingo path.
    // Tobias direktiv 2026-04-27: Spill 1 pauses after each phase, master
    // must resume. We simulate that here by calling resumeGame between
    // phase wins. The KEY assertion is that Fullt Hus auto-claim with
    // payout=0 still:
    //   - sets game.endedReason = "BINGO_CLAIMED" (not MAX_DRAWS_REACHED)
    //   - sets game.status = "ENDED"
    //   - calls onAutoClaimedFullHouse hook (mini-game trigger)
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      { minDrawIntervalMs: 0, minPlayersToStart: 1, maxDrawsPerRound: 75 },
    );
    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-prod",
      playerName: "Tobias",
      walletId: "w-tobias",
      gameSlug: "bingo",
      // isTestHall NOT set → production behaviour with auto-pause.
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: hostId!,
      entryFee: 120,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      gameType: "standard",
      variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    });

    const allCells: number[] = [];
    for (const row of SOLO_GRID) for (const n of row) if (n !== 0) allCells.push(n);
    prioritiseDrawBag(engine, roomCode, allCells);

    // Spill 1 production behaviour: pause after each phase win. Master
    // resumes via engine.resumeGame() before next draw.
    for (let i = 0; i < 24; i += 1) {
      const snap = engine.getRoomSnapshot(roomCode);
      if (snap.currentGame?.isPaused) {
        engine.resumeGame(roomCode);
      }
      if (snap.currentGame?.status === "ENDED") break;
      try {
        await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
      } catch (err) {
        if (err instanceof DomainError && err.code === "GAME_NOT_RUNNING") break;
        throw err;
      }
    }

    const game = engine.getRoomSnapshot(roomCode).currentGame!;

    // Fullt Hus claim path MUST:
    //   1) End the round with BINGO_CLAIMED (not MAX_DRAWS_REACHED)
    //   2) Set bingoWinnerId
    //   3) Mark Fullt Hus phase as won
    assert.equal(game.status, "ENDED");
    assert.equal(
      game.endedReason,
      "BINGO_CLAIMED",
      `endedReason=${game.endedReason} — Fullt Hus auto-claim med payout=0 MÅ fortsatt sette BINGO_CLAIMED, ikke MAX_DRAWS_REACHED`,
    );
    assert.equal(game.bingoWinnerId, hostId);
    const fullhus = game.patternResults?.find((r) => r.patternName === "Fullt Hus");
    assert.equal(fullhus?.isWon, true, "Fullt Hus skal være vunnet");
    assert.equal(fullhus?.payoutAmount, 0, "Fullt Hus payout=0 (budget tom)");
    assert.equal(fullhus?.payoutSkipped, true);
  },
);

test(
  "PROD-INCIDENT 2026-04-29: mini-game state activated via Fullt Hus auto-claim even when payout=0",
  async () => {
    // PR #727 routes Fullt Hus auto-claim → mini-game activation via
    // `onAutoClaimedFullHouse` hook on EvaluatePhaseCallbacks. The hook
    // delegates to `activateMiniGameHelper` which mutates `game.miniGame`.
    // Bug would skip the hook if payout-skipped fasen avslutter for tidlig.
    //
    // We don't monkey-patch the engine — instead we verify `game.miniGame`
    // is set after the round, since that's the externally observable
    // contract (klient leser game.miniGame for å rendre popup).
    const engine = new BingoEngine(
      new FixedGridAdapter(),
      new InMemoryWalletAdapter(),
      { minDrawIntervalMs: 0, minPlayersToStart: 1, maxDrawsPerRound: 75 },
    );

    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-prod",
      playerName: "Tobias",
      walletId: "w-tobias",
      gameSlug: "bingo",
    });
    await engine.startGame({
      roomCode,
      actorPlayerId: hostId!,
      entryFee: 120,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      gameType: "standard",
      variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    });

    const allCells: number[] = [];
    for (const row of SOLO_GRID) for (const n of row) if (n !== 0) allCells.push(n);
    prioritiseDrawBag(engine, roomCode, allCells);

    for (let i = 0; i < 24; i += 1) {
      const snap = engine.getRoomSnapshot(roomCode);
      if (snap.currentGame?.isPaused) {
        engine.resumeGame(roomCode);
      }
      if (snap.currentGame?.status === "ENDED") break;
      try {
        await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
      } catch (err) {
        if (err instanceof DomainError && err.code === "GAME_NOT_RUNNING") break;
        throw err;
      }
    }

    const game = engine.getRoomSnapshot(roomCode).currentGame!;

    // Verify Fullt Hus auto-claim ended the round.
    assert.equal(game.endedReason, "BINGO_CLAIMED");

    // Mini-game state must be activated for the Fullt Hus winner.
    // GameSnapshot does NOT include miniGame field (PR #729 design); use
    // the dedicated `engine.getCurrentMiniGame(roomCode)` accessor for
    // externally observable mini-game state.
    const miniGame = engine.getCurrentMiniGame(roomCode);
    assert.ok(
      miniGame !== null,
      `mini-game skal være aktivert etter Fullt Hus auto-claim. Selv med payout=0 (budget exhausted) MÅ mini-game-popup-state aktiveres — bug-trigger var "no mini-game" i Tobias-incident game 87635663.`,
    );
    assert.equal(
      miniGame!.playerId,
      hostId,
      "mini-game playerId skal være Fullt Hus-vinneren",
    );
  },
);

test(
  "PROD-INCIDENT 2026-04-29: pattern eval is NOT gated on remainingPayoutBudget — phases mark won even when budget=0 from start",
  async () => {
    // Edge case: round where 1 Rad face EXACTLY equals budget — Phase 1 pays
    // full face, but Phase 2 has 0 budget. Verify phase 2-5 still detect
    // winners and mark won correctly.
    //
    // entryFee=125 → pool=125, budget=100. Phase 1 face=100 (capped to 100,
    // no skip). Phase 2 face=200, budget=0 → payout=0 + payoutSkipped.
    const { engine, roomCode, hostId } = await setupTestHallSpill1Room({
      entryFee: 125,
      payoutPercent: 80,
    });

    const allCells: number[] = [];
    for (const row of SOLO_GRID) for (const n of row) if (n !== 0) allCells.push(n);
    prioritiseDrawBag(engine, roomCode, allCells);

    let drawCount = 0;
    for (let i = 0; i < 75; i += 1) {
      try {
        await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
        drawCount += 1;
      } catch (err) {
        if (
          err instanceof DomainError &&
          (err.code === "NO_MORE_NUMBERS" || err.code === "GAME_NOT_RUNNING")
        ) {
          break;
        }
        throw err;
      }
    }

    const game = engine.getRoomSnapshot(roomCode).currentGame!;
    const phaseByName = new Map<string, { isWon: boolean; payoutAmount?: number; payoutSkipped?: boolean }>();
    for (const r of game.patternResults ?? []) {
      phaseByName.set(r.patternName, {
        isWon: r.isWon,
        payoutAmount: r.payoutAmount,
        payoutSkipped: r.payoutSkipped,
      });
    }

    // Phase 1 paid 100 (face=budget exactly).
    assert.equal(phaseByName.get("1 Rad")?.payoutAmount, 100);
    assert.equal(phaseByName.get("1 Rad")?.isWon, true);

    // Phase 2-5 must mark won despite budget=0.
    for (const phaseName of ["2 Rader", "3 Rader", "4 Rader", "Fullt Hus"]) {
      assert.equal(
        phaseByName.get(phaseName)?.isWon,
        true,
        `${phaseName} må være vunnet selv med budget=0`,
      );
      assert.equal(
        phaseByName.get(phaseName)?.payoutAmount,
        0,
        `${phaseName} payoutAmount=0 (budget tom)`,
      );
      assert.equal(
        phaseByName.get(phaseName)?.payoutSkipped,
        true,
        `${phaseName} payoutSkipped=true`,
      );
    }
  },
);
