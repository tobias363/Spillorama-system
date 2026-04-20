// ── Zod runtime schemas (BIN-545) ───────────────────────────────────────────
// Runtime-validated wire contracts for the three highest-risk socket payloads.
// Pattern: export both the schema (for .parse/.safeParse) and the z.infer<>-
// derived type (for compile-time use). Interfaces elsewhere remain unchanged —
// this file is the starting point; broader rollout is tracked separately.

import { z } from "zod";

// ── Primitive re-usables ────────────────────────────────────────────────────

const IsoDateString = z.string().min(1);
const ClaimType = z.enum(["LINE", "BINGO"]);
const GameStatus = z.enum(["WAITING", "RUNNING", "ENDED"]);

// ── BIN-646 (PR-B4): payment-request (deposit/withdraw-kø) ─────────────────

export const PaymentRequestKindSchema = z.enum(["deposit", "withdraw"]);
export const PaymentRequestStatusSchema = z.enum(["PENDING", "ACCEPTED", "REJECTED"]);
export const PaymentRequestDestinationTypeSchema = z.enum(["bank", "hall"]);

export const PaymentRequestSchema = z.object({
  id: z.string(),
  kind: PaymentRequestKindSchema,
  userId: z.string(),
  walletId: z.string(),
  amountCents: z.number().int(),
  hallId: z.string().nullable(),
  submittedBy: z.string().nullable(),
  status: PaymentRequestStatusSchema,
  rejectionReason: z.string().nullable(),
  acceptedBy: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  rejectedBy: z.string().nullable(),
  rejectedAt: z.string().nullable(),
  walletTransactionId: z.string().nullable(),
  destinationType: PaymentRequestDestinationTypeSchema.nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});

export type PaymentRequestKindT = z.infer<typeof PaymentRequestKindSchema>;
export type PaymentRequestStatusT = z.infer<typeof PaymentRequestStatusSchema>;
export type PaymentRequestDestinationTypeT = z.infer<typeof PaymentRequestDestinationTypeSchema>;
export type PaymentRequestT = z.infer<typeof PaymentRequestSchema>;

// ── Game-domain schemas (subset of packages/shared-types/src/game.ts) ───────

export const PlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  walletId: z.string(),
  balance: z.number(),
  socketId: z.string().optional(),
  hallId: z.string().optional(),
});

export const TicketSchema = z.object({
  grid: z.array(z.array(z.number().int())),
  /** BIN-509: stable id for pre-round (display) tickets. Optional for backward compat. */
  id: z.string().optional(),
  color: z.string().optional(),
  type: z.string().optional(),
  /** G15 (BIN-431): ticket-detail fields rendered on flip. All optional/non-breaking. */
  ticketNumber: z.string().optional(),
  hallName: z.string().optional(),
  supplierName: z.string().optional(),
  price: z.number().optional(),
  boughtAt: z.string().optional(),
});

export const PatternDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  claimType: ClaimType,
  prizePercent: z.number(),
  order: z.number().int(),
  design: z.number().int(),
});

export const PatternResultSchema = z.object({
  patternId: z.string(),
  patternName: z.string(),
  claimType: ClaimType,
  isWon: z.boolean(),
  winnerId: z.string().optional(),
  wonAtDraw: z.number().int().optional(),
  payoutAmount: z.number().optional(),
  claimId: z.string().optional(),
});

export const ClaimRecordSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  type: ClaimType,
  valid: z.boolean(),
  reason: z.string().optional(),
  winningPatternIndex: z.number().int().optional(),
  patternIndex: z.number().int().optional(),
  bonusTriggered: z.boolean().optional(),
  bonusAmount: z.number().optional(),
  payoutAmount: z.number().optional(),
  payoutPolicyVersion: z.string().optional(),
  payoutWasCapped: z.boolean().optional(),
  rtpBudgetBefore: z.number().optional(),
  rtpBudgetAfter: z.number().optional(),
  rtpCapped: z.boolean().optional(),
  payoutTransactionIds: z.array(z.string()).optional(),
  createdAt: IsoDateString,
});

export const GameSnapshotSchema = z.object({
  id: z.string(),
  status: GameStatus,
  entryFee: z.number(),
  ticketsPerPlayer: z.number().int(),
  prizePool: z.number(),
  remainingPrizePool: z.number(),
  payoutPercent: z.number(),
  maxPayoutBudget: z.number(),
  remainingPayoutBudget: z.number(),
  drawBag: z.array(z.number().int()),
  drawnNumbers: z.array(z.number().int()),
  remainingNumbers: z.number().int(),
  lineWinnerId: z.string().optional(),
  bingoWinnerId: z.string().optional(),
  patterns: z.array(PatternDefinitionSchema).optional(),
  patternResults: z.array(PatternResultSchema).optional(),
  claims: z.array(ClaimRecordSchema),
  tickets: z.record(z.string(), z.array(TicketSchema)),
  marks: z.record(z.string(), z.array(z.array(z.number().int()))),
  participatingPlayerIds: z.array(z.string()).optional(),
  isPaused: z.boolean().optional(),
  pauseMessage: z.string().optional(),
  isTestGame: z.boolean().optional(),
  startedAt: IsoDateString,
  endedAt: IsoDateString.optional(),
  endedReason: z.string().optional(),
});

