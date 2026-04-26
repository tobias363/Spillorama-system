/**
 * WinningsCalculator — Game 1 "Gevinst:"-summering for aktiv runde.
 *
 * BIN-696 / Tobias 2026-04-26 — UI-Gevinst-faktisk-bug:
 *   Klient viste 1700 kr "Gevinst:" mens DB hadde kreditert 144 kr (1 Rad
 *   solo + 2 Rader splittet 5-veis). Bug-en var at den gamle `winnerId ===
 *   myPlayerId`-sjekken kun matchet FØRSTE vinner i en multi-winner-split,
 *   så 2.+ vinnere ble utelatt eller (i verste fall) summen falt tilbake
 *   til konfigurert phase-prize. Vi sjekker nå `winnerIds[]` (BIN-696)
 *   og summerer `payoutAmount` (per-winner split-beløp) for hver fase
 *   spilleren var med å vinne.
 *
 * Kontrakt med server (BingoEnginePatternEval / Game1DrawEngineService):
 *   - `result.payoutAmount` = `Math.floor(totalPhasePrize / winnerIds.length)`
 *     dvs. per-winner split-beløpet, IKKE total phase-prize.
 *   - `result.winnerIds[]` = alle som vant fasen på samme draw.
 *   - `result.winnerId` = første vinner (back-compat single-winner).
 *
 * Regulatorisk: KUN visningssummering — wallet-credit gjøres server-side
 * og er allerede committed når klienten ser disse verdiene.
 */

import type { PatternResult } from "@spillorama/shared-types/game";

/**
 * Sum opp innelste vinninger denne runden for `myPlayerId`.
 *
 * Returnerer 0 hvis `myPlayerId` er null (ikke joinet) eller hvis ingen
 * av de vunne fasene har spilleren som vinner.
 */
export function calculateMyRoundWinnings(
  patternResults: readonly PatternResult[],
  myPlayerId: string | null,
): number {
  if (!myPlayerId) return 0;

  return patternResults.reduce((sum, r) => {
    if (!r.isWon) return sum;
    // Multi-winner-detection (BIN-696): bruk `winnerIds[]` hvis satt;
    // ellers fall tilbake til [winnerId] for legacy-events.
    const winnerIds = r.winnerIds ?? (r.winnerId ? [r.winnerId] : []);
    if (!winnerIds.includes(myPlayerId)) return sum;
    return sum + (r.payoutAmount ?? 0);
  }, 0);
}
