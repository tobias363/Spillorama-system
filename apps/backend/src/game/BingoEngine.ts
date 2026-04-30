import { randomUUID, createHash } from "node:crypto";
import type { BingoSystemAdapter } from "../adapters/BingoSystemAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { IdempotencyKeys } from "./idempotency.js";
import { roundCurrency } from "../util/currency.js";
import { logger as rootLogger } from "../util/logger.js";
import { logRoomEvent } from "../util/roomLogVerbose.js";
import * as variantConfigModule from "./variantConfig.js";

const logger = rootLogger.child({ module: "engine" });
import {
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

/**
 * Detekter om et pattern bruker faste premier (annonserte kr-beløp som ikke
 * skaleres med pool). Faste premier MÅ utbetales fullt ut uavhengig av pool-
 * størrelse — huset garanterer dem (legacy spillorama-paritet, fixed-prize
 * bingo-modell). §11 single-prize-cap (2500 kr) gjelder fortsatt.
 *
 * Variable premier (`winningType: "percent"` eller udefinert + `prizePercent`)
 * er pool-gated som før.
 *
 * Scope: kun `winningType === "fixed"` regnes som fast for nå.
 * `column-specific` og `ball-value-multiplier` har også faste kr-verdier,
 * men har eksisterende cap-tester — tas i egen task hvis ønskelig.
 */
function isFixedPrizePattern(pattern: {
  winningType?:
    | "percent"
    | "fixed"
    | "multiplier-chain"
    | "column-specific"
    | "ball-value-multiplier";
}): boolean {
  return pattern.winningType === "fixed";
}
import { PrizePolicyManager } from "./PrizePolicyManager.js";
import type { PrizeGameType, PrizePolicySnapshot, ExtraDrawDenialAudit } from "./PrizePolicyManager.js";
import { PayoutAuditTrail } from "./PayoutAuditTrail.js";
import type { PayoutAuditEvent } from "./PayoutAuditTrail.js";
import { PhasePayoutService } from "./PhasePayoutService.js";
import {
  ClaimSubmitterService,
  type ClaimSubmitterCallbacks,
} from "./ClaimSubmitterService.js";
import { ComplianceLedger } from "./ComplianceLedger.js";
import type { LedgerGameType, LedgerChannel, ComplianceLedgerEntry, DailyComplianceReport, RangeComplianceReport, GameStatisticsReport, OrganizationAllocationInput, OverskuddDistributionBatch, RevenueSummary, TimeSeriesReport, TimeSeriesGranularity, TopPlayersReport, GameSessionsReport } from "./ComplianceLedger.js";
import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";
import type { LoyaltyPointsHookPort } from "../adapters/LoyaltyPointsHookPort.js";
import { NoopLoyaltyPointsHookPort } from "../adapters/LoyaltyPointsHookPort.js";
import type { SplitRoundingAuditPort } from "../adapters/SplitRoundingAuditPort.js";
import { NoopSplitRoundingAuditPort } from "../adapters/SplitRoundingAuditPort.js";
import type {
  ClaimAuditTrailRecoveryPort,
} from "../adapters/ClaimAuditTrailRecoveryPort.js";
import { NoopClaimAuditTrailRecoveryPort } from "../adapters/ClaimAuditTrailRecoveryPort.js";
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

// `DomainError` ble flyttet til `apps/backend/src/errors/DomainError.ts` 2026-04-29
// (Stage 1 quick-win — Backend Pain-Points Audit). Re-eksporten her bevarer
// back-compat for eksisterende imports fra `BingoEngine.js` mens vi gradvis
// flytter konsumentene over til den nye plasseringen.
import { DomainError } from "../errors/DomainError.js";
export { DomainError };

interface CreateRoomInput {
  playerName: string;
  hallId: string;
  walletId?: string;
  socketId?: string;
  /** Optional fixed room code (e.g. "BINGO1"). Skips random generation. */
  roomCode?: string;
  /** Game variant slug (e.g. "bingo", "rocket"). Stored on the room. */
  gameSlug?: string;
  /**
   * Tobias 2026-04-27: shared hall-room (Spill 2/3).
   *
   * Hvis `null` markeres rommet som hall-shared via `RoomState.isHallShared=true`
   * og `joinRoom` skipper HALL_MISMATCH-sjekken (alle haller kan joine).
   * Hvis `undefined` er det per-hall-rom (eksisterende oppførsel).
   * Hvis en `string` sendes brukes den som override på `hallId`.
   */
  effectiveHallId?: string | null;
  /**
   * Demo Hall bypass (Tobias 2026-04-27): hentes typisk fra
   * `PlatformService.getHall(hallId).isTestHall`. Når TRUE settes
   * `RoomState.isTestHall=true` slik at pattern-evaluator bypasser
   * end-on-bingo og scheduled-engine bypasser auto-pause-på-phase-won.
   * Ingen effekt når `undefined` eller FALSE — eksisterende oppførsel.
   */
  isTestHall?: boolean;
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

  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): callback fired when an
   * armed player is filtered out at game-start (loss-limit OR low-balance).
   * Caller (socket-laget) bruker det til å pushe `bet:rejected` til
   * `wallet:<walletId>`-rommet for spilleren.
   *
   * Optional — fail-soft. Hvis caller utelater, oppfører engine seg som
   * før (silent drop med orphan-release fra PR #723).
   *
   * Scope: kun de tre filter-reasons fra `filterEligiblePlayers`. Players
   * filtrert ut tidligere (TIMED_PAUSE / SELF_EXCLUDED / REQUIRED_PAUSE)
   * via `isPlayerBlockedByRestriction` får IKKE denne callbacken — de
   * blokkeres allerede ved bet:arm via `assertWalletAllowedForGameplay`,
   * så scenario-et "blokkert spiller har armed-state ved game-start" er
   * ekstremt sjeldent (kun hvis pause aktiveres mellom arm og start).
   * Egne kallbacks for de kan legges til senere ved behov.
   */
  onPlayerRejected?: (input: {
    player: Player;
    reason:
      | "DAILY_LOSS_LIMIT_REACHED"
      | "MONTHLY_LOSS_LIMIT_REACHED"
      | "INSUFFICIENT_FUNDS";
    rejectedTicketCount: number;
    hallId: string;
  }) => void | Promise<void>;
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
   * K2 (2026-04-29): atomic state owner for armed-state + reservation-mapping
   * + arm-cycle. When provided, `cleanupStaleWalletInIdleRooms` uses it to
   * release-then-evict orphan reservations atomically — replacing the
   * `isPreserve`-callback shim from PR #724. Optional so existing tests can
   * keep wiring the engine without it; the legacy 2-arg form remains as a
   * fallback that doesn't release reservations (tests that don't care).
   *
   * Reference: docs/audit/REFACTOR_AUDIT_PRE_PILOT_2026-04-29.md §2.2 + §6 K2.
   */
  lifecycleStore?: import("../util/RoomLifecycleStore.js").RoomLifecycleStore;
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
  /**
   * CRIT-6 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26): valgfri recovery-port
   * for audit-trail-steg som feiler etter wallet-transfer. Default: no-op
   * (kjent kostnad — feilen er kun synlig i logger, samme som før porten).
   *
   * Produksjon bør wire en DB-backed implementasjon som skriver til en
   * recovery-queue-tabell, slik at en bakgrunns-job kan re-spille
   * stegene uten manuell SQL-intervensjon.
   */
  claimAuditTrailRecovery?: ClaimAuditTrailRecoveryPort;
  /**
   * Bølge K3 (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §2.1): når TRUE markerer
   * den nåværende prosess som et produksjons-runtime, og BingoEngine vil
   * derfor REJECTE alle Spill 1-mutasjoner som ikke enten:
   *   (a) er scheduled (har `room.scheduledGameId`), eller
   *   (b) tilhører et test-hall (`room.isTestHall === true`).
   *
   * Dette quarantiner ad-hoc Spill 1 til Demo Hall + dev/test, og tvinger
   * retail-haller til scheduled-engine-pathen (Game1DrawEngineService).
   *
   * Spill 2 (slug `rocket`) og Spill 3 (slug `monsterbingo`) påvirkes IKKE
   * — guarden er begrenset til `gameSlug === "bingo"`.
   *
   * Default false: tester og dev-miljø beholder eksisterende ad-hoc
   * Spill 1-funksjonalitet uendret. I production-wiring (`apps/backend/
   * src/index.ts`) settes flagget fra `isProductionRuntime`.
   *
   * Reference: docs/audit/REFACTOR_AUDIT_PRE_PILOT_2026-04-29.md §2.1 + §6 K3.
   */
  isProductionRuntime?: boolean;
}