export const RoomSnapshotSchema = z.object({
  code: z.string(),
  hallId: z.string(),
  hostPlayerId: z.string(),
  gameSlug: z.string().optional(),
  createdAt: IsoDateString,
  players: z.array(PlayerSchema),
  currentGame: GameSnapshotSchema.optional(),
  gameHistory: z.array(GameSnapshotSchema),
});

// ── Wire-contract schemas ───────────────────────────────────────────────────

export const TicketSelectionSchema = z.object({
  type: z.string(),
  qty: z.number().int().nonnegative(),
  /**
   * BIN-688: human-readable ticket-type name (e.g. "Small Yellow").
   * Optional for backward compat — clients that only send `type` still
   * work; colours will then fall back to sequential cycling.
   *
   * When present, the backend uses `name` to colour each generated
   * pre-round ticket, so the brett rendered in "Neste spill"-panelet
   * matches what the user actually selected.
   */
  name: z.string().optional(),
});
export type TicketSelection = z.infer<typeof TicketSelectionSchema>;

export const TicketTypeInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
  priceMultiplier: z.number(),
  ticketCount: z.number().int(),
  colors: z.array(z.string()).optional(),
});
export type TicketTypeInfo = z.infer<typeof TicketTypeInfoSchema>;

const GameVariantSchema = z.object({
  gameType: z.string(),
  ticketTypes: z.array(TicketTypeInfoSchema),
  replaceAmount: z.number().optional(),
  /**
   * F3 (BIN-431): Jackpot header info. Mirrors variantConfig.jackpot
   * (apps/backend/src/game/variantConfig.ts:59-66). Unity reference:
   * Game1GamePlayPanel.SocketFlow.cs:518-520 — renders
   * `{drawThreshold} Jackpot : {prize} kr` when isDisplay=true.
   */
  jackpot: z
    .object({
      drawThreshold: z.number().int(),
      prize: z.number(),
      isDisplay: z.boolean(),
    })
    .optional(),
  /**
   * Per-ticket entry fee for the room. Surfaced even when no game is
   * RUNNING so the buy popup can show real prices on first render.
   * Mirrors `currentGame.entryFee` mid-game; falls back to the room's
   * configured fee when between rounds.
   */
  entryFee: z.number().optional(),
});

/**
 * RoomUpdatePayload = RoomSnapshot intersected with the room:update metadata.
 * Zod doesn't model TS intersections directly, so we inline the RoomSnapshot
 * shape via .extend() on RoomSnapshotSchema. Any new field on RoomSnapshot
 * therefore flows through automatically.
 */
export const RoomUpdatePayloadSchema = RoomSnapshotSchema.extend({
  scheduler: z.record(z.string(), z.unknown()),
  preRoundTickets: z.record(z.string(), z.array(TicketSchema)),
  armedPlayerIds: z.array(z.string()),
  luckyNumbers: z.record(z.string(), z.number().int()),
  serverTimestamp: z.number().int(),
  playerStakes: z.record(z.string(), z.number()),
  gameVariant: GameVariantSchema.optional(),
});
export type RoomUpdatePayload = z.infer<typeof RoomUpdatePayloadSchema>;

export const DrawNewPayloadSchema = z.object({
  number: z.number().int(),
  drawIndex: z.number().int(),
  gameId: z.string(),
});
export type DrawNewPayload = z.infer<typeof DrawNewPayloadSchema>;

export const ClaimSubmitPayloadSchema = z.object({
  accessToken: z.string().optional(),
  roomCode: z.string().min(1),
  playerId: z.string().optional(),
  type: ClaimType,
});
export type ClaimSubmitPayload = z.infer<typeof ClaimSubmitPayloadSchema>;

/**
 * BIN-509: ticket:replace — swaps a single pre-round display ticket for a new
 * one and debits gameVariant.replaceAmount from the player's wallet. Only
 * permitted while the game is NOT running; armed state is preserved.
 */
export const TicketReplacePayloadSchema = z.object({
  accessToken: z.string().optional(),
  roomCode: z.string().min(1),
  playerId: z.string().optional(),
  ticketId: z.string().min(1),
});
export type TicketReplacePayload = z.infer<typeof TicketReplacePayloadSchema>;

/**
 * BIN-585: ticket:swap — free pre-round swap (Game 5 / Spillorama).
 * Same wire shape as ticket:replace, but the handler skips the wallet debit.
 * Gated by gameSlug so paid games continue to use ticket:replace.
 * Legacy alias: `SwapTicket` (Unity fallback-klient).
 */
export const TicketSwapPayloadSchema = z.object({
  accessToken: z.string().optional(),
  roomCode: z.string().min(1),
  playerId: z.string().optional(),
  ticketId: z.string().min(1),
});
export type TicketSwapPayload = z.infer<typeof TicketSwapPayloadSchema>;

