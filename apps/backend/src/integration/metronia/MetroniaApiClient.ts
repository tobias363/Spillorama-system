/**
 * BIN-583 B3.4: Metronia API-klient — interface + factory.
 *
 * Real-impl bruker fetch (HttpMetroniaApiClient). Tester injecterer
 * StubMetroniaApiClient. Wirefil i index.ts default-er til Stub når
 * METRONIA_API_URL mangler — gjør lokal-dev funksjonell uten ekte API.
 *
 * Beløp i cents (Metronia regner i øre).
 *
 * Idempotency: caller styrer uniqueTransaction. Metronia bruker dette
 * for å garantere "én logisk operasjon" på sin side.
 */

export interface MetroniaCreateTicketInput {
  amountCents: number;
  uniqueTransaction: string;
}

export interface MetroniaCreateTicketResult {
  ticketNumber: string;
  ticketId: string;
}

export interface MetroniaTopupInput {
  ticketNumber: string;
  amountCents: number;
  uniqueTransaction: string;
  /** OK Bingo bruker room_id; for Metronia kan settes om Metronia har det. */
  roomId?: string | null;
}

export interface MetroniaTopupResult {
  newBalanceCents: number;
}

export interface MetroniaCloseInput {
  ticketNumber: string;
  uniqueTransaction: string;
  roomId?: string | null;
}

export interface MetroniaCloseResult {
  finalBalanceCents: number;
}

export interface MetroniaStatusResult {
  balanceCents: number;
  ticketEnabled: boolean;
  isReserved: boolean;
}

export interface MetroniaApiClient {
  createTicket(input: MetroniaCreateTicketInput): Promise<MetroniaCreateTicketResult>;
  topupTicket(input: MetroniaTopupInput): Promise<MetroniaTopupResult>;
  closeTicket(input: MetroniaCloseInput): Promise<MetroniaCloseResult>;
  getStatus(ticketNumber: string, roomId?: string | null): Promise<MetroniaStatusResult>;
}
