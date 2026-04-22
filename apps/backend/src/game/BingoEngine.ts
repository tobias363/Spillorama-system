import { randomUUID, createHash } from "node:crypto";
import type { BingoSystemAdapter } from "../adapters/BingoSystemAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { roundCurrency } from "../util/currency.js";
import { logger as rootLogger } from "../util/logger.js";
import * as variantConfigModule from "./variantConfig.js";

const logger = rootLogger.child({ module: "engine" });
import {
  findFirstCompleteLinePatternIndex,
  countCompleteLines,
  countCompleteRows,
  countCompleteColumns,
  hasFullBingo,
  makeRoomCode,
  ticketContainsNumber,
  buildTicketMask5x5,
} from "./ticket.js";
import {
  classifyPhaseFromPatternName,
  ticketMaskMeetsPhase,
} from "@spillorama/shared-types/spill1-patterns";
import { buildDrawBag, resolveDrawBagConfig } from "./DrawBagStrategy.js";
import { resolvePatternsForColor } from "./spill1VariantMapper.js";
import type { PatternConfig } from "./variantConfig.js";
// PR-P5: Gjenbruker bitmask-matcher for custom concurrent patterns.
import {
  buildTicketMask as patternMatcherBuildTicketMask,
  matchesPattern as patternMatcherMatches,
} from "./PatternMatcher.js";

/** PR B: Sentinel-nøkkel for flat-path vinner-gruppen (én gruppe, ingen farge-skille). */
const FLAT_GROUP_KEY = "__flat__";
/** PR B: Sentinel-nøkkel for brett uten ticket.color satt — bruker __default__-matrise. */
const UNCOLORED_KEY = "__uncolored__";
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
  ResponsibleGamingPersistenceAdapter,
  ResponsibleGamingPersistenceSnapshot
} from "./ResponsibleGamingPersistence.js";
import { ComplianceManager } from "./ComplianceManager.js";
import type {
  LossLimits,
  LossLedgerEntry,
  PlayerComplianceSnapshot,
  GameplayBlockType
} from "./ComplianceManager.js";
import { PrizePolicyManager } from "./PrizePolicyManager.js";
import type { PrizeGameType, PrizePolicySnapshot, PrizePolicyVersion, ExtraPrizeEntry, ExtraDrawDenialAudit } from "./PrizePolicyManager.js";
import { PayoutAuditTrail } from "./PayoutAuditTrail.js";
import type { PayoutAuditEvent } from "./PayoutAuditTrail.js";
import { ComplianceLedger } from "./ComplianceLedger.js";
import type { LedgerGameType, LedgerChannel, LedgerEventType, ComplianceLedgerEntry, DailyComplianceReport, DailyComplianceReportRow, RangeComplianceReport, GameStatisticsReport, OrganizationAllocationInput, OverskuddDistributionTransfer, OverskuddDistributionBatch, RevenueSummary, TimeSeriesReport, TimeSeriesGranularity, TopPlayersReport, GameSessionsReport } from "./ComplianceLedger.js";
import type { LoyaltyPointsHookPort } from "../adapters/LoyaltyPointsHookPort.js";
import { NoopLoyaltyPointsHookPort } from "../adapters/LoyaltyPointsHookPort.js";
import type { SplitRoundingAuditPort } from "../adapters/SplitRoundingAuditPort.js";
import { NoopSplitRoundingAuditPort } from "../adapters/SplitRoundingAuditPort.js";

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

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
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
/** BIN-253: Minimum milliseconds between successive manual draw calls to prevent rapid-fire draws. */
const MIN_MANUAL_DRAW_INTERVAL_MS = 500;