/**
 * BIN-692: ticket:cancel — pre-round cancellation of a single armed ticket
 * or an entire bundle (Large = 3 brett, Elvis = 2, Traffic-light = 3).
 *
 * Semantics:
 *   - Only allowed while `currentGame.status !== "RUNNING"` — engine
 *     rejects with `GAME_RUNNING` otherwise.
 *   - When `ticketId` points into a bundle (ticket-type with
 *     `ticketCount > 1`), ALL brett in that bundle are removed together.
 *     One ×-click on a Large Yellow removes all 3 Large Yellow brett.
 *   - Pre-round stake is not yet debited (game:start does the buy-in),
 *     so cancellation is free — no wallet operation required. UI shows
 *     Innsats=0 immediately after the room:update broadcast.
 *   - If the last bundle for the player is cancelled, the player is
 *     fully disarmed (removed from `armedPlayerIds`).
 */
export const TicketCancelPayloadSchema = z.object({
  accessToken: z.string().optional(),
  roomCode: z.string().min(1),
  playerId: z.string().optional(),
  ticketId: z.string().min(1),
});
export type TicketCancelPayload = z.infer<typeof TicketCancelPayloadSchema>;

/**
 * BIN-585 PR D: admin:hall-balance — hall operator live view of the
 * house account balance(s) for a hall. Replaces legacy getHallBalance.
 * Requires admin auth via admin:login and ROOM_CONTROL_READ.
 */
export const AdminHallBalancePayloadSchema = z.object({
  accessToken: z.string().optional(),
  hallId: z.string().min(1),
});
export type AdminHallBalancePayload = z.infer<typeof AdminHallBalancePayloadSchema>;

export const AdminHallBalanceResponseSchema = z.object({
  hallId: z.string(),
  accounts: z.array(z.object({
    gameType: z.string(),
    channel: z.string(),
    accountId: z.string(),
    balance: z.number(),
  })),
  totalBalance: z.number(),
  at: z.number().int(),
});
export type AdminHallBalanceResponse = z.infer<typeof AdminHallBalanceResponseSchema>;

/**
 * BIN-585 PR D: admin-display:screensaver — returns screensaver config
 * for the hall-display TV. Replaces legacy ScreenSaver (common.js:549).
 * Read-only and auth-free; the config is static per environment.
 */
export const AdminDisplayScreensaverResponseSchema = z.object({
  enabled: z.boolean(),
  timeoutMs: z.number().int().nonnegative(),
  imageRotationMs: z.number().int().positive(),
});
export type AdminDisplayScreensaverResponse = z.infer<typeof AdminDisplayScreensaverResponseSchema>;

/**
 * BIN-505/506: MiniGamePlayResult — sent as the ack payload from
 * `minigame:play`. The 4-way rotation (wheel → chest → mystery → colorDraft)
 * uses this shape for all variants.
 */
export const MiniGameTypeSchema = z.enum([
  "wheelOfFortune",
  "treasureChest",
  "mysteryGame",
  "colorDraft",
]);

export const MiniGamePlayResultSchema = z.object({
  type: MiniGameTypeSchema,
  segmentIndex: z.number().int().nonnegative(),
  prizeAmount: z.number().nonnegative(),
  prizeList: z.array(z.number()),
});
export type MiniGamePlayResult = z.infer<typeof MiniGamePlayResultSchema>;

export const MiniGameActivatedPayloadSchema = z.object({
  gameId: z.string(),
  playerId: z.string(),
  type: MiniGameTypeSchema,
  prizeList: z.array(z.number()),
});
export type MiniGameActivatedPayload = z.infer<typeof MiniGameActivatedPayloadSchema>;

// ── BIN-527: Wire-contract extension ───────────────────────────────────────
// Four more payloads to round out the event surface covered by the fixture
// bank. The goal is not 100 % coverage — it's to get every payload a client
// can both send and receive in a pilot-critical flow (arm → draw → mark →
// claim → chat) under runtime validation.

/**
 * BIN-527: `bet:arm` payload. `ticketSelections` is preferred; `ticketCount`
 * is deprecated but accepted for backward compat with older clients.
 */
export const BetArmPayloadSchema = z
  .object({
    accessToken: z.string().optional(),
    roomCode: z.string().min(1),
    playerId: z.string().optional(),
    armed: z.boolean().optional(),
    ticketCount: z.number().int().nonnegative().optional(),
    ticketSelections: z.array(TicketSelectionSchema).optional(),
  })
  .refine(
    (v) => {
      // If armed !== false (i.e. true or absent), require at least one of the
      // two ticket-selection modes when there's any selection at all.
      if (v.armed === false) return true;
      // Both modes are optional for backward compat with callers that just
      // toggle arming without changing the selection — accept it.
      return true;
    },
    { message: "ticketSelections or ticketCount required when arming" },
  );
export type BetArmPayload = z.infer<typeof BetArmPayloadSchema>;

