import { randomUUID, createHash } from "node:crypto";
import type { BingoSystemAdapter } from "../adapters/BingoSystemAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { IdempotencyKeys } from "./idempotency.js";
import { roundCurrency } from "../util/currency.js";
import { logger as rootLogger } from "../util/logger.js";
import * as variantConfigModule from "./variantConfig.js";

const logger = rootLogger.child({ module: "engine" });
import {
  findFirstCompleteLinePatternIndex,
  hasFullBingo,
  makeRoomCode,
  ticketContainsNumber,
} from "./ticket.js";
import { buildDrawBag, resolveDrawBagConfig } from "./DrawBagStrategy.js";
import type {
  ClaimRecord,
  ClaimType,
  GameSnapshot,
  GameState,
  JackpotState,
  MiniGameState,
  MiniGameType,
  PatternDefinition,
  PatternResult,
  Player,
  RecoverableGameSnapshot,
  RoomSnapshot,
  RoomState,
  RoomSummary,
  Ticket
} from "./types.js";
import { InMemoryRoomStateStore, type RoomStateStore } from "../store/RoomStateStore.js";
import type {
  ResponsibleGamingPersistenceAdapter
} from "./ResponsibleGamingPersistence.js";
import { ComplianceManager } from "./ComplianceManager.js";
import type {
  LossLimits,
  PlayerComplianceSnapshot
} from "./ComplianceManager.js";
import type { WalletTransaction, WalletTransferResult } from "../adapters/WalletAdapter.js";

/**
 * PR-W4 wallet-split: returnerer beløpet som skal telles mot tapsgrense for et
 * buy-in-trekk (`compliance.recordLossEntry({type:"BUYIN", amount})`).
 *
 * **Regulatorisk regel (pengespillforskriften §11):** kun deposit-delen av et
 * kjøp skal telle som tap. Gevinst-konto-bruk skal IKKE øke netto-tap — ellers
 * ville vi straffet spilleren for å spille med eksisterende gevinster.
 *
 * **Fail-closed-fallback:** hvis `split` mangler (TRANSFER_OUT-tx fra legacy
 * adapter før W1, eller test-mock som ikke populerer split), bruker vi `total`
 * som amount. Dette bevarer eksisterende semantikk (alt teller som tap) så
 * ingen tester brekker, og nye entries fra split-aware adaptere bruker riktig
 * deposit-del. Design-dok § 3.4 + § 9.3.
 *
 * @param fromTx TRANSFER_OUT-transaksjonen fra wallet.transfer — har `split`
 *   populert av split-aware adaptere (PostgresWalletAdapter post-W1,
 *   InMemoryWalletAdapter post-W1).
 * @param total Full beløpet som ble trukket — fallback hvis split mangler.
 * @returns Beløpet i kroner som skal telle mot loss-limit. Alltid ≥ 0.
 */
export function lossLimitAmountFromTransfer(
  fromTx: WalletTransaction,
  total: number,
): number {
  const split = fromTx.split;
  if (!split) {
    // Legacy/test-path uten split — bevar gammel oppførsel (alt er deposit).
    logger.debug(
      { txId: fromTx.id, total },
      "[PR-W4] wallet-tx mangler split — bruker full beløp som loss-amount (fallback)",
    );
    return total;
  }
  // split.fromDeposit er i kroner (per WalletTransactionSplit-kontrakt).
  const fromDeposit = Number.isFinite(split.fromDeposit) ? split.fromDeposit : 0;
  return Math.max(0, roundCurrency(fromDeposit));
}
import { PrizePolicyManager } from "./PrizePolicyManager.js";
import type { PrizeGameType, PrizePolicySnapshot, ExtraDrawDenialAudit } from "./PrizePolicyManager.js";
import { PayoutAuditTrail } from "./PayoutAuditTrail.js";
import type { PayoutAuditEvent } from "./PayoutAuditTrail.js";
import { ComplianceLedger } from "./ComplianceLedger.js";
import type { LedgerGameType, LedgerChannel, ComplianceLedgerEntry, DailyComplianceReport, RangeComplianceReport, GameStatisticsReport, OrganizationAllocationInput, OverskuddDistributionBatch, RevenueSummary, TimeSeriesReport, TimeSeriesGranularity, TopPlayersReport, GameSessionsReport } from "./ComplianceLedger.js";
import type { LoyaltyPointsHookPort } from "../adapters/LoyaltyPointsHookPort.js";
import { NoopLoyaltyPointsHookPort } from "../adapters/LoyaltyPointsHookPort.js";
import type { SplitRoundingAuditPort } from "../adapters/SplitRoundingAuditPort.js";
import { NoopSplitRoundingAuditPort } from "../adapters/SplitRoundingAuditPort.js";
// Extracted helpers (refactor/s1-bingo-engine-split — Forslag A)
import {
  activateJackpot as activateJackpotHelper,
  spinJackpot as spinJackpotHelper,
  activateMiniGame as activateMiniGameHelper,
  playMiniGame as playMiniGameHelper,
  type MiniGamesContext,
  type MiniGameRotationState,
} from "./BingoEngineMiniGames.js";
import {
  serializeGameForRecovery as serializeGameForRecoveryHelper,
  writeDrawCheckpoint as writeDrawCheckpointHelper,
  writeGameEndCheckpoint as writeGameEndCheckpointHelper,
  writePayoutCheckpointWithRetry as writePayoutCheckpointWithRetryHelper,
  refundDebitedPlayers as refundDebitedPlayersHelper,
  restoreRoomFromSnapshot as restoreRoomFromSnapshotHelper,
  type RecoveryContext,
} from "./BingoEngineRecovery.js";
import {
  evaluateActivePhase as evaluateActivePhaseHelper,
  meetsPhaseRequirement as meetsPhaseRequirementHelper,
  type EvaluatePhaseCallbacks,
} from "./BingoEnginePatternEval.js";

export type {
  LossLimits,
  LossLedgerEntry,
  PlayerComplianceSnapshot,
  GameplayBlockType,
  PendingLossLimitField,
  PendingLossLimitChange,
  PlaySessionState,
  MandatoryBreakSummary,
  RestrictionState,
  GameplayBlockState
} from "./ComplianceManager.js";

export type {
  PrizeGameType,
  PrizePolicyVersion,
  PrizePolicySnapshot,
  ExtraPrizeEntry,
  ExtraDrawDenialAudit
} from "./PrizePolicyManager.js";

export type { PayoutAuditEvent } from "./PayoutAuditTrail.js";

export type {
  LedgerGameType,
  LedgerChannel,
  LedgerEventType,
  ComplianceLedgerEntry,
  DailyComplianceReportRow,
  DailyComplianceReport,
  OrganizationAllocationInput,
  OverskuddDistributionTransfer,
  OverskuddDistributionBatch
} from "./ComplianceLedger.js";

export class DomainError extends Error {
  public readonly code: string;
  /**
   * Valgfri strukturert kontekst som API-laget propagerer til klient via
   * `toPublicError(err).details`. Brukes f.eks. av `HALLS_NOT_READY` for å
   * returnere `{ unreadyHalls: [...] }` (Task 1.5 — agents-not-ready popup),
   * og av `JACKPOT_CONFIRM_REQUIRED` for å returnere nåværende pot-saldo
   * uten at klient må gjøre et ekstra API-kall (MASTER_PLAN §2.3).
   */
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

interface CreateRoomInput {
  playerName: string;
  hallId: string;
  walletId?: string;
  socketId?: string;
  /** Optional fixed room code (e.g. "BINGO1"). Skips random generation. */
  roomCode?: string;
  /** Game variant slug (e.g. "bingo", "rocket"). Stored on the room. */
  gameSlug?: string;
}

interface JoinRoomInput extends CreateRoomInput {
  roomCode: string;
}

interface StartGameInput {
  roomCode: string;
  actorPlayerId: string;
  entryFee?: number;
  ticketsPerPlayer?: number;
  payoutPercent: number;
  /** If provided, only these players get tickets. Others watch without playing. */
  armedPlayerIds?: string[];
  /**
   * Per-player ticket counts selected at arm time.
   * Maps playerId → number of tickets requested.
   * Falls back to `ticketsPerPlayer` for any player not in this map.
   */
  armedPlayerTicketCounts?: Record<string, number>;
  /**
   * Per-player ticket type selections from bet:arm.
   * Maps playerId → array of { type, qty }.
   * When present, ticket generation uses these instead of flat count + color cycling.
   */
  /**
   * BIN-693: `name` is optional on each selection so the engine can
   * distinguish Small Yellow from Small Purple (same `type: "small"`,
   * different colour). Without `name`, the engine falls back to
   * type-only matching which picks the first config entry — fine for
   * legacy clients that don't yet send `name`.
   */
  armedPlayerSelections?: Record<string, Array<{ type: string; qty: number; name?: string }>>;
  /**
   * BIN-693 Option B: reservasjons-id per armed spiller. Når satt, commit-er
   * engine reservasjonen i stedet for å gjøre direkte `walletAdapter.transfer`
   * — samme netto-effekt, men reservasjonen låses opp i stedet for å trekkes
   * fra "rå" saldo. Hvis mapping mangler for en spiller: fallback til legacy
   * transfer-path (samme kode som før).
   */
  reservationIdByPlayer?: Record<string, string>;
  /** Win-condition patterns for this round. Defaults to [1 Rad, Full Plate]. */
  patterns?: PatternDefinition[];
  /** Game variant type (from hall_game_schedules.game_type). */
  gameType?: string;
  /** Variant config with ticket types and patterns (from hall_game_schedules.variant_config). */
  variantConfig?: import("./variantConfig.js").GameVariantConfig;
  /** BIN-463: Test game — skip wallet operations. */
  isTestGame?: boolean;
  /**
   * BIN-690: Pre-round display-tickets shown to the player while they
   * were arming. When provided, `startGame` adopts the cached ticket
   * grids (and colours) as the real tickets instead of generating fresh
   * random grids — so the brett the player saw before the round starts
   * are EXACTLY the brett they play with.
   *
   * Shape: playerId → display-ticket[] (same objects that shipped in
   * preRoundTickets on the wire). The engine validates that the cached
   * ticket count matches the armed count before adopting; otherwise it
   * falls back to normal generation (defensive — cache may be stale if
   * arming changed after the last room:update).
   */
  preRoundTicketsByPlayerId?: Record<string, Ticket[]>;
}

const DEFAULT_PATTERNS: PatternDefinition[] = [
  { id: "1-rad",       name: "1 Rad",       claimType: "LINE",  prizePercent: 30, order: 1, design: 1 },
  { id: "full-plate",  name: "Full Plate",  claimType: "BINGO", prizePercent: 70, order: 2, design: 2 },
];

interface DrawNextInput {
  roomCode: string;
  actorPlayerId: string;
}

interface MarkNumberInput {
  roomCode: string;
  playerId: string;
  number: number;
}

interface SubmitClaimInput {
  roomCode: string;
  playerId: string;
  type: ClaimType;
}

interface EndGameInput {
  roomCode: string;
  actorPlayerId: string;
  reason?: string;
}

interface ComplianceOptions {
  minRoundIntervalMs?: number;
  /** MEDIUM-1: Minimum interval between manual draws (ms). Default 1500. */
  minDrawIntervalMs?: number;
  minPlayersToStart?: number;
  dailyLossLimit?: number;
  monthlyLossLimit?: number;
  playSessionLimitMs?: number;
  pauseDurationMs?: number;
  selfExclusionMinMs?: number;
  maxDrawsPerRound?: number;
  persistence?: ResponsibleGamingPersistenceAdapter;
  /** BIN-251: External room state store for cross-instance persistence (e.g. Redis). */
  roomStateStore?: import("../store/RoomStateStore.js").RoomStateStore;
  /**
   * Test-only: override the draw bag generator. Receives the nominal ball count
   * (60 or 75) and must return that many unique integers in 1..count. Intended
   * for deterministic integration tests; production must not set this.
   */
  drawBagFactory?: (size: number) => number[];
  /**
   * GAME1_SCHEDULE PR 5: valgfri loyalty-hook. Kalles fire-and-forget
   * ved buy-in (ticket.purchase) og ved fase-win (game.win).
   * Default: no-op — engine kan kjøre uten loyalty-integrasjon.
   */
  loyaltyHook?: LoyaltyPointsHookPort;
  /**
   * GAME1_SCHEDULE PR 5: valgfri split-rounding-audit. Kalles når
   * floor(totalPhasePrize / winnerCount) etterlater en rest som ikke
   * utbetales. Default: no-op.
   */
  splitRoundingAudit?: SplitRoundingAuditPort;
}


const DEFAULT_SELF_EXCLUSION_MIN_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_DRAWS_PER_ROUND = 30;
const MAX_BINGO_BALLS_75 = 75;
const DEFAULT_BONUS_TRIGGER_PATTERN_INDEX = 1;

export class BingoEngine {
  /** HOEY-7: Pluggable room state store (in-memory or Redis-backed). */
  // BIN-615 / PR-C2: protected so Game2Engine can persist rooms after auto-claim payouts.
  protected readonly rooms: RoomStateStore;
  private readonly roomLastRoundStartMs = new Map<string, number>();
  /** BIN-251: Optional external store for cross-instance room state persistence. */
  private readonly roomStateStore?: import("../store/RoomStateStore.js").RoomStateStore;

  private readonly minRoundIntervalMs: number;
  private readonly minDrawIntervalMs: number;
  private readonly lastDrawAtByRoom = new Map<string, number>();
  private readonly minPlayersToStart: number;
  private readonly maxDrawsPerRound: number;
  private readonly persistence?: ResponsibleGamingPersistenceAdapter;
  // BIN-615 / PR-C2: protected so Game2Engine (subclass) can access these
  // for auto-claim payout flow. Keep `readonly` — subclasses read, don't rebind.
  protected readonly compliance: ComplianceManager;
  /**
   * GAME1_SCHEDULE PR 5: Loyalty-hook (fire-and-forget). Initialisert fra
   * options.loyaltyHook, default NoopLoyaltyPointsHookPort.
   */
  protected readonly loyaltyHook: LoyaltyPointsHookPort;
  /**
   * GAME1_SCHEDULE PR 5: Split-rounding-audit. Logger rest-øre når
   * multi-winner-splittingen ikke går opp. Default no-op.
   */
  protected readonly splitRoundingAudit: SplitRoundingAuditPort;
  protected readonly prizePolicy: PrizePolicyManager;
  protected readonly payoutAudit: PayoutAuditTrail;
  protected readonly ledger: ComplianceLedger;
  private readonly drawBagFactory?: (size: number) => number[];
  /**
   * BIN-615 / PR-C1: Per-room variantConfig cache for hook access (e.g. onDrawCompleted
   * needs to know patternEvalMode). Populated on startGame, cleared when the round ends.
   * BIN-615 / PR-C2: protected so Game2Engine can look up variantConfig in its hook.
   */
  protected readonly variantConfigByRoom = new Map<string, import("./variantConfig.js").GameVariantConfig>();

  /**
   * Per-room variant gameType (e.g. "standard" | "elvis" | "traffic-light").
   * Populated alongside {@link variantConfigByRoom} in startGame. Needed so
   * {@link getVariantConfigForRoom} can return a `{ gameType, config }` pair
   * that socket handlers (`ticket:cancel`, `ticket:replace`, pre-round colour
   * expansion in roomHelpers) can use without re-resolving gameType.
   *
   * Previous code stored gameType implicitly via {@link RoomStateManager.variantByRoom},
   * but `setVariantConfig` was never called in production — only in tests —
   * causing "Ingen variant-config for rommet" errors on ticket:cancel and
   * broken pre-round colour propagation. Engine is the single source of truth.
   */
  protected readonly variantGameTypeByRoom = new Map<string, string>();

