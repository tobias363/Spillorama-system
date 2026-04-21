/**
 * GAME1_SCHEDULE PR 4a: ticket-purchase-foundation for Game 1.
 *
 * Spec: .claude/worktrees/interesting-ellis-eb99bd/GAME1_SCHEDULE_SPEC.md §4a.
 *
 * Ansvar:
 *   1) purchase({ scheduledGameId, buyerUserId, hallId, ticketSpec, paymentMethod, … })
 *      - Pre-cond: scheduledGame.status='purchase_open' og hallen er
 *        fortsatt åpen for kjøp (via Game1HallReadyService.assertPurchaseOpenForHall).
 *      - Validerer ticket_spec mot scheduled_games.ticket_config_json —
 *        bare farger fra konfigen godtas, og priser må matche.
 *      - digital_wallet → walletAdapter.debit(buyerUserId, total, idempotencyKey).
 *        cash_agent / card_agent → ingen wallet-flyt (agent tar betaling fysisk).
 *      - INSERT i app_game1_ticket_purchases. UNIQUE(idempotency_key) gjør
 *        retries idempotente — samme key → eksisterende purchase returneres.
 *      - AuditLog: category='game1_purchase', action='create'.
 *
 *   2) refundPurchase({ purchaseId, reason, refundedByUserId })
 *      - Idempotent: allerede refundert → return uten ny flyt.
 *      - Avvis hvis scheduled_game.status='completed'.
 *      - digital_wallet → walletAdapter.credit (idempotencyKey="refund:{purchaseId}").
 *      - agent_cash/card → kun audit-logg; fysisk refund håndteres av agent.
 *      - UPDATE refunded_at/reason/by_user_id/transaction_id.
 *      - AuditLog: action='refund'.
 *
 *   3) listPurchasesForGame / listPurchasesForBuyer — read helpers for
 *      draw-engine (PR 4b) og spiller-UI.
 *
 *   4) assertPurchaseOpen({scheduledGameId, hallId}) — kortvei til
 *      Game1HallReadyService.assertPurchaseOpenForHall + games-status-sjekk.
 *
 * Design:
 *   - Wallet-flyt kalles UTENFOR samme DB-transaksjon som INSERT — wallet-
 *     adapter har egen transaksjon. Idempotency-key sikrer at retries etter
 *     delvis feil gir netto-effekt likt (wallet-adapter dedup via key,
 *     INSERT kaster 23505 ved UNIQUE-krasj og vi mapper til
 *     alreadyExisted: true).
 *   - Validering gjøres i service-laget. DB-skjemaet er "dumt" bortsett fra
 *     FK-er og UNIQUE(idempotency_key).
 *   - AuditLog skrives fire-and-forget (AuditLogService.record håndterer
 *     det internt per BIN-588).
 *
 * AuditLog-felter:
 *   - actorType: PLAYER ved digital_wallet; AGENT ved cash_agent/card_agent.
 *     refund bruker actorType fra refundedByUser.
 *   - resource: 'game1_ticket_purchase', resourceId: purchaseId.
 *   - details: { scheduledGameId, totalAmountCents, paymentMethod, ticketCount,
 *               hallId }.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { DomainError } from "./BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type {
  AuditActorType,
  AuditLogService,
} from "../compliance/AuditLogService.js";
import type { Game1HallReadyService } from "./Game1HallReadyService.js";
import type { PlatformService } from "../platform/PlatformService.js";

const log = rootLogger.child({ module: "game1-ticket-purchase-service" });

// ── Public types ──────────────────────────────────────────────────────────────

export type Game1PaymentMethod =
  | "digital_wallet"
  | "cash_agent"
  | "card_agent";

export type Game1TicketSize = "small" | "large";

export interface Game1TicketSpecEntry {
  color: string;
  size: Game1TicketSize;
  count: number;
  priceCentsEach: number;
}

export interface Game1TicketPurchaseInput {
  scheduledGameId: string;
  buyerUserId: string;
  hallId: string;
  ticketSpec: Game1TicketSpecEntry[];
  paymentMethod: Game1PaymentMethod;
  /** Kreves hvis paymentMethod er 'cash_agent' eller 'card_agent'. */
  agentUserId?: string;
  idempotencyKey: string;
}

