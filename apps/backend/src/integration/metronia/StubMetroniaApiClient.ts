/**
 * BIN-583 B3.4: in-memory MetroniaApiClient for tester + lokal-dev.
 *
 * Returnerer predictable suksess-respons. Test-utils kan stille opp
 * specific failures via setNextError().
 */

import { randomUUID } from "node:crypto";
import { DomainError } from "../../game/BingoEngine.js";
import type {
  MetroniaApiClient,
  MetroniaCreateTicketInput,
  MetroniaCreateTicketResult,
  MetroniaTopupInput,
  MetroniaTopupResult,
  MetroniaCloseInput,
  MetroniaCloseResult,
  MetroniaStatusResult,
} from "./MetroniaApiClient.js";

interface StubTicket {
  ticketNumber: string;
  ticketId: string;
  balanceCents: number;
  enabled: boolean;
}

export class StubMetroniaApiClient implements MetroniaApiClient {
  private readonly tickets = new Map<string, StubTicket>();
  private readonly txSeen = new Set<string>();
  private nextErrorCode: string | null = null;
  private nextErrorEndpoint: "create" | "topup" | "close" | "status" | "any" | null = null;
  /** Test-helper. */
  failOnce(endpoint: "create" | "topup" | "close" | "status" | "any", code: string): void {
    this.nextErrorEndpoint = endpoint;
    this.nextErrorCode = code;
  }

  private maybeFail(endpoint: "create" | "topup" | "close" | "status"): void {
    if (this.nextErrorCode && (this.nextErrorEndpoint === endpoint || this.nextErrorEndpoint === "any")) {
      const code = this.nextErrorCode;
      this.nextErrorCode = null;
      this.nextErrorEndpoint = null;
      throw new DomainError(code, `Stub Metronia error på ${endpoint}.`);
    }
  }

  async createTicket(input: MetroniaCreateTicketInput): Promise<MetroniaCreateTicketResult> {
    this.maybeFail("create");
    if (this.txSeen.has(input.uniqueTransaction)) {
      throw new DomainError("METRONIA_DUPLICATE_TX", `Transaction ${input.uniqueTransaction} allerede prosessert.`);
    }
    this.txSeen.add(input.uniqueTransaction);
    const ticketNumber = `M-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const ticketId = `mid-${randomUUID()}`;
    this.tickets.set(ticketNumber, {
      ticketNumber,
      ticketId,
      balanceCents: input.amountCents,
      enabled: true,
    });
    return { ticketNumber, ticketId };
  }

  async topupTicket(input: MetroniaTopupInput): Promise<MetroniaTopupResult> {
    this.maybeFail("topup");
    if (this.txSeen.has(input.uniqueTransaction)) {
      throw new DomainError("METRONIA_DUPLICATE_TX", `Transaction ${input.uniqueTransaction} allerede prosessert.`);
    }
    this.txSeen.add(input.uniqueTransaction);
    const t = this.tickets.get(input.ticketNumber);
    if (!t) throw new DomainError("METRONIA_TICKET_NOT_FOUND", "Ukjent ticket.");
    if (!t.enabled) throw new DomainError("METRONIA_TICKET_CLOSED", "Ticket er allerede lukket.");
    t.balanceCents += input.amountCents;
    return { newBalanceCents: t.balanceCents };
  }

  async closeTicket(input: MetroniaCloseInput): Promise<MetroniaCloseResult> {
    this.maybeFail("close");
    if (this.txSeen.has(input.uniqueTransaction)) {
      throw new DomainError("METRONIA_DUPLICATE_TX", `Transaction ${input.uniqueTransaction} allerede prosessert.`);
    }
    this.txSeen.add(input.uniqueTransaction);
    const t = this.tickets.get(input.ticketNumber);
    if (!t) throw new DomainError("METRONIA_TICKET_NOT_FOUND", "Ukjent ticket.");
    if (!t.enabled) throw new DomainError("METRONIA_TICKET_CLOSED", "Ticket er allerede lukket.");
    t.enabled = false;
    const finalBalance = t.balanceCents;
    return { finalBalanceCents: finalBalance };
  }

  async getStatus(ticketNumber: string): Promise<MetroniaStatusResult> {
    this.maybeFail("status");
    const t = this.tickets.get(ticketNumber);
    if (!t) throw new DomainError("METRONIA_TICKET_NOT_FOUND", "Ukjent ticket.");
    return {
      balanceCents: t.balanceCents,
      ticketEnabled: t.enabled,
      isReserved: false,
    };
  }

  /** Test-helper: simuler at spilleren har spilt (justerer balance). */
  setBalance(ticketNumber: string, balanceCents: number): void {
    const t = this.tickets.get(ticketNumber);
    if (t) t.balanceCents = balanceCents;
  }
}
