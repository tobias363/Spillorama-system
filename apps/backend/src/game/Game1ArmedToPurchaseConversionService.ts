/**
 * Pilot-blokker-fix 2026-05-12 (Tobias-direktiv): bonger kjøpt FØR master
 * trykker Start MÅ være LIVE i runden.
 *
 * # Bakgrunn — root cause
 *
 * Spill 1's lobby-flyt har følgende sekvens når en spiller kjøper bonger
 * mens lobby-rommet er åpent (ingen aktiv scheduled-game enda):
 *
 *   1. Klient sender `bet:arm` til lobby-rom (eks. `BINGO_DEMO-PILOT-GOH`).
 *   2. `roomEvents.ts`-handleren:
 *      a. Reserverer wallet-saldo via `walletAdapter.reserve(...)` med
 *         `roomCode = lobby-rom-kode`.
 *      b. Lagrer in-memory armed-state via `armPlayer(roomCode, playerId,
 *         ticketCount, selections)` på `RoomStateManager`.
 *      c. Lagrer `reservationId` via `setReservationId(roomCode, playerId,
 *         id)` på `RoomStateManager`.
 *   3. Master trykker Start → `MasterActionService.start()`:
 *      a. Plan-runtime overgang `idle → running`.
 *      b. Bridge spawner ny `app_game1_scheduled_games`-rad.
 *      c. `masterControlService.startGame` → `Game1DrawEngineService.startGame`.
 *      d. `drawEngine.startGame` leser `ticketPurchase.listPurchasesForGame
 *         (scheduledGameId)` → **finner 0 rader** → genererer 0 ticket-
 *         assignments → spilleren ser ingen brett som LIVE.
 *
 * Bonger kjøpt i lobby-rom blir bare in-memory armed-state og en stillende
 * wallet-reservasjon. De konverteres aldri til faktiske
 * `app_game1_ticket_purchases`-rader. Resultat: spiller får tilbake pengene
 * (ved gameEnded → reservation rollback) men spiller fikk ingen brett.
 *
 * # Fix — denne service-en
 *
 * `Game1ArmedToPurchaseConversionService` triggers fra `MasterActionService`
 * RETT ETTER `bridge.createScheduledGameForPlanRunPosition` har INSERT-et
 * `app_game1_scheduled_games`-raden (og bundet `roomCode`). For hver
 * armed spiller:
 *
 *   1. Resolve `walletId` + `userId` fra room-snapshot.
 *   2. Resolve `hallId` (spillerens kjøpe-hall — IKKE master-hallens hall
 *      per BIN-443).
 *   3. Bygg `ticketSpec` fra armed selections (eller flat ticketCount-
 *      fallback) med korrekt color + size + priceCentsEach.
 *   4. Commit wallet-reservasjon via `walletAdapter.commitReservation(...)`
 *      med deterministisk idempotency-key. Pengene flyttes fra player →
 *      house-account (samme effekt som Game1TicketPurchaseService.purchase
 *      sin wallet-debit).
 *   5. INSERT `app_game1_ticket_purchases`-rad med deterministisk
 *      `idempotency_key = IdempotencyKeys.game1ArmedConversion(...)`.
 *      UNIQUE-violation → idempotent re-conversion (returnerer eksisterende
 *      rad).
 *   6. Skriv §71 STAKE-event til ComplianceLedgerPort. Soft-fail (matcher
 *      Game1TicketPurchaseService K1-mønsteret).
 *   7. Skriv BUYIN-loss-entry til ComplianceLossPort. Soft-fail.
 *   8. Audit-log `game1.armed.conversion`-event med før/etter-snapshot.
 *
 * # Atomisitet
 *
 * Hver spillers konvertering wrappes i egen try/catch. En spillers
 * feil stopper IKKE konverteringen for de andre — vi fortsetter loopen og
 * returnerer `failures[]`. Dette matcher `refundAllForGame`-mønsteret i
 * `Game1TicketPurchaseService`.
 *
 * Hvis en spiller feiler under commit:
 *   - INSUFFICIENT_FUNDS (reservasjon utilstrekkelig): release reservasjon,
 *     log failure. **Ingen** delvis-konvertering — alt-eller-ingenting per
 *     spiller for å unngå at spiller får færre brett enn betalt for.
 *   - INVALID_STATE (reservasjon allerede committed/released): hopp over,
 *     log warn. Hvis det allerede finnes en purchase-rad er det fra en
 *     tidligere retry — idempotent. Hvis ingen rad finnes, har vi tap
 *     (operations må refundere manuelt).
 *   - COMPLIANCE_BLOCK (loss-limit truffet siden bet:arm): release
 *     reservasjon, log failure. Spiller fikk pengene tilbake.
 *
 * # Idempotens
 *
 * Service-en er idempotent på (scheduledGameId, playerId). Retry-en
 * `commitReservation`-keyen er deterministisk via
 * `IdempotencyKeys.game1ArmedConversionCommit` — wallet-adapter dedup
 * sørger for at en allerede committed reservasjon retry-es uten dobbelt-
 * debet. INSERT-keyen er `IdempotencyKeys.game1ArmedConversion` (uten
 * `:commit-reservation`-suffix). UNIQUE-violation → returner eksisterende
 * rad.
 *
 * # Wallet-binding (BIN-443)
 *
 * `actor_hall_id` på `app_game1_ticket_purchases` MÅ være spillerens hall
 * (room.players[].hallId for hall-shared rom, ellers `room.hallId` for
 * single-hall lobby). IKKE master-hallens hall. ComplianceLedger §71-
 * rapport blir riktig per hall for multi-hall-runder.
 *
 * # Audit-trail
 *
 * Hver vellykket konvertering skriver `game1.armed.conversion`-event til
 * AuditLogService med:
 *   - actorId: spillerens user-id
 *   - actorType: PLAYER
 *   - resource: 'game1_ticket_purchase'
 *   - resourceId: purchase-id
 *   - details: { scheduledGameId, playerId, hallId, totalAmountCents,
 *               ticketCount, reservationId, walletTxId }
 *
 * Hver failure skriver `game1.armed.conversion_failed`-event med samme
 * shape pluss `failureReason` + `refundedAmountCents`.
 */

