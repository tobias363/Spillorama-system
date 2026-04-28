/**
 * Unified pipeline refactor — Fase 0 (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.4).
 *
 * Narrow port for å generere DETERMINISTISKE idempotency-keys for
 * `WalletPort`, `CompliancePort` og `AgentTransactionService`-flyter.
 *
 * Bug-bakgrunn (PILOT-STOP-SHIP 2026-04-28):
 *   - Compliance-ledger-bug fra 12+ steder skyldes at hver call-site
 *     genererte sin egen key med ulike formater (#675-bug-mønster).
 *   - Agent-transactions hadde tilsvarende bug der retry duplisert cash-
 *     ops fordi `clientRequestId` ikke var inkludert i unique-key
 *     (migrations/20261120000000_agent_transactions_idempotency.sql).
 *   - Ticket-arm hadde race der to samtidige bet:arm-events fra samme
 *     spiller kunne ende opp med to wallet-reservasjoner i samme rom.
 *
 * Med denne porten flyttes ALLE keyformat-decisions til én sentral plass.
 * Når et nytt format trengs (e.g. dynamisk `armCycleId`), endres porten
 * og alle call-sites bruker den oppdaterte logikken automatisk.
 *
 * Format-konvensjoner:
 *   - Komponenter separeres med `:` (matcher
 *     `makeComplianceLedgerIdempotencyKey` i `ComplianceLedger.ts`).
 *   - `null` / `undefined` blir til `"no-<field>"` så keyen alltid er
 *     en streng (UNIQUE-constraint avviser NULL).
 *   - Ingen randomness — alle inputs er deterministiske.
 *
 * Implementasjoner:
 * - `DefaultIdempotencyKeyPort` (Fase 0) — eneste implementasjon. Pure
 *   strenghasking, ingen state. Tester importerer denne direkte.
 */

export interface IdempotencyKeyPort {
  /**
   * Key for wallet-reservasjon på bet:arm.
   *
   * `armCycleId` skiller distinkte arm-cycler i samme runde (en spiller
   * kan re-arm med flere bonger i samme rom — hver cycle har egen key).
   * `totalWeighted` er summen av alle bongers vekt for denne cyclen og
   * tjener som "version" — hvis spilleren legger til bonger uten å lukke
   * cyclen, øker `totalWeighted` og keyen endres → ny reservation.
   */
  forArm(
    roomCode: string,
    playerId: string,
    armCycleId: string,
    totalWeighted: number,
  ): string;

  /**
   * Key for payout-credit ved phase-vinst.
   *
   * `phaseId` er en stabil id pr (game, phase) — typisk
   * `${gameId}:phase-${phase}` eller `${gameId}:pattern-${patternId}`.
   * Re-payout pga retry skal treffe samme key.
   */
  forPayout(gameId: string, phaseId: string, playerId: string): string;

  /**
   * Key for agent cash-op (cash-in / cash-out).
   *
   * `clientRequestId` settes av POS-klienten og er den eksterne
   * idempotency-anker. Kombinert med agent + spiller blir den unik
   * per (agent, spiller, request) — samme klient kan re-poste uten
   * å skape duplikat-tx.
   */
  forCashOp(agentUserId: string, playerUserId: string, clientRequestId: string): string;

  /**
   * Key for compliance-ledger-event.
   *
   * Format matcher `makeComplianceLedgerIdempotencyKey` i
   * `ComplianceLedger.ts`:
   *   `${eventType}:${gameId ?? "no-game"}:${claimId ?? playerId ?? "no-actor"}`
   *
   * Brukes både av STAKE (purchase) og PRIZE (payout). Hvis call-site
   * trenger ekstra discriminator (e.g. `houseRetained` per phase),
   * legg til separat sub-key — denne porten dekker den vanlige flyten.
   */
  forCompliance(
    eventType: string,
    gameId: string | null,
    claimId: string | null,
    playerId: string | null,
  ): string;
}

/**
 * Default-implementasjonen. Pure-funksjons-sammensetning av strings —
 * ingen state, kan deles trygt mellom requests/threads.
 */
export class DefaultIdempotencyKeyPort implements IdempotencyKeyPort {
  forArm(
    roomCode: string,
    playerId: string,
    armCycleId: string,
    totalWeighted: number,
  ): string {
    return `arm:${roomCode}:${playerId}:${armCycleId}:${totalWeighted}`;
  }

  forPayout(gameId: string, phaseId: string, playerId: string): string {
    return `payout:${gameId}:${phaseId}:${playerId}`;
  }

  forCashOp(agentUserId: string, playerUserId: string, clientRequestId: string): string {
    return `cashop:${agentUserId}:${playerUserId}:${clientRequestId}`;
  }

  forCompliance(
    eventType: string,
    gameId: string | null,
    claimId: string | null,
    playerId: string | null,
  ): string {
    const game = gameId?.trim() || "no-game";
    const actor = claimId?.trim() || playerId?.trim() || "no-actor";
    return `${eventType}:${game}:${actor}`;
  }
}