  /**
   * BIN-615 / PR-C3: Per-room per-player lucky-number registry. Lifted from
   * Game2Engine (PR-C2) so any variant with `variantConfig.luckyNumberPrize > 0`
   * can participate.
   *
   * Populated by {@link setLuckyNumber} (called from gameEvents.ts `lucky:set`
   * socket handler), read by {@link onLuckyNumberDrawn} hook fan-out in
   * drawNextNumber. Cleared on destroyRoom.
   *
   * Protected so Game2Engine (existing inline jackpot+bonus coupling) can read
   * the same state when processing winners.
   *
   * Legacy ref: gamehelper/game2.js:1628-1712 (checkLuckyNumber).
   */
  protected readonly luckyNumbersByPlayer = new Map<string, Map<string, number>>();

  constructor(
    // BIN-615 / PR-C2: protected so Game2Engine can invoke adapter hooks
    // (onClaimLogged, onCheckpoint) and wallet transfers for auto-claim payouts.
    protected readonly bingoAdapter: BingoSystemAdapter,
    protected readonly walletAdapter: WalletAdapter,
    options: ComplianceOptions = {},
    /** HOEY-7: Pluggable room state store. Defaults to in-memory. */
    rooms?: RoomStateStore
  ) {
    this.rooms = rooms ?? new InMemoryRoomStateStore();
    this.minRoundIntervalMs = Math.max(30000, Math.floor(options.minRoundIntervalMs ?? 30000));
    this.minDrawIntervalMs = Math.max(0, Math.floor(options.minDrawIntervalMs ?? 1500));
    const minPlayersToStart = options.minPlayersToStart ?? 2;
    if (!Number.isFinite(minPlayersToStart) || !Number.isInteger(minPlayersToStart) || minPlayersToStart < 1) {
      throw new DomainError("INVALID_CONFIG", "minPlayersToStart må være et heltall >= 1.");
    }
    this.minPlayersToStart = Math.floor(minPlayersToStart);

    const dailyLossLimit = options.dailyLossLimit ?? 900;
    const monthlyLossLimit = options.monthlyLossLimit ?? 4400;
    if (!Number.isFinite(dailyLossLimit) || dailyLossLimit < 0) {
      throw new DomainError("INVALID_CONFIG", "dailyLossLimit må være >= 0.");
    }
    if (!Number.isFinite(monthlyLossLimit) || monthlyLossLimit < 0) {
      throw new DomainError("INVALID_CONFIG", "monthlyLossLimit må være >= 0.");
    }
    const regulatoryLossLimits: LossLimits = {
      daily: dailyLossLimit,
      monthly: monthlyLossLimit
    };

    const playSessionLimitMs = options.playSessionLimitMs ?? 60 * 60 * 1000;
    const pauseDurationMs = options.pauseDurationMs ?? 5 * 60 * 1000;
    if (!Number.isFinite(playSessionLimitMs) || playSessionLimitMs <= 0) {
      throw new DomainError("INVALID_CONFIG", "playSessionLimitMs må være større enn 0.");
    }
    if (!Number.isFinite(pauseDurationMs) || pauseDurationMs <= 0) {
      throw new DomainError("INVALID_CONFIG", "pauseDurationMs må være større enn 0.");
    }
    const selfExclusionMinMs = options.selfExclusionMinMs ?? DEFAULT_SELF_EXCLUSION_MIN_MS;
    if (!Number.isFinite(selfExclusionMinMs) || selfExclusionMinMs < DEFAULT_SELF_EXCLUSION_MIN_MS) {
      throw new DomainError(
        "INVALID_CONFIG",
        `selfExclusionMinMs må være minst ${DEFAULT_SELF_EXCLUSION_MIN_MS} ms (1 år).`
      );
    }
    const maxDrawsPerRound = options.maxDrawsPerRound ?? DEFAULT_MAX_DRAWS_PER_ROUND;
    if (
      !Number.isFinite(maxDrawsPerRound) ||
      !Number.isInteger(maxDrawsPerRound) ||
      maxDrawsPerRound < 1 ||
      maxDrawsPerRound > MAX_BINGO_BALLS_75
    ) {
      throw new DomainError(
        "INVALID_CONFIG",
        `maxDrawsPerRound må være et heltall mellom 1 og ${MAX_BINGO_BALLS_75}.`
      );
    }
    this.maxDrawsPerRound = Math.floor(maxDrawsPerRound);
    this.persistence = options.persistence;
    this.drawBagFactory = options.drawBagFactory;

    this.compliance = new ComplianceManager({
      regulatoryLossLimits,
      playSessionLimitMs: Math.floor(playSessionLimitMs),
      pauseDurationMs: Math.floor(pauseDurationMs),
      selfExclusionMinMs: Math.floor(selfExclusionMinMs),
      persistence: options.persistence
    });

    this.prizePolicy = new PrizePolicyManager({
      persistence: options.persistence
    });

    this.payoutAudit = new PayoutAuditTrail({
      persistence: options.persistence
    });

    this.ledger = new ComplianceLedger({
      walletAdapter: this.walletAdapter,
      persistence: options.persistence
    });

    // BIN-251: Wire external room state store if provided
    this.roomStateStore = options.roomStateStore;

    // GAME1_SCHEDULE PR 5: Loyalty-hook + split-rounding-audit (optional ports).
    // Defaults to no-op implementations so tests and loyalty-less deployments
    // don't need to wire anything.
    this.loyaltyHook = options.loyaltyHook ?? new NoopLoyaltyPointsHookPort();
    this.splitRoundingAudit = options.splitRoundingAudit ?? new NoopSplitRoundingAuditPort();
  }

  async hydratePersistentState(): Promise<void> {
    if (!this.persistence) {
      return;
    }

    await this.persistence.ensureInitialized();
    const snapshot = await this.persistence.loadSnapshot();
    const defaultPolicies = snapshot.prizePolicies.length === 0 ? this.prizePolicy.getDefaultPolicies() : [];

    // Delegate compliance-related data to ComplianceManager
    this.compliance.hydrateFromSnapshot({
      personalLossLimits: snapshot.personalLossLimits,
      pendingLossLimitChanges: snapshot.pendingLossLimitChanges,
      restrictions: snapshot.restrictions,
      playStates: snapshot.playStates,
      lossEntries: snapshot.lossEntries
    });

    // Delegate prize policy data to PrizePolicyManager
    this.prizePolicy.hydrateFromSnapshot({
      prizePolicies: snapshot.prizePolicies,
      extraPrizeEntries: snapshot.extraPrizeEntries
    });

    // Delegate payout audit trail data to PayoutAuditTrail
    this.payoutAudit.hydrateFromSnapshot({
      payoutAuditTrail: snapshot.payoutAuditTrail
    });

    // Delegate compliance ledger data to ComplianceLedger
    this.ledger.hydrateFromSnapshot({
      complianceLedger: snapshot.complianceLedger,
      dailyReports: snapshot.dailyReports
    });

    if (snapshot.prizePolicies.length === 0) {
      for (const policy of defaultPolicies) {
        const persisted = this.prizePolicy.toPersistedPrizePolicy(policy);
        await this.persistence.upsertPrizePolicy(persisted);
      }
    }
  }

  /**
   * PR-W5 wallet-split: eksponer ComplianceManager via narrow port (recordLossEntry-only)
   * slik at Game1TicketPurchaseService kan logge BUYIN-entries uten å ta direkte
   * avhengighet til ComplianceManager-klassen. Port-adapter-patternet matcher
   * LoyaltyPointsHookPort (se `../adapters/LoyaltyPointsHookPort.ts`).
   *
   * Wiring: `index.ts` kaller `engine.getComplianceLossPort()` og sender resultatet
   * inn i `Game1TicketPurchaseService`-konstruktøren. I tester kan man bruke en
   * mock eller `NoopComplianceLossPort`.
   *
   * Se `docs/architecture/WALLET_SPLIT_DESIGN_2026-04-22.md` §3.4.
   */
  getComplianceLossPort(): import("../adapters/ComplianceLossPort.js").ComplianceLossPort {
    const compliance = this.compliance;
    return {
      async recordLossEntry(walletId, hallId, entry): Promise<void> {
        await compliance.recordLossEntry(walletId, hallId, entry);
      },
    };
  }

  /**
   * PR-T3 Spor 4: eksponer Game1PotService som narrow PotSalesHookPort slik at
   * Game1TicketPurchaseService kan akkumulere salg til Innsatsen/Jackpott-pot
   * uten å ta direkte avhengighet til pot-service-klassen. Samme port-pattern
   * som `getComplianceLossPort` og `LoyaltyPointsHookPort`.
   *
   * Wiring: `index.ts` kaller `engine.getPotSalesHookPort(game1PotService)` og
   * sender resultatet inn i `Game1TicketPurchaseService`-konstruktøren.
   * Tester kan bruke `NoopPotSalesHook` eller mock.
   *
   * Merk: engine eier ikke potService direkte (den er service-laget), så
   * porten injeksjoneres som parameter her — ulikt ComplianceLossPort som
   * wrapper engine-eid `this.compliance`.
   *
   * Se docs/architecture/SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md §Innsatsen.
   */
  getPotSalesHookPort(
    potService: import("./pot/Game1PotService.js").Game1PotService
  ): import("../adapters/PotSalesHookPort.js").PotSalesHookPort {
    return {
      async onSaleCompleted(params: {
        hallId: string;
        saleAmountCents: number;
      }): Promise<void> {
        await potService.onSaleCompleted(params);
      },
    };
  }

  /**
   * K1 compliance-fix: eksponer ComplianceLedger som narrow port
   * (recordComplianceLedgerEvent-only) slik at Game1TicketPurchaseService
   * og Game1PayoutService kan skrive STAKE/PRIZE-entries uten å ta
   * direkte avhengighet til ComplianceLedger-klassen. Samme port-pattern
   * som `getComplianceLossPort`.
   *
   * Regulatorisk: caller MÅ sende `hallId = kjøpe-hallen` (ikke master-
   * hallen), jf. §71 per-hall-rapportering. Porten er "dum" og stoler på
   * at caller har valgt riktig hall.
   *
   * Wiring: `index.ts` kaller `engine.getComplianceLedgerPort()` og
   * sender resultatet inn i Game1TicketPurchaseService- og
   * Game1PayoutService-konstruktøren. Tester kan bruke
   * `NoopComplianceLedgerPort` eller spy-mock.
   */
  getComplianceLedgerPort(): import("../adapters/ComplianceLedgerPort.js").ComplianceLedgerPort {
    const ledger = this.ledger;
    return {
      async recordComplianceLedgerEvent(input): Promise<void> {
        await ledger.recordComplianceLedgerEvent(input);
      },
    };
  }

  async createRoom(input: CreateRoomInput): Promise<{ roomCode: string; playerId: string }> {
    const hallId = this.assertHallId(input.hallId);
    const playerId = randomUUID();
    const walletId = input.walletId?.trim() || `wallet-${playerId}`;
    logger.debug({ hallId, walletId, playerName: input.playerName }, "createRoom start");
    this.assertWalletAllowedForGameplay(walletId, Date.now());
    this.assertWalletNotInRunningGame(walletId);
    try {
      logger.debug({ walletId }, "ensureAccount start");
      await this.walletAdapter.ensureAccount(walletId);
      logger.debug({ walletId }, "ensureAccount OK");
    } catch (err) {
      logger.error({ walletId, err }, "ensureAccount FAILED");
      throw err;
    }
    let balance: number;
    try {
      // BIN-693: bruker available_balance så klient-visning matcher det som
      // faktisk er tilgjengelig (total − sum av aktive reservations).
      logger.debug({ walletId }, "getAvailableBalance start");
      balance = this.walletAdapter.getAvailableBalance
        ? await this.walletAdapter.getAvailableBalance(walletId)
        : await this.walletAdapter.getBalance(walletId);
      logger.debug({ walletId, balance }, "getAvailableBalance OK");
    } catch (err) {
      logger.error({ walletId, err }, "getAvailableBalance FAILED");
      throw err;
    }

    const player: Player = {
      id: playerId,
      name: this.assertPlayerName(input.playerName),
      walletId,
      balance,
      socketId: input.socketId,
      hallId,
    };

    const existingCodes = new Set(this.rooms.keys());
    const code = input.roomCode && !existingCodes.has(input.roomCode)
      ? input.roomCode
      : makeRoomCode(existingCodes);
    const room: RoomState = {
      code,
      hallId,
      hostPlayerId: playerId,
      // BIN-672: gameSlug is REQUIRED on RoomState. Default to "bingo" when
      // caller omitted — matches game_sessions.game_slug DB default and
      // reflects that this platform only ships Bingo right now.
      gameSlug: input.gameSlug?.trim() || "bingo",
      createdAt: new Date().toISOString(),
      players: new Map([[playerId, player]]),
      gameHistory: []
    };

    this.rooms.set(code, room);
    this.syncRoomToStore(room); // BIN-251
    return { roomCode: code, playerId };
  }

  async joinRoom(input: JoinRoomInput): Promise<{ roomCode: string; playerId: string }> {
    const roomCode = input.roomCode.trim().toUpperCase();
    const hallId = this.assertHallId(input.hallId);
    const room = this.requireRoom(roomCode);
    if (room.hallId !== hallId) {
      throw new DomainError("HALL_MISMATCH", "Rommet tilhører en annen hall.");
    }

    const playerId = randomUUID();
    const walletId = input.walletId?.trim() || `wallet-${playerId}`;
    this.assertWalletAllowedForGameplay(walletId, Date.now());
    this.assertWalletNotInRunningGame(walletId, roomCode);
    this.assertWalletNotAlreadyInRoom(room, walletId);
    await this.walletAdapter.ensureAccount(walletId);
    const balance = await this.walletAdapter.getBalance(walletId);

    room.players.set(playerId, {
      id: playerId,
      name: this.assertPlayerName(input.playerName),
      walletId,
      balance,
      socketId: input.socketId,
      hallId,
    });

    return { roomCode, playerId };
  }

