/**
 * PR-R4: `GameEventsDeps` + `BingoSchedulerSettings` — flyttet uendret ut av
 * `gameEvents.ts`. Se README for clusterbeskrivelse.
 */
import type { Server } from "socket.io";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { PlatformService } from "../../platform/PlatformService.js";
import type { SocketRateLimiter } from "../../middleware/socketRateLimit.js";
import type { RoomSnapshot, Ticket } from "../../game/types.js";
import type { RoomUpdatePayload } from "../../util/roomHelpers.js";
import type { ChatMessage, LeaderboardEntry } from "./types.js";

export interface BingoSchedulerSettings {
  autoRoundStartEnabled: boolean;
  autoRoundStartIntervalMs: number;
  autoRoundMinPlayers: number;
  autoRoundTicketsPerPlayer: number;
  autoRoundEntryFee: number;
  payoutPercent: number;
  autoDrawEnabled: boolean;
  autoDrawIntervalMs: number;
}

export interface GameEventsDeps {
  engine: BingoEngine;
  platformService: PlatformService;
  io: Server;
  socketRateLimiter: SocketRateLimiter;
  emitRoomUpdate: (roomCode: string) => Promise<RoomUpdatePayload>;
  emitManyRoomUpdates: (roomCodes: Iterable<string>) => Promise<void>;
  buildRoomUpdatePayload: (snapshot: RoomSnapshot) => RoomUpdatePayload;
  enforceSingleRoomPerHall: boolean;
  runtimeBingoSettings: BingoSchedulerSettings;
  chatHistoryByRoom: Map<string, ChatMessage[]>;
  luckyNumbersByRoom: Map<string, Map<string, number>>;
  armedPlayerIdsByRoom: Map<string, Map<string, number>>;
  roomConfiguredEntryFeeByRoom: Map<string, number>;
  displayTicketCache: Map<string, Ticket[]>;
  getPrimaryRoomForHall: (hallId: string) => { code: string; hallId: string } | null;
  findPlayerInRoomByWallet: (snapshot: RoomSnapshot, walletId: string) => RoomSnapshot["players"][number] | null;
  getRoomConfiguredEntryFee: (roomCode: string) => number;
  getArmedPlayerIds: (roomCode: string) => string[];
  armPlayer: (roomCode: string, playerId: string, ticketCount?: number, selections?: Array<{ type: string; qty: number; name?: string }>) => void;
  getArmedPlayerTicketCounts: (roomCode: string) => Record<string, number>;
  getArmedPlayerSelections: (roomCode: string) => Record<string, Array<{ type: string; qty: number; name?: string }>>;
  disarmPlayer: (roomCode: string, playerId: string) => void;
  disarmAllPlayers: (roomCode: string) => void;
  clearDisplayTicketCache: (roomCode: string) => void;
  /**
   * BIN-690: snapshot the per-player display-ticket cache so engine.startGame
   * can adopt the exact grids the player saw while arming. Returns
   * `{ playerId: Ticket[] }` with a shallow copy so engine mutations don't
   * leak back into the cache between `startGame` and `clearDisplayTicketCache`.
   */
  getPreRoundTicketsByPlayerId?: (roomCode: string) => Record<string, Ticket[]>;
  /** BIN-509: swap one pre-round ticket in place; returns null if ticketId is unknown. */
  /** BIN-672: gameSlug required — see roomState.replaceDisplayTicket doc. */
  replaceDisplayTicket?: (roomCode: string, playerId: string, ticketId: string, gameSlug: string) => Ticket | null;
  /**
   * BIN-692: cancel a single pre-round ticket (or its whole bundle).
   * See RoomStateManager.cancelPreRoundTicket for bundle semantics.
   * Returns null when the ticketId is not in the cache (stale client).
   */
  cancelPreRoundTicket?: (
    roomCode: string,
    playerId: string,
    ticketId: string,
    variantConfig: import("../../game/variantConfig.js").GameVariantConfig,
  ) => { removedTicketIds: string[]; remainingTicketCount: number; fullyDisarmed: boolean } | null;
  /**
   * BIN-516: optional chat persistence. When provided, chat:send writes through
   * to the store and chat:history reads from it (falls back to in-memory cache
   * if absent or returns empty).
   */
  chatMessageStore?: import("../../store/ChatMessageStore.js").ChatMessageStore;
  resolveBingoHallGameConfigForRoom: (roomCode: string) => Promise<{ hallId: string; maxTicketsPerPlayer: number }>;
  requireActiveHallIdFromInput: (input: unknown) => Promise<string>;
  buildLeaderboard: (roomCode?: string) => LeaderboardEntry[];
  /** BIN-445: Get active variant config for a room (from schedule or default). */
  getVariantConfig?: (roomCode: string) => { gameType: string; config: import("../../game/variantConfig.js").GameVariantConfig } | null;
  /**
   * BIN-694: Bind the default variant config for a freshly created or
   * restored room, keyed on `gameSlug`. Idempotent — no-op when a
   * variant is already set. Callers invoke this right after
   * `engine.createRoom(...)` so `BingoEngine.meetsPhaseRequirement`
   * sees the correct Norsk-bingo pattern names (1 Rad / 2 Rader / …).
   */
  bindDefaultVariantConfig?: (roomCode: string, gameSlug: string) => void;
  /**
   * PR C: Async variant-config binder som leser admin-UI-config fra
   * GameManagement.config_json.spill1 når `gameManagementId` er gitt,
   * og faller tilbake til default ellers. Kallsteder kan sende
   * `gameManagementId: undefined` for dagens default-path og få samme
   * effekt som `bindDefaultVariantConfig` — plumbing-en forbereder
   * fremtidig scope der `gameManagementId` kommer inn på wire.
   */
  bindVariantConfigForRoom?: (
    roomCode: string,
    opts: { gameSlug: string; gameManagementId?: string | null },
  ) => Promise<void>;
  /**
   * BIN-587 B4b follow-up: spiller-side voucher-innløsning. Koblet via socket-
   * event `voucher:redeem` (og `voucher:validate` hvis `validateOnly=true`).
   * Valgfri dep så eksisterende test-harnesses ikke må wire den opp — handleren
   * returnerer `NOT_SUPPORTED` hvis den mangler.
   */
  voucherRedemptionService?: import("../../compliance/VoucherRedemptionService.js").VoucherRedemptionService;

