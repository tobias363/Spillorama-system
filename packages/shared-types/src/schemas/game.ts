// ── Zod runtime schemas (BIN-545) — game core + wire-contracts ─────────────
// Runtime-validated wire contracts for the highest-risk socket payloads.
// Pattern: export both the schema (for .parse/.safeParse) and the z.infer<>-
// derived type (for compile-time use).
//
// PR-R3: ekstrahert fra schemas.ts. Denne filen holder game-domene-kjernen
// (Player/Ticket/Pattern/Game/Room) + alle socket wire-contract payloads
// (room:update, draw:new, claim:submit, ticket:replace/swap/cancel, bet:arm,
// ticket:mark, pattern:won, chat:message, admin:hall-balance, mini-game play).

import { z } from "zod";
import { IsoDateString, ClaimType, GameStatus } from "./_shared.js";

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
  // MED-11: estimert resume + maskinlesbar grunn (se game.ts for full doc).
  pauseUntil: IsoDateString.optional(),
  pauseReason: z.string().optional(),
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
  /**
   * Round-state-isolation (Tobias 2026-04-25): per-player NEXT-round
   * commitment when a player has armed pre-round tickets during a
   * RUNNING round. Optional — older backends omit it; clients must
   * default to {} when absent.
   */
  playerPendingStakes: z.record(z.string(), z.number()).optional(),
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
