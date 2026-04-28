/**
 * PILOT-EMERGENCY 2026-04-28 — regression-vakt for percent-mode zero-payout.
 *
 * Rotårsak (docs/operations/TESTBRUKER_DIAGNOSE_2026-04-28.md):
 *   1. Admin-UI default = `mode: "percent"` ved opprettelse av ny ticket-color.
 *   2. spill1VariantMapper.patternConfigForPhase produserte `prizePercent: 0`
 *      når admin-UI lagret mode:percent + amount:0 (default).
 *   3. Engine-pathen totalPhasePrize = pool * 0 / 100 ga `payout=0`.
 *   4. State-mutasjoner (`game.lineWinnerId`, `linePatternResult.isWon`,
 *      `game.bingoWinnerId`) lå inne i `if (payout > 0)`-blokken → runden
 *      hang i RUNNING uten gevinster.
 *
 * Fixene (i samme PR):
 *   - Fix 1: state-mutasjoner flyttet UT av `if (payout > 0)` i submitClaim
 *     (LINE og BINGO branches). Wallet.transfer + audit-events forblir gated.
 *   - Fix 2: spill1VariantMapper faller tilbake til fallback-pattern
 *     (DEFAULT_NORSK_BINGO_CONFIG fixed prize) ved mode:percent + amount=0.
 *   - Fix 3: admin-UI default = `mode: "fixed"` for nye configs.
 *
 * Disse testene er regression-vakt:
 *   - Test 1: simulerer admin-bug (mapperen med mode:percent + amount:0).
 *     Asserter at fallback-mekanismen (Fix 2) leverer fixed-prize fra
 *     fallback i stedet for prizePercent:0.
 *   - Test 2: lavnivå-test som simulerer en config der mapperen IKKE har
 *     fanget bug-en (manuelt-konstruert variantConfig med prizePercent:0,
 *     uten winningType:"fixed"). Asserter at engine-state-mutasjonene
 *     (Fix 1) gjør at game ender korrekt selv ved payout=0.
 *
 * Hvis denne testen feiler i fremtidig regresjon, betyr det at minst én av
 * disse fixene har blitt forhastet rullet tilbake.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import {
  buildVariantConfigFromSpill1Config,
  type Spill1ConfigInput,
} from "./spill1VariantMapper.js";
import {
  DEFAULT_NORSK_BINGO_CONFIG,
  type GameVariantConfig,
} from "./variantConfig.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

// Standard Alice-grid med rad 0 = 1, 16, 31, 46, 61.
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

// ── Test 1: Mapper-fallback for mode:percent + amount=0 (Fix 2) ─────────────

test(
  "regression: spill1VariantMapper produserer ikke prizePercent:0 ved mode:percent + amount=0 (Fix 2)",
  () => {
    // Simulerer admin-UI-bug: ny ticket-color med eksplisitt mode:percent
    // og amount:0 (det som skjedde i prod fram til denne PR-en).
    const buggyInput: Spill1ConfigInput = {
      ticketColors: [
        {
          color: "small_white",
          priceNok: 20,
          prizePerPattern: {
            row_1: { mode: "percent", amount: 0 },
            row_2: { mode: "percent", amount: 0 },
            row_3: { mode: "percent", amount: 0 },
            row_4: { mode: "percent", amount: 0 },
            full_house: { mode: "percent", amount: 0 },
          },
        },
      ],
    };
    const vc = buildVariantConfigFromSpill1Config(buggyInput);
    const smallWhite = vc.patternsByColor?.["Small White"];
    assert.ok(smallWhite, "Small White matrise må finnes");
    assert.equal(smallWhite.length, 5, "5 patterns forventet");

    // Fix 2-assertion: hver pattern skal ha winningType:"fixed" + prize1 > 0
    // fra fallback (DEFAULT_NORSK_BINGO_CONFIG: 100/200/200/200/1000 kr).
    // Dette beviser at mapperen IKKE har skrevet `prizePercent: 0` slik
    // den gjorde før fixet.
    const expectedPrizes = [100, 200, 200, 200, 1000];
    for (let i = 0; i < 5; i++) {
      assert.equal(
        smallWhite[i].winningType,
        "fixed",
        `Phase ${i}: winningType skal være "fixed" (fallback til DEFAULT_NORSK_BINGO_CONFIG), ikke ${smallWhite[i].winningType}`,
      );
      assert.equal(
        smallWhite[i].prize1,
        expectedPrizes[i],
        `Phase ${i}: prize1 skal være ${expectedPrizes[i]} kr fra fallback`,
      );
    }
  },
);

// ── Test 2: submitClaim BINGO med payout=0 → game.status="ENDED" (Fix 1) ────
//
// Tester submitClaim BINGO-grenen direkte. Bruker en gameSlug som IKKE er
// Spill 1 (`bingo`/`game_1`/`norsk-bingo`) for å unngå auto-pause etter
// fase-vinning (som er Spill 1-spesifikk). Manual-claim mode + non-Spill 1
// slug → vi kan trekke alle baller og deretter eksplisitt submitClaim
// uten at engine pauser. Bug-en vi tester er identisk uavhengig av slug:
// state-mutasjoner i submitClaim BINGO-grenen.

test(
  "regression: manuell BINGO-submitClaim med payout=0 skal sette game.status='ENDED' (Fix 1)",
  async () => {
    const wallet = new InMemoryWalletAdapter();
    const engine = new BingoEngine(new FixedGridAdapter(), wallet, {
      minDrawIntervalMs: 0,
      minPlayersToStart: 1,
    });
    // NB: gameSlug "rocket" → ikke Spill 1 → ingen auto-pause etter fase-vinn.
    // Bug-en er i submitClaim, ikke i auto-claim, så scenarioet er identisk.
    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-test-fix1-manual",
      playerName: "Alice",
      walletId: "w-alice-manual",
      gameSlug: "rocket",
    });

    // Manual claim mode → submitClaim er eneste path til pattern-evaluering.
    // Konstruert config simulerer den korrupte tilstanden: prizePercent:0
    // UTEN winningType:"fixed". Dette er hva mapperen kunne produsere før
    // Fix 2 (defense-in-depth: Fix 1 håndterer det på engine-nivå).
    const corruptedConfig: GameVariantConfig = {
      ...DEFAULT_NORSK_BINGO_CONFIG,
      patterns: [
        { name: "1 Rad", claimType: "LINE", prizePercent: 0, design: 1 },
        { name: "2 Rader", claimType: "LINE", prizePercent: 0, design: 2 },
        { name: "3 Rader", claimType: "LINE", prizePercent: 0, design: 3 },
        { name: "4 Rader", claimType: "LINE", prizePercent: 0, design: 4 },
        { name: "Fullt Hus", claimType: "BINGO", prizePercent: 0, design: 0 },
      ],
      // Manual-claim only — slå AV både patternEvalMode auto-claim OG
      // autoClaimPhaseMode (som ellers ville utløst evaluateActivePhase
      // på hver draw og endt runden tidlig før vi får submittet manuelt).
      patternEvalMode: "manual-claim",
      autoClaimPhaseMode: false,
    };

    await engine.startGame({
      roomCode,
      actorPlayerId: hostId!,
      entryFee: 0, // Tom pool → totalPhasePrize=0 garantert.
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      gameType: "standard",
      variantConfig: corruptedConfig,
    });

    // Trekk alle 24 ikke-null-celler så Fullt Hus er oppfylt.
    // markNumber-en er nødvendig fordi submitClaim-validering bruker
    // playerMarks (ikke drawnSet) — manual-claim-modus krever at spilleren
    // (eller test-en) eksplisitt merker hver trukket ball.
    const allAlice: number[] = [];
    for (const row of ALICE_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
    prioritiseDrawBag(engine, roomCode, allAlice);

    for (let i = 0; i < 24; i += 1) {
      const { number: drawn } = await engine.drawNextNumber({
        roomCode,
        actorPlayerId: hostId!,
      });
      await engine.markNumber({ roomCode, playerId: hostId!, number: drawn });
    }

    // Submit BINGO claim manuelt — dette er der bug-en var.
    const claim = await engine.submitClaim({
      roomCode,
      playerId: hostId!,
      type: "BINGO",
    });

    assert.equal(claim.valid, true, `Claim skal være valid; reason=${claim.reason}`);

    const game = engine.getRoomSnapshot(roomCode).currentGame!;

    // Fix 1-assertion for BINGO-grenen: state-mutasjoner skjer uavhengig
    // av payout-beløp. game.status="ENDED" var allerede utenfor if(payout>0)
    // (CRIT-6), men game.bingoWinnerId var INSIDE — det er det Fix 1 fixer.
    assert.equal(
      game.status,
      "ENDED",
      `game.status skal være "ENDED" selv ved payout=0; faktisk ${game.status}`,
    );
    assert.equal(
      game.endedReason,
      "BINGO_CLAIMED",
      `game.endedReason skal være "BINGO_CLAIMED"; faktisk ${game.endedReason}`,
    );
    assert.equal(
      game.bingoWinnerId,
      hostId,
      `game.bingoWinnerId skal være host (Fix 1: flyttet UT av if(payout>0)); faktisk ${game.bingoWinnerId}`,
    );

    // Wallet skal IKKE være kreditert (legitimt for percent-mode med tom pool).
    const winningsBalance = await wallet.getWinningsBalance("w-alice-manual");
    assert.equal(
      winningsBalance,
      0,
      `Winnings-balance skal være 0 ved payout=0; faktisk ${winningsBalance}`,
    );
  },
);

// ── Test 3: submitClaim LINE med payout=0 → patternResult.isWon=true (Fix 1) ─

test(
  "regression: manuell LINE-submitClaim med payout=0 skal markere patternResult.isWon (Fix 1)",
  async () => {
    const wallet = new InMemoryWalletAdapter();
    const engine = new BingoEngine(new FixedGridAdapter(), wallet, {
      minDrawIntervalMs: 0,
      minPlayersToStart: 1,
    });
    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-test-fix1-line",
      playerName: "Alice",
      walletId: "w-alice-line",
      gameSlug: "rocket",
    });

    const corruptedConfig: GameVariantConfig = {
      ...DEFAULT_NORSK_BINGO_CONFIG,
      patterns: [
        { name: "1 Rad", claimType: "LINE", prizePercent: 0, design: 1 },
        { name: "2 Rader", claimType: "LINE", prizePercent: 0, design: 2 },
        { name: "3 Rader", claimType: "LINE", prizePercent: 0, design: 3 },
        { name: "4 Rader", claimType: "LINE", prizePercent: 0, design: 4 },
        { name: "Fullt Hus", claimType: "BINGO", prizePercent: 0, design: 0 },
      ],
      // Manual-claim only — slå AV både patternEvalMode auto-claim OG
      // autoClaimPhaseMode (som ellers ville utløst evaluateActivePhase
      // på hver draw og endt runden tidlig før vi får submittet manuelt).
      patternEvalMode: "manual-claim",
      autoClaimPhaseMode: false,
    };

    await engine.startGame({
      roomCode,
      actorPlayerId: hostId!,
      entryFee: 0,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      gameType: "standard",
      variantConfig: corruptedConfig,
    });

    // Trekk hele rad 0 → 1 Rad er oppfylt.
    // markNumber kreves for manual-claim-modus (samme som Test 2).
    prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
    for (let i = 0; i < 5; i += 1) {
      const { number: drawn } = await engine.drawNextNumber({
        roomCode,
        actorPlayerId: hostId!,
      });
      await engine.markNumber({ roomCode, playerId: hostId!, number: drawn });
    }

    // Submit LINE claim manuelt — dette er der bug-en var.
    const claim = await engine.submitClaim({
      roomCode,
      playerId: hostId!,
      type: "LINE",
    });

    assert.equal(claim.valid, true, `LINE claim skal være valid; reason=${claim.reason}`);

    const game = engine.getRoomSnapshot(roomCode).currentGame!;

    // Fix 1-assertion for LINE-grenen: state-mutasjoner skjer uavhengig
    // av payout-beløp. game.lineWinnerId og linePatternResult.isWon var
    // begge INSIDE if(payout>0) — det er det Fix 1 fixer.
    assert.equal(
      game.lineWinnerId,
      hostId,
      `game.lineWinnerId skal være host (Fix 1); faktisk ${game.lineWinnerId}`,
    );

    const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
    assert.equal(
      phase1?.isWon,
      true,
      `Phase 1 isWon skal være true selv ved payout=0 (Fix 1); faktisk ${phase1?.isWon}`,
    );
    assert.equal(
      phase1?.winnerId,
      hostId,
      `Phase 1 winnerId skal være host; faktisk ${phase1?.winnerId}`,
    );
    assert.equal(
      phase1?.payoutAmount,
      0,
      `Phase 1 payoutAmount skal være 0; faktisk ${phase1?.payoutAmount}`,
    );

    const winningsBalance = await wallet.getWinningsBalance("w-alice-line");
    assert.equal(
      winningsBalance,
      0,
      `Winnings-balance skal være 0 ved payout=0; faktisk ${winningsBalance}`,
    );
  },
);
