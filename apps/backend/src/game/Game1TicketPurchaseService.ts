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
import { IdempotencyKeys } from "./idempotency.js";
import { logger as rootLogger } from "../util/logger.js";
import type { WalletAdapter, WalletTransaction } from "../adapters/WalletAdapter.js";
import type {
  AuditActorType,
  AuditLogService,
} from "../compliance/AuditLogService.js";
import type { Game1HallReadyService } from "./Game1HallReadyService.js";
import type { PlatformService } from "../platform/PlatformService.js";
import {
  NoopComplianceLossPort,
  type ComplianceLossPort,
} from "../adapters/ComplianceLossPort.js";
import {
  NoopPotSalesHook,
  type PotSalesHookPort,
} from "../adapters/PotSalesHookPort.js";
import {
  NoopComplianceLedgerPort,
  type ComplianceLedgerPort,
} from "../adapters/ComplianceLedgerPort.js";
import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";

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

/** PR 4d.4: input til massrefund ved stopGame. */
export interface Game1RefundAllForGameInput {
  scheduledGameId: string;
  reason: string;
  refundedByUserId: string;
  refundedByActorType?: AuditActorType;
}

/** PR 4d.4: sammendrag av massrefund — én rad per purchase. */
export interface Game1RefundAllForGameResult {
  scheduledGameId: string;
  totalConsidered: number;
  /** Purchases som ble refundert i dette kallet. */
  succeeded: string[];
  /** Purchases som allerede var refundert (idempotent hit). */
  skippedAlreadyRefunded: string[];
  /** Purchases som feilet — hver isolert, ikke transaksjonell rollback. */
  failed: Array<{
    purchaseId: string;
    errorCode: string;
    errorMessage: string;
  }>;
}

export interface Game1TicketPurchaseServiceOptions {
  pool: Pool;
  schema?: string;
  walletAdapter: WalletAdapter;
  platformService: PlatformService;
  hallReadyService: Game1HallReadyService;
  auditLogService: AuditLogService;
  /**
   * PR-W5 wallet-split: port for å logge BUYIN-entries mot Spillvett-tapsgrense.
   * Hentes fra BingoEngine.getComplianceLossPort() i index.ts-wiringen. Default
   * er no-op så eksisterende tester som ikke bryr seg om compliance-logging
   * fortsatt kjører uendret.
   *
   * Se docs/architecture/WALLET_SPLIT_DESIGN_2026-04-22.md §3.4.
   */
  complianceLossPort?: ComplianceLossPort;
  /**
   * PR-T3 Spor 4: port for å akkumulere andel av salg til Innsatsen/
   * Jackpott-pot. Kalles fire-and-forget etter vellykket wallet-debit +
   * INSERT. Default no-op — wires i index.ts via
   * `engine.getPotSalesHookPort(game1PotService)`.
   *
   * Soft-fail: port-feil ruller ikke tilbake purchase.
   *
   * Se docs/architecture/SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md §Innsatsen.
   */
  potSalesHook?: PotSalesHookPort;
  /**
   * K1 compliance-fix: port for å logge STAKE-entries til ComplianceLedger
   * etter vellykket purchase. hallId MÅ være kjøpe-hallen (ikke master-
   * hallen) per §71 pengespillforskriften. Default no-op — wires i
   * index.ts via `engine.getComplianceLedgerPort()`.
   *
   * Soft-fail: port-feil ruller ikke tilbake purchase (audit-logging
   * som kan re-kjøres manuelt ved behov).
   */
  complianceLedgerPort?: ComplianceLedgerPort;
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
  /**
   * PR-W5 wallet-split: port for å logge BUYIN mot Spillvett-tapsgrense.
   * Default no-op — wiringen i index.ts setter den til engine.getComplianceLossPort().
   */
  private readonly complianceLoss: ComplianceLossPort;
  /**
   * PR-T3 Spor 4: port for pot-akkumulering (Innsatsen/Jackpott).
   * Default no-op — wires i index.ts til engine.getPotSalesHookPort(potService).
   */
  private readonly potSalesHook: PotSalesHookPort;
  /**
   * K1 compliance-fix: port for STAKE-entries til ComplianceLedger.
   * Default no-op — wires i index.ts til engine.getComplianceLedgerPort().
   * hallId bindes alltid til kjøpe-hallen (input.hallId), ikke master-hallen.
   */
  private readonly complianceLedgerPort: ComplianceLedgerPort;

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
    this.complianceLoss = options.complianceLossPort ?? new NoopComplianceLossPort();
    this.potSalesHook = options.potSalesHook ?? new NoopPotSalesHook();
    this.complianceLedgerPort =
      options.complianceLedgerPort ?? new NoopComplianceLedgerPort();
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