export interface Game1TicketPurchaseResult {
  purchaseId: string;
  totalAmountCents: number;
  /** true hvis idempotency_key allerede fantes (retry). */
  alreadyExisted: boolean;
}

export interface Game1TicketPurchaseRow {
  id: string;
  scheduledGameId: string;
  buyerUserId: string;
  hallId: string;
  ticketSpec: Game1TicketSpecEntry[];
  totalAmountCents: number;
  paymentMethod: Game1PaymentMethod;
  agentUserId: string | null;
  idempotencyKey: string;
  purchasedAt: string;
  refundedAt: string | null;
  refundReason: string | null;
  refundedByUserId: string | null;
  refundTransactionId: string | null;
}

export interface Game1RefundInput {
  purchaseId: string;
  reason: string;
  refundedByUserId: string;
  /** Brukes for AuditLog (ellers defaulter til 'ADMIN' av sikkerhetsgrunner). */
  refundedByActorType?: AuditActorType;
}

export interface Game1TicketPurchaseServiceOptions {
  pool: Pool;
  schema?: string;
  walletAdapter: WalletAdapter;
  platformService: PlatformService;
  hallReadyService: Game1HallReadyService;
  auditLogService: AuditLogService;
}

// ── Internal row shapes ───────────────────────────────────────────────────────

interface ScheduledGameRow {
  id: string;
  status: string;
  ticket_config_json: unknown;
  participating_halls_json: unknown;
  master_hall_id: string;
}

interface PurchaseDbRow {
  id: string;
  scheduled_game_id: string;
  buyer_user_id: string;
  hall_id: string;
  ticket_spec_json: unknown;
  total_amount_cents: string | number;
  payment_method: Game1PaymentMethod;
  agent_user_id: string | null;
  idempotency_key: string;
  purchased_at: Date | string;
  refunded_at: Date | string | null;
  refund_reason: string | null;
  refunded_by_user_id: string | null;
  refund_transaction_id: string | null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class Game1TicketPurchaseService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly wallet: WalletAdapter;
  private readonly platform: PlatformService;
  private readonly hallReady: Game1HallReadyService;
  private readonly audit: AuditLogService;

  constructor(options: Game1TicketPurchaseServiceOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.schema = schema;
    this.wallet = options.walletAdapter;
    this.platform = options.platformService;
    this.hallReady = options.hallReadyService;
    this.audit = options.auditLogService;
  }

  // ── Table helpers ──────────────────────────────────────────────────────────