import type { Pool } from "pg";

import { DomainError } from "../errors/DomainError.js";
import { IdempotencyKeys } from "./idempotency.js";
import { logger as rootLogger } from "../util/logger.js";
import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";
import type {
  WalletAdapter,
  WalletTransferResult,
} from "../adapters/WalletAdapter.js";
import type {
  AuditLogService,
} from "../compliance/AuditLogService.js";
import type {
  ComplianceLedgerPort,
} from "../adapters/ComplianceLedgerPort.js";
import {
  NoopComplianceLedgerPort,
} from "../adapters/ComplianceLedgerPort.js";
import type {
  ComplianceLossPort,
} from "../adapters/ComplianceLossPort.js";
import {
  NoopComplianceLossPort,
} from "../adapters/ComplianceLossPort.js";

const log = rootLogger.child({
  module: "game1-armed-to-purchase-conversion-service",
});

// ── Public types ──────────────────────────────────────────────────────────────

export type Game1TicketSize = "small" | "large";

export interface Game1ArmedTicketSpecEntry {
  /** Color-key matching `ticket_config_json` (eks. "yellow", "white", "purple"). */
  color: string;
  size: Game1TicketSize;
  count: number;
  priceCentsEach: number;
}

/**
 * Per-spiller armed-state som service-en konsumerer. Caller (MasterAction
 * Service) sammenstiller dette fra:
 *   - `roomState.getArmedPlayerIds(lobbyRoomCode)`
 *   - `roomState.getArmedPlayerSelections(lobbyRoomCode)`
 *   - `roomState.getReservationId(lobbyRoomCode, playerId)`
 *   - `engine.getRoomSnapshot(lobbyRoomCode).players[].walletId` + hallId
 *
 * Service-en gjør IKKE direkte oppslag mot armedLookup eller engine for
 * å holde testbarhet høy (mock-vennlig input-shape).
 */
