/**
 * RTP-CAP-BUG-FIX (2026-04-29) — regression-vakt for cap-bypass-bug.
 *
 * **Bakgrunn (Tobias-incident game `057c0502-9a0c-48f6-8111-73fe5a49b599`):**
 *
 * Auto-runde 100 kr buy-in (10 tickets × 10 kr) med payoutPercent=80
 * (maxPayoutBudget=80 kr). 1 Rad var konfigurert som FIXED-prize face=100 kr.
 * Engine før denne fixen bypass-et RTP-budgeten for fixed-prize-patterns og
 * betalte 100 kr ut — drenerte hus-saldoen til 0. Logget claim viste:
 *   `payoutAmount: 100, rtpBudgetBefore: 80, rtpBudgetAfter: 0,
 *    rtpCapped: false`
 * (rtpCapped LOOKS WRONG fordi payout > rtpBudgetBefore — det er nettopp den
 * cap-flagg-bug-en denne testen verifiserer fixet.)
 *
 * Etter 1 Rad-payout kom 28 mini-game-claims sekvensielt mot tom hus-konto
 * → "Wallet house-... mangler saldo" → engine logget 28 errors og runden
 * endte med kun 1 Rad utbetalt. 2/3/4 Rader og Fullt Hus fikk INGEN
 * utbetaling og INGEN forklaring til kunden.
 *
 * **Fix-en denne testen verifiserer:**
 *
 *   1. payout = min(face, remainingPayoutBudget, houseAvailableBalance)
 *   2. rtpCapped = true når payout < requestedAfterPolicyAndPool
 *   3. Når payout=0 markeres fasen som vunnet med payoutSkipped: true +
 *      payoutSkippedReason — runden fortsetter til neste fase, engine
 *      crash-er ikke
 *   4. Hus-konto går aldri negativt
 *
 * **Test-tilnærming:** vi bruker manual-claim mode (gameSlug "rocket" så
 * vi unngår Spill 1 auto-pause + 5-fase-auto-claim) og kontrollerer claim-
 * payout direkte via `submitClaim` i en kontrollert sekvens.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "../BingoEngine.js";
import { InMemoryWalletAdapter } from "../BingoEngine.test.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../types.js";

// Fast 5x5 grid: rad 0 = 1,2,3,4,5; resten av cellene er fra rad 1-4.
const FIXED_GRID = [
  [1, 2, 3, 4, 5],
  [13, 14, 15, 16, 17],
  [25, 26, 0, 27, 28],
  [37, 38, 39, 40, 41],
  [49, 50, 51, 52, 53],
];

class FixedTicketBingoAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: FIXED_GRID.map((row) => [...row]) };
  }
}

/**
 * Tving prioritert draw-rekkefølge så testen er deterministisk. Speiler
 * mønster fra `BingoEngine.payoutTargetSide.test.ts`.
 */
function prioritizeDrawNumbers(
  engine: BingoEngine,
  roomCode: string,
  preferred: readonly number[],
): void {
  const internal = (
    engine as unknown as { rooms: Map<string, { currentGame?: { drawBag: number[] } }> }
  ).rooms.get(roomCode);
  const drawBag = internal?.currentGame?.drawBag;
  if (!drawBag) return;
  const hit = preferred.filter((v) => drawBag.includes(v));
  if (hit.length === 0) return;
  const rest = drawBag.filter((v) => !hit.includes(v));
  internal!.currentGame!.drawBag = [...hit, ...rest];
}