  private purchasesTable(): string {
    return `"${this.schema}"."app_game1_ticket_purchases"`;
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  // ── Public API: purchase ───────────────────────────────────────────────────

  /**
   * Utfør et ticket-kjøp mot et Game 1 scheduled_game. Idempotent via
   * idempotencyKey.
   *
   * Feilkoder (alle DomainError → HTTP 400):
   *   - PURCHASE_CLOSED_FOR_GAME    — status ≠ 'purchase_open'
   *   - PURCHASE_CLOSED_FOR_HALL    — bingovert har trykket klar
   *   - INVALID_TICKET_SPEC         — farge/pris/størrelse feil
   *   - MISSING_AGENT               — agent-betaling uten agentUserId
   *   - INSUFFICIENT_FUNDS          — wallet.debit kaster (wrapped)
   */
  async purchase(input: Game1TicketPurchaseInput): Promise<Game1TicketPurchaseResult> {
    this.validateInputShape(input);

    // Idempotent kort-slutt: har vi allerede kjøp med samme key?
    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return {
        purchaseId: existing.id,
        totalAmountCents: Number(existing.totalAmountCents),
        alreadyExisted: true,
      };
    }

    // Hent + validér scheduled-game + hall-ready.
    const game = await this.loadScheduledGame(input.scheduledGameId);
    if (game.status !== "purchase_open") {
      throw new DomainError(
        "PURCHASE_CLOSED_FOR_GAME",
        `Billettsalget er ikke åpent for dette spillet (status: '${game.status}').`
      );
    }
    this.assertHallParticipates(game, input.hallId);
    // Hall-ready: fallback ikke-kasting hvis games ikke har rad.
    await this.hallReady.assertPurchaseOpenForHall(
      input.scheduledGameId,
      input.hallId
    );

    // Validér ticket-spec mot snapshot-config.
    const totalAmountCents = this.validateTicketSpecAgainstConfig(
      input.ticketSpec,
      game.ticket_config_json
    );

    // Agent-påkrevde felter.
    if (
      (input.paymentMethod === "cash_agent" ||
        input.paymentMethod === "card_agent") &&
      !input.agentUserId?.trim()
    ) {
      throw new DomainError(
        "MISSING_AGENT",
        "Agent-betaling krever agentUserId."
      );
    }

    const purchaseId = `g1p-${randomUUID()}`;

    // Wallet-debit FØR INSERT for digital_wallet. Hvis wallet-debit feiler
    // (f.eks. INSUFFICIENT_BALANCE), blir det aldri en rad i purchases.
    // Idempotency-key på wallet speiler purchase-key så dobbel-innlevering
    // ikke dobbel-debiterer før UNIQUE slår inn på INSERT.
    if (input.paymentMethod === "digital_wallet") {
      try {
        const buyer = await this.platform.getUserById(input.buyerUserId);
        const balance = await this.wallet.getBalance(buyer.walletId);
        const amountNok = centsToAmount(totalAmountCents);
        if (balance < amountNok) {
          throw new DomainError(
            "INSUFFICIENT_FUNDS",
            "Ikke nok penger i wallet til å kjøpe billetter."
          );
        }
        await this.wallet.debit(
          buyer.walletId,
          amountNok,
          `game1_purchase:${purchaseId}`,
          { idempotencyKey: `game1-purchase:${input.idempotencyKey}:debit` }
        );
      } catch (err) {
        if (err instanceof DomainError) throw err;
        const msg = err instanceof Error ? err.message : "ukjent wallet-feil";
        throw new DomainError(
          "INSUFFICIENT_FUNDS",
          `Kjøpet kunne ikke fullføres: ${msg}`
        );
      }
    }

    // INSERT — UNIQUE(idempotency_key) race-handling.
    let alreadyExisted = false;
    let insertedRow: Game1TicketPurchaseRow;
    try {
      insertedRow = await this.insertPurchaseRow({
        id: purchaseId,
        scheduledGameId: input.scheduledGameId,
        buyerUserId: input.buyerUserId,
        hallId: input.hallId,
        ticketSpec: input.ticketSpec,
        totalAmountCents,
        paymentMethod: input.paymentMethod,
        agentUserId: input.agentUserId ?? null,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (err) {
      // Postgres unique_violation.
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "23505") {
        const dup = await this.findByIdempotencyKey(input.idempotencyKey);
        if (dup) {
          return {
            purchaseId: dup.id,
            totalAmountCents: Number(dup.totalAmountCents),
            alreadyExisted: true,
          };
        }
      }
      throw err;
    }

    // Fire-and-forget audit.
    this.fireAudit({
      actorId: input.paymentMethod === "digital_wallet"
        ? input.buyerUserId
        : input.agentUserId ?? null,
      actorType: input.paymentMethod === "digital_wallet" ? "PLAYER" : "AGENT",
      action: "game1_purchase.create",
      resource: "game1_ticket_purchase",
      resourceId: purchaseId,
      details: {
        scheduledGameId: input.scheduledGameId,
        buyerUserId: input.buyerUserId,
        hallId: input.hallId,
        totalAmountCents,
        paymentMethod: input.paymentMethod,
        ticketCount: sumTicketCount(input.ticketSpec),
      },
    });

    log.info(
      {
        purchaseId,
        scheduledGameId: input.scheduledGameId,
        buyerUserId: input.buyerUserId,
        hallId: input.hallId,
        totalAmountCents,
        paymentMethod: input.paymentMethod,
      },
      "[GAME1_SCHEDULE PR4a] purchase created"
    );

    return {
      purchaseId: insertedRow.id,
      totalAmountCents: insertedRow.totalAmountCents,
      alreadyExisted,
    };
  }

  // ── Public API: refundPurchase ─────────────────────────────────────────────

  /**
   * Refundér et eksisterende purchase. Idempotent — andre gang returnerer
   * uten ny wallet-flyt. Blokkerer hvis scheduled_game.status='completed'.
   */
  async refundPurchase(input: Game1RefundInput): Promise<void> {
    const purchase = await this.getPurchaseById(input.purchaseId);
    if (!purchase) {
      throw new DomainError(
        "PURCHASE_NOT_FOUND",
        "Fant ikke purchase-raden."
      );
    }
    if (purchase.refundedAt) {
      // Idempotent return — allerede refundert.
      log.debug(
        { purchaseId: purchase.id },
        "refundPurchase idempotent hit"
      );
      return;
    }

    const game = await this.loadScheduledGame(purchase.scheduledGameId);
    if (game.status === "completed") {
      throw new DomainError(
        "CANNOT_REFUND_COMPLETED_GAME",
        "Kan ikke refundere etter at spillet er fullført."
      );
    }

    let refundTransactionId: string | null = null;
    if (purchase.paymentMethod === "digital_wallet") {
      try {
        const buyer = await this.platform.getUserById(purchase.buyerUserId);
        const amountNok = centsToAmount(purchase.totalAmountCents);
        const walletTx = await this.wallet.credit(
          buyer.walletId,
          amountNok,
          `game1_refund:${purchase.id}`,
          { idempotencyKey: `game1-refund:${purchase.id}:credit` }
        );
        refundTransactionId = walletTx.id;
      } catch (err) {
        if (err instanceof DomainError) throw err;
        const msg = err instanceof Error ? err.message : "ukjent wallet-feil";
        throw new DomainError(
          "REFUND_FAILED",
          `Refund kunne ikke fullføres: ${msg}`
        );
      }
    } else {
      // cash_agent / card_agent: ingen wallet-flyt. Fysisk refund håndteres
      // av agenten. Vi logger kun.
      log.warn(
        {
          purchaseId: purchase.id,
          paymentMethod: purchase.paymentMethod,
        },
        "[GAME1_SCHEDULE PR4a] agent-refund — fysisk håndtering kreves"
      );
    }

    await this.pool.query(
      `UPDATE ${this.purchasesTable()}
         SET refunded_at           = now(),
             refund_reason         = $2,
             refunded_by_user_id   = $3,
             refund_transaction_id = $4
       WHERE id = $1
         AND refunded_at IS NULL`,
      [
        purchase.id,
        input.reason,
        input.refundedByUserId,
        refundTransactionId,
      ]
    );

    this.fireAudit({
      actorId: input.refundedByUserId,
      actorType: input.refundedByActorType ?? "ADMIN",
      action: "game1_purchase.refund",
      resource: "game1_ticket_purchase",
      resourceId: purchase.id,
      details: {
        scheduledGameId: purchase.scheduledGameId,
        buyerUserId: purchase.buyerUserId,
        hallId: purchase.hallId,
        totalAmountCents: purchase.totalAmountCents,
        paymentMethod: purchase.paymentMethod,
        reason: input.reason,
        refundTransactionId,
      },
    });
  }

  // ── Public API: list helpers + cutoff-helper ──────────────────────────────

  async listPurchasesForGame(
    scheduledGameId: string
  ): Promise<Game1TicketPurchaseRow[]> {
    const { rows } = await this.pool.query<PurchaseDbRow>(
      `SELECT * FROM ${this.purchasesTable()}
       WHERE scheduled_game_id = $1
       ORDER BY purchased_at ASC`,
      [scheduledGameId]
    );
    return rows.map(mapRowToPurchase);
  }

  async listPurchasesForBuyer(
    buyerUserId: string,
    scheduledGameId: string
  ): Promise<Game1TicketPurchaseRow[]> {
    const { rows } = await this.pool.query<PurchaseDbRow>(
      `SELECT * FROM ${this.purchasesTable()}
       WHERE buyer_user_id = $1 AND scheduled_game_id = $2
       ORDER BY purchased_at ASC`,
      [buyerUserId, scheduledGameId]
    );
    return rows.map(mapRowToPurchase);
  }

  /**
   * Kortvei som både verifiserer scheduled-game-status OG kaller
   * hall-ready-guard. Matcher TicketPurchasePort-kontrakten og brukes
   * av route-laget som pre-flight-sjekk før purchase() kalles.
   */
  async assertPurchaseOpen(
    scheduledGameId: string,
    hallId: string
  ): Promise<void> {
    const game = await this.loadScheduledGame(scheduledGameId);
    if (game.status !== "purchase_open") {
      throw new DomainError(
        "PURCHASE_CLOSED_FOR_GAME",
        `Billettsalget er ikke åpent for dette spillet (status: '${game.status}').`
      );
    }
    await this.hallReady.assertPurchaseOpenForHall(scheduledGameId, hallId);
  }

  async getPurchaseById(
    purchaseId: string
  ): Promise<Game1TicketPurchaseRow | null> {
    const { rows } = await this.pool.query<PurchaseDbRow>(
      `SELECT * FROM ${this.purchasesTable()} WHERE id = $1`,
      [purchaseId]
    );
    return rows[0] ? mapRowToPurchase(rows[0]) : null;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private validateInputShape(input: Game1TicketPurchaseInput): void {
    const required: Array<[string, string | undefined]> = [
      ["scheduledGameId", input.scheduledGameId],
      ["buyerUserId", input.buyerUserId],
      ["hallId", input.hallId],
      ["idempotencyKey", input.idempotencyKey],
    ];
    for (const [name, value] of required) {
      if (!value || typeof value !== "string" || !value.trim()) {
        throw new DomainError(
          "INVALID_INPUT",
          `${name} er påkrevd.`
        );
      }
    }
    if (!Array.isArray(input.ticketSpec) || input.ticketSpec.length === 0) {
      throw new DomainError(
        "INVALID_TICKET_SPEC",
        "ticketSpec må være et ikke-tomt array."
      );
    }
    for (const entry of input.ticketSpec) {
      if (!entry || typeof entry !== "object") {
        throw new DomainError(
          "INVALID_TICKET_SPEC",
          "ticketSpec-entry må være objekt."
        );
      }
      if (typeof entry.color !== "string" || !entry.color.trim()) {
        throw new DomainError("INVALID_TICKET_SPEC", "color er påkrevd.");
      }
      if (entry.size !== "small" && entry.size !== "large") {
        throw new DomainError(
          "INVALID_TICKET_SPEC",
          "size må være 'small' eller 'large'."
        );
      }
      if (
        !Number.isInteger(entry.count) ||
        entry.count < 1 ||
        entry.count > 10_000
      ) {
        throw new DomainError(
          "INVALID_TICKET_SPEC",
          "count må være positivt heltall."
        );
      }
      if (
        !Number.isFinite(entry.priceCentsEach) ||
        entry.priceCentsEach < 0 ||
        !Number.isInteger(entry.priceCentsEach)
      ) {
        throw new DomainError(
          "INVALID_TICKET_SPEC",
          "priceCentsEach må være ikke-negativt heltall."
        );
      }
    }
  }

  private assertHallParticipates(
    game: ScheduledGameRow,
    hallId: string
  ): void {
    const participating = parseHallIdsArray(game.participating_halls_json);
    if (
      !participating.includes(hallId) &&
      game.master_hall_id !== hallId
    ) {
      throw new DomainError(
        "PURCHASE_CLOSED_FOR_HALL",
        "Hallen deltar ikke i dette spillet."
      );
    }
  }

  /**
   * Validér ticket-spec mot scheduled_games.ticket_config_json snapshot.
   * Returnerer Σ(count * priceCentsEach) hvis alle entries er gyldige.
   *
   * Støttede ticket_config_json-format (begge aksepterte for robusthet):
   *
   *   1) { ticketTypesData: [ { color, size, pricePerTicket|priceCents } ] }
   *   2) { ticketTypes: [ { color, size, pricePerTicket|priceCents } ] }
   *   3) Flat array (legacy).
   *
   * `pricePerTicket` er gammel CMS-verdi i øre (int). `priceCents` er ny.
   * Vi lar caller sende `priceCentsEach` — må matche konfigen nøyaktig.
   */
  private validateTicketSpecAgainstConfig(
    spec: Game1TicketSpecEntry[],
    rawConfig: unknown
  ): number {
    const catalog = extractTicketCatalog(rawConfig);
    if (catalog.length === 0) {
      throw new DomainError(
        "INVALID_TICKET_SPEC",
        "Spillets ticket-konfig er ikke satt — kan ikke kjøpe billetter."
      );
    }
    const catalogByKey = new Map<string, number>();
    for (const item of catalog) {
      catalogByKey.set(`${item.color}:${item.size}`, item.priceCents);
    }

    let total = 0;
    for (const entry of spec) {
      const key = `${entry.color}:${entry.size}`;
      const expected = catalogByKey.get(key);
      if (expected === undefined) {
        throw new DomainError(
          "INVALID_TICKET_SPEC",
          `Billettypen ${entry.color}/${entry.size} finnes ikke i spillets konfig.`
        );
      }
      if (expected !== entry.priceCentsEach) {
        throw new DomainError(
          "INVALID_TICKET_SPEC",
          `Pris for ${entry.color}/${entry.size} matcher ikke spillets konfig (forventet ${expected} øre).`
        );
      }
      total += entry.count * entry.priceCentsEach;
    }
    if (total < 0 || !Number.isSafeInteger(total)) {
      throw new DomainError(
        "INVALID_TICKET_SPEC",
        "Ugyldig totalbeløp."
      );
    }
    return total;
  }

  private async loadScheduledGame(
    scheduledGameId: string
  ): Promise<ScheduledGameRow> {
    const { rows } = await this.pool.query<ScheduledGameRow>(
      `SELECT id, status, ticket_config_json,
              participating_halls_json, master_hall_id
         FROM ${this.scheduledGamesTable()}
         WHERE id = $1`,
      [scheduledGameId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "GAME_NOT_FOUND",
        "Spillet finnes ikke."
      );
    }
    return row;
  }

  private async findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<Game1TicketPurchaseRow | null> {
    const { rows } = await this.pool.query<PurchaseDbRow>(
      `SELECT * FROM ${this.purchasesTable()}
       WHERE idempotency_key = $1
       LIMIT 1`,
      [idempotencyKey]
    );
    return rows[0] ? mapRowToPurchase(rows[0]) : null;
  }

  private async insertPurchaseRow(input: {
    id: string;
    scheduledGameId: string;
    buyerUserId: string;
    hallId: string;
    ticketSpec: Game1TicketSpecEntry[];
    totalAmountCents: number;
    paymentMethod: Game1PaymentMethod;
    agentUserId: string | null;
    idempotencyKey: string;
  }): Promise<Game1TicketPurchaseRow> {
    const { rows } = await this.pool.query<PurchaseDbRow>(
      `INSERT INTO ${this.purchasesTable()}
        (id, scheduled_game_id, buyer_user_id, hall_id,
         ticket_spec_json, total_amount_cents, payment_method,
         agent_user_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.id,
        input.scheduledGameId,
        input.buyerUserId,
        input.hallId,
        JSON.stringify(input.ticketSpec),
        input.totalAmountCents,
        input.paymentMethod,
        input.agentUserId,
        input.idempotencyKey,
      ]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "INSERT_FAILED",
        "Kunne ikke lagre purchase-raden."
      );
    }
    return mapRowToPurchase(row);
  }

  private fireAudit(event: {
    actorId: string | null;
    actorType: AuditActorType;
    action: string;
    resource: string;
    resourceId: string;
    details: Record<string, unknown>;
  }): void {
    this.audit
      .record({
        actorId: event.actorId,
        actorType: event.actorType,
        action: event.action,
        resource: event.resource,
        resourceId: event.resourceId,
        details: event.details,
      })
      .catch((err) => {
        log.warn(
          { err, action: event.action, resourceId: event.resourceId },
          "[GAME1_SCHEDULE PR4a] audit append failed"
        );
      });
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function parseHallIdsArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((x: unknown): x is string => typeof x === "string");
      }
    } catch {
      return [];
    }
  }
  return [];
}

interface TicketCatalogEntry {
  color: string;
  size: Game1TicketSize;
  priceCents: number;
}

/**
 * Trekk ut ticket-catalog fra scheduled_games.ticket_config_json. Tåler
 * flere legacy-format for robusthet (CMS versjoner).
 */
function extractTicketCatalog(raw: unknown): TicketCatalogEntry[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object") return [];
  // Unwrap variant { ticketTypesData: [...] } eller { ticketTypes: [...] }.
  let list: unknown = parsed;
  if (Array.isArray((parsed as { ticketTypesData?: unknown }).ticketTypesData)) {
    list = (parsed as { ticketTypesData: unknown }).ticketTypesData;
  } else if (Array.isArray((parsed as { ticketTypes?: unknown }).ticketTypes)) {
    list = (parsed as { ticketTypes: unknown }).ticketTypes;
  }
  if (!Array.isArray(list)) return [];
  const out: TicketCatalogEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    const color = typeof i.color === "string" ? i.color.trim() : "";
    const sizeRaw = typeof i.size === "string" ? i.size.toLowerCase() : "";
    const size: Game1TicketSize | null =
      sizeRaw === "small" || sizeRaw === "large" ? sizeRaw : null;
    // Priseskoden kan være `priceCents`, `priceCentsEach`, `pricePerTicket`,
    // eller `price` (øre). Vi konverterer til heltall.
    let priceCents: number | null = null;
    for (const key of ["priceCents", "priceCentsEach", "pricePerTicket", "price"]) {
      const val = i[key];
      if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
        priceCents = Math.round(val);
        break;
      }
      if (typeof val === "string") {
        const n = Number.parseFloat(val);
        if (Number.isFinite(n) && n >= 0) {
          priceCents = Math.round(n);
          break;
        }
      }
    }
    if (!color || !size || priceCents === null) continue;
    out.push({ color, size, priceCents });
  }
  return out;
}

function sumTicketCount(spec: Game1TicketSpecEntry[]): number {
  return spec.reduce((n, e) => n + e.count, 0);
}

/**
 * Wallet-adapteret opererer i kronebeløp (NOK), ikke cents. Vi multipliserer
 * cents→øre→kroner samme vei som AgentTransactionService gjør
 * (`centsToAmount` i den fila). Her bruker vi lokal implementasjon for
 * å unngå cross-module-import av en private helper.
 */
function centsToAmount(cents: number): number {
  return cents / 100;
}

function mapRowToPurchase(row: PurchaseDbRow): Game1TicketPurchaseRow {
  return {
    id: String(row.id),
    scheduledGameId: String(row.scheduled_game_id),
    buyerUserId: String(row.buyer_user_id),
    hallId: String(row.hall_id),
    ticketSpec: parseTicketSpecJson(row.ticket_spec_json),
    totalAmountCents: Number(row.total_amount_cents),
    paymentMethod: row.payment_method,
    agentUserId: row.agent_user_id == null ? null : String(row.agent_user_id),
    idempotencyKey: String(row.idempotency_key),
    purchasedAt: toIso(row.purchased_at),
    refundedAt: row.refunded_at == null ? null : toIso(row.refunded_at),
    refundReason:
      row.refund_reason == null ? null : String(row.refund_reason),
    refundedByUserId:
      row.refunded_by_user_id == null ? null : String(row.refunded_by_user_id),
    refundTransactionId:
      row.refund_transaction_id == null
        ? null
        : String(row.refund_transaction_id),
  };
}

function parseTicketSpecJson(raw: unknown): Game1TicketSpecEntry[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: Game1TicketSpecEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    const color = typeof i.color === "string" ? i.color : "";
    const sizeRaw = typeof i.size === "string" ? i.size.toLowerCase() : "";
    const size: Game1TicketSize | null =
      sizeRaw === "small" || sizeRaw === "large" ? sizeRaw : null;
    const count = Number(i.count ?? 0);
    const priceCentsEach = Number(
      i.priceCentsEach ?? i.price_cents_each ?? 0
    );
    if (!color || !size || !Number.isFinite(count) || count < 1) continue;
    if (!Number.isFinite(priceCentsEach) || priceCentsEach < 0) continue;
    out.push({ color, size, count, priceCentsEach });
  }
  return out;
}

function toIso(value: Date | string | null): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
