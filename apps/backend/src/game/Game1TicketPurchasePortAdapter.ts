/**
 * GAME1_SCHEDULE PR 4a: adapter som kobler agent-POS-flytens
 * `TicketPurchasePort` til den nye `Game1TicketPurchaseService`.
 *
 * Agent-POS-path (BIN-583) kjenner kun `ticketCount` + `totalPriceCents`,
 * ikke fargekonfig. Adapteren mapper det til én enkelt ticketSpec-entry
 * med fiktiv farge 'agent_aggregate' og `size: 'small'`, slik at
 * service-validering passerer for Game 1 scheduled_games som aksepterer
 * agent-summarert kjøp.
 *
 * Merk: Game 1-spillere (digital_wallet) bruker service direkte (se
 * `game1Purchase`-router) og slipper dermed dette lurvete aggregatet.
 * Adapteren er kun et forenklet kompat-lag for agent-POS.
 *
 * Hvis scheduled_game.ticket_config_json ikke inneholder
 * 'agent_aggregate'/'small', kaster service INVALID_TICKET_SPEC. For
 * fullstendig farge-per-billett-agent-kjøp må klienten bygge selv
 * Game1TicketSpec og kalle servicen direkte.
 */

import { DomainError } from "./BingoEngine.js";
import type {
  DigitalTicketPurchaseInput,
  DigitalTicketPurchaseResult,
  TicketPurchasePort,
} from "../agent/ports/TicketPurchasePort.js";
import type {
  Game1PaymentMethod,
  Game1TicketPurchaseService,
} from "./Game1TicketPurchaseService.js";

export interface Game1TicketPurchasePortAdapterOptions {
  service: Game1TicketPurchaseService;
  /**
   * Hvilken payment-method skal agenten's register-ticket-flyt bokføres
   * som? `'cash_agent'` er default fordi POS-flyten primært er kontant.
   * Caller kan overstyre via input.paymentMethod hvis porten utvides.
   */
  defaultPaymentMethod?: Exclude<Game1PaymentMethod, "digital_wallet">;
  /**
   * Fiktiv ticket-color for aggregat-entry. Må eksistere i scheduled_game's
   * ticket_config_json for at validering skal passere. Default matcher
   * seed-konfigen fra BIN-698 test-fixtures.
   */
  aggregateColor?: string;
}

export class Game1TicketPurchasePortAdapter implements TicketPurchasePort {
  private readonly service: Game1TicketPurchaseService;
  private readonly defaultPaymentMethod: Exclude<
    Game1PaymentMethod,
    "digital_wallet"
  >;
  private readonly aggregateColor: string;

  constructor(options: Game1TicketPurchasePortAdapterOptions) {
    this.service = options.service;
    this.defaultPaymentMethod = options.defaultPaymentMethod ?? "cash_agent";
    this.aggregateColor = options.aggregateColor ?? "agent_aggregate";
  }

  async purchase(
    input: DigitalTicketPurchaseInput
  ): Promise<DigitalTicketPurchaseResult> {
    if (!input.hallId) {
      // Agent-POS-path må sende hallId (fra shift.hallId). Hvis ikke, har
      // vi ikke tilstrekkelig kontekst for hall-ready-check.
      throw new DomainError(
        "INVALID_INPUT",
        "hallId er påkrevd for agent-aggregert ticket-kjøp."
      );
    }
    if (input.ticketCount < 1 || !Number.isInteger(input.ticketCount)) {
      throw new DomainError(
        "INVALID_INPUT",
        "ticketCount må være positivt heltall."
      );
    }
    if (
      !Number.isInteger(input.totalPriceCents) ||
      input.totalPriceCents < 0
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "totalPriceCents må være ikke-negativt heltall."
      );
    }

    // Normaliser til én ticket-spec-entry. Dette krever at
    // scheduled_game.ticket_config_json har en matching (aggregateColor,
    // size: small)-entry med samme pris. Game 1-konfig for agent-
    // aggregert kjøp skal seedes sammen med den ordinære fargekonfigen.
    const priceCentsEach = Math.floor(
      input.totalPriceCents / input.ticketCount
    );
    if (priceCentsEach * input.ticketCount !== input.totalPriceCents) {
      throw new DomainError(
        "INVALID_INPUT",
        "totalPriceCents må være jevnt delelig på ticketCount for agent-aggregat."
      );
    }

    const result = await this.service.purchase({
      scheduledGameId: input.gameId,
      buyerUserId: input.playerUserId,
      hallId: input.hallId,
      ticketSpec: [
        {
          color: this.aggregateColor,
          size: "small",
          count: input.ticketCount,
          priceCentsEach,
        },
      ],
      paymentMethod: this.defaultPaymentMethod,
      agentUserId: input.requestedByAgentUserId,
      idempotencyKey: input.idempotencyKey,
    });

    // Vi har ikke per-billett-IDs fra service ennå (kommer når PR 4b
    // spawner individuelle ticket-rader fra purchase). Returnér én
    // syntetisk ID slik at kaller har noe å logge — AgentTransactionStore
    // bruker den i `otherData.ticketIds`.
    return {
      ticketIds: [result.purchaseId],
      actualPriceCents: result.totalAmountCents,
    };
  }
}