/** BIN-527: `ticket:mark` payload — mark a single drawn number on the player's tickets. */
export const TicketMarkPayloadSchema = z.object({
  accessToken: z.string().optional(),
  roomCode: z.string().min(1),
  playerId: z.string().optional(),
  number: z.number().int().positive().max(75),
});
export type TicketMarkPayload = z.infer<typeof TicketMarkPayloadSchema>;

/** BIN-527: `pattern:won` broadcast — fires after a valid claim commits. */
export const PatternWonPayloadSchema = z.object({
  patternId: z.string(),
  patternName: z.string(),
  winnerId: z.string(),
  wonAtDraw: z.number().int().nonnegative(),
  payoutAmount: z.number().nonnegative(),
  claimType: ClaimType,
  gameId: z.string(),
});
export type PatternWonPayload = z.infer<typeof PatternWonPayloadSchema>;

/**
 * BIN-527: `chat:message` broadcast. `emojiId` is 0 for a pure text message,
 * non-zero for an emoji-only fast-chat reaction (matches the fast-chat button
 * bar in the Unity client).
 */
export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  playerId: z.string(),
  playerName: z.string(),
  message: z.string().max(500),
  emojiId: z.number().int().nonnegative(),
  createdAt: IsoDateString,
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ── BIN-622: GameManagement CRUD wire schemas ───────────────────────────────
// Admin-router eier validering mot eksisterende DomainError-flyt, men vi
// eksporterer zod-skjemaene så admin-UI kan dele runtime-kontrakten (samme
// mønster som PlayerSchema/TicketSchema over). Felter speiler migration
// `20260419000000_game_management.sql` + GameManagementRow i admin-web.

const GameManagementStatus = z.enum(["active", "running", "closed", "inactive"]);
const GameManagementTicketType = z.enum(["Large", "Small"]);

