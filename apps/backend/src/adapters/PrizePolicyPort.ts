/**
 * K2-A CRIT-3: PrizePolicyPort.
 *
 * Narrow port for å håndheve single-prize-cap (pengespillforskriften §11 —
 * maks 2500 kr per enkeltpremie) på Spill 1 payout-paths som tidligere
 * IKKE hadde cap (PotEvaluator, Game1LuckyBonusService, Game1MiniGameOrchestrator,
 * Game1DrawEngineService.payoutLuckyBonusForFullHouseWinners).
 *
 * Eksisterende cap-håndhevelse i `BingoEngine.submitClaim` (linje 1775-1779,
 * 1880-1884) bruker `prizePolicy.applySinglePrizeCap` direkte. Den nye
 * scheduled-game-pathen mangler dette — denne porten lukker det.
 *
 * Wires inn fra index.ts via `engine.getPrizePolicyPort()`. Tester kan
 * bruke `NoopPrizePolicyPort` (returnerer alltid wasCapped=false) eller
 * dedikert spy-mock.
 *
 * Regulatorisk:
 *   - Caller MÅ kalle `applySinglePrizeCap` FØR `walletAdapter.credit`.
 *   - Hvis `wasCapped=true` → audit-logg differansen (cappedAmount mindre
 *     enn input.amount) som "RTP_HOUSE_RETAINED" via PayoutAuditTrail
 *     eller dedikert log slik at huset's beholdte beløp er sporbart.
 *
 * **2026-05-08 (Tobias):** Cap-en gjelder KUN databingo
 * (`gameType = DATABINGO`, slug `spillorama`). Hovedspill (Spill 1-3)
 * får aldri cappet payouts via denne porten. Spill 1's port-wrapper
 * (`BingoEngine.getPrizePolicyPort()`) binder mot `MAIN_GAME` →
 * `PrizePolicyManager.applySinglePrizeCap` short-circuiter og
 * returnerer beløpet uendret. Innsatsen lilla Fullt Hus (3000 kr),
 * Oddsen lilla HIGH (4500 kr) og mini-game-payouts > 2500 kr utbetales
 * derfor i sin helhet. Kanonisk regel:
 * [`docs/architecture/SPILL_REGLER_OG_PAYOUT.md`](../../../docs/architecture/SPILL_REGLER_OG_PAYOUT.md) §4
 * og [`docs/operations/SPILL1_VINNINGSREGLER.md`](../../../docs/operations/SPILL1_VINNINGSREGLER.md) §4.
 */

export interface PrizePolicyApplyInput {
  /** Hall som payout-en kommer fra (for policy-resolve). */
  hallId: string;
  /** Beløp før cap (i kroner, ikke øre — matcher PrizePolicyManager-API). */
  amount: number;
  /** Tidspunkt for evalueringa (default Date.now()). */
  atMs?: number;
}

export interface PrizePolicyApplyResult {
  /** Beløp etter cap (≤ input.amount). */
  cappedAmount: number;
  /** true hvis cap-en faktisk reduserte beløpet (cappedAmount < amount). */
  wasCapped: boolean;
  /** Policy-id for sporbarhet i audit-log. */
  policyId: string;
}

export interface PrizePolicyPort {
  applySinglePrizeCap(input: PrizePolicyApplyInput): PrizePolicyApplyResult;
}

/**
 * Default no-op for tester og miljøer uten policy-config. Returnerer alltid
 * input uendret (wasCapped=false). MÅ ALDRI brukes i prod — index.ts skal
 * wire inn engine.getPrizePolicyPort().
 */
export class NoopPrizePolicyPort implements PrizePolicyPort {
  applySinglePrizeCap(input: PrizePolicyApplyInput): PrizePolicyApplyResult {
    return {
      cappedAmount: input.amount,
      wasCapped: false,
      policyId: "noop",
    };
  }
}