export interface ArmedPlayerInput {
  /** Plattform-bruker-id (FK til app_users) — IKKE socket-rom-spiller-id. */
  userId: string;
  /** Wallet-id for commit-reservation. */
  walletId: string;
  /**
   * Spillerens kjøpe-hall. BIN-443: bind compliance-ledger til denne, ikke
   * master-hallen. For single-hall lobby-rom = room.hallId. For hall-shared
   * lobby (GoH) = player.hallId fra engine room-snapshot.
   */
  hallId: string;
  /** Wallet-reservation-id fra bet:arm-flyten (roomState.getReservationId). */
  reservationId: string;
  /** ticketSpec — color/size/count/priceCentsEach per entry. */
  ticketSpec: Game1ArmedTicketSpecEntry[];
}

export interface ConvertArmedToPurchasesInput {
  /**
   * Scheduled-game-id som armed-statet skal konverteres MOT. Bridgen har
   * nettopp INSERT-et raden — purchase-radene FK-references denne id-en.
   */
  scheduledGameId: string;
  /** Lobby-rom-koden hvor armed-statet ligger (eks. BINGO_DEMO-PILOT-GOH). */
  lobbyRoomCode: string;
  /** Master-actor som triggret start (for audit-actorId på success-events). */
  actorUserId: string;
  /** Armed spillere som skal konverteres. */
  armedPlayers: ArmedPlayerInput[];
}

export interface ConvertedPurchase {
  userId: string;
  purchaseId: string;
  walletTxId: string;
  reservationId: string;
  ticketCount: number;
  totalAmountCents: number;
  idempotencyKey: string;
}

export interface ConversionFailure {
  userId: string;
  reservationId: string;
  reason: string;
  refundedAmountCents: number;
  errorCode: string;
}

export interface ConvertArmedToPurchasesResult {
  scheduledGameId: string;
  convertedCount: number;
  conversions: ConvertedPurchase[];
  failures: ConversionFailure[];
}

export interface Game1ArmedToPurchaseConversionServiceOptions {
  pool: Pool;
  schema?: string;
  walletAdapter: WalletAdapter;
  auditLogService: AuditLogService;
  complianceLedgerPort?: ComplianceLedgerPort;
  complianceLossPort?: ComplianceLossPort;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface ScheduledGameRow {
  id: string;
  master_hall_id: string;
  ticket_config_json: unknown;
}

interface PurchaseInsertResult {
  purchaseId: string;
  alreadyExisted: boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class Game1ArmedToPurchaseConversionService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly wallet: WalletAdapter;
  private readonly audit: AuditLogService;
  private readonly complianceLedgerPort: ComplianceLedgerPort;
  private readonly complianceLossPort: ComplianceLossPort;

  constructor(options: Game1ArmedToPurchaseConversionServiceOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.schema = schema;
    this.wallet = options.walletAdapter;
    this.audit = options.auditLogService;
    this.complianceLedgerPort =
      options.complianceLedgerPort ?? new NoopComplianceLedgerPort();
    this.complianceLossPort =
      options.complianceLossPort ?? new NoopComplianceLossPort();
  }

  /** @internal — test-hook. */
  static forTesting(
    opts: Game1ArmedToPurchaseConversionServiceOptions,
  ): Game1ArmedToPurchaseConversionService {
    return new Game1ArmedToPurchaseConversionService(opts);
  }

