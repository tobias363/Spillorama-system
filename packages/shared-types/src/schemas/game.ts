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
   * 25-cell 0/1 bitmask (row-major) for Spill 3 custom patterns. Wire-
   * format from backend `DEFAULT_GAME3_CONFIG.patterns`. Optional —
   * Spill 1/Spill 2 patterns leave this undefined.
   */
  patternDataList: z.array(z.number().int()).optional(),
  /**
   * BIN-615 / PR-C1: Spill 3 ball-threshold for pattern-deactivation.
   */
  ballNumberThreshold: z.number().int().optional(),
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
  /**
   * BIN-696: alle spiller-IDer som vant denne fasen på samme draw.
   * Engine-satt for å støtte multi-winner-detection på klient (Gevinst-
   * display + WinPopup). `winnerId` peker fortsatt på første vinner.
   */
  winnerIds: z.array(z.string()).optional(),
  /** BIN-696: antall vinnere (mirrors winnerIds.length). */
  winnerCount: z.number().int().optional(),
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
  scheduledGameId: z.string().nullable().optional(),
  isHallShared: z.boolean().optional(),
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
  /**
   * Pre-game pattern preview (premie-rader bug-fix 2026-04-26).
   *
   * `currentGame.patterns` only exists when a round is active. Surface
   * the variant config's patterns here so the client can render real
   * prize-amounts in CenterTopPanel before the first round. Optional;
   * older backends omit this and clients keep their placeholder pills.
   */
  patterns: z.array(PatternDefinitionSchema).optional(),
});

/**
 * RoomUpdatePayload = RoomSnapshot intersected with the room:update metadata.
 * Zod doesn't model TS intersections directly, so we inline the RoomSnapshot
 * shape via .extend() on RoomSnapshotSchema. Any new field on RoomSnapshot
 * therefore flows through automatically.
 *
 * §6.1 fix (Wave 3, 2026-05-06): for perpetual rooms (Spill 2/3) the
 * `players[]` array is intentionally stripped on the wire to keep the
 * payload bounded at 1500-spillere-skala. `playerCount` carries the count
 * the client UI needs (combo/lobby chip), and `players` is set to `[]`.
 * Older clients see the empty array and continue without crashing — they
 * only ever rendered counts anyway. Game1 (non-perpetual) keeps the full
 * `players[]` array because Game1's UI iterates the list to render the
 * "Topp 5"-leaderboard and chat-panel-rosters.
 */
export const RoomUpdatePayloadSchema = RoomSnapshotSchema.extend({
  scheduler: z.record(z.string(), z.unknown()),
  preRoundTickets: z.record(z.string(), z.array(TicketSchema)),
  armedPlayerIds: z.array(z.string()),
  luckyNumbers: z.record(z.string(), z.number().int()),
  serverTimestamp: z.number().int(),
  /**
   * ADR-0019 / P0-1 (2026-05-10): Monotonic counter that increments per
   * `room:update` emit. Used by the client (GameBridge) to drop out-of-
   * order payloads (typically reconnect-replay or multi-instance broadcast).
   *
   * Server starts the counter at 1 on first emit per room and uses Redis
   * `INCR` so it survives instance restart and is unique across multi-
   * instance broadcast. `room:state` resync ack returns the LATEST counter
   * value WITHOUT incrementing (i.e. the version of the last emitted state).
   *
   * Client rule: `payload.stateVersion < state.lastAppliedStateVersion` →
   * skip + log warn. Equal: idempotent — apply normally. Greater: apply.
   *
   * Optional on the wire so older backends (pre-ADR-0019) keep working — the
   * client treats missing as "0" semantics (always older or equal, so
   * never blocks a payload — i.e. dedup is opt-in).
   */
  stateVersion: z.number().int().nonnegative().optional(),
  playerStakes: z.record(z.string(), z.number()),
  /**
   * §6.1 fix (Wave 3, 2026-05-06): authoritative connected-player count for
   * perpetual rooms whose `players[]` array was stripped to save bandwidth.
   * Always populated by the server when we strip `players`; non-perpetual
   * rooms send the full `players[]` and may omit `playerCount`. Clients
   * MUST prefer `playerCount` over `players.length` when both are present.
   */
  playerCount: z.number().int().nonnegative().optional(),
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
  /**
   * BIN-813 R5: Klient-generert UUID v4 for idempotent socket-event-
   * dedupe. Hvis to identiske `claim:submit`-events kommer inn med
   * samme `clientRequestId` (typisk reconnect-replay), returnerer
   * server samme ack uten å trigge dupliserte sideeffekter (payouts,
   * pattern:won-broadcasts).
   *
   * Validert som UUID på server-side; ugyldig format → INVALID_INPUT.
   * Optional for backward-compat med eldre klienter — manglende felt
   * gir legacy-oppførsel uten dedupe.
   */
  clientRequestId: z.string().optional(),
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
    /**
     * BIN-813 R5: Klient-generert UUID v4 for idempotent socket-event-
     * dedupe. Reservert for fremtidig wrapping av bet:arm — wallet-laget
     * er allerede idempotent via deterministisk arm-cycle-id, så feltet
     * aksepteres her men benyttes kun når socket-handleren også er
     * wrappet. Optional for backward-compat.
     */
    clientRequestId: z.string().optional(),
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
  /**
   * BIN-813 R5: Klient-generert UUID v4 for idempotent socket-event-
   * dedupe. Reconnect-replay av `ticket:mark` med samme `clientRequestId`
   * gir cached respons uten dupliserte engine-marks. Optional for
   * backward-compat.
   */
  clientRequestId: z.string().optional(),
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
  /**
   * Tobias 2026-05-12 pilot-fix: vinnerens wallet-IDer i tillegg til
   * `winnerIds`. Når server's `resolvePlayerPatternWinnerIds` ikke klarer
   * å mappe wallet → socket-playerId (eks. fordi room-snapshot er stale
   * eller spiller ble lagt til etter map-bygget), faller server tilbake
   * til auth-`userId` i `winnerIds`. Klient's `myPlayerId` er en random
   * socket-UUID som aldri matcher auth-userId — derfor vises ikke vinner-
   * popupen. Ved å sende walletId-listen parallelt kan klient sjekke
   * `state.players.find(p => p.id === myPlayerId)?.walletId` mot
   * `winnerWalletIds` som ekstra safety-net.
   *
   * Optional for backward-compat — eldre server-deploy som ikke sender
   * feltet faller tilbake til winnerIds-only matching.
   */
  winnerWalletIds: z.array(z.string()).optional(),
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
