import { createHmac } from "node:crypto";
import type {
  GameResultWebhookPayload,
  GameResultDetails,
  ComplianceCallbackPayload,
  ComplianceEventType
} from "./types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface WebhookServiceOptions {
  /** URL to POST game-result webhooks to. */
  gameResultWebhookUrl: string;
  /** URL to POST compliance events to (can be same as game result URL). */
  complianceWebhookUrl?: string;
  /** HMAC-SHA256 shared secret for signing payloads. */
  webhookSecret: string;
  /** HTTP timeout in ms. Default 10000. */
  timeoutMs?: number;
  /** Max retry attempts on failure. Default 5. */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WebhookService {
  private readonly gameResultUrl: string;
  private readonly complianceUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  /** Delivery log for admin inspection. */
  private readonly deliveryLog: WebhookDeliveryRecord[] = [];
  private static readonly MAX_LOG_SIZE = 500;

  constructor(options: WebhookServiceOptions) {
    this.gameResultUrl = options.gameResultWebhookUrl;
    this.complianceUrl = options.complianceWebhookUrl ?? options.gameResultWebhookUrl;
    this.secret = options.webhookSecret;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 5;
  }

  // -----------------------------------------------------------------------
  // Game result webhook (BIN-34)
  // -----------------------------------------------------------------------

  /**
   * Send a game result webhook to the provider.
   * Retries with exponential backoff on failure.
   */
  async sendGameResult(payload: Omit<GameResultWebhookPayload, "signature">): Promise<WebhookDeliveryRecord> {
    const body = JSON.stringify(payload);
    const signature = this.sign(body);
    const signedPayload: GameResultWebhookPayload = { ...payload, signature };

    return this.deliverWithRetry(this.gameResultUrl, signedPayload, `game-result:${payload.gameId}`);
  }

  /**
   * Build a GameResultWebhookPayload from game-end data.
   */
  buildGameResultPayload(params: {
    gameId: string;
    sessionId: string;
    playerId: string;
    entryFee: number;
    totalPayout: number;
    currency: string;
    ticketsPlayed: number;
    numbersDrawn: number;
    patterns: string[];
  }): Omit<GameResultWebhookPayload, "signature"> {
    const result: GameResultDetails = {
      entryFee: params.entryFee,
      totalPayout: params.totalPayout,
      netResult: params.totalPayout - params.entryFee,
      currency: params.currency,
      ticketsPlayed: params.ticketsPlayed,
      numbersDrawn: params.numbersDrawn,
      patterns: params.patterns
    };

    return {
      event: "game.completed",
      gameId: params.gameId,
      sessionId: params.sessionId,
      playerId: params.playerId,
      timestamp: new Date().toISOString(),
      result
    };
  }

  // -----------------------------------------------------------------------
  // Compliance callbacks (BIN-35)
  // -----------------------------------------------------------------------

  /**
   * Send a compliance event to the provider.
   */
  async sendComplianceEvent(payload: ComplianceCallbackPayload): Promise<WebhookDeliveryRecord> {
    const body = JSON.stringify(payload);
    const signature = this.sign(body);
    const signedPayload = { ...payload, signature };

    return this.deliverWithRetry(this.complianceUrl, signedPayload, `compliance:${payload.event}:${payload.playerId}`);
  }

  /**
   * Build a compliance event payload.
   */
  buildCompliancePayload(
    event: ComplianceEventType,
    playerId: string,
    details: Record<string, unknown>
  ): ComplianceCallbackPayload {
    return {
      event,
      playerId,
      timestamp: new Date().toISOString(),
      details
    };
  }

  // -----------------------------------------------------------------------
  // Admin / inspection
  // -----------------------------------------------------------------------

  getDeliveryLog(): WebhookDeliveryRecord[] {
    return this.deliveryLog.map((r) => ({ ...r }));
  }

  getRecentDeliveries(limit: number = 20): WebhookDeliveryRecord[] {
    return this.deliveryLog.slice(-limit).reverse().map((r) => ({ ...r }));
  }

  // -----------------------------------------------------------------------
  // Internal: delivery with retry
  // -----------------------------------------------------------------------

  private async deliverWithRetry(
    url: string,
    payload: object,
    tag: string
  ): Promise<WebhookDeliveryRecord> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 16_000);
        await this.sleep(delayMs);
      }

      try {
        const body = JSON.stringify(payload);
        const signature = this.sign(body);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature
          },
          body,
          signal: controller.signal
        });

        clearTimeout(timeout);

        const record: WebhookDeliveryRecord = {
          tag,
          url,
          attempt: attempt + 1,
          status: response.status,
          success: response.ok,
          timestamp: new Date().toISOString()
        };

        this.addToLog(record);

        if (response.ok) {
          return record;
        }

        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    // All retries exhausted.
    const failRecord: WebhookDeliveryRecord = {
      tag,
      url,
      attempt: this.maxRetries + 1,
      status: 0,
      success: false,
      error: lastError,
      timestamp: new Date().toISOString()
    };
    this.addToLog(failRecord);
    console.error(`[WebhookService] Delivery failed after ${this.maxRetries + 1} attempts: ${tag} — ${lastError}`);
    return failRecord;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private sign(body: string): string {
    return createHmac("sha256", this.secret).update(body).digest("hex");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private addToLog(record: WebhookDeliveryRecord): void {
    this.deliveryLog.push(record);
    if (this.deliveryLog.length > WebhookService.MAX_LOG_SIZE) {
      this.deliveryLog.splice(0, this.deliveryLog.length - WebhookService.MAX_LOG_SIZE);
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookDeliveryRecord {
  tag: string;
  url: string;
  attempt: number;
  status: number;
  success: boolean;
  error?: string;
  timestamp: string;
}