  async startGame(input: StartGameInput): Promise<void> {
    const room = this.requireRoom(input.roomCode);
    this.assertHost(room, input.actorPlayerId);
    this.assertNotRunning(room);
    this.archiveIfEnded(room);
    const nowMs = Date.now();
    this.assertRoundStartInterval(room, nowMs);

    if (room.players.size < this.minPlayersToStart) {
      throw new DomainError(
        "NOT_ENOUGH_PLAYERS",
        `Du trenger minst ${this.minPlayersToStart} spiller${this.minPlayersToStart == 1 ? "" : "e"} for å starte.`
      );
    }

    const entryFee = input.entryFee ?? 0;
    if (!Number.isFinite(entryFee) || entryFee < 0) {
      throw new DomainError("INVALID_ENTRY_FEE", "entryFee må være >= 0.");
    }
    if (entryFee > 10000) {
      throw new DomainError("INVALID_ENTRY_FEE", "entryFee kan ikke overstige 10 000 kr.");
    }
    const ticketsPerPlayer = input.ticketsPerPlayer ?? 1;
    if (!Number.isInteger(ticketsPerPlayer) || ticketsPerPlayer < 1 || ticketsPerPlayer > 30) {
      throw new DomainError("INVALID_TICKETS_PER_PLAYER", "ticketsPerPlayer må være et heltall mellom 1 og 30.");
    }
    // BIN-252: Explicit payoutPercent required — ?? 100 default removed to prevent accidental 100% payout
    if (input.payoutPercent === undefined || input.payoutPercent === null) {
      throw new DomainError("MISSING_PAYOUT_PERCENT", "payoutPercent er påkrevd og må settes eksplisitt.");
    }
    const payoutPercent = input.payoutPercent;
    if (!Number.isFinite(payoutPercent) || payoutPercent < 0 || payoutPercent > 100) {
      throw new DomainError("INVALID_PAYOUT_PERCENT", "payoutPercent må være mellom 0 og 100.");
    }
    const normalizedPayoutPercent = Math.round(payoutPercent * 100) / 100;

    const allPlayers = [...room.players.values()];
    const armedSet = input.armedPlayerIds ? new Set(input.armedPlayerIds) : null;
    // Filter to eligible players for tickets — but the round ALWAYS starts.
    // This is a live room: draws happen regardless of participation.
    const ticketCandidates = allPlayers.filter((player) => {
      if (armedSet && !armedSet.has(player.id)) return false;
      if (this.isPlayerInAnotherRunningGame(room.code, player)) return false;
      if (this.isPlayerBlockedByRestriction(player, nowMs)) return false;
      return true;
    });
    if (ticketCandidates.length > 0) {
      await this.refreshPlayerObjectsFromWallet(ticketCandidates);
    }
    // Filter out players who exceed loss limits or can't afford entry fee.
    const eligiblePlayers = ticketCandidates.length > 0
      ? await this.filterEligiblePlayers(ticketCandidates, entryFee, nowMs, room.hallId)
      : [];
    const gameId = randomUUID();
    const gameType: LedgerGameType = "DATABINGO";
    const channel: LedgerChannel = "INTERNET";
    const houseAccountId = this.ledger.makeHouseAccountId(room.hallId, gameType, channel);
    await this.walletAdapter.ensureAccount(houseAccountId);
    // BIN-463: Test games skip all wallet operations.
    const isTestGame = input.isTestGame ?? false;

    // HOEY-4: Track debited players for compensation if startup fails partway through.
    // BIN-250: If any transfer fails mid-loop, all previously debited players are refunded before rethrowing.
    const debitedPlayers: Array<{ player: Player; fromAccountId: string; toAccountId: string; amount: number }> = [];
    // Per-player ticket counts: resolve each player's ticket count from armedPlayerTicketCounts, clamped to ticketsPerPlayer max.
    const playerTicketCountMap: Map<string, number> = new Map();
    for (const player of eligiblePlayers) {
      const requested = input.armedPlayerTicketCounts?.[player.id] ?? ticketsPerPlayer;
      playerTicketCountMap.set(player.id, Math.min(requested, ticketsPerPlayer));
    }
    // BIN-437: Resolve variant config up-front — needed both for the buy-in
    // loop (per-type pricing) and the ticket-generation loop further down.
    // Declaring it here avoids a TDZ trap where the buy-in loop crashed with
    // "Cannot access 'variantConfig' before initialization".
    const variantGameType = input.gameType ?? "standard";
    const variantConfig = input.variantConfig ?? variantConfigModule.getDefaultVariantConfig(variantGameType);

    if (entryFee > 0 && !isTestGame) {
      try {
        for (const player of eligiblePlayers) {
          const playerTicketCount = playerTicketCountMap.get(player.id) ?? ticketsPerPlayer;
          // Calculate buy-in: if player has per-type selections, sum entryFee * priceMultiplier per type;
          // otherwise fall back to entryFee * ticketCount (backward compat).
          const playerSelections = input.armedPlayerSelections?.[player.id];
          let playerBuyIn: number;
          if (playerSelections && playerSelections.length > 0) {
            playerBuyIn = roundCurrency(
              playerSelections.reduce((sum, sel) => {
                const tt = variantConfig.ticketTypes.find((t) => t.type === sel.type);
                return sum + entryFee * (tt?.priceMultiplier ?? 1) * sel.qty;
              }, 0)
            );
          } else {
            playerBuyIn = roundCurrency(entryFee * playerTicketCount);
          }
          // BIN-693 Option B: hvis spiller har active reservation, commit
          // den i stedet for fresh transfer. commitReservation bruker internt
          // samme transfer-path (winnings-first) så split/ledger-semantikk er
          // bevart. Fallback til legacy transfer når mapping mangler.
          const reservationId = input.reservationIdByPlayer?.[player.id];
          let transfer: WalletTransferResult;
          if (reservationId && this.walletAdapter.commitReservation) {
            try {
              transfer = await this.walletAdapter.commitReservation(
                reservationId,
                houseAccountId,
                `Bingo buy-in ${room.code} (${playerTicketCount} tickets)`,
                {
                  gameSessionId: gameId,
                  idempotencyKey: IdempotencyKeys.adhocBuyIn({ gameId, playerId: player.id }),
                },
              );
            } catch (commitErr) {
              // Reservasjonen kan være expired/released (sjeldent, men mulig
              // hvis backend krasjet mellom arm og start). Fall tilbake til
              // legacy transfer-path så runden kan starte uten data-tap.
              transfer = await this.walletAdapter.transfer(
                player.walletId,
                houseAccountId,
                playerBuyIn,
                `Bingo buy-in ${room.code} (${playerTicketCount} tickets, reservation-fallback)`,
                {
                  idempotencyKey: IdempotencyKeys.adhocBuyIn({ gameId, playerId: player.id }),
                },
              );
            }
          } else {
            transfer = await this.walletAdapter.transfer(
              player.walletId,
              houseAccountId,
              playerBuyIn,
              `Bingo buy-in ${room.code} (${playerTicketCount} tickets)`,
              {
                idempotencyKey: IdempotencyKeys.adhocBuyIn({
                  gameId,
                  playerId: player.id,
                }),
              }
            );
          }
          debitedPlayers.push({ player, fromAccountId: transfer.fromTx.accountId, toAccountId: transfer.toTx.accountId, amount: playerBuyIn });
          player.balance -= playerBuyIn;
          // PR-W4 wallet-split: kun deposit-delen av buy-in teller mot loss-limit
          // (pengespillforskriften §11). Winnings-bruk skal IKKE øke netto-tap.
          // Fallback til full beløp hvis split mangler (legacy entries før W1).
          const buyInLossAmount = lossLimitAmountFromTransfer(transfer.fromTx, playerBuyIn);
          await this.compliance.recordLossEntry(player.walletId, room.hallId, {
            type: "BUYIN",
            amount: buyInLossAmount,
            createdAtMs: nowMs
          });
          await this.compliance.incrementSessionGameCount(player.walletId);
          await this.ledger.recordComplianceLedgerEvent({
            hallId: room.hallId,
            gameType,
            channel,
            eventType: "STAKE",
            amount: playerBuyIn,
            roomCode: room.code,
            gameId,
            playerId: player.id,
            walletId: player.walletId,
            sourceAccountId: transfer.fromTx.accountId,
            targetAccountId: transfer.toTx.accountId,
            metadata: {
              reason: "BINGO_BUYIN"
            }
          });
        }
      } catch (err) {
        // Compensate: refund all already-debited players (using per-player amounts)
        const { failedRefunds } = await this.refundDebitedPlayers(debitedPlayers, houseAccountId, room.code, gameId);
        if (failedRefunds.length > 0 && this.bingoAdapter.onCheckpoint) {
          // Persist failed refund data so it can be recovered/reconciled after restart
          await this.bingoAdapter.onCheckpoint({
            roomCode: room.code, gameId, reason: "REFUND_FAILURE" as never,
            snapshot: { failedRefunds } as never,
            players: [...room.players.values()], hallId: room.hallId
          }).catch(() => { /* best-effort checkpoint */ });
        }
        throw err;
      }

      // GAME1_SCHEDULE PR 5 (BIN-700 follow-up): Loyalty ticket.purchase hook
      // per spiller (fire-and-forget). Kalles ETTER alle buy-ins er bekreftet
      // så en hook-feil aldri utløser refund eller blokkerer spill-start.
      for (const { player, amount } of debitedPlayers) {
        const playerTicketCount = playerTicketCountMap.get(player.id) ?? ticketsPerPlayer;
        try {
          await this.loyaltyHook.onLoyaltyEvent({
            kind: "ticket.purchase",
            userId: player.id,
            amount,
            ticketCount: playerTicketCount,
            roomCode: room.code,
            gameId,
            hallId: room.hallId,
            gameSlug: room.gameSlug,
          });
        } catch (err) {
          logger.warn(
            { err, gameId, playerId: player.id },
            "loyalty ticket.purchase hook failed — engine fortsetter uansett"
          );
        }
      }
    }
    const tickets = new Map<string, Ticket[]>();
    const marks = new Map<string, Set<number>[]>();

    // variantConfig + variantGameType already resolved above (before the buy-in loop).

    try {
      for (const player of eligiblePlayers) {
        const playerTicketCount = playerTicketCountMap.get(player.id) ?? ticketsPerPlayer;
        const playerTickets: Ticket[] = [];
        const playerMarks: Set<number>[] = [];

        // BIN-690: Adopt pre-round display-tickets as the real tickets so
        // the grids + colours the player saw while arming are exactly the
        // brett they now play with. Falls through to normal generation
        // when the cache is missing or the count doesn't match (defensive:
        // arming could have changed after the last room:update emitted
        // the display list).
        const cachedDisplayTickets = input.preRoundTicketsByPlayerId?.[player.id];
        if (cachedDisplayTickets && cachedDisplayTickets.length === playerTicketCount) {
          for (const displayTicket of cachedDisplayTickets) {
            // Copy so engine-state mutations don't leak into the display
            // cache (caller clears the cache after startGame, but
            // cross-state bleed between the pre-round list and the live
            // `tickets` map would still be a bug if ordering changed).
            playerTickets.push({ ...displayTicket });
            playerMarks.push(new Set<number>());
          }
          tickets.set(player.id, playerTickets);
          marks.set(player.id, playerMarks);
          continue;
        }

        // Check if this player has per-type selections
        const playerSelections = input.armedPlayerSelections?.[player.id];

        if (playerSelections && playerSelections.length > 0) {
          // ── Per-type ticket generation ──
          // Each selection specifies a type and qty. For each selection,
          // generate qty * ticketCount actual tickets (e.g. 1 "large" = 3 tickets).
          let ticketIndex = 0;
          for (const sel of playerSelections) {
            // BIN-693: Prefer name-based match (Small Yellow vs Small Purple
            // — same `type: "small"`, distinct `name`). Without this lookup,
            // `.find(t => t.type === sel.type)` returns the FIRST config
            // entry for that type (typically Small Yellow), and every
            // selection in the `small` family becomes Small Yellow — which
            // is exactly the staging bug Tobias reported: 6 different
            // colours armed, all 6 brett rendered Small Yellow.
            //
            // Mirrors `expandSelectionsToTicketColors` (variantConfig.ts)
            // so pre-round and live-round resolve colours identically.
            // Falls back to type-only match for legacy clients that don't
            // send `name` (pre-BIN-688 bundles), matching the BIN-688
            // fallback behaviour.
            const tt =
              (sel.name
                ? variantConfig.ticketTypes.find((t) => t.name === sel.name)
                : undefined) ??
              variantConfig.ticketTypes.find((t) => t.type === sel.type);
            const ticketsPerUnit = tt?.ticketCount ?? 1;
            const colors = tt?.colors; // For traffic-light: [Red, Yellow, Green]

            for (let unitIdx = 0; unitIdx < sel.qty; unitIdx++) {
              for (let subIdx = 0; subIdx < ticketsPerUnit; subIdx++) {
                let color: string;
                let type: string;
                if (colors && colors.length > 0) {
                  // Traffic-light style: cycle through the type's colors
                  color = colors[subIdx % colors.length];
                  type = "traffic-" + color.split(" ")[1]?.toLowerCase();
                } else {
                  color = tt?.name ?? "Small Yellow";
                  type = tt?.type ?? "small";
                }

                const ticket = await this.bingoAdapter.createTicket({
                  roomCode: room.code,
                  gameId,
                  gameSlug: room.gameSlug,
                  player,
                  ticketIndex,
                  ticketsPerPlayer: playerTicketCount,
                  color,
                  type,
                });
                playerTickets.push(ticket);
                playerMarks.push(new Set<number>());
                ticketIndex++;
              }
            }
          }
        } else {
          // ── Legacy: flat count with color cycling ──
          const colorAssignments = variantConfigModule.assignTicketColors(playerTicketCount, variantConfig, variantGameType);

          for (let ticketIndex = 0; ticketIndex < playerTicketCount; ticketIndex += 1) {
            const assignment = colorAssignments[ticketIndex] ?? { color: "Small Yellow", type: "small" };
            const ticket = await this.bingoAdapter.createTicket({
              roomCode: room.code,
              gameId,
              gameSlug: room.gameSlug,
              player,
              ticketIndex,
              ticketsPerPlayer: playerTicketCount,
              color: assignment.color,
              type: assignment.type,
            });
            playerTickets.push(ticket);
            playerMarks.push(new Set<number>());
          }
        }

        tickets.set(player.id, playerTickets);
        marks.set(player.id, playerMarks);
      }
    } catch (err) {
      // Compensate: refund all debited players if ticket generation fails (using per-player amounts)
      if (entryFee > 0) {
        const { failedRefunds } = await this.refundDebitedPlayers(debitedPlayers, houseAccountId, room.code, gameId);
        if (failedRefunds.length > 0 && this.bingoAdapter.onCheckpoint) {
          await this.bingoAdapter.onCheckpoint({
            roomCode: room.code, gameId, reason: "REFUND_FAILURE" as never,
            snapshot: { failedRefunds } as never,
            players: [...room.players.values()], hallId: room.hallId
          }).catch(() => { /* best-effort checkpoint */ });
        }
      }
      throw err;
    }

    // Prize pool = sum of all per-player buy-ins
    const prizePool = roundCurrency(debitedPlayers.reduce((sum, d) => sum + d.amount, 0) || (entryFee * eligiblePlayers.length));
    const maxPayoutBudget = roundCurrency((prizePool * normalizedPayoutPercent) / 100);

    // PR-P5 (Extra-variant): validator — customPatterns og patternsByColor
    // er mutually exclusive. Admin-UI skal også enforce dette, men engine
    // dobbeltsjekker for defense-in-depth + forward-compat med direkte
    // config-input som bypass-er UI.
    const hasCustomP5 =
      Array.isArray(variantConfig.customPatterns) &&
      variantConfig.customPatterns.length > 0;
    if (hasCustomP5 && variantConfig.patternsByColor) {
      throw new DomainError(
        "CUSTOM_AND_STANDARD_EXCLUSIVE",
        "customPatterns kan ikke kombineres med patternsByColor — fjern én.",
      );
    }

    // BIN-448 / PR-P5: Use patterns from variant config if available, else explicit input, else defaults.
    // For customPatterns-mode brukes custom-array som patterns-kilde (concurrent
    // semantikk). For standard mode fortsetter eksisterende flyt uendret.
    const patterns = input.patterns
      ?? (hasCustomP5
        ? variantConfigModule.customPatternsToDefinitions(variantConfig.customPatterns!)
        : variantConfig.patterns.length > 0
          ? variantConfigModule.patternConfigToDefinitions(variantConfig.patterns)
          : DEFAULT_PATTERNS);
    const patternResults: PatternResult[] = patterns.map((p) => ({
      patternId: p.id,
      patternName: p.name,
      claimType: p.claimType,
      isWon: false
    }));
    const game: GameState = {
      id: gameId,
      status: "RUNNING",
      entryFee,
      ticketsPerPlayer,
      prizePool,
      remainingPrizePool: prizePool,
      payoutPercent: normalizedPayoutPercent,
      maxPayoutBudget,
      remainingPayoutBudget: maxPayoutBudget,
      // BIN-615 / PR-C1: draw-bag resolved from variantConfig (maxBallValue/drawBagSize),
      // with a gameSlug-based fallback for configs that pre-date PR-C1. Replaces the
      // previous BINGO75_SLUGS hardcoded switch so Game 2 (1..21) and future variants work.
      drawBag: buildDrawBag(resolveDrawBagConfig(room.gameSlug, variantConfig), this.drawBagFactory),
      drawnNumbers: [],
      tickets,
      marks,
      patterns,
      patternResults,
      claims: [],
      participatingPlayerIds: eligiblePlayers.map(p => p.id),
      isTestGame: isTestGame || undefined,
      startedAt: new Date(nowMs).toISOString()
    };

    room.currentGame = game;
    this.roomLastRoundStartMs.set(room.code, Date.parse(game.startedAt));
    // BIN-615 / PR-C1: cache variantConfig for per-draw hook access (onDrawCompleted).
    this.variantConfigByRoom.set(room.code, variantConfig);
    this.variantGameTypeByRoom.set(room.code, variantGameType);

    // BIN-161/BIN-241: Log SHA-256 hash of drawBag only — full sequence is preserved in PostgreSQL checkpoint (BIN-243).
    // Plaintext drawBag removed to prevent insiders from predicting future draws via log access.
    const drawBagHash = createHash("sha256").update(JSON.stringify(game.drawBag)).digest("hex");
    logger.debug({
      event: "RNG_DRAW_BAG_HASH",
      gameId,
      roomCode: room.code,
      hallId: room.hallId,
      drawBagHash,
      ballCount: game.drawBag.length,
      timestamp: game.startedAt
    }, "RNG draw bag hash (full sequence stored in PostgreSQL checkpoint)");

    for (const player of eligiblePlayers) {
      await this.compliance.startPlaySession(player.walletId, nowMs);
    }
    // BIN-159: Checkpoint at game start — captures initial state for crash recovery.
    // BIN-672: Pass gameSlug so the session row knows which ticket format applies.
    if (this.bingoAdapter.onCheckpoint) {
      try {
        await this.bingoAdapter.onCheckpoint({
          roomCode: room.code,
          gameId,
          reason: "BUY_IN",
          snapshot: this.serializeGameForRecovery(game),
          players: [...room.players.values()],
          hallId: room.hallId,
          gameSlug: room.gameSlug,
        });
      } catch (err) {
        logger.error({ err, gameId }, "CRITICAL: Checkpoint failed after game start");
      }
    }
    // HOEY-7: Persist room state after buy-in
    await this.rooms.persist(room.code);
    if (this.bingoAdapter.onGameStarted) {
      await this.bingoAdapter.onGameStarted({
        roomCode: room.code,
        gameId,
        entryFee,
        playerIds: eligiblePlayers.map((player) => player.id)
      });
    }
  }

