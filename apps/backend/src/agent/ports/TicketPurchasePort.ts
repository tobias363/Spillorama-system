/**
 * BIN-583 B3.2: contract for digital-ticket-purchase-on-behalf.
 *
 * Real implementation kommer fra game-service (BuyTicketService eller
 * tilsvarende) når G2/G3-flyten portes fra Unity til web-native. I
 * B3.2 er stub'en en eksplisitt NOT_IMPLEMENTED slik at endepunktet
 * kan registreres, RBAC valideres, men selve billett-generering
 * blokkeres med klar feilmelding.
 *
 * TODO (BIN-608): implementer real TicketPurchasePort når G2/G3 er
 * portet og eksponerer buyTicketForPlayer-API.
 */

import { DomainError } from "../../game/BingoEngine.js";

export interface DigitalTicketPurchaseInput {
  playerUserId: string;
  gameId: string;
  ticketCount: number;
  totalPriceCents: number;
  requestedByAgentUserId: string;
  idempotencyKey: string;
}

export interface DigitalTicketPurchaseResult {
  ticketIds: string[];
  actualPriceCents: number;
}

export interface TicketPurchasePort {
  purchase(input: DigitalTicketPurchaseInput): Promise<DigitalTicketPurchaseResult>;
}

/**
 * Stub som returnerer NOT_IMPLEMENTED. Bruket i B3.2 til å registrere
 * endepunktet funksjonelt (RBAC, audit-log, input-validering kjører),
 * men selve ticket-genereringen er blokkert til G2/G3-web-native-port
 * er ferdig. Reviewer ser tydelig at feature er i progress.
 */
export class NotImplementedTicketPurchasePort implements TicketPurchasePort {
  async purchase(_input: DigitalTicketPurchaseInput): Promise<DigitalTicketPurchaseResult> {
    void _input;
    throw new DomainError(
      "NOT_IMPLEMENTED",
      "Digital ticket-kjøp via agent er ennå ikke implementert — kommer når G2/G3 er web-native-portet (BIN-608)."
    );
  }
}
