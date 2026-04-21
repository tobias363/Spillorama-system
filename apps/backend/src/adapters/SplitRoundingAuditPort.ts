/**
 * GAME1_SCHEDULE PR 5: SplitRoundingAuditPort.
 *
 * Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3.7.
 *
 * BingoEngine kaller denne porten når multi-winner-splittingen av
 * fase-premien produserer en rest-øre som IKKE utbetales (house
 * rounding — `totalPhasePrize - winnerCount * floor(totalPhasePrize /
 * winnerCount)`).
 *
 * Formål: regulatorisk §11 — enhver uutbetalt rest må loggføres slik at
 * compliance kan rekonstruere hvor "manglende" øre havnet. I praksis
 * ruller resten tilbake i `remainingPrizePool` (reduseres ikke ved
 * utbetaling, bare trukket per winner) og kan dermed gå til en senere
 * fase. Audit-loggen dokumenterer at resten er hensyntatt og ikke
 * "forsvunnet".
 *
 * Porten er valgfri. Hvis ikke satt, bruker engine en intern no-op.
 * Fire-and-forget-semantikk: implementasjonen skal ikke kaste, og
 * engine fortsetter uavhengig av utfall.
 */

export interface SplitRoundingHouseRetainedEvent {
  /**
   * Rest-beløp i kroner (totalPhasePrize - winnerCount ×
   * prizePerWinner). Alltid > 0 når porten kalles.
   */
  amount: number;
  /** Antall vinnere som delte premien. */
  winnerCount: number;
  /** Total fase-premie før split (i kroner). */
  totalPhasePrize: number;
  /** Beløp per vinner etter Math.floor-split (i kroner). */
  prizePerWinner: number;
  /** Fase-navn for rapportering ("1 Rad", "Fullt Hus", etc). */
  patternName: string;
  /** Rom-kode + spill-id + hall for audit-sporing. */
  roomCode: string;
  gameId: string;
  hallId: string;
}

export interface SplitRoundingAuditPort {
  onSplitRoundingHouseRetained(
    event: SplitRoundingHouseRetainedEvent
  ): Promise<void>;
}

export class NoopSplitRoundingAuditPort implements SplitRoundingAuditPort {
  async onSplitRoundingHouseRetained(
    _event: SplitRoundingHouseRetainedEvent
  ): Promise<void> {
    /* no-op */
  }
}