test(
  "RTP-CAP-BUG-FIX: 1 Rad fixed-prize face=100 kr cappes til 80 kr når RTP-budget er 80 (claim.rtpCapped=true)",
  async () => {
    const wallet = new InMemoryWalletAdapter();
    const engine = new BingoEngine(new FixedTicketBingoAdapter(), wallet, {
      minDrawIntervalMs: 0,
      minPlayersToStart: 1,
    });

    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-rtp-cap",
      playerName: "Alice",
      walletId: "w-rtp-alice",
      gameSlug: "rocket", // ikke Spill 1 → ingen auto-pause + ad-hoc claim
    });

    // Round: 100 kr buy-in × 1 ticket → prizePool=100, payoutBudget=80.
    // 1 Rad konfigurert som FIXED face 100 kr. 2 Rader fixed face 200 kr.
    await engine.startGame({
      roomCode,
      actorPlayerId: hostId,
      entryFee: 100,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      patterns: [
        {
          id: "1-rad",
          name: "1 Rad",
          claimType: "LINE",
          prizePercent: 0,
          order: 1,
          design: 1,
          winningType: "fixed",
          prize1: 100,
        },
        {
          id: "2-rader",
          name: "2 Rader",
          claimType: "LINE",
          prizePercent: 0,
          order: 2,
          design: 2,
          winningType: "fixed",
          prize1: 200,
        },
        {
          id: "fullt-hus",
          name: "Fullt Hus",
          claimType: "BINGO",
          prizePercent: 0,
          order: 3,
          design: 0,
          winningType: "fixed",
          prize1: 500,
        },
      ],
    });

    // Trekk + merk hele rad 0 (numrene 1-5) for å oppfylle 1 Rad.
    const lineNumbers = [1, 2, 3, 4, 5];
    prioritizeDrawNumbers(engine, roomCode, lineNumbers);
    let drawGuard = 0;
    const remaining = new Set(lineNumbers);
    while (remaining.size > 0 && drawGuard < 75) {
      const { number } = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
      if (remaining.has(number)) {
        await engine.markNumber({ roomCode, playerId: hostId, number });
        remaining.delete(number);
      }
      drawGuard += 1;
    }
    assert.equal(remaining.size, 0, "alle 5 numre må være trukket+merket");

    // Submit 1 Rad-claim manuelt.
    const claim1 = await engine.submitClaim({ roomCode, playerId: hostId, type: "LINE" });
    assert.equal(claim1.valid, true, `1 Rad claim skal være valid; reason=${claim1.reason}`);

    // Bug 1-assertion: payout MÅ cappes til 80 (RTP-budget), ikke 100 (face).
    assert.equal(
      claim1.payoutAmount,
      80,
      `1 Rad payout skal være capped til budget 80; faktisk ${claim1.payoutAmount}`,
    );
    // Bug 2-assertion: rtpCapped MÅ være true når payout < requested.
    assert.equal(
      claim1.rtpCapped,
      true,
      `claim.rtpCapped skal være true når payout=80 < face=100; faktisk ${claim1.rtpCapped}`,
    );
    // RTP-budget skal være drenert til 0 etter første cap.
    assert.equal(
      claim1.rtpBudgetAfter,
      0,
      `rtpBudgetAfter skal være 0; faktisk ${claim1.rtpBudgetAfter}`,
    );

    // Hus-konto MÅ ikke være negativ — dette var crash-trigger i prod.
    // (test-InMemoryWalletAdapter pre-funder system-konti med 1000 kr som
    // er irrelevant for cap-logikken; vi sjekker bare at saldoen ikke ble
    // negativ etter payout — ergo hus har fortsatt ≥ 0.)
    const houseAccountId = "house-hall-rtp-cap-databingo-internet";
    const houseBalance = await wallet.getBalance(houseAccountId);
    assert.ok(
      houseBalance >= 0,
      `Hus-saldo skal aldri være negativ; faktisk ${houseBalance}`,
    );
  },
);