export class BingoEngine {
  /** HOEY-7: Pluggable room state store (in-memory or Redis-backed). */
  // BIN-615 / PR-C2: protected so Game2Engine can persist rooms after auto-claim payouts.
  protected readonly rooms: RoomStateStore;
  private readonly roomLastRoundStartMs = new Map<string, number>();
  /** BIN-253: Tracks last draw timestamp per room for minimum-interval enforcement. */
  private readonly roomLastDrawMs = new Map<string, number>();
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
      logger.debug({ walletId }, "getBalance start");
      balance = await this.walletAdapter.getBalance(walletId);
      logger.debug({ walletId, balance }, "getBalance OK");
    } catch (err) {
      logger.error({ walletId, err }, "getBalance FAILED");
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
          const transfer = await this.walletAdapter.transfer(
            player.walletId,
            houseAccountId,
            playerBuyIn,
            `Bingo buy-in ${room.code} (${playerTicketCount} tickets)`,
            { idempotencyKey: `buyin-${gameId}-${player.id}` }
          );
          debitedPlayers.push({ player, fromAccountId: transfer.fromTx.accountId, toAccountId: transfer.toTx.accountId, amount: playerBuyIn });
          player.balance -= playerBuyIn;
          await this.compliance.recordLossEntry(player.walletId, room.hallId, {
            type: "BUYIN",
            amount: playerBuyIn,
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

  /**
   * BIN-694: Evaluér om aktiv fase er vunnet etter siste ball. Kalles
   * automatisk fra `drawNextNumber` når `patternEvalMode ===
   * "auto-claim-on-draw"`.
   *
   * Fase-modell (prosjektleder-spec 2026-04-20):
   *   1. "1 Rad"     → ≥1 hel linje (av 12 mulige per brett)
   *   2. "2 Rader"   → ≥2 hele linjer
   *   3. "Fullt Hus" → alle 25 felt merket
   *
   * Multi-winner-split: flere spillere som oppfyller samme fase på
   * samme ball deler premien likt (per spiller, ikke per brett — så en
   * spiller med 3 vinnende brett regnes som ÉN vinner i splittingen).
   *
   * Etter at fasen er vunnet fortsetter metoden rekursivt for å dekke
   * det sjeldne scenariet der samme ball fullfører to faser (f.eks.
   * spilleren fikk både 1. og 2. linje på samme ball).
   *
   * Runden avsluttes kun når Fullt Hus-fasen er vunnet (eller via
   * MAX_DRAWS_REACHED / DRAW_BAG_EMPTY i drawNextNumber).
   */
  private async evaluateActivePhase(room: RoomState, game: GameState): Promise<void> {
    if (!game.patternResults || game.status !== "RUNNING") return;

    // PR-P5 (Extra-variant): custom concurrent patterns har egen evaluator.
    // Hvis variantConfig.customPatterns er satt og ikke-tom, delegeres til
    // parallell-evaluator. Validator i startGame avviser kombinasjon med
    // patternsByColor (CUSTOM_AND_STANDARD_EXCLUSIVE), så her kan vi stole
    // på at én mode gjelder av gangen.
    const variantConfigForCustomCheck = this.variantConfigByRoom.get(room.code);
    const hasCustomPatterns =
      Array.isArray(variantConfigForCustomCheck?.customPatterns) &&
      variantConfigForCustomCheck!.customPatterns!.length > 0;
    if (hasCustomPatterns) {
      await this.evaluateConcurrentPatterns(room, game);
      return;
    }

    // Find next unwon phase in `order` (patternResults preserves config order).
    const activeResult = game.patternResults.find((r) => !r.isWon);
    if (!activeResult) return;

    const activePattern = game.patterns?.find((p) => p.id === activeResult.patternId);
    if (!activePattern) return;

    // BIN-694: Auto-claim bruker `game.drawnNumbers` som vinner-grunnlag,
    // IKKE `game.marks` — marks er for klient-side UI (manuell merking
    // via socket `ticket:mark`), men server-side evaluation skal være
    // basert på hva som faktisk er trukket. Dette gjør også at spillere
    // som ikke aktivt trykker "merk" fortsatt kan vinne.
    const drawnSet = new Set(game.drawnNumbers);

    // PR B (variantConfig-admin-kobling): per-farge-matrise.
    // Hvis `variantConfig.patternsByColor` er satt, kjøres per-farge-pathen
    // der hver farge har egen premie-matrise og multi-winner-split skjer
    // innen én farges vinnere (PM-vedtak "Option X"). Ellers faller vi
    // tilbake til dagens flat-path.
    const variantConfig = this.variantConfigByRoom.get(room.code);
    const hasPerColorMatrix = Boolean(variantConfig?.patternsByColor);

    // Fase-index = posisjon i canonical pattern-array (mapperen garanterer
    // samme rekkefølge på tvers av farger, så index identifiserer fasen).
    const phaseIndex = game.patterns ? game.patterns.indexOf(activePattern) : 0;

    // Detect winners. For flat-path: uniqueset per player. For per-color:
    // Map<color, Set<playerId>> — en spiller kan vinne i flere farger hvis
    // de har brett i flere farger som alle oppfyller fasen.
    const winnerGroups = this.detectPhaseWinners(
      game, drawnSet, activePattern, variantConfig, hasPerColorMatrix, phaseIndex, room.code,
    );

    if (winnerGroups.totalUniqueWinners === 0) return;

    // Pay out per color-group. For flat-path, the groups map has a single
    // entry under `FLAT_GROUP_KEY`. For per-color, multiple entries.
    let firstPayoutAmount = 0;
    let firstWinnerId = "";
    const allWinnerIds: string[] = [];

    // BIN-687 / PR-P2: cache for multiplier-chain phase-1 base price per
    // color. Computed on-demand when first phase > 1 pattern is payouts.
    // Key = groupKey (FLAT_GROUP_KEY for flat-path, color-name for per-color).
    // Value = phase-1 base prize in kr AFTER minPrize-floor applied — so
    // multiplier-chain-phase-N cascade bygger på gulv-justert base (samsvar
    // med papir-regelen: "Rad 2 min 50 kr" gjelder også når fase 1 ble
    // gulv-justert).
    const phase1BaseCache = new Map<string, number>();
    const computePhase1Base = (
      groupKey: string,
      patterns: readonly PatternConfig[] | null
    ): number => {
      const cached = phase1BaseCache.get(groupKey);
      if (cached !== undefined) return cached;
      // Flat-path (patterns=null): bruk game.patterns[0] som fase-1-kilde.
      // Per-color: bruk patterns[0] fra fargens matrise.
      const phase1 = patterns
        ? patterns[0]
        : (game.patterns?.[0] ?? null);
      if (!phase1) {
        phase1BaseCache.set(groupKey, 0);
        return 0;
      }
      const rawPhase1 = Math.floor(
        game.prizePool * (phase1.prizePercent ?? 0) / 100
      );
      const base = Math.max(rawPhase1, phase1.minPrize ?? 0);
      phase1BaseCache.set(groupKey, base);
      return base;
    };

    for (const [groupKey, group] of winnerGroups.byColor) {
      const winnerIds = [...group.playerIds];
      if (winnerIds.length === 0) continue;

      // Resolve prize for this color. flat-path bruker activePattern direkte.
      const prizeSource: {
        winningType?:
          | "percent"
          | "fixed"
          | "multiplier-chain"
          | "column-specific"
          | "ball-value-multiplier";
        prize1?: number;
        prizePercent: number;
        name: string;
        phase1Multiplier?: number;
        minPrize?: number;
        columnPrizesNok?: { B: number; I: number; N: number; G: number; O: number };
        claimType?: "LINE" | "BINGO";
        baseFullHousePrizeNok?: number;
        ballValueMultiplier?: number;
      } =
        hasPerColorMatrix && group.patternForColor
          ? group.patternForColor
          : activePattern;

      // BIN-687 / PR-P2: resolve color-specific phase-1 base for
      // multiplier-chain lookups. For flat-path, patterns=null → cache
      // uses game.patterns[0]; for per-color, patterns from
      // resolvePatternsForColor for denne fargen.
      const colorPatternsForPhase1 = hasPerColorMatrix
        ? resolvePatternsForColor(
            this.variantConfigByRoom.get(room.code)!,
            groupKey === FLAT_GROUP_KEY ? "" : groupKey
          )
        : null;

      let totalPhasePrize: number;
      if (prizeSource.winningType === "fixed") {
        totalPhasePrize = Math.max(0, prizeSource.prize1 ?? 0);
      } else if (prizeSource.winningType === "multiplier-chain") {
        // Fase 1 identifiseres ved fravær av phase1Multiplier-felt (undefined).
        // I så fall bruker vi percent + gulv. For fase N > 1: phase1Base ×
        // multiplier med egen gulv. Admin-valideringen i Spill1Config avviser
        // phase1Multiplier === 0 så engine slipper å håndtere edge-casen.
        const isPhase1 = prizeSource.phase1Multiplier === undefined;
        const basePrize = isPhase1
          ? Math.floor(game.prizePool * (prizeSource.prizePercent ?? 0) / 100)
          : Math.floor(
              computePhase1Base(groupKey, colorPatternsForPhase1) *
                prizeSource.phase1Multiplier!
            );
        totalPhasePrize = Math.max(basePrize, prizeSource.minPrize ?? 0);
      } else if (prizeSource.winningType === "column-specific") {
        // PR-P3 (Super-NILS): Fullt-Hus-premie avgjøres av kolonne (B/I/N/G/O)
        // for siste trukne ball — dvs. ballen som fullførte bingoen. Admin-
        // valideringen avviser column-specific på ikke-full-house-patterns,
        // men engine dobbeltsjekker for defense-in-depth.
        if (prizeSource.claimType !== "BINGO" && activePattern.claimType !== "BINGO") {
          throw new DomainError(
            "COLUMN_PRIZE_INVALID_PATTERN",
            "column-specific winning type kan kun brukes på Fullt Hus-patterns.",
          );
        }
        if (!prizeSource.columnPrizesNok) {
          throw new DomainError(
            "COLUMN_PRIZE_MISSING",
            "columnPrizesNok mangler for column-specific-pattern.",
          );
        }
        const lastBall = game.drawnNumbers[game.drawnNumbers.length - 1];
        const col = ballToColumn(lastBall);
        if (!col) {
          throw new DomainError(
            "COLUMN_PRIZE_MISSING",
            `Siste ball ${lastBall} mapper ikke til B/I/N/G/O (krever 75-ball).`,
          );
        }
        const prizeForCol = prizeSource.columnPrizesNok[col];
        if (typeof prizeForCol !== "number" || !Number.isFinite(prizeForCol)) {
          throw new DomainError(
            "COLUMN_PRIZE_MISSING",
            `columnPrizesNok.${col} mangler eller er ikke et tall.`,
          );
        }
        totalPhasePrize = Math.max(0, prizeForCol);
      } else if (prizeSource.winningType === "ball-value-multiplier") {
        // PR-P4 (Ball × 10): Fullt-Hus-premie = base + lastBall × multiplier.
        // Bruker rå ball-verdi (ikke kolonne-mapping som P3). Admin-validator
        // avviser på ikke-full-house-pattern; engine dobbeltsjekker for
        // defense-in-depth og fail-closed ved manglende felt.
        if (
          prizeSource.claimType !== "BINGO" &&
          activePattern.claimType !== "BINGO"
        ) {
          throw new DomainError(
            "BALL_VALUE_INVALID_PATTERN",
            "ball-value-multiplier kan kun brukes på Fullt Hus-patterns.",
          );
        }
        const base = prizeSource.baseFullHousePrizeNok;
        const mult = prizeSource.ballValueMultiplier;
        if (
          typeof base !== "number" ||
          !Number.isFinite(base) ||
          base < 0 ||
          typeof mult !== "number" ||
          !Number.isFinite(mult) ||
          mult <= 0
        ) {
          throw new DomainError(
            "BALL_VALUE_FIELDS_MISSING",
            "ball-value-multiplier krever baseFullHousePrizeNok ≥ 0 og ballValueMultiplier > 0.",
          );
        }
        const lastBall = game.drawnNumbers[game.drawnNumbers.length - 1];
        if (
          typeof lastBall !== "number" ||
          !Number.isFinite(lastBall) ||
          lastBall < 1
        ) {
          throw new DomainError(
            "BALL_VALUE_FIELDS_MISSING",
            "Ingen gyldig siste-ball tilgjengelig for ball-value-beregning.",
          );
        }
        totalPhasePrize = Math.max(0, base + lastBall * mult);
      } else {
        totalPhasePrize = Math.floor(
          game.prizePool * (prizeSource.prizePercent ?? 0) / 100
        );
      }
      // Floor division — any remainder stays with the house (house-rounding).
      const prizePerWinner = Math.floor(totalPhasePrize / winnerIds.length);

      // GAME1_SCHEDULE PR 5 (§3.7): audit rest-øre som huset beholder
      // per farge-gruppe. Formel: totalPhasePrize - winnerCount × prizePerWinner.
      const houseRetainedRest = totalPhasePrize - (winnerIds.length * prizePerWinner);
      if (houseRetainedRest > 0) {
        try {
          await this.splitRoundingAudit.onSplitRoundingHouseRetained({
            amount: houseRetainedRest,
            winnerCount: winnerIds.length,
            totalPhasePrize,
            prizePerWinner,
            patternName: prizeSource.name,
            roomCode: room.code,
            gameId: game.id,
            hallId: room.hallId,
          });
        } catch (err) {
          logger.warn(
            { err, gameId: game.id, roomCode: room.code, amount: houseRetainedRest, color: groupKey },
            "split-rounding audit hook failed — engine fortsetter uansett"
          );
        }
      }

      // Build a per-color PatternDefinition so payoutPhaseWinner can
      // reference the correct pattern.name + winningType + prize1 for
      // audit/ledger purposes. Uses activePattern.id so patternResults
      // stays addressable by its original patternId.
      const colorPattern: PatternDefinition = hasPerColorMatrix && group.patternForColor
        ? {
            ...activePattern,
            name: group.patternForColor.name,
            claimType: group.patternForColor.claimType,
            prizePercent: group.patternForColor.prizePercent,
            ...(typeof group.patternForColor.prize1 === "number" ? { prize1: group.patternForColor.prize1 } : {}),
            ...(group.patternForColor.winningType ? { winningType: group.patternForColor.winningType } : {}),
          }
        : activePattern;

      // Pay out each winner before marking the phase won — so a wallet
      // failure for one winner doesn't leave the phase half-committed.
      for (const playerId of winnerIds) {
        await this.payoutPhaseWinner(
          room, game, playerId, colorPattern, activeResult, prizePerWinner,
        );
      }

      // GAME1_SCHEDULE PR 5: Loyalty game.win hook per vinner (fire-and-forget).
      if (prizePerWinner > 0) {
        for (const playerId of winnerIds) {
          try {
            await this.loyaltyHook.onLoyaltyEvent({
              kind: "game.win",
              userId: playerId,
              amount: prizePerWinner,
              patternName: colorPattern.name,
              roomCode: room.code,
              gameId: game.id,
              hallId: room.hallId,
            });
          } catch (err) {
            logger.warn(
              { err, gameId: game.id, playerId },
              "loyalty game.win hook failed — engine fortsetter uansett"
            );
          }
        }
      }

      // Track first payout for backward-compat patternResult fields.
      if (firstWinnerId === "" && winnerIds.length > 0) {
        firstWinnerId = winnerIds[0]!;
        firstPayoutAmount = prizePerWinner;
      }
      // Aggregate winners — deduplicate hvis samme spiller vant i flere farger.
      for (const pid of winnerIds) {
        if (!allWinnerIds.includes(pid)) allWinnerIds.push(pid);
      }
    }

    // Mark phase as won. For multi-winner the `winnerId` is set to the
    // first winner (backward compat with single-winner test assertions);
    // the full list lives in `winnerIds` (BIN-696) + per-winner
    // ClaimRecords on game.claims.
    activeResult.isWon = true;
    activeResult.wonAtDraw = game.drawnNumbers.length;
    activeResult.winnerId = firstWinnerId;
    activeResult.winnerIds = [...allWinnerIds];
    activeResult.payoutAmount = firstPayoutAmount;

    // End round when Fullt Hus is won.
    if (activePattern.claimType === "BINGO") {
      const endedAtMs = Date.now();
      game.status = "ENDED";
      game.bingoWinnerId = firstWinnerId;
      game.endedAt = new Date(endedAtMs).toISOString();
      game.endedReason = "BINGO_CLAIMED";
      await this.finishPlaySessionsForGame(room, game, endedAtMs);
      await this.writeGameEndCheckpoint(room, game);
      return;
    }

    // Phase 1 → mark lineWinnerId for backward-compat with existing readers.
    if (activePattern.claimType === "LINE" && !game.lineWinnerId) {
      game.lineWinnerId = firstWinnerId;
    }

    // Rare: same ball won two phases simultaneously — recurse.
    await this.evaluateActivePhase(room, game);
  }

  /**
   * PR-P5 (Extra-variant): concurrent pattern-evaluator.
   *
   * Semantikken er fundamentalt annerledes enn `evaluateActivePhase`:
   *   - Sekvensiell flyt: første unwon pattern per draw; neste trinn
   *     aktiveres når forrige er vunnet.
   *   - Concurrent flyt: ALLE unwon customPatterns evalueres parallelt
   *     per draw. Ett bong kan samtidig oppfylle flere patterns og
   *     få betalt på alle.
   *
   * Payout-rekkefølge matcher `customPatterns.config`-rekkefølge slik at
   * `pattern:won`-events emittes stabilt (Agent 4-kontrakten bevares —
   * én event per vunnet pattern, sekvensielt innenfor draw).
   *
   * Idempotency: hvert pattern har egen `patternResults[i].isWon`-flag.
   * Allerede-vunne patterns hoppes over ved re-evaluering. Payout er
   * dermed idempotent mot samme draw (eksisterende pattern-level guard).
   *
   * Game avsluttes kun når ALLE customPatterns er vunnet (alle
   * `isWon === true`), ELLER når full-house-pattern (mask === 0x1FFFFFF)
   * vinnes.
   */
  private async evaluateConcurrentPatterns(
    room: RoomState,
    game: GameState,
  ): Promise<void> {
    if (!game.patternResults || game.status !== "RUNNING") return;
    const drawnSet = new Set(game.drawnNumbers);

    // Iterer alle unwon patterns i config-rekkefølge.
    for (const result of game.patternResults) {
      if (result.isWon) continue;
      const pattern = game.patterns?.find((p) => p.id === result.patternId);
      if (!pattern || !pattern.mask) continue;

      // Finn vinnere for DENNE patternen. Concurrent semantikk:
      // flat-path (uten per-farge-matrise — som er garantert fravær siden
      // startGame-validator avviser kombinasjon). Én spiller = én vinner-slot
      // per pattern (uavhengig av antall bong).
      const winnerIds: string[] = [];
      const uniqueWinners = new Set<string>();
      const patternMask = pattern.mask;
      if (typeof patternMask !== "number") continue;
      for (const [playerId, tickets] of game.tickets) {
        if (uniqueWinners.has(playerId)) continue;
        const playerMarksAll = game.marks.get(playerId);
        for (let ticketIdx = 0; ticketIdx < tickets.length; ticketIdx += 1) {
          const ticket = tickets[ticketIdx];
          const playerMarks = playerMarksAll?.[ticketIdx];
          const marksSet: Set<number> =
            playerMarks && playerMarks.size > 0
              ? playerMarks
              : drawnSet;
          const ticketMask = patternMatcherBuildTicketMask(ticket, marksSet);
          if (patternMatcherMatches(ticketMask, patternMask)) {
            uniqueWinners.add(playerId);
            winnerIds.push(playerId);
            break;
          }
        }
      }

      if (winnerIds.length === 0) continue;

      // Beregn payout per pattern. Gjenbruker eksisterende winning-types
      // (fixed/percent/multiplier-chain/column-specific/ball-value-multiplier)
      // via samme utregning som evaluateActivePhase. Custom patterns har
      // ikke per-farge-matrise i P5 (mutually exclusive), så flat-path.
      const lastBall = game.drawnNumbers[game.drawnNumbers.length - 1];
      const totalPhasePrize = this.computeCustomPatternPrize(
        pattern,
        game.prizePool,
        lastBall,
      );
      const prizePerWinner = Math.floor(totalPhasePrize / winnerIds.length);

      const houseRetainedRest = totalPhasePrize - (winnerIds.length * prizePerWinner);
      if (houseRetainedRest > 0) {
        try {
          await this.splitRoundingAudit.onSplitRoundingHouseRetained({
            amount: houseRetainedRest,
            winnerCount: winnerIds.length,
            totalPhasePrize,
            prizePerWinner,
            patternName: pattern.name,
            roomCode: room.code,
            gameId: game.id,
            hallId: room.hallId,
          });
        } catch (err) {
          logger.warn(
            { err, gameId: game.id, roomCode: room.code, amount: houseRetainedRest },
            "split-rounding audit hook failed — engine fortsetter uansett",
          );
        }
      }

      // Payout per vinner. Idempotency: payoutPhaseWinner har allerede
      // duplicate-guard via patternResult.isWon + claim-id sammensetning.
      // PR-P5 idempotency-key: custom-pattern-{gameId}-{patternId}-{playerId}
      // inngår i claim.id via patternId-del av ledger-key.
      for (const playerId of winnerIds) {
        await this.payoutPhaseWinner(
          room, game, playerId, pattern, result, prizePerWinner,
        );
      }

      // Mark pattern som vunnet + broadcast-kompatibelt snapshot.
      result.isWon = true;
      result.winnerIds = [...winnerIds];
      result.winnerId = winnerIds[0];
      result.winnerCount = winnerIds.length;
      result.wonAtDraw = game.drawnNumbers.length;
      result.payoutAmount = prizePerWinner;
    }

    // Spillet avsluttes når alle customPatterns er vunnet. Full-house-
    // pattern (mask === 0x1FFFFFF) kan også trigge tidlig avslutning, men
    // scope-bekreftelsen sa "alle unwon = ferdig" — enkleste semantikken.
    const allDone = game.patternResults.every((r) => r.isWon);
    if (allDone) {
      const endedAtMs = Date.now();
      game.status = "ENDED";
      game.endedAt = new Date(endedAtMs).toISOString();
      game.endedReason = "BINGO_CLAIMED";
      await this.finishPlaySessionsForGame(room, game, endedAtMs);
      await this.writeGameEndCheckpoint(room, game);
    }
  }

  /**
   * PR-P5: compute prize for custom pattern. Gjenbruker winning-type-
   * logikken fra evaluateActivePhase i forenklet flat-path form (ingen
   * per-farge-matrise for custom).
   */
  private computeCustomPatternPrize(
    pattern: PatternDefinition,
    prizePool: number,
    lastBall: number | undefined,
  ): number {
    if (pattern.winningType === "fixed") {
      return Math.max(0, pattern.prize1 ?? 0);
    }
    if (pattern.winningType === "column-specific") {
      if (!pattern.columnPrizesNok || typeof lastBall !== "number") {
        throw new DomainError(
          "COLUMN_PRIZE_MISSING",
          "columnPrizesNok mangler eller lastBall udefinert.",
        );
      }
      const col = ballToColumn(lastBall);
      if (!col) throw new DomainError("COLUMN_PRIZE_MISSING", `Ball ${lastBall} utenfor B/I/N/G/O.`);
      return Math.max(0, pattern.columnPrizesNok[col]);
    }
    if (pattern.winningType === "ball-value-multiplier") {
      const base = pattern.baseFullHousePrizeNok;
      const mult = pattern.ballValueMultiplier;
      if (
        typeof base !== "number" || base < 0 ||
        typeof mult !== "number" || mult <= 0 ||
        typeof lastBall !== "number"
      ) {
        throw new DomainError(
          "BALL_VALUE_FIELDS_MISSING",
          "base/multiplier/lastBall mangler for ball-value.",
        );
      }
      return Math.max(0, base + lastBall * mult);
    }
    // multiplier-chain i concurrent-path er ikke meningsfylt (fase-1-basis
    // er en sekvens-konsept). Fall tilbake til percent-beregning.
    return Math.floor(prizePool * (pattern.prizePercent ?? 0) / 100);
  }

  /**
   * PR B: Detekter fase-vinnere, gruppert per farge når
   * `patternsByColor` er satt. Flat-path returnerer én gruppe under
   * nøkkelen `FLAT_GROUP_KEY`.
   *
   * Per-farge-semantikk (PM-vedtak "Option X"):
   *   - En (spiller, farge)-kombinasjon er en unik winner-slot.
   *   - En spiller med brett i flere farger, der flere farger oppfyller
   *     fasen, vinner i hver farge — får betalt én gang per farge.
   *   - Multi-winner-split skjer innen én farges vinnere.
   *
   * Flat-path-semantikk (uendret fra før):
   *   - En spiller vinner fasen én gang uansett antall brett.
   *   - Alle vinnere deler én pott likt.
   */
  private detectPhaseWinners(
    game: GameState,
    drawnSet: Set<number>,
    activePattern: PatternDefinition,
    variantConfig: import("./variantConfig.js").GameVariantConfig | undefined,
    hasPerColorMatrix: boolean,
    phaseIndex: number,
    roomCode: string,
  ): {
    totalUniqueWinners: number;
    byColor: Map<string, { playerIds: Set<string>; patternForColor: PatternConfig | null }>;
  } {
    const byColor = new Map<string, { playerIds: Set<string>; patternForColor: PatternConfig | null }>();
    const uniquePlayers = new Set<string>();

    if (!hasPerColorMatrix || !variantConfig) {
      // Flat-path: én gruppe, uniqueset per player (ignorér farge).
      const flatIds = new Set<string>();
      for (const [playerId, tickets] of game.tickets) {
        for (let i = 0; i < tickets.length; i += 1) {
          if (this.meetsPhaseRequirement(activePattern, tickets[i], drawnSet)) {
            flatIds.add(playerId);
            break;
          }
        }
      }
      if (flatIds.size > 0) {
        byColor.set(FLAT_GROUP_KEY, { playerIds: flatIds, patternForColor: null });
      }
      return { totalUniqueWinners: flatIds.size, byColor };
    }

    // Per-color path: iterate alle brett, grupper per (farge, spiller).
    for (const [playerId, tickets] of game.tickets) {
      for (const ticket of tickets) {
        if (!this.meetsPhaseRequirement(activePattern, ticket, drawnSet)) continue;
        const colorKey = ticket.color ?? UNCOLORED_KEY;
        let group = byColor.get(colorKey);
        if (!group) {
          // Resolve matrise for denne fargen. Warning når __default__ slår
          // inn for en farge som finnes i ticketTypes (konfig-gap).
          const patterns = resolvePatternsForColor(variantConfig, ticket.color, (missingColor) => {
            logger.warn(
              { color: missingColor, roomCode, gameId: game.id },
              "patternsByColor missing entry for ticket color — using __default__ matrix"
            );
          });
          const patternForColor = patterns[phaseIndex] ?? null;
          group = { playerIds: new Set(), patternForColor };
          byColor.set(colorKey, group);
        }
        group.playerIds.add(playerId);
        uniquePlayers.add(playerId);
      }
    }

    return { totalUniqueWinners: uniquePlayers.size, byColor };
  }

  /**
   * BIN-694: Evaluér om et brett oppfyller aktiv fase sitt krav.
   *
   * Fase-modell (norsk 75-ball, avklart 2026-04-20):
   *   - "1 Rad" (fase 1): ≥1 horisontal rad ELLER ≥1 vertikal kolonne
   *   - "2 Rader" (fase 2): ≥2 hele vertikale kolonner
   *   - "3 Rader" (fase 3): ≥3 hele vertikale kolonner
   *   - "4 Rader" (fase 4): ≥4 hele vertikale kolonner
   *   - "Fullt Hus" (fase 5): alle 25 felt merket
   *
   * Klassifisering og kandidat-masker ligger i
   * `@spillorama/shared-types/spill1-patterns` og deles med klient
   * `PatternMasks.ts` (samme kilde = ingen drift-risiko).
   *
   * Ukjente pattern-navn (jubilee "Stjerne", Spill 3 "Bilde"/"Ramme",
   * Databingo60 line-pattern) faller tilbake til `claimType`-basert
   * sjekk: LINE = ≥1 linje, BINGO = fullt hus.
   */
  private meetsPhaseRequirement(
    pattern: PatternDefinition,
    ticket: Ticket,
    drawnSet: Set<number>,
  ): boolean {
    if (pattern.claimType === "BINGO") {
      return hasFullBingo(ticket, drawnSet);
    }
    const phase = classifyPhaseFromPatternName(pattern.name);
    if (phase === null) {
      return (
        countCompleteRows(ticket, drawnSet) >= 1 ||
        countCompleteColumns(ticket, drawnSet) >= 1
      );
    }
    const ticketMask = buildTicketMask5x5(ticket, drawnSet);
    if (ticketMask === null) {
      return (
        countCompleteRows(ticket, drawnSet) >= 1 ||
        countCompleteColumns(ticket, drawnSet) >= 1
      );
    }
    return ticketMaskMeetsPhase(ticketMask, phase);
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
          idempotencyKey: `phase-${patternResult.patternId}-${game.id}-${player.id}`,
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
    await this.walletAdapter.transfer(
      player.walletId,
      houseAccountId,
      debit,
      `Ticket replace ${room.code}`,
      { idempotencyKey },
    );
    player.balance -= debit;
    await this.compliance.recordLossEntry(player.walletId, room.hallId, {
      type: "BUYIN",
      amount: debit,
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
          { idempotencyKey: `line-prize-${game.id}-${claim.id}`, targetSide: "winnings" }
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
          { idempotencyKey: `bingo-prize-${game.id}-${claim.id}`, targetSide: "winnings" }
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

  /** Default prize segments for the jackpot wheel (in kr). */
  private static readonly JACKPOT_PRIZES = [5, 10, 15, 20, 25, 50, 10, 15];

  /**
   * Activate jackpot mini-game for a player (called after BINGO win in Game 5).
   * Returns the jackpot state, or null if not applicable.
   */
  activateJackpot(roomCode: string, playerId: string): JackpotState | null {
    const room = this.requireRoom(roomCode);
    const game = room.currentGame;
    if (!game) return null;
    if (game.jackpot) return game.jackpot; // Already activated

    const jackpot: JackpotState = {
      playerId,
      prizeList: [...BingoEngine.JACKPOT_PRIZES],
      totalSpins: 1,
      playedSpins: 0,
      spinHistory: [],
      isComplete: false,
    };
    game.jackpot = jackpot;
    return jackpot;
  }

  /**
   * Process a jackpot spin. Server picks a random segment.
   * Returns the spin result with prize amount.
   */
  async spinJackpot(roomCode: string, playerId: string): Promise<{
    segmentIndex: number;
    prizeAmount: number;
    playedSpins: number;
    totalSpins: number;
    isComplete: boolean;
    spinHistory: JackpotState["spinHistory"];
  }> {
    const room = this.requireRoom(roomCode);
    const game = room.currentGame;
    if (!game || !game.jackpot) {
      throw new DomainError("NO_JACKPOT", "Ingen aktiv jackpot.");
    }
    const jackpot = game.jackpot;
    if (jackpot.playerId !== playerId) {
      throw new DomainError("NOT_JACKPOT_PLAYER", "Jackpot tilhører en annen spiller.");
    }
    if (jackpot.isComplete) {
      throw new DomainError("JACKPOT_COMPLETE", "Jackpot er allerede fullført.");
    }
    if (jackpot.playedSpins >= jackpot.totalSpins) {
      throw new DomainError("NO_SPINS_LEFT", "Ingen spinn igjen.");
    }

    // Server-authoritative random segment
    const segmentIndex = Math.floor(Math.random() * jackpot.prizeList.length);
    const prizeAmount = jackpot.prizeList[segmentIndex];
    jackpot.playedSpins += 1;

    jackpot.spinHistory.push({
      spinNumber: jackpot.playedSpins,
      segmentIndex,
      prizeAmount,
    });

    if (jackpot.playedSpins >= jackpot.totalSpins) {
      jackpot.isComplete = true;
    }

    // Credit prize to player balance
    if (prizeAmount > 0) {
      const player = this.requirePlayer(room, playerId);
      const gameType = "DATABINGO" as const;
      const channel = "INTERNET" as const;
      const houseAccountId = this.ledger.makeHouseAccountId(room.hallId, gameType, channel);

      // PR-W3 wallet-split: payout er gevinst → krediter winnings-siden.
      const transfer = await this.walletAdapter.transfer(
        houseAccountId,
        player.walletId,
        prizeAmount,
        `Jackpot prize ${room.code}`,
        {
          idempotencyKey: `jackpot-${game.id}-spin-${jackpot.playedSpins}`,
          targetSide: "winnings",
        },
      );
      player.balance += prizeAmount;

      await this.compliance.recordLossEntry(player.walletId, room.hallId, {
        type: "PAYOUT",
        amount: prizeAmount,
        createdAtMs: Date.now(),
      });
      await this.ledger.recordComplianceLedgerEvent({
        hallId: room.hallId,
        gameType,
        channel,
        eventType: "PRIZE",
        amount: prizeAmount,
        roomCode: room.code,
        gameId: game.id,
        claimId: `jackpot-${game.id}-spin-${jackpot.playedSpins}`,
        playerId,
        walletId: player.walletId,
        sourceAccountId: transfer.fromTx.accountId,
        targetAccountId: transfer.toTx.accountId,
        policyVersion: "jackpot-v1",
      });
    }

    return {
      segmentIndex,
      prizeAmount,
      playedSpins: jackpot.playedSpins,
      totalSpins: jackpot.totalSpins,
      isComplete: jackpot.isComplete,
      spinHistory: jackpot.spinHistory,
    };
  }

  // ── Mini-games (Game 1 — Wheel of Fortune / Treasure Chest) ─────────────

  /** Default prize segments for Game 1 mini-games (in kr). */
  private static readonly MINIGAME_PRIZES = [5, 10, 15, 20, 25, 50, 10, 15];

  /**
   * BIN-505/506: 4-way rotation order for Game 1 mini-games. Legacy ran the
   * same rotation per hall (wheel → chest → mystery → colorDraft), reading
   * prize lists from the admin-configured `otherGame` collection. We keep the
   * rotation but default every type to MINIGAME_PRIZES until per-type admin
   * config lands (follow-up issue).
   */
  private static readonly MINIGAME_ROTATION: readonly MiniGameType[] = [
    "wheelOfFortune",
    "treasureChest",
    "mysteryGame",
    "colorDraft",
  ];

  /** Mini-game rotation counter — indexes into MINIGAME_ROTATION. */
  private miniGameCounter = 0;

  /**
   * Activate a mini-game for a player (called after BINGO win in Game 1).
   * Rotates wheelOfFortune → treasureChest → mysteryGame → colorDraft.
   */
  activateMiniGame(roomCode: string, playerId: string): MiniGameState | null {
    const room = this.requireRoom(roomCode);
    const game = room.currentGame;
    if (!game) return null;
    if (game.miniGame) return game.miniGame; // Already activated

    const rotation = BingoEngine.MINIGAME_ROTATION;
    const type: MiniGameType = rotation[this.miniGameCounter % rotation.length];
    this.miniGameCounter += 1;

    const miniGame: MiniGameState = {
      playerId,
      type,
      prizeList: [...BingoEngine.MINIGAME_PRIZES],
      isPlayed: false,
    };
    game.miniGame = miniGame;
    return miniGame;
  }

  /**
   * Play the mini-game. Server picks the winning segment/chest.
   * For treasureChest, selectedIndex is the player's pick (cosmetic only — prize is server-determined).
   */
  async playMiniGame(roomCode: string, playerId: string, _selectedIndex?: number): Promise<{
    type: MiniGameType;
    segmentIndex: number;
    prizeAmount: number;
    prizeList: number[];
  }> {
    const room = this.requireRoom(roomCode);
    const game = room.currentGame;
    if (!game || !game.miniGame) {
      throw new DomainError("NO_MINIGAME", "Ingen aktiv mini-game.");
    }
    const miniGame = game.miniGame;
    if (miniGame.playerId !== playerId) {
      throw new DomainError("NOT_MINIGAME_PLAYER", "Mini-game tilhører en annen spiller.");
    }
    if (miniGame.isPlayed) {
      throw new DomainError("MINIGAME_PLAYED", "Mini-game er allerede spilt.");
    }

    // Server-authoritative random segment
    const segmentIndex = Math.floor(Math.random() * miniGame.prizeList.length);
    const prizeAmount = miniGame.prizeList[segmentIndex];
    miniGame.isPlayed = true;
    miniGame.result = { segmentIndex, prizeAmount };

    // Credit prize to player balance
    if (prizeAmount > 0) {
      const player = this.requirePlayer(room, playerId);
      const gameType = "DATABINGO" as const;
      const channel = "INTERNET" as const;
      const houseAccountId = this.ledger.makeHouseAccountId(room.hallId, gameType, channel);

      // PR-W3 wallet-split: payout er gevinst → krediter winnings-siden.
      const transfer = await this.walletAdapter.transfer(
        houseAccountId,
        player.walletId,
        prizeAmount,
        `Mini-game ${miniGame.type} prize ${room.code}`,
        { idempotencyKey: `minigame-${game.id}-${miniGame.type}`, targetSide: "winnings" },
      );
      player.balance += prizeAmount;

      await this.compliance.recordLossEntry(player.walletId, room.hallId, {
        type: "PAYOUT",
        amount: prizeAmount,
        createdAtMs: Date.now(),
      });
      await this.ledger.recordComplianceLedgerEvent({
        hallId: room.hallId,
        gameType,
        channel,
        eventType: "PRIZE",
        amount: prizeAmount,
        roomCode: room.code,
        gameId: game.id,
        claimId: `minigame-${game.id}-${miniGame.type}`,
        playerId,
        walletId: player.walletId,
        sourceAccountId: transfer.fromTx.accountId,
        targetAccountId: transfer.toTx.accountId,
        policyVersion: "minigame-v1",
      });
    }

    return {
      type: miniGame.type,
      segmentIndex,
      prizeAmount,
      prizeList: miniGame.prizeList,
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
      { idempotencyKey: `extra-prize-${extraPrizeId}`, targetSide: "winnings" }
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
    const balance = await this.walletAdapter.getBalance(normalizedWalletId);
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

  private async ensureSufficientBalance(players: Player[], entryFee: number): Promise<void> {
    const balances = await Promise.all(
      players.map(async (player) => ({
        player,
        balance: await this.walletAdapter.getBalance(player.walletId)
      }))
    );

    const missing = balances.find(({ balance }) => balance < entryFee);
    if (missing) {
      throw new DomainError(
        "INSUFFICIENT_FUNDS",
        `Spiller ${missing.player.name} har ikke nok saldo til buy-in.`
      );
    }
  }

  private assertPlayersNotInAnotherRunningGame(roomCode: string, players: Player[]): void {
    const walletIds = new Set(players.map((player) => player.walletId));
    if (walletIds.size === 0) {
      return;
    }

    for (const otherRoom of this.rooms.values()) {
      if (otherRoom.code === roomCode) {
        continue;
      }
      if (otherRoom.currentGame?.status !== "RUNNING") {
        continue;
      }

      for (const otherPlayer of otherRoom.players.values()) {
        if (!walletIds.has(otherPlayer.walletId)) {
          continue;
        }
        throw new DomainError(
          "PLAYER_ALREADY_IN_RUNNING_GAME",
          `Spiller ${otherPlayer.name} deltar allerede i et annet aktivt spill (rom ${otherRoom.code}).`
        );
      }
    }
  }

  private assertPlayersNotBlockedByRestriction(players: Player[], nowMs: number): void {
    for (const player of players) {
      this.assertWalletAllowedForGameplay(player.walletId, nowMs);
    }
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

  private isPlayerOnRequiredPause(player: Player, nowMs: number): boolean {
    const snapshot = this.compliance.getPlayerCompliance(player.walletId);
    return snapshot.pause.isOnPause;
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

  private assertPlayersNotOnRequiredPause(players: Player[], nowMs: number): void {
    const pausedPlayer = players.find((player) => this.isPlayerOnRequiredPause(player, nowMs));
    if (!pausedPlayer) {
      return;
    }
    const snapshot = this.compliance.getPlayerCompliance(pausedPlayer.walletId);
    const untilMs = snapshot.pause.pauseUntil ?? new Date(nowMs).toISOString();
    throw new DomainError(
      "PLAYER_REQUIRED_PAUSE",
      `Spiller har pålagt pause til ${untilMs}.`
    );
  }

  private async assertLossLimitsBeforeBuyIn(
    players: Player[],
    entryFee: number,
    nowMs: number,
    hallId: string
  ): Promise<void> {
    if (entryFee <= 0) {
      return;
    }

    for (const player of players) {
      const limits = this.compliance.getEffectiveLossLimits(player.walletId, hallId);
      const netLoss = this.compliance.calculateNetLoss(player.walletId, nowMs, hallId);

      if (netLoss.daily + entryFee > limits.daily) {
        throw new DomainError(
          "DAILY_LOSS_LIMIT_EXCEEDED",
          `Spiller ${player.name} overstiger daglig tapsgrense (${limits.daily}).`
        );
      }
      if (netLoss.monthly + entryFee > limits.monthly) {
        throw new DomainError(
          "MONTHLY_LOSS_LIMIT_EXCEEDED",
          `Spiller ${player.name} overstiger månedlig tapsgrense (${limits.monthly}).`
        );
      }
    }
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
  restoreRoomFromSnapshot(
    roomCode: string,
    hallId: string,
    hostPlayerId: string,
    players: Player[],
    snapshot: GameSnapshot,
    // BIN-672: required — caller MUST pass a gameSlug from the
    // persisted game_sessions.game_slug column. No fallback here; an
    // unknown slug should fail loud (will be thrown by the ticket-gen
    // chain when display-tickets are requested).
    gameSlug: string
  ): void {
    const code = roomCode.trim().toUpperCase();
    if (this.rooms.has(code)) {
      throw new DomainError("ROOM_ALREADY_EXISTS", `Rom ${code} finnes allerede — kan ikke gjenopprette.`);
    }

    const tickets = new Map<string, Ticket[]>(
      Object.entries(snapshot.tickets).map(([pid, t]) => [
        pid,
        t.map((tk) => ({ grid: tk.grid.map((row) => [...row]) }))
      ])
    );

    // BIN-244: snapshot.marks is Record<string, number[][]> — restore to Map<string, Set<number>[]>
    const marks = new Map<string, Set<number>[]>(
      Object.entries(snapshot.marks).map(([pid, marksByTicket]) => [
        pid,
        marksByTicket.map((nums) => new Set(nums))
      ])
    );

    const game: GameState = {
      id: snapshot.id,
      status: "RUNNING",
      entryFee: snapshot.entryFee,
      ticketsPerPlayer: snapshot.ticketsPerPlayer,
      prizePool: snapshot.prizePool,
      remainingPrizePool: snapshot.remainingPrizePool,
      payoutPercent: snapshot.payoutPercent,
      maxPayoutBudget: snapshot.maxPayoutBudget,
      remainingPayoutBudget: snapshot.remainingPayoutBudget,
      // BIN-243: Restore full ordered draw bag from snapshot
      drawBag: [...snapshot.drawBag],
      drawnNumbers: [...snapshot.drawnNumbers],
      tickets,
      marks,
      claims: [...snapshot.claims],
      lineWinnerId: snapshot.lineWinnerId,
      bingoWinnerId: snapshot.bingoWinnerId,
      patterns: snapshot.patterns ? [...snapshot.patterns] : undefined,
      patternResults: snapshot.patternResults ? [...snapshot.patternResults] : undefined,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt,
      endedReason: snapshot.endedReason
    };

    const playersMap = new Map<string, Player>(players.map((p) => [p.id, p]));

    const restoredRoom: RoomState = {
      code,
      hallId,
      hostPlayerId,
      gameSlug,
      players: playersMap,
      currentGame: game,
      gameHistory: [],
      createdAt: new Date().toISOString()
    };
    this.rooms.set(code, restoredRoom);
    this.syncRoomToStore(restoredRoom); // BIN-251

    logger.warn(
      { roomCode: code, gameId: snapshot.id, drawn: snapshot.drawnNumbers.length, remaining: snapshot.drawBag.length },
      "[BIN-245] Room restored from checkpoint"
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

  /** HOEY-4: Refund buy-ins when game startup fails partway through.
   *  Returns structured data about any failed refunds for reconciliation. */
  private async refundDebitedPlayers(
    debitedPlayers: Array<{ player: Player; fromAccountId: string; toAccountId: string; amount: number }>,
    houseAccountId: string,
    roomCode: string,
    gameId: string
  ): Promise<{ failedRefunds: Array<{ playerId: string; walletId: string; amount: number; error: string }> }> {
    const failedRefunds: Array<{ playerId: string; walletId: string; amount: number; error: string }> = [];
    for (const { player, amount } of debitedPlayers) {
      try {
        await this.walletAdapter.transfer(
          houseAccountId,
          player.walletId,
          amount,
          `Refund: game start failed ${roomCode}`,
          { idempotencyKey: `refund-${gameId}-${player.id}` }
        );
        player.balance += amount;
      } catch (refundErr) {
        failedRefunds.push({
          playerId: player.id,
          walletId: player.walletId,
          amount,
          error: String(refundErr)
        });
        logger.error(
          { err: refundErr, playerId: player.id, walletId: player.walletId, gameId, roomCode },
          "CRITICAL: Failed to refund buy-in after game start failure — requires manual reconciliation"
        );
      }
    }
    if (failedRefunds.length > 0) {
      logger.error(
        { failedRefunds, gameId, roomCode, totalFailedAmount: failedRefunds.reduce((s, r) => s + r.amount, 0) },
        `RECONCILIATION: ${failedRefunds.length} refund(s) failed for game ${gameId} — players owe money`
      );
    }
    return { failedRefunds };
  }

  /** HOEY-3: Write a DRAW checkpoint after each ball draw. */
  private async writeDrawCheckpoint(room: RoomState, game: GameState): Promise<void> {
    if (!this.bingoAdapter.onCheckpoint) return;
    try {
      await this.bingoAdapter.onCheckpoint({
        roomCode: room.code,
        gameId: game.id,
        reason: "DRAW",
        snapshot: this.serializeGameForRecovery(game),
        players: [...room.players.values()],
        hallId: room.hallId
      });
    } catch (err) {
      logger.error({ err, gameId: game.id, drawCount: game.drawnNumbers.length }, "CRITICAL: Checkpoint failed after draw");
    }
    // HOEY-7: Persist room state to backing store after draw
    await this.rooms.persist(room.code);
  }

  /** HOEY-6: Write a GAME_END checkpoint for any termination path. */
  // BIN-615 / PR-C2: protected so Game2Engine can finalize on auto-claim-end.
  protected async writeGameEndCheckpoint(room: RoomState, game: GameState): Promise<void> {
    if (!this.bingoAdapter.onCheckpoint) return;
    try {
      await this.bingoAdapter.onCheckpoint({
        roomCode: room.code,
        gameId: game.id,
        reason: "GAME_END",
        snapshot: this.serializeGameForRecovery(game),
        players: [...room.players.values()],
        hallId: room.hallId
      });
    } catch (err) {
      logger.error({ err, gameId: game.id, endedReason: game.endedReason }, "CRITICAL: Checkpoint failed at game end");
    }
    // HOEY-7: Persist room state to backing store after game end
    await this.rooms.persist(room.code);
  }

  /** Write payout checkpoint with one retry. Logs CRITICAL on final failure but does not throw. */
  // BIN-615 / PR-C2: protected so Game2Engine can checkpoint after jackpot payouts.
  protected async writePayoutCheckpointWithRetry(
    room: RoomState,
    game: GameState,
    claimId: string,
    payoutAmount: number,
    transactionIds: string[],
    prizeType: "LINE" | "BINGO"
  ): Promise<void> {
    const payload = {
      roomCode: room.code,
      gameId: game.id,
      reason: "PAYOUT" as const,
      claimId,
      payoutAmount,
      transactionIds,
      snapshot: this.serializeGameForRecovery(game),
      players: [...room.players.values()],
      hallId: room.hallId
    };
    try {
      await this.bingoAdapter.onCheckpoint!(payload);
    } catch (firstErr) {
      logger.warn({ err: firstErr, claimId, gameId: game.id }, `Checkpoint failed after ${prizeType} payout — retrying once`);
      try {
        await this.bingoAdapter.onCheckpoint!(payload);
      } catch (retryErr) {
        logger.error({ err: retryErr, claimId, gameId: game.id }, `CRITICAL: Checkpoint failed after ${prizeType} payout (retry exhausted)`);
      }
    }
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

  /** KRITISK-5/6: Full engine state for checkpoint recovery (preserves drawBag + per-ticket marks). */
  private serializeGameForRecovery(game: GameState): RecoverableGameSnapshot {
    const base = this.serializeGame(game);
    const structuredMarks: Record<string, number[][]> = {};
    for (const [playerId, sets] of game.marks) {
      structuredMarks[playerId] = sets.map(s => [...s]);
    }
    return {
      ...base,
      drawBag: [...game.drawBag],
      structuredMarks,
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

export function toPublicError(error: unknown): { code: string; message: string } {
  if (error instanceof DomainError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof WalletError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "Uventet feil i server."
  };
}