export const GameManagementRowSchema = z.object({
  id: z.string().min(1),
  gameTypeId: z.string().min(1),
  parentId: z.string().nullable().optional(),
  name: z.string().min(1).max(200),
  ticketType: GameManagementTicketType.nullable(),
  /** Ticket price in smallest currency unit (øre). */
  ticketPrice: z.number().int().nonnegative(),
  startDate: IsoDateString,
  endDate: IsoDateString.nullable().optional(),
  status: GameManagementStatus,
  totalSold: z.number().int().nonnegative(),
  totalEarning: z.number().int().nonnegative(),
  config: z.record(z.string(), z.unknown()),
  repeatedFromId: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type GameManagementRow = z.infer<typeof GameManagementRowSchema>;

export const CreateGameManagementSchema = z.object({
  gameTypeId: z.string().min(1).max(200),
  parentId: z.string().min(1).max(200).nullable().optional(),
  name: z.string().min(1).max(200),
  ticketType: GameManagementTicketType.nullable().optional(),
  ticketPrice: z.number().int().nonnegative().optional(),
  startDate: IsoDateString,
  endDate: IsoDateString.nullable().optional(),
  status: GameManagementStatus.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type CreateGameManagementInput = z.infer<typeof CreateGameManagementSchema>;

export const UpdateGameManagementSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  ticketType: GameManagementTicketType.nullable().optional(),
  ticketPrice: z.number().int().nonnegative().optional(),
  startDate: IsoDateString.optional(),
  endDate: IsoDateString.nullable().optional(),
  status: GameManagementStatus.optional(),
  parentId: z.string().min(1).max(200).nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  totalSold: z.number().int().nonnegative().optional(),
  totalEarning: z.number().int().nonnegative().optional(),
}).refine((v) => Object.keys(v).length > 0, {
  message: "Ingen endringer oppgitt.",
});
export type UpdateGameManagementInput = z.infer<typeof UpdateGameManagementSchema>;

export const RepeatGameManagementSchema = z.object({
  startDate: IsoDateString,
  endDate: IsoDateString.nullable().optional(),
  /** Optional name override — if null, service appends "(repeat)" to source. */
  name: z.string().min(1).max(200).nullable().optional(),
});
export type RepeatGameManagementInput = z.infer<typeof RepeatGameManagementSchema>;

// ── BIN-628: admin track-spending aggregate (regulatorisk P2) ───────────────
// Norwegian pengespillforskriften §11 forebyggende tiltak. Aggregerer spend
// på tvers av haller/periode for compliance-oversikt. Fail-closed — 503 når
// data ikke er ferskt. Per-hall limits returneres slik at admin kan vurdere
// om hallens Spillvett-tak er i nærheten av å bli nådd.
//
// Viktige memo-krav:
//   - Per-hall daily/monthly limits (Norway: hall-basert)
//   - Ingen "mandatorisk pause" — voluntary + self-exclusion 1yr
//   - Fire-and-forget audit via AuditLogService (samme mønster som AML/security)
//
// Re-bruker per-spiller-aggregat fra apps/backend/src/spillevett/playerReport.ts.

/** Per-hall spillvett-tak (regulatoriske + per-hall overrides når de finnes). */
export const TrackSpendingHallLimitsSchema = z.object({
  hallId: z.string().min(1),
  hallName: z.string(),
  /** Dagsgrense (NOK). 0 = uendelig. */
  dailyLimit: z.number().nonnegative(),
  /** Månedsgrense (NOK). 0 = uendelig. */
  monthlyLimit: z.number().nonnegative(),
  /**
   * Kilde: "regulatory" = system-wide default fra BingoEngine,
   *        "hall_override" = eksplisitt konfigurert for denne hallen.
   * Frontend bruker verdien til å merke rader der hallen har egen policy.
   */
  source: z.enum(["regulatory", "hall_override"]),
});
export type TrackSpendingHallLimits = z.infer<typeof TrackSpendingHallLimitsSchema>;

/** Aggregat per (hall, periode). */
export const TrackSpendingAggregateRowSchema = z.object({
  hallId: z.string().min(1),
  hallName: z.string(),
  /** Perioden raden dekker. Brukes for periode-sammendrag / cursor-paginering. */
  periodStart: IsoDateString,
  periodEnd: IsoDateString,
  /** Total stake (NOK) summert på tvers av spillere i perioden. */
  totalStake: z.number().nonnegative(),
  /** Total prize (NOK) summert på tvers av spillere i perioden. */
  totalPrize: z.number().nonnegative(),
  /** Netto (stake − prize). Kan være negativt (spillere vant mer enn de satset). */
  netSpend: z.number(),
  /** Antall unike spillere (walletId) med stake-aktivitet i perioden. */
  uniquePlayerCount: z.number().int().nonnegative(),
  /** Gjennomsnittlig netSpend per unike spiller. 0 hvis 0 spillere. */
  averageSpendPerPlayer: z.number(),
  /** Antall stake-events i perioden. */
  stakeEventCount: z.number().int().nonnegative(),
  /** Hallens Spillvett-limits så admin kan sammenligne aggregat mot tak. */
  limits: TrackSpendingHallLimitsSchema,
});
export type TrackSpendingAggregateRow = z.infer<typeof TrackSpendingAggregateRowSchema>;

export const TrackSpendingAggregateResponseSchema = z.object({
  generatedAt: IsoDateString,
  from: IsoDateString,
  to: IsoDateString,
  hallId: z.string().min(1).nullable(),
  /** Én rad per hall (filtered by hallId query) × aggregert periode. */
  rows: z.array(TrackSpendingAggregateRowSchema),
  /** Totalaggregat på tvers av alle hallene i responsen. */
  totals: z.object({
    totalStake: z.number().nonnegative(),
    totalPrize: z.number().nonnegative(),
    netSpend: z.number(),
    uniquePlayerCount: z.number().int().nonnegative(),
    stakeEventCount: z.number().int().nonnegative(),
  }),
  /** Opaque cursor for neste side — null når ingen flere rader. */
  nextCursor: z.string().nullable(),
  /**
   * Data-friskhet. Regulatorisk: dersom staleMs > maxAllowedStaleMs, skal
   * endepunktet returnere 503 (ikke tom data) — men vi eksporterer dette
   * feltet også på success-responser så UI kan vise "oppdatert kl. HH:MM".
   */
  dataFreshness: z.object({
    computedAt: IsoDateString,
    staleMs: z.number().int().nonnegative(),
    maxAllowedStaleMs: z.number().int().nonnegative(),
  }),
});
export type TrackSpendingAggregateResponse = z.infer<typeof TrackSpendingAggregateResponseSchema>;

/** Enkelt-transaksjon (stake/prize-event) i detalj-listen. */
export const TrackSpendingTransactionSchema = z.object({
  id: z.string().min(1),
  createdAt: IsoDateString,
  hallId: z.string().min(1),
  hallName: z.string(),
  playerId: z.string().nullable(),
  walletId: z.string().nullable(),
  gameType: z.enum(["MAIN_GAME", "DATABINGO"]),
  channel: z.enum(["HALL", "INTERNET"]),
  eventType: z.enum(["STAKE", "PRIZE", "EXTRA_PRIZE"]),
  amount: z.number(),
  currency: z.literal("NOK"),
  roomCode: z.string().optional(),
  gameId: z.string().optional(),
});
export type TrackSpendingTransaction = z.infer<typeof TrackSpendingTransactionSchema>;

export const TrackSpendingTransactionsResponseSchema = z.object({
  generatedAt: IsoDateString,
  from: IsoDateString,
  to: IsoDateString,
  hallId: z.string().min(1).nullable(),
  playerId: z.string().min(1).nullable(),
  transactions: z.array(TrackSpendingTransactionSchema),
  nextCursor: z.string().nullable(),
  dataFreshness: z.object({
    computedAt: IsoDateString,
    staleMs: z.number().int().nonnegative(),
    maxAllowedStaleMs: z.number().int().nonnegative(),
  }),
});
export type TrackSpendingTransactionsResponse = z.infer<typeof TrackSpendingTransactionsResponseSchema>;

/**
 * Fail-closed 503-respons. Regulatorisk: admin MÅ se tydelig feilmelding,
 * ikke tom data. Returneres med HTTP 503 når:
 *   - DB-query feiler
 *   - Data er stale (staleMs > maxAllowedStaleMs)
 *   - Hall-limits-oppslag feiler (kan ikke vise aggregat uten limits)
 */
export const TrackSpendingFailClosedResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      "TRACK_SPENDING_STALE_DATA",
      "TRACK_SPENDING_DB_ERROR",
      "TRACK_SPENDING_LIMITS_UNAVAILABLE",
    ]),
    message: z.string().min(1),
    /** Viser admin hvor gammelt data er når koden er STALE_DATA. */
    staleMs: z.number().int().nonnegative().optional(),
    maxAllowedStaleMs: z.number().int().nonnegative().optional(),
  }),
});
export type TrackSpendingFailClosedResponse = z.infer<typeof TrackSpendingFailClosedResponseSchema>;