test(
  "RTP-CAP-BUG-FIX: auto-claim multi-fase med tom budget får skipped fases (runden krasjer ikke)",
  async () => {
    // Bruker Spill 1 auto-claim-path (BIN-694) som er den faktiske flyten i
    // prod-incidenten. Auto-claim går gjennom `evaluateActivePhase` og
    // `payoutPhaseWinner` — IKKE `submitClaim`-grenen — så BIN-45
    // idempotency-guard som stopper duplikat LINE-claims er ikke i veien
    // for å verifisere multi-fase-progresjon. Dette tester den FAKTISKE
    // bug-flyt-en fra Tobias-incident game `057c0502`.
    const wallet = new InMemoryWalletAdapter();
    const engine = new BingoEngine(new FixedTicketBingoAdapter(), wallet, {
      minDrawIntervalMs: 0,
      minPlayersToStart: 1,
    });

    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-rtp-empty",
      playerName: "Bob",
      walletId: "w-rtp-bob",
      gameSlug: "bingo", // Spill 1 → autoClaimPhaseMode aktivert
    });

    // Spill 1 har auto-pause etter hver fase-vinning (REQ direktiv 2026-04-27).
    // For testen bruker vi `isTestHall` for å bypasse pausen og kjøre alle
    // fasene rett gjennom slik prod-incidenten gjorde.
    engine.setRoomTestHall(roomCode, true);

    await engine.startGame({
      roomCode,
      actorPlayerId: hostId,
      entryFee: 100,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      // gameType: "bingo" → DEFAULT_NORSK_BINGO_CONFIG (autoClaimPhaseMode=true).
      gameType: "bingo",
      patterns: [
        {
          id: "1-rad",
          name: "1 Rad",
          claimType: "LINE",
          prizePercent: 0,
          order: 1,
          design: 1,
          winningType: "fixed",
          prize1: 100,
        },
        {
          id: "2-rader",
          name: "2 Rader",
          claimType: "LINE",
          prizePercent: 0,
          order: 2,
          design: 2,
          winningType: "fixed",
          prize1: 200,
        },
        {
          id: "fullt-hus",
          name: "Fullt Hus",
          claimType: "BINGO",
          prizePercent: 0,
          order: 3,
          design: 0,
          winningType: "fixed",
          prize1: 500,
        },
      ],
    });

    // Trekk hele brettet (24 ikke-null-celler i 5x5 med center=0). Dette
    // oppfyller alle tre fasene (1 Rad, 2 Rader, Fullt Hus) sekvensielt.
    const allCells: number[] = [];
    for (const row of FIXED_GRID) for (const n of row) if (n !== 0) allCells.push(n);
    prioritizeDrawNumbers(engine, roomCode, allCells);

    // Trekk én ball om gangen — auto-claim engine evaluerer fasen etter
    // hver draw. Test-hall-bypass kjører rett gjennom uten pause.
    for (let i = 0; i < allCells.length; i += 1) {
      try {
        await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
      } catch {
        // NO_MORE_NUMBERS når runden ender → bryt ut.
        break;
      }
    }

    const game = engine.getRoomSnapshot(roomCode).currentGame!;
    const phase1 = game.patternResults?.find((r) => r.patternId === "1-rad");
    const phase2 = game.patternResults?.find((r) => r.patternId === "2-rader");
    const phase3 = game.patternResults?.find((r) => r.patternId === "fullt-hus");

    assert.ok(phase1, "1-rad patternResult må eksistere");
    assert.ok(phase2, "2-rader patternResult må eksistere");
    assert.ok(phase3, "fullt-hus patternResult må eksistere");

    // Phase 1: vunnet med payout=80 (capped fra face=100 til budget=80).
    assert.equal(phase1!.isWon, true, "1-rad skal være vunnet");
    assert.equal(phase1!.payoutAmount, 80, `1-rad payout=80 (capped); faktisk ${phase1!.payoutAmount}`);

    // Phase 2: vunnet men ingen utbetaling (budget tom). DETTE er kjernen i bug-fixen.
    assert.equal(phase2!.isWon, true, "2-rader skal være vunnet (selv om budget=0)");
    assert.equal(phase2!.payoutAmount, 0, `2-rader payout=0 (budget exhausted); faktisk ${phase2!.payoutAmount}`);
    assert.equal(
      phase2!.payoutSkipped,
      true,
      `2-rader patternResult.payoutSkipped skal være true; faktisk ${phase2!.payoutSkipped}`,
    );
    assert.equal(
      phase2!.payoutSkippedReason,
      "budget-exhausted",
      `2-rader patternResult.payoutSkippedReason='budget-exhausted'; faktisk ${phase2!.payoutSkippedReason}`,
    );

    // Phase 3 (Fullt Hus): vunnet, ingen utbetaling.
    assert.equal(phase3!.isWon, true, "fullt-hus skal være vunnet");
    assert.equal(phase3!.payoutAmount, 0, `fullt-hus payout=0; faktisk ${phase3!.payoutAmount}`);
    assert.equal(phase3!.payoutSkipped, true, "fullt-hus patternResult.payoutSkipped=true");

    // Verifiser at claims-arrayet har 3 records (én per fase) og at alle
    // er marked rtpCapped=true (ingen full payout).
    const claims = game.claims;
    assert.equal(claims.length, 3, `forventet 3 claims (én per fase); faktisk ${claims.length}`);

    // Den første claim skal være ekte payout (80 kr).
    const phaseClaims = claims.filter((c) => c.payoutAmount !== undefined);
    assert.equal(phaseClaims.length, 3);
    const paidClaims = phaseClaims.filter((c) => (c.payoutAmount ?? 0) > 0);
    assert.equal(paidClaims.length, 1, `kun 1 claim med faktisk payout > 0; faktisk ${paidClaims.length}`);

    // De skipped claims skal ha payoutSkipped=true og rtpCapped=true.
    const skippedClaims = phaseClaims.filter((c) => c.payoutAmount === 0);
    assert.equal(skippedClaims.length, 2, `2 skipped claims; faktisk ${skippedClaims.length}`);
    for (const c of skippedClaims) {
      assert.equal(c.payoutSkipped, true, `skipped claim må ha payoutSkipped=true (claimId=${c.id})`);
      assert.equal(c.rtpCapped, true, `skipped claim må ha rtpCapped=true (claimId=${c.id})`);
      assert.equal(
        c.payoutSkippedReason,
        "budget-exhausted",
        `skipped claim payoutSkippedReason='budget-exhausted' (claimId=${c.id})`,
      );
    }

    // Hus-saldo skal aldri være negativ. Bruk available-balance så test-
    // pre-funding på 1000 kr ikke maskerer en eventuell over-payment.
    const houseAccountId = "house-hall-rtp-empty-main_game-internet";
    const houseBalance = await wallet.getBalance(houseAccountId);
    assert.ok(
      houseBalance >= 0,
      `Hus-saldo skal aldri være negativ; faktisk ${houseBalance}`,
    );
  },
);

