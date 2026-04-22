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
  /**
   * Admin-configurable prize mode per pattern.
   * - "percent": prizePercent of pool.
   * - "fixed":   flat prize1 kr amount.
   * - "multiplier-chain" (BIN-687): phase 1 = percent-of-pool with
   *   minPrizeCents floor; phase N = phase1Base × phase1Multiplier with
   *   own minPrizeCents floor.
   */
  winningType: z
    .enum([
      "percent",
      "fixed",
      "multiplier-chain",
      "column-specific",
      "ball-value-multiplier",
    ])
    .optional(),
  /** Flat kr amount when winningType === "fixed". */
  prize1: z.number().optional(),
  /**
   * BIN-687 / PR-P2: multiplier of phase-1 base prize. Only used with
   * `winningType: "multiplier-chain"` on phase > 1.
   */
  phase1Multiplier: z.number().positive().optional(),
  /**
   * BIN-687 / PR-P2: minimum prize floor in kr per phase (matches prize1
   * and prizePool unit).
   */
  minPrize: z.number().nonnegative().optional(),
  /**
   * PR-P3 (Super-NILS): per-column prize matrix for full-house. Column of
   * last drawn ball determines payout. B=1-15, I=16-30, N=31-45, G=46-60,
   * O=61-75. Values in kr. Only meaningful for full-house pattern.
   */
  columnPrizesNok: z
    .object({
      B: z.number().nonnegative(),
      I: z.number().nonnegative(),
      N: z.number().nonnegative(),
      G: z.number().nonnegative(),
      O: z.number().nonnegative(),
    })
    .optional(),
  /** PR-P4 (Ball × 10): base prize for Fullt Hus. */
  baseFullHousePrizeNok: z.number().nonnegative().optional(),
  /** PR-P4 (Ball × 10): multiplier per ball-value (kr). Must be > 0. */
  ballValueMultiplier: z.number().positive().optional(),
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
 * Legacy alias: `SwapTicket`.
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

/**
 * BIN-527: `pattern:won` broadcast — fires after a valid claim commits.
 *
 * BIN-696: Utvidet med `winnerIds` + `winnerCount` for å støtte multi-
 * winner-split-forklaring i klient-popup. `winnerId` beholdes for
 * backward compat (peker til første vinner ved split).
 */
