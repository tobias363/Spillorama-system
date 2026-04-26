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
 *   - Cap-en er identisk for MAIN_GAME og DATABINGO i dagens policy
 *     (PrizeGameType åpnes i egen task — bare slug-binding er K2-A scope).
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
