import { createHash, randomInt, randomUUID } from "node:crypto";
import type { BingoSystemAdapter } from "../adapters/BingoSystemAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import {
  findFirstCompleteLinePatternIndex,
  countNearMissLinePattern,
  hasFullBingo,
  makeRoomCode,
  makeShuffledBallBag,
  ticketContainsNumber
} from "./ticket.js";
import type {
  ClaimRecord,
  ClaimType,
  GameSnapshot,
  GameState,
  Player,
  RoomSnapshot,
  RoomState,
  RoomSummary,
  Ticket
} from "./types.js";

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
}

interface JoinRoomInput extends CreateRoomInput {
  roomCode: string;
}

interface StartGameInput {
  roomCode: string;
  actorPlayerId: string;
  entryFee?: number;
  ticketsPerPlayer?: number;
  payoutPercent?: number;
}

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
  minPlayersToStart?: number;
  dailyLossLimit?: number;
  monthlyLossLimit?: number;
  playSessionLimitMs?: number;
  pauseDurationMs?: number;
  selfExclusionMinMs?: number;
  maxDrawsPerRound?: number;
  rtpRollingWindowSize?: number;
  rtpControllerGain?: number;
  nearMissBiasEnabled?: boolean;
  nearMissTargetRate?: number;
}

interface RoundPerformanceSnapshot {
  gameId: string;
  roomCode: string;
  hallId: string;
  startedAt: string;
  endedAt: string;
  payoutPercentTarget: number;
  payoutPercentEffective: number;
  stakeAmount: number;
  payoutAmount: number;
  nearMissTickets: number;
  totalTickets: number;
  nearMissRate: number;
}

interface RtpNearMissTelemetry {
  hallId?: string;
  roundsConsidered: number;
  payoutPercentTargetAvg: number;
  payoutPercentActualAvg: number;
  nearMissRateAvg: number;
  payoutAmountSum: number;
  stakeAmountSum: number;
  nearMissTickets: number;
  totalTickets: number;
  windowSize: number;
  recentRounds: RoundPerformanceSnapshot[];
}

interface LossLimits {
  daily: number;
  monthly: number;
}

interface LossLedgerEntry {
  type: "BUYIN" | "PAYOUT";
  amount: number;
  createdAtMs: number;
}

interface PlaySessionState {
  accumulatedMs: number;
  activeFromMs?: number;
  pauseUntilMs?: number;
  lastMandatoryBreak?: MandatoryBreakSummary;
}

interface MandatoryBreakSummary {
  triggeredAtMs: number;
  pauseUntilMs: number;
  totalPlayMs: number;
  hallId: string;
  netLoss: LossLimits;
}

interface RestrictionState {
  timedPauseUntilMs?: number;
  timedPauseSetAtMs?: number;
  selfExcludedAtMs?: number;
  selfExclusionMinimumUntilMs?: number;
}

type GameplayBlockType = "TIMED_PAUSE" | "SELF_EXCLUDED";

interface GameplayBlockState {
  type: GameplayBlockType;
  untilMs: number;
}

type PrizeGameType = "DATABINGO";

interface PrizePolicyVersion {
  id: string;
  gameType: PrizeGameType;
  hallId: string;
  linkId: string;
  effectiveFromMs: number;
  singlePrizeCap: number;
  dailyExtraPrizeCap: number;
  createdAtMs: number;
}

interface PrizePolicySnapshot {
  id: string;
  gameType: PrizeGameType;
  hallId: string;
  linkId: string;
  effectiveFrom: string;
  singlePrizeCap: number;
  dailyExtraPrizeCap: number;
  createdAt: string;
}

interface ExtraPrizeEntry {
  amount: number;
  createdAtMs: number;
  policyId: string;
}

interface ExtraDrawDenialAudit {
  id: string;
  createdAt: string;
  source: "API" | "SOCKET" | "UNKNOWN";
  roomCode?: string;
  playerId?: string;
  walletId?: string;
  hallId?: string;
  reasonCode: "EXTRA_DRAW_NOT_ALLOWED";
  metadata?: Record<string, unknown>;
}

type LedgerGameType = "MAIN_GAME" | "DATABINGO";
type LedgerChannel = "HALL" | "INTERNET";
type LedgerEventType = "STAKE" | "PRIZE" | "EXTRA_PRIZE" | "ORG_DISTRIBUTION";

interface ComplianceLedgerEntry {
  id: string;
  createdAt: string;
  createdAtMs: number;
  hallId: string;
  gameType: LedgerGameType;
  channel: LedgerChannel;
  eventType: LedgerEventType;
  amount: number;
  currency: "NOK";
  roomCode?: string;
  gameId?: string;
  claimId?: string;
  playerId?: string;
  walletId?: string;
  sourceAccountId?: string;
  targetAccountId?: string;
  policyVersion?: string;
  batchId?: string;
  metadata?: Record<string, unknown>;
}

interface PayoutAuditEvent {
  id: string;
  createdAt: string;
  claimId?: string;
  gameId?: string;
  roomCode?: string;
  hallId: string;
  policyVersion?: string;
  amount: number;
  currency: "NOK";
  walletId: string;
  playerId?: string;
  sourceAccountId?: string;
  txIds: string[];
  kind: "CLAIM_PRIZE" | "EXTRA_PRIZE";
  chainIndex: number;
  previousHash: string;
  eventHash: string;
}

interface DailyComplianceReportRow {
  hallId: string;
  gameType: LedgerGameType;
  channel: LedgerChannel;
  grossTurnover: number;
  prizesPaid: number;
  net: number;
  stakeCount: number;
  prizeCount: number;
  extraPrizeCount: number;
}

interface DailyComplianceReport {
  date: string;
  generatedAt: string;
  rows: DailyComplianceReportRow[];
  totals: {
    grossTurnover: number;
    prizesPaid: number;
    net: number;
    stakeCount: number;
    prizeCount: number;
    extraPrizeCount: number;
  };
}

interface OrganizationAllocationInput {
  organizationId: string;
  organizationAccountId: string;
  sharePercent: number;
}

interface OverskuddDistributionTransfer {
  id: string;
  batchId: string;
  createdAt: string;
  date: string;
  hallId: string;
  gameType: LedgerGameType;
  channel: LedgerChannel;
  sourceAccountId: string;
  organizationId: string;
  organizationAccountId: string;
  amount: number;
  txIds: string[];
}

interface OverskuddDistributionBatch {
  id: string;
  createdAt: string;
  date: string;
  hallId?: string;
  gameType?: LedgerGameType;
  channel?: LedgerChannel;
  requiredMinimum: number;
  distributedAmount: number;
  transfers: OverskuddDistributionTransfer[];
  allocations: OrganizationAllocationInput[];
}

interface PlayerComplianceSnapshot {
  walletId: string;
  hallId?: string;
  regulatoryLossLimits: LossLimits;
  personalLossLimits: LossLimits;
  netLoss: LossLimits;
  pause: {
    isOnPause: boolean;
    pauseUntil?: string;
    accumulatedPlayMs: number;
    playSessionLimitMs: number;
    pauseDurationMs: number;
    lastMandatoryBreak?: {
      triggeredAt: string;
      pauseUntil: string;
      totalPlayMs: number;
      hallId: string;
      netLoss: LossLimits;
    };
  };
  restrictions: {
    isBlocked: boolean;
    blockedBy?: GameplayBlockType;
    blockedUntil?: string;
    timedPause: {
      isActive: boolean;
      pauseUntil?: string;
      setAt?: string;
    };
    selfExclusion: {
      isActive: boolean;
      setAt?: string;
      minimumUntil?: string;
      canBeRemoved: boolean;
    };
  };
}

const POLICY_WILDCARD = "*";
const DEFAULT_SELF_EXCLUSION_MIN_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_DRAWS_PER_ROUND = 30;
const MAX_BINGO_BALLS = 75;
const DEFAULT_BONUS_TRIGGER_PATTERN_INDEX = 1;
const DEFAULT_RTP_ROLLING_WINDOW_SIZE = 1000;
const DEFAULT_RTP_CONTROLLER_GAIN = 0.5;
const DEFAULT_NEAR_MISS_TARGET_RATE = 0.3;

export class BingoEngine {
  private readonly rooms = new Map<string, RoomState>();
  private readonly roomLastRoundStartMs = new Map<string, number>();
  private readonly lossEntriesByScope = new Map<string, LossLedgerEntry[]>();
  private readonly personalLossLimitsByScope = new Map<string, LossLimits>();
  private readonly playStateByWallet = new Map<string, PlaySessionState>();
  private readonly restrictionsByWallet = new Map<string, RestrictionState>();
  private readonly prizePoliciesByScope = new Map<string, PrizePolicyVersion[]>();
  private readonly extraPrizeEntriesByScope = new Map<string, ExtraPrizeEntry[]>();
  private readonly extraDrawDenials: ExtraDrawDenialAudit[] = [];
  private readonly payoutAuditTrail: PayoutAuditEvent[] = [];
  private readonly complianceLedger: ComplianceLedgerEntry[] = [];
  private readonly dailyReportArchive = new Map<string, DailyComplianceReport>();
  private readonly overskuddBatches = new Map<string, OverskuddDistributionBatch>();
  private lastPayoutAuditHash = "GENESIS";

  private readonly minRoundIntervalMs: number;
  private readonly minPlayersToStart: number;
  private readonly regulatoryLossLimits: LossLimits;
  private readonly playSessionLimitMs: number;
  private readonly pauseDurationMs: number;
  private readonly selfExclusionMinMs: number;
  private readonly maxDrawsPerRound: number;
  private readonly rtpRollingWindowSize: number;
  private readonly rtpControllerGain: number;
  private readonly nearMissBiasEnabled: boolean;
  private readonly nearMissTargetRate: number;
  private readonly roundPerformanceHistory: RoundPerformanceSnapshot[] = [];
  private readonly roundPerformanceRecorded = new Set<string>();