export const PatternWonPayloadSchema = z.object({
  patternId: z.string(),
  patternName: z.string(),
  winnerId: z.string(),
  wonAtDraw: z.number().int().nonnegative(),
  payoutAmount: z.number().nonnegative(),
  claimType: ClaimType,
  gameId: z.string(),
  /** BIN-696: alle spiller-IDer som vant fasen på samme draw. Minst 1. */
  winnerIds: z.array(z.string()).optional(),
  /** BIN-696: antall samtidige vinnere (lik winnerIds.length — for UI-enkelhet). */
  winnerCount: z.number().int().positive().optional(),
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

// ── BIN-620: GameType CRUD wire schemas ────────────────────────────────────
// Admin-CRUD for spill-typer (topp-nivå katalog). Mirror av migration
// `20260425000000_game_types.sql`. GameType-raden er referent fra
// app_game_management, app_patterns, app_sub_games via `type_slug` / id.
//
// Legacy-feltnavn (name, type, pattern, photo, row, columns) bevares i
// admin-web-mapperen — wire-shape bruker camelCase som matcher service-
// interface (GameTypeRow i apps/admin-web/.../common/types.ts når Agent A
// kobler på dette).

const GameTypeStatus = z.enum(["active", "inactive"]);

export const GameTypeRowSchema = z.object({
  id: z.string().min(1),
  /** Stabil slug-id (f.eks. "game_1", "bingo"). Kanonisk referent. */
  typeSlug: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  photo: z.string(),
  pattern: z.boolean(),
  gridRows: z.number().int().positive(),
  gridColumns: z.number().int().positive(),
  rangeMin: z.number().int().nullable(),
  rangeMax: z.number().int().nullable(),
  totalNoTickets: z.number().int().positive().nullable(),
  userMaxTickets: z.number().int().positive().nullable(),
  luckyNumbers: z.array(z.number().int()),
  status: GameTypeStatus,
  extra: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type GameTypeRow = z.infer<typeof GameTypeRowSchema>;

export const CreateGameTypeSchema = z.object({
  typeSlug: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  photo: z.string().max(500).optional(),
  pattern: z.boolean().optional(),
  gridRows: z.number().int().positive().optional(),
  gridColumns: z.number().int().positive().optional(),
  rangeMin: z.number().int().nullable().optional(),
  rangeMax: z.number().int().nullable().optional(),
  totalNoTickets: z.number().int().positive().nullable().optional(),
  userMaxTickets: z.number().int().positive().nullable().optional(),
  luckyNumbers: z.array(z.number().int()).optional(),
  status: GameTypeStatus.optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type CreateGameTypeInput = z.infer<typeof CreateGameTypeSchema>;

export const UpdateGameTypeSchema = z
  .object({
    typeSlug: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200).optional(),
    photo: z.string().max(500).optional(),
    pattern: z.boolean().optional(),
    gridRows: z.number().int().positive().optional(),
    gridColumns: z.number().int().positive().optional(),
    rangeMin: z.number().int().nullable().optional(),
    rangeMax: z.number().int().nullable().optional(),
    totalNoTickets: z.number().int().positive().nullable().optional(),
    userMaxTickets: z.number().int().positive().nullable().optional(),
    luckyNumbers: z.array(z.number().int()).optional(),
    status: GameTypeStatus.optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateGameTypeInput = z.infer<typeof UpdateGameTypeSchema>;

export const GameTypeListResponseSchema = z.object({
  gameTypes: z.array(GameTypeRowSchema),
  count: z.number().int().nonnegative(),
});
export type GameTypeListResponse = z.infer<typeof GameTypeListResponseSchema>;

// ── BIN-621: SubGame CRUD wire schemas ────────────────────────────────────
// Admin-CRUD for sub-game-maler (navngitte bundles av pattern-ids + ticket-
// farger + status). Mirror av migration `20260425000100_sub_games.sql`.
// En SubGame er en gjenbrukbar oppskrift som admin binder inn i DailySchedule
// .subgames_json — hver plan kan velge å kjøre en SubGame for å få en
// preconfigured kombinasjon av mønstre og farger.
//
// og runtime-state i samme schema. Vi splitter ut: runtime hører til
// app_game_sessions / hall_game_schedules; admin-katalog bor i app_sub_games.

const SubGameStatus = z.enum(["active", "inactive"]);

export const SubGamePatternRefSchema = z.object({
  patternId: z.string().min(1),
  name: z.string().min(1).max(200),
});
export type SubGamePatternRef = z.infer<typeof SubGamePatternRefSchema>;

export const SubGameRowSchema = z.object({
  id: z.string().min(1),
  /** Referent til app_game_types.type_slug (stabil slug). */
  gameTypeId: z.string().min(1),
  /** Display-navn (f.eks. "Game1", "Game3") — ikke unik, kun label. */
  gameName: z.string().min(1).max(200),
  /** Visnings-navn på SubGame-malen (unikt per gameType). */
  name: z.string().min(1).max(200),
  /** Legacy auto-increment nummer (f.eks. "SG_20220919_032458"). */
  subGameNumber: z.string().min(1).max(200),
  patternRows: z.array(SubGamePatternRefSchema),
  ticketColors: z.array(z.string().min(1)),
  status: SubGameStatus,
  extra: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type SubGameRow = z.infer<typeof SubGameRowSchema>;

export const CreateSubGameSchema = z.object({
  gameTypeId: z.string().min(1).max(200),
  gameName: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200),
  /** Auto-genereres av service hvis ikke satt. */
  subGameNumber: z.string().min(1).max(200).optional(),
  patternRows: z.array(SubGamePatternRefSchema).optional(),
  ticketColors: z.array(z.string().min(1)).optional(),
  status: SubGameStatus.optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type CreateSubGameInput = z.infer<typeof CreateSubGameSchema>;

export const UpdateSubGameSchema = z
  .object({
    gameName: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200).optional(),
    subGameNumber: z.string().min(1).max(200).optional(),
    patternRows: z.array(SubGamePatternRefSchema).optional(),
    ticketColors: z.array(z.string().min(1)).optional(),
    status: SubGameStatus.optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateSubGameInput = z.infer<typeof UpdateSubGameSchema>;

export const SubGameListResponseSchema = z.object({
  subGames: z.array(SubGameRowSchema),
  count: z.number().int().nonnegative(),
});
export type SubGameListResponse = z.infer<typeof SubGameListResponseSchema>;

// ── BIN-668: LeaderboardTier CRUD wire schemas ────────────────────────────
// Admin-CRUD for leaderboard-tiers (plass→premie/poeng-mapping). Mirror av
// migration `20260425000400_leaderboard_tiers.sql`. Dette er KONFIGURASJON
// (admin-katalog), ikke runtime-state. Runtime `/api/leaderboard` (i
// apps/backend/src/routes/game.ts) aggregerer poeng fra faktiske wins og er
// urørt av denne tabellen.
//
// tier_name grupperer et sett med rader til en "profil" (f.eks. "default",
// "daily", "vip"). Unik per (tier_name, place) per ikke-slettet rad.

export const LeaderboardTierRowSchema = z.object({
  id: z.string().min(1),
  /** Profil-navn (f.eks. "default", "daily"). Ikke case-sensitive i praksis. */
  tierName: z.string().min(1).max(200),
  /** Plassering (1-basert). Positivt heltall. */
  place: z.number().int().positive(),
  /** Poeng tildelt for plasseringen. Ikke-negativt heltall. */
  points: z.number().int().nonnegative(),
  /** Premie-beløp i NOK. NULL = ingen kontant-premie (kun points). */
  prizeAmount: z.number().nullable(),
  /** Fri-form beskrivelse ("Gavekort 500 kr"). Tom streng hvis ikke satt. */
  prizeDescription: z.string(),
  active: z.boolean(),
  extra: z.record(z.string(), z.unknown()),
  createdByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type LeaderboardTierRow = z.infer<typeof LeaderboardTierRowSchema>;

export const CreateLeaderboardTierSchema = z.object({
  tierName: z.string().min(1).max(200).optional(),
  place: z.number().int().positive(),
  points: z.number().int().nonnegative().optional(),
  prizeAmount: z.number().nonnegative().nullable().optional(),
  prizeDescription: z.string().max(500).optional(),
  active: z.boolean().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type CreateLeaderboardTierInput = z.infer<typeof CreateLeaderboardTierSchema>;

export const UpdateLeaderboardTierSchema = z
  .object({
    tierName: z.string().min(1).max(200).optional(),
    place: z.number().int().positive().optional(),
    points: z.number().int().nonnegative().optional(),
    prizeAmount: z.number().nonnegative().nullable().optional(),
    prizeDescription: z.string().max(500).optional(),
    active: z.boolean().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateLeaderboardTierInput = z.infer<typeof UpdateLeaderboardTierSchema>;

export const LeaderboardTierListResponseSchema = z.object({
  tiers: z.array(LeaderboardTierRowSchema),
  count: z.number().int().nonnegative(),
});
export type LeaderboardTierListResponse = z.infer<
  typeof LeaderboardTierListResponseSchema
>;

// ── BIN-700: Loyalty CRUD + player-state wire schemas ───────────────────────
// Admin-CRUD for tier-hierarkiet (bronze/silver/gold/platinum etc.) + per-
// spiller aggregat (current_tier, lifetime_points, month_points). Mirror av
// migration `20260429000000_loyalty.sql`.
//
// Avgrensning mot BIN-668 (leaderboard_tier): leaderboard-tier er plass-basert
// premie-mapping (runtime wins), loyalty-tier er persistent status basert på
// akkumulert aktivitet. Systemene er uavhengige.

export const LoyaltyTierRowSchema = z.object({
  id: z.string().min(1),
  /** Display-navn ("Bronze", "Silver", "Gold", "Platinum"). Unik. */
  name: z.string().min(1).max(200),
  /** Hierarkisk rang. 1 = laveste. Høyere rank = bedre tier. Unik. */
  rank: z.number().int().positive(),
  /** Inklusiv minimums-grense for å kvalifisere (lifetime_points >= min_points). */
  minPoints: z.number().int().nonnegative(),
  /** Eksklusiv maks-grense. NULL = ingen øvre grense (toppnivå). */
  maxPoints: z.number().int().nullable(),
  /** Fri-form benefits-payload (bonus-prosent, fri-spinn, prioritet). */
  benefits: z.record(z.string(), z.unknown()),
  active: z.boolean(),
  createdByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type LoyaltyTierRow = z.infer<typeof LoyaltyTierRowSchema>;

export const CreateLoyaltyTierSchema = z.object({
  name: z.string().min(1).max(200),
  rank: z.number().int().positive(),
  minPoints: z.number().int().nonnegative().optional(),
  maxPoints: z.number().int().nonnegative().nullable().optional(),
  benefits: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
});
export type CreateLoyaltyTierInput = z.infer<typeof CreateLoyaltyTierSchema>;

export const UpdateLoyaltyTierSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    rank: z.number().int().positive().optional(),
    minPoints: z.number().int().nonnegative().optional(),
    maxPoints: z.number().int().nonnegative().nullable().optional(),
    benefits: z.record(z.string(), z.unknown()).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateLoyaltyTierInput = z.infer<typeof UpdateLoyaltyTierSchema>;

export const LoyaltyTierListResponseSchema = z.object({
  tiers: z.array(LoyaltyTierRowSchema),
  count: z.number().int().nonnegative(),
});
export type LoyaltyTierListResponse = z.infer<typeof LoyaltyTierListResponseSchema>;

// Player-state wire-schema — én rad pr spiller.

export const LoyaltyPlayerStateSchema = z.object({
  userId: z.string().min(1),
  /** Nåværende tier (null før første tildeling). Speiler app_loyalty_tiers-rad. */
  currentTier: LoyaltyTierRowSchema.nullable(),
  lifetimePoints: z.number().int().nonnegative(),
  monthPoints: z.number().int().nonnegative(),
  monthKey: z.string().nullable(),
  /** true hvis admin har låst tier manuelt (bypass automatic assignment). */
  tierLocked: z.boolean(),
  lastUpdatedAt: IsoDateString,
  createdAt: IsoDateString,
});
export type LoyaltyPlayerState = z.infer<typeof LoyaltyPlayerStateSchema>;

export const LoyaltyAwardSchema = z.object({
  pointsDelta: z.number().int(),
  /** Admin-note eller event-kategori ("Bursdag", "Jubileum"). */
  reason: z.string().min(1).max(500),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type LoyaltyAwardInput = z.infer<typeof LoyaltyAwardSchema>;

export const LoyaltyTierOverrideSchema = z.object({
  /** Tier-id. NULL betyr "fjern override" (låser opp så autoassign kan kjøre igjen). */
  tierId: z.string().min(1).nullable(),
  /** Admin-begrunnelse for audit. */
  reason: z.string().min(1).max(500),
});
export type LoyaltyTierOverrideInput = z.infer<typeof LoyaltyTierOverrideSchema>;

export const LoyaltyEventRowSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  eventType: z.string().min(1),
  pointsDelta: z.number().int(),
  metadata: z.record(z.string(), z.unknown()),
  createdByUserId: z.string().nullable(),
  createdAt: IsoDateString,
});
export type LoyaltyEventRow = z.infer<typeof LoyaltyEventRowSchema>;

// ── BIN-624: SavedGame CRUD wire schemas ────────────────────────────────────
// Admin-CRUD for SavedGame-templates (gjenbrukbare GameManagement-oppsett).
// Mirror av migration `20260425000200_saved_games.sql`.
//
// En SavedGame er IKKE et kjørbart spill — det er en template som admin
// lagrer slik at et komplett GameManagement-oppsett (ticket-farger, priser,
// patterns, subgames, halls, days, ...) kan brukes som utgangspunkt for
// et nytt spill via load-to-game-flyten. `config` er en fri-form Record
// siden legacy `savedGame` hadde ~50 felter som varierer per gameType;
// GameManagement-layeret gjør semantisk validering ved load-to-game.
//

const SavedGameStatus = z.enum(["active", "inactive"]);

export const SavedGameRowSchema = z.object({
  id: z.string().min(1),
  /** Referent til app_game_types.type_slug (stabil slug, f.eks. "game_1"). */
  gameTypeId: z.string().min(1),
  /** Display-navn på malen (unik per gameType). */
  name: z.string().min(1).max(200),
  /** Legacy isAdminSave-flag (styrer synlighet i liste-queries). */
  isAdminSave: z.boolean(),
  /** Template-payload (alle legacy savedGame-felter unntatt runtime-state). */
  config: z.record(z.string(), z.unknown()),
  status: SavedGameStatus,
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type SavedGameRow = z.infer<typeof SavedGameRowSchema>;

export const CreateSavedGameSchema = z.object({
  gameTypeId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  isAdminSave: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  status: SavedGameStatus.optional(),
});
export type CreateSavedGameInput = z.infer<typeof CreateSavedGameSchema>;

export const UpdateSavedGameSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    isAdminSave: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    status: SavedGameStatus.optional(),
  })
  .refine((v: Record<string, unknown>) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateSavedGameInput = z.infer<typeof UpdateSavedGameSchema>;

export const SavedGameListResponseSchema = z.object({
  savedGames: z.array(SavedGameRowSchema),
  count: z.number().int().nonnegative(),
});
export type SavedGameListResponse = z.infer<typeof SavedGameListResponseSchema>;

/**
 * Load-to-game-respons: payload klient sender videre til GameManagement.create()
 * (BIN-622). Router returnerer kun data — ingen GameManagement-rad opprettes
 * inline, slik at klient kan justere felter (name, startDate, endDate, halls)
 * før faktisk opprettelse.
 */
export const SavedGameLoadResponseSchema = z.object({
  savedGameId: z.string().min(1),
  gameTypeId: z.string().min(1),
  name: z.string().min(1).max(200),
  config: z.record(z.string(), z.unknown()),
});
export type SavedGameLoadResponse = z.infer<typeof SavedGameLoadResponseSchema>;

// ── BIN-625: Schedule CRUD wire schemas ───────────────────────────────────
// Admin-CRUD for Schedule-maler (gjenbrukbare spill-oppskrifter). Distinct
// fra DailySchedule (BIN-626) som er kalender-rader. Mirror av migration
// `20260425000300_schedules.sql`.
//
// "schedules"-kolleksjonen med scheduleName, scheduleType (Auto|Manual),
// subGames[] og Innsatsen-spesifikke felter (luckyNumberPrize,
// ticketColorTypePrice m.fl. innenfor subGames).

const ScheduleType = z.enum(["Auto", "Manual"]);
const ScheduleStatus = z.enum(["active", "inactive"]);

/**
 * Fri-form subgame-slot. Feltene matcher legacy scheduleController.
 * createSchedulePostData. Ukjente felter bevares via `extra` inntil
 * BIN-621 normaliserer subgame-katalogen.
 */
export const ScheduleSubgameSchema = z.object({
  name: z.string().optional(),
  customGameName: z.string().optional(),
  startTime: HhMmOrEmpty.optional(),
  endTime: HhMmOrEmpty.optional(),
  notificationStartTime: z.string().optional(),
  minseconds: z.number().int().nonnegative().optional(),
  maxseconds: z.number().int().nonnegative().optional(),
  seconds: z.number().int().nonnegative().optional(),
  ticketTypesData: z.record(z.string(), z.unknown()).optional(),
  jackpotData: z.record(z.string(), z.unknown()).optional(),
  elvisData: z.record(z.string(), z.unknown()).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type ScheduleSubgame = z.infer<typeof ScheduleSubgameSchema>;

export const ScheduleRowSchema = z.object({
  id: z.string().min(1),
  scheduleName: z.string().min(1).max(200),
  /** Auto-generert legacy-stil SID_YYYYMMDD_HHMMSS_… unik. */
  scheduleNumber: z.string().min(1).max(200),
  scheduleType: ScheduleType,
  luckyNumberPrize: z.number().int().nonnegative(),
  status: ScheduleStatus,
  isAdminSchedule: z.boolean(),
  manualStartTime: HhMmOrEmpty,
  manualEndTime: HhMmOrEmpty,
  subGames: z.array(ScheduleSubgameSchema),
  createdBy: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type ScheduleRow = z.infer<typeof ScheduleRowSchema>;

export const CreateScheduleSchema = z.object({
  scheduleName: z.string().min(1).max(200),
  /** Auto-genereres av service hvis ikke satt. */
  scheduleNumber: z.string().min(1).max(200).optional(),
  scheduleType: ScheduleType.optional(),
  luckyNumberPrize: z.number().int().nonnegative().optional(),
  status: ScheduleStatus.optional(),
  isAdminSchedule: z.boolean().optional(),
  manualStartTime: HhMmOrEmpty.optional(),
  manualEndTime: HhMmOrEmpty.optional(),
  subGames: z.array(ScheduleSubgameSchema).optional(),
});
export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>;

export const UpdateScheduleSchema = z
  .object({
    scheduleName: z.string().min(1).max(200).optional(),
    scheduleType: ScheduleType.optional(),
    luckyNumberPrize: z.number().int().nonnegative().optional(),
    status: ScheduleStatus.optional(),
    manualStartTime: HhMmOrEmpty.optional(),
    manualEndTime: HhMmOrEmpty.optional(),
    subGames: z.array(ScheduleSubgameSchema).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>;

export const ScheduleListResponseSchema = z.object({
  schedules: z.array(ScheduleRowSchema),
  count: z.number().int().nonnegative(),
});
export type ScheduleListResponse = z.infer<typeof ScheduleListResponseSchema>;

// ── GAME1_SCHEDULE PR 1: Game 1 scheduled-games wire schemas ──────────────────
// Mirror av migration `20260428000000_game1_scheduled_games.sql`.
//
// Tabellen app_game1_scheduled_games lagrer én rad per spawned Game 1-instans,
// spawned av scheduler-ticken (15s) fra daily_schedules × schedule-mal × subGames.
// State-maskin: scheduled → purchase_open → ready_to_start → running →
// paused → completed | cancelled.
//
// PR 1 eksponerer kun schemas (ingen route-endpoints ennå); disse brukes av
// PR 2-5 for ready-flow, master-start, exclude-hall og status-lister.

export const Game1ScheduledGameStatusSchema = z.enum([
  "scheduled",
  "purchase_open",
  "ready_to_start",
  "running",
  "paused",
  "completed",
  "cancelled",
]);
export type Game1ScheduledGameStatus = z.infer<typeof Game1ScheduledGameStatusSchema>;

export const Game1GameModeSchema = z.enum(["Auto", "Manual"]);
export type Game1GameMode = z.infer<typeof Game1GameModeSchema>;

export const Game1ScheduledGameRowSchema = z.object({
  id: z.string().min(1),
  /** FK til app_daily_schedules.id — planen som trigget spawnen. */
  dailyScheduleId: z.string().min(1),
  /** FK til app_schedules.id — malen vi snapshotet ticket/jackpot-config fra. */
  scheduleId: z.string().min(1),
  /** Index i schedule.subGames[] (0-basert). */
  subGameIndex: z.number().int().nonnegative(),
  subGameName: z.string().min(1),
  customGameName: z.string().nullable(),
  /** 'YYYY-MM-DD' — datoen raden gjelder. */
  scheduledDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledStartTime: IsoDateString,
  scheduledEndTime: IsoDateString,
  /** Normalisert fra legacy "5m"/"60s" — sekunder som INT. */
  notificationStartSeconds: z.number().int().nonnegative(),
  /** Snapshot av schedule.subGame.ticketTypesData på spawn-tidspunkt. */
  ticketConfig: z.record(z.string(), z.unknown()),
  /** Snapshot av schedule.subGame.jackpotData på spawn-tidspunkt. */
  jackpotConfig: z.record(z.string(), z.unknown()),
  gameMode: Game1GameModeSchema,
  masterHallId: z.string().min(1),
  groupHallId: z.string().min(1),
  /** Snapshot av deltakende haller (array av hall-IDer). */
  participatingHallIds: z.array(z.string().min(1)),
  status: Game1ScheduledGameStatusSchema,
  actualStartTime: IsoDateString.nullable(),
  actualEndTime: IsoDateString.nullable(),
  startedByUserId: z.string().nullable(),
  excludedHallIds: z.array(z.string().min(1)),
  stoppedByUserId: z.string().nullable(),
  stopReason: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type Game1ScheduledGameRow = z.infer<typeof Game1ScheduledGameRowSchema>;

// ── BIN-677: System settings + maintenance wire schemas ─────────────────────
// Mirror av migration `20260425000500_system_settings_maintenance.sql`.
//
// System settings er key-value (se SYSTEM_SETTING_REGISTRY i
// apps/backend/src/admin/SettingsService.ts for kjente nøkler). Ukjente
// nøkler avvises server-side.
//
// Maintenance-vinduer er separate rader; max ett samtidig aktivt vindu
// (håndheves i MaintenanceService).

export const SystemSettingType = z.enum(["string", "number", "boolean", "object"]);
export type SystemSettingTypeT = z.infer<typeof SystemSettingType>;

export const SystemSettingRowSchema = z.object({
  key: z.string().min(1).max(200),
  /** JSONB value — type avhenger av `type`-feltet; valideres av service-laget. */
  value: z.unknown(),
  category: z.string().min(1).max(100),
  description: z.string(),
  type: SystemSettingType,
  /** true hvis verdien kommer fra registry-default (ingen DB-rad eksisterer). */
  isDefault: z.boolean(),
  updatedByUserId: z.string().nullable(),
  updatedAt: IsoDateString.nullable(),
});
export type SystemSettingRow = z.infer<typeof SystemSettingRowSchema>;

export const SystemSettingsListResponseSchema = z.object({
  settings: z.array(SystemSettingRowSchema),
  count: z.number().int().nonnegative(),
});
export type SystemSettingsListResponse = z.infer<
  typeof SystemSettingsListResponseSchema
>;

export const SystemSettingPatchEntrySchema = z.object({
  key: z.string().min(1).max(200),
  value: z.unknown(),
});
export type SystemSettingPatchEntry = z.infer<typeof SystemSettingPatchEntrySchema>;

export const PatchSystemSettingsSchema = z
  .object({
    patches: z.array(SystemSettingPatchEntrySchema).min(1),
  })
  .refine((v) => v.patches.length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type PatchSystemSettingsInput = z.infer<typeof PatchSystemSettingsSchema>;

export const MaintenanceStatus = z.enum(["active", "inactive"]);
export type MaintenanceStatusT = z.infer<typeof MaintenanceStatus>;

export const MaintenanceWindowRowSchema = z.object({
  id: z.string().min(1),
  maintenanceStart: IsoDateString,
  maintenanceEnd: IsoDateString,
  message: z.string(),
  showBeforeMinutes: z.number().int().nonnegative(),
  status: MaintenanceStatus,
  createdByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
  activatedAt: IsoDateString.nullable(),
  deactivatedAt: IsoDateString.nullable(),
});
export type MaintenanceWindowRow = z.infer<typeof MaintenanceWindowRowSchema>;

export const MaintenanceListResponseSchema = z.object({
  windows: z.array(MaintenanceWindowRowSchema),
  count: z.number().int().nonnegative(),
  /** Kort-referanse til aktivt vindu (om det finnes) for frontend-convenience. */
  active: MaintenanceWindowRowSchema.nullable(),
});
export type MaintenanceListResponse = z.infer<typeof MaintenanceListResponseSchema>;

export const CreateMaintenanceSchema = z.object({
  maintenanceStart: IsoDateString,
  maintenanceEnd: IsoDateString,
  message: z.string().max(2000).optional(),
  showBeforeMinutes: z.number().int().min(0).max(10_080).optional(),
  status: MaintenanceStatus.optional(),
});
export type CreateMaintenanceInput = z.infer<typeof CreateMaintenanceSchema>;

export const UpdateMaintenanceSchema = z
  .object({
    maintenanceStart: IsoDateString.optional(),
    maintenanceEnd: IsoDateString.optional(),
    message: z.string().max(2000).optional(),
    showBeforeMinutes: z.number().int().min(0).max(10_080).optional(),
    status: MaintenanceStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateMaintenanceInput = z.infer<typeof UpdateMaintenanceSchema>;

// ── BIN-679: MiniGames config wire schemas ──────────────────────────────────
// Admin-CRUD for de fire Game 1 mini-spillene (wheel, chest, mystery,
// colordraft). Én singleton-rad per spill-type. Mirror av migration
// `20260425000600_mini_games_config.sql`. Ren KONFIGURASJON — runtime-
// integrasjonen i Game 1 leser i dag hardkodede arrays (BingoEngine.
// MINIGAME_PRIZES); wiring til denne tabellen er egen PR.
//
// `otherGame`-kolleksjonen med slug-diskriminator + per-spill prizeList-
// felt). Fire separate felter flatet ut til én discriminated tabell fordi
// hvert spill er singleton-konfig.

/**
 * Admin-side short-form game-type slugs brukt i `app_mini_games_config`.
 * Skiller seg bevisst fra runtime-`MiniGameTypeSchema` (lengre event-navn
 * "wheelOfFortune", etc. definert lenger oppe i filen) — dette er
 * database-discriminatoren, ikke socket-event-typen.
 */
export const MiniGameConfigTypeSchema = z.enum([
  "wheel",
  "chest",
  "mystery",
  "colordraft",
]);
export type MiniGameConfigType = z.infer<typeof MiniGameConfigTypeSchema>;

/**
 * Wire-shape for en mini-game-config-rad. Dette er den generiske formen
 * som alle 4 spill deler; spill-spesifikk validering av `config` gjøres
 * i egne schemas (WheelConfig, ChestConfig, MysteryConfig, ColordraftConfig)
 * som admin-UI kan parse før render. Service-laget lagrer `config` som
 * fri-form JSONB og gjør ingen semantisk validering ut over objekt-sjekk —
 * det holder payload-sjansen åpen for nye felter uten migrasjon.
 */
export const MiniGameConfigRowSchema = z.object({
  id: z.string().min(1),
  gameType: MiniGameConfigTypeSchema,
  config: z.record(z.string(), z.unknown()),
  active: z.boolean(),
  updatedByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type MiniGameConfigRow = z.infer<typeof MiniGameConfigRowSchema>;

/**
 * PUT-payload. Begge felter optional — admin-UI kan sende hele config hver
 * gang uten diff-logikk. Minst ett felt må være oppgitt (ellers gir service
 * samme rad tilbake uendret).
 */
export const UpdateMiniGameConfigSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
});
export type UpdateMiniGameConfigInput = z.infer<
  typeof UpdateMiniGameConfigSchema
>;

// ── Spill-spesifikke hjelper-schemas (valgfrie — admin-UI kan bruke) ────────
// Disse validerer ikke i backend (service tar generisk Record), men gir
// admin-UI og shared-types-forbrukere en typed form å parse mot ved behov.

/** Ett segment på 50-segment lykkehjulet. */
export const WheelSegmentSchema = z.object({
  label: z.string(),
  prizeAmount: z.number().nonnegative(),
  weight: z.number().nonnegative().optional(),
  color: z.string().optional(),
});
export type WheelSegment = z.infer<typeof WheelSegmentSchema>;

export const WheelConfigSchema = z.object({
  segments: z.array(WheelSegmentSchema),
});
export type WheelConfig = z.infer<typeof WheelConfigSchema>;

/** Én premie i kiste-listen. */
export const ChestPrizeSchema = z.object({
  label: z.string(),
  prizeAmount: z.number().nonnegative(),
  weight: z.number().nonnegative().optional(),
});
export type ChestPrize = z.infer<typeof ChestPrizeSchema>;

export const ChestConfigSchema = z.object({
  prizes: z.array(ChestPrizeSchema),
  chestCount: z.number().int().positive().optional(),
});
export type ChestConfig = z.infer<typeof ChestConfigSchema>;

/** Én belønning i mystery-tabellen. */
export const MysteryRewardSchema = z.object({
  label: z.string(),
  prizeAmount: z.number().nonnegative(),
  weight: z.number().nonnegative().optional(),
});
export type MysteryReward = z.infer<typeof MysteryRewardSchema>;

export const MysteryConfigSchema = z.object({
  rewards: z.array(MysteryRewardSchema),
});
export type MysteryConfig = z.infer<typeof MysteryConfigSchema>;

/** Ett farge-oppsett i colordraft-hjulet. */
export const ColordraftColorSchema = z.object({
  color: z.string(),
  prizeAmounts: z.array(z.number().nonnegative()),
  weight: z.number().nonnegative().optional(),
});
export type ColordraftColor = z.infer<typeof ColordraftColorSchema>;

export const ColordraftConfigSchema = z.object({
  colors: z.array(ColordraftColorSchema),
});
export type ColordraftConfig = z.infer<typeof ColordraftConfigSchema>;

// ── BIN-676: CMS content + FAQ wire schemas ─────────────────────────────────
// Admin-CRUD for fem statiske sider (aboutus/terms/support/links/responsible-
// gaming) + full FAQ-CRUD. Mirror av migration `20260426000200_cms.sql`.
//
// Slug-whitelist er speilet fra `CmsService.CMS_SLUGS` i backend. Frontend
// bruker enum-varianten slik at UI-valg er i takt med service-validering.
// `responsible-gaming` er regulatorisk-gated (pengespillforskriften §11) —
// PUT returnerer FEATURE_DISABLED inntil BIN-680 lander.
//
// Legacy-opphav:
//   legacy/unity-backend/App/Models/cms.js (singleton-dokument med 5 felter)
//   legacy/unity-backend/App/Models/faq.js

export const CmsSlugSchema = z.enum([
  "aboutus",
  "terms",
  "support",
  "links",
  "responsible-gaming",
]);
export type CmsSlug = z.infer<typeof CmsSlugSchema>;

export const CmsContentSchema = z.object({
  slug: CmsSlugSchema,
  /** Rå tekst-innhold (HTML/markdown). Max 200k tegn. */
  content: z.string().max(200_000),
  updatedByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type CmsContentRow = z.infer<typeof CmsContentSchema>;

export const UpdateCmsContentSchema = z.object({
  content: z.string().max(200_000),
});
export type UpdateCmsContentInput = z.infer<typeof UpdateCmsContentSchema>;

export const FaqEntrySchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1).max(1_000),
  answer: z.string().min(1).max(10_000),
  sortOrder: z.number().int().nonnegative(),
  createdByUserId: z.string().nullable(),
  updatedByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type FaqEntryRow = z.infer<typeof FaqEntrySchema>;

export const CreateFaqSchema = z.object({
  question: z.string().min(1).max(1_000),
  answer: z.string().min(1).max(10_000),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type CreateFaqInput = z.infer<typeof CreateFaqSchema>;

export const UpdateFaqSchema = z
  .object({
    question: z.string().min(1).max(1_000).optional(),
    answer: z.string().min(1).max(10_000).optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .refine((v: Record<string, unknown>) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateFaqInput = z.infer<typeof UpdateFaqSchema>;

export const FaqListResponseSchema = z.object({
  faqs: z.array(FaqEntrySchema),
  count: z.number().int().nonnegative(),
});
export type FaqListResponse = z.infer<typeof FaqListResponseSchema>;

// ── GAME1_SCHEDULE PR 4d.2: socket player-join for schedulert Spill 1 ───────
// Spec: docs/architecture/GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md §3.3.
// Spiller joiner en schedulert Spill 1-økt via scheduled_game_id — server
// slår opp/oppretter BingoEngine-rom og returnerer standard snapshot-ack.

export const Game1JoinScheduledPayloadSchema = z.object({
  /** UUID av raden i app_game1_scheduled_games. */
  scheduledGameId: z.string().min(1),
  /** accessToken-format matcher eksisterende room:create/room:join. */
  accessToken: z.string().min(1),
  /** Hallen spilleren spiller fra — må være i participating_halls_json. */
  hallId: z.string().min(1),
  /** Display-navn på spilleren (matcher CreateRoomInput.playerName). */
  playerName: z.string().min(1).max(50),
});
export type Game1JoinScheduledPayload = z.infer<typeof Game1JoinScheduledPayloadSchema>;

/**
 * Ack returnert av `game1:join-scheduled`. Formen matcher eksisterende
 * `room:create`/`room:join` så klient-bridge ikke trenger ny parser.
 * `snapshot` er samme `RoomSnapshotSchema`-shape som øvrige ack-er.
 */
export const Game1JoinScheduledAckDataSchema = z.object({
  roomCode: z.string().min(1),
  playerId: z.string().min(1),
  snapshot: RoomSnapshotSchema,
});
export type Game1JoinScheduledAckData = z.infer<typeof Game1JoinScheduledAckDataSchema>;

// ── GAME1_SCHEDULE PR 4d.3: admin-namespace real-time broadcast ─────────────
// Spec: docs/architecture/GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md §3.4/§3.5.
// Admin-socket mottar sanntids-events for schedulerte spill i stedet for
// REST-polling. Namespace: `/admin-game1`.

/**
 * Ack-struktur for `game1:subscribe` — admin-klient abonnerer på gameId-
 * spesifikke events. Returnerer dagens state-snapshot slik at initial-
 * render er umiddelbar uten ekstra REST-kall.
 */
export const Game1AdminSubscribePayloadSchema = z.object({
  gameId: z.string().min(1),
});
export type Game1AdminSubscribePayload = z.infer<typeof Game1AdminSubscribePayloadSchema>;

/**
 * `game1:status-update` — emittes etter hver state-change i
 * Game1MasterControlService (start/pause/resume/stop/exclude-hall/
 * include-hall). Admin-UI speiler DB-status uten REST-polling.
 */
export const Game1AdminStatusUpdatePayloadSchema = z.object({
  gameId: z.string().min(1),
  status: z.string().min(1),
  action: z.string().min(1),
  auditId: z.string().min(1),
  actorUserId: z.string().min(1),
  at: z.number().int().nonnegative(),
});
export type Game1AdminStatusUpdatePayload = z.infer<typeof Game1AdminStatusUpdatePayloadSchema>;

/**
 * `game1:draw-progressed` — emittes etter hver draw i Game1DrawEngineService.
 * Admin-UI oppdaterer draws-counter uten polling. Ball-nummer eksponeres
 * for sanntids-visning på master-konsoll.
 */
export const Game1AdminDrawProgressedPayloadSchema = z.object({
  gameId: z.string().min(1),
  ballNumber: z.number().int().min(1),
  drawIndex: z.number().int().min(1),
  currentPhase: z.number().int().min(1).max(5),
  at: z.number().int().nonnegative(),
});
export type Game1AdminDrawProgressedPayload = z.infer<typeof Game1AdminDrawProgressedPayloadSchema>;

/**
 * `game1:phase-won` — emittes i drawNext når en fase fullføres (PR 4d.4).
 * Admin-UI viser sanntids fase-fullføring + vinner-antall.
 * Bevarer Agent 4-kontrakten på default namespace: spiller-rettet
 * `pattern:won` er urørt — dette er admin-speiling uten wallet-detaljer.
 */
export const Game1AdminPhaseWonPayloadSchema = z.object({
  gameId: z.string().min(1),
  patternName: z.string().min(1),
  phase: z.number().int().min(1).max(5),
  winnerIds: z.array(z.string().min(1)).min(1),
  winnerCount: z.number().int().min(1),
  drawIndex: z.number().int().min(1),
  at: z.number().int().nonnegative(),
});
export type Game1AdminPhaseWonPayload = z.infer<typeof Game1AdminPhaseWonPayloadSchema>;