    // PR-W5 wallet-split: hold rede på wallet-debit-transaksjonen slik at vi
    // kan logge `type:"BUYIN"` mot compliance-laget med kun deposit-delen (ikke
    // winnings-delen). Winnings-bruk teller IKKE mot daglig/månedlig tapsgrense
    // per §11 pengespillforskriften. Se WALLET_SPLIT_DESIGN_2026-04-22.md §3.4.
    let walletDebitTx: WalletTransaction | null = null;
    let buyerWalletId: string | null = null;

    // Wallet-debit FØR INSERT for digital_wallet. Hvis wallet-debit feiler
    // (f.eks. INSUFFICIENT_BALANCE), blir det aldri en rad i purchases.
    // Idempotency-key på wallet speiler purchase-key så dobbel-innlevering
    // ikke dobbel-debiterer før UNIQUE slår inn på INSERT.
    if (input.paymentMethod === "digital_wallet") {
      try {
        const buyer = await this.platform.getUserById(input.buyerUserId);
        buyerWalletId = buyer.walletId;
        const balance = await this.wallet.getBalance(buyer.walletId);
        const amountNok = centsToAmount(totalAmountCents);
        if (balance < amountNok) {
          throw new DomainError(
            "INSUFFICIENT_FUNDS",
            "Ikke nok penger i wallet til å kjøpe billetter."
          );
        }
        walletDebitTx = await this.wallet.debit(
          buyer.walletId,
          amountNok,
          `game1_purchase:${purchaseId}`,
          {
            idempotencyKey: IdempotencyKeys.game1PurchaseDebit({
              clientIdempotencyKey: input.idempotencyKey,
            }),
          }
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

    // PR-W5 wallet-split: logg BUYIN mot Spillvett-tapsgrense (kun deposit-delen).
    // Fire-and-forget med pino-warning ved feil — matcher BingoEngine.buyIn-patternet
    // hvor en compliance-feil ALDRI ruller tilbake purchase-flyt. For ikke-wallet-
    // betalinger (cash_agent/card_agent) har ingen wallet-flyt skjedd, så hopp over.
    // 100%-winnings-kjøp → amount = 0 → hopp over for å unngå støy i loss-ledger.
    if (
      input.paymentMethod === "digital_wallet" &&
      walletDebitTx !== null &&
      buyerWalletId !== null
    ) {
      const buyInLossAmount = lossLimitAmountFromDebit(walletDebitTx, centsToAmount(totalAmountCents));
      if (buyInLossAmount > 0) {
        try {
          await this.complianceLoss.recordLossEntry(buyerWalletId, input.hallId, {
            type: "BUYIN",
            amount: buyInLossAmount,
            createdAtMs: Date.now(),
          });
        } catch (err) {
          // Soft-fail — compliance-feil skal aldri rulle tilbake en fullført
          // purchase. Wallet-debit + INSERT er allerede committed; BUYIN-entry
          // er audit-logging som kan re-kjøres manuelt ved behov.
          log.warn(
            { err, purchaseId, buyerUserId: input.buyerUserId, hallId: input.hallId },
            "[PR-W5] compliance.recordLossEntry BUYIN feilet — purchase fortsetter uansett"
          );
        }
      } else {
        // Debug-spor for 100%-winnings-kjøp (forventet path når spilleren kjøper
        // med kun gevinst-saldo).
        log.debug(
          { purchaseId, buyerUserId: input.buyerUserId, totalAmountCents },
          "[PR-W5] purchase dekket 100% av winnings — ingen BUYIN-entry logget"
        );
      }
    }

    // PR-T3 Spor 4: pot-akkumulering (Innsatsen + Jackpott). Triggeres for
    // ALLE betalingsmetoder siden pot bygger på total-salg i hallen, ikke
    // bare digital-flyt. Soft-fail — pot-feil ruller ikke tilbake purchase
    // (matcher W5-patternet). Hele kjøpssum teller mot pot (winnings-kjøp
    // inkludert); pot er intern akkumulering, ikke loss-ledger-entry.
    try {
      await this.potSalesHook.onSaleCompleted({
        hallId: input.hallId,
        saleAmountCents: totalAmountCents,
      });
    } catch (err) {
      log.warn(
        {
          err,
          purchaseId,
          hallId: input.hallId,
          totalAmountCents,
        },
        "[PR-T3] potSalesHook.onSaleCompleted feilet — purchase fortsetter uansett"
      );
    }

    // K1 compliance-fix: skriv STAKE-entry til ComplianceLedger per §71
    // pengespillforskriften. REGULATORISK-KRITISK: hallId bindes til
    // KJØPE-HALLEN (input.hallId), ikke master-hallen. Se audit-konsekvens
    // i commit-message.
    //
    // Channel-semantikk:
    //   - digital_wallet  → INTERNET (spiller-app-kjøp)
    //   - cash_agent      → HALL (fysisk salg via agent)
    //   - card_agent      → HALL (fysisk salg via agent, kort-betaling)
    //
    // Soft-fail (matcher W5/T3-patternet): en compliance-ledger-feil
    // ruller ALDRI tilbake en committed purchase. Wallet-debit + INSERT
    // er allerede permanente; STAKE-entry er audit-logging som kan
    // re-kjøres manuelt ved behov.
    try {
      const channel = ledgerChannelForPaymentMethod(input.paymentMethod);
      await this.complianceLedgerPort.recordComplianceLedgerEvent({
        hallId: input.hallId,
        // K2-A CRIT-1: Spill 1 (slug `bingo`) er hovedspill (MAIN_GAME, 15%).
        // Dette er en Spill-1-spesifikk service — slug er hardkodet "bingo"
        // siden filen kun håndterer scheduled Spill 1-purchases.
        gameType: ledgerGameTypeForSlug("bingo"),
        channel,
        eventType: "STAKE",
        amount: centsToAmount(totalAmountCents),
        gameId: input.scheduledGameId,
        playerId: input.buyerUserId,
        walletId: buyerWalletId ?? undefined,
        metadata: {
          reason: "GAME1_PURCHASE",
          purchaseId,
          paymentMethod: input.paymentMethod,
          ticketCount: sumTicketCount(input.ticketSpec),
        },
      });
    } catch (err) {
      log.warn(
        {
          err,
          purchaseId,
          hallId: input.hallId,
          totalAmountCents,
          paymentMethod: input.paymentMethod,
        },
        "[K1] complianceLedger.recordComplianceLedgerEvent STAKE feilet — purchase fortsetter uansett"
      );
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
        // PR-W2 wallet-split: refund går tilbake til deposit-siden
        // (ikke winnings). Kjøp trekkes winnings-first i debit-flyten,
        // men refund av avbestilt kjøp anses som re-innskudd og skal
        // telle mot loss-limit på vanlig måte — derfor `to: "deposit"`.
        // Se WALLET_SPLIT_DESIGN_2026-04-22.md §3.2.
        const walletTx = await this.wallet.credit(
          buyer.walletId,
          amountNok,
          `game1_refund:${purchase.id}`,
          {
            idempotencyKey: IdempotencyKeys.game1RefundCredit({
              purchaseId: purchase.id,
            }),
            to: "deposit",
          }
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

  /**
   * PR 4d.4: massrefund av alle non-refunded purchases for et schedulert
   * spill. Brukes av Game1MasterControlService.stopGame() slik at master-
   * stop automatisk tilbakebetaler spillere uten manuell oppfølging.
   *
   * Feil-isolering (regulatorisk fail-closed per rad, ikke per batch):
   *   - Hver refundPurchase-call wrappes i egen try/catch.
   *   - Én feilet rad stopper IKKE resten — vi fortsetter loopen og
   *     returnerer `failed`-liste for oppfølging.
   *   - Idempotent purchase (allerede `refunded_at IS NOT NULL`) telles
   *     i `skippedAlreadyRefunded` og regnes ikke som feil.
   *   - Audit-entry per refund håndteres av `refundPurchase` selv.
   *
   * Caller (MasterControlService) logger warn + markerer stop_reason ved
   * partial failure. Ingen automatisk retry i 4d.4 (per PM-vedtak).
   */
  async refundAllForGame(
    input: Game1RefundAllForGameInput
  ): Promise<Game1RefundAllForGameResult> {
    const purchases = await this.listPurchasesForGame(input.scheduledGameId);
    const result: Game1RefundAllForGameResult = {
      scheduledGameId: input.scheduledGameId,
      totalConsidered: purchases.length,
      succeeded: [],
      skippedAlreadyRefunded: [],
      failed: [],
    };

    for (const purchase of purchases) {
      if (purchase.refundedAt) {
        result.skippedAlreadyRefunded.push(purchase.id);
        continue;
      }
      try {
        await this.refundPurchase({
          purchaseId: purchase.id,
          reason: input.reason,
          refundedByUserId: input.refundedByUserId,
          refundedByActorType: input.refundedByActorType,
        });
        result.succeeded.push(purchase.id);
      } catch (err) {
        const code =
          err instanceof DomainError
            ? err.code
            : "REFUND_FAILED_UNEXPECTED";
        const message =
          err instanceof Error ? err.message : "ukjent refund-feil";
        log.warn(
          {
            purchaseId: purchase.id,
            scheduledGameId: input.scheduledGameId,
            errorCode: code,
            err,
          },
          "[PR 4d.4] refundAllForGame — rad isolert feil"
        );
        result.failed.push({
          purchaseId: purchase.id,
          errorCode: code,
          errorMessage: message,
        });
      }
    }

    log.info(
      {
        scheduledGameId: input.scheduledGameId,
        totalConsidered: result.totalConsidered,
        succeededCount: result.succeeded.length,
        skippedCount: result.skippedAlreadyRefunded.length,
        failedCount: result.failed.length,
      },
      "[PR 4d.4] refundAllForGame fullført"
    );

    return result;
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
 * K1 compliance-fix: mapper paymentMethod til ComplianceLedger-channel.
 * - digital_wallet → INTERNET (spiller kjøper via web/app)
 * - cash_agent     → HALL     (fysisk salg i lokalet via agent)
 * - card_agent     → HALL     (fysisk salg i lokalet via agent, kort)
 *
 * Channel brukes av §71-rapport per hall til å skille online- og lokal-
 * omsetning. Reglene matcher legacy-oppgjør.
 */
function ledgerChannelForPaymentMethod(
  paymentMethod: Game1PaymentMethod
): "HALL" | "INTERNET" {
  return paymentMethod === "digital_wallet" ? "INTERNET" : "HALL";
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

/**
 * PR-W5 wallet-split: trekk ut deposit-delen av en DEBIT-transaksjon for
 * `recordLossEntry({type:"BUYIN"})`. Parallelt til `lossLimitAmountFromTransfer`
 * i `BingoEngine.ts` — forskjellen er at BingoEngine bruker `wallet.transfer()`
 * og får TRANSFER_OUT, mens Game1TicketPurchaseService bruker `wallet.debit()`
 * og får DEBIT. Begge har samme `split`-felt-kontrakt.
 *
 * Hvorfor ikke gjenbruke helper fra BingoEngine.ts?
 *   - Service-laget skal ikke importere fra engine-laget.
 *   - Den gjenbrukte logikken er 4 linjer — duplisering er billigere enn en
 *     ny utils-modul.
 *
 * Regulatorisk:
 *   - `split.fromDeposit` (kroner) → teller mot Spillvett-tapsgrense.
 *   - `split.fromWinnings` → teller IKKE (gevinst-bruk er ikke tap).
 *   - Fallback ved manglende split (legacy-path): returnér full `total` så
 *     compliance bevares bakoverkompatibelt.
 *   - NaN/negativ → 0 (fail-safe).
 *
 * Se docs/architecture/WALLET_SPLIT_DESIGN_2026-04-22.md §3.4.
 *
 * @param tx `wallet.debit()`-transaksjonen — kan være DEBIT eller TRANSFER_OUT.
 * @param total Full beløpet som ble trukket (kroner), brukt som fallback når
 *   `split` mangler.
 * @returns Beløpet som skal telle mot loss-limit. Alltid ≥ 0.
 */
function lossLimitAmountFromDebit(
  tx: WalletTransaction,
  total: number
): number {
  const split = tx.split;
  if (!split) {
    // Legacy-path — adapteren returnerte ikke split. Konservativ: tell full.
    log.debug(
      { txId: tx.id, total },
      "[PR-W5] wallet-tx mangler split — bruker full beløp som loss-amount (fallback)"
    );
    return total;
  }
  const fromDeposit = Number.isFinite(split.fromDeposit) ? split.fromDeposit : 0;
  // Rund til 2 desimaler (kroner/øre-presisjon) for å matche domeneverdier.
  const rounded = Math.round(fromDeposit * 100) / 100;
  return Math.max(0, rounded);
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