  constructor(
    private readonly bingoAdapter: BingoSystemAdapter,
    private readonly walletAdapter: WalletAdapter,
    options: ComplianceOptions = {}
  ) {
    this.minRoundIntervalMs = Math.max(30000, Math.floor(options.minRoundIntervalMs ?? 30000));
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
    this.regulatoryLossLimits = {
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
      maxDrawsPerRound > MAX_BINGO_BALLS
    ) {
      throw new DomainError(
        "INVALID_CONFIG",
        `maxDrawsPerRound må være et heltall mellom 1 og ${MAX_BINGO_BALLS}.`
      );
    }
    this.playSessionLimitMs = Math.floor(playSessionLimitMs);
    this.pauseDurationMs = Math.floor(pauseDurationMs);
    this.selfExclusionMinMs = Math.floor(selfExclusionMinMs);
    this.maxDrawsPerRound = Math.floor(maxDrawsPerRound);
    this.rtpRollingWindowSize = Math.max(
      10,
      Math.floor(options.rtpRollingWindowSize ?? DEFAULT_RTP_ROLLING_WINDOW_SIZE)
    );
    this.rtpControllerGain = Math.min(
      2,
      Math.max(0, options.rtpControllerGain ?? DEFAULT_RTP_CONTROLLER_GAIN)
    );
    this.nearMissBiasEnabled = options.nearMissBiasEnabled ?? true;
    this.nearMissTargetRate = Math.min(
      0.95,
      Math.max(0, options.nearMissTargetRate ?? DEFAULT_NEAR_MISS_TARGET_RATE)
    );

    this.upsertPrizePolicy({
      gameType: "DATABINGO",
      hallId: POLICY_WILDCARD,
      linkId: POLICY_WILDCARD,
      effectiveFrom: new Date(0).toISOString(),
      singlePrizeCap: 2500,
      dailyExtraPrizeCap: 12000
    });
  }