const DEFAULT_SELF_EXCLUSION_MIN_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_DRAWS_PER_ROUND = 30;
const MAX_BINGO_BALLS_75 = 75;

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
  /**
   * HIGH-5 (Casino Review): per-room draw mutex. Hindrer at to samtidige
   * `draw:next`-events fra samme rom begge passerer `assertHost` og deretter
   * muterer `currentGame.drawBag`/`drawnNumbers` parallelt. Per-socket-rate-
   * limit (`socketRateLimit.ts:23`, 5/2s) er ikke nok — to ulike sockets
   * (samme host i to faner, eller to admin-tilgangs-paneler) kan kalle
   * samtidig.
   *
   * Verdien er den pågående draw-promisen. Når neste kall kommer mens en
   * draw er in-flight, kaster vi `DRAW_IN_PROGRESS` istedenfor å vente —
   * dette hindrer at request-køen vokser ukontrollert hvis et nettverks-
   * tregt admin-panel sender retries før forrige har returnert.
   *
   * Cleared i `finally` etter hver draw og i `destroyRoom`.
   */
  private readonly drawLocksByRoom = new Map<string, Promise<unknown>>();
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
  /**
   * CRIT-6: recovery-port for audit-trail-steg som feiler etter wallet-
   * transfer. Default no-op — produksjon wire-r DB-backed implementasjon.
   */
  protected readonly claimAuditTrailRecovery: ClaimAuditTrailRecoveryPort;

  /**
   * K2 (2026-04-29): atomic state owner for armed/reservation/arm-cycle.
   * When set (production wiring) the cleanup helpers route through
   * `evictPlayer` so eviction always releases the wallet reservation
   * atomically. Optional so test harnesses without reservation flow
   * keep working — the legacy 2-arg cleanup form remains a fallback.
   */
  private readonly lifecycleStore?: import("../util/RoomLifecycleStore.js").RoomLifecycleStore;

  /**
   * Bølge K3 (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §2.1): production-runtime-flagget.
   * Settes via `options.isProductionRuntime` ved konstruksjon.
   *
   * Når `true` → `assertSpill1NotAdHoc` rejecter Spill 1-mutasjoner som
   * verken er scheduled eller tilhører et test-hall. Når `false` (tester +
   * dev) → guarden er no-op, og BingoEngine fortsetter å håndtere ad-hoc
   * Spill 1 som før.
   *
   * Spill 2 (rocket) + Spill 3 (monsterbingo) påvirkes IKKE — guarden er
   * begrenset til `gameSlug === "bingo"`.
   */
  private readonly isProductionRuntime: boolean;
  protected readonly prizePolicy: PrizePolicyManager;
  protected readonly payoutAudit: PayoutAuditTrail;
  protected readonly ledger: ComplianceLedger;
  /**
   * F2-A (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §3.3 / HV-3): extracted the
   * cap-and-transfer flow that was duplicated in 3 places (`payoutPhaseWinner`,
   * `submitClaim` LINE branch, `submitClaim` BINGO branch) into a stand-alone
   * service. Caller still owns state mutations + ledger/audit-trail writes.
   */
  protected readonly phasePayoutService: PhasePayoutService;
  /**
   * F2-B (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §3.3 / HV-3): extracted the
   * full `submitClaim` flow (validation, LINE/BINGO branches, post-transfer
   * audit-trail, recovery-event helper) into a stand-alone service. The
   * public `submitClaim` method on this engine is now a thin delegate so the
   * Game2Engine/Game3Engine inheritance + Socket.IO wiring stays unchanged.
   */
  protected readonly claimSubmitterService: ClaimSubmitterService;
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

    // F2-A: shared cap-and-transfer flow used by all 3 payout call-sites.
    // Constructed AFTER walletAdapter + prizePolicy so dependencies are wired.
    this.phasePayoutService = new PhasePayoutService(this.walletAdapter, this.prizePolicy);

    // BIN-251: Wire external room state store if provided
    this.roomStateStore = options.roomStateStore;

    // GAME1_SCHEDULE PR 5: Loyalty-hook + split-rounding-audit (optional ports).
    // Defaults to no-op implementations so tests and loyalty-less deployments
    // don't need to wire anything.
    this.loyaltyHook = options.loyaltyHook ?? new NoopLoyaltyPointsHookPort();
    this.splitRoundingAudit = options.splitRoundingAudit ?? new NoopSplitRoundingAuditPort();
    // CRIT-6: claim-audit-trail recovery port (optional). Default no-op.
    this.claimAuditTrailRecovery =
      options.claimAuditTrailRecovery ?? new NoopClaimAuditTrailRecoveryPort();

    // F2-B: shared claim-submission flow (validation + LINE/BINGO + audit-trail).
    // Constructed AFTER all dependencies (compliance, ledger, payoutAudit,
    // phasePayoutService, bingoAdapter, rooms, claimAuditTrailRecovery) are wired.
    this.claimSubmitterService = new ClaimSubmitterService(
      this.compliance,
      this.ledger,
      this.payoutAudit,
      this.phasePayoutService,
      this.bingoAdapter,
      this.rooms,
      this.claimAuditTrailRecovery,
      this.buildClaimSubmitterCallbacks(),
    );

    // K2 (2026-04-29): atomic state owner. When provided, cleanup paths
    // route eviction through the store so orphan reservations are always
    // released atomically. Test harnesses that don't need this can omit.
    this.lifecycleStore = options.lifecycleStore;

    // K3 (2026-04-29): production-runtime-flagget. Default false — tester
    // og dev-miljø beholder eksisterende ad-hoc Spill 1-pathway. I prod
    // wiring (index.ts) settes dette fra `isProductionRuntime` slik at
    // assertSpill1NotAdHoc rejecter retail-haller som havner på BingoEngine
    // istedenfor scheduled Game1DrawEngineService.
    this.isProductionRuntime = options.isProductionRuntime === true;
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

  /**
   * K2-A CRIT-3: eksponer PrizePolicyManager som narrow port slik at
   * scheduled-engine (PotEvaluator, mini-game, lucky bonus) kan håndheve
   * single-prize-cap (2500 kr per pengespillforskriften §11) på alle payout-
   * paths uten å ta direkte avhengighet til PrizePolicyManager-klassen.
   *
   * `PrizeGameType` i policy-API-et er fortsatt kun "DATABINGO" — samme
   * 2500-cap gjelder MAIN_GAME, så vi bruker DATABINGO som policy-key
   * inntil egen task åpner typen.
   *
   * Regulatorisk: alle Spill 1 payout-paths SKAL kalle dette før
   * walletAdapter.credit. Differansen (cappedAmount - amount) audit-
   * logges av caller (typisk via PayoutAuditTrail eller dedikert log).
   */
  getPrizePolicyPort(): import("../adapters/PrizePolicyPort.js").PrizePolicyPort {
    const prizePolicy = this.prizePolicy;
    return {
      applySinglePrizeCap(input): {
        cappedAmount: number;
        wasCapped: boolean;
        policyId: string;
      } {
        const result = prizePolicy.applySinglePrizeCap({
          hallId: input.hallId,
          // PrizeGameType-svartelist (kun DATABINGO i dag) løses i egen
          // task — capen er identisk uansett gameType, så vi bruker
          // DATABINGO som lookup-key.
          gameType: "DATABINGO",
          amount: input.amount,
          atMs: input.atMs,
        });
        return {
          cappedAmount: result.cappedAmount,
          wasCapped: result.wasCapped,
          policyId: result.policy.id,
        };
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
    // Tobias 2026-04-27: Spill 2/3 sender `effectiveHallId: null` for shared
    // global rooms. Vi beholder opprettende hall i `room.hallId` (audit) men
    // setter `isHallShared=true` så `joinRoom` skipper HALL_MISMATCH.
    const isHallShared = input.effectiveHallId === null;
    // Demo Hall bypass (Tobias 2026-04-27): caller (typisk join-handler i
    // socket-laget) sender flagget basert på PlatformService.getHall.isTestHall.
    // Engine selv slår ikke opp i DB her — vi holder createRoom synkron mot
    // wallet og lar caller composere hall-info.
    const isTestHall = input.isTestHall === true;
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
      gameHistory: [],
      ...(isHallShared ? { isHallShared: true } : {}),
      ...(isTestHall ? { isTestHall: true } : {}),
    };

    this.rooms.set(code, room);
    this.syncRoomToStore(room); // BIN-251
    // LIVE_ROOM_OBSERVABILITY 2026-04-29: structured INFO-log slik at ops kan
    // grep room.created i Render-loggen og se hvem som åpnet rommet, hall,
    // canonical-kode + om det er test-hall. Tidligere ble dette begravd bak
    // logger.debug — useless ved post-mortem av prod-incident.
    logRoomEvent(
      logger,
      {
        roomCode: code,
        hallId,
        gameSlug: room.gameSlug,
        hostPlayerId: playerId,
        walletId,
        isTestHall: isTestHall || undefined,
        isHallShared: isHallShared || undefined,
      },
      "room.created",
    );
    logRoomEvent(
      logger,
      {
        roomCode: code,
        playerId,
        walletId,
        socketId: input.socketId ?? null,
        hallId,
        role: "host",
      },
      "room.player.joined",
    );
    return { roomCode: code, playerId };
  }

  async joinRoom(input: JoinRoomInput): Promise<{ roomCode: string; playerId: string }> {
    const roomCode = input.roomCode.trim().toUpperCase();
    const hallId = this.assertHallId(input.hallId);
    const room = this.requireRoom(roomCode);
    // Tobias 2026-04-27: shared rooms (Spill 2/3 — ROCKET / MONSTERBINGO) er
    // GLOBALE og deles av alle haller — skip HALL_MISMATCH-sjekken.
    if (!room.isHallShared && room.hallId !== hallId) {
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

    logRoomEvent(
      logger,
      {
        roomCode,
        playerId,
        walletId,
        socketId: input.socketId ?? null,
        hallId,
        role: "guest",
      },
      "room.player.joined",
    );
    return { roomCode, playerId };
  }

  /**
   * CRIT-4 / HIGH-1 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26):
   *
   * Markér et eksisterende `bingo`-rom som scheduled. Etter dette vil
   * `BingoEngine.startGame/drawNextNumber/evaluateActivePhase/
   * submitClaim` kaste `DomainError("USE_SCHEDULED_API")` hvis kalt på
   * dette rommet — defensiv guard mot dual-engine-bugs (se review CRIT-4).
   *
   * Kalles fra `game1ScheduledEvents.ts` etter at
   * `Game1DrawEngineService.assignRoomCode` har persistert mappingen.
   *
   * No-op hvis rommets gameSlug ikke er `"bingo"` — Spill 2/3 påvirkes
   * ikke fordi `assertNotScheduled` filtrerer på slug.
   *
   * Idempotent: gjentatte kall med samme `scheduledGameId` er trygt.
   * Race-vinduer (mellom `assignRoomCode` og `markRoomAsScheduled`) er
   * ikke mulig fordi `engine.createRoom` returnerer rom-koden synkront,
   * og scheduled-pathen kaller `markRoomAsScheduled` umiddelbart etter
   * vellykket assignRoomCode.
   *
   * @throws DomainError("ROOM_NOT_FOUND") hvis koden ikke finnes
   */
  markRoomAsScheduled(roomCode: string, scheduledGameId: string): void {
    const room = this.requireRoom(roomCode);
    const trimmedId = scheduledGameId?.trim();
    if (!trimmedId) {
      throw new DomainError(
        "INVALID_INPUT",
        "scheduledGameId må være en ikke-tom streng.",
      );
    }
    room.scheduledGameId = trimmedId;
    this.syncRoomToStore(room);
  }

  async startGame(input: StartGameInput): Promise<void> {
    const room = this.requireRoom(input.roomCode);
    // CRIT-4: scheduled Spill 1 må kjøre via Game1DrawEngineService.
    this.assertNotScheduled(room);
    // K3: production retail Spill 1 må kjøre via scheduled-engine.
    // Demo Hall + test-haller (isTestHall=true) får fortsette på ad-hoc.
    this.assertSpill1NotAdHoc(room);
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
    //
    // LIVE_ROOM_OBSERVABILITY 2026-04-29: hver drop logges som
    // `game.player.filtered` slik at ops ser hvorfor en spiller mistet
    // ticket-tildeling. Tidligere var dette en stille filter-step uten
    // forklaring i logger.
    const ticketCandidates: Player[] = [];
    for (const player of allPlayers) {
      if (armedSet && !armedSet.has(player.id)) {
        logRoomEvent(
          logger,
          { roomCode: room.code, playerId: player.id, walletId: player.walletId, reason: "notArmed" },
          "game.player.filtered",
        );
        continue;
      }
      if (this.isPlayerInAnotherRunningGame(room.code, player)) {
        logRoomEvent(
          logger,
          { roomCode: room.code, playerId: player.id, walletId: player.walletId, reason: "notInRoom" },
          "game.player.filtered",
        );
        continue;
      }
      if (this.isPlayerBlockedByRestriction(player, nowMs)) {
        logRoomEvent(
          logger,
          { roomCode: room.code, playerId: player.id, walletId: player.walletId, reason: "blocked" },
          "game.player.filtered",
        );
        continue;
      }
      ticketCandidates.push(player);
    }
    if (ticketCandidates.length > 0) {
      await this.refreshPlayerObjectsFromWallet(ticketCandidates);
    }
    // Filter out players who exceed loss limits or can't afford entry fee.
    // Tobias 2026-04-29: pass the per-player drop hook + ticket-counts so
    // socket-laget can emit `bet:rejected` til hver droppet spiller. Caller
    // (gameLifecycleEvents) wirer onPlayerRejected — fail-soft hvis ikke.
    const rejectedTicketCountMap = new Map<string, number>();
    if (input.armedPlayerTicketCounts) {
      for (const [pid, count] of Object.entries(input.armedPlayerTicketCounts)) {
        rejectedTicketCountMap.set(pid, count);
      }
    }
    // LIVE_ROOM_OBSERVABILITY 2026-04-29: instrument onPlayerRejected for
    // structured INFO-log. Vi wrapper i stedet for å duplikere filter-
    // logikken, så vi behold callerens hook (socket-laget bruker den til
    // bet:rejected-emit til klienten).
    const wrappedOnPlayerRejected: typeof input.onPlayerRejected = async (rejInput) => {
      const reasonMap: Record<typeof rejInput.reason, string> = {
        DAILY_LOSS_LIMIT_REACHED: "lossLimit",
        MONTHLY_LOSS_LIMIT_REACHED: "lossLimit",
        INSUFFICIENT_FUNDS: "lowBalance",
      };
      logRoomEvent(
        logger,
        {
          roomCode: room.code,
          playerId: rejInput.player.id,
          walletId: rejInput.player.walletId,
          reason: reasonMap[rejInput.reason] ?? "blocked",
          detail: rejInput.reason,
          rejectedTicketCount: rejInput.rejectedTicketCount,
        },
        "game.player.filtered",
      );
      if (input.onPlayerRejected) {
        await input.onPlayerRejected(rejInput);
      }
    };
    const eligiblePlayers = ticketCandidates.length > 0
      ? await this.filterEligiblePlayers(
          ticketCandidates,
          entryFee,
          nowMs,
          room.hallId,
          wrappedOnPlayerRejected,
          rejectedTicketCountMap,
        )
      : [];
    const gameId = randomUUID();
    // K2-A CRIT-1: per-spill resolver. Spill 1 (slug `bingo`) er hovedspill
    // (MAIN_GAME, 15%). Andre slugs (rocket/monsterbingo) returnerer fortsatt
    // DATABINGO inntil de behandles i egen task. Resolver gjør oppslaget
    // tolerant for null/manglende slug.
    const gameType: LedgerGameType = ledgerGameTypeForSlug(room.gameSlug);
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
              reason: "BINGO_BUYIN",
              // GAP #28: tag the gameSlug so per-slug reports
              // (Spill 1 bingo / Spill 2 rocket / Spill 3 monsterbingo /
              // SpinnGo spillorama) can aggregate without doing
              // session-table joins.
              gameSlug: room.gameSlug
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

        // FORHANDSKJOP-ORPHAN-FIX (PR 1): also release reservations of
        // UNDEBITED-but-eligible players. `refundDebitedPlayers` covers
        // those whose commit (commitReservation or transfer) succeeded
        // before the throw. Players later in `eligiblePlayers` whose
        // commit hadn't started yet still have an active reservation —
        // release them here so the saldo isn't locked until TTL.
        // Reference: docs/audit/FORHANDSKJOP_BUG_ROOT_CAUSE_2026-04-29.md.
        const rollbackReservationMap = input.reservationIdByPlayer ?? {};
        const debitedIds = new Set(debitedPlayers.map((d) => d.player.id));
        for (const player of eligiblePlayers) {
          if (debitedIds.has(player.id)) continue;
          const reservationId = rollbackReservationMap[player.id];
          if (!reservationId) continue;
          try {
            await this.walletAdapter.releaseReservation?.(reservationId);
            logger.warn(
              {
                roomCode: room.code,
                gameId,
                playerId: player.id,
                reservationId,
                reason: "rollback-undebited",
              },
              "Released undebited reservation during startGame partial-failure rollback",
            );
          } catch (releaseErr) {
            logger.error(
              {
                err: releaseErr,
                roomCode: room.code,
                gameId,
                playerId: player.id,
                reservationId,
              },
              "Failed to release undebited reservation during startGame rollback",
            );
          }
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

      // FORHANDSKJOP-ORPHAN-FIX (PR 1, defense-in-depth): release any
      // reservation whose player did NOT make it through to eligiblePlayers
      // (i.e. was armed but absent from the buy-in loop). Players whose
      // record was evicted from `room.players` between bet:arm and start
      // — typically by `cleanupStaleWalletInIdleRooms` running while the
      // room sat idle between rounds — leave a `wallet_reservations` row
      // at status='active' with no in-memory mapping after
      // `disarmAllPlayers` wipes the armed-set. The 30-min TTL eventually
      // heals it, but the player's saldo is locked until then. Releasing
      // here closes the window immediately. Same defense covers the
      // low-funds drop in `filterEligiblePlayers` and any future similar
      // silent-drop sites.
      // Reference: docs/audit/FORHANDSKJOP_BUG_ROOT_CAUSE_2026-04-29.md.
      const reservationMap = input.reservationIdByPlayer ?? {};
      const consumedPlayerIds = new Set(eligiblePlayers.map((p) => p.id));
      for (const [playerId, reservationId] of Object.entries(reservationMap)) {
        if (consumedPlayerIds.has(playerId)) continue;
        try {
          await this.walletAdapter.releaseReservation?.(reservationId);
          logger.warn(
            {
              roomCode: room.code,
              gameId,
              playerId,
              reservationId,
              reason: "orphan-armed-not-eligible",
            },
            "Released orphan reservation in startGame — armed player was not in eligiblePlayers (likely cleanupStaleWalletInIdleRooms race or low-funds filter)",
          );
        } catch (releaseErr) {
          logger.error(
            {
              err: releaseErr,
              roomCode: room.code,
              gameId,
              playerId,
              reservationId,
            },
            "Failed to release orphan reservation in startGame",
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

    // LIVE_ROOM_OBSERVABILITY 2026-04-29: structured INFO-log med per-player
    // ticket-count slik at ops kan se nøyaktig hvilke spillere fikk hvor mange
    // brett, og hvordan prizePool / payoutBudget er beregnet for runden.
    const ticketsByPlayer: Record<string, number> = {};
    for (const player of eligiblePlayers) {
      ticketsByPlayer[player.id] = playerTicketCountMap.get(player.id) ?? ticketsPerPlayer;
    }
    logRoomEvent(
      logger,
      {
        roomCode: room.code,
        gameId,
        gameSlug: room.gameSlug,
        hallId: room.hallId,
        eligiblePlayerIds: eligiblePlayers.map((p) => p.id),
        eligiblePlayerCount: eligiblePlayers.length,
        prizePool,
        payoutPercent: normalizedPayoutPercent,
        maxPayoutBudget,
        ticketsByPlayer,
        entryFee,
        isTestGame: isTestGame || undefined,
      },
      "game.started",
    );

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
      // Tobias prod-incident 2026-04-29: trigger mini-game (Mystery / Wheel /
      // Chest / ColorDraft) i auto-claim-pathen. Når Fullt Hus auto-claimes
      // i `evaluateActivePhase` (uten å gå via socket `claim:submit`),
      // kaller den hooken her; vi delegerer til den eksisterende
      // `activateMiniGame`-helperen som muterer `game.miniGame` og
      // returnerer state-en. Idempotent: hvis `game.miniGame` allerede er
      // satt (rare race med manuell claim:submit), returnerer helperen
      // bare den eksisterende uten å overskrive.
      //
      // Multi-winner: dagens MiniGameState-schema har én playerId per
      // game. Vi aktiverer for første deterministiske vinner (winnerIds[0])
      // — matcher manuell claim:submit-pathens semantikk der kun en
      // spillers handler vinner race-en til activateMiniGame. socket-laget
      // detekterer mini-game-state og emitterer `minigame:activated` til
      // riktig vinner via wallet-rommet (drawEvents.ts).
      onAutoClaimedFullHouse: (room, game, winnerIds) => {
        if (winnerIds.length === 0) return;
        const winnerPlayerId = winnerIds[0]!;
        // activateMiniGameHelper er idempotent — andre kall returnerer
        // eksisterende mini-game uten å overskrive (BingoEngineMiniGames.ts:262).
        activateMiniGameHelper(
          this.getMiniGamesContext(),
          this.miniGameRotation,
          room.code,
          winnerPlayerId,
        );
      },
    };
  }

  /**
   * F2-B: bygger callback-porten som {@link ClaimSubmitterService} trenger
   * for å delegere engine-interne lookups (player, KYC-guard, scheduled-/
   * Spill-1-quarantine) og post-payout helpers (wallet-refresh,
   * play-session-close, checkpoint-write) uten å eksponere `this` direkte.
   * Samme mønster som {@link buildEvaluatePhaseCallbacks}.
   */
  private buildClaimSubmitterCallbacks(): ClaimSubmitterCallbacks {
    return {
      requirePlayer: (room, playerId) => this.requirePlayer(room, playerId),
      assertWalletAllowedForGameplay: (walletId, nowMs) =>
        this.assertWalletAllowedForGameplay(walletId, nowMs),
      assertNotScheduled: (room) => this.assertNotScheduled(room),
      assertSpill1NotAdHoc: (room) => this.assertSpill1NotAdHoc(room),
      meetsPhaseRequirement: (pattern, ticket, drawnSet) =>
        this.meetsPhaseRequirement(pattern, ticket, drawnSet),
      refreshPlayerBalancesForWallet: (walletId) =>
        this.refreshPlayerBalancesForWallet(walletId),
      finishPlaySessionsForGame: (room, game, endedAtMs) =>
        this.finishPlaySessionsForGame(room, game, endedAtMs),
      writeGameEndCheckpoint: (room, game) =>
        this.writeGameEndCheckpoint(room, game),
      writePayoutCheckpointWithRetry: (room, game, claimId, payout, txIds, phase) =>
        this.writePayoutCheckpointWithRetry(room, game, claimId, payout, txIds, phase),
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
    // CRIT-4: defensive — kalles kun fra drawNextNumber (som allerede
    // har guard), men dobbel-sjekk siden denne også skriver wallet
    // via auto-claim-payouts.
    this.assertNotScheduled(room);
    // K3: defensive — drawNextNumber har allerede guard, men auto-claim
    // payout skriver wallet og må aldri lekke i prod retail.
    this.assertSpill1NotAdHoc(room);
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
   *
   * F2-A (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §3.3 / HV-3): cap-and-transfer
   * extracted to {@link PhasePayoutService.computeAndPayPhase}. The remaining
   * code here owns: claim creation, state mutations on game/room, ledger
   * + audit-event writes, and checkpoint persistence. Behavior is unchanged
   * — same idempotency-key, same ledger ordering, same logging fields.
   */
  private async payoutPhaseWinner(
    room: RoomState,
    game: GameState,
    playerId: string,
    pattern: PatternDefinition,
    patternResult: PatternResult,
    prizePerWinner: number,
  ): Promise<void> {
    const player = this.requirePlayer(room, playerId);
    // K2-A CRIT-1: per-spill resolver. Spill 1 (slug `bingo`) → MAIN_GAME.
    const gameType: LedgerGameType = ledgerGameTypeForSlug(room.gameSlug);
    const channel: LedgerChannel = "INTERNET";
    const houseAccountId = this.ledger.makeHouseAccountId(room.hallId, gameType, channel);

    // F2-A: cap calculation + wallet transfer + house-balance lookup. State
    // mutations (claim creation, pool decrement, ledger writes, audit events)
    // remain inline below so the post-transfer ordering matches the
    // pre-extraction implementation exactly. See PhasePayoutService.ts for
    // the rationale + RTP-cap-bug-fix history (game `057c0502`-incident).
    const phaseResult = await this.phasePayoutService.computeAndPayPhase({
      hallId: room.hallId,
      roomCode: room.code,
      gameId: game.id,
      isTestHall: room.isTestHall === true,
      pattern,
      prizePerWinner,
      remainingPrizePool: game.remainingPrizePool,
      remainingPayoutBudget: game.remainingPayoutBudget,
      houseAccountId,
      walletId: player.walletId,
      transferMemo: `${pattern.name} prize ${room.code}`,
      idempotencyKey: IdempotencyKeys.adhocPhase({
        patternId: patternResult.patternId,
        gameId: game.id,
        playerId: player.id,
      }),
      phase: "PHASE",
    });
    const {
      payout,
      payoutSkipped: payoutWasSkipped,
      payoutSkippedReason,
      rtpCapped,
      rtpBudgetBefore,
      requestedAfterPolicyAndPool,
      houseAvailableBalance,
      walletTransfer: transfer,
      policy,
      houseDeficit,
    } = phaseResult;

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

    if (payout > 0 && transfer) {
      // Hot-fix Tobias 2026-04-26: bytt optimistisk `player.balance += payout`
      // mot autoritativ refresh fra wallet-adapter. Optimistisk += taper
      // deposit/winnings-split-info → stale balance i room:update på 2.+ vinn.
      // Fail-soft: vinneren er kreditert, kun lokal cache er stale ved feil.
      try {
        await this.refreshPlayerBalancesForWallet(player.walletId);
      } catch (err) {
        logger.warn(
          { err, walletId: player.walletId, gameId: game.id, claimId: claim.id },
          "payoutPhaseWinner: wallet refresh feilet (best-effort)",
        );
      }
      // Pool/RTP-budget tracking: dekreementer går aldri negativ — hus-deficit
      // for fixed-prize-overlapp er allerede dekket via wallet-systemkonto.
      // For audit-trail logger vi HOUSE_DEFICIT-event hvis payout > tilgjengelig
      // pool-andel (huset finansierte differansen).
      const poolBeforePayout = game.remainingPrizePool;
      const budgetBeforePayout = game.remainingPayoutBudget;
      game.remainingPrizePool = roundCurrency(Math.max(0, poolBeforePayout - payout));
      game.remainingPayoutBudget = roundCurrency(Math.max(0, budgetBeforePayout - payout));
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
        policyVersion: policy.id,
        // GAP #28: tag the slug so per-slug reports can match prizes to
        // their game-type without joining `game_sessions`.
        metadata: {
          reason: "BINGO_PRIZE",
          gameSlug: room.gameSlug,
          claimType: claim.type,
        },
      });
      // Fixed-prize hus-deficit audit (REN AUDIT — inngår ikke i §11-aggregater).
      // Logges fire-and-forget: en feil her påvirker ikke payout som allerede
      // er committet via wallet.transfer.
      if (houseDeficit > 0) {
        try {
          await this.ledger.recordComplianceLedgerEvent({
            hallId: room.hallId,
            gameType,
            channel,
            eventType: "HOUSE_DEFICIT",
            amount: houseDeficit,
            roomCode: room.code,
            gameId: game.id,
            claimId: claim.id,
            playerId: player.id,
            walletId: player.walletId,
            sourceAccountId: houseAccountId,
            policyVersion: policy.id,
            metadata: {
              reason: "FIXED_PRIZE_HOUSE_GUARANTEE",
              patternName: pattern.name,
              winningType: pattern.winningType,
              payout,
              poolBeforePayout,
            },
          });
        } catch (err) {
          logger.warn(
            { err, gameId: game.id, claimId: claim.id, houseDeficit },
            "HOUSE_DEFICIT ledger-event feilet (best-effort) — payout fortsetter",
          );
        }
      }
      await this.payoutAudit.appendPayoutAuditEvent({
        kind: "CLAIM_PRIZE",
        claimId: claim.id,
        gameId: game.id,
        roomCode: room.code,
        hallId: room.hallId,
        policyVersion: policy.id,
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
    claim.payoutPolicyVersion = policy.id;
    claim.payoutWasCapped = payout < prizePerWinner;
    claim.rtpBudgetBefore = rtpBudgetBefore;
    claim.rtpBudgetAfter = rtpBudgetAfter;
    // RTP-cap-bug-fix 2026-04-29: cap-flagget settes ALLTID når payout faktisk
    // er capped under requestedAfterPolicyAndPool. Tidligere ble fixed-prize
    // bypass-et — det førte til at prod-loggen viste rtpCapped=false selv når
    // payout=100 mot et budsjett på 80 (game `057c0502`).
    claim.rtpCapped = rtpCapped;
    // RTP-cap-bug-fix 2026-04-29: speil faktisk paid amount på patternResult
    // og claimId-link slik at klient/audit ser korrekt payout. Tidligere
    // skrev `evaluateActivePhase` over med `prizePerWinner` (pre-cap) etter
    // dette kallet — vi setter her, og eval-pathen respekterer eksisterende
    // verdi via "set kun hvis udefinert"-logikken.
    patternResult.payoutAmount = payout;
    patternResult.claimId = claim.id;
    if (payoutWasSkipped) {
      claim.payoutSkipped = true;
      if (payoutSkippedReason) {
        claim.payoutSkippedReason = payoutSkippedReason;
      }
      patternResult.payoutSkipped = true;
      if (payoutSkippedReason) {
        patternResult.payoutSkippedReason = payoutSkippedReason;
      }
      // INFO-logg så ops umiddelbart ser at fasen vant uten utbetaling.
      logRoomEvent(
        logger,
        {
          roomCode: room.code,
          gameId: game.id,
          patternId: patternResult.patternId,
          patternName: pattern.name,
          claimId: claim.id,
          playerId: player.id,
          configuredFaceValue: prizePerWinner,
          requestedAfterPolicyAndPool,
          remainingBudget: rtpBudgetBefore,
          houseAvailableBalance: Number.isFinite(houseAvailableBalance)
            ? houseAvailableBalance
            : null,
          reason: payoutSkippedReason,
        },
        "game.pattern.payout-skipped",
      );
    } else {
      // Standard pattern.won INFO-log — én linje per fase-win for ops-grep.
      logRoomEvent(
        logger,
        {
          roomCode: room.code,
          gameId: game.id,
          patternId: patternResult.patternId,
          patternName: pattern.name,
          claimId: claim.id,
          winnerId: player.id,
          payoutAmount: payout,
          rtpCapped: claim.rtpCapped,
          faceValue: prizePerWinner,
        },
        "game.pattern.won",
      );
    }

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
    // HIGH-5: per-room mutex. To parallelle `draw:next` mot samme rom
    // skal aldri begge mutere `currentGame.drawBag`. Hvis lock pågår,
    // reject med rate-limit-aktig DomainError istedenfor å queue (queue
    // ville økt latency + risiko for back-to-back duplikat-draws hvis
    // klienten retry'er).
    const lockKey = input.roomCode.trim().toUpperCase();
    const inFlight = this.drawLocksByRoom.get(lockKey);
    if (inFlight !== undefined) {
      throw new DomainError(
        "DRAW_IN_PROGRESS",
        "Et annet trekk for dette rommet pågår allerede. Vent til det er ferdig.",
      );
    }
    const drawPromise = this._drawNextNumberLocked(input);
    this.drawLocksByRoom.set(lockKey, drawPromise);
    try {
      return await drawPromise;
    } finally {
      // Kun fjern hvis det fortsatt er VÅR promise — defensiv mot
      // teoretisk race der destroyRoom har kjørt og en ny lock kunne
      // vært satt (kan ikke skje med dagens API, men billig å sjekke).
      if (this.drawLocksByRoom.get(lockKey) === drawPromise) {
        this.drawLocksByRoom.delete(lockKey);
      }
    }
  }

  /**
   * HIGH-5: faktisk draw-implementasjon. Kalles kun fra
   * {@link drawNextNumber} som holder per-room-mutex rundt dette.
   */
  private async _drawNextNumberLocked(input: DrawNextInput): Promise<{ number: number; drawIndex: number; gameId: string }> {
    const room = this.requireRoom(input.roomCode);
    // CRIT-4: scheduled Spill 1 må trekkes via Game1DrawEngineService.
    // Defensiv guard mot dual-engine state-divergens.
    this.assertNotScheduled(room);
    // K3: production retail Spill 1 må kjøre via scheduled-engine.
    this.assertSpill1NotAdHoc(room);
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
      // PHASE3-FIX (2026-04-27): Last-chance også her, symmetri med
      // MAX_DRAWS-grenen post-draw nedenfor. Defense-in-depth.
      const variantConfigForPreDrawMax = this.variantConfigByRoom.get(room.code);
      if (variantConfigForPreDrawMax?.autoClaimPhaseMode) {
        try {
          await this.evaluateActivePhase(room, game);
        } catch (err) {
          logger.error(
            { err, gameId: game.id, roomCode: room.code },
            "[PHASE3-FIX] last-chance evaluateActivePhase failed in pre-draw MAX_DRAWS",
          );
        }
      }
      if ((game.status as string) === "RUNNING") {
        const endedAtMs = Date.now();
        const endedAt = new Date(endedAtMs);
        game.status = "ENDED";
        game.endedAt = endedAt.toISOString();
        game.endedReason = "MAX_DRAWS_REACHED";
        await this.finishPlaySessionsForGame(room, game, endedAtMs);
        // HOEY-6/BIN-248: Write GAME_END checkpoint for MAX_DRAWS_REACHED
        await this.writeGameEndCheckpoint(room, game);
      }
      throw new DomainError("NO_MORE_NUMBERS", `Maks antall trekk (${this.maxDrawsPerRound}) er nådd.`);
    }

    const nextNumber = game.drawBag.shift();
    if (!nextNumber) {
      // PHASE3-FIX (2026-04-27): Last-chance evaluateActivePhase også her
      // — symmetri med MAX_DRAWS_REACHED-grenen lenger ned. Hvis siste
      // trukne ball fullførte alle phaser men recursion ble avbrutt før
      // neste fase ble vunnet, gir vi det én siste sjanse.
      const variantConfigForBagEmpty = this.variantConfigByRoom.get(room.code);
      if (variantConfigForBagEmpty?.autoClaimPhaseMode) {
        try {
          await this.evaluateActivePhase(room, game);
        } catch (err) {
          logger.error(
            { err, gameId: game.id, roomCode: room.code },
            "[PHASE3-FIX] last-chance evaluateActivePhase failed before DRAW_BAG_EMPTY",
          );
        }
      }
      // Re-sjekk status: hvis Phase 5 vant, ikke overskriv BINGO_CLAIMED.
      if ((game.status as string) === "RUNNING") {
        const endedAtMs = Date.now();
        const endedAt = new Date(endedAtMs);
        game.status = "ENDED";
        game.endedAt = endedAt.toISOString();
        game.endedReason = "DRAW_BAG_EMPTY";
        await this.finishPlaySessionsForGame(room, game, endedAtMs);
        // HOEY-6/BIN-248: Write GAME_END checkpoint for DRAW_BAG_EMPTY
        await this.writeGameEndCheckpoint(room, game);
      }
      throw new DomainError("NO_MORE_NUMBERS", "Ingen tall igjen i trekken.");
    }

    game.drawnNumbers.push(nextNumber);
    // LIVE_ROOM_OBSERVABILITY 2026-04-29: per-draw INFO-log. Default-på via
    // BINGO_VERBOSE_ROOM_LOGS — kan slås AV (eks. for batch-rerun-tester) hvis
    // log-volum blir et problem. drawIndex er 1-basert (matcher socket-payload).
    // `source` settes på socket/scheduler-laget — engine selv vet ikke om det
    // var auto vs manual draw.
    logRoomEvent(
      logger,
      {
        roomCode: room.code,
        gameId: game.id,
        drawIndex: game.drawnNumbers.length,
        number: nextNumber,
      },
      "game.draw",
    );
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
    let variantConfigForDraw = this.variantConfigByRoom.get(room.code);
    // VARIANT-CONFIG GUARD: defense-in-depth (Tobias 2026-04-27, narrowed 2026-04-27)
    //
    // Etter Render-restart (eller ethvert in-memory cache-tap) kan
    // `variantConfigByRoom` være helt tom for et eksisterende rom som
    // fortsatt tar imot `drawNextNumber`-call. For Spill 1 (`bingo` /
    // `game_1`) ville dette gjort at `autoClaimPhaseMode` ikke kjørte →
    // 3-fase auto-claim (BIN-694) ville stille feilet, og
    // `evaluateActivePhase` ville aldri markert vinnere. Vi velger
    // fail-loud + auto-bind kun ved cache-miss:
    //
    //   1. Logger CRIT-event slik at ops kan se at fallback brukes.
    //   2. Setter inn `DEFAULT_NORSK_BINGO_CONFIG` så draw-flyten kan
    //      fortsette med korrekt variant-config istedenfor å degrade
    //      til standard-mode uten fasestyring.
    //
    // VIKTIG: guarden fyrer KUN når `variantConfigForDraw` er helt
    // undefined (cache-miss). Hvis operator har satt en valid config
    // med `autoClaimPhaseMode=false` (f.eks. for testing av custom
    // mode), respekteres den — guarden skal aldri overstyre operator-
    // satt config stille.
    //
    // Andre spill (rocket/monsterbingo/spillorama) skipper auto-bind —
    // de har sin egen variant-config og skal ikke få Spill 1-default.
    if (
      (room.gameSlug === "bingo" || room.gameSlug === "game_1") &&
      !variantConfigForDraw
    ) {
      logger.error(
        {
          roomCode: room.code,
          gameId: game.id,
          gameSlug: room.gameSlug,
          hasConfig: false,
        },
        "[CRIT] VARIANT_CONFIG_AUTO_BOUND — Spill 1 room mangler variantConfig (cache-miss), auto-binder DEFAULT_NORSK_BINGO_CONFIG",
      );
      this.variantConfigByRoom.set(room.code, variantConfigModule.DEFAULT_NORSK_BINGO_CONFIG);
      this.variantGameTypeByRoom.set(room.code, "bingo");
      variantConfigForDraw = variantConfigModule.DEFAULT_NORSK_BINGO_CONFIG;
    }
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
    // FULLTHUS-FIX (2026-04-27): Phase 5 (Fullt Hus) MÅ vinnes hvis alle
    // 75 baller er trukket — for 75-ball bingo dekker drawnSet alltid hele
    // 5×5-grid (kun cell 0 er free centre). Hvis `evaluateActivePhase`
    // over har lagt evaluering bak ENDED-flag for Phase 5, må vi IKKE
    // overskrive `game.endedReason` med MAX_DRAWS_REACHED.
    //
    // ROOT CAUSE: før denne fixen overskrev MAX_DRAWS_REACHED-blokken
    // ubetinget `game.status="ENDED"` og `game.endedReason` selv om
    // Phase 5 nettopp hadde satt `BINGO_CLAIMED`. User-rapportert bug
    // 2026-04-27: ad-hoc bingo der user vant 1-4 Rader, men Fullt Hus
    // forble won=False fordi MAX_DRAWS_REACHED skrev over BINGO_CLAIMED-
    // status fra evaluateActivePhase i samme drawNextNumber-call.
    //
    // Defensiv tiltak: hvis `evaluateActivePhase` ikke fikk fullført
    // Phase 5 (f.eks. transient ledger-feil ble swallowed av try/catch
    // over), kjør én siste evaluering FØR vi ender med MAX_DRAWS. Dette
    // er trygt: hvis Phase 5 ikke kan vinnes (ingen tickets med fullt
    // hus), returnerer evaluateActivePhase uten side-effekter.
    if (game.drawnNumbers.length >= this.maxDrawsPerRound && game.status === "RUNNING") {
      // Last-chance Phase 5 evaluation before MAX_DRAWS_REACHED. Hvis
      // evaluateActivePhase tidligere kastet en transient feil, gir vi
      // det én siste sjanse her — særlig viktig på ball 75 der ALL non-
      // free celler i 5×5-grid garantert er dekket av drawnSet.
      if (variantConfigForDraw?.autoClaimPhaseMode) {
        try {
          await this.evaluateActivePhase(room, game);
        } catch (err) {
          logger.error(
            { err, gameId: game.id, roomCode: room.code },
            "[FULLTHUS-FIX] last-chance evaluateActivePhase failed before MAX_DRAWS",
          );
        }
      }
    }
    // Re-sjekk status: hvis Phase 5 vant i evaluateActivePhase (enten
    // det første kallet over eller last-chance-kallet), er game.status
    // allerede "ENDED" med endedReason="BINGO_CLAIMED". Da MÅ vi IKKE
    // overskrive til MAX_DRAWS_REACHED.
    if (game.drawnNumbers.length >= this.maxDrawsPerRound && game.status === "RUNNING") {
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
    // K2-A CRIT-1: per-spill resolver. Spill 1 (slug `bingo`) → MAIN_GAME.
    const gameType: LedgerGameType = ledgerGameTypeForSlug(room.gameSlug);
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

  /**
   * F2-B (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §3.3 / HV-3): submission-flow
   * extracted to {@link ClaimSubmitterService.submitClaim}. This method is
   * now a thin delegate so:
   *   - Public API (and Game2Engine/Game3Engine inheritance) stays unchanged.
   *   - The engine still owns `requireRoom` + `requireRunningGame` lookups so
   *     the service receives validated references rather than a raw roomCode.
   *
   * The service handles validation (idempotency, armed-guard, KYC-block),
   * pattern-match (LINE/BINGO), cap-and-transfer via PhasePayoutService,
   * state mutations on `claim`/`game`/`patternResult`, and the post-transfer
   * audit-trail (compliance, ledger, payoutAudit, checkpoint, rooms.persist)
   * with CRIT-6 recovery-port event-emission on each step.
   *
   * Behavior is byte-identical to the pre-extraction inline implementation —
   * same idempotency-keys, same ledger-ordering, same logging fields. PR #741
   * test-hall semantics (LINE-bypass, BINGO ends round) and PILOT-EMERGENCY
   * 2026-04-28 (state-mutation regardless of payout) are preserved.
   */
  async submitClaim(input: SubmitClaimInput): Promise<ClaimRecord> {
    const room = this.requireRoom(input.roomCode);
    const game = this.requireRunningGame(room);
    return this.claimSubmitterService.submitClaim({
      room,
      game,
      playerId: input.playerId,
      type: input.type,
    });
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
   * Read the current mini-game state for a room without mutating anything.
   *
   * Tobias prod-incident 2026-04-29: Socket-laget bruker dette etter
   * `drawNextNumber` for å detektere at `evaluateActivePhase` aktiverte
   * mini-game (Fullt Hus auto-claim → `onAutoClaimedFullHouse` →
   * `activateMiniGameHelper`). Sammenlignes med pre-draw-snapshot for å
   * sende `minigame:activated` til vinneren via wallet-rommet.
   *
   * Returnerer null hvis rommet ikke finnes eller hvis ingen mini-game
   * er aktiv på currentGame. Kaster ikke — fail-soft for socket-laget.
   */
  getCurrentMiniGame(roomCode: string): MiniGameState | null {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return null;
    return room.currentGame?.miniGame ?? null;
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
      // Hot-fix Tobias 2026-04-26: ad-hoc engine wallet-refresh-paritet.
      // BingoEngineMiniGames.spinJackpot/playMiniGame kaller denne etter
      // wallet-transfer i stedet for `player.balance += payout`. Bound
      // her så modulen ikke trenger en privat ref til engine-instansen.
      refreshPlayerBalancesForWallet: (walletId) =>
        this.refreshPlayerBalancesForWallet(walletId),
    };
  }

  async endGame(input: EndGameInput): Promise<void> {
    const room = this.requireRoom(input.roomCode);
    // CRIT-4: scheduled Spill 1 har egen end-flyt via Game1MasterControlService.
    this.assertNotScheduled(room);
    // K3: production retail Spill 1 ende-flyt ligger i scheduled-engine.
    this.assertSpill1NotAdHoc(room);
    this.assertHost(room, input.actorPlayerId);
    const host = this.requirePlayer(room, input.actorPlayerId);
    this.assertWalletAllowedForGameplay(host.walletId, Date.now());
    const game = this.requireRunningGame(room);

    // PHASE3-FIX (2026-04-27): Før vi markerer ENDED, kjør last-chance
    // evaluateActivePhase slik at evt. fase 3+ som er fullført basert på
    // allerede-trukne baller blir registrert. Hvis spilleren f.eks. har
    // Fullt Hus etter siste auto-draw, men endGame kalles før recursion
    // rakk neste fase, ville bug-rapport "1+2 vant, 3+4+FH ikke vunnet"
    // matche scenarioet. Trygt: evaluateActivePhase er idempotent og
    // returnerer no-op hvis ingen brett oppfyller fasen.
    const variantConfigForEnd = this.variantConfigByRoom.get(room.code);
    if (variantConfigForEnd?.autoClaimPhaseMode && game.status === "RUNNING") {
      try {
        await this.evaluateActivePhase(room, game);
      } catch (err) {
        logger.error(
          { err, gameId: game.id, roomCode: room.code },
          "[PHASE3-FIX] last-chance evaluateActivePhase failed in endGame",
        );
      }
    }

    // Hvis last-chance Phase 5 nettopp avsluttet runden med
    // BINGO_CLAIMED, må vi IKKE overskrive til MANUAL_END.
    if (game.status === "RUNNING") {
      const endedAtMs = Date.now();
      const endedAt = new Date(endedAtMs);
      game.status = "ENDED";
      game.endedAt = endedAt.toISOString();
      game.endedReason = input.reason?.trim() || "MANUAL_END";
      await this.finishPlaySessionsForGame(room, game, endedAtMs);
      // BIN-48/BIN-248: Synchronous checkpoint after game end
      await this.writeGameEndCheckpoint(room, game);
    }
  }

  // ── BIN-460: Game pause/resume ─────────────────────────────────────────────

  /**
   * MED-11: pause-payload utvidet med `pauseUntil` (estimert resume-tid, ISO)
   * og `pauseReason` (maskinlesbar grunn). Begge er valgfrie. Når `pauseUntil`
   * er satt vil klient vise countdown; ellers viser klient en fallback-tekst
   * basert på `pauseReason`.
   */
  pauseGame(
    roomCode: string,
    message?: string,
    options?: { pauseUntil?: string; pauseReason?: string }
  ): void {
    const room = this.requireRoom(roomCode);
    // CRIT-4: scheduled Spill 1 har egen pause-flyt via Game1MasterControlService.
    this.assertNotScheduled(room);
    // K3: production retail Spill 1 pause-flyt ligger i scheduled-engine.
    this.assertSpill1NotAdHoc(room);
    const game = this.requireRunningGame(room);
    if (game.isPaused) throw new DomainError("GAME_ALREADY_PAUSED", "Spillet er allerede pauset.");
    game.isPaused = true;
    game.pauseMessage = message ?? "Spillet er pauset av admin";
    game.pauseUntil = options?.pauseUntil;
    game.pauseReason = options?.pauseReason;
    logger.info(
      {
        roomCode,
        gameId: game.id,
        pauseUntil: game.pauseUntil,
        pauseReason: game.pauseReason,
      },
      "Game paused"
    );
  }

  resumeGame(roomCode: string): void {
    const room = this.requireRoom(roomCode);
    // CRIT-4: scheduled Spill 1 har egen resume-flyt via Game1MasterControlService.
    this.assertNotScheduled(room);
    // K3: production retail Spill 1 resume-flyt ligger i scheduled-engine.
    this.assertSpill1NotAdHoc(room);
    const game = this.requireRunningGame(room);
    if (!game.isPaused) throw new DomainError("GAME_NOT_PAUSED", "Spillet er ikke pauset.");
    game.isPaused = false;
    game.pauseMessage = undefined;
    game.pauseUntil = undefined;
    game.pauseReason = undefined;
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

  /**
   * Bug A fix (Tobias 2026-04-28): refresh `RoomState.isTestHall` for et
   * eksisterende rom. Brukes av socket-laget i `room:create`/`room:join`-
   * flytene NÅR det kanoniske rommet allerede eksisterer — uten denne
   * "sticker" en gammel `isTestHall=undefined` (rom skapt før PR #671)
   * eller en stale `isTestHall=true` (hvis admin senere fjerner test-
   * flagget i DB).
   *
   * No-op hvis verdien allerede matcher. Idempotent.
   *
   * Sikkerhetsregel: vi gjør IKKE noe annet her enn å sette flagget. Ingen
   * draws, claims eller wallet-mutasjoner — så det er trygt å kalle fra
   * join-stier som allerede har gjort sin authoritative wallet-validering.
   */
  setRoomTestHall(roomCode: string, isTestHall: boolean): void {
    const room = this.rooms.get(roomCode.trim().toUpperCase());
    if (!room) return; // fail-soft: room kan være ryddet i mellomtiden
    if (isTestHall) {
      if (room.isTestHall !== true) {
        room.isTestHall = true;
        this.syncRoomToStore(room);
      }
    } else if (room.isTestHall === true) {
      room.isTestHall = undefined;
      this.syncRoomToStore(room);
    }
  }

  /**
   * PILOT-STOP-SHIP fix (Tobias 2026-04-27): refresh `RoomState.isHallShared`
   * for et eksisterende rom. Brukes av `game1ScheduledEvents.ts` når et
   * scheduled multi-hall-spill joines mens rommet allerede eksisterer
   * (skapt før deploy, eller skapt av Hall A før Hall B prøver å joine).
   *
   * Uten denne setteren beholder rommet `room.hallId = master-hall` og
   * `joinRoom` kaster HALL_MISMATCH for spillere fra andre haller i samme
   * gruppe — selv om scheduled-spillet eksplisitt har dem i
   * `participating_halls_json`.
   *
   * Speilbilde av {@link setRoomTestHall} — samme idempotente fail-soft-
   * pattern. Ingen wallet- eller draw-mutasjoner her.
   *
   * No-op hvis verdien allerede matcher. Idempotent.
   */
  setRoomHallShared(roomCode: string, isHallShared: boolean): void {
    const room = this.rooms.get(roomCode.trim().toUpperCase());
    if (!room) return; // fail-soft: room kan være ryddet i mellomtiden
    if (isHallShared) {
      if (room.isHallShared !== true) {
        room.isHallShared = true;
        this.syncRoomToStore(room);
      }
    } else if (room.isHallShared === true) {
      room.isHallShared = undefined;
      this.syncRoomToStore(room);
    }
  }

  /**
   * Bug B fix (Tobias 2026-04-28): finn et rom basert på eksakt rom-kode.
   * I motsetning til `getPrimaryRoomForHall` filtrerer vi IKKE på hallId —
   * canonical-flyten (Spill 1 group-of-halls, Spill 2/3 globale rom)
   * bruker rom-koden som single-source-of-truth, ikke `room.hallId`.
   *
   * Returnerer `null` hvis rommet ikke finnes — caller (room:create-
   * handler) skal da opprette nytt rom med samme kanonisk-kode.
   *
   * Returnerer en lett snapshot (RoomSummary), IKKE rå `RoomState`.
   * Caller henter fullt snapshot via `getRoomSnapshot(code)` etterpå hvis
   * de trenger spillere/tickets/etc.
   */
  findRoomByCode(roomCode: string): RoomSummary | null {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return null;
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
      gameStatus,
    };
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
    // K2 (2026-04-29) — FORHANDSKJOP §7.5: pre-K2 destroyRoom evicted from
    // engine.rooms but never touched RoomStateManager / lifecycleStore,
    // leaving armed-state + reservation-mappings + arm-cycle stranded
    // until process restart. Now we evict each player atomically before
    // deleting the room, releasing any orphan reservations along the way.
    if (this.lifecycleStore) {
      for (const player of room.players.values()) {
        this.releaseAndForgetEviction(code, player.id, player.walletId);
      }
      // Clear arm-cycle for the room (no public API for this — disarm-all
      // via the store handles it as a side effect).
      void this.lifecycleStore.disarmAllPlayers({ roomCode: code });
    }
    this.rooms.delete(code);
    this.roomLastRoundStartMs.delete(code);
    this.lastDrawAtByRoom.delete(code);
    this.drawLocksByRoom.delete(code); // HIGH-5
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

  /**
   * PILOT-STOP-SHIP fix (Code Review #5 P0-1): public wrapper rundt
   * `ComplianceManager.wouldExceedLossLimit` slik at REST/socket-routes
   * kan gate purchases før de når wallet-debit. `entryFeeNok` er i NOK
   * (ikke øre) for å matche ComplianceManagers signatur. `hallId` MÅ være
   * kjøpe-hallen (ikke master-hallen) per §71 pengespillforskriften.
   *
   * Brukes av `/api/game1/purchase` for å blokkere selvutestengt +
   * frivillig pause + obligatorisk pause + loss-limit-breach FØR
   * wallet-debit.
   */
  wouldExceedLossLimit(
    walletIdInput: string,
    entryFeeNok: number,
    hallId: string,
    nowMs = Date.now()
  ): boolean {
    return this.compliance.wouldExceedLossLimit(walletIdInput, entryFeeNok, nowMs, hallId);
  }

  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): public wrapper rundt
   * `ComplianceManager.calculateMaxAffordableTickets` slik at socket-
   * laget (`bet:arm`) kan beregne partial-buy uten å ta direkte
   * avhengighet til `compliance`-feltet (som er `protected`).
   *
   * Pengespillforskriften §22: hall-scope-d. Caller MÅ sende kjøpe-hallen.
   *
   * Returnerer samme shape som ComplianceManager — se den for full doc.
   */
  calculateMaxAffordableTickets(
    walletIdInput: string,
    hallId: string,
    ticketUnitPrices: number[],
    nowMs: number,
    existingReservedAmount = 0,
  ): ReturnType<ComplianceManager["calculateMaxAffordableTickets"]> {
    return this.compliance.calculateMaxAffordableTickets(
      walletIdInput,
      hallId,
      ticketUnitPrices,
      nowMs,
      existingReservedAmount,
    );
  }

  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): public read-only access til
   * netto-tap + effektive grenser. Brukes av socket-laget for å bygge
   * `lossState` payloads i bet:arm-acks og bet:rejected/wallet:loss-
   * state-events.
   */
  getLossLimitState(walletIdInput: string, hallId: string, nowMs = Date.now()): {
    dailyUsed: number;
    dailyLimit: number;
    monthlyUsed: number;
    monthlyLimit: number;
  } {
    const limits = this.compliance.getEffectiveLossLimits(walletIdInput, hallId, nowMs);
    const netLoss = this.compliance.calculateNetLoss(walletIdInput, nowMs, hallId);
    return {
      dailyUsed: Math.max(0, netLoss.daily),
      dailyLimit: limits.daily,
      monthlyUsed: Math.max(0, netLoss.monthly),
      monthlyLimit: limits.monthly,
    };
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
    logRoomEvent(
      logger,
      { roomCode: room.code, playerId, socketId, walletId: player.walletId },
      "room.player.attached",
    );
  }

  detachSocket(socketId: string): { roomCode: string; playerId: string } | null {
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.socketId === socketId) {
          // Bug 2 fix-strategi: vi gjør IKKE noe aggressivt her — kun
          // markerer socketId som ubundet. Selve cleanup (fjerne stale
          // walletId-binding fra IDLE-rom) skjer ved re-connect via
          // `cleanupStaleWalletInIdleRooms` i `room:create`/`room:join`.
          //
          // Hvorfor: hvis vi fjerner spilleren her ved disconnect, mister
          // vi armed-state, lucky-numbers og ticket-buy-in for spillere
          // som reconnecter til samme rom mens andre spillere fortsatt
          // er der (canonical-room-pathen i roomEvents.ts:189-215). Cleanup
          // ved re-connect (i stedet for ved disconnect) gir robust
          // re-join uten å miste noe state.
          //
          // Regulatorisk: ingen wallet-mutasjon her. Vi setter kun
          // socketId=undefined så reconnect kan kalle attachPlayerSocket.
          player.socketId = undefined;
          logRoomEvent(
            logger,
            { roomCode: room.code, playerId: player.id, socketId, walletId: player.walletId },
            "room.player.detached",
          );
          return { roomCode: room.code, playerId: player.id };
        }
      }
    }
    return null;
  }

  /**
   * Bug 2 fix (re-join robustness): rydd opp stale walletId-binding i rom
   * som er IDLE/NONE. Brukes av `room:create`/`room:join`-handlerne før
   * de prøver å opprette/joine et rom — slik at en spiller som er
   * "stuck" i et gammelt ad-hoc-rom (uten aktiv runde og uten socket)
   * ikke blokkerer ny binding via `assertWalletNotInRunningGame` eller
   * `assertWalletNotAlreadyInRoom`.
   *
   * Sikkerhetsregel: vi fjerner KUN spillere uten aktiv socket fra rom
   * hvor det IKKE pågår en runde. RUNNING/WAITING-rom rør vi aldri her
   * — der må reconnecten gå via `attachPlayerSocket` så pågående
   * buy-in/wallet-state er trygg.
   *
   * **K2 (2026-04-29)** — atomic eviction via `lifecycleStore`:
   * When `lifecycleStore` is wired (production), eviction routes through
   * `lifecycleStore.evictPlayer({ releaseReservation: true })` which
   * atomically clears armed-state, ticket-selections, and reservation-
   * mapping AND surfaces the released reservation-id so the wallet
   * reservation row is released against the wallet adapter. This
   * supersedes the PR #724 `isPreserve`-callback shim — eviction is now
   * correct by construction (orphans cannot occur because the cleanup
   * always releases the reservation).
   *
   * Backward-compat: the legacy `isPreserve` option is still accepted
   * but ignored when `lifecycleStore` is wired (the new path is strictly
   * stronger — it ALWAYS handles armed players safely). When
   * `lifecycleStore` is NOT wired (test harnesses), the legacy PR #724
   * preserve-skip behavior remains so we don't regress test coverage.
   *
   * Returnerer antall rom hvor opprydding ble utført (mest for
   * observability + tester).
   *
   * Reference: docs/audit/REFACTOR_AUDIT_PRE_PILOT_2026-04-29.md §2.2 + §6 K2.
   * Reference: docs/audit/FORHANDSKJOP_BUG_ROOT_CAUSE_2026-04-29.md §7.1 (RESOLVED).
   */
  cleanupStaleWalletInIdleRooms(
    walletId: string,
    options?: {
      exceptRoomCode?: string;
      /**
       * @deprecated K2 — kept for backward-compat with test harnesses
       * that don't wire `lifecycleStore`. When `lifecycleStore` is
       * wired (production), this callback is IGNORED — eviction
       * always releases reservations atomically, so preserve-skip is
       * no longer needed.
       */
      isPreserve?: (roomCode: string, playerId: string) => boolean;
    },
  ): number;
  /** @deprecated Use the options-form. The legacy 2-arg form is kept for
   *  backward-compat with admin-tooling and existing tests; it does NOT
   *  preserve armed/reservation state when `lifecycleStore` is unwired. */
  cleanupStaleWalletInIdleRooms(walletId: string, exceptRoomCode?: string): number;
  cleanupStaleWalletInIdleRooms(
    walletId: string,
    arg2?: string | { exceptRoomCode?: string; isPreserve?: (roomCode: string, playerId: string) => boolean },
  ): number {
    const normalizedWalletId = walletId.trim();
    if (!normalizedWalletId) return 0;
    // Resolve options vs. legacy-string overload. Strings remain the
    // deprecated path (no preserve check); object form is the modern one.
    const opts: { exceptRoomCode?: string; isPreserve?: (roomCode: string, playerId: string) => boolean } =
      typeof arg2 === "string"
        ? { exceptRoomCode: arg2 }
        : arg2 ?? {};
    const exceptCode = opts.exceptRoomCode?.trim().toUpperCase();
    // K2: when lifecycleStore is wired, the preserve-callback is obsolete
    // because eviction now atomically releases reservations. Tests that
    // run without the store fall back to the legacy preserve-skip path
    // so they don't regress.
    const useStore = this.lifecycleStore !== undefined;
    const isPreserve = useStore ? undefined : opts.isPreserve;
    let cleaned = 0;
    for (const room of this.rooms.values()) {
      if (exceptCode && room.code === exceptCode) continue;
      const isIdle =
        !room.currentGame || room.currentGame.status === "ENDED";
      if (!isIdle) continue;
      let mutated = false;
      for (const player of [...room.players.values()]) {
        if (player.walletId === normalizedWalletId && !player.socketId) {
          if (isPreserve && isPreserve(room.code, player.id)) {
            // FORHANDSKJOP-ORPHAN-FIX (PR 2): legacy preserve-skip path,
            // active only when `lifecycleStore` is unwired (test harness).
            logger.warn(
              {
                roomCode: room.code,
                playerId: player.id,
                walletId: normalizedWalletId,
                reason: "preserved-due-to-armed-or-reservation",
              },
              "cleanupStaleWalletInIdleRooms: preserved player with armed-state or active reservation (would have orphaned forhåndskjøp)",
            );
            logRoomEvent(
              logger,
              {
                roomCode: room.code,
                playerId: player.id,
                walletId: normalizedWalletId,
                reason: "armed",
              },
              "room.player.preserved",
            );
            continue;
          }
          // K2: when lifecycleStore is wired, atomically release any
          // wallet reservation + clear armed-state BEFORE we delete the
          // player record. The store call is async but we deliberately
          // fire-and-forget — the eviction must not block other room
          // mutations, and the wallet release adapter call is itself
          // idempotent (safe to retry from the orphan-sweep). Errors
          // are logged but don't abort the cleanup pass.
          if (this.lifecycleStore) {
            this.releaseAndForgetEviction(room.code, player.id, normalizedWalletId);
          }
          room.players.delete(player.id);
          mutated = true;
          cleaned += 1;
          logRoomEvent(
            logger,
            {
              roomCode: room.code,
              playerId: player.id,
              walletId: player.walletId,
              reason: "cleanupStale",
            },
            "room.player.evicted",
          );
        }
      }
      if (mutated) {
        this.syncRoomToStore(room);
      }
    }
    return cleaned;
  }

  /**
   * PILOT-EMERGENCY 2026-04-28 (Tobias): rydd stale wallet-bindinger fra
   * NON-CANONICAL rom uavhengig av runde-status. Dette er en mer aggressiv
   * variant av `cleanupStaleWalletInIdleRooms` som er nødvendig for Del B:
   *
   * Scenario: Hall A skapte rom `4RCQSX` (random `makeRoomCode()`-output)
   * FØR PR #677 lukket Bug B. Spiller binder seg til `4RCQSX` i runden, så
   * boot-sweep finner det som RUNNING og bevarer det. Når spilleren kobler
   * seg til via room:join → canonical `BINGO_<groupId>`, kaster
   * `assertWalletNotInRunningGame` PLAYER_ALREADY_IN_RUNNING_GAME fordi
   * 4RCQSX-rommet matcher walletId.
   *
   * Fix: ved room:join til en CANONICAL rom-kode, kall denne metoden for
   * å fjerne wallet-bindingen fra alle non-canonical rom — uansett status.
   * Filteret `isCanonicalCode` (se util/canonicalRoomCode.ts) sendes inn
   * så engine ikke får avhengighet til util-laget.
   *
   * Sikkerhetsregler:
   *   - Vi sletter KUN player-recordene (ikke selve rommet).
   *   - Vi sletter wallet-binding selv hvis socket fortsatt er attached
   *     (legacy-rom kan ha lekket socket-binding ved disconnect-flapping).
   *   - Canonical rom rør vi aldri her — caller har eget regelverk for dem.
   *
   * Returnerer antall player-records som ble fjernet (0 = ingen treff).
   */
  cleanupStaleWalletInNonCanonicalRooms(
    walletId: string,
    isCanonicalCode: (code: string) => boolean,
  ): number {
    const normalizedWalletId = walletId.trim();
    if (!normalizedWalletId) return 0;
    let cleaned = 0;
    for (const room of this.rooms.values()) {
      if (isCanonicalCode(room.code)) continue;
      let mutated = false;
      for (const player of [...room.players.values()]) {
        if (player.walletId === normalizedWalletId) {
          // K2 (2026-04-29): release any orphan reservation atomically
          // with the eviction. The non-canonical sweep is more aggressive
          // than the idle-room sweep (it evicts even with active socket),
          // so the orphan-risk is correspondingly higher — this is
          // exactly the §3.2 case in the FORHANDSKJOP audit.
          if (this.lifecycleStore) {
            this.releaseAndForgetEviction(room.code, player.id, normalizedWalletId);
          }
          room.players.delete(player.id);
          mutated = true;
          cleaned += 1;
          logRoomEvent(
            logger,
            {
              roomCode: room.code,
              playerId: player.id,
              walletId: player.walletId,
              reason: "cleanupNonCanonical",
            },
            "room.player.evicted",
          );
        }
      }
      if (mutated) {
        this.syncRoomToStore(room);
      }
    }
    return cleaned;
  }

  /**
   * K2 (2026-04-29) helper — evict atomically through `lifecycleStore`
   * and (when the wallet adapter exposes `releaseReservation`) release
   * any orphan reservation row in fire-and-forget fashion.
   *
   * The store call IS the source of truth for the in-memory state-space
   * cleanup — it returns synchronously from the caller's POV (we don't
   * await), but the per-room mutex guarantees the next mutation observes
   * the cleared state. The wallet release is async + idempotent —
   * adapter implementations swallow `INVALID_STATE` for already-released
   * rows, so duplicate calls from concurrent cleanup paths are safe.
   *
   * Errors here NEVER bubble up — the cleanup pass continues so we never
   * stall on an adapter hiccup. The async-orphan-release worker
   * (`WalletReservationExpiryService`) is the safety net for any rows
   * we couldn't release in-line.
   */
  private releaseAndForgetEviction(
    roomCode: string,
    playerId: string,
    walletId: string,
  ): void {
    if (!this.lifecycleStore) return;
    void this.lifecycleStore
      .evictPlayer({
        roomCode,
        playerId,
        releaseReservation: true,
        reason: "cleanupStale",
      })
      .then((result) => {
        if (result.releasedReservationId && this.walletAdapter.releaseReservation) {
          // Idempotent: adapter swallows INVALID_STATE for already-
          // released/committed rows. The release happens against the
          // wallet-reservation row in the DB.
          return this.walletAdapter
            .releaseReservation(result.releasedReservationId)
            .catch((err) => {
              logger.warn(
                {
                  err,
                  roomCode,
                  playerId,
                  walletId,
                  reservationId: result.releasedReservationId,
                },
                "releaseAndForgetEviction: wallet release failed (will be GC'd by expiry-tick)",
              );
            });
        }
        return undefined;
      })
      .catch((err) => {
        // Defensive: store mutation failed (mutex internal error or
        // similar). Log but don't block cleanup — next eviction will
        // observe the same state and try again.
        logger.error(
          { err, roomCode, playerId, walletId },
          "releaseAndForgetEviction: lifecycleStore.evictPlayer failed",
        );
      });
  }

  private archiveIfEnded(room: RoomState): void {
    if (room.currentGame?.status === "ENDED") {
      room.gameHistory.push(this.serializeGame(room.currentGame));
      room.currentGame = undefined;
    }
  }

  private async refreshPlayerObjectsFromWallet(players: Player[]): Promise<void> {
    // Saldo-flash deep-dive (Tobias 2026-04-26): bruk getAvailableBalance så
    // player.balance reflekterer det samme som header-chip viser. Tidligere
    // brukte vi getBalance() (gross) — det var lurking #499 §7. Ved game-start
    // kjørte refresh til gross, så player.balance -= playerBuyIn ga en lokal
    // verdi som ikke matchet hverken brutto eller available; emit-en med
    // gross-baseline forårsaket lobby-shellen å gjøre en feil ratio-split-
    // approximering basert på `availableDeposit` ulikt `depositBalance`.
    //
    // refreshPlayerBalancesForWallet (line 2608) bruker allerede
    // getAvailableBalance — denne endringen gir oss konsistens på tvers av
    // alle balance-update-paths.
    await Promise.all(
      players.map(async (player) => {
        player.balance = this.walletAdapter.getAvailableBalance
          ? await this.walletAdapter.getAvailableBalance(player.walletId)
          : await this.walletAdapter.getBalance(player.walletId);
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
    /**
     * Tobias 2026-04-29 (post-orphan-fix UX): per-player drop hook.
     * Fires SYNCHRONOUSLY in iteration-order for hver spiller som
     * filtreres ut. Caller (socket-laget) emitter `bet:rejected` til
     * spillerens wallet-rom slik at klienten kan fjerne pre-round-bonger
     * og vise klar feilmelding.
     *
     * Holdes som `() => Promise<void>` så caller kan await — men engine
     * fanger feil og fortsetter uansett (game-start må ALDRI blokkeres
     * av en fail-soft notification).
     */
    onPlayerRejected?: (input: {
      player: Player;
      reason:
        | "DAILY_LOSS_LIMIT_REACHED"
        | "MONTHLY_LOSS_LIMIT_REACHED"
        | "INSUFFICIENT_FUNDS";
      rejectedTicketCount: number;
      hallId: string;
    }) => void | Promise<void>,
    rejectedTicketCountByPlayerId?: Map<string, number>,
  ): Promise<Player[]> {
    const eligible: Player[] = [];
    for (const player of players) {
      if (entryFee > 0 && player.balance < entryFee) {
        if (onPlayerRejected) {
          try {
            await onPlayerRejected({
              player,
              reason: "INSUFFICIENT_FUNDS",
              rejectedTicketCount: rejectedTicketCountByPlayerId?.get(player.id) ?? 0,
              hallId,
            });
          } catch (err) {
            logger.warn(
              { err, playerId: player.id, walletId: player.walletId },
              "onPlayerRejected callback failed for INSUFFICIENT_FUNDS — engine continues",
            );
          }
        }
        continue;
      }
      if (this.compliance.wouldExceedLossLimit(player.walletId, entryFee, nowMs, hallId)) {
        if (onPlayerRejected) {
          // Skill daily vs monthly — caller wants to render the right
          // norsk-feilmelding. Recompute via netLoss + limits.
          const limits = this.compliance.getEffectiveLossLimits(
            player.walletId,
            hallId,
            nowMs,
          );
          const netLoss = this.compliance.calculateNetLoss(
            player.walletId,
            nowMs,
            hallId,
          );
          const reason: "DAILY_LOSS_LIMIT_REACHED" | "MONTHLY_LOSS_LIMIT_REACHED" =
            netLoss.daily + entryFee > limits.daily
              ? "DAILY_LOSS_LIMIT_REACHED"
              : "MONTHLY_LOSS_LIMIT_REACHED";
          try {
            await onPlayerRejected({
              player,
              reason,
              rejectedTicketCount: rejectedTicketCountByPlayerId?.get(player.id) ?? 0,
              hallId,
            });
          } catch (err) {
            logger.warn(
              { err, playerId: player.id, walletId: player.walletId, reason },
              "onPlayerRejected callback failed for loss-limit — engine continues",
            );
          }
        }
        continue;
      }
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

    // LIVE_ROOM_OBSERVABILITY 2026-04-29: structured INFO-log per round-end.
    // Beregner sum(payoutAmount) over claims for å gi ops total payout-snapshot
    // uten å måtte joine ledger.
    const totalPayout = game.claims.reduce(
      (sum, c) => sum + (c.payoutAmount ?? 0),
      0,
    );
    logRoomEvent(
      logger,
      {
        roomCode: room.code,
        gameId: game.id,
        hallId: room.hallId,
        endedReason: game.endedReason ?? "UNKNOWN",
        finalDrawCount: game.drawnNumbers.length,
        totalPayout,
        prizePool: game.prizePool,
        claimCount: game.claims.length,
      },
      "game.ended",
    );

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

  /**
   * CRIT-4 / HIGH-1 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26):
   *
   * Defensiv runtime-guard mot at scheduled Spill 1-rom blir mutert via
   * ad-hoc-pathen (`BingoEngine.startGame/drawNextNumber/evaluateActivePhase/
   * submitClaim`).
   *
   * Per `SPILL1_ENGINE_ROLES_2026-04-23.md`: scheduled Spill 1 (slug
   * `bingo` med `room.scheduledGameId !== null`) skal kun trekkes via
   * `Game1DrawEngineService`. Hvis BingoEngine likevel mutere disse
   * rommene oppstår dual-engine state-divergens og potensielt
   * dual-payout (se review CRIT-4).
   *
   * Spill 2 (slug `rocket`) og Spill 3 (slug `monsterbingo`) bruker
   * fortsatt ad-hoc engine — de påvirkes IKKE av denne guarden fordi
   * sjekken er begrenset til `gameSlug === "bingo"`.
   *
   * Bruksmønster: kall ved start av alle BingoEngine-mutasjons-metoder
   * som kan trigge wallet/state-skriv (drawNextNumber, submitClaim,
   * startGame, evaluateActivePhase).
   */
  private assertNotScheduled(room: RoomState): void {
    // Kun Spill 1 (`bingo`-slug) kan være scheduled. Spill 2/3 har egen
    // gameSlug og er alltid ad-hoc — guard skal være no-op for dem.
    if (room.gameSlug !== "bingo") {
      return;
    }
    if (room.scheduledGameId === null || room.scheduledGameId === undefined) {
      return;
    }
    throw new DomainError(
      "USE_SCHEDULED_API",
      "Scheduled Spill 1 må trekkes via Game1DrawEngineService — ikke BingoEngine.",
      {
        roomCode: room.code,
        scheduledGameId: room.scheduledGameId,
        gameSlug: room.gameSlug,
      }
    );
  }

  /**
   * Bølge K3 (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §2.1):
   *
   * Quarantine-guard: BingoEngine er nå Spill 2/3 + dev/test-only for
   * Spill 1. Production retail Spill 1 MÅ kjøre via Game1DrawEngineService
   * (scheduled-engine). Eneste unntak fra denne regelen er Demo Hall +
   * test-haller (`room.isTestHall === true`), som beholder ad-hoc-flyten
   * for ende-til-ende-test og demo-formål.
   *
   * Guard-logikk:
   *   1. Hvis `gameSlug !== "bingo"` → no-op (Spill 2/3 er ikke berørt).
   *   2. Hvis `isProductionRuntime === false` (tester, dev) → no-op.
   *   3. Hvis `room.isTestHall === true` (Demo Hall, test-haller) → no-op.
   *   4. Hvis `room.scheduledGameId` finnes → no-op (assertNotScheduled
   *      tar dette i en annen retning, men her er kombinasjonen "Spill 1 +
   *      ikke-scheduled + ikke-test-hall + production" som er problemet —
   *      ikke "scheduled" i seg selv).
   *   5. Ellers → kast `USE_SCHEDULED_API`. Den oppdagede call-paten må
   *      flytte til scheduled-engine eller markeres som test-hall.
   *
   * Forskjell fra `assertNotScheduled`:
   *   - `assertNotScheduled` blokkerer scheduled-Spill 1 fra å havne på
   *     ad-hoc-pathen (avslår «Game1DrawEngineService kjører via BingoEngine»).
   *   - `assertSpill1NotAdHoc` blokkerer ad-hoc-Spill 1 fra å havne på
   *     BingoEngine i production retail (avslår «BingoEngine kjører
   *     Spill 1 i prod uten scheduled-pathway»).
   *
   * Begge guarder kan fyre samtidig på et scheduled-rom — men hvis et rom
   * IKKE er scheduled OG IKKE er test-hall i prod, er det `assertSpill1NotAdHoc`
   * som rejekter.
   *
   * Bruksmønster: kall ved start av alle BingoEngine-mutasjons-metoder for
   * Spill 1 (startGame, drawNextNumber, submitClaim, payoutPhaseWinner,
   * pauseGame, resumeGame, endGame).
   */
  private assertSpill1NotAdHoc(room: RoomState): void {
    // 1. Spill 2/3 er IKKE quarantined — fortsetter på BingoEngine som før.
    if (room.gameSlug !== "bingo") {
      return;
    }
    // 2. Tester + dev-miljø beholder eksisterende ad-hoc-funksjonalitet.
    //    Det er kun production retail som tvinges over på scheduled.
    if (!this.isProductionRuntime) {
      return;
    }
    // 3. Demo Hall + test-haller (eksplisitt isTestHall=true) får
    //    fortsette på ad-hoc-pathen for end-to-end-test og demo-formål.
    if (room.isTestHall === true) {
      return;
    }
    // 4. Scheduled Spill 1 håndteres av `assertNotScheduled` (kalles før
    //    eller etter denne i metode-bodyene). Hvis room.scheduledGameId
    //    er satt, kaller `assertNotScheduled` allerede USE_SCHEDULED_API.
    //    Vi skipper her for å unngå dobbelt-kast og holde feilmeldingen
    //    klar (no-op-fallback om kall-rekkefølgen endres).
    if (room.scheduledGameId !== null && room.scheduledGameId !== undefined) {
      return;
    }
    // 5. Production retail Spill 1 uten scheduled-mapping og uten
    //    test-hall-flagg → rejekt.
    throw new DomainError(
      "USE_SCHEDULED_API",
      "Production Spill 1 må kjøres via Game1DrawEngineService (scheduled-engine). " +
        "BingoEngine er begrenset til Spill 2/3 + Demo Hall/test-haller.",
      {
        roomCode: room.code,
        gameSlug: room.gameSlug,
        hallId: room.hallId,
        isTestHall: room.isTestHall ?? false,
      }
    );
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
      pauseUntil: game.pauseUntil,
      pauseReason: game.pauseReason,
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