test(
  "RTP-CAP-BUG-FIX: variabel 100% prizePercent BINGO (ingen pool igjen) får payout=0 + payoutSkipped",
  async () => {
    // Komplementær case: variabel-percent (ikke fixed) som drenerer pool i
    // første LINE-vinning, og deretter prøver BINGO på tom pool.
    const wallet = new InMemoryWalletAdapter();
    const engine = new BingoEngine(new FixedTicketBingoAdapter(), wallet, {
      minDrawIntervalMs: 0,
      minPlayersToStart: 1,
    });

    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-rtp-percent",
      playerName: "Carol",
      walletId: "w-rtp-carol",
      gameSlug: "rocket",
    });

    // 100 kr buy-in × 1 ticket → pool 100, budget 80.
    // 1 Rad bruker 100% av pool-en (tomgang i etterkant).
    await engine.startGame({
      roomCode,
      actorPlayerId: hostId,
      entryFee: 100,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      patterns: [
        { id: "1-rad", name: "1 Rad", claimType: "LINE", prizePercent: 100, order: 1, design: 1 },
        { id: "fullt-hus", name: "Fullt Hus", claimType: "BINGO", prizePercent: 100, order: 2, design: 0 },
      ],
    });

    const numbersToMark = [
      1, 2, 3, 4, 5, 13, 14, 15, 16, 17, 25, 26, 27, 28, 37, 38, 39, 40, 41, 49, 50, 51, 52, 53,
    ];
    prioritizeDrawNumbers(engine, roomCode, numbersToMark);
    let drawGuard = 0;
    const remaining = new Set(numbersToMark);
    while (remaining.size > 0 && drawGuard < 75) {
      const { number } = await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
      if (remaining.has(number)) {
        await engine.markNumber({ roomCode, playerId: hostId, number });
        remaining.delete(number);
      }
      drawGuard += 1;
    }

    const claim1 = await engine.submitClaim({ roomCode, playerId: hostId, type: "LINE" });
    assert.equal(claim1.valid, true);
    // 1 Rad: pool=100 × 100%=100, capped til budget 80 → payout=80
    assert.equal(claim1.payoutAmount, 80, `LINE payout=80 (budget-capped); faktisk ${claim1.payoutAmount}`);

    const claim2 = await engine.submitClaim({ roomCode, playerId: hostId, type: "BINGO" });
    assert.equal(claim2.valid, true);
    // BINGO: pool = 20 (etter line-payout), budget = 0 → payout=0, skipped
    assert.equal(claim2.payoutAmount, 0, `BINGO payout=0 (budget exhausted); faktisk ${claim2.payoutAmount}`);
    assert.equal(claim2.payoutSkipped, true);
    assert.equal(claim2.payoutSkippedReason, "budget-exhausted");

    // Game skal være ENDED (BINGO-claim avslutter alltid runden).
    const game = engine.getRoomSnapshot(roomCode).currentGame!;
    assert.equal(game.status, "ENDED", `game.status skal være ENDED; faktisk ${game.status}`);
    assert.equal(game.endedReason, "BINGO_CLAIMED");
  },
);
