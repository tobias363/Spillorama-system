/**
 * BIN-583 B3.5: in-memory OkBingoApiClient for tester + lokal-dev.
 *
 * Returnerer predictable suksess-respons. Test-utils kan stille opp
 * specific failures via failOnce(). Speiler StubMetroniaApiClient.
 */

import { randomUUID } from "node:crypto";
import { DomainError } from "../../game/BingoEngine.js";
import type {
  OkBingoApiClient,
  OkBingoCreateTicketInput,
  OkBingoCreateTicketResult,
  OkBingoTopupInput,
  OkBingoTopupResult,
  OkBingoCloseInput,
  OkBingoCloseResult,
  OkBingoStatusResult,
} from "./OkBingoApiClient.js";

interface StubTicket {
  ticketNumber: string;
  ticketId: string;
  roomId: number;
  balanceCents: number;
  enabled: boolean;
}

type FailEndpoint = "create" | "topup" | "close" | "status" | "openDay" | "any";

export class StubOkBingoApiClient implements OkBingoApiClient {
  private readonly tickets = new Map<string, StubTicket>();
  private readonly txSeen = new Set<string>();
  private readonly daysOpened = new Set<number>();
  private nextErrorCode: string | null = null;
  private nextErrorEndpoint: FailEndpoint | null = null;

  /** Test-helper. */
  failOnce(endpoint: FailEndpoint, code: string): void {
    this.nextErrorEndpoint = endpoint;
    this.nextErrorCode = code;
  }

  /** Test-helper: simuler at spilleren har spilt. */
  setBalance(ticketNumber: string, balanceCents: number): void {
    const t = this.tickets.get(ticketNumber);
    if (t) t.balanceCents = balanceCents;
  }

  private maybeFail(endpoint: Exclude<FailEndpoint, "any">): void {
    if (this.nextErrorCode && (this.nextErrorEndpoint === endpoint || this.nextErrorEndpoint === "any")) {
      const code = this.nextErrorCode;
      this.nextErrorCode = null;
      this.nextErrorEndpoint = null;
      throw new DomainError(code, `Stub OK Bingo error på ${endpoint}.`);
    }
  }

  async createTicket(input: OkBingoCreateTicketInput): Promise<OkBingoCreateTicketResult> {
    this.maybeFail("create");
    if (this.txSeen.has(input.uniqueTransaction)) {
      throw new DomainError("OKBINGO_DUPLICATE_TX", `Transaction ${input.uniqueTransaction} allerede prosessert.`);
    }
    this.txSeen.add(input.uniqueTransaction);
    const ticketNumber = `OK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const ticketId = `okid-${randomUUID()}`;
    this.tickets.set(ticketNumber, {
      ticketNumber,
      ticketId,
      roomId: input.roomId,
      balanceCents: input.amountCents,
      enabled: true,
    });
    return { ticketNumber, ticketId, roomId: input.roomId };
  }

  async topupTicket(input: OkBingoTopupInput): Promise<OkBingoTopupResult> {
    this.maybeFail("topup");
    if (this.txSeen.has(input.uniqueTransaction)) {
      throw new DomainError("OKBINGO_DUPLICATE_TX", `Transaction ${input.uniqueTransaction} allerede prosessert.`);
    }
    this.txSeen.add(input.uniqueTransaction);
    const t = this.tickets.get(input.ticketNumber);
    if (!t) throw new DomainError("OKBINGO_TICKET_NOT_FOUND", "Ukjent ticket.");
    if (!t.enabled) throw new DomainError("OKBINGO_TICKET_CLOSED", "Ticket er lukket.");
    t.balanceCents += input.amountCents;
    return { newBalanceCents: t.balanceCents };
  }

  async closeTicket(input: OkBingoCloseInput): Promise<OkBingoCloseResult> {
    this.maybeFail("close");
    if (this.txSeen.has(input.uniqueTransaction)) {
      throw new DomainError("OKBINGO_DUPLICATE_TX", `Transaction ${input.uniqueTransaction} allerede prosessert.`);
    }
    this.txSeen.add(input.uniqueTransaction);
    const t = this.tickets.get(input.ticketNumber);
    if (!t) throw new DomainError("OKBINGO_TICKET_NOT_FOUND", "Ukjent ticket.");
    if (!t.enabled) throw new DomainError("OKBINGO_TICKET_CLOSED", "Ticket er lukket.");
    t.enabled = false;
    return { finalBalanceCents: t.balanceCents };
  }

  async getStatus(ticketNumber: string): Promise<OkBingoStatusResult> {
    this.maybeFail("status");
    const t = this.tickets.get(ticketNumber);
    if (!t) throw new DomainError("OKBINGO_TICKET_NOT_FOUND", "Ukjent ticket.");
    return { balanceCents: t.balanceCents, ticketEnabled: t.enabled };
  }

  async openDay(roomId: number): Promise<{ opened: true }> {
    this.maybeFail("openDay");
    this.daysOpened.add(roomId);
    return { opened: true };
  }

  /** Test-helper. */
  isDayOpened(roomId: number): boolean {
    return this.daysOpened.has(roomId);
  }
}
