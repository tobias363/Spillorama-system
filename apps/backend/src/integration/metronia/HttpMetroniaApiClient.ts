/**
 * BIN-583 B3.4: HTTP-implementasjon av MetroniaApiClient.
 *
 * Bruker Node `fetch` (ingen axios-dep). TLS-bypass kun når
 * tlsRejectUnauthorized=false (staging med self-signed cert) — aldri
 * silent default.
 *
 * Endepunkter mot Metronia (port av legacy machineApiController):
 *   POST /create-ticket     body: { amount, transaction }
 *   POST /upgrade-ticket    body: { room_id, ticket, amount, transaction }
 *   POST /close-ticket      body: { ticket, room_id, transaction }
 *   POST /status-ticket     body: { ticket, room_id }
 *
 * Headers: Authorization: Bearer <token>, Content-Type: application/json.
 */

import { Agent } from "undici";
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
import { logger as rootLogger } from "../../util/logger.js";

const logger = rootLogger.child({ module: "metronia-api-client" });

export interface HttpMetroniaApiClientOptions {
  baseUrl: string;
  apiToken: string;
  /** Default true. Sett false kun for staging med self-signed cert. */
  tlsRejectUnauthorized?: boolean;
  /** Default 10000 ms. */
  timeoutMs?: number;
}

/**
 * Metronia returnerer error-struktur som JSON med `error: number` og
 * `error_str: string`. error=0 betyr suksess.
 */
interface MetroniaApiResponse {
  error?: number;
  error_str?: string;
  // Felter på suksess varierer per endpoint:
  ticket?: string | number;
  ticket_id?: string;
  ticketId?: string;
  balance?: number;
  enabled?: boolean;
  terminal?: boolean;
}

export class HttpMetroniaApiClient implements MetroniaApiClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly insecureDispatcher: Agent | null;

  constructor(options: HttpMetroniaApiClientOptions) {
    if (!options.baseUrl.trim()) {
      throw new DomainError("INVALID_CONFIG", "METRONIA_API_URL er påkrevd.");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiToken = options.apiToken;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    // TLS-bypass kun når eksplisitt slått av — undici-Agent med
    // rejectUnauthorized: false. Ingen prosess-globalt påvirkning.
    if (options.tlsRejectUnauthorized === false) {
      this.insecureDispatcher = new Agent({
        connect: { rejectUnauthorized: false },
      });
      logger.warn("TLS rejectUnauthorized=false — kun for staging.");
    } else {
      this.insecureDispatcher = null;
    }
  }

  async createTicket(input: MetroniaCreateTicketInput): Promise<MetroniaCreateTicketResult> {
    const data = await this.post("/create-ticket", {
      amount: input.amountCents,
      transaction: input.uniqueTransaction,
    });
    const ticketNumber = String(data.ticket ?? "");
    const ticketId = String(data.ticket_id ?? data.ticketId ?? "");
    if (!ticketNumber || !ticketId) {
      throw new DomainError("METRONIA_BAD_RESPONSE", "Mangler ticket eller ticket_id i respons.");
    }
    return { ticketNumber, ticketId };
  }

  async topupTicket(input: MetroniaTopupInput): Promise<MetroniaTopupResult> {
    const data = await this.post("/upgrade-ticket", {
      room_id: input.roomId ?? null,
      ticket: input.ticketNumber,
      amount: input.amountCents,
      transaction: input.uniqueTransaction,
    });
    const balance = Number(data.balance ?? NaN);
    if (!Number.isFinite(balance)) {
      throw new DomainError("METRONIA_BAD_RESPONSE", "Mangler balance i topup-respons.");
    }
    return { newBalanceCents: balance };
  }

  async closeTicket(input: MetroniaCloseInput): Promise<MetroniaCloseResult> {
    const data = await this.post("/close-ticket", {
      ticket: input.ticketNumber,
      room_id: input.roomId ?? null,
      transaction: input.uniqueTransaction,
    });
    const balance = Number(data.balance ?? 0);
    if (!Number.isFinite(balance) || balance < 0) {
      throw new DomainError("METRONIA_BAD_RESPONSE", "Ugyldig balance i close-respons.");
    }
    return { finalBalanceCents: balance };
  }

  async getStatus(ticketNumber: string, roomId?: string | null): Promise<MetroniaStatusResult> {
    const data = await this.post("/status-ticket", {
      ticket: ticketNumber,
      room_id: roomId ?? null,
    });
    return {
      balanceCents: Number(data.balance ?? 0),
      ticketEnabled: Boolean(data.enabled),
      isReserved: Boolean(data.terminal),
    };
  }

  private async post(path: string, body: Record<string, unknown>): Promise<MetroniaApiResponse> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const fetchOptions: RequestInit & { dispatcher?: unknown } = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      };
      if (this.insecureDispatcher) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetchOptions.dispatcher = this.insecureDispatcher as any;
      }
      // Node fetch supports `dispatcher` via undici; TS RequestInit
      // doesn't expose it. Cast to satisfy compiler.
      const res = await fetch(url, fetchOptions as RequestInit);
      const json = (await res.json().catch(() => null)) as MetroniaApiResponse | null;
      if (!json || typeof json !== "object") {
        throw new DomainError("METRONIA_BAD_RESPONSE", `Tomt eller ugyldig svar fra ${path}.`);
      }
      if (typeof json.error === "number" && json.error !== 0) {
        throw new DomainError(
          "METRONIA_API_ERROR",
          `Metronia ${path} returnerte feil ${json.error}: ${json.error_str ?? "ukjent"}`
        );
      }
      if (!res.ok && (json.error === undefined || json.error !== 0)) {
        throw new DomainError(
          "METRONIA_API_ERROR",
          `Metronia ${path} HTTP ${res.status}.`
        );
      }
      return json;
    } catch (err) {
      if (err instanceof DomainError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new DomainError("METRONIA_TIMEOUT", `Metronia ${path} timeout etter ${this.timeoutMs} ms.`);
      }
      logger.error({ err, path }, "Metronia HTTP-kall feilet uventet");
      throw new DomainError("METRONIA_API_ERROR", `Metronia ${path} feilet.`);
    } finally {
      clearTimeout(timer);
    }
  }
}

