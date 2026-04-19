/**
 * BIN-583 B3.5: SQL Server polling-impl av OkBingoApiClient.
 *
 * Port av legacy machineApiController.createOkBingoAPI (linjer 599-730).
 * OK Bingo-maskinen kommuniserer ikke via REST, men via en delt
 * `COM3`-tabell på SQL Server der vi:
 *   1. INSERT-er en kommando-rad med ComandID + semicolon-separert
 *      Parameter-felt
 *   2. Poller samme tabell for response-rad (matchende ComID-referanse
 *      + ComandID + 100)
 *   3. Parser respons fra Parameter-feltet
 *
 * ComandID-mapping:
 *   1 = create-ticket  (Parameter: "transaction;;amount;print")
 *   2 = topup           (Parameter: "transaction;ticket;amount;print")
 *   3 = close-ticket    (Parameter: "transaction;ticket")
 *   5 = status-ticket   (Parameter: "transaction;ticket")
 *  11 = open-day        (Parameter: "NULL")
 *
 * Response-format (semicolon-separert i Parameter-feltet):
 *   "comId;ticketNumber;balance;newBalance;expiryDate;errorNumber;errorDescription"
 *
 * Forutsetter at OKBINGO_SQL_CONNECTION er en gyldig connection-string.
 * Wirefil i index.ts faller tilbake til StubOkBingoApiClient når env
 * mangler (lokal-dev/CI).
 */

import sql from "mssql";
import { DomainError } from "../../game/BingoEngine.js";
import { logger as rootLogger } from "../../util/logger.js";
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

const logger = rootLogger.child({ module: "okbingo-sql-client" });

const COMMAND_CREATE = 1;
const COMMAND_TOPUP = 2;
const COMMAND_CLOSE = 3;
const COMMAND_STATUS = 5;
const COMMAND_OPEN_DAY = 11;

/** Response-ComandID-offset — OK Bingo svarer med (request-ComandID + 100). */
const RESPONSE_OFFSET = 100;

const FROM_SYSTEM_ID_REQUEST = 0;
const TO_SYSTEM_ID_REQUEST = 1;
const FROM_SYSTEM_ID_RESPONSE = 1;
const TO_SYSTEM_ID_RESPONSE = 0;

export interface SqlServerOkBingoApiClientOptions {
  connectionString: string;
  /** Default 247. */
  defaultBingoId?: number;
  /** Default 1000 ms. */
  pollIntervalMs?: number;
  /** Default 10. */
  pollMaxAttempts?: number;
  /** Connection-pool max — default 10. */
  poolMax?: number;
}

interface ResponseParts {
  comId: string;
  ticketNumber: string;
  balanceStr: string;
  newBalanceStr: string;
  expiryDate: string;
  errorNumber: number;
  errorDescription: string;
}

export class SqlServerOkBingoApiClient implements OkBingoApiClient {
  private readonly connectionString: string;
  private readonly defaultBingoId: number;
  private readonly pollIntervalMs: number;
  private readonly pollMaxAttempts: number;
  private readonly poolMax: number;
  private poolPromise: Promise<sql.ConnectionPool> | null = null;

  constructor(options: SqlServerOkBingoApiClientOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError("INVALID_CONFIG", "OKBINGO_SQL_CONNECTION er påkrevd.");
    }
    this.connectionString = options.connectionString;
    this.defaultBingoId = options.defaultBingoId ?? 247;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.pollMaxAttempts = options.pollMaxAttempts ?? 10;
    this.poolMax = options.poolMax ?? 10;
  }

  private async getPool(): Promise<sql.ConnectionPool> {
    if (!this.poolPromise) {
      this.poolPromise = (async () => {
        const pool = new sql.ConnectionPool({
          // mssql aksepterer både connection-string-form og config-objekt;
          // vi forutsetter at brukeren passer riktig format.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ connectionString: this.connectionString } as any),
          pool: { max: this.poolMax },
        });
        await pool.connect();
        return pool;
      })();
    }
    return this.poolPromise;
  }

  async createTicket(input: OkBingoCreateTicketInput): Promise<OkBingoCreateTicketResult> {
    const bingoId = input.roomId || this.defaultBingoId;
    const print = 0;
    const parameter = `${input.uniqueTransaction};;${input.amountCents};${print}`;
    const response = await this.sendAndPoll(bingoId, COMMAND_CREATE, parameter);
    return {
      ticketNumber: response.ticketNumber,
      ticketId: response.ticketNumber,
      roomId: bingoId,
    };
  }

  async topupTicket(input: OkBingoTopupInput): Promise<OkBingoTopupResult> {
    const bingoId = input.roomId || this.defaultBingoId;
    const print = 0;
    const parameter = `${input.uniqueTransaction};${input.ticketNumber};${input.amountCents};${print}`;
    const response = await this.sendAndPoll(bingoId, COMMAND_TOPUP, parameter);
    // Legacy mapper newBalance fra parts[3] (multiplisert med 100 i caller)
    return { newBalanceCents: parseBalance(response.newBalanceStr) };
  }

  async closeTicket(input: OkBingoCloseInput): Promise<OkBingoCloseResult> {
    const bingoId = input.roomId || this.defaultBingoId;
    const parameter = `${input.uniqueTransaction};${input.ticketNumber}`;
    const response = await this.sendAndPoll(bingoId, COMMAND_CLOSE, parameter);
    // Legacy: ved close henter balanceStr (parts[2]) som final-balance.
    return { finalBalanceCents: parseBalance(response.balanceStr) };
  }

  async getStatus(ticketNumber: string, roomId: number): Promise<OkBingoStatusResult> {
    const bingoId = roomId || this.defaultBingoId;
    // Status bruker uniqueTransaction = ticketNumber-basert (legacy bruker
    // tx-feltet som correlation; her gir vi en deterministic verdi).
    const parameter = `status-${ticketNumber}-${Date.now()};${ticketNumber}`;
    const response = await this.sendAndPoll(bingoId, COMMAND_STATUS, parameter);
    return {
      balanceCents: parseBalance(response.balanceStr),
      ticketEnabled: response.errorNumber === 0,
    };
  }

  async openDay(roomId: number): Promise<{ opened: true }> {
    const bingoId = roomId || this.defaultBingoId;
    await this.sendAndPoll(bingoId, COMMAND_OPEN_DAY, "NULL");
    return { opened: true };
  }

  /** Cleanup brukt ved test-shutdown. Wirefil kaller ikke dette i produksjon. */
  async close(): Promise<void> {
    if (this.poolPromise) {
      const pool = await this.poolPromise;
      await pool.close();
      this.poolPromise = null;
    }
  }

  // ── Core RPC ────────────────────────────────────────────────────────────

  private async sendAndPoll(bingoId: number, commandId: number, parameter: string): Promise<ResponseParts> {
    const pool = await this.getPool();
    if (!pool.connected) {
      throw new DomainError("OKBINGO_DB_DOWN", "OK Bingo SQL Server er ikke tilgjengelig.");
    }

    // 1. INSERT request-rad i COM3
    const inserted = await pool.request()
      .input("BingoID", sql.Int, bingoId)
      .input("FromSystemID", sql.Int, FROM_SYSTEM_ID_REQUEST)
      .input("ToSystemID", sql.Int, TO_SYSTEM_ID_REQUEST)
      .input("ComandID", sql.Int, commandId)
      .input("Parameter", sql.VarChar, parameter)
      .query<{ ComID: number; Parameter: string }>(`
        INSERT INTO COM3 (BingoID, FromSystemID, ToSystemID, ComandID, Parameter)
        OUTPUT INSERTED.*
        VALUES (@BingoID, @FromSystemID, @ToSystemID, @ComandID, @Parameter)
      `);

    const insertedRecord = inserted.recordset[0];
    if (!insertedRecord) {
      throw new DomainError("OKBINGO_INSERT_FAILED", "Klarte ikke skrive request til COM3.");
    }

    // 2. Poll for response-rad
    const responseRow = await this.pollForResponse(
      pool,
      insertedRecord.ComID,
      bingoId,
      commandId
    );

    if (!responseRow) {
      throw new DomainError(
        "OKBINGO_TIMEOUT",
        `OK Bingo ComandID=${commandId} svarte ikke innen ${this.pollIntervalMs * this.pollMaxAttempts} ms.`
      );
    }

    const parts = parseParameter(responseRow.Parameter);
    if (parts.comId !== String(insertedRecord.ComID)) {
      throw new DomainError("OKBINGO_BAD_RESPONSE", "Response-correlation feilet.");
    }
    if (parts.errorNumber !== 0) {
      throw new DomainError(
        "OKBINGO_API_ERROR",
        `OK Bingo error ${parts.errorNumber}: ${parts.errorDescription || "ukjent"}`
      );
    }
    return parts;
  }

  private async pollForResponse(
    pool: sql.ConnectionPool,
    requestComId: number,
    bingoId: number,
    commandId: number,
  ): Promise<{ Parameter: string } | null> {
    const responseCommandId = commandId + RESPONSE_OFFSET;
    for (let attempt = 0; attempt < this.pollMaxAttempts; attempt++) {
      const result = await pool.request()
        .input("ComID", sql.Int, requestComId)
        .input("BingoID", sql.Int, bingoId)
        .input("FromSystemID", sql.Int, FROM_SYSTEM_ID_RESPONSE)
        .input("ToSystemID", sql.Int, TO_SYSTEM_ID_RESPONSE)
        .input("ComandID", sql.Int, responseCommandId)
        .input("Parameter", sql.VarChar, `%${requestComId}%`)
        .query<{ Parameter: string }>(`
          SELECT TOP 1 Parameter FROM COM3
          WHERE ComID > @ComID
            AND BingoID = @BingoID
            AND FromSystemID = @FromSystemID
            AND ToSystemID = @ToSystemID
            AND ComandID = @ComandID
            AND Parameter LIKE @Parameter
        `);
      const row = result.recordset[0];
      if (row) return row;
      if (attempt < this.pollMaxAttempts - 1) {
        await sleep(this.pollIntervalMs);
      }
    }
    logger.warn({ requestComId, commandId, bingoId }, "OK Bingo polling timeout");
    return null;
  }
}

function parseParameter(parameter: string): ResponseParts {
  const parts = parameter.split(";");
  const errorNumberRaw = parts[5];
  const errorNumber = errorNumberRaw ? Number.parseInt(errorNumberRaw, 10) : 0;
  return {
    comId: parts[0] ?? "",
    ticketNumber: parts[1] ?? "",
    balanceStr: parts[2] ?? "0",
    newBalanceStr: parts[3] ?? "0",
    expiryDate: parts[4] ?? "",
    errorNumber: Number.isFinite(errorNumber) ? errorNumber : 0,
    errorDescription: parts[6] ?? "",
  };
}

function parseBalance(value: string): number {
  // Legacy multipliserer med 100 — så vi får cents fra heltall-NOK.
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
