/**
 * Unified pipeline refactor — Fase 0b (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §5.1).
 *
 * Invariant: Demo Hall 5-fase Norsk Bingo total = 1700 kr (1 spiller, alle phases).
 *
 * Hvorfor:
 *   - "1700 kr-bugen" 2026-04-27 (Tobias-rapport): solo-spiller vant alle
 *     5 phases men gevinst-lommebok viste ikke total 1700 kr. PR #595
 *     fikset BingoEngine-pathen, men dual-execution-mønsteret gjorde at
 *     scheduled-pathen ikke trengte fix.
 *   - I unified pipeline (Fase 1+) skal det være ÉN payout-sti uavhengig
 *     av scheduled vs ad-hoc. Denne testen er en kontrakt: når
 *     PayoutService får input "5 vinner-events for én spiller på alle 5
 *     phases av DEFAULT_NORSK_BINGO_CONFIG", skal sum av wallet-credits
 *     være 100 + 200 + 200 + 200 + 1000 = 1700 kr.
 *
 * Implementasjon (Fase 0):
 *   - Vi har ikke PayoutService ennå. Vi simulerer payout-flyten direkte
 *     mot WalletPort med credits som matcher faste prize-verdier fra
 *     DEFAULT_NORSK_BINGO_CONFIG. Dette etablerer baseline-kontrakten
 *     som Fase 1 PayoutService MÅ holde.
 *
 * Status: PASS forventet (denne testen verifiserer baseline-aritmetikk).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryWalletPort } from "../../ports/inMemory/InMemoryWalletPort.js";
import { DefaultIdempotencyKeyPort } from "../../ports/IdempotencyKeyPort.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "../../game/variantConfig.js";

const NORSK_BINGO_PHASE_PRIZES_NOK = [100, 200, 200, 200, 1000] as const;
const NORSK_BINGO_TOTAL_NOK = 1700;

test("invariant: Demo Hall 5-fase Norsk Bingo total = 1700 kr (1 spiller alle phases)", async () => {
  // Sanity: bekreft at config faktisk har de prizes vi forventer.
  // Hvis noen endrer DEFAULT_NORSK_BINGO_CONFIG.patterns blir denne
  // testen rød, og vi tvinger bevisst review.
  const fixedPrizes = DEFAULT_NORSK_BINGO_CONFIG.patterns.map((p) => p.prize1 ?? 0);
  assert.deepEqual(
    fixedPrizes,
    [...NORSK_BINGO_PHASE_PRIZES_NOK],
    `DEFAULT_NORSK_BINGO_CONFIG.patterns prize1-verdier skal være ${NORSK_BINGO_PHASE_PRIZES_NOK.join("/")}`,
  );
  assert.equal(
    fixedPrizes.reduce((sum, p) => sum + p, 0),
    NORSK_BINGO_TOTAL_NOK,
    "Sum av faste premier skal være 1700 kr",
  );

  // Simulér payout-flyten: 1 spiller, alle 5 phases vinnes. Hver phase-payout
  // går via WalletPort.credit med targetSide: "winnings" (regulatorisk
  // korrekt — payout fra game-engine).
  const port = new InMemoryWalletPort();
  const keys = new DefaultIdempotencyKeyPort();
  const walletId = "wallet-solo-winner";
  const gameId = "game-norsk-bingo-1";
  const playerId = "player-1";

  // Spiller har topup'et 180 kr (4 brett @ 45 kr) før spillet starter.
  port.seed(walletId, 18_000);

  // Payout for hver av de 5 phases.
  for (let phase = 1; phase <= 5; phase++) {
    const prizeNok = NORSK_BINGO_PHASE_PRIZES_NOK[phase - 1];
    const prizeCents = prizeNok * 100;
    const phaseId = `phase-${phase}`;
    const idempotencyKey = keys.forPayout(gameId, phaseId, playerId);

    await port.credit({
      walletId,
      amountCents: prizeCents,
      reason: `Norsk Bingo phase ${phase}`,
      idempotencyKey,
      targetSide: "winnings",
    });
  }

  // Verifisér: total winnings = 1700 kr, deposit uendret 180 kr.
  const balance = await port.getBalance(walletId);
  assert.equal(balance.deposit, 180, "Deposit-side skal være uendret 180 kr");
  assert.equal(balance.winnings, NORSK_BINGO_TOTAL_NOK, "Winnings-side skal være 1700 kr");
  assert.equal(balance.total, 180 + NORSK_BINGO_TOTAL_NOK, "Total = 180 + 1700 = 1880 kr");
});

test("invariant: phase-payout idempotent — re-run skriver ikke dobbel sum", async () => {
  const port = new InMemoryWalletPort();
  const keys = new DefaultIdempotencyKeyPort();
  const walletId = "wallet-retry";
  const gameId = "game-retry-1";
  const playerId = "player-1";
  port.seed(walletId, 0);

  // Kjør phase-1-payout 5 ganger med samme idempotency-key — kun 1 credit.
  const phaseId = "phase-1";
  const key = keys.forPayout(gameId, phaseId, playerId);
  for (let i = 0; i < 5; i++) {
    await port.credit({
      walletId,
      amountCents: 10_000,
      reason: `retry-${i}`,
      idempotencyKey: key,
      targetSide: "winnings",
    });
  }

  const balance = await port.getBalance(walletId);
  assert.equal(balance.winnings, 100, "5x retry skal kun gi 1x 100 kr (idempotent)");
});

test("invariant: 2 vinnere på samme phase får hver sin (uavhengige keys)", async () => {
  // Kontroll: 2 distinkte spillere på phase-1 → 2 distinkte idempotency-keys
  // → 2 wallet-credits. Hvis keyformatet noensinne kollapser to spillere
  // til samme key, vil bare den første credit'en treffe.
  const port = new InMemoryWalletPort();
  const keys = new DefaultIdempotencyKeyPort();
  const gameId = "game-multi-1";
  const phaseId = "phase-1";
  port.seed("wallet-A", 0);
  port.seed("wallet-B", 0);

  const keyA = keys.forPayout(gameId, phaseId, "player-A");
  const keyB = keys.forPayout(gameId, phaseId, "player-B");
  assert.notEqual(keyA, keyB, "Keys skal være distinkte for distinkte playerIds");

  await port.credit({ walletId: "wallet-A", amountCents: 5000, reason: "split", idempotencyKey: keyA, targetSide: "winnings" });
  await port.credit({ walletId: "wallet-B", amountCents: 5000, reason: "split", idempotencyKey: keyB, targetSide: "winnings" });

  const balA = await port.getBalance("wallet-A");
  const balB = await port.getBalance("wallet-B");
  assert.equal(balA.winnings, 50);
  assert.equal(balB.winnings, 50);
});