  /**
   * BIN-615 / PR-C1: Post-draw hook. Default implementation is a no-op.
   *
   * Subclasses (Game3Engine in PR-C3) override to implement:
   *   - Pattern-cycling (ballNumberThreshold — deactivate unwon patterns)
   *   - Server-side auto-claim against custom 25-bitmask patterns
   *   - PatternChange broadcast when active pattern list mutates
   *
   * Contract:
   *   - Called after drawnNumbers.push + onNumberDrawn adapter, before checkpoint.
   *   - May mutate game state (claims, patterns, patternResults) — mutations are
   *     persisted by the subsequent writeDrawCheckpoint.
   *   - Thrown errors are logged and swallowed; must not block draws.
   *
   * Protected so subclasses can override without exposing to the public API.
   */
  protected async onDrawCompleted(_ctx: {
    room: RoomState;
    game: GameState;
    lastBall: number;
    drawIndex: number;
    variantConfig: import("./variantConfig.js").GameVariantConfig | undefined;
  }): Promise<void> {
    // No-op by default. G1 uses manual-claim (existing claim:submit flow).
  }

  /**
   * BIN-615 / PR-C3: Register a player's lucky number for a room.
   *
   * Validated against `variantConfig.maxBallValue` (defaults to 60 when the
   * variantConfig hasn't been cached yet — matches legacy G1 range). Variants
   * that don't support lucky numbers (`luckyNumberPrize` absent or 0) may still
   * accept the set call — the hook simply never fires.
   *
   * Legacy ref: gamehelper/game2.js:1628-1712 (checkLuckyNumber validates the
   * same way). Lifted here in PR-C3 so all BingoEngine subclasses share it.
   */
  setLuckyNumber(roomCode: string, playerId: string, luckyNumber: number): void {
    const vc = this.variantConfigByRoom.get(roomCode);
    const maxBall = vc?.maxBallValue ?? 60;
    if (!Number.isInteger(luckyNumber) || luckyNumber < 1 || luckyNumber > maxBall) {
      throw new DomainError(
        "INVALID_LUCKY_NUMBER",
        `luckyNumber må være et heltall mellom 1 og ${maxBall}.`
      );
    }
    let roomMap = this.luckyNumbersByPlayer.get(roomCode);
    if (!roomMap) {
      roomMap = new Map();
      this.luckyNumbersByPlayer.set(roomCode, roomMap);
    }
    roomMap.set(playerId, luckyNumber);
  }

  /**
   * BIN-615 / PR-C3: Read a player's lucky number for a room. Returns undefined
   * when not set. Protected for subclass access; socket-layer reads go through
   * its own cache (gameEvents.ts `luckyNumbersByRoom`).
   */
  protected getLuckyNumber(roomCode: string, playerId: string): number | undefined {
    return this.luckyNumbersByPlayer.get(roomCode)?.get(playerId);
  }

  // ── BIN-694: 3-fase norsk 75-ball bingo ──────────────────────────────────
  //
  // Pattern-/fase-evaluering er ekstrahert til `BingoEnginePatternEval.ts`
  // (refactor/s1-bingo-engine-split — Forslag A). Metodene under er tynne
  // delegate-wrappers som bygger en `EvaluatePhaseCallbacks`-port med
  // payout/recovery/compliance-callbacks som pattern-eval-modulen trenger.
  //
  // `payoutPhaseWinner` beholdes på klassen — koblingen mot prizePolicy +
  // payoutAudit + ledger + wallet er for tett for en ren ekstraksjon.

  /**
   * Bygger `EvaluatePhaseCallbacks`-porten som `BingoEnginePatternEval`
   * trenger for å utføre payout/recovery/compliance-side-effekter uten
   * å kjenne til engine-interne state (rooms, ledger, persistence).
   */
  private buildEvaluatePhaseCallbacks(): EvaluatePhaseCallbacks {
    return {
      splitRoundingAudit: this.splitRoundingAudit,
      loyaltyHook: this.loyaltyHook,
      getVariantConfig: (roomCode) => this.variantConfigByRoom.get(roomCode),
      payoutPhaseWinner: (room, game, playerId, pattern, patternResult, prizePerWinner) =>
        this.payoutPhaseWinner(room, game, playerId, pattern, patternResult, prizePerWinner),
      finishPlaySessionsForGame: (room, game, endedAtMs) =>
        this.finishPlaySessionsForGame(room, game, endedAtMs),
      writeGameEndCheckpoint: (room, game) => this.writeGameEndCheckpoint(room, game),
    };
  }

  /**
   * BIN-694: Evaluér om aktiv fase er vunnet etter siste ball. Kalles
   * automatisk fra `drawNextNumber` når `patternEvalMode ===
   * "auto-claim-on-draw"`.
   *
   * Implementasjon ekstrahert til {@link BingoEnginePatternEval.evaluateActivePhase}.
   */
  private async evaluateActivePhase(room: RoomState, game: GameState): Promise<void> {
    await evaluateActivePhaseHelper(this.buildEvaluatePhaseCallbacks(), room, game);
  }

  /**
   * BIN-694: Evaluér om et brett oppfyller aktiv fase sitt krav.
   *
   * Implementasjon ekstrahert til {@link BingoEnginePatternEval.meetsPhaseRequirement}.
   */
  private meetsPhaseRequirement(
    pattern: PatternDefinition,
    ticket: Ticket,
    drawnSet: Set<number>,
  ): boolean {
    return meetsPhaseRequirementHelper(pattern, ticket, drawnSet);
  }

  /**
   * BIN-694: Pay out a single phase-winner (one of potentially many).
   * Re-uses the existing prize-policy / wallet-transfer / compliance /
   * ledger / audit / checkpoint chain so auto-claim and submitClaim end
   * up with the same ledger trail.
   *
   * `prizePerWinner` is already the split amount (totalPhasePrize ÷ N).
   */
  private async payoutPhaseWinner(
    room: RoomState,
    game: GameState,
    playerId: string,
    pattern: PatternDefinition,
    patternResult: { patternId: string; patternName: string; claimType: ClaimType; isWon: boolean },
    prizePerWinner: number,
  ): Promise<void> {
    const player = this.requirePlayer(room, playerId);
    const gameType: LedgerGameType = "DATABINGO";
    const channel: LedgerChannel = "INTERNET";
    const houseAccountId = this.ledger.makeHouseAccountId(room.hallId, gameType, channel);

    const rtpBudgetBefore = roundCurrency(Math.max(0, game.remainingPayoutBudget));

    // Cap against single-prize-policy + remaining pool + RTP budget.
    const capped = this.prizePolicy.applySinglePrizeCap({
      hallId: room.hallId,
      gameType: "DATABINGO",
      amount: prizePerWinner,
    });
    const afterPoolCap = Math.min(capped.cappedAmount, game.remainingPrizePool);
    const payout = Math.min(afterPoolCap, game.remainingPayoutBudget);

    const claim: ClaimRecord = {
      id: randomUUID(),
      playerId: player.id,
      type: pattern.claimType,
      valid: true,
      createdAt: new Date().toISOString(),
      winningPatternIndex: 0,
      patternIndex: 0,
    };
    game.claims.push(claim);

    if (payout > 0) {
      // PR-W3 wallet-split: payout er gevinst → krediter winnings-siden.
      const transfer = await this.walletAdapter.transfer(
        houseAccountId,
        player.walletId,
        payout,
        `${pattern.name} prize ${room.code}`,
        {
          idempotencyKey: IdempotencyKeys.adhocPhase({
            patternId: patternResult.patternId,
            gameId: game.id,
            playerId: player.id,
          }),
          targetSide: "winnings",
        },
      );
      player.balance += payout;
      game.remainingPrizePool = roundCurrency(Math.max(0, game.remainingPrizePool - payout));
      game.remainingPayoutBudget = roundCurrency(Math.max(0, game.remainingPayoutBudget - payout));
      await this.compliance.recordLossEntry(player.walletId, room.hallId, {
        type: "PAYOUT",
        amount: payout,
        createdAtMs: Date.now(),
      });
      await this.ledger.recordComplianceLedgerEvent({
        hallId: room.hallId,
        gameType,
        channel,
        eventType: "PRIZE",
        amount: payout,
        roomCode: room.code,
        gameId: game.id,
        claimId: claim.id,
        playerId: player.id,
        walletId: player.walletId,
        sourceAccountId: transfer.fromTx.accountId,
        targetAccountId: transfer.toTx.accountId,
        policyVersion: capped.policy.id,
      });
      await this.payoutAudit.appendPayoutAuditEvent({
        kind: "CLAIM_PRIZE",
        claimId: claim.id,
        gameId: game.id,
        roomCode: room.code,
        hallId: room.hallId,
        policyVersion: capped.policy.id,
        amount: payout,
        walletId: player.walletId,
        playerId: player.id,
        sourceAccountId: houseAccountId,
        txIds: [transfer.fromTx.id, transfer.toTx.id],
      });
      claim.payoutTransactionIds = [transfer.fromTx.id, transfer.toTx.id];
      if (this.bingoAdapter.onCheckpoint) {
        await this.writePayoutCheckpointWithRetry(
          room, game, claim.id, payout, [transfer.fromTx.id, transfer.toTx.id], pattern.claimType,
        );
      }
      await this.rooms.persist(room.code);
    }

    const rtpBudgetAfter = roundCurrency(Math.max(0, game.remainingPayoutBudget));
    claim.payoutAmount = payout;
    claim.payoutPolicyVersion = capped.policy.id;
    claim.payoutWasCapped = payout < prizePerWinner;
    claim.rtpBudgetBefore = rtpBudgetBefore;
    claim.rtpBudgetAfter = rtpBudgetAfter;
    claim.rtpCapped = payout < afterPoolCap;

    if (this.bingoAdapter.onClaimLogged) {
      await this.bingoAdapter.onClaimLogged({
        roomCode: room.code,
        gameId: game.id,
        playerId: player.id,
        type: pattern.claimType,
        valid: true,
      });
    }
  }

  /**
   * BIN-615 / PR-C3: Variant-specific lucky-number hook. Invoked by
   * {@link drawNextNumber} once per (player, lastBall) pair where the player's
   * registered lucky number equals the ball just drawn — AND the round's
   * `variantConfig.luckyNumberPrize > 0`.
   *
   * Default is a no-op so G1 rooms (no luckyNumberPrize) never see this hook.
   * Game2Engine keeps its existing inline coupling (lucky bonus only paid when
   * the player is also a winner) so the base hook stays dormant for G2 too.
   * Future variants (G3+) may override to pay a standalone bonus.
   *
   * Contract:
   *   - Called AFTER onDrawCompleted, BEFORE writeDrawCheckpoint.
   *   - Errors are logged and swallowed (must not fail the draw).
   *   - Fired at most once per (player, draw) pair.
   */
  protected async onLuckyNumberDrawn(_ctx: {
    room: RoomState;
    game: GameState;
    player: Player;
    luckyNumber: number;
    lastBall: number;
    drawIndex: number;
    variantConfig: import("./variantConfig.js").GameVariantConfig;
  }): Promise<void> {
    // No-op by default.
  }