  private purchasesTable(): string {
    return `"${this.schema}"."app_game1_ticket_purchases"`;
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Konverter armed-state for alle armed spillere i input til
   * `app_game1_ticket_purchases`-rader. Idempotent på (scheduledGameId,
   * userId) — retry returnerer eksisterende rader uten dobbel-debet.
   *
   * Per-spiller atomicitet: én feil stopper IKKE de andre. Failures
   * returneres separat for caller-side observabilitet/alerting.
   */
  async convertArmedToPurchases(
    input: ConvertArmedToPurchasesInput,
  ): Promise<ConvertArmedToPurchasesResult> {
    this.validateInput(input);

    // No-op short-circuit: tomt armed-set → ingen jobb. Brukes når master
    // starter et spill der ingen spillere har kjøpt bonger ennå (legitim
    // case — runden kjører videre, men ingen brett finnes).
    if (input.armedPlayers.length === 0) {
      log.info(
        { scheduledGameId: input.scheduledGameId },
        "[armed-conversion] tomt armed-set — ingen konvertering nødvendig",
      );
      return {
        scheduledGameId: input.scheduledGameId,
        convertedCount: 0,
        conversions: [],
        failures: [],
      };
    }

    // Load scheduled-game once for cross-player validering. master_hall_id
    // brukes IKKE som hallId per BIN-443 — hallId hentes fra ArmedPlayerInput.
    const game = await this.loadScheduledGame(input.scheduledGameId);

    const result: ConvertArmedToPurchasesResult = {
      scheduledGameId: input.scheduledGameId,
      convertedCount: 0,
      conversions: [],
      failures: [],
    };

    log.info(
      {
        scheduledGameId: input.scheduledGameId,
        lobbyRoomCode: input.lobbyRoomCode,
        armedPlayerCount: input.armedPlayers.length,
      },
      "[armed-conversion] starter konvertering",
    );

    for (const player of input.armedPlayers) {
      try {
        const conversion = await this.convertSingle(input, game, player);
        result.conversions.push(conversion);
        result.convertedCount += 1;
      } catch (err) {
        const failure = await this.handleSingleFailure(
          input,
          player,
          err,
        );
        result.failures.push(failure);
      }
    }

    log.info(
      {
        scheduledGameId: input.scheduledGameId,
        totalArmed: input.armedPlayers.length,
        convertedCount: result.convertedCount,
        failureCount: result.failures.length,
      },
      "[armed-conversion] fullført",
    );

    return result;
  }

  // ── Private: per-player conversion ────────────────────────────────────────

  private async convertSingle(
    input: ConvertArmedToPurchasesInput,
    game: ScheduledGameRow,
    player: ArmedPlayerInput,
  ): Promise<ConvertedPurchase> {
    const totalAmountCents = sumTotalCents(player.ticketSpec);
    if (totalAmountCents <= 0) {
      throw new DomainError(
        "INVALID_TICKET_SPEC",
        "ticketSpec gir totalAmountCents <= 0 — kan ikke konvertere tomt kjøp.",
      );
    }
    const ticketCount = sumTicketCount(player.ticketSpec);

    const idempotencyKey = IdempotencyKeys.game1ArmedConversion({
      scheduledGameId: input.scheduledGameId,
      playerId: player.userId,
    });

    // Idempotent kort-slutt: finnes purchase-rad allerede? Hvis ja, retry
    // av samme konvertering — return existing.
    const existing = await this.findPurchaseByIdempotencyKey(idempotencyKey);
    if (existing) {
      log.debug(
        {
          scheduledGameId: input.scheduledGameId,
          userId: player.userId,
          purchaseId: existing.id,
        },
        "[armed-conversion] idempotent re-conversion — returnerer eksisterende purchase",
      );
      return {
        userId: player.userId,
        purchaseId: existing.id,
        walletTxId: existing.refund_transaction_id ?? "",
        reservationId: player.reservationId,
        ticketCount,
        totalAmountCents: Number(existing.total_amount_cents),
        idempotencyKey,
      };
    }

    // Commit wallet-reservation. Idempotency-key sikrer at retry av en
    // allerede committed reservasjon returnerer samme transfer-resultat
    // uten å rulle saldo eller skrive duplikat ledger-entries.
    //
    // toAccountId: house-account for kjøpe-hallen. Resolves via
    // walletAdapter sin standard makeHouseAccountId-mønster — vi bygger
    // den lokalt fordi vi ikke har direkte tilgang til ledger her, men
    // formatet er stabilt: `house-<hallId>-<gameType>-<channel>`.
    const channel = "INTERNET"; // bet:arm er alltid online-flyt
    const gameType = ledgerGameTypeForSlug("bingo");
    const houseAccountId = `house-${player.hallId}-${gameType.toLowerCase()}-${channel.toLowerCase()}`;

    if (!this.wallet.commitReservation) {
      throw new DomainError(
        "WALLET_NOT_CONFIGURED",
        "WalletAdapter mangler commitReservation — armed-conversion er ikke støttet.",
      );
    }

    let transfer: WalletTransferResult;
    try {
      transfer = await this.wallet.commitReservation(
        player.reservationId,
        houseAccountId,
        `game1_armed_conversion:${input.scheduledGameId}:${player.userId}`,
        {
          gameSessionId: input.scheduledGameId,
          idempotencyKey: IdempotencyKeys.game1ArmedConversionCommit({
            scheduledGameId: input.scheduledGameId,
            playerId: player.userId,
          }),
        },
      );
    } catch (err) {
      // Map known wallet-errors til DomainError-koder caller forventer.
      const walletErr = err as { code?: string; message?: string } | null;
      const code = walletErr?.code ?? "WALLET_COMMIT_FAILED";
      throw new DomainError(
        code === "RESERVATION_NOT_FOUND"
          ? "RESERVATION_NOT_FOUND"
          : code === "INVALID_STATE"
            ? "RESERVATION_NOT_ACTIVE"
            : code === "INSUFFICIENT_FUNDS"
              ? "INSUFFICIENT_FUNDS"
              : "WALLET_COMMIT_FAILED",
        walletErr?.message ?? "Wallet commit-reservation feilet.",
        {
          reservationId: player.reservationId,
          originalCode: code,
        },
      );
    }

    // INSERT purchase-rad. UNIQUE(idempotency_key) gjør retry idempotent.
    // Hvis wallet er allerede committed (over) men INSERT feiler her, er
    // vi i en degenerert state — wallet adapter dedup ved retry returnerer
    // samme transfer, og INSERT vil enten lykkes (idempotent for samme key)
    // eller treffe UNIQUE-violation (annet purchase-row vant racet).
    const purchaseResult = await this.insertPurchaseRow({
      scheduledGameId: input.scheduledGameId,
      buyerUserId: player.userId,
      hallId: player.hallId,
      ticketSpec: player.ticketSpec,
      totalAmountCents,
      idempotencyKey,
    });

    // Compliance-ledger STAKE-event (§71). hallId = kjøpe-hall per BIN-443.
    // Soft-fail per K1-mønster (Game1TicketPurchaseService:621-667). Feil
    // i compliance-skriv ruller IKKE tilbake wallet-commit — det er allerede
    // permanent. Audit-logging av disse feilene gjør at ops kan re-skrive.
    try {
      await this.complianceLedgerPort.recordComplianceLedgerEvent({
        hallId: player.hallId,
        gameType,
        channel,
        eventType: "STAKE",
        amount: totalAmountCents / 100,
        gameId: input.scheduledGameId,
        playerId: player.userId,
        walletId: player.walletId,
        sourceAccountId: transfer.fromTx.accountId,
        targetAccountId: transfer.toTx.accountId,
        metadata: {
          reason: "GAME1_ARMED_CONVERSION",
          purchaseId: purchaseResult.purchaseId,
          paymentMethod: "digital_wallet",
          ticketCount,
          reservationId: player.reservationId,
        },
      });
    } catch (err) {
      log.warn(
        {
          err,
          purchaseId: purchaseResult.purchaseId,
          scheduledGameId: input.scheduledGameId,
          hallId: player.hallId,
        },
        "[armed-conversion] ComplianceLedger STAKE feilet — konvertering fortsetter",
      );
    }

    // PR-W5 wallet-split: logg BUYIN mot Spillvett-tapsgrense (kun deposit-
    // delen). Vi bruker fromTx.split hvis tilgjengelig; fallback til full
    // total. Soft-fail samme som STAKE.
    try {
      const buyInLossAmount = lossLimitAmountFromTransferFrom(
        transfer.fromTx,
        totalAmountCents / 100,
      );
      if (buyInLossAmount > 0) {
        await this.complianceLossPort.recordLossEntry(
          player.walletId,
          player.hallId,
          {
            type: "BUYIN",
            amount: buyInLossAmount,
            createdAtMs: Date.now(),
          },
        );
      }
    } catch (err) {
      log.warn(
        {
          err,
          purchaseId: purchaseResult.purchaseId,
          scheduledGameId: input.scheduledGameId,
          walletId: player.walletId,
        },
        "[armed-conversion] ComplianceLoss BUYIN feilet — konvertering fortsetter",
      );
    }

    // Audit-log: vellykket konvertering.
    this.fireAudit({
      actorId: player.userId,
      action: "game1.armed.conversion",
      resourceId: purchaseResult.purchaseId,
      details: {
        scheduledGameId: input.scheduledGameId,
        lobbyRoomCode: input.lobbyRoomCode,
        userId: player.userId,
        hallId: player.hallId,
        walletId: player.walletId,
        reservationId: player.reservationId,
        walletTxId: transfer.fromTx.id,
        totalAmountCents,
        ticketCount,
        idempotencyKey,
        triggeredByMasterUserId: input.actorUserId,
      },
    });

    log.info(
      {
        scheduledGameId: input.scheduledGameId,
        userId: player.userId,
        hallId: player.hallId,
        purchaseId: purchaseResult.purchaseId,
        totalAmountCents,
        ticketCount,
        walletTxId: transfer.fromTx.id,
      },
      "[armed-conversion] purchase opprettet + wallet committed",
    );

    return {
      userId: player.userId,
      purchaseId: purchaseResult.purchaseId,
      walletTxId: transfer.fromTx.id,
      reservationId: player.reservationId,
      ticketCount,
      totalAmountCents,
      idempotencyKey,
    };
  }

  // ── Private: failure-handling ─────────────────────────────────────────────

  private async handleSingleFailure(
    input: ConvertArmedToPurchasesInput,
    player: ArmedPlayerInput,
    err: unknown,
  ): Promise<ConversionFailure> {
    const totalAmountCents = sumTotalCents(player.ticketSpec);
    const errorCode =
      err instanceof DomainError ? err.code : "CONVERSION_FAILED_UNEXPECTED";
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    // Hvis wallet allerede er committed (reservasjon i 'committed'-state),
    // har vi pengene på house-account men ingen purchase-rad. Beste forsøk:
    // log critical så ops kan refundere manuelt. IKKE prøv å rulle wallet
    // tilbake — det krever en fresh credit som vil dobbel-belaste hvis
    // INSERT lykkes ved retry.
    //
    // Hvis wallet IKKE er committed (de fleste tilfeller — wallet-commit
    // feilet eller INSERT feilet før commit), skal reservasjonen være
    // intakt eller allerede released av wallet-adapteren. Vi forsøker å
    // releasee defensivt.
    let refundedAmountCents = 0;
    if (
      errorCode !== "RESERVATION_NOT_ACTIVE" &&
      errorCode !== "RESERVATION_NOT_FOUND"
    ) {
      try {
        if (this.wallet.releaseReservation) {
          await this.wallet.releaseReservation(player.reservationId);
          refundedAmountCents = totalAmountCents;
        }
      } catch (releaseErr) {
        log.warn(
          {
            err: releaseErr,
            reservationId: player.reservationId,
            originalErrorCode: errorCode,
          },
          "[armed-conversion] release-reservation feilet etter konvertering-feil — kan være allerede committed",
        );
      }
    }

    log.error(
      {
        err,
        errorCode,
        scheduledGameId: input.scheduledGameId,
        userId: player.userId,
        hallId: player.hallId,
        reservationId: player.reservationId,
        totalAmountCents,
        refundedAmountCents,
      },
      "[armed-conversion] konvertering feilet — refund-status logget",
    );

    // Audit-log: failure-event (separat resource-id siden vi ikke har
    // purchase-id ved failure).
    this.fireAudit({
      actorId: player.userId,
      action: "game1.armed.conversion_failed",
      resourceId: input.scheduledGameId,
      details: {
        scheduledGameId: input.scheduledGameId,
        lobbyRoomCode: input.lobbyRoomCode,
        userId: player.userId,
        hallId: player.hallId,
        walletId: player.walletId,
        reservationId: player.reservationId,
        totalAmountCents,
        refundedAmountCents,
        errorCode,
        errorMessage,
        triggeredByMasterUserId: input.actorUserId,
      },
    });

    return {
      userId: player.userId,
      reservationId: player.reservationId,
      reason: errorMessage,
      refundedAmountCents,
      errorCode,
    };
  }

  // ── Private: DB helpers ───────────────────────────────────────────────────

  private async loadScheduledGame(
    scheduledGameId: string,
  ): Promise<ScheduledGameRow> {
    // BIND-FIX 2026-05-13 (pilot-blokker): app_game1_scheduled_games har
    // IKKE en `hall_id`-kolonne — kun `master_hall_id` (master-hallen)
    // og `group_hall_id` (GoH-en). PR #1284 hadde en typo som refererte
    // til ikke-eksisterende `hall_id` → PG-feilen kastet 42703 → hook
    // kastet → MasterActionService logget warning og engine.startGame
    // kjørte videre uten konvertering. Resultat: 0 purchases på tross av
    // armed bonger. Fix: bruk korrekt kolonnenavn `master_hall_id`.
    const { rows } = await this.pool.query<ScheduledGameRow>(
      `SELECT id, master_hall_id, ticket_config_json
         FROM ${this.scheduledGamesTable()}
        WHERE id = $1`,
      [scheduledGameId],
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        "GAME_NOT_FOUND",
        `Scheduled-game ${scheduledGameId} finnes ikke.`,
      );
    }
    return row;
  }

