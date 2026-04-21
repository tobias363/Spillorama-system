/**
 * GAME1_SCHEDULE PR 5: LoyaltyPointsHookPort.
 *
 * Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §3
 * Brief: BIN-700 follow-up — automatisk points-award fra spill-aktivitet.
 *
 * BingoEngine kaller denne porten når en spiller enten:
 *   1) Betaler buy-in (ticket.purchase) — ved gameStart.
 *   2) Vinner en fase (game.win) — ved auto-claim-payout.
 *
 * Porten er valgfri (en hook). Engine bruker fire-and-forget — en feil
 * i loyalty-laget må ALDRI blokkere buy-in eller payout. LoyaltyService
 * har CHECK >= 0 på points som forhindrer negative deltas; porten skal
 * aldri kaste hvis upassende input passeres. Implementasjonen er
 * ansvarlig for å konvertere øre → points (business-regler).
 *
 * Hvorfor port + adapter (og ikke import { LoyaltyService }):
 *   - BingoEngine er engine-core uten avhengighet til DB-services.
 *     Tests av engine må kunne kjøre uten Postgres-pool.
 *   - LoyaltyService lever i compliance-laget; en direkte import ville
 *     skape sirkulær avhengighet ettersom LoyaltyService importerer
 *     `DomainError` fra BingoEngine.
 *   - Fire-and-forget-semantikken blir synlig i porten, ikke nedgravd
 *     i et prøve/fang i engine.
 */

export interface LoyaltyTicketPurchaseHook {
  kind: "ticket.purchase";
  userId: string;
  /** Buy-in-beløp i kroner (ikke øre). Engine bruker kroner. */
  amount: number;
  /** Antall brett kjøpt i denne buy-in-transaksjonen. */
  ticketCount: number;
  /** Rom-kode + spill-id for audit-sporing. */
  roomCode: string;
  gameId: string;
  hallId: string;
  gameSlug: string;
}

export interface LoyaltyGameWinHook {
  kind: "game.win";
  userId: string;
  /** Payout-beløp i kroner (etter split + RTP-cap). */
  amount: number;
  /** Fase-navn ("1 Rad", "Fullt Hus", etc). */
  patternName: string;
  roomCode: string;
  gameId: string;
  hallId: string;
}

export type LoyaltyHookInput = LoyaltyTicketPurchaseHook | LoyaltyGameWinHook;

/**
 * Fire-and-forget. Implementasjonen MÅ ikke kaste. Engine logger advarsel
 * hvis porten kaster, men fortsetter flyten uten å rulle tilbake spill-
 * state.
 */
export interface LoyaltyPointsHookPort {
  onLoyaltyEvent(input: LoyaltyHookInput): Promise<void>;
}

/**
 * Default no-op implementasjon — brukes i tests og i miljø uten loyalty-
 * integrasjon. Sikrer at engine aldri trenger optional-chaining rundt
 * hook-kall.
 */
export class NoopLoyaltyPointsHookPort implements LoyaltyPointsHookPort {
  async onLoyaltyEvent(_input: LoyaltyHookInput): Promise<void> {
    /* no-op */
  }
}
