import { randomUUID } from "node:crypto";
import type { BingoSystemAdapter } from "../adapters/BingoSystemAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { hasAnyCompleteLine, hasFullBingo, makeRoomCode, makeShuffledBallBag, ticketContainsNumber } from "./ticket.js";
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
  dailyLossLimit?: number;
  monthlyLossLimit?: number;
  playSessionLimitMs?: number;
  pauseDurationMs?: number;
  selfExclusionMinMs?: number;
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

  private readonly minRoundIntervalMs: number;
  private readonly regulatoryLossLimits: LossLimits;
  private readonly playSessionLimitMs: number;
  private readonly pauseDurationMs: number;
  private readonly selfExclusionMinMs: number;

  constructor(
    private readonly bingoAdapter: BingoSystemAdapter,
    private readonly walletAdapter: WalletAdapter,
    options: ComplianceOptions = {}
  ) {
    this.minRoundIntervalMs = Math.max(30000, Math.floor(options.minRoundIntervalMs ?? 30000));

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
    this.playSessionLimitMs = Math.floor(playSessionLimitMs);
    this.pauseDurationMs = Math.floor(pauseDurationMs);
    this.selfExclusionMinMs = Math.floor(selfExclusionMinMs);

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
    if (room.currentGame?.status === "RUNNING") {
      throw new DomainError("GAME_ALREADY_RUNNING", "Kan ikke joine mens et spill er i gang.");
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

    if (room.players.size < 2) {
      throw new DomainError("NOT_ENOUGH_PLAYERS", "Du trenger minst 2 spillere for å starte.");
    }

    const entryFee = input.entryFee ?? 0;
    if (!Number.isFinite(entryFee) || entryFee < 0) {
      throw new DomainError("INVALID_ENTRY_FEE", "entryFee må være >= 0.");
    }
    const ticketsPerPlayer = input.ticketsPerPlayer ?? 1;
    if (!Number.isInteger(ticketsPerPlayer) || ticketsPerPlayer < 1 || ticketsPerPlayer > 5) {
      throw new DomainError("INVALID_TICKETS_PER_PLAYER", "ticketsPerPlayer må være et heltall mellom 1 og 5.");
    }

    const players = [...room.players.values()];
    this.assertPlayersNotInAnotherRunningGame(room.code, players);
    this.assertPlayersNotBlockedByRestriction(players, nowMs);
    this.assertPlayersNotOnRequiredPause(players, nowMs);
    await this.refreshPlayerObjectsFromWallet(players);
    await this.assertLossLimitsBeforeBuyIn(players, entryFee, nowMs, room.hallId);
    if (entryFee > 0) {
      await this.ensureSufficientBalance(players, entryFee);
      for (const player of players) {
        await this.walletAdapter.debit(player.walletId, entryFee, `Bingo buy-in ${room.code}`);
        player.balance -= entryFee;
        this.recordLossEntry(player.walletId, room.hallId, {
          type: "BUYIN",
          amount: entryFee,
          createdAtMs: Date.now()
        });
      }
    }

    const gameId = randomUUID();
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

    const prizePool = entryFee * players.length;
    const game: GameState = {
      id: gameId,
      status: "RUNNING",
      entryFee,
      ticketsPerPlayer,
      prizePool,
      remainingPrizePool: prizePool,
      drawBag: makeShuffledBallBag(75),
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

    const nextNumber = game.drawBag.shift();
    if (!nextNumber) {
      const endedAt = new Date();
      game.status = "ENDED";
      game.endedAt = endedAt.toISOString();
      game.endedReason = "DRAW_BAG_EMPTY";
      this.finishPlaySessionsForGame(room, game, endedAt.getTime());
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

    if (input.type === "LINE") {
      if (game.lineWinnerId) {
        reason = "LINE_ALREADY_CLAIMED";
      } else {
        valid = playerTickets.some((ticket, index) => hasAnyCompleteLine(ticket, playerMarks[index]));
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
    game.claims.push(claim);

    if (valid && input.type === "LINE") {
      game.lineWinnerId = player.id;
      const requestedPayout = Math.floor(game.prizePool * 0.3);
      const cappedLinePayout = this.applySinglePrizeCap({
        room,
        gameType: "DATABINGO",
        amount: requestedPayout
      });
      const payout = Math.min(cappedLinePayout.cappedAmount, game.remainingPrizePool);
      if (payout > 0) {
        await this.walletAdapter.credit(player.walletId, payout, `Line prize ${room.code}`);
        player.balance += payout;
        game.remainingPrizePool -= payout;
        this.recordLossEntry(player.walletId, room.hallId, {
          type: "PAYOUT",
          amount: payout,
          createdAtMs: Date.now()
        });
      }
      claim.payoutAmount = payout;
      claim.payoutPolicyVersion = cappedLinePayout.policy.id;
      claim.payoutWasCapped = cappedLinePayout.wasCapped;
    }

    if (valid && input.type === "BINGO") {
      const endedAt = new Date();
      game.bingoWinnerId = player.id;
      const requestedPayout = game.remainingPrizePool;
      const cappedBingoPayout = this.applySinglePrizeCap({
        room,
        gameType: "DATABINGO",
        amount: requestedPayout
      });
      const payout = Math.min(cappedBingoPayout.cappedAmount, game.remainingPrizePool);
      if (payout > 0) {
        await this.walletAdapter.credit(player.walletId, payout, `Bingo prize ${room.code}`);
        player.balance += payout;
        this.recordLossEntry(player.walletId, room.hallId, {
          type: "PAYOUT",
          amount: payout,
          createdAtMs: Date.now()
        });
      }
      game.remainingPrizePool = Math.max(0, game.remainingPrizePool - payout);
      game.status = "ENDED";
      game.endedAt = endedAt.toISOString();
      game.endedReason = "BINGO_CLAIMED";
      this.finishPlaySessionsForGame(room, game, endedAt.getTime());
      claim.payoutAmount = payout;
      claim.payoutPolicyVersion = cappedBingoPayout.policy.id;
      claim.payoutWasCapped = cappedBingoPayout.wasCapped;
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

    await this.walletAdapter.credit(walletId, amount, input.reason?.trim() || `Extra prize ${hallId}/${linkId}`);
    this.recordLossEntry(walletId, hallId, {
      type: "PAYOUT",
      amount,
      createdAtMs: nowMs
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
          `Spiller ${otherPlayer.name} deltar allerede i et annet aktivt spill.`
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
          `Spiller ${player.name} deltar allerede i et annet aktivt spill.`
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