  private async findPurchaseByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<{
    id: string;
    total_amount_cents: string | number;
    refund_transaction_id: string | null;
  } | null> {
    const { rows } = await this.pool.query<{
      id: string;
      total_amount_cents: string | number;
      refund_transaction_id: string | null;
    }>(
      `SELECT id, total_amount_cents, refund_transaction_id
         FROM ${this.purchasesTable()}
        WHERE idempotency_key = $1
        LIMIT 1`,
      [idempotencyKey],
    );
    return rows[0] ?? null;
  }

  private async insertPurchaseRow(input: {
    scheduledGameId: string;
    buyerUserId: string;
    hallId: string;
    ticketSpec: Game1ArmedTicketSpecEntry[];
    totalAmountCents: number;
    idempotencyKey: string;
  }): Promise<PurchaseInsertResult> {
    // Generer purchase-id deterministisk fra idempotency-key så retry kan
    // matche samme rad. Format matcher Game1TicketPurchaseService (`g1p-`)
    // for ops-konsistens.
    const purchaseId = `g1p-${hashedIdFromKey(input.idempotencyKey)}`;

    try {
      await this.pool.query(
        `INSERT INTO ${this.purchasesTable()}
          (id, scheduled_game_id, buyer_user_id, hall_id,
           ticket_spec_json, total_amount_cents, payment_method,
           agent_user_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'digital_wallet', NULL, $7)`,
        [
          purchaseId,
          input.scheduledGameId,
          input.buyerUserId,
          input.hallId,
          JSON.stringify(input.ticketSpec),
          input.totalAmountCents,
          input.idempotencyKey,
        ],
      );
      return { purchaseId, alreadyExisted: false };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "23505") {
        // UNIQUE-violation på idempotency_key — annen retry vant racet eller
        // vi er på vei tilbake fra en partial-failure. Returner eksisterende
        // rad.
        const existing = await this.findPurchaseByIdempotencyKey(
          input.idempotencyKey,
        );
        if (existing) {
          return { purchaseId: existing.id, alreadyExisted: true };
        }
        throw new DomainError(
          "INSERT_RACE_INCONSISTENT",
          `UNIQUE-violation på idempotency_key men ingen rad funnet — degenerert state.`,
          { idempotencyKey: input.idempotencyKey },
        );
      }
      throw err;
    }
  }