  async createRoom(input: CreateRoomInput): Promise<{ roomCode: string; playerId: string }> {
    const hallId = this.assertHallId(input.hallId);
    const playerId = randomUUID();
    const walletId = input.walletId?.trim() || `wallet-${playerId}`;
    this.assertWalletAllowedForGameplay(walletId, Date.now());
    this.assertWalletNotInRunningGame(walletId);
    await this.walletAdapter.ensureAccount(walletId);
    const balance = await this.walletAdapter.getBalance(walletId);

    const player: Player = {
      id: playerId,
      name: this.assertPlayerName(input.playerName),
      walletId,
      balance,
      socketId: input.socketId
    };

    const code = makeRoomCode(new Set(this.rooms.keys()));
    const room: RoomState = {
      code,
      hallId,
      hostPlayerId: playerId,
      createdAt: new Date().toISOString(),
      players: new Map([[playerId, player]]),
      gameHistory: []
    };

    this.rooms.set(code, room);
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
      socketId: input.socketId
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
    const ticketsPerPlayer = input.ticketsPerPlayer ?? 1;
    if (!Number.isInteger(ticketsPerPlayer) || ticketsPerPlayer < 1 || ticketsPerPlayer > 5) {
      throw new DomainError("INVALID_TICKETS_PER_PLAYER", "ticketsPerPlayer må være et heltall mellom 1 og 5.");
    }
    const payoutPercent = input.payoutPercent ?? 100;
    if (!Number.isFinite(payoutPercent) || payoutPercent < 0 || payoutPercent > 100) {
      throw new DomainError("INVALID_PAYOUT_PERCENT", "payoutPercent må være mellom 0 og 100.");
    }
    const normalizedPayoutPercent = Math.round(payoutPercent * 100) / 100;

    const players = [...room.players.values()];
    this.assertPlayersNotInAnotherRunningGame(room.code, players);
    this.assertPlayersNotBlockedByRestriction(players, nowMs);
    this.assertPlayersNotOnRequiredPause(players, nowMs);
    await this.refreshPlayerObjectsFromWallet(players);
    await this.assertLossLimitsBeforeBuyIn(players, entryFee, nowMs, room.hallId);
    const gameId = randomUUID();
    const gameType: LedgerGameType = "DATABINGO";
    const channel: LedgerChannel = "INTERNET";
    const houseAccountId = this.makeHouseAccountId(room.hallId, gameType, channel);
    if (entryFee > 0) {
      await this.ensureSufficientBalance(players, entryFee);
      for (const player of players) {
        const transfer = await this.walletAdapter.transfer(
          player.walletId,
          houseAccountId,
          entryFee,
          `Bingo buy-in ${room.code}`
        );
        player.balance -= entryFee;
        this.recordLossEntry(player.walletId, room.hallId, {
          type: "BUYIN",
          amount: entryFee,
          createdAtMs: nowMs
        });
        this.recordComplianceLedgerEvent({
          hallId: room.hallId,
          gameType,
          channel,
          eventType: "STAKE",
          amount: entryFee,
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
    }
    const tickets = new Map<string, Ticket[]>();
    const marks = new Map<string, Set<number>[]>();

    for (const player of players) {
      const playerTickets: Ticket[] = [];
      const playerMarks: Set<number>[] = [];

      for (let ticketIndex = 0; ticketIndex < ticketsPerPlayer; ticketIndex += 1) {
        const ticket = await this.bingoAdapter.createTicket({
          roomCode: room.code,
          gameId,
          player,
          ticketIndex,
          ticketsPerPlayer
        });
        playerTickets.push(ticket);
        playerMarks.push(new Set<number>());
      }

      tickets.set(player.id, playerTickets);
      marks.set(player.id, playerMarks);
    }

    const prizePool = this.roundCurrency(entryFee * players.length);
    const maxPayoutBudget = this.roundCurrency((prizePool * normalizedPayoutPercent) / 100);
    let drawBag = makeShuffledBallBag(MAX_BINGO_BALLS);
    if (this.nearMissBiasEnabled && this.nearMissTargetRate > 0) {
      const adaptiveNearMissRate = this.resolveAdaptiveNearMissRate(room.hallId);
      drawBag = this.applyNearMissBias(drawBag, tickets, adaptiveNearMissRate);
    }
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
      drawBag,
      drawnNumbers: [],
      tickets,
      marks,
      claims: [],
      startedAt: new Date().toISOString()
    };

    room.currentGame = game;
    this.roomLastRoundStartMs.set(room.code, Date.parse(game.startedAt));
    for (const player of players) {
      this.startPlaySession(player.walletId, nowMs);
    }
    if (this.bingoAdapter.onGameStarted) {
      await this.bingoAdapter.onGameStarted({
        roomCode: room.code,
        gameId,
        entryFee,
        playerIds: players.map((player) => player.id)
      });
    }
  }

  async drawNextNumber(input: DrawNextInput): Promise<number> {
    const room = this.requireRoom(input.roomCode);
    this.assertHost(room, input.actorPlayerId);
    const host = this.requirePlayer(room, input.actorPlayerId);
    this.assertWalletAllowedForGameplay(host.walletId, Date.now());
    const game = this.requireRunningGame(room);
    if (game.drawnNumbers.length >= this.maxDrawsPerRound) {
      const endedAt = new Date();
      game.status = "ENDED";
      game.endedAt = endedAt.toISOString();
      game.endedReason = "MAX_DRAWS_REACHED";
      this.finishPlaySessionsForGame(room, game, endedAt.getTime());
      this.recordRoundPerformance(room, game);
      throw new DomainError("NO_MORE_NUMBERS", `Maks antall trekk (${this.maxDrawsPerRound}) er nådd.`);
    }

    const nextNumber = game.drawBag.shift();
    if (!nextNumber) {
      const endedAt = new Date();
      game.status = "ENDED";
      game.endedAt = endedAt.toISOString();
      game.endedReason = "DRAW_BAG_EMPTY";
      this.finishPlaySessionsForGame(room, game, endedAt.getTime());
      this.recordRoundPerformance(room, game);
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
    if (game.drawnNumbers.length >= this.maxDrawsPerRound) {
      const endedAt = new Date();
      game.status = "ENDED";
      game.endedAt = endedAt.toISOString();
      game.endedReason = "MAX_DRAWS_REACHED";
      this.finishPlaySessionsForGame(room, game, endedAt.getTime());
      this.recordRoundPerformance(room, game);
    }
    return nextNumber;
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
    const playerTickets = game.tickets.get(player.id);
    const playerMarks = game.marks.get(player.id);
    if (
      !playerTickets ||
      !playerMarks ||
      playerTickets.length === 0 ||
      playerMarks.length !== playerTickets.length
    ) {
      throw new DomainError("TICKET_NOT_FOUND", "Spiller mangler brett i aktivt spill.");
    }

    let valid = false;
    let reason: string | undefined;
    let winningPatternIndex: number | undefined;

    if (input.type === "LINE") {
      if (game.lineWinnerId) {
        reason = "LINE_ALREADY_CLAIMED";
      } else {
        for (let ticketIndex = 0; ticketIndex < playerTickets.length; ticketIndex += 1) {
          const resolvedPatternIndex = findFirstCompleteLinePatternIndex(
            playerTickets[ticketIndex],
            playerMarks[ticketIndex]
          );
          if (resolvedPatternIndex < 0) {
            continue;
          }

          valid = true;
          winningPatternIndex = resolvedPatternIndex;
          break;
        }
        if (!valid) {
          reason = "NO_VALID_LINE";
        }
      }
    } else if (input.type === "BINGO") {
      valid = playerTickets.some((ticket, index) => hasFullBingo(ticket, playerMarks[index]));
      if (!valid) {
        reason = "NO_VALID_BINGO";
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
    const houseAccountId = this.makeHouseAccountId(room.hallId, gameType, channel);

    if (valid && input.type === "LINE") {
      game.lineWinnerId = player.id;
      const rtpBudgetBefore = this.roundCurrency(Math.max(0, game.remainingPayoutBudget));
      const requestedPayout = Math.floor(game.prizePool * 0.3);
      const cappedLinePayout = this.applySinglePrizeCap({
        room,
        gameType: "DATABINGO",
        amount: requestedPayout
      });
      const requestedAfterPolicyAndPool = Math.min(cappedLinePayout.cappedAmount, game.remainingPrizePool);
      const payout = Math.min(
        requestedAfterPolicyAndPool,
        game.remainingPayoutBudget
      );
      if (payout > 0) {
        const transfer = await this.walletAdapter.transfer(
          houseAccountId,
          player.walletId,
          payout,
          `Line prize ${room.code}`
        );
        player.balance += payout;
        game.remainingPrizePool = this.roundCurrency(Math.max(0, game.remainingPrizePool - payout));
        game.remainingPayoutBudget = this.roundCurrency(Math.max(0, game.remainingPayoutBudget - payout));
        this.recordLossEntry(player.walletId, room.hallId, {
          type: "PAYOUT",
          amount: payout,
          createdAtMs: Date.now()
        });
        this.recordComplianceLedgerEvent({
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
        this.appendPayoutAuditEvent({
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
      }
      const rtpBudgetAfter = this.roundCurrency(Math.max(0, game.remainingPayoutBudget));
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
    }

    if (valid && input.type === "BINGO") {
      const endedAt = new Date();
      game.bingoWinnerId = player.id;
      const rtpBudgetBefore = this.roundCurrency(Math.max(0, game.remainingPayoutBudget));
      const requestedPayout = game.remainingPrizePool;
      const cappedBingoPayout = this.applySinglePrizeCap({
        room,
        gameType: "DATABINGO",
        amount: requestedPayout
      });
      const requestedAfterPolicyAndPool = Math.min(cappedBingoPayout.cappedAmount, game.remainingPrizePool);
      const payout = Math.min(
        requestedAfterPolicyAndPool,
        game.remainingPayoutBudget
      );
      if (payout > 0) {
        const transfer = await this.walletAdapter.transfer(
          houseAccountId,
          player.walletId,
          payout,
          `Bingo prize ${room.code}`
        );
        player.balance += payout;
        this.recordLossEntry(player.walletId, room.hallId, {
          type: "PAYOUT",
          amount: payout,
          createdAtMs: Date.now()
        });
        this.recordComplianceLedgerEvent({
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
        this.appendPayoutAuditEvent({
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
      }
      game.remainingPrizePool = this.roundCurrency(Math.max(0, game.remainingPrizePool - payout));
      game.remainingPayoutBudget = this.roundCurrency(Math.max(0, game.remainingPayoutBudget - payout));
      game.status = "ENDED";
      game.endedAt = endedAt.toISOString();
      game.endedReason = "BINGO_CLAIMED";
      this.finishPlaySessionsForGame(room, game, endedAt.getTime());
      this.recordRoundPerformance(room, game);
      const rtpBudgetAfter = this.roundCurrency(Math.max(0, game.remainingPayoutBudget));
      claim.payoutAmount = payout;
      claim.payoutPolicyVersion = cappedBingoPayout.policy.id;
      claim.payoutWasCapped = payout < requestedPayout;
      claim.rtpBudgetBefore = rtpBudgetBefore;
      claim.rtpBudgetAfter = rtpBudgetAfter;
      claim.rtpCapped = payout < requestedAfterPolicyAndPool;
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

    return claim;
  }

  async endGame(input: EndGameInput): Promise<void> {
    const room = this.requireRoom(input.roomCode);
    this.assertHost(room, input.actorPlayerId);
    const host = this.requirePlayer(room, input.actorPlayerId);
    this.assertWalletAllowedForGameplay(host.walletId, Date.now());
    const game = this.requireRunningGame(room);

    const endedAt = new Date();
    game.status = "ENDED";
    game.endedAt = endedAt.toISOString();
    game.endedReason = input.reason?.trim() || "MANUAL_END";
    this.finishPlaySessionsForGame(room, game, endedAt.getTime());
    this.recordRoundPerformance(room, game);
  }

  getRoomSnapshot(roomCode: string): RoomSnapshot {
    const room = this.requireRoom(roomCode.trim().toUpperCase());
    return this.serializeRoom(room);
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
          playerCount: room.players.size,
          createdAt: room.createdAt,
          gameStatus
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  resolvePayoutPercentForNextRound(targetPayoutPercent: number, hallId?: string): number {
    const normalizedTarget = Math.min(100, Math.max(0, this.roundCurrency(targetPayoutPercent)));
    if (this.rtpControllerGain <= 0) {
      return normalizedTarget;
    }

    const telemetry = this.getRtpNearMissTelemetry({
      hallId,
      windowSize: this.rtpRollingWindowSize
    });
    if (telemetry.roundsConsidered <= 0) {
      return normalizedTarget;
    }

    const deviation = normalizedTarget - telemetry.payoutPercentActualAvg;
    const adjusted = normalizedTarget + deviation * this.rtpControllerGain;
    return Math.min(100, Math.max(0, this.roundCurrency(adjusted)));
  }

  getRtpNearMissTelemetry(input: { hallId?: string; windowSize?: number } = {}): RtpNearMissTelemetry {
    const normalizedHallId = input.hallId?.trim() || undefined;
    const windowSize = Math.max(1, Math.floor(input.windowSize ?? this.rtpRollingWindowSize));
    const scoped = normalizedHallId
      ? this.roundPerformanceHistory.filter((entry) => entry.hallId === normalizedHallId)
      : this.roundPerformanceHistory;
    const sliceStart = Math.max(0, scoped.length - windowSize);
    const recentRounds = scoped.slice(sliceStart);

    let payoutTargetSum = 0;
    let payoutActualSum = 0;
    let payoutAmountSum = 0;
    let stakeAmountSum = 0;
    let nearMissRateSum = 0;
    let nearMissTickets = 0;
    let totalTickets = 0;

    for (const round of recentRounds) {
      payoutTargetSum += round.payoutPercentTarget;
      payoutActualSum += round.payoutPercentEffective;
      payoutAmountSum += round.payoutAmount;
      stakeAmountSum += round.stakeAmount;
      nearMissRateSum += round.nearMissRate;
      nearMissTickets += round.nearMissTickets;
      totalTickets += round.totalTickets;
    }

    const roundsCount = recentRounds.length;
    return {
      hallId: normalizedHallId,
      roundsConsidered: roundsCount,
      payoutPercentTargetAvg: roundsCount > 0 ? this.roundCurrency(payoutTargetSum / roundsCount) : 0,
      payoutPercentActualAvg: roundsCount > 0 ? this.roundCurrency(payoutActualSum / roundsCount) : 0,
      nearMissRateAvg: roundsCount > 0 ? this.roundCurrency(nearMissRateSum / roundsCount) : 0,
      payoutAmountSum: this.roundCurrency(payoutAmountSum),
      stakeAmountSum: this.roundCurrency(stakeAmountSum),
      nearMissTickets,
      totalTickets,
      windowSize,
      recentRounds
    };
  }

  private resolveAdaptiveNearMissRate(hallId: string): number {
    const telemetry = this.getRtpNearMissTelemetry({
      hallId,
      windowSize: this.rtpRollingWindowSize
    });
    if (telemetry.roundsConsidered <= 0) {
      return this.nearMissTargetRate;
    }

    const deviation = this.nearMissTargetRate - telemetry.nearMissRateAvg;
    const adjusted = this.nearMissTargetRate + deviation * Math.max(0.1, this.rtpControllerGain * 0.5);
    return Math.min(0.95, Math.max(0.05, this.roundCurrency(adjusted)));
  }

  private applyNearMissBias(drawBag: number[], ticketsByPlayer: Map<string, Ticket[]>, nearMissRate: number): number[] {
    if (!Array.isArray(drawBag) || drawBag.length === 0) {
      return drawBag;
    }

    const drawCap = Math.min(this.maxDrawsPerRound, drawBag.length);
    if (drawCap >= drawBag.length) {
      return drawBag;
    }

    const allTickets: Ticket[] = [];
    for (const playerTickets of ticketsByPlayer.values()) {
      allTickets.push(...playerTickets);
    }
    if (allTickets.length === 0) {
      return drawBag;
    }

    const normalizedTargetRate = Math.min(0.95, Math.max(0, nearMissRate));
    const targetNearMissTickets = Math.min(
      allTickets.length,
      Math.max(1, Math.round(allTickets.length * normalizedTargetRate))
    );
    if (targetNearMissTickets <= 0) {
      return drawBag;
    }

    const candidateOrder = this.randomizeList(Array.from({ length: allTickets.length }, (_, index) => index));
    const withheldNumbers = new Set<number>();
    const promotedNumbers = new Set<number>();

    let nearMissConfigured = 0;
    for (const ticketIndex of candidateOrder) {
      if (nearMissConfigured >= targetNearMissTickets) {
        break;
      }
      const ticket = allTickets[ticketIndex];
      const candidatePatterns = this.extractTicketLinePatterns(ticket);
      if (candidatePatterns.length === 0) {
        continue;
      }

      const chosenPattern = candidatePatterns[randomInt(candidatePatterns.length)];
      if (chosenPattern.length < 2) {
        continue;
      }
      const missingCellIndex = randomInt(chosenPattern.length);
      const missingNumber = chosenPattern[missingCellIndex];
      if (!drawBag.includes(missingNumber)) {
        continue;
      }

      withheldNumbers.add(missingNumber);
      for (let i = 0; i < chosenPattern.length; i += 1) {
        if (i === missingCellIndex) {
          continue;
        }
        const number = chosenPattern[i];
        if (drawBag.includes(number)) {
          promotedNumbers.add(number);
        }
      }
      nearMissConfigured += 1;
    }

    if (withheldNumbers.size === 0 || promotedNumbers.size === 0) {
      return drawBag;
    }

    const randomizedPromotedNumbers = this.randomizeList([...promotedNumbers]).filter(
      (number) => !withheldNumbers.has(number)
    );
    const earlyNumbers: number[] = [];
    const earlyNumberSet = new Set<number>();

    for (const number of randomizedPromotedNumbers) {
      if (earlyNumbers.length >= drawCap) {
        break;
      }
      if (!drawBag.includes(number)) {
        continue;
      }
      earlyNumbers.push(number);
      earlyNumberSet.add(number);
    }

    for (const number of drawBag) {
      if (earlyNumbers.length >= drawCap) {
        break;
      }
      if (withheldNumbers.has(number) || earlyNumberSet.has(number)) {
        continue;
      }
      earlyNumbers.push(number);
      earlyNumberSet.add(number);
    }

    if (earlyNumbers.length < drawCap) {
      for (const number of drawBag) {
        if (earlyNumbers.length >= drawCap) {
          break;
        }
        if (earlyNumberSet.has(number)) {
          continue;
        }
        earlyNumbers.push(number);
        earlyNumberSet.add(number);
      }
    }

    const lateNumbers: number[] = [];
    for (const number of drawBag) {
      if (earlyNumberSet.has(number)) {
        continue;
      }
      lateNumbers.push(number);
    }

    return [...earlyNumbers, ...lateNumbers];
  }

  private recordRoundPerformance(room: RoomState, game: GameState): void {
    if (this.roundPerformanceRecorded.has(game.id)) {
      return;
    }

    const endedAt = game.endedAt ?? new Date().toISOString();
    const stakeAmount = this.roundCurrency(game.prizePool);
    const payoutAmount = this.roundCurrency(Math.max(0, game.prizePool - game.remainingPrizePool));
    const payoutPercentEffective = stakeAmount > 0 ? this.roundCurrency((payoutAmount / stakeAmount) * 100) : 0;

    let totalTickets = 0;
    let nearMissTickets = 0;
    const drawnSet = new Set<number>(game.drawnNumbers);
    for (const [playerId, tickets] of game.tickets.entries()) {
      const marksByTicket = game.marks.get(playerId) ?? [];
      for (let ticketIndex = 0; ticketIndex < tickets.length; ticketIndex += 1) {
        const ticket = tickets[ticketIndex];
        totalTickets += 1;
        const effectiveMarks = new Set<number>();

        for (const row of ticket.grid) {
          for (const number of row) {
            if (number > 0 && drawnSet.has(number)) {
              effectiveMarks.add(number);
            }
          }
        }
        for (const marked of marksByTicket[ticketIndex] ?? []) {
          if (marked > 0) {
            effectiveMarks.add(marked);
          }
        }

        if (hasFullBingo(ticket, effectiveMarks)) {
          continue;
        }
        if (findFirstCompleteLinePatternIndex(ticket, effectiveMarks) >= 0) {
          continue;
        }
        if (countNearMissLinePattern(ticket, effectiveMarks) > 0) {
          nearMissTickets += 1;
        }
      }
    }

    const nearMissRate = totalTickets > 0 ? this.roundCurrency(nearMissTickets / totalTickets) : 0;
    const snapshot: RoundPerformanceSnapshot = {
      gameId: game.id,
      roomCode: room.code,
      hallId: room.hallId,
      startedAt: game.startedAt,
      endedAt,
      payoutPercentTarget: game.payoutPercent,
      payoutPercentEffective,
      stakeAmount,
      payoutAmount,
      nearMissTickets,
      totalTickets,
      nearMissRate
    };

    this.roundPerformanceRecorded.add(game.id);
    this.roundPerformanceHistory.push(snapshot);

    const retentionLimit = Math.max(this.rtpRollingWindowSize * 5, 5_000);
    while (this.roundPerformanceHistory.length > retentionLimit) {
      const removed = this.roundPerformanceHistory.shift();
      if (removed) {
        this.roundPerformanceRecorded.delete(removed.gameId);
      }
    }
  }

  private extractTicketLinePatterns(ticket: Ticket): number[][] {
    const patterns: number[][] = [];
    if (!ticket?.grid || ticket.grid.length === 0) {
      return patterns;
    }

    const rows = ticket.grid.length;
    const cols = ticket.grid[0]?.length ?? 0;
    if (cols <= 0) {
      return patterns;
    }

    for (let row = 0; row < rows; row += 1) {
      const values = ticket.grid[row].filter((value) => value > 0);
      if (values.length >= 2) {
        patterns.push(values);
      }
    }

    for (let col = 0; col < cols; col += 1) {
      const values: number[] = [];
      for (let row = 0; row < rows; row += 1) {
        const value = ticket.grid[row]?.[col] ?? 0;
        if (value > 0) {
          values.push(value);
        }
      }
      if (values.length >= 2) {
        patterns.push(values);
      }
    }

    const leftDiagonal: number[] = [];
    const rightDiagonal: number[] = [];
    const diagonalLength = Math.min(rows, cols);
    for (let index = 0; index < diagonalLength; index += 1) {
      const leftValue = ticket.grid[index]?.[index] ?? 0;
      const rightValue = ticket.grid[index]?.[cols - 1 - index] ?? 0;
      if (leftValue > 0) {
        leftDiagonal.push(leftValue);
      }
      if (rightValue > 0) {
        rightDiagonal.push(rightValue);
      }
    }
    if (leftDiagonal.length >= 2) {
      patterns.push(leftDiagonal);
    }
    if (rightDiagonal.length >= 2) {
      patterns.push(rightDiagonal);
    }

    return patterns;
  }

  private randomizeList<T>(values: T[]): T[] {
    const arr = [...values];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  getPlayerCompliance(walletId: string, hallId?: string): PlayerComplianceSnapshot {
    const normalizedWalletId = walletId.trim();
    if (!normalizedWalletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }
    const normalizedHallId = hallId?.trim() || undefined;

    const nowMs = Date.now();
    const personalLossLimits = this.getEffectiveLossLimits(normalizedWalletId, normalizedHallId);
    const netLoss = this.calculateNetLoss(normalizedWalletId, nowMs, normalizedHallId);
    const pauseState = this.getPlaySessionState(normalizedWalletId, nowMs);
    const restrictionState = this.getRestrictionState(normalizedWalletId, nowMs);
    const blockState = this.resolveGameplayBlock(normalizedWalletId, nowMs);

    return {
      walletId: normalizedWalletId,
      hallId: normalizedHallId,
      regulatoryLossLimits: { ...this.regulatoryLossLimits },
      personalLossLimits,
      netLoss,
      pause: {
        isOnPause: pauseState.pauseUntilMs !== undefined && pauseState.pauseUntilMs > nowMs,
        pauseUntil:
          pauseState.pauseUntilMs !== undefined && pauseState.pauseUntilMs > nowMs
            ? new Date(pauseState.pauseUntilMs).toISOString()
            : undefined,
        accumulatedPlayMs: pauseState.accumulatedMs,
        playSessionLimitMs: this.playSessionLimitMs,
        pauseDurationMs: this.pauseDurationMs,
        lastMandatoryBreak: pauseState.lastMandatoryBreak
          ? {
              triggeredAt: new Date(pauseState.lastMandatoryBreak.triggeredAtMs).toISOString(),
              pauseUntil: new Date(pauseState.lastMandatoryBreak.pauseUntilMs).toISOString(),
              totalPlayMs: pauseState.lastMandatoryBreak.totalPlayMs,
              hallId: pauseState.lastMandatoryBreak.hallId,
              netLoss: { ...pauseState.lastMandatoryBreak.netLoss }
            }
          : undefined
      },
      restrictions: {
        isBlocked: Boolean(blockState),
        blockedBy: blockState?.type,
        blockedUntil: blockState ? new Date(blockState.untilMs).toISOString() : undefined,
        timedPause: {
          isActive:
            restrictionState.timedPauseUntilMs !== undefined && restrictionState.timedPauseUntilMs > nowMs,
          pauseUntil:
            restrictionState.timedPauseUntilMs !== undefined && restrictionState.timedPauseUntilMs > nowMs
              ? new Date(restrictionState.timedPauseUntilMs).toISOString()
              : undefined,
          setAt:
            restrictionState.timedPauseSetAtMs !== undefined
              ? new Date(restrictionState.timedPauseSetAtMs).toISOString()
              : undefined
        },
        selfExclusion: {
          isActive:
            restrictionState.selfExcludedAtMs !== undefined &&
            restrictionState.selfExclusionMinimumUntilMs !== undefined,
          setAt:
            restrictionState.selfExcludedAtMs !== undefined
              ? new Date(restrictionState.selfExcludedAtMs).toISOString()
              : undefined,
          minimumUntil:
            restrictionState.selfExclusionMinimumUntilMs !== undefined
              ? new Date(restrictionState.selfExclusionMinimumUntilMs).toISOString()
              : undefined,
          canBeRemoved:
            restrictionState.selfExclusionMinimumUntilMs !== undefined
              ? nowMs >= restrictionState.selfExclusionMinimumUntilMs
              : false
        }
      }
    };
  }

  setPlayerLossLimits(input: {
    walletId: string;
    hallId: string;
    daily?: number;
    monthly?: number;
  }): PlayerComplianceSnapshot {
    const walletId = input.walletId.trim();
    if (!walletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }
    const hallId = input.hallId.trim();
    if (!hallId) {
      throw new DomainError("INVALID_INPUT", "hallId mangler.");
    }

    const current = this.getEffectiveLossLimits(walletId, hallId);
    const daily = input.daily ?? current.daily;
    const monthly = input.monthly ?? current.monthly;

    if (!Number.isFinite(daily) || daily < 0) {
      throw new DomainError("INVALID_INPUT", "dailyLossLimit må være 0 eller større.");
    }
    if (!Number.isFinite(monthly) || monthly < 0) {
      throw new DomainError("INVALID_INPUT", "monthlyLossLimit må være 0 eller større.");
    }
    if (daily > this.regulatoryLossLimits.daily) {
      throw new DomainError(
        "INVALID_INPUT",
        `dailyLossLimit kan ikke være høyere enn regulatorisk grense (${this.regulatoryLossLimits.daily}).`
      );
    }
    if (monthly > this.regulatoryLossLimits.monthly) {
      throw new DomainError(
        "INVALID_INPUT",
        `monthlyLossLimit kan ikke være høyere enn regulatorisk grense (${this.regulatoryLossLimits.monthly}).`
      );
    }

    this.personalLossLimitsByScope.set(this.makeLossScopeKey(walletId, hallId), {
      daily: Math.floor(daily),
      monthly: Math.floor(monthly)
    });

    return this.getPlayerCompliance(walletId, hallId);
  }

  setTimedPause(input: {
    walletId: string;
    durationMs?: number;
    durationMinutes?: number;
  }): PlayerComplianceSnapshot {
    const walletId = input.walletId.trim();
    if (!walletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }

    const nowMs = Date.now();
    const durationFromMinutes =
      input.durationMinutes !== undefined ? Math.floor(Number(input.durationMinutes) * 60 * 1000) : undefined;
    const rawDurationMs = input.durationMs ?? durationFromMinutes ?? 15 * 60 * 1000;
    if (!Number.isFinite(rawDurationMs) || rawDurationMs <= 0) {
      throw new DomainError("INVALID_INPUT", "duration må være større enn 0.");
    }
    const durationMs = Math.floor(rawDurationMs);
    const untilMs = nowMs + durationMs;

    const state = this.getRestrictionState(walletId, nowMs);
    state.timedPauseSetAtMs = nowMs;
    state.timedPauseUntilMs = Math.max(untilMs, state.timedPauseUntilMs ?? 0);
    this.restrictionsByWallet.set(walletId, state);
    return this.getPlayerCompliance(walletId);
  }

  clearTimedPause(walletIdInput: string): PlayerComplianceSnapshot {
    const walletId = walletIdInput.trim();
    if (!walletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }
    const nowMs = Date.now();
    const state = this.getRestrictionState(walletId, nowMs);
    if (state.timedPauseUntilMs !== undefined && state.timedPauseUntilMs > nowMs) {
      throw new DomainError(
        "TIMED_PAUSE_LOCKED",
        `Frivillig pause kan ikke oppheves før ${new Date(state.timedPauseUntilMs).toISOString()}.`
      );
    }

    state.timedPauseUntilMs = undefined;
    state.timedPauseSetAtMs = undefined;
    this.persistRestrictionState(walletId, state);
    return this.getPlayerCompliance(walletId);
  }

  setSelfExclusion(walletIdInput: string): PlayerComplianceSnapshot {
    const walletId = walletIdInput.trim();
    if (!walletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }
    const nowMs = Date.now();
    const state = this.getRestrictionState(walletId, nowMs);
    if (state.selfExcludedAtMs !== undefined && state.selfExclusionMinimumUntilMs !== undefined) {
      return this.getPlayerCompliance(walletId);
    }

    state.selfExcludedAtMs = nowMs;
    state.selfExclusionMinimumUntilMs = nowMs + this.selfExclusionMinMs;
    this.restrictionsByWallet.set(walletId, state);
    return this.getPlayerCompliance(walletId);
  }

  clearSelfExclusion(walletIdInput: string): PlayerComplianceSnapshot {
    const walletId = walletIdInput.trim();
    if (!walletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }
    const nowMs = Date.now();
    const state = this.getRestrictionState(walletId, nowMs);
    if (state.selfExcludedAtMs === undefined || state.selfExclusionMinimumUntilMs === undefined) {
      return this.getPlayerCompliance(walletId);
    }
    if (nowMs < state.selfExclusionMinimumUntilMs) {
      throw new DomainError(
        "SELF_EXCLUSION_LOCKED",
        `Selvutelukkelse kan ikke oppheves før ${new Date(state.selfExclusionMinimumUntilMs).toISOString()}.`
      );
    }

    state.selfExcludedAtMs = undefined;
    state.selfExclusionMinimumUntilMs = undefined;
    this.persistRestrictionState(walletId, state);
    return this.getPlayerCompliance(walletId);
  }

  assertWalletAllowedForGameplay(walletIdInput: string, nowMs = Date.now()): void {
    const walletId = walletIdInput.trim();
    if (!walletId) {
      return;
    }
    const blockState = this.resolveGameplayBlock(walletId, nowMs);
    if (!blockState) {
      return;
    }

    if (blockState.type === "TIMED_PAUSE") {
      throw new DomainError(
        "PLAYER_TIMED_PAUSE",
        `Spiller er på frivillig pause til ${new Date(blockState.untilMs).toISOString()}.`
      );
    }

    throw new DomainError(
      "PLAYER_SELF_EXCLUDED",
      `Spiller er selvutestengt minst til ${new Date(blockState.untilMs).toISOString()}.`
    );
  }

  upsertPrizePolicy(input: {
    gameType?: PrizeGameType;
    hallId?: string;
    linkId?: string;
    effectiveFrom: string;
    singlePrizeCap?: number;
    dailyExtraPrizeCap?: number;
  }): PrizePolicySnapshot {
    const nowMs = Date.now();
    const gameType = input.gameType ?? "DATABINGO";
    const hallId = this.normalizePolicyDimension(input.hallId);
    const linkId = this.normalizePolicyDimension(input.linkId);
    const effectiveFromMs = this.assertIsoTimestampMs(input.effectiveFrom, "effectiveFrom");
    let inheritedSinglePrizeCap: number | undefined;
    let inheritedDailyExtraPrizeCap: number | undefined;
    if (input.singlePrizeCap === undefined || input.dailyExtraPrizeCap === undefined) {
      try {
        const current = this.resolvePrizePolicy({
          gameType,
          hallId,
          linkId,
          atMs: effectiveFromMs
        });
        inheritedSinglePrizeCap = current.singlePrizeCap;
        inheritedDailyExtraPrizeCap = current.dailyExtraPrizeCap;
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "PRIZE_POLICY_MISSING") {
          throw error;
        }
      }
    }

    const singlePrizeCap = this.assertNonNegativeNumber(
      input.singlePrizeCap ?? inheritedSinglePrizeCap ?? 2500,
      "singlePrizeCap"
    );
    const dailyExtraPrizeCap = this.assertNonNegativeNumber(
      input.dailyExtraPrizeCap ?? inheritedDailyExtraPrizeCap ?? 12000,
      "dailyExtraPrizeCap"
    );

    const policy: PrizePolicyVersion = {
      id: randomUUID(),
      gameType,
      hallId,
      linkId,
      effectiveFromMs,
      singlePrizeCap: Math.floor(singlePrizeCap),
      dailyExtraPrizeCap: Math.floor(dailyExtraPrizeCap),
      createdAtMs: nowMs
    };

    const scopeKey = this.makePrizePolicyScopeKey(gameType, hallId, linkId);
    const existing = this.prizePoliciesByScope.get(scopeKey) ?? [];
    const withoutSameEffectiveFrom = existing.filter((entry) => entry.effectiveFromMs !== effectiveFromMs);
    withoutSameEffectiveFrom.push(policy);
    withoutSameEffectiveFrom.sort((a, b) => a.effectiveFromMs - b.effectiveFromMs);
    this.prizePoliciesByScope.set(scopeKey, withoutSameEffectiveFrom);
    return this.toPrizePolicySnapshot(policy);
  }

  getActivePrizePolicy(input: {
    hallId: string;
    linkId?: string;
    gameType?: PrizeGameType;
    at?: string;
  }): PrizePolicySnapshot {
    const hallId = this.assertHallId(input.hallId);
    const linkId = input.linkId?.trim() || hallId;
    const atMs = input.at ? this.assertIsoTimestampMs(input.at, "at") : Date.now();
    const policy = this.resolvePrizePolicy({
      hallId,
      linkId,
      gameType: input.gameType ?? "DATABINGO",
      atMs
    });
    return this.toPrizePolicySnapshot(policy);
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
    const policy = this.resolvePrizePolicy({
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

    const scopeKey = this.makeExtraPrizeScopeKey(hallId, linkId);
    const todayStartMs = this.startOfLocalDayMs(nowMs);
    const existingEntries = (this.extraPrizeEntriesByScope.get(scopeKey) ?? []).filter(
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
    const sourceAccountId = this.makeHouseAccountId(hallId, gameType, channel);
    const transfer = await this.walletAdapter.transfer(
      sourceAccountId,
      walletId,
      amount,
      input.reason?.trim() || `Extra prize ${hallId}/${linkId}`
    );
    this.recordLossEntry(walletId, hallId, {
      type: "PAYOUT",
      amount,
      createdAtMs: nowMs
    });
    this.recordComplianceLedgerEvent({
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
    this.appendPayoutAuditEvent({
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
    this.extraPrizeEntriesByScope.set(scopeKey, existingEntries);
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
    const source = input.source ?? "UNKNOWN";
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

    const event: ExtraDrawDenialAudit = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      source,
      roomCode: normalizedRoomCode,
      playerId,
      walletId,
      hallId,
      reasonCode: "EXTRA_DRAW_NOT_ALLOWED",
      metadata: input.metadata
    };
    this.extraDrawDenials.unshift(event);
    if (this.extraDrawDenials.length > 1000) {
      this.extraDrawDenials.length = 1000;
    }

    throw new DomainError(
      "EXTRA_DRAW_NOT_ALLOWED",
      "Ekstratrekk er ikke tillatt for databingo. Forsøket er logget for revisjon."
    );
  }

  listExtraDrawDenials(limit = 100): ExtraDrawDenialAudit[] {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 100;
    return this.extraDrawDenials.slice(0, normalizedLimit).map((entry) => ({ ...entry }));
  }

  listPayoutAuditTrail(input?: {
    limit?: number;
    hallId?: string;
    gameId?: string;
    walletId?: string;
  }): PayoutAuditEvent[] {
    const limit = Number.isFinite(input?.limit) ? Math.max(1, Math.min(500, Math.floor(input!.limit!))) : 100;
    const hallId = input?.hallId?.trim();
    const gameId = input?.gameId?.trim();
    const walletId = input?.walletId?.trim();
    return this.payoutAuditTrail
      .filter((event) => {
        if (hallId && event.hallId !== hallId) {
          return false;
        }
        if (gameId && event.gameId !== gameId) {
          return false;
        }
        if (walletId && event.walletId !== walletId) {
          return false;
        }
        return true;
      })
      .slice(0, limit)
      .map((event) => ({ ...event, txIds: [...event.txIds] }));
  }

  listComplianceLedgerEntries(input?: {
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): ComplianceLedgerEntry[] {
    const limit = Number.isFinite(input?.limit) ? Math.max(1, Math.min(2000, Math.floor(input!.limit!))) : 200;
    const fromMs = input?.dateFrom ? this.assertIsoTimestampMs(input.dateFrom, "dateFrom") : undefined;
    const toMs = input?.dateTo ? this.assertIsoTimestampMs(input.dateTo, "dateTo") : undefined;
    const hallId = input?.hallId?.trim();
    const gameType = input?.gameType ? this.assertLedgerGameType(input.gameType) : undefined;
    const channel = input?.channel ? this.assertLedgerChannel(input.channel) : undefined;

    return this.complianceLedger
      .filter((entry) => {
        if (fromMs !== undefined && entry.createdAtMs < fromMs) {
          return false;
        }
        if (toMs !== undefined && entry.createdAtMs > toMs) {
          return false;
        }
        if (hallId && entry.hallId !== hallId) {
          return false;
        }
        if (gameType && entry.gameType !== gameType) {
          return false;
        }
        if (channel && entry.channel !== channel) {
          return false;
        }
        return true;
      })
      .slice(0, limit)
      .map((entry) => ({ ...entry }));
  }

  recordAccountingEvent(input: {
    hallId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
    eventType: "STAKE" | "PRIZE" | "EXTRA_PRIZE";
    amount: number;
    metadata?: Record<string, unknown>;
  }): ComplianceLedgerEntry {
    this.recordComplianceLedgerEvent({
      hallId: input.hallId,
      gameType: input.gameType,
      channel: input.channel,
      eventType: input.eventType,
      amount: input.amount,
      metadata: input.metadata
    });
    const latest = this.complianceLedger[0];
    return { ...latest };
  }

  generateDailyReport(input: {
    date: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): DailyComplianceReport {
    const dateKey = this.assertDateKey(input.date, "date");
    const hallId = input.hallId?.trim();
    const gameType = input.gameType ? this.assertLedgerGameType(input.gameType) : undefined;
    const channel = input.channel ? this.assertLedgerChannel(input.channel) : undefined;
    const dateRange = this.dayRangeMs(dateKey);
    const rowsByKey = new Map<string, DailyComplianceReportRow>();

    for (const entry of this.complianceLedger) {
      if (entry.createdAtMs < dateRange.startMs || entry.createdAtMs > dateRange.endMs) {
        continue;
      }
      if (hallId && entry.hallId !== hallId) {
        continue;
      }
      if (gameType && entry.gameType !== gameType) {
        continue;
      }
      if (channel && entry.channel !== channel) {
        continue;
      }

      const key = `${entry.hallId}::${entry.gameType}::${entry.channel}`;
      const row = rowsByKey.get(key) ?? {
        hallId: entry.hallId,
        gameType: entry.gameType,
        channel: entry.channel,
        grossTurnover: 0,
        prizesPaid: 0,
        net: 0,
        stakeCount: 0,
        prizeCount: 0,
        extraPrizeCount: 0
      };

      if (entry.eventType === "STAKE") {
        row.grossTurnover += entry.amount;
        row.stakeCount += 1;
      }
      if (entry.eventType === "PRIZE") {
        row.prizesPaid += entry.amount;
        row.prizeCount += 1;
      }
      if (entry.eventType === "EXTRA_PRIZE") {
        row.prizesPaid += entry.amount;
        row.extraPrizeCount += 1;
      }

      row.net = row.grossTurnover - row.prizesPaid;
      rowsByKey.set(key, row);
    }

    const rows = [...rowsByKey.values()].sort((a, b) => {
      const byHall = a.hallId.localeCompare(b.hallId);
      if (byHall !== 0) {
        return byHall;
      }
      const byGame = a.gameType.localeCompare(b.gameType);
      if (byGame !== 0) {
        return byGame;
      }
      return a.channel.localeCompare(b.channel);
    });

    const totals = rows.reduce(
      (acc, row) => {
        acc.grossTurnover += row.grossTurnover;
        acc.prizesPaid += row.prizesPaid;
        acc.net += row.net;
        acc.stakeCount += row.stakeCount;
        acc.prizeCount += row.prizeCount;
        acc.extraPrizeCount += row.extraPrizeCount;
        return acc;
      },
      {
        grossTurnover: 0,
        prizesPaid: 0,
        net: 0,
        stakeCount: 0,
        prizeCount: 0,
        extraPrizeCount: 0
      }
    );

    return {
      date: dateKey,
      generatedAt: new Date().toISOString(),
      rows,
      totals
    };
  }

  runDailyReportJob(input?: {
    date?: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): DailyComplianceReport {
    const date = input?.date ?? this.dateKeyFromMs(Date.now());
    const report = this.generateDailyReport({
      date,
      hallId: input?.hallId,
      gameType: input?.gameType,
      channel: input?.channel
    });
    this.dailyReportArchive.set(report.date, report);
    return report;
  }

  getArchivedDailyReport(dateInput: string): DailyComplianceReport | null {
    const date = this.assertDateKey(dateInput, "date");
    const archived = this.dailyReportArchive.get(date);
    if (!archived) {
      return null;
    }
    return {
      ...archived,
      rows: archived.rows.map((row) => ({ ...row })),
      totals: { ...archived.totals }
    };
  }

  exportDailyReportCsv(input: {
    date: string;
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): string {
    const report = this.generateDailyReport(input);
    const headers = [
      "date",
      "hall_id",
      "game_type",
      "channel",
      "gross_turnover",
      "prizes_paid",
      "net",
      "stake_count",
      "prize_count",
      "extra_prize_count"
    ];
    const lines = [headers.join(",")];

    for (const row of report.rows) {
      lines.push(
        [
          report.date,
          row.hallId,
          row.gameType,
          row.channel,
          row.grossTurnover,
          row.prizesPaid,
          row.net,
          row.stakeCount,
          row.prizeCount,
          row.extraPrizeCount
        ].join(",")
      );
    }

    lines.push(
      [
        report.date,
        "ALL",
        "ALL",
        "ALL",
        report.totals.grossTurnover,
        report.totals.prizesPaid,
        report.totals.net,
        report.totals.stakeCount,
        report.totals.prizeCount,
        report.totals.extraPrizeCount
      ].join(",")
    );
    return lines.join("\n");
  }

  async createOverskuddDistributionBatch(input: {
    date: string;
    allocations: OrganizationAllocationInput[];
    hallId?: string;
    gameType?: LedgerGameType;
    channel?: LedgerChannel;
  }): Promise<OverskuddDistributionBatch> {
    const date = this.assertDateKey(input.date, "date");
    const allocations = this.assertOrganizationAllocations(input.allocations);
    const report = this.generateDailyReport({
      date,
      hallId: input.hallId,
      gameType: input.gameType,
      channel: input.channel
    });

    const rowsWithMinimum = report.rows
      .map((row) => {
        const minimumPercent = row.gameType === "DATABINGO" ? 0.3 : 0.15;
        const net = Math.max(0, row.net);
        const minimumAmount = this.roundCurrency(net * minimumPercent);
        return {
          row,
          minimumPercent,
          minimumAmount
        };
      })
      .filter((entry) => entry.minimumAmount > 0);

    const requiredMinimum = this.roundCurrency(
      rowsWithMinimum.reduce((sum, entry) => sum + entry.minimumAmount, 0)
    );
    const batchId = randomUUID();
    const createdAt = new Date().toISOString();
    const transfers: OverskuddDistributionTransfer[] = [];

    for (const { row, minimumAmount } of rowsWithMinimum) {
      const sourceAccountId = this.makeHouseAccountId(row.hallId, row.gameType, row.channel);
      const parts = this.allocateAmountByShares(minimumAmount, allocations.map((allocation) => allocation.sharePercent));
      for (let i = 0; i < allocations.length; i += 1) {
        const amount = parts[i];
        if (amount <= 0) {
          continue;
        }
        const allocation = allocations[i];
        const transfer = await this.walletAdapter.transfer(
          sourceAccountId,
          allocation.organizationAccountId,
          amount,
          `Overskudd ${batchId} ${date}`
        );
        const record: OverskuddDistributionTransfer = {
          id: randomUUID(),
          batchId,
          createdAt: new Date().toISOString(),
          date,
          hallId: row.hallId,
          gameType: row.gameType,
          channel: row.channel,
          sourceAccountId,
          organizationId: allocation.organizationId,
          organizationAccountId: allocation.organizationAccountId,
          amount,
          txIds: [transfer.fromTx.id, transfer.toTx.id]
        };
        transfers.push(record);

        this.recordComplianceLedgerEvent({
          hallId: row.hallId,
          gameType: row.gameType,
          channel: row.channel,
          eventType: "ORG_DISTRIBUTION",
          amount,
          sourceAccountId,
          targetAccountId: allocation.organizationAccountId,
          batchId,
          metadata: {
            organizationId: allocation.organizationId,
            date
          }
        });
      }
    }

    const distributedAmount = this.roundCurrency(transfers.reduce((sum, transfer) => sum + transfer.amount, 0));
    const batch: OverskuddDistributionBatch = {
      id: batchId,
      createdAt,
      date,
      hallId: input.hallId?.trim() || undefined,
      gameType: input.gameType ? this.assertLedgerGameType(input.gameType) : undefined,
      channel: input.channel ? this.assertLedgerChannel(input.channel) : undefined,
      requiredMinimum,
      distributedAmount,
      transfers: transfers.map((transfer) => ({ ...transfer, txIds: [...transfer.txIds] })),
      allocations: allocations.map((allocation) => ({ ...allocation }))
    };
    this.overskuddBatches.set(batchId, batch);
    return batch;
  }

  getOverskuddDistributionBatch(batchIdInput: string): OverskuddDistributionBatch {
    const batchId = batchIdInput.trim();
    if (!batchId) {
      throw new DomainError("INVALID_INPUT", "batchId mangler.");
    }
    const batch = this.overskuddBatches.get(batchId);
    if (!batch) {
      throw new DomainError("BATCH_NOT_FOUND", "Fordelingsbatch finnes ikke.");
    }
    return {
      ...batch,
      transfers: batch.transfers.map((transfer) => ({ ...transfer, txIds: [...transfer.txIds] })),
      allocations: batch.allocations.map((allocation) => ({ ...allocation }))
    };
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

  private assertPlayersNotOnRequiredPause(players: Player[], nowMs: number): void {
    for (const player of players) {
      const state = this.playStateByWallet.get(player.walletId);
      if (!state?.pauseUntilMs) {
        continue;
      }

      if (state.pauseUntilMs > nowMs) {
        const summary = state.lastMandatoryBreak;
        const summaryText = summary
          ? ` Påkrevd pause trigget etter ${Math.ceil(summary.totalPlayMs / 60000)} min spill. Netto tap i hall ${summary.hallId}: dag ${summary.netLoss.daily}, måned ${summary.netLoss.monthly}.`
          : "";
        throw new DomainError(
          "PLAYER_ON_REQUIRED_PAUSE",
          `Spiller ${player.name} må ha pause til ${new Date(state.pauseUntilMs).toISOString()}.${summaryText}`
        );
      }

      state.pauseUntilMs = undefined;
      state.accumulatedMs = 0;
      this.playStateByWallet.set(player.walletId, state);
    }
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
      const limits = this.getEffectiveLossLimits(player.walletId, hallId);
      const netLoss = this.calculateNetLoss(player.walletId, nowMs, hallId);

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

  private getEffectiveLossLimits(walletId: string, hallId?: string): LossLimits {
    if (!hallId) {
      return { ...this.regulatoryLossLimits };
    }
    const customLimits = this.personalLossLimitsByScope.get(this.makeLossScopeKey(walletId, hallId));
    if (!customLimits) {
      return { ...this.regulatoryLossLimits };
    }
    return {
      daily: Math.min(customLimits.daily, this.regulatoryLossLimits.daily),
      monthly: Math.min(customLimits.monthly, this.regulatoryLossLimits.monthly)
    };
  }

  private calculateNetLoss(walletId: string, nowMs: number, hallId?: string): LossLimits {
    const dayStartMs = this.startOfLocalDayMs(nowMs);
    const monthStartMs = this.startOfLocalMonthMs(nowMs);
    const retentionCutoffMs = monthStartMs - 35 * 24 * 60 * 60 * 1000;
    const entries = hallId
      ? this.getLossEntriesForScope(walletId, hallId, retentionCutoffMs)
      : this.getLossEntriesForAllScopes(walletId, retentionCutoffMs);

    let daily = 0;
    let monthly = 0;
    for (const entry of entries) {
      const signed = entry.type === "BUYIN" ? entry.amount : -entry.amount;
      if (entry.createdAtMs >= monthStartMs) {
        monthly += signed;
        if (entry.createdAtMs >= dayStartMs) {
          daily += signed;
        }
      }
    }

    return {
      daily: Math.max(0, daily),
      monthly: Math.max(0, monthly)
    };
  }

  private getLossEntriesForScope(walletId: string, hallId: string, retentionCutoffMs: number): LossLedgerEntry[] {
    const scopeKey = this.makeLossScopeKey(walletId, hallId);
    const existing = this.lossEntriesByScope.get(scopeKey) ?? [];
    const pruned = existing.filter((entry) => entry.createdAtMs >= retentionCutoffMs);
    if (pruned.length !== existing.length) {
      this.lossEntriesByScope.set(scopeKey, pruned);
    }
    return pruned;
  }

  private getLossEntriesForAllScopes(walletId: string, retentionCutoffMs: number): LossLedgerEntry[] {
    const normalizedWalletId = walletId.trim();
    if (!normalizedWalletId) {
      return [];
    }

    const prefix = `${normalizedWalletId}::`;
    const all: LossLedgerEntry[] = [];
    for (const [scopeKey, entries] of this.lossEntriesByScope.entries()) {
      if (!scopeKey.startsWith(prefix)) {
        continue;
      }
      const pruned = entries.filter((entry) => entry.createdAtMs >= retentionCutoffMs);
      if (pruned.length !== entries.length) {
        this.lossEntriesByScope.set(scopeKey, pruned);
      }
      all.push(...pruned);
    }
    return all;
  }

  private makeLossScopeKey(walletId: string, hallId: string): string {
    return `${walletId.trim()}::${hallId.trim()}`;
  }

  private recordLossEntry(walletId: string, hallId: string, entry: LossLedgerEntry): void {
    const normalizedWalletId = walletId.trim();
    const normalizedHallId = hallId.trim();
    if (!normalizedWalletId) {
      return;
    }
    if (!normalizedHallId) {
      return;
    }
    const scopeKey = this.makeLossScopeKey(normalizedWalletId, normalizedHallId);
    const existing = this.lossEntriesByScope.get(scopeKey) ?? [];
    existing.push(entry);
    this.lossEntriesByScope.set(scopeKey, existing);
  }

  private startPlaySession(walletId: string, nowMs: number): void {
    const state = this.playStateByWallet.get(walletId) ?? { accumulatedMs: 0 };
    if (state.pauseUntilMs !== undefined && state.pauseUntilMs <= nowMs) {
      state.pauseUntilMs = undefined;
      state.accumulatedMs = 0;
    }
    if (state.activeFromMs === undefined) {
      state.activeFromMs = nowMs;
    }
    this.playStateByWallet.set(walletId, state);
  }

  private finishPlaySessionsForGame(room: RoomState, game: GameState, endedAtMs: number): void {
    const walletToHall = new Map<string, string>();
    for (const playerId of game.tickets.keys()) {
      const player = room.players.get(playerId);
      if (player) {
        walletToHall.set(player.walletId, room.hallId);
      }
    }

    for (const [walletId, hallId] of walletToHall.entries()) {
      this.finishPlaySession(walletId, hallId, endedAtMs);
    }
  }

  private finishPlaySession(walletId: string, hallId: string, endedAtMs: number): void {
    const state = this.playStateByWallet.get(walletId);
    if (!state || state.activeFromMs === undefined) {
      return;
    }

    const elapsedMs = Math.max(0, endedAtMs - state.activeFromMs);
    state.activeFromMs = undefined;
    state.accumulatedMs += elapsedMs;
    if (state.accumulatedMs >= this.playSessionLimitMs) {
      const pauseUntilMs = endedAtMs + this.pauseDurationMs;
      state.pauseUntilMs = pauseUntilMs;
      state.lastMandatoryBreak = {
        triggeredAtMs: endedAtMs,
        pauseUntilMs,
        totalPlayMs: state.accumulatedMs,
        hallId,
        netLoss: this.calculateNetLoss(walletId, endedAtMs, hallId)
      };
      state.accumulatedMs = 0;
    }

    this.playStateByWallet.set(walletId, state);
  }

  private getPlaySessionState(walletId: string, nowMs: number): PlaySessionState {
    const state = this.playStateByWallet.get(walletId) ?? { accumulatedMs: 0 };
    if (state.pauseUntilMs !== undefined && state.pauseUntilMs <= nowMs) {
      state.pauseUntilMs = undefined;
      state.accumulatedMs = 0;
    }
    const activeMs = state.activeFromMs !== undefined ? Math.max(0, nowMs - state.activeFromMs) : 0;
    return {
      ...state,
      accumulatedMs: state.accumulatedMs + activeMs
    };
  }

  private makeHouseAccountId(hallId: string, gameType: LedgerGameType, channel: LedgerChannel): string {
    return `house-${hallId.trim()}-${gameType.toLowerCase()}-${channel.toLowerCase()}`;
  }

  private recordComplianceLedgerEvent(input: {
    hallId: string;
    gameType: LedgerGameType;
    channel: LedgerChannel;
    eventType: LedgerEventType;
    amount: number;
    roomCode?: string;
    gameId?: string;
    claimId?: string;
    playerId?: string;
    walletId?: string;
    sourceAccountId?: string;
    targetAccountId?: string;
    policyVersion?: string;
    batchId?: string;
    metadata?: Record<string, unknown>;
  }): void {
    const nowMs = Date.now();
    const entry: ComplianceLedgerEntry = {
      id: randomUUID(),
      createdAt: new Date(nowMs).toISOString(),
      createdAtMs: nowMs,
      hallId: this.assertHallId(input.hallId),
      gameType: this.assertLedgerGameType(input.gameType),
      channel: this.assertLedgerChannel(input.channel),
      eventType: input.eventType,
      amount: this.roundCurrency(this.assertNonNegativeNumber(input.amount, "amount")),
      currency: "NOK",
      roomCode: input.roomCode?.trim() || undefined,
      gameId: input.gameId?.trim() || undefined,
      claimId: input.claimId?.trim() || undefined,
      playerId: input.playerId?.trim() || undefined,
      walletId: input.walletId?.trim() || undefined,
      sourceAccountId: input.sourceAccountId?.trim() || undefined,
      targetAccountId: input.targetAccountId?.trim() || undefined,
      policyVersion: input.policyVersion?.trim() || undefined,
      batchId: input.batchId?.trim() || undefined,
      metadata: input.metadata
    };
    this.complianceLedger.unshift(entry);
    if (this.complianceLedger.length > 50_000) {
      this.complianceLedger.length = 50_000;
    }
  }

  private appendPayoutAuditEvent(input: {
    kind: "CLAIM_PRIZE" | "EXTRA_PRIZE";
    claimId?: string;
    gameId?: string;
    roomCode?: string;
    hallId: string;
    policyVersion?: string;
    amount: number;
    walletId: string;
    playerId?: string;
    sourceAccountId?: string;
    txIds: string[];
  }): void {
    const now = new Date().toISOString();
    const normalizedTxIds = input.txIds.map((txId) => txId.trim()).filter(Boolean);
    const chainIndex = this.payoutAuditTrail.length + 1;
    const hashPayload = JSON.stringify({
      kind: input.kind,
      claimId: input.claimId,
      gameId: input.gameId,
      roomCode: input.roomCode,
      hallId: input.hallId,
      policyVersion: input.policyVersion,
      amount: input.amount,
      walletId: input.walletId,
      playerId: input.playerId,
      sourceAccountId: input.sourceAccountId,
      txIds: normalizedTxIds,
      createdAt: now,
      previousHash: this.lastPayoutAuditHash,
      chainIndex
    });
    const eventHash = createHash("sha256").update(hashPayload).digest("hex");
    const event: PayoutAuditEvent = {
      id: randomUUID(),
      createdAt: now,
      claimId: input.claimId?.trim() || undefined,
      gameId: input.gameId?.trim() || undefined,
      roomCode: input.roomCode?.trim() || undefined,
      hallId: this.assertHallId(input.hallId),
      policyVersion: input.policyVersion?.trim() || undefined,
      amount: this.roundCurrency(this.assertNonNegativeNumber(input.amount, "amount")),
      currency: "NOK",
      walletId: input.walletId.trim(),
      playerId: input.playerId?.trim() || undefined,
      sourceAccountId: input.sourceAccountId?.trim() || undefined,
      txIds: normalizedTxIds,
      kind: input.kind,
      chainIndex,
      previousHash: this.lastPayoutAuditHash,
      eventHash
    };
    this.payoutAuditTrail.unshift(event);
    this.lastPayoutAuditHash = eventHash;
    if (this.payoutAuditTrail.length > 10_000) {
      this.payoutAuditTrail.length = 10_000;
    }
  }

  private getRestrictionState(walletId: string, nowMs: number): RestrictionState {
    const existing = this.restrictionsByWallet.get(walletId) ?? {};
    const next: RestrictionState = { ...existing };
    if (next.timedPauseUntilMs !== undefined && next.timedPauseUntilMs <= nowMs) {
      next.timedPauseUntilMs = undefined;
      next.timedPauseSetAtMs = undefined;
    }
    this.persistRestrictionState(walletId, next);
    return next;
  }

  private persistRestrictionState(walletId: string, state: RestrictionState): void {
    const hasAnyRestriction =
      state.timedPauseUntilMs !== undefined ||
      state.timedPauseSetAtMs !== undefined ||
      state.selfExcludedAtMs !== undefined ||
      state.selfExclusionMinimumUntilMs !== undefined;
    if (!hasAnyRestriction) {
      this.restrictionsByWallet.delete(walletId);
      return;
    }
    this.restrictionsByWallet.set(walletId, state);
  }

  private resolveGameplayBlock(walletId: string, nowMs: number): GameplayBlockState | undefined {
    const state = this.getRestrictionState(walletId, nowMs);
    if (state.selfExcludedAtMs !== undefined && state.selfExclusionMinimumUntilMs !== undefined) {
      return {
        type: "SELF_EXCLUDED",
        untilMs: state.selfExclusionMinimumUntilMs
      };
    }
    if (state.timedPauseUntilMs !== undefined && state.timedPauseUntilMs > nowMs) {
      return {
        type: "TIMED_PAUSE",
        untilMs: state.timedPauseUntilMs
      };
    }
    return undefined;
  }

  private applySinglePrizeCap(input: {
    room: RoomState;
    gameType: PrizeGameType;
    amount: number;
    atMs?: number;
  }): {
    cappedAmount: number;
    wasCapped: boolean;
    policy: PrizePolicyVersion;
  } {
    const amount = this.assertNonNegativeNumber(input.amount, "amount");
    const atMs = input.atMs ?? Date.now();
    const policy = this.resolvePrizePolicy({
      hallId: input.room.hallId,
      linkId: input.room.hallId,
      gameType: input.gameType,
      atMs
    });
    const cappedAmount = Math.min(amount, policy.singlePrizeCap);
    return {
      cappedAmount,
      wasCapped: cappedAmount < amount,
      policy
    };
  }

  private resolvePrizePolicy(input: {
    hallId: string;
    linkId: string;
    gameType: PrizeGameType;
    atMs: number;
  }): PrizePolicyVersion {
    const hallId = this.normalizePolicyDimension(input.hallId);
    const linkId = this.normalizePolicyDimension(input.linkId);
    const gameType = input.gameType;
    const atMs = input.atMs;

    const candidateScopeKeys = [
      this.makePrizePolicyScopeKey(gameType, hallId, linkId),
      this.makePrizePolicyScopeKey(gameType, hallId, POLICY_WILDCARD),
      this.makePrizePolicyScopeKey(gameType, POLICY_WILDCARD, linkId),
      this.makePrizePolicyScopeKey(gameType, POLICY_WILDCARD, POLICY_WILDCARD)
    ];

    for (const scopeKey of candidateScopeKeys) {
      const versions = this.prizePoliciesByScope.get(scopeKey) ?? [];
      for (let i = versions.length - 1; i >= 0; i -= 1) {
        if (versions[i].effectiveFromMs <= atMs) {
          return versions[i];
        }
      }
    }

    throw new DomainError("PRIZE_POLICY_MISSING", "Fant ingen aktiv premiepolicy for spill/hall/link.");
  }

  private makePrizePolicyScopeKey(gameType: PrizeGameType, hallId: string, linkId: string): string {
    return `${gameType}::${hallId}::${linkId}`;
  }

  private makeExtraPrizeScopeKey(hallId: string, linkId: string): string {
    return `${hallId.trim()}::${linkId.trim()}`;
  }

  private normalizePolicyDimension(value: string | undefined): string {
    if (value === undefined || value === null) {
      return POLICY_WILDCARD;
    }
    const normalized = value.trim();
    if (!normalized) {
      return POLICY_WILDCARD;
    }
    if (normalized.length > 120) {
      throw new DomainError("INVALID_INPUT", "Policy-dimensjon er for lang.");
    }
    return normalized;
  }

  private assertIsoTimestampMs(value: string, fieldName: string): number {
    const normalized = value.trim();
    if (!normalized) {
      throw new DomainError("INVALID_INPUT", `${fieldName} mangler.`);
    }
    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed)) {
      throw new DomainError("INVALID_INPUT", `${fieldName} må være ISO-8601 dato/tid.`);
    }
    return parsed;
  }

  private assertNonNegativeNumber(value: number, fieldName: string): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new DomainError("INVALID_INPUT", `${fieldName} må være 0 eller større.`);
    }
    return value;
  }

  private toPrizePolicySnapshot(policy: PrizePolicyVersion): PrizePolicySnapshot {
    return {
      id: policy.id,
      gameType: policy.gameType,
      hallId: policy.hallId,
      linkId: policy.linkId,
      effectiveFrom: new Date(policy.effectiveFromMs).toISOString(),
      singlePrizeCap: policy.singlePrizeCap,
      dailyExtraPrizeCap: policy.dailyExtraPrizeCap,
      createdAt: new Date(policy.createdAtMs).toISOString()
    };
  }

  private assertLedgerGameType(value: string): LedgerGameType {
    const normalized = value.trim().toUpperCase();
    if (normalized === "MAIN_GAME" || normalized === "DATABINGO") {
      return normalized;
    }
    throw new DomainError("INVALID_INPUT", "gameType må være MAIN_GAME eller DATABINGO.");
  }

  private assertLedgerChannel(value: string): LedgerChannel {
    const normalized = value.trim().toUpperCase();
    if (normalized === "HALL" || normalized === "INTERNET") {
      return normalized;
    }
    throw new DomainError("INVALID_INPUT", "channel må være HALL eller INTERNET.");
  }

  private assertDateKey(value: string, fieldName: string): string {
    const normalized = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new DomainError("INVALID_INPUT", `${fieldName} må være i format YYYY-MM-DD.`);
    }
    const [yearText, monthText, dayText] = normalized.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      throw new DomainError("INVALID_INPUT", `${fieldName} er ikke en gyldig dato.`);
    }
    return normalized;
  }

  private dayRangeMs(dateKey: string): { startMs: number; endMs: number } {
    const normalized = this.assertDateKey(dateKey, "date");
    const [yearText, monthText, dayText] = normalized.split("-");
    const startMs = new Date(Number(yearText), Number(monthText) - 1, Number(dayText)).getTime();
    const endMs = startMs + 24 * 60 * 60 * 1000 - 1;
    return { startMs, endMs };
  }

  private dateKeyFromMs(referenceMs: number): string {
    const date = new Date(referenceMs);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private assertOrganizationAllocations(
    allocations: OrganizationAllocationInput[]
  ): OrganizationAllocationInput[] {
    if (!Array.isArray(allocations) || allocations.length === 0) {
      throw new DomainError("INVALID_INPUT", "allocations må inneholde minst én organisasjon.");
    }

    const normalized = allocations.map((allocation) => {
      const organizationId = allocation.organizationId?.trim();
      const organizationAccountId = allocation.organizationAccountId?.trim();
      const sharePercent = Number(allocation.sharePercent);
      if (!organizationId) {
        throw new DomainError("INVALID_INPUT", "organizationId mangler.");
      }
      if (!organizationAccountId) {
        throw new DomainError("INVALID_INPUT", "organizationAccountId mangler.");
      }
      if (!Number.isFinite(sharePercent) || sharePercent <= 0) {
        throw new DomainError("INVALID_INPUT", "sharePercent må være større enn 0.");
      }
      return {
        organizationId,
        organizationAccountId,
        sharePercent
      };
    });

    const totalShare = normalized.reduce((sum, allocation) => sum + allocation.sharePercent, 0);
    if (Math.abs(totalShare - 100) > 0.0001) {
      throw new DomainError("INVALID_INPUT", "Summen av sharePercent må være 100.");
    }
    return normalized;
  }

  private roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private allocateAmountByShares(totalAmount: number, shares: number[]): number[] {
    const total = this.roundCurrency(totalAmount);
    if (shares.length === 0) {
      return [];
    }
    const sumShares = shares.reduce((sum, share) => sum + share, 0);
    if (!Number.isFinite(sumShares) || sumShares <= 0) {
      throw new DomainError("INVALID_INPUT", "Ugyldige andeler for fordeling.");
    }

    const amounts = shares.map((share) => this.roundCurrency((total * share) / sumShares));
    const allocated = this.roundCurrency(amounts.reduce((sum, amount) => sum + amount, 0));
    const remainder = this.roundCurrency(total - allocated);
    amounts[0] = this.roundCurrency(amounts[0] + remainder);
    return amounts;
  }

  private startOfLocalDayMs(referenceMs: number): number {
    const reference = new Date(referenceMs);
    return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
  }

  private startOfLocalMonthMs(referenceMs: number): number {
    const reference = new Date(referenceMs);
    return new Date(reference.getFullYear(), reference.getMonth(), 1).getTime();
  }

  private requireRoom(roomCode: string): RoomState {
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

  private assertHallId(hallId: string): string {
    const normalized = hallId.trim();
    if (!normalized || normalized.length > 120) {
      throw new DomainError("INVALID_HALL_ID", "hallId er ugyldig.");
    }
    return normalized;
  }

  private serializeRoom(room: RoomState): RoomSnapshot {
    return {
      code: room.code,
      hallId: room.hallId,
      hostPlayerId: room.hostPlayerId,
      createdAt: room.createdAt,
      players: [...room.players.values()],
      currentGame: room.currentGame ? this.serializeGame(room.currentGame) : undefined,
      gameHistory: room.gameHistory.map((game) => ({ ...game }))
    };
  }

  private serializeGame(game: GameState): GameSnapshot {
    const ticketByPlayerId = Object.fromEntries(
      [...game.tickets.entries()].map(([playerId, tickets]) => [playerId, tickets.map((ticket) => ({ ...ticket }))])
    );
    const marksByPlayerId = Object.fromEntries(
      [...game.marks.entries()].map(([playerId, marksByTicket]) => {
        const mergedMarks = new Set<number>();
        for (const marks of marksByTicket) {
          for (const number of marks.values()) {
            mergedMarks.add(number);
          }
        }
        return [playerId, [...mergedMarks.values()].sort((a, b) => a - b)];
      })
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
      drawnNumbers: [...game.drawnNumbers],
      remainingNumbers: game.drawBag.length,
      lineWinnerId: game.lineWinnerId,
      bingoWinnerId: game.bingoWinnerId,
      claims: [...game.claims],
      tickets: ticketByPlayerId,
      marks: marksByPlayerId,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
      endedReason: game.endedReason
    };
  }
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