// ── BIN-626: DailySchedule CRUD wire schemas ────────────────────────────────
// Admin-router eier validering mot DomainError-flyt, men vi eksporterer zod-
// skjemaene så admin-UI kan dele runtime-kontrakten (samme mønster som
// GameManagementRowSchema over). Felter speiler migration
// `20260422000000_daily_schedules.sql` + apps/admin-web/.../DailyScheduleState.ts.

const DailyScheduleStatus = z.enum(["active", "running", "finish", "inactive"]);
const DailyScheduleDay = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

/** "HH:MM" eller tom streng. */
const HhMmOrEmpty = z.string().regex(/^$|^[0-9]{2}:[0-9]{2}$/, {
  message: "time må være 'HH:MM' eller tom.",
});

/** Weekday bitmask mon=1..sun=64. 0 = bruk `day`-feltet. */
const WeekDayMask = z.number().int().min(0).max(127);

export const DailyScheduleHallIdsSchema = z.object({
  masterHallId: z.string().min(1).nullable().optional(),
  hallIds: z.array(z.string().min(1)).optional(),
  groupHallIds: z.array(z.string().min(1)).optional(),
});
export type DailyScheduleHallIds = z.infer<typeof DailyScheduleHallIdsSchema>;

/**
 * Sub-game-slot i en plan. Fri-form felter i `extra` siden subgame-
 * normalisering er BIN-621/627. Eksplisitte felter dekker det admin-UI
 * faktisk leser (index, ticketPrice, prizePool, patternId, status).
 */
export const DailyScheduleSubgameSlotSchema = z.object({
  subGameId: z.string().min(1).nullable().optional(),
  index: z.number().int().nonnegative().optional(),
  ticketPrice: z.number().int().nonnegative().optional(),
  prizePool: z.number().int().nonnegative().optional(),
  patternId: z.string().min(1).nullable().optional(),
  status: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type DailyScheduleSubgameSlot = z.infer<typeof DailyScheduleSubgameSlotSchema>;

export const DailyScheduleRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  gameManagementId: z.string().min(1).nullable(),
  hallId: z.string().min(1).nullable(),
  hallIds: DailyScheduleHallIdsSchema,
  weekDays: WeekDayMask,
  day: DailyScheduleDay.nullable(),
  startDate: IsoDateString,
  endDate: IsoDateString.nullable(),
  startTime: HhMmOrEmpty,
  endTime: HhMmOrEmpty,
  status: DailyScheduleStatus,
  stopGame: z.boolean(),
  specialGame: z.boolean(),
  isSavedGame: z.boolean(),
  isAdminSavedGame: z.boolean(),
  innsatsenSales: z.number().int().nonnegative(),
  subgames: z.array(DailyScheduleSubgameSlotSchema),
  otherData: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type DailyScheduleRow = z.infer<typeof DailyScheduleRowSchema>;

export const CreateDailyScheduleSchema = z.object({
  name: z.string().min(1).max(200),
  gameManagementId: z.string().min(1).max(200).nullable().optional(),
  hallId: z.string().min(1).max(200).nullable().optional(),
  hallIds: DailyScheduleHallIdsSchema.optional(),
  weekDays: WeekDayMask.optional(),
  day: DailyScheduleDay.nullable().optional(),
  startDate: IsoDateString,
  endDate: IsoDateString.nullable().optional(),
  startTime: HhMmOrEmpty.optional(),
  endTime: HhMmOrEmpty.optional(),
  status: DailyScheduleStatus.optional(),
  stopGame: z.boolean().optional(),
  specialGame: z.boolean().optional(),
  isSavedGame: z.boolean().optional(),
  isAdminSavedGame: z.boolean().optional(),
  subgames: z.array(DailyScheduleSubgameSlotSchema).optional(),
  otherData: z.record(z.string(), z.unknown()).optional(),
});
export type CreateDailyScheduleInput = z.infer<typeof CreateDailyScheduleSchema>;

/**
 * Special-schedule — alias for create() med specialGame=true og typisk
 * hallIds-multi-hall-oppsett. Service normaliserer felter.
 */
export const CreateSpecialDailyScheduleSchema = CreateDailyScheduleSchema.extend({
  specialGame: z.literal(true).optional(),
});
export type CreateSpecialDailyScheduleInput = z.infer<typeof CreateSpecialDailyScheduleSchema>;

export const UpdateDailyScheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  gameManagementId: z.string().min(1).max(200).nullable().optional(),
  hallId: z.string().min(1).max(200).nullable().optional(),
  hallIds: DailyScheduleHallIdsSchema.optional(),
  weekDays: WeekDayMask.optional(),
  day: DailyScheduleDay.nullable().optional(),
  startDate: IsoDateString.optional(),
  endDate: IsoDateString.nullable().optional(),
  startTime: HhMmOrEmpty.optional(),
  endTime: HhMmOrEmpty.optional(),
  status: DailyScheduleStatus.optional(),
  stopGame: z.boolean().optional(),
  specialGame: z.boolean().optional(),
  isSavedGame: z.boolean().optional(),
  isAdminSavedGame: z.boolean().optional(),
  innsatsenSales: z.number().int().nonnegative().optional(),
  subgames: z.array(DailyScheduleSubgameSlotSchema).optional(),
  otherData: z.record(z.string(), z.unknown()).optional(),
}).refine((v) => Object.keys(v).length > 0, {
  message: "Ingen endringer oppgitt.",
});
export type UpdateDailyScheduleInput = z.infer<typeof UpdateDailyScheduleSchema>;