  private fireAudit(event: {
    actorId: string;
    action: string;
    resourceId: string;
    details: Record<string, unknown>;
  }): void {
    this.audit
      .record({
        actorId: event.actorId,
        actorType: "PLAYER",
        action: event.action,
        resource: "game1_ticket_purchase",
        resourceId: event.resourceId,
        details: event.details,
      })
      .catch((err) => {
        log.warn(
          {
            err,
            action: event.action,
            resourceId: event.resourceId,
          },
          "[armed-conversion] audit append failed",
        );
      });
  }

  private validateInput(input: ConvertArmedToPurchasesInput): void {
    if (!input.scheduledGameId?.trim()) {
      throw new DomainError(
        "INVALID_INPUT",
        "scheduledGameId er påkrevd.",
      );
    }
    if (!input.lobbyRoomCode?.trim()) {
      throw new DomainError(
        "INVALID_INPUT",
        "lobbyRoomCode er påkrevd.",
      );
    }
    if (!input.actorUserId?.trim()) {
      throw new DomainError(
        "INVALID_INPUT",
        "actorUserId er påkrevd.",
      );
    }
    if (!Array.isArray(input.armedPlayers)) {
      throw new DomainError(
        "INVALID_INPUT",
        "armedPlayers må være et array.",
      );
    }
    for (const player of input.armedPlayers) {
      if (!player.userId?.trim()) {
        throw new DomainError(
          "INVALID_INPUT",
          "armedPlayer.userId er påkrevd.",
        );
      }
      if (!player.walletId?.trim()) {
        throw new DomainError(
          "INVALID_INPUT",
          "armedPlayer.walletId er påkrevd.",
        );
      }
      if (!player.hallId?.trim()) {
        throw new DomainError(
          "INVALID_INPUT",
          "armedPlayer.hallId er påkrevd.",
        );
      }
      if (!player.reservationId?.trim()) {
        throw new DomainError(
          "INVALID_INPUT",
          "armedPlayer.reservationId er påkrevd.",
        );
      }
      if (
        !Array.isArray(player.ticketSpec) ||
        player.ticketSpec.length === 0
      ) {
        throw new DomainError(
          "INVALID_TICKET_SPEC",
          "armedPlayer.ticketSpec må være et ikke-tomt array.",
        );
      }
      for (const entry of player.ticketSpec) {
        if (
          !entry ||
          typeof entry !== "object" ||
          typeof entry.color !== "string" ||
          !entry.color.trim() ||
          (entry.size !== "small" && entry.size !== "large") ||
          !Number.isInteger(entry.count) ||
          entry.count < 1 ||
          !Number.isFinite(entry.priceCentsEach) ||
          entry.priceCentsEach < 0 ||
          !Number.isInteger(entry.priceCentsEach)
        ) {
          throw new DomainError(
            "INVALID_TICKET_SPEC",
            "Ugyldig ticketSpec-entry shape.",
          );
        }
      }
    }
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function sumTotalCents(spec: Game1ArmedTicketSpecEntry[]): number {
  return spec.reduce((sum, e) => sum + e.count * e.priceCentsEach, 0);
}

function sumTicketCount(spec: Game1ArmedTicketSpecEntry[]): number {
  return spec.reduce((sum, e) => sum + e.count, 0);
}

/**
 * Deterministisk hash av idempotency-key for purchase-id. Vi bruker en
 * enkel base36-hash som er stabil for samme input — sikker nok for
 * intern ID-genering (id-en er ikke security-relevant, kun unik). 32 chars
 * UUID-lookalike for ops-konsistens med Game1TicketPurchaseService som
 * bruker `randomUUID`.
 *
 * Note: vi bruker IKKE randomUUID her fordi retry MÅ produsere samme
 * purchase-id for samme idempotency-key. UNIQUE-violation er backup-trygg,
 * men deterministisk id-er gjør INSERT idempotent uten roundtrip-til-DB.
 */
function hashedIdFromKey(key: string): string {
  // Simple FNV-1a hash → base36 string. 64-bit-likt output via dobbel hash.
  let h1 = 2166136261 >>> 0;
  let h2 = 0x9747b28c >>> 0;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2654435761) >>> 0;
  }
  const part1 = h1.toString(36).padStart(7, "0");
  const part2 = h2.toString(36).padStart(7, "0");
  // Append a deterministic 4-char tail derived from length to reduce
  // collision risk further; total ~18 chars.
  const tail = (key.length * 31 + 17).toString(36).padStart(4, "0");
  return `${part1}-${part2}-${tail}`;
}

/**
 * Trekk ut deposit-delen av en TRANSFER_OUT-transaksjon for loss-limit
 * (Spillvett-tapsgrense). Speilet av `lossLimitAmountFromDebit` i
 * Game1TicketPurchaseService — service-laget skal ikke importere fra engine-
 * eller annet service-lag.
 */
function lossLimitAmountFromTransferFrom(
  tx: {
    split?: { fromDeposit: number; fromWinnings: number } | null;
  },
  total: number,
): number {
  const split = tx.split;
  if (!split) return total;
  const fromDeposit = Number.isFinite(split.fromDeposit)
    ? split.fromDeposit
    : 0;
  const rounded = Math.round(fromDeposit * 100) / 100;
  return Math.max(0, rounded);
}