  // ── BIN-693 Option B: Wallet-reservasjon ─────────────────────────────────

  /**
   * Wallet-adapter for reserve/release/commit-flyten (Option B). Optional
   * fordi test-servere som ikke bruker reservation-flyten kan kjøre uten.
   * Callers (bet:arm, ticket:cancel) sjekker adapter.reserve før kall.
   */
  walletAdapter?: import("../../adapters/WalletAdapter.js").WalletAdapter;

  /** BIN-693: playerId → walletId. Brukes til å finne wallet for reserve. */
  getWalletIdForPlayer?: (roomCode: string, playerId: string) => string | null;

  /** BIN-693: roomState reservation-tracking per (room, player). */
  getReservationId?: (roomCode: string, playerId: string) => string | null;
  setReservationId?: (roomCode: string, playerId: string, reservationId: string) => void;
  clearReservationId?: (roomCode: string, playerId: string) => void;

  /**
   * GAP #38: Player-initiated stop-game (Spillvett-vote). Optional dep so
   * test harnesses can wire the handler without the full service. Handler
   * returns NOT_SUPPORTED when missing.
   */
  spill1StopVoteService?: import("../../spillevett/Spill1StopVoteService.js").Spill1StopVoteService;

  /**
   * Tobias 2026-04-27: Spill 1 canonical-room-mapping er per-LINK (Group of
   * Halls). Caller må slå opp hvilken hall-gruppe `hallId` tilhører for å
   * lage `BINGO_<groupId>`-rom-koden.
   *
   * Returnerer `null` hvis hallen ikke er i noen gruppe — `getCanonicalRoomCode`
   * faller da tilbake til hallId-basert kode.
   *
   * Optional fordi test-harnesses kan kjøre uten hallGroupService — handleren
   * faller tilbake til hallId-basert canonical code (eksisterende oppførsel).
   */
  getHallGroupIdForHall?: (hallId: string) => Promise<string | null>;
}
