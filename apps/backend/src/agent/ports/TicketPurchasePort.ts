/**
 * BIN-583 B3.2: contract for digital-ticket-purchase-on-behalf.
 *
 * Port brukes av agent-POS-flyten (AgentTransactionService.registerDigitalTicket)
 * og er forsettlig smal: agenten angir spill + billett-antall + total-pris
 * og porten returnerer ticket-IDs. I B3.2 var det en NOT_IMPLEMENTED-stub.
 *
 * GAME1_SCHEDULE PR 4a: porten wires nå til `Game1TicketPurchaseService`
 * via `Game1TicketPurchasePortAdapter` (se `apps/backend/src/game/
 * Game1TicketPurchasePortAdapter.ts`). Adapteren mapper det smale
 * ticketCount+totalPriceCents-kontraktet over til service-kjernen sin
 * ticketSpec (ett fiktivt "mixed"-entry som representerer aggregert
 * kjøp via agent). Game 1-playerflyten bruker servicen direkte og
 * slipper dermed port-indirection.
 *
 * `NotImplementedTicketPurchasePort` beholdes som fallback for
 * dev/test-oppsett uten full backend-wiring (index.ts wirer adapter
 * i prod, eksisterende tester har allerede egne stubs).
 */

import { DomainError } from "../../game/BingoEngine.js";

export interface DigitalTicketPurchaseInput {
  playerUserId: string;
  gameId: string;
  ticketCount: number;
  totalPriceCents: number;
  requestedByAgentUserId: string;
  idempotencyKey: string;
  /**
   * GAME1_SCHEDULE PR 4a: hall-id for kjøpet. Valgfri i porten for
   * bakover-kompat; agent-POS-path fyller ut fra shift.hallId.
   */
  hallId?: string;
}

export interface DigitalTicketPurchaseResult {
  ticketIds: string[];
  actualPriceCents: number;
}

export interface TicketPurchasePort {
  purchase(input: DigitalTicketPurchaseInput): Promise<DigitalTicketPurchaseResult>;
}

/**
 * Stub som returnerer NOT_IMPLEMENTED. Brukes kun i dev/test-oppsett
 * uten full game1-wiring. Prod wiring i `index.ts` bruker
 * `Game1TicketPurchasePortAdapter`.
 */
export class NotImplementedTicketPurchasePort implements TicketPurchasePort {
  async purchase(_input: DigitalTicketPurchaseInput): Promise<DigitalTicketPurchaseResult> {
    void _input;
    throw new DomainError(
      "NOT_IMPLEMENTED",
      "Digital ticket-kjøp via agent krever at Game1TicketPurchaseService er wired inn (GAME1_SCHEDULE PR 4a)."
    );
  }
}