  async drawNextNumber(input: DrawNextInput): Promise<{ number: number; drawIndex: number; gameId: string }> {
    const room = this.requireRoom(input.roomCode);
    this.assertHost(room, input.actorPlayerId);
    const host = this.requirePlayer(room, input.actorPlayerId);
    const nowMs = Date.now();
    this.assertWalletAllowedForGameplay(host.walletId, nowMs);

    // BIN-460: Block draws while game is paused
    if (room.currentGame?.isPaused) {
      throw new DomainError("GAME_PAUSED", "Spillet er pauset — trekking ikke tillatt.");
    }

    // MEDIUM-1/BIN-253: Enforce minimum interval between manual draws
    if (this.minDrawIntervalMs > 0) {
      const lastDraw = this.lastDrawAtByRoom.get(room.code);
      if (lastDraw !== undefined) {
        const elapsed = nowMs - lastDraw;
        if (elapsed < this.minDrawIntervalMs) {
          const waitSec = ((this.minDrawIntervalMs - elapsed) / 1000).toFixed(1);
          throw new DomainError("DRAW_TOO_FAST", `Vent ${waitSec}s mellom trekninger.`);
        }
      }
    }

    const game = this.requireRunningGame(room);
    if (game.drawnNumbers.length >= this.maxDrawsPerRound) {
      const endedAtMs = Date.now();
      const endedAt = new Date(endedAtMs);
      game.status = "ENDED";
      game.endedAt = endedAt.toISOString();
      game.endedReason = "MAX_DRAWS_REACHED";
      await this.finishPlaySessionsForGame(room, game, endedAtMs);
      // HOEY-6/BIN-248: Write GAME_END checkpoint for MAX_DRAWS_REACHED
      await this.writeGameEndCheckpoint(room, game);
      throw new DomainError("NO_MORE_NUMBERS", `Maks antall trekk (${this.maxDrawsPerRound}) er nådd.`);
    }

    const nextNumber = game.drawBag.shift();
    if (!nextNumber) {
      const endedAtMs = Date.now();
      const endedAt = new Date(endedAtMs);
      game.status = "ENDED";
      game.endedAt = endedAt.toISOString();
      game.endedReason = "DRAW_BAG_EMPTY";
      await this.finishPlaySessionsForGame(room, game, endedAtMs);
      // HOEY-6/BIN-248: Write GAME_END checkpoint for DRAW_BAG_EMPTY
      await this.writeGameEndCheckpoint(room, game);
      throw new DomainError("NO_MORE_NUMBERS", "Ingen tall igjen i trekken.");
    }

    game.drawnNumbers.push(nextNumber);
    if (this.bingoAdapter.onNumberDrawn) {
      await this.bingoAdapter.onNumberDrawn({
        roomCode: room.code,
        gameId: game.id,
        number: nextNumber,
        drawIndex: game.drawnNumbers.length
      });
    }
    // BIN-615 / PR-C1: variant-specific post-draw hook (no-op by default).
    // Subclasses (Game3Engine in PR-C3) override to implement auto-claim /
    // pattern-cycling after each ball. Errors are logged but do not fail the draw.
    const variantConfigForDraw = this.variantConfigByRoom.get(room.code);
    try {
      await this.onDrawCompleted({
        room,
        game,
        lastBall: nextNumber,
        drawIndex: game.drawnNumbers.length,
        variantConfig: variantConfigForDraw
      });
    } catch (err) {
      logger.error({ err, gameId: game.id, roomCode: room.code }, "onDrawCompleted hook failed");
    }
    // BIN-694: 3-fase norsk 75-ball bingo auto-claim. Gates bak
    // `autoClaimPhaseMode` (ny flag i variantConfig, satt kun av
    // DEFAULT_NORSK_BINGO_CONFIG). G2/G3 har sin egen auto-claim via
    // onDrawCompleted-override og skal IKKE kjøre denne pathen.
    //
    // Kjører etter hver ball: sjekker om noen brett oppfyller aktiv
    // fase (1 Rad / 2 Rader / Fullt Hus), splitter premien mellom
    // samtidige vinnere, markerer fasen som vunnet. Kun Fullt Hus-
    // fasen avslutter runden.
    if (variantConfigForDraw?.autoClaimPhaseMode && game.status === "RUNNING") {
      try {
        await this.evaluateActivePhase(room, game);
      } catch (err) {
        logger.error(
          { err, gameId: game.id, roomCode: room.code },
          "[BIN-694] evaluateActivePhase failed",
        );
      }
    }
    // BIN-615 / PR-C3: Fan-out lucky-number hook. Fires per-player when the
    // player's registered luckyNumber matches lastBall AND the variant enables
    // lucky numbers (luckyNumberPrize > 0). Default onLuckyNumberDrawn is
    // no-op — G1 (no luckyNumberPrize) and G2 (uses inline coupling) unchanged.
    if (variantConfigForDraw && (variantConfigForDraw.luckyNumberPrize ?? 0) > 0) {
      const roomLucky = this.luckyNumbersByPlayer.get(room.code);
      if (roomLucky && roomLucky.size > 0) {
        for (const [playerId, luckyNumber] of roomLucky) {
          if (luckyNumber !== nextNumber) continue;
          const player = room.players.get(playerId);
          if (!player) continue;
          try {
            await this.onLuckyNumberDrawn({
              room,
              game,
              player,
              luckyNumber,
              lastBall: nextNumber,
              drawIndex: game.drawnNumbers.length,
              variantConfig: variantConfigForDraw
            });
          } catch (err) {
            logger.error({ err, gameId: game.id, roomCode: room.code, playerId }, "onLuckyNumberDrawn hook failed");
          }
        }
      }
    }
    // HOEY-3: Checkpoint after each draw — persists draw sequence state
    await this.writeDrawCheckpoint(room, game);
    if (game.drawnNumbers.length >= this.maxDrawsPerRound) {
      const endedAtMs = Date.now();
      const endedAt = new Date(endedAtMs);
      game.status = "ENDED";
      game.endedAt = endedAt.toISOString();
      game.endedReason = "MAX_DRAWS_REACHED";
      await this.finishPlaySessionsForGame(room, game, endedAtMs);
      // HOEY-6/BIN-248: Write GAME_END checkpoint for MAX_DRAWS_REACHED (post-draw)
      await this.writeGameEndCheckpoint(room, game);
    }
    // MEDIUM-1/BIN-253: Record draw timestamp for interval enforcement
    this.lastDrawAtByRoom.set(room.code, Date.now());
    // BIN-689: The **wire-level** `drawIndex` is the 0-based array index of
    // the ball in `drawnNumbers` (i.e. `length - 1`). The client's
    // GameBridge gap-detection contract (BIN-502) is 0-based —
    // `lastAppliedDrawIndex = -1` means no draws yet, so the first ball is
    // expected at drawIndex=0. Previously we returned `length`, which is
    // 1-based (first ball drawIndex=1), causing every draw to look like a
    // gap → infinite resync loop on staging (BallTube empty, no animation
    // fired). Ref: GameBridge.ts:355 + GameBridge.test.ts.
    //
    // NB: Engine-internal hooks (`onDrawCompleted`, `onLuckyNumberDrawn`)
    // and the `onNumberDrawn` bingoAdapter callback keep the 1-based
    // "drawnCount" semantics above — PatternCycler.step() and
    // GAME2_MIN_DRAWS_FOR_CHECK both depend on that.
    return { number: nextNumber, drawIndex: game.drawnNumbers.length - 1, gameId: game.id };
  }