/** Detail-response: samme som row + embedded subgame-aggregat for viewSubgame. */
export const DailyScheduleDetailsResponseSchema = z.object({
  schedule: DailyScheduleRowSchema,
  subgames: z.array(DailyScheduleSubgameSlotSchema),
  /** Referanse til GameManagement-rad (name + status) for enkel rendering. */
  gameManagement: z
    .object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["active", "running", "closed", "inactive"]),
      ticketType: z.enum(["Large", "Small"]).nullable(),
      ticketPrice: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type DailyScheduleDetailsResponse = z.infer<typeof DailyScheduleDetailsResponseSchema>;

// ── BIN-627: Pattern CRUD + dynamic-menu wire schemas ───────────────────────
// Admin-CRUD for bingo-mønstre (25-bit bitmask). Samme PatternMask-type som
// shared-types/game.ts + backend PatternMatcher. Admin-UI editor sender
// mask som integer på wire; legacy-streng-format ("0,1,1...") eksponeres
// ikke lenger (admin-web konverterer via legacyGridToMask/maskToLegacyGrid
// hvis det trengs for rendering).
//
// Felter speiler migration `20260423000000_patterns.sql`. PatternRow i
// apps/admin-web/.../PatternState.ts er kanonisert her.

const PatternStatus = z.enum(["active", "inactive"]);
const PatternClaimType = z.enum(["LINE", "BINGO"]);

/** 25-bit bitmask. 0 ≤ mask < 2^25 = 33554432. */
const PatternMaskSchema = z
  .number()
  .int()
  .min(0)
  .max(33554431);

export const PatternRowSchema = z.object({
  id: z.string().min(1),
  gameTypeId: z.string().min(1),
  gameName: z.string().min(1).max(200),
  patternNumber: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  /** 25-bit bitmask encoding of the 5x5 grid. */
  mask: PatternMaskSchema,
  claimType: PatternClaimType,
  prizePercent: z.number().min(0).max(100),
  orderIndex: z.number().int().nonnegative(),
  design: z.number().int().nonnegative(),
  status: PatternStatus,
  /** Legacy Game 1 optional flags — default false. */
  isWoF: z.boolean(),
  isTchest: z.boolean(),
  isMys: z.boolean(),
  isRowPr: z.boolean(),
  rowPercentage: z.number().nonnegative(),
  isJackpot: z.boolean(),
  isGameTypeExtra: z.boolean(),
  isLuckyBonus: z.boolean(),
  /** Legacy pattern-place (Game 3/4 number-range slug, f.eks. "1-15"). */
  patternPlace: z.string().nullable(),
  extra: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type PatternRow = z.infer<typeof PatternRowSchema>;

export const CreatePatternSchema = z.object({
  gameTypeId: z.string().min(1).max(200),
  /** Display-navn for game (f.eks. "Game1", "Game3"). */
  gameName: z.string().min(1).max(200).optional(),
  /** Auto-genereres av service hvis ikke satt. */
  patternNumber: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200),
  mask: PatternMaskSchema,
  claimType: PatternClaimType.optional(),
  prizePercent: z.number().min(0).max(100).optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  design: z.number().int().nonnegative().optional(),
  status: PatternStatus.optional(),
  isWoF: z.boolean().optional(),
  isTchest: z.boolean().optional(),
  isMys: z.boolean().optional(),
  isRowPr: z.boolean().optional(),
  rowPercentage: z.number().nonnegative().optional(),
  isJackpot: z.boolean().optional(),
  isGameTypeExtra: z.boolean().optional(),
  isLuckyBonus: z.boolean().optional(),
  patternPlace: z.string().min(1).max(200).nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type CreatePatternInput = z.infer<typeof CreatePatternSchema>;

export const UpdatePatternSchema = z.object({
  gameName: z.string().min(1).max(200).optional(),
  patternNumber: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200).optional(),
  mask: PatternMaskSchema.optional(),
  claimType: PatternClaimType.optional(),
  prizePercent: z.number().min(0).max(100).optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  design: z.number().int().nonnegative().optional(),
  status: PatternStatus.optional(),
  isWoF: z.boolean().optional(),
  isTchest: z.boolean().optional(),
  isMys: z.boolean().optional(),
  isRowPr: z.boolean().optional(),
  rowPercentage: z.number().nonnegative().optional(),
  isJackpot: z.boolean().optional(),
  isGameTypeExtra: z.boolean().optional(),
  isLuckyBonus: z.boolean().optional(),
  patternPlace: z.string().min(1).max(200).nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).refine((v) => Object.keys(v).length > 0, {
  message: "Ingen endringer oppgitt.",
});
export type UpdatePatternInput = z.infer<typeof UpdatePatternSchema>;

/**
 * Dynamic-menu-entry: ett mønster som en oppføring i admin-UI-dropdown.
 * Sub-menu på gameType (toppnivå) → liste av mønstre sortert etter order_index.
 */
export const PatternDynamicMenuEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  patternNumber: z.string().min(1),
  /** 25-bit bitmask — admin-UI kan tegne preview uten separat fetch. */
  mask: PatternMaskSchema,
  orderIndex: z.number().int().nonnegative(),
  status: PatternStatus,
  claimType: PatternClaimType,
  design: z.number().int().nonnegative(),
});
export type PatternDynamicMenuEntry = z.infer<typeof PatternDynamicMenuEntrySchema>;

export const PatternDynamicMenuResponseSchema = z.object({
  /** GameType slug menuen er for (eller null hvis alle). */
  gameTypeId: z.string().min(1).nullable(),
  /** Ordnet liste av mønstre (aktive først, deretter etter orderIndex). */
  entries: z.array(PatternDynamicMenuEntrySchema),
  /** Totalt antall mønstre (før evt. limit). */
  count: z.number().int().nonnegative(),
});
export type PatternDynamicMenuResponse = z.infer<typeof PatternDynamicMenuResponseSchema>;

// ── BIN-665: HallGroup CRUD wire schemas ────────────────────────────────────
// Admin-CRUD for hall-grupper (cross-hall spill). GroupHall = navngitt
// gruppering av haller som Game 2 + Game 3 bruker for sammenkoblede draws
// mot flere fysiske haller. Legacy Mongo-schema `GroupHall` er normalisert
// til to tabeller: `app_hall_groups` + `app_hall_group_members`.
//
// Felter speiler migration `20260424000000_hall_groups.sql`. HallGroupRow
// i apps/admin-web/.../GroupHallState.ts (PR-A5) skal canonicaliseres hit.

const HallGroupStatus = z.enum(["active", "inactive"]);

/** Medlems-hall representert som minimal oppsummering (id + navn). */
export const HallGroupMemberSchema = z.object({
  hallId: z.string().min(1),
  hallName: z.string().min(1),
  hallStatus: z.string().min(1),
  addedAt: IsoDateString,
});
export type HallGroupMember = z.infer<typeof HallGroupMemberSchema>;

export const HallGroupRowSchema = z.object({
  id: z.string().min(1),
  /** Legacy-format (GH_<timestamp>). Nullable for nye rader. */
  legacyGroupHallId: z.string().nullable(),
  name: z.string().min(1).max(200),
  status: HallGroupStatus,
  /** TV-skjerm-ID (numerisk) — brukes av hall-TV-streaming. */
  tvId: z.number().int().nullable(),
  /** Produkt-ids knyttet til gruppen. Bevart som streng-array. */
  productIds: z.array(z.string().min(1)),
  /** Medlems-haller (denormalisert for admin-UI). */
  members: z.array(HallGroupMemberSchema),
  /** Ekstra fri-form felter (legacy-kompatibilitet). */
  extra: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type HallGroupRow = z.infer<typeof HallGroupRowSchema>;

export const CreateHallGroupSchema = z.object({
  name: z.string().min(1).max(200),
  /** Liste av hall-ids som skal være medlem av gruppen. Kan være tom. */
  hallIds: z.array(z.string().min(1)).default([]),
  status: HallGroupStatus.optional(),
  tvId: z.number().int().nullable().optional(),
  productIds: z.array(z.string().min(1)).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type CreateHallGroupInput = z.infer<typeof CreateHallGroupSchema>;

export const UpdateHallGroupSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    /** Erstatter hele medlemsskaps-listen hvis satt. */
    hallIds: z.array(z.string().min(1)).optional(),
    status: HallGroupStatus.optional(),
    tvId: z.number().int().nullable().optional(),
    productIds: z.array(z.string().min(1)).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateHallGroupInput = z.infer<typeof UpdateHallGroupSchema>;

/**
 * List-respons med både rader og total-antall. Gjenspeiler hvordan
 * BIN-622/626/627 rapporterer liste-endpoints.
 */
export const HallGroupListResponseSchema = z.object({
  groups: z.array(HallGroupRowSchema),
  count: z.number().int().nonnegative(),
});
export type HallGroupListResponse = z.infer<typeof HallGroupListResponseSchema>;
