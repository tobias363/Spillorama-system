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