  /**
   * BIN-509: charge the configured `replaceAmount` for a pre-round ticket
   * replacement. Returns the debited amount. Throws:
   *   - GAME_RUNNING — cannot replace once a round is in progress
   *   - INVALID_REPLACE_AMOUNT — replaceAmount is 0 or unset (variant disables it)
   *   - INSUFFICIENT_FUNDS — player's wallet balance can't cover it
   *
   * Wallet flow mirrors the STAKE leg of the buy-in: player → hall house
   * account, with an idempotency key so a retried replacement is a no-op.
   * Compliance ledger records a STAKE event.
   *
   * The caller owns the display-ticket cache and is responsible for generating
   * the replacement ticket after this method returns successfully.
   */
  async chargeTicketReplacement(
    roomCode: string,
    playerId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<{ debitedAmount: number }> {
    const room = this.requireRoom(roomCode);
    if (room.currentGame && room.currentGame.status === "RUNNING") {
      throw new DomainError("GAME_RUNNING", "Kan ikke bytte billett mens runden spilles.");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new DomainError("INVALID_REPLACE_AMOUNT", "replaceAmount er ikke konfigurert for denne varianten.");
    }
    const player = this.requirePlayer(room, playerId);
    const nowMs = Date.now();
    this.assertWalletAllowedForGameplay(player.walletId, nowMs);
    const debit = roundCurrency(amount);
    await this.walletAdapter.ensureAccount(player.walletId);
    const balance = await this.walletAdapter.getBalance(player.walletId);
    if (balance < debit) {
      throw new DomainError("INSUFFICIENT_FUNDS", "Ikke nok saldo til å bytte billett.");
    }
    const gameType: LedgerGameType = "DATABINGO";
    const channel: LedgerChannel = "INTERNET";
    const houseAccountId = this.ledger.makeHouseAccountId(room.hallId, gameType, channel);
    await this.walletAdapter.ensureAccount(houseAccountId);
    const replaceTransfer = await this.walletAdapter.transfer(
      player.walletId,
      houseAccountId,
      debit,
      `Ticket replace ${room.code}`,
      { idempotencyKey },
    );
    player.balance -= debit;
    // PR-W4 wallet-split: kun deposit-delen av ticket-replace-kjøpet teller mot
    // loss-limit. Samme regel som buy-in (pengespillforskriften §11). Fallback
    // til full beløp hvis split mangler.
    const replaceLossAmount = lossLimitAmountFromTransfer(replaceTransfer.fromTx, debit);
    await this.compliance.recordLossEntry(player.walletId, room.hallId, {
      type: "BUYIN",
      amount: replaceLossAmount,
      createdAtMs: nowMs,
    });
    await this.ledger.recordComplianceLedgerEvent({
      hallId: room.hallId,
      gameType,
      channel,
      eventType: "STAKE",
      amount: debit,
      roomCode: room.code,
      gameId: room.currentGame?.id,
      playerId: player.id,
      walletId: player.walletId,
      // BIN-17.36: mark this STAKE-entry as a replacement fee (Elvis / swap
      // mellom runder) so the Hall Specific Report kan sum "Elvis Replacement
      // Amount" separately. Vanlig buy-in STAKE har ikke denne flaggen.
      metadata: { isReplacement: true },
    });
    return { debitedAmount: debit };
  }

  async markNumber(input: MarkNumberInput): Promise<void> {
    const room = this.requireRoom(input.roomCode);
    const game = this.requireRunningGame(room);
    const player = this.requirePlayer(room, input.playerId);
    this.assertWalletAllowedForGameplay(player.walletId, Date.now());
    if (!game.drawnNumbers.includes(input.number)) {
      throw new DomainError("NUMBER_NOT_DRAWN", "Tallet er ikke trukket ennå.");
    }
    const playerTickets = game.tickets.get(player.id);
    const playerMarks = game.marks.get(player.id);
    if (!playerTickets || !playerMarks || playerTickets.length === 0 || playerMarks.length !== playerTickets.length) {
      throw new DomainError("MARKS_NOT_FOUND", "Kunne ikke finne markeringer for spiller.");
    }

    let numberFound = false;
    for (let i = 0; i < playerTickets.length; i += 1) {
      const ticket = playerTickets[i];
      if (!ticketContainsNumber(ticket, input.number)) {
        continue;
      }
      playerMarks[i].add(input.number);
      numberFound = true;
    }

    if (!numberFound) {
      throw new DomainError("NUMBER_NOT_ON_TICKET", "Tallet finnes ikke på spillerens brett.");
    }
  }

  async submitClaim(input: SubmitClaimInput): Promise<ClaimRecord> {
    const room = this.requireRoom(input.roomCode);
    const game = this.requireRunningGame(room);
    const player = this.requirePlayer(room, input.playerId);
    this.assertWalletAllowedForGameplay(player.walletId, Date.now());

    // KRITISK-8: Only players who participated (were armed + paid buy-in) can claim prizes.
    if (game.participatingPlayerIds && !game.participatingPlayerIds.includes(player.id)) {
      throw new DomainError(
        "PLAYER_NOT_PARTICIPATING",
        "Spilleren deltok ikke i denne runden og kan ikke kreve premie."
      );
    }

    // BIN-45: Idempotency — if this player already has a paid-out claim of the
    // same type in this game, return the existing claim instead of processing again.
    // This prevents double payouts when the client retries after a network error.
    const existingClaim = game.claims.find(
      (c) =>
        c.playerId === player.id &&
        c.type === input.type &&
        c.valid &&
        c.payoutAmount !== undefined &&
        c.payoutAmount > 0
    );
    if (existingClaim) {
      return existingClaim;
    }

    // BIN-238: Explicit armed guard — only players who received tickets in this
    // game round (i.e. paid buy-in and passed eligibility) may submit claims.
    const playerTickets = game.tickets.get(player.id);
    if (!playerTickets || playerTickets.length === 0) {
      throw new DomainError("NOT_ARMED_FOR_GAME", "Spilleren deltok ikke i denne runden og kan ikke gjøre krav.");
    }
    const playerMarks = game.marks.get(player.id);
    if (!playerMarks || playerMarks.length !== playerTickets.length) {
      throw new DomainError("TICKET_NOT_FOUND", "Spiller mangler brett i aktivt spill.");
    }

    let valid = false;
    let reason: string | undefined;
    let winningPatternIndex: number | undefined;

    if (input.type === "LINE") {
      // BIN-694: LINE-claim dekker fase 1-4. Finn aktiv uvunnet
      // LINE-pattern og valider via `meetsPhaseRequirement` (som
      // håndterer navn-basert fase-oppslag — "1 Rad" = rad/kolonne,
      // "2-4 Rader" = N kolonner). Når auto-claim-on-draw er aktiv,
      // har denne pathen sjelden arbeid — vinneren er allerede
      // påvist i evaluateActivePhase.
      const activeLineResult = game.patternResults?.find(
        (r) => r.claimType === "LINE" && !r.isWon,
      );
      if (!activeLineResult) {
        reason = "LINE_ALREADY_CLAIMED";
      } else {
        const activeLinePattern = game.patterns?.find((p) => p.id === activeLineResult.patternId);
        if (!activeLinePattern) {
          reason = "NO_VALID_LINE";
        } else {
          for (let ticketIndex = 0; ticketIndex < playerTickets.length; ticketIndex += 1) {
            if (this.meetsPhaseRequirement(
              activeLinePattern,
              playerTickets[ticketIndex],
              playerMarks[ticketIndex],
            )) {
              valid = true;
              // Historisk kontrakt: winningPatternIndex peker på første
              // komplette linje (0-9 = rad/kolonne). Brukes av bonus-
              // trigger-pattern-indeks og enkelte audits.
              winningPatternIndex = findFirstCompleteLinePatternIndex(
                playerTickets[ticketIndex],
                playerMarks[ticketIndex],
              );
              if (winningPatternIndex < 0) winningPatternIndex = 0;
              break;
            }
          }
          if (!valid) {
            reason = "NO_VALID_LINE";
          }
        }
      }
    } else if (input.type === "BINGO") {
      // KRITISK-4/BIN-242: Guard against duplicate BINGO claims — reject if BINGO is already claimed.
      if (game.bingoWinnerId) {
        valid = false;
        reason = "BINGO_ALREADY_CLAIMED";
      } else {
        valid = playerTickets.some((ticket, index) => hasFullBingo(ticket, playerMarks[index]));
        if (!valid) {
          reason = "NO_VALID_BINGO";
        }
      }
    } else {
      reason = "UNKNOWN_CLAIM_TYPE";
    }

    const claim: ClaimRecord = {
      id: randomUUID(),
      playerId: player.id,
      type: input.type,
      valid,
      reason,
      createdAt: new Date().toISOString()
    };
    if (winningPatternIndex !== undefined) {
      claim.winningPatternIndex = winningPatternIndex;
      claim.patternIndex = winningPatternIndex;
    }
    game.claims.push(claim);
    const gameType: LedgerGameType = "DATABINGO";
    const channel: LedgerChannel = "INTERNET";
    const houseAccountId = this.ledger.makeHouseAccountId(room.hallId, gameType, channel);

    if (valid && input.type === "LINE") {
      game.lineWinnerId = player.id;
      const rtpBudgetBefore = roundCurrency(Math.max(0, game.remainingPayoutBudget));
      // Use the pattern's configured prizePercent instead of hardcoded 30%.
      // For multi-LINE variants (e.g. 4-row with 10% each), find the specific
      // unclaimed pattern to get the correct percentage for this claim.
      const nextLineResult = game.patternResults?.find((r) => r.claimType === "LINE" && !r.isWon);
      const linePattern = nextLineResult
        ? game.patterns?.find((p) => p.id === nextLineResult.patternId)
        : game.patterns?.find((p) => p.claimType === "LINE");
      const linePrizePercent = linePattern?.prizePercent ?? 30;
      const requestedPayout = Math.floor(game.prizePool * linePrizePercent / 100);
      const cappedLinePayout = this.prizePolicy.applySinglePrizeCap({
        hallId: room.hallId,
        gameType: "DATABINGO",
        amount: requestedPayout
      });
      const requestedAfterPolicyAndPool = Math.min(cappedLinePayout.cappedAmount, game.remainingPrizePool);
      const payout = Math.min(
        requestedAfterPolicyAndPool,
        game.remainingPayoutBudget
      );
      if (payout > 0) {
        // BIN-239: idempotencyKey prevents double payout if client retries.
        // PR-W3 wallet-split: payout er gevinst → krediter winnings-siden.
        const transfer = await this.walletAdapter.transfer(
          houseAccountId,
          player.walletId,
          payout,
          `Line prize ${room.code}`,
          {
            idempotencyKey: IdempotencyKeys.adhocLinePrize({
              gameId: game.id,
              claimId: claim.id,
            }),
            targetSide: "winnings",
          }
        );
        player.balance += payout;
        game.remainingPrizePool = roundCurrency(Math.max(0, game.remainingPrizePool - payout));
        game.remainingPayoutBudget = roundCurrency(Math.max(0, game.remainingPayoutBudget - payout));
        await this.compliance.recordLossEntry(player.walletId, room.hallId, {
          type: "PAYOUT",
          amount: payout,
          createdAtMs: Date.now()
        });
        await this.ledger.recordComplianceLedgerEvent({
          hallId: room.hallId,
          gameType,
          channel,
          eventType: "PRIZE",
          amount: payout,
          roomCode: room.code,
          gameId: game.id,
          claimId: claim.id,
          playerId: player.id,
          walletId: player.walletId,
          sourceAccountId: transfer.fromTx.accountId,
          targetAccountId: transfer.toTx.accountId,
          policyVersion: cappedLinePayout.policy.id
        });
        await this.payoutAudit.appendPayoutAuditEvent({
          kind: "CLAIM_PRIZE",
          claimId: claim.id,
          gameId: game.id,
          roomCode: room.code,
          hallId: room.hallId,
          policyVersion: cappedLinePayout.policy.id,
          amount: payout,
          walletId: player.walletId,
          playerId: player.id,
          sourceAccountId: houseAccountId,
          txIds: [transfer.fromTx.id, transfer.toTx.id]
        });
        // BIN-45: Store transaction IDs for idempotency tracking
        claim.payoutTransactionIds = [transfer.fromTx.id, transfer.toTx.id];
        // BIN-48: Synchronous checkpoint after payout — ensures state is persisted
        if (this.bingoAdapter.onCheckpoint) {
          await this.writePayoutCheckpointWithRetry(room, game, claim.id, payout, [transfer.fromTx.id, transfer.toTx.id], "LINE");
        }
        // HOEY-7: Persist after LINE payout
        await this.rooms.persist(room.code);
      }
      const rtpBudgetAfter = roundCurrency(Math.max(0, game.remainingPayoutBudget));
      claim.payoutAmount = payout;
      claim.payoutPolicyVersion = cappedLinePayout.policy.id;
      claim.payoutWasCapped = payout < requestedPayout;
      claim.rtpBudgetBefore = rtpBudgetBefore;
      claim.rtpBudgetAfter = rtpBudgetAfter;
      claim.rtpCapped = payout < requestedAfterPolicyAndPool;
      claim.bonusTriggered = winningPatternIndex === DEFAULT_BONUS_TRIGGER_PATTERN_INDEX;
      if (claim.bonusTriggered) {
        claim.bonusAmount = payout;
      }
      // Record pattern result for the first unclaimed LINE pattern
      const linePatternResult = game.patternResults?.find((r) => r.claimType === "LINE" && !r.isWon);
      if (linePatternResult) {
        linePatternResult.isWon = true;
        linePatternResult.winnerId = player.id;
        linePatternResult.wonAtDraw = game.drawnNumbers.length;
        linePatternResult.payoutAmount = payout;
        linePatternResult.claimId = claim.id;
      }
    }

    if (valid && input.type === "BINGO") {
      // KRITISK-4: Double-check guard against race between validation and payout
      if (game.bingoWinnerId) {
        claim.valid = false;
        claim.reason = "BINGO_ALREADY_CLAIMED";
        return claim;
      }
      const endedAtMs = Date.now();
      const endedAt = new Date(endedAtMs);
      game.bingoWinnerId = player.id;
      const rtpBudgetBefore = roundCurrency(Math.max(0, game.remainingPayoutBudget));
      const requestedPayout = game.remainingPrizePool;
      const cappedBingoPayout = this.prizePolicy.applySinglePrizeCap({
        hallId: room.hallId,
        gameType: "DATABINGO",
        amount: requestedPayout
      });
      const requestedAfterPolicyAndPool = Math.min(cappedBingoPayout.cappedAmount, game.remainingPrizePool);
      const payout = Math.min(
        requestedAfterPolicyAndPool,
        game.remainingPayoutBudget
      );
      if (payout > 0) {
        // BIN-239: idempotencyKey prevents double payout if client retries.
        // PR-W3 wallet-split: payout er gevinst → krediter winnings-siden.
        const transfer = await this.walletAdapter.transfer(
          houseAccountId,
          player.walletId,
          payout,
          `Bingo prize ${room.code}`,
          {
            idempotencyKey: IdempotencyKeys.adhocBingoPrize({
              gameId: game.id,
              claimId: claim.id,
            }),
            targetSide: "winnings",
          }
        );
        player.balance += payout;
        await this.compliance.recordLossEntry(player.walletId, room.hallId, {
          type: "PAYOUT",
          amount: payout,
          createdAtMs: Date.now()
        });
        await this.ledger.recordComplianceLedgerEvent({
          hallId: room.hallId,
          gameType,
          channel,
          eventType: "PRIZE",
          amount: payout,
          roomCode: room.code,
          gameId: game.id,
          claimId: claim.id,
          playerId: player.id,
          walletId: player.walletId,
          sourceAccountId: transfer.fromTx.accountId,
          targetAccountId: transfer.toTx.accountId,
          policyVersion: cappedBingoPayout.policy.id
        });
        await this.payoutAudit.appendPayoutAuditEvent({
          kind: "CLAIM_PRIZE",
          claimId: claim.id,
          gameId: game.id,
          roomCode: room.code,
          hallId: room.hallId,
          policyVersion: cappedBingoPayout.policy.id,
          amount: payout,
          walletId: player.walletId,
          playerId: player.id,
          sourceAccountId: houseAccountId,
          txIds: [transfer.fromTx.id, transfer.toTx.id]
        });
        // BIN-45: Store transaction IDs for idempotency tracking
        claim.payoutTransactionIds = [transfer.fromTx.id, transfer.toTx.id];
        // BIN-48: Synchronous checkpoint after payout — ensures state is persisted
        if (this.bingoAdapter.onCheckpoint) {
          await this.writePayoutCheckpointWithRetry(room, game, claim.id, payout, [transfer.fromTx.id, transfer.toTx.id], "BINGO");
        }
        // HOEY-7: Persist after BINGO payout
        await this.rooms.persist(room.code);
      }
      game.remainingPrizePool = roundCurrency(Math.max(0, game.remainingPrizePool - payout));
      game.remainingPayoutBudget = roundCurrency(Math.max(0, game.remainingPayoutBudget - payout));
      game.status = "ENDED";
      game.endedAt = endedAt.toISOString();
      game.endedReason = "BINGO_CLAIMED";
      await this.finishPlaySessionsForGame(room, game, endedAtMs);
      await this.writeGameEndCheckpoint(room, game); // BIN-248: final state after payout settled
      const rtpBudgetAfter = roundCurrency(Math.max(0, game.remainingPayoutBudget));
      claim.payoutAmount = payout;
      claim.payoutPolicyVersion = cappedBingoPayout.policy.id;
      claim.payoutWasCapped = payout < requestedPayout;
      claim.rtpBudgetBefore = rtpBudgetBefore;
      claim.rtpBudgetAfter = rtpBudgetAfter;
      claim.rtpCapped = payout < requestedAfterPolicyAndPool;
      // Record pattern result for the first unclaimed BINGO pattern
      const bingoPatternResult = game.patternResults?.find((r) => r.claimType === "BINGO" && !r.isWon);
      if (bingoPatternResult) {
        bingoPatternResult.isWon = true;
        bingoPatternResult.winnerId = player.id;
        bingoPatternResult.wonAtDraw = game.drawnNumbers.length;
        bingoPatternResult.payoutAmount = payout;
        bingoPatternResult.claimId = claim.id;
      }
    }

    if (this.bingoAdapter.onClaimLogged) {
      await this.bingoAdapter.onClaimLogged({
        roomCode: room.code,
        gameId: game.id,
        playerId: player.id,
        type: input.type,
        valid: claim.valid,
        reason: claim.reason
      });
    }

    // HOEY-6: Write GAME_END checkpoint if the game ended via BINGO_CLAIMED
    if (game.status === "ENDED" && game.endedReason === "BINGO_CLAIMED") {
      await this.writeGameEndCheckpoint(room, game);
    }

    return claim;
  }

  // ── Jackpot (Game 5 Free Spin) ──────────────────────────────────────────

  /**
   * Activate jackpot mini-game for a player (called after BINGO win in Game 5).
   * Returns the jackpot state, or null if not applicable.
   *
   * Implementasjon ekstrahert til {@link BingoEngineMiniGames.activateJackpot}
   * i refactor/s1-bingo-engine-split (Forslag A).
   */
  activateJackpot(roomCode: string, playerId: string): JackpotState | null {
    return activateJackpotHelper(this.getMiniGamesContext(), roomCode, playerId);
  }

  /**
   * Process a jackpot spin. Server picks a random segment.
   * Returns the spin result with prize amount.
   *
   * Implementasjon ekstrahert til {@link BingoEngineMiniGames.spinJackpot}.
   */
  async spinJackpot(roomCode: string, playerId: string): Promise<{
    segmentIndex: number;
    prizeAmount: number;
    playedSpins: number;
    totalSpins: number;
    isComplete: boolean;
    spinHistory: JackpotState["spinHistory"];
  }> {
    return spinJackpotHelper(this.getMiniGamesContext(), roomCode, playerId);
  }

  // ── Mini-games (Game 1 — Wheel of Fortune / Treasure Chest) ─────────────

  /**
   * Mini-game rotation counter-state. Bor i en container så
   * {@link BingoEngineMiniGames.activateMiniGame} kan mutere feltet uten at
   * engine eksponerer en public setter.
   */
  private readonly miniGameRotation: MiniGameRotationState = { counter: 0 };

  /**
   * Activate a mini-game for a player (called after BINGO win in Game 1).
   * Rotates wheelOfFortune → treasureChest → mysteryGame → colorDraft.
   *
   * Implementasjon ekstrahert til {@link BingoEngineMiniGames.activateMiniGame}.
   */
  activateMiniGame(roomCode: string, playerId: string): MiniGameState | null {
    return activateMiniGameHelper(
      this.getMiniGamesContext(),
      this.miniGameRotation,
      roomCode,
      playerId,
    );
  }

  /**
   * Play the mini-game. Server picks the winning segment/chest.
   * For treasureChest, selectedIndex is the player's pick (cosmetic only —
   * prize is server-determined).
   *
   * Implementasjon ekstrahert til {@link BingoEngineMiniGames.playMiniGame}.
   */
  async playMiniGame(roomCode: string, playerId: string, _selectedIndex?: number): Promise<{
    type: MiniGameType;
    segmentIndex: number;
    prizeAmount: number;
    prizeList: number[];
  }> {
    return playMiniGameHelper(
      this.getMiniGamesContext(),
      roomCode,
      playerId,
      _selectedIndex,
    );
  }

  /**
   * Bygger narrow port mot mini-game-modulen. Samler de interne adapterne
   * + `requireRoom`/`requirePlayer` som modulen trenger uten å eksponere
   * hele engine-state. Instansiert per-kall — billig og holder ingen extra
   * felt på klassen.
   */
  private getMiniGamesContext(): MiniGamesContext {
    return {
      walletAdapter: this.walletAdapter,
      compliance: this.compliance,
      ledger: this.ledger,
      requireRoom: (code) => this.requireRoom(code),
      requirePlayer: (room, playerId) => this.requirePlayer(room, playerId),
    };
  }

  async endGame(input: EndGameInput): Promise<void> {
    const room = this.requireRoom(input.roomCode);
    this.assertHost(room, input.actorPlayerId);
    const host = this.requirePlayer(room, input.actorPlayerId);
    this.assertWalletAllowedForGameplay(host.walletId, Date.now());
    const game = this.requireRunningGame(room);

    const endedAtMs = Date.now();
    const endedAt = new Date(endedAtMs);
    game.status = "ENDED";
    game.endedAt = endedAt.toISOString();
    game.endedReason = input.reason?.trim() || "MANUAL_END";
    await this.finishPlaySessionsForGame(room, game, endedAtMs);
    // BIN-48/BIN-248: Synchronous checkpoint after game end
    await this.writeGameEndCheckpoint(room, game);
  }

  // ── BIN-460: Game pause/resume ─────────────────────────────────────────────

  pauseGame(roomCode: string, message?: string): void {
    const room = this.requireRoom(roomCode);
    const game = this.requireRunningGame(room);
    if (game.isPaused) throw new DomainError("GAME_ALREADY_PAUSED", "Spillet er allerede pauset.");
    game.isPaused = true;
    game.pauseMessage = message ?? "Spillet er pauset av admin";
    logger.info({ roomCode, gameId: game.id }, "Game paused");
  }

  resumeGame(roomCode: string): void {
    const room = this.requireRoom(roomCode);
    const game = this.requireRunningGame(room);
    if (!game.isPaused) throw new DomainError("GAME_NOT_PAUSED", "Spillet er ikke pauset.");
    game.isPaused = false;
    game.pauseMessage = undefined;
    logger.info({ roomCode, gameId: game.id }, "Game resumed");
  }

  getRoomSnapshot(roomCode: string): RoomSnapshot {
    const room = this.requireRoom(roomCode.trim().toUpperCase());
    return this.serializeRoom(room);
  }

  /**
   * Return the active variant config + gameType for a room.
   *
   * Never returns null — before the first `startGame` call, no hall-specific
   * variant has been resolved yet, so we hand back the default "standard"
   * config. This matches what `startGame` itself would do when its caller
   * omits `input.gameType` / `input.variantConfig`, keeping pre-round socket
   * handlers (`ticket:cancel`, `ticket:replace`, pre-round colour expansion
   * in roomHelpers) aligned with what will actually run once the round starts.
   *
   * The engine is the canonical source for variant config; the parallel
   * {@link RoomStateManager.variantByRoom} cache exists only to support older
   * tests that wire things up manually.
   */
  getVariantConfigForRoom(
    roomCode: string,
  ): { gameType: string; config: import("./variantConfig.js").GameVariantConfig } {
    const code = roomCode.trim().toUpperCase();
    const cfg = this.variantConfigByRoom.get(code);
    const gt = this.variantGameTypeByRoom.get(code);
    if (cfg && gt) return { gameType: gt, config: cfg };
    const fallbackType = "standard";
    return {
      gameType: fallbackType,
      config: variantConfigModule.getDefaultVariantConfig(fallbackType),
    };
  }

  getAllRoomCodes(): string[] {
    return [...this.rooms.keys()];
  }

  listRoomSummaries(): RoomSummary[] {
    return [...this.rooms.values()]
      .map((room) => {
        const gameStatus: RoomSummary["gameStatus"] = room.currentGame
          ? room.currentGame.status
          : "NONE";
        return {
          code: room.code,
          hallId: room.hallId,
          hostPlayerId: room.hostPlayerId,
          gameSlug: room.gameSlug,
          playerCount: room.players.size,
          createdAt: room.createdAt,
          gameStatus
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  destroyRoom(roomCode: string): void {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      throw new DomainError("ROOM_NOT_FOUND", `Rom ${code} finnes ikke.`);
    }
    if (room.currentGame && room.currentGame.status === "RUNNING") {
      throw new DomainError("GAME_IN_PROGRESS", `Kan ikke slette rom ${code} mens en runde pågår.`);
    }
    this.rooms.delete(code);
    this.roomLastRoundStartMs.delete(code);
    this.lastDrawAtByRoom.delete(code);
    this.variantConfigByRoom.delete(code); // BIN-615 / PR-C1
    this.variantGameTypeByRoom.delete(code);
    this.luckyNumbersByPlayer.delete(code); // BIN-615 / PR-C3
    this.roomStateStore?.delete(code); // BIN-251
  }

  getPlayerCompliance(walletId: string, hallId?: string): PlayerComplianceSnapshot {
    return this.compliance.getPlayerCompliance(walletId, hallId);
  }

  async setPlayerLossLimits(input: {
    walletId: string;
    hallId: string;
    daily?: number;
    monthly?: number;
  }): Promise<PlayerComplianceSnapshot> {
    return this.compliance.setPlayerLossLimits(input);
  }

  /**
   * BIN-720: Self-service loss-limit oppdatering med 48h-queue for økninger.
   * Brukes av `ProfileSettingsService` — skiller seg fra admin-varianten
   * ved at økninger får en eksplisitt `effectiveFromMs` istedenfor dag/
   * måned-grense.
   */
  async setPlayerLossLimitsWithEffectiveAt(input: {
    walletId: string;
    hallId: string;
    daily?: { value: number; effectiveFromMs: number };
    monthly?: { value: number; effectiveFromMs: number };
    dailyDecrease?: number;
    monthlyDecrease?: number;
  }): Promise<PlayerComplianceSnapshot> {
    return this.compliance.setPlayerLossLimitsWithEffectiveAt(input);
  }

  /**
   * BIN-720: 48h-queue cron-hjelper. Promoterer pending loss-limit → active
   * hvis `effectiveFromMs <= nowMs`. Returnerer true hvis en endring skjedde.
   */
  async promotePendingLossLimitIfDue(walletId: string, hallId: string, nowMs: number): Promise<boolean> {
    return this.compliance.promotePendingLossLimitIfDue(walletId, hallId, nowMs);
  }

  async setTimedPause(input: {
    walletId: string;
    durationMs?: number;
    durationMinutes?: number;
  }): Promise<PlayerComplianceSnapshot> {
    return this.compliance.setTimedPause(input);
  }

  async clearTimedPause(walletIdInput: string): Promise<PlayerComplianceSnapshot> {
    return this.compliance.clearTimedPause(walletIdInput);
  }

  async setSelfExclusion(walletIdInput: string): Promise<PlayerComplianceSnapshot> {
    return this.compliance.setSelfExclusion(walletIdInput);
  }

  async clearSelfExclusion(walletIdInput: string): Promise<PlayerComplianceSnapshot> {
    return this.compliance.clearSelfExclusion(walletIdInput);
  }

  assertWalletAllowedForGameplay(walletIdInput: string, nowMs = Date.now()): void {
    this.compliance.assertWalletAllowedForGameplay(walletIdInput, nowMs);
  }

  async upsertPrizePolicy(input: {
    gameType?: PrizeGameType;
    hallId?: string;
    linkId?: string;
    effectiveFrom: string;
    singlePrizeCap?: number;
    dailyExtraPrizeCap?: number;
  }): Promise<PrizePolicySnapshot> {
    return this.prizePolicy.upsertPrizePolicy(input);
  }

  getActivePrizePolicy(input: {
    hallId: string;
    linkId?: string;
    gameType?: PrizeGameType;
    at?: string;
  }): PrizePolicySnapshot {
    return this.prizePolicy.getActivePrizePolicy(input);
  }

  async awardExtraPrize(input: {
    walletId: string;
    hallId: string;
    linkId?: string;
    amount: number;
    reason?: string;
  }): Promise<{
    walletId: string;
    hallId: string;
    linkId: string;
    amount: number;
    policyId: string;
    remainingDailyExtraPrizeLimit: number;
  }> {
    const walletId = input.walletId.trim();
    const hallId = this.assertHallId(input.hallId);
    const linkId = input.linkId?.trim() || hallId;
    if (!walletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }
    const amount = this.assertNonNegativeNumber(input.amount, "amount");
    if (amount <= 0) {
      throw new DomainError("INVALID_INPUT", "amount må være større enn 0.");
    }

    const nowMs = Date.now();
    const policy = this.prizePolicy.resolvePrizePolicy({
      hallId,
      linkId,
      gameType: "DATABINGO",
      atMs: nowMs
    });

    if (amount > policy.singlePrizeCap) {
      throw new DomainError(
        "PRIZE_POLICY_VIOLATION",
        `Ekstrapremie ${amount} overstiger maks enkeltpremie (${policy.singlePrizeCap}).`
      );
    }

    const scopeKey = this.prizePolicy.makeExtraPrizeScopeKey(hallId, linkId);
    const todayStartMs = this.compliance.startOfLocalDayMs(nowMs);
    const existingEntries = this.prizePolicy.getExtraPrizeEntriesForScope(scopeKey).filter(
      (entry) => entry.createdAtMs >= todayStartMs
    );
    const usedToday = existingEntries.reduce((sum, entry) => sum + entry.amount, 0);
    if (usedToday + amount > policy.dailyExtraPrizeCap) {
      throw new DomainError(
        "EXTRA_PRIZE_DAILY_LIMIT_EXCEEDED",
        `Ekstrapremie overstiger daglig grense (${policy.dailyExtraPrizeCap}) for link ${linkId}.`
      );
    }

    const gameType: LedgerGameType = "DATABINGO";
    const channel: LedgerChannel = "INTERNET";
    const sourceAccountId = this.ledger.makeHouseAccountId(hallId, gameType, channel);
    const extraPrizeId = randomUUID();
    // PR-W3 wallet-split: ekstrapremie er en gameplay-gevinst (passerer
    // prize-policy-gate som singlePrizeCap + dailyExtraPrizeCap), og krediteres
    // derfor winnings-siden på samme måte som line/bingo/jackpot-prize.
    // Admin-gate forhindrer manuelle winnings-kredit (se adminWallet.ts),
    // men `awardExtraPrize` er en regulert prize-mekanisme via BingoEngine.
    const transfer = await this.walletAdapter.transfer(
      sourceAccountId,
      walletId,
      amount,
      input.reason?.trim() || `Extra prize ${hallId}/${linkId}`,
      {
        idempotencyKey: IdempotencyKeys.adhocExtraPrize({ extraPrizeId }),
        targetSide: "winnings",
      }
    );
    await this.compliance.recordLossEntry(walletId, hallId, {
      type: "PAYOUT",
      amount,
      createdAtMs: nowMs
    });
    await this.ledger.recordComplianceLedgerEvent({
      hallId,
      gameType,
      channel,
      eventType: "EXTRA_PRIZE",
      amount,
      walletId,
      sourceAccountId: transfer.fromTx.accountId,
      targetAccountId: transfer.toTx.accountId,
      policyVersion: policy.id,
      metadata: {
        linkId
      }
    });
    await this.payoutAudit.appendPayoutAuditEvent({
      kind: "EXTRA_PRIZE",
      hallId,
      policyVersion: policy.id,
      amount,
      walletId,
      sourceAccountId,
      txIds: [transfer.fromTx.id, transfer.toTx.id]
    });
    existingEntries.push({
      amount,
      createdAtMs: nowMs,
      policyId: policy.id
    });
    this.prizePolicy.setExtraPrizeEntriesForScope(scopeKey, existingEntries);
    await this.prizePolicy.persistExtraPrizeEntry({
      hallId,
      linkId,
      amount,
      createdAtMs: nowMs,
      policyId: policy.id
    });
    return {
      walletId,
      hallId,
      linkId,
      amount,
      policyId: policy.id,
      remainingDailyExtraPrizeLimit: Math.max(0, policy.dailyExtraPrizeCap - (usedToday + amount))
    };
  }

  rejectExtraDrawPurchase(input: {
    source?: "API" | "SOCKET" | "UNKNOWN";
    roomCode?: string;
    playerId?: string;
    walletId?: string;
    metadata?: Record<string, unknown>;
  }): never {
    let hallId: string | undefined;
    let walletId: string | undefined;
    let normalizedRoomCode: string | undefined;
    let playerId: string | undefined;

    if (input.roomCode?.trim()) {
      normalizedRoomCode = input.roomCode.trim().toUpperCase();
      const room = this.requireRoom(normalizedRoomCode);
      hallId = room.hallId;
      if (input.playerId?.trim()) {
        playerId = input.playerId.trim();
        const player = this.requirePlayer(room, playerId);
        walletId = player.walletId;
      }
    }
    if (!walletId && input.walletId?.trim()) {
      walletId = input.walletId.trim();
    }

    this.prizePolicy.rejectExtraDrawPurchase({
      source: input.source,
      roomCode: normalizedRoomCode,
      playerId,
      walletId,
      hallId,
      metadata: input.metadata
    });
  }

  listExtraDrawDenials(limit = 100): ExtraDrawDenialAudit[] {
    return this.prizePolicy.listExtraDrawDenials(limit);
  }

  listPayoutAuditTrail(input?: {
    limit?: number;
    hallId?: string;
    gameId?: string;
    walletId?: string;
  }): PayoutAuditEvent[] {
    return this.payoutAudit.listPayoutAuditTrail(input);
  }

  listComplianceLedgerEntries(input?: {
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
    hallId?: string;
    walletId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): ComplianceLedgerEntry[] {
    return this.ledger.listComplianceLedgerEntries(input);
  }

  async recordAccountingEvent(input: {
    hallId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
    eventType: "STAKE" | "PRIZE" | "EXTRA_PRIZE";
    amount: number;
    metadata?: Record<string, unknown>;
  }): Promise<ComplianceLedgerEntry> {
    return this.ledger.recordAccountingEvent(input);
  }

  generateDailyReport(input: {
    date: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): DailyComplianceReport {
    return this.ledger.generateDailyReport(input);
  }

  async runDailyReportJob(input?: {
    date?: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): Promise<DailyComplianceReport> {
    return this.ledger.runDailyReportJob(input);
  }

  getArchivedDailyReport(dateInput: string): DailyComplianceReport | null {
    return this.ledger.getArchivedDailyReport(dateInput);
  }

  exportDailyReportCsv(input: {
    date: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): string {
    return this.ledger.exportDailyReportCsv(input);
  }

  // BIN-517: Range + per-game aggregations for the admin dashboard.

  generateRangeReport(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): RangeComplianceReport {
    return this.ledger.generateRangeReport(input);
  }

  generateGameStatistics(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
  }): GameStatisticsReport {
    return this.ledger.generateGameStatistics(input);
  }

  // ── BIN-587 B3.1: dashboard + revenue + drill-down ──────────────────────

  generateRevenueSummary(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): RevenueSummary {
    return this.ledger.generateRevenueSummary(input);
  }

  generateTimeSeries(input: {
    startDate: string;
    endDate: string;
    granularity?: TimeSeriesGranularity;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): TimeSeriesReport {
    return this.ledger.generateTimeSeries(input);
  }

  generateTopPlayers(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    limit?: number;
  }): TopPlayersReport {
    return this.ledger.generateTopPlayers(input);
  }

  generateGameSessions(input: {
    startDate: string;
    endDate: string;
    hallId?: string;
    gameType?: LedgerGameType;
    limit?: number;
  }): GameSessionsReport {
    return this.ledger.generateGameSessions(input);
  }

  async createOverskuddDistributionBatch(input: {
    date: string;
    allocations: OrganizationAllocationInput[];
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): Promise<OverskuddDistributionBatch> {
    return this.ledger.createOverskuddDistributionBatch(input);
  }

  getOverskuddDistributionBatch(batchIdInput: string): OverskuddDistributionBatch {
    return this.ledger.getOverskuddDistributionBatch(batchIdInput);
  }

  listOverskuddDistributionBatches(input?: {
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }): OverskuddDistributionBatch[] {
    return this.ledger.listOverskuddDistributionBatches(input);
  }

  previewOverskuddDistribution(input: {
    date: string;
    allocations: OrganizationAllocationInput[];
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): OverskuddDistributionBatch {
    return this.ledger.previewOverskuddDistribution(input);
  }

  async refreshPlayerBalancesForWallet(walletId: string): Promise<string[]> {
    const normalizedWalletId = walletId.trim();
    if (!normalizedWalletId) {
      return [];
    }
    // BIN-693: refresh bruker available_balance så klient ser effekt av
    // reservations (bet:arm trekker saldo umiddelbart i visningen).
    const balance = this.walletAdapter.getAvailableBalance
      ? await this.walletAdapter.getAvailableBalance(normalizedWalletId)
      : await this.walletAdapter.getBalance(normalizedWalletId);
    const affected = new Set<string>();

    for (const room of this.rooms.values()) {
      let roomChanged = false;
      for (const player of room.players.values()) {
        if (player.walletId === normalizedWalletId) {
          player.balance = balance;
          roomChanged = true;
        }
      }
      if (roomChanged) {
        affected.add(room.code);
      }
    }

    return [...affected];
  }

  attachPlayerSocket(roomCode: string, playerId: string, socketId: string): void {
    const room = this.requireRoom(roomCode.trim().toUpperCase());
    const player = this.requirePlayer(room, playerId);
    this.assertWalletAllowedForGameplay(player.walletId, Date.now());
    player.socketId = socketId;
  }

  detachSocket(socketId: string): { roomCode: string; playerId: string } | null {
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.socketId === socketId) {
          player.socketId = undefined;
          return { roomCode: room.code, playerId: player.id };
        }
      }
    }
    return null;
  }

  private archiveIfEnded(room: RoomState): void {
    if (room.currentGame?.status === "ENDED") {
      room.gameHistory.push(this.serializeGame(room.currentGame));
      room.currentGame = undefined;
    }
  }

  private async refreshPlayerObjectsFromWallet(players: Player[]): Promise<void> {
    await Promise.all(
      players.map(async (player) => {
        player.balance = await this.walletAdapter.getBalance(player.walletId);
      })
    );
  }

  private assertWalletNotInRunningGame(walletId: string, exceptRoomCode?: string): void {
    const normalizedWalletId = walletId.trim();
    if (!normalizedWalletId) {
      return;
    }

    for (const room of this.rooms.values()) {
      if (exceptRoomCode && room.code === exceptRoomCode) {
        continue;
      }
      if (room.currentGame?.status !== "RUNNING") {
        continue;
      }

      for (const player of room.players.values()) {
        if (player.walletId !== normalizedWalletId) {
          continue;
        }
        throw new DomainError(
          "PLAYER_ALREADY_IN_RUNNING_GAME",
          `Spiller ${player.name} deltar allerede i et annet aktivt spill (rom ${room.code}).`
        );
      }
    }
  }

  private assertWalletNotAlreadyInRoom(room: RoomState, walletId: string): void {
    const normalizedWalletId = walletId.trim();
    if (!normalizedWalletId) {
      return;
    }

    const existing = [...room.players.values()].find((player) => player.walletId === normalizedWalletId);
    if (existing) {
      throw new DomainError(
        "PLAYER_ALREADY_IN_ROOM",
        `Spiller ${existing.name} finnes allerede i rommet. Bruk room:resume for reconnect.`
      );
    }
  }

  private assertRoundStartInterval(room: RoomState, nowMs: number): void {
    const lastRoundStartMs = this.resolveLastRoundStartMs(room);
    if (lastRoundStartMs === undefined) {
      return;
    }

    const elapsedMs = nowMs - lastRoundStartMs;
    if (elapsedMs >= this.minRoundIntervalMs) {
      return;
    }

    const remainingSeconds = Math.ceil((this.minRoundIntervalMs - elapsedMs) / 1000);
    throw new DomainError(
      "ROUND_START_TOO_SOON",
      `Det må gå minst ${Math.ceil(this.minRoundIntervalMs / 1000)} sekunder mellom spillstarter. Vent ${remainingSeconds} sekunder.`
    );
  }

  private resolveLastRoundStartMs(room: RoomState): number | undefined {
    const cached = this.roomLastRoundStartMs.get(room.code);
    if (cached !== undefined) {
      return cached;
    }

    const candidates: number[] = [];
    const currentGameStartMs = room.currentGame ? Date.parse(room.currentGame.startedAt) : Number.NaN;
    if (Number.isFinite(currentGameStartMs)) {
      candidates.push(currentGameStartMs);
    }
    if (room.gameHistory.length > 0) {
      const latestHistoricGame = room.gameHistory[room.gameHistory.length - 1];
      const historicStartMs = Date.parse(latestHistoricGame.startedAt);
      if (Number.isFinite(historicStartMs)) {
        candidates.push(historicStartMs);
      }
    }

    if (candidates.length === 0) {
      return undefined;
    }

    const latest = Math.max(...candidates);
    this.roomLastRoundStartMs.set(room.code, latest);
    return latest;
  }

  private async filterEligiblePlayers(
    players: Player[],
    entryFee: number,
    nowMs: number,
    hallId: string,
  ): Promise<Player[]> {
    const eligible: Player[] = [];
    for (const player of players) {
      if (entryFee > 0 && player.balance < entryFee) continue;
      if (this.compliance.wouldExceedLossLimit(player.walletId, entryFee, nowMs, hallId)) continue;
      eligible.push(player);
    }
    return eligible;
  }

  private isPlayerBlockedByRestriction(player: Player, nowMs: number): boolean {
    try {
      this.compliance.assertWalletAllowedForGameplay(player.walletId, nowMs);
      return false;
    } catch {
      return true;
    }
  }

  private isPlayerInAnotherRunningGame(roomCode: string, player: Player): boolean {
    for (const room of this.rooms.values()) {
      if (room.code === roomCode) continue;
      if (room.currentGame?.status === "RUNNING" && room.players.has(player.id)) {
        return true;
      }
    }
    return false;
  }

  // BIN-615 / PR-C2: protected so Game2Engine can finalize play sessions on auto-end.
  protected async finishPlaySessionsForGame(room: RoomState, game: GameState, endedAtMs: number): Promise<void> {
    for (const playerId of game.tickets.keys()) {
      const player = room.players.get(playerId);
      if (!player) {
        continue;
      }
      await this.compliance.finishPlaySession(player.walletId, room.hallId, endedAtMs);
    }

    // Fire onGameEnded callback (non-blocking).
    if (this.bingoAdapter.onGameEnded) {
      this.bingoAdapter.onGameEnded({
        roomCode: room.code,
        hallId: room.hallId,
        gameId: game.id,
        entryFee: game.entryFee,
        endedReason: game.endedReason ?? "UNKNOWN",
        drawnNumbers: [...game.drawnNumbers],
        claims: [...game.claims],
        playerIds: [...game.tickets.keys()]
      }).catch((err) => {
        logger.error({ err }, "onGameEnded callback failed");
      });
    }
  }

  // BIN-615 / PR-C2: protected so Game2Engine can resolve rooms in auto-claim helpers.
  protected requireRoom(roomCode: string): RoomState {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new DomainError("ROOM_NOT_FOUND", "Rommet finnes ikke.");
    }
    return room;
  }

  private requirePlayer(room: RoomState, playerId: string): Player {
    const player = room.players.get(playerId);
    if (!player) {
      throw new DomainError("PLAYER_NOT_FOUND", "Spiller finnes ikke i rommet.");
    }
    return player;
  }

  private requireRunningGame(room: RoomState): GameState {
    if (!room.currentGame || room.currentGame.status !== "RUNNING") {
      throw new DomainError("GAME_NOT_RUNNING", "Ingen aktiv runde i rommet.");
    }
    return room.currentGame;
  }

  private assertHost(room: RoomState, actorPlayerId: string): void {
    if (room.hostPlayerId !== actorPlayerId) {
      throw new DomainError("NOT_HOST", "Kun host kan utføre denne handlingen.");
    }
  }

  private assertNotRunning(room: RoomState): void {
    if (room.currentGame?.status === "RUNNING") {
      throw new DomainError("GAME_ALREADY_RUNNING", "Spillet er allerede i gang.");
    }
  }

  private assertPlayerName(playerName: string): string {
    const name = playerName.trim();
    if (!name) {
      throw new DomainError("INVALID_NAME", "Spillernavn kan ikke være tomt.");
    }
    if (name.length > 24) {
      throw new DomainError("INVALID_NAME", "Spillernavn kan maks være 24 tegn.");
    }
    return name;
  }

  private assertNonNegativeNumber(value: number, fieldName: string): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new DomainError("INVALID_INPUT", `${fieldName} må være 0 eller større.`);
    }
    return value;
  }

  private assertHallId(hallId: string): string {
    const normalized = hallId.trim();
    if (!normalized || normalized.length > 120) {
      throw new DomainError("INVALID_HALL_ID", "hallId er ugyldig.");
    }
    return normalized;
  }

  /**
   * BIN-245: Restore a room and its in-progress game from a PostgreSQL checkpoint snapshot.
   * Called during startup crash recovery when a game was RUNNING at the time of the last checkpoint.
   * Reconstructs in-memory Maps/Sets from the snapshot's plain-object serialization.
   */
  /**
   * BIN-245: Restore a room + in-progress game from a PostgreSQL checkpoint.
   *
   * Implementasjon ekstrahert til {@link BingoEngineRecovery.restoreRoomFromSnapshot}
   * i refactor/s1-bingo-engine-split (Forslag A).
   */
  restoreRoomFromSnapshot(
    roomCode: string,
    hallId: string,
    hostPlayerId: string,
    players: Player[],
    snapshot: GameSnapshot,
    // BIN-672: required — caller MUST pass a gameSlug.
    gameSlug: string,
  ): void {
    restoreRoomFromSnapshotHelper(
      this.getRecoveryContext(),
      roomCode,
      hallId,
      hostPlayerId,
      players,
      snapshot,
      gameSlug,
    );
  }

  /** BIN-251: Sync room state to external store (e.g. Redis) after structural mutations.
   * In-place game mutations (draws, marks, claims) are synced by callers via persist(). */
  private syncRoomToStore(room: RoomState): void {
    this.roomStateStore?.set(room.code, room);
  }

  private serializeRoom(room: RoomState): RoomSnapshot {
    return {
      code: room.code,
      hallId: room.hallId,
      hostPlayerId: room.hostPlayerId,
      gameSlug: room.gameSlug,
      createdAt: room.createdAt,
      players: [...room.players.values()],
      currentGame: room.currentGame ? this.serializeGame(room.currentGame) : undefined,
      gameHistory: room.gameHistory.map((game) => ({ ...game }))
    };
  }

  /**
   * HOEY-4: Refund buy-ins when game startup fails partway through.
   *
   * Implementasjon ekstrahert til {@link BingoEngineRecovery.refundDebitedPlayers}.
   */
  private async refundDebitedPlayers(
    debitedPlayers: Array<{
      player: Player;
      fromAccountId: string;
      toAccountId: string;
      amount: number;
    }>,
    houseAccountId: string,
    roomCode: string,
    gameId: string,
  ): Promise<{
    failedRefunds: Array<{
      playerId: string;
      walletId: string;
      amount: number;
      error: string;
    }>;
  }> {
    return refundDebitedPlayersHelper(
      this.walletAdapter,
      debitedPlayers,
      houseAccountId,
      roomCode,
      gameId,
    );
  }

  /**
   * HOEY-3: Write a DRAW checkpoint after each ball draw.
   *
   * Implementasjon ekstrahert til {@link BingoEngineRecovery.writeDrawCheckpoint}.
   */
  private async writeDrawCheckpoint(room: RoomState, game: GameState): Promise<void> {
    return writeDrawCheckpointHelper(this.getRecoveryContext(), room, game);
  }

  /**
   * HOEY-6: Write a GAME_END checkpoint for any termination path.
   *
   * Implementasjon ekstrahert til {@link BingoEngineRecovery.writeGameEndCheckpoint}.
   * BIN-615 / PR-C2: protected så Game2Engine kan finalisere auto-claim-end.
   */
  protected async writeGameEndCheckpoint(room: RoomState, game: GameState): Promise<void> {
    return writeGameEndCheckpointHelper(this.getRecoveryContext(), room, game);
  }

  /**
   * Write payout checkpoint with one retry. Logs CRITICAL on final failure
   * but does not throw.
   *
   * Implementasjon ekstrahert til {@link BingoEngineRecovery.writePayoutCheckpointWithRetry}.
   * BIN-615 / PR-C2: protected så Game2Engine kan checkpoint etter jackpot-payouts.
   */
  protected async writePayoutCheckpointWithRetry(
    room: RoomState,
    game: GameState,
    claimId: string,
    payoutAmount: number,
    transactionIds: string[],
    prizeType: "LINE" | "BINGO",
  ): Promise<void> {
    return writePayoutCheckpointWithRetryHelper(
      this.getRecoveryContext(),
      room,
      game,
      claimId,
      payoutAmount,
      transactionIds,
      prizeType,
    );
  }

  private serializeGame(game: GameState): GameSnapshot {
    const ticketByPlayerId = Object.fromEntries(
      [...game.tickets.entries()].map(([playerId, tickets]) => [playerId, tickets.map((ticket) => ({ ...ticket }))])
    );
    // BIN-244: Preserve per-ticket structure — outer array index = ticket index.
    // Previously merged into a single flat set, making multi-ticket recovery impossible.
    const marksByPlayerId = Object.fromEntries(
      [...game.marks.entries()].map(([playerId, marksByTicket]) => [
        playerId,
        marksByTicket.map((ticketMarks) => [...ticketMarks].sort((a, b) => a - b))
      ])
    );

    return {
      id: game.id,
      status: game.status,
      entryFee: game.entryFee,
      ticketsPerPlayer: game.ticketsPerPlayer,
      prizePool: game.prizePool,
      remainingPrizePool: game.remainingPrizePool,
      payoutPercent: game.payoutPercent,
      maxPayoutBudget: game.maxPayoutBudget,
      remainingPayoutBudget: game.remainingPayoutBudget,
      // BIN-243: Store the full ordered draw bag, not just the count.
      drawBag: [...game.drawBag],
      drawnNumbers: [...game.drawnNumbers],
      remainingNumbers: game.drawBag.length,
      lineWinnerId: game.lineWinnerId,
      bingoWinnerId: game.bingoWinnerId,
      patterns: (game.patterns ?? []).map((p) => ({ ...p })),
      patternResults: (game.patternResults ?? []).map((r) => ({ ...r })),
      claims: [...game.claims],
      tickets: ticketByPlayerId,
      marks: marksByPlayerId,
      participatingPlayerIds: game.participatingPlayerIds,
      isPaused: game.isPaused,
      pauseMessage: game.pauseMessage,
      isTestGame: game.isTestGame,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
      endedReason: game.endedReason
    };
  }

  /**
   * KRITISK-5/6: Full engine state for checkpoint recovery.
   *
   * Implementasjon ekstrahert til {@link BingoEngineRecovery.serializeGameForRecovery}.
   */
  private serializeGameForRecovery(game: GameState): RecoverableGameSnapshot {
    return serializeGameForRecoveryHelper((g) => this.serializeGame(g), game);
  }

  /**
   * Bygger narrow port mot recovery-modulen. Samler `rooms`, adapterne
   * + callbacks til private helpers (`syncRoomToStore`, `serializeGame`)
   * som modulen trenger uten å eksponere dem som public getters.
   */
  private getRecoveryContext(): RecoveryContext {
    return {
      bingoAdapter: this.bingoAdapter,
      walletAdapter: this.walletAdapter,
      rooms: this.rooms,
      syncRoomToStore: (room) => this.syncRoomToStore(room),
      serializeGame: (game) => this.serializeGame(game),
    };
  }
}

/**
 * PR-P3 (Super-NILS): Map 75-ball bingo-tall til B/I/N/G/O-kolonne.
 *   B = 1-15, I = 16-30, N = 31-45, G = 46-60, O = 61-75.
 * Returns null for out-of-range (1-75) — engine kaster da COLUMN_PRIZE_MISSING.
 * Eksportert for test + potensielt delt bruk med admin-UI preview.
 */
export function ballToColumn(
  ball: number | undefined,
): "B" | "I" | "N" | "G" | "O" | null {
  if (typeof ball !== "number" || !Number.isFinite(ball)) return null;
  if (ball >= 1 && ball <= 15) return "B";
  if (ball >= 16 && ball <= 30) return "I";
  if (ball >= 31 && ball <= 45) return "N";
  if (ball >= 46 && ball <= 60) return "G";
  if (ball >= 61 && ball <= 75) return "O";
  return null;
}

export function toPublicError(error: unknown): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  if (error instanceof DomainError) {
    const payload: { code: string; message: string; details?: Record<string, unknown> } = {
      code: error.code,
      message: error.message,
    };
    if (error.details !== undefined) {
      payload.details = error.details;
    }
    return payload;
  }
  if (error instanceof WalletError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "Uventet feil i server."
  };
}
