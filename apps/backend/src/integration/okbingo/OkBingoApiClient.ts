/**
 * BIN-583 B3.5: OK Bingo API-klient — interface + factory.
 *
 * Real-impl (SqlServerOkBingoApiClient) bruker SQL Server polling-RPC
 * (COM3-tabell) — port av legacy machineApiController.createOkBingoAPI.
 * StubOkBingoApiClient er default i tester + lokal-dev (uten SQL
 * Server-tilkobling).
 *
 * Beløp i cents (Metronia-konvensjon — alle machine-integrasjoner
 * regner i cents på API-grensen).
 *
 * roomId er bingo-room-hardware-ID. Default i legacy = 247.
 */

export interface OkBingoCreateTicketInput {
  amountCents: number;
  roomId: number;
  uniqueTransaction: string;
}

export interface OkBingoCreateTicketResult {
  ticketNumber: string;
  ticketId: string;
  roomId: number;
}

export interface OkBingoTopupInput {
  ticketNumber: string;
  amountCents: number;
  roomId: number;
  uniqueTransaction: string;
}

export interface OkBingoTopupResult {
  newBalanceCents: number;
}

export interface OkBingoCloseInput {
  ticketNumber: string;
  roomId: number;
  uniqueTransaction: string;
}

export interface OkBingoCloseResult {
  finalBalanceCents: number;
}

export interface OkBingoStatusResult {
  balanceCents: number;
  ticketEnabled: boolean;
}

export interface OkBingoApiClient {
  createTicket(input: OkBingoCreateTicketInput): Promise<OkBingoCreateTicketResult>;
  topupTicket(input: OkBingoTopupInput): Promise<OkBingoTopupResult>;
  closeTicket(input: OkBingoCloseInput): Promise<OkBingoCloseResult>;
  getStatus(ticketNumber: string, roomId: number): Promise<OkBingoStatusResult>;
  /** OK-Bingo-spesifikt: signal at maskinen skal åpnes for dagen. */
  openDay(roomId: number): Promise<{ opened: true }>;
}
