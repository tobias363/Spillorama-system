/**
 * Unified pipeline refactor — Fase 0b (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §5.1).
 *
 * Invariant: multi-winner-split-rounding er deterministisk + sum ≤ totalPrize,
 * og rest tilfaller huset (HOUSE_RETAINED i compliance-ledger per HIGH-6).
 *
 * Hvorfor:
 *   - SPILL1_MULTI_WINNER_SPLIT_ROUNDING_VERIFICATION_2026-04-27.md
 *     dokumenterer at floor-rounding er accepted policy.
 *   - BingoEnginePatternEval.ts:368 implementerer formelen:
 *       prizePerWinner = floor(totalPhasePrize / winnerCount)
 *       houseRetainedRest = totalPhasePrize - winnerCount * prizePerWinner
 *   - Hvis denne aritmetikken noensinne brytes (e.g. ceil i stedet for
 *     floor) blir compliance-rapport feil og §11-distribusjon avviker.
 *
 * Property:
 *   For alle (totalPrize ≥ 0, winnerCount ≥ 1):
 *     - prizePerWinner = floor(totalPrize / winnerCount)
 *     - winnerCount * prizePerWinner ≤ totalPrize
 *     - houseRest = totalPrize - winnerCount * prizePerWinner ∈ [0, winnerCount)
 *     - sum(splits) + houseRest = totalPrize (eksakt — ingen tap)
 *
 * Implementasjon:
 *   - Pure-funksjon `splitPrize` definert lokalt for testen — speilkopi
 *     av aritmetikken i BingoEnginePatternEval.
 *   - I Fase 1 vil PayoutService eksportere en namngitt `splitPrize`-
 *     funksjon, og denne testen kan importere den i stedet for å
 *     duplisere.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

/**
 * Lokal kopi av split-aritmetikken fra BingoEnginePatternEval.ts:364-368.
 * Beløp i ØRE for at testen skal være rounding-fri.
 */
export function splitPrize(
  totalPrizeCents: number,
  winnerCount: number,
): { prizePerWinnerCents: number; houseRetainedCents: number } {
  if (!Number.isInteger(totalPrizeCents) || totalPrizeCents < 0) {
    throw new Error(`totalPrizeCents må være ikke-negativt heltall, fikk ${totalPrizeCents}`);
  }
  if (!Number.isInteger(winnerCount) || winnerCount < 1) {
    throw new Error(`winnerCount må være ≥ 1, fikk ${winnerCount}`);
  }
  const prizePerWinnerCents = Math.floor(totalPrizeCents / winnerCount);
  const houseRetainedCents = totalPrizeCents - winnerCount * prizePerWinnerCents;
  return { prizePerWinnerCents, houseRetainedCents };
}

test("invariant: split-rounding aritmetikk holder for alle (prize, count)", async () => {
  await fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.integer({ min: 1, max: 100 }),
      (totalPrizeCents, winnerCount) => {
        const { prizePerWinnerCents, houseRetainedCents } = splitPrize(totalPrizeCents, winnerCount);

        // Property 1: hver winner får floor(total / count).
        assert.equal(
          prizePerWinnerCents,
          Math.floor(totalPrizeCents / winnerCount),
          "prizePerWinner skal være floor(total / count)",
        );

        // Property 2: sum(splits) ≤ totalPrize.
        const sumOfSplits = winnerCount * prizePerWinnerCents;
        assert.ok(
          sumOfSplits <= totalPrizeCents,
          `sum(splits)=${sumOfSplits} skal være ≤ totalPrize=${totalPrizeCents}`,
        );

        // Property 3: houseRetained ∈ [0, winnerCount).
        assert.ok(
          houseRetainedCents >= 0 && houseRetainedCents < winnerCount,
          `houseRetained=${houseRetainedCents} skal være i [0, ${winnerCount})`,
        );

        // Property 4: sum(splits) + houseRest = totalPrize EKSAKT.
        assert.equal(
          sumOfSplits + houseRetainedCents,
          totalPrizeCents,
          "sum(splits) + houseRetained skal være = totalPrize",
        );
      },
    ),
    { numRuns: 200 },
  );
});

test("invariant: split-rounding eksakt deling (totalPrize % count == 0) → houseRetained = 0", () => {
  // Kontroll: når totalPrize er deletbar uten rest, skal hus aldri beholde noe.
  const cases = [
    { total: 10_000, count: 2 }, // 100 kr × 2 = 50 kr hver, rest 0
    { total: 30_000, count: 3 }, // 300 kr × 3 = 100 kr hver, rest 0
    { total: 1_000, count: 5 }, // 10 kr × 5 = 2 kr hver, rest 0
  ];
  for (const c of cases) {
    const { prizePerWinnerCents, houseRetainedCents } = splitPrize(c.total, c.count);
    assert.equal(houseRetainedCents, 0, `count=${c.count}, total=${c.total}: rest = 0`);
    assert.equal(prizePerWinnerCents * c.count, c.total);
  }
});

test("invariant: 1700 kr / 3 vinnere → 566 kr hver + 2 øre rest", () => {
  // Konkret eksempel fra Norsk Bingo Fullt Hus (1000 kr) hvis 3 vant samtidig:
  // floor(100000 / 3) = 33333 cents = 333.33 kr; 100000 - 99999 = 1 cent rest.
  const { prizePerWinnerCents, houseRetainedCents } = splitPrize(100_000, 3);
  assert.equal(prizePerWinnerCents, 33_333, "333.33 kr per vinner");
  assert.equal(houseRetainedCents, 1, "1 øre rest til hus");
  assert.equal(prizePerWinnerCents * 3 + houseRetainedCents, 100_000);

  // Variant: 170_000 cents (1700 kr) / 3 = 56_666 cents/winner + 2 cents rest.
  const r2 = splitPrize(170_000, 3);
  assert.equal(r2.prizePerWinnerCents, 56_666, "566.66 kr per vinner");
  assert.equal(r2.houseRetainedCents, 2, "2 øre rest til hus");
});

test("invariant: 1 vinner får hele totalPrize (ingen rest)", async () => {
  await fc.assert(
    fc.property(fc.integer({ min: 0, max: 10_000_000 }), (totalPrizeCents) => {
      const { prizePerWinnerCents, houseRetainedCents } = splitPrize(totalPrizeCents, 1);
      assert.equal(prizePerWinnerCents, totalPrizeCents, "1 vinner = hele potten");
      assert.equal(houseRetainedCents, 0, "ingen rest med 1 vinner");
    }),
    { numRuns: 50 },
  );
});

test("invariant: splitPrize avviser ugyldige inputs", () => {
  assert.throws(() => splitPrize(-1, 1), /ikke-negativt/);
  assert.throws(() => splitPrize(100, 0), /≥ 1/);
  assert.throws(() => splitPrize(100, -1), /≥ 1/);
  assert.throws(() => splitPrize(1.5, 1), /heltall/);
});
