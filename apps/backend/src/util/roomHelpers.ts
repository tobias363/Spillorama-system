/**
 * Room-level helper functions for building payloads and resolving room state.
 * Extracted from index.ts. Stateless — all mutable data is passed as arguments.
 */
import type { RoomSnapshot, RoomSummary, Ticket } from "../game/types.js";
import type { DrawScheduler } from "../draw-engine/DrawScheduler.js";
import type { BingoSchedulerSettings } from "./bingoSettings.js";
import type { GameVariantConfig, TicketTypeConfig } from "../game/variantConfig.js";
import { getDefaultVariantConfig } from "../game/variantConfig.js";
import { roundCurrency } from "./currency.js";

// ── Room priority ──────────────────────────────────────────────────────────────

export function compareRoomPriority(a: RoomSummary, b: RoomSummary): number {
  const runA = a.gameStatus === "RUNNING" ? 1 : 0;
  const runB = b.gameStatus === "RUNNING" ? 1 : 0;
  if (runA !== runB) return runB - runA;
  if (a.playerCount !== b.playerCount) return b.playerCount - a.playerCount;
  const createdA = Date.parse(a.createdAt);
  const createdB = Date.parse(b.createdAt);
  const normA = Number.isFinite(createdA) ? createdA : Number.MAX_SAFE_INTEGER;
  const normB = Number.isFinite(createdB) ? createdB : Number.MAX_SAFE_INTEGER;
  if (normA !== normB) return normA - normB;
  return a.code.localeCompare(b.code);
}

export function getPrimaryRoomForHall(hallId: string, summaries: RoomSummary[]): RoomSummary | null {
  const hallSummaries = summaries.filter((summary) => summary.hallId === hallId);
  if (hallSummaries.length === 0) return null;
  hallSummaries.sort(compareRoomPriority);
  return hallSummaries[0];
}

export function findPlayerInRoomByWallet(
  snapshot: RoomSnapshot,
  walletId: string
): RoomSnapshot["players"][number] | null {
  const normalizedWalletId = walletId.trim();
  if (!normalizedWalletId) return null;
  return snapshot.players.find((player) => player.walletId === normalizedWalletId) ?? null;
}

// ── Scheduler state ────────────────────────────────────────────────────────────

export function buildRoomSchedulerState(
  snapshot: RoomSnapshot,
  nowMs: number,
  opts: {
    runtimeBingoSettings: BingoSchedulerSettings;
    drawScheduler: DrawScheduler;
    bingoMaxDrawsPerRound: number;
    schedulerTickMs: number;
    getArmedPlayerIds: (roomCode: string) => string[];
    getRoomConfiguredEntryFee: (roomCode: string) => number;
  }
): Record<string, unknown> {
  const { runtimeBingoSettings, drawScheduler, bingoMaxDrawsPerRound, schedulerTickMs, getArmedPlayerIds, getRoomConfiguredEntryFee } = opts;

  const nextStartAtMs = runtimeBingoSettings.autoRoundStartEnabled
    ? drawScheduler.normalizeNextAutoStartAt(snapshot.code, nowMs)
    : null;
  const millisUntilNextStart = nextStartAtMs === null ? null : Math.max(0, nextStartAtMs - nowMs);
  const canStartNow =
    runtimeBingoSettings.autoRoundStartEnabled &&
    snapshot.currentGame?.status !== "RUNNING" &&
    snapshot.players.length >= runtimeBingoSettings.autoRoundMinPlayers &&
    millisUntilNextStart !== null &&
    millisUntilNextStart <= Math.max(1000, schedulerTickMs * 2);

  const currentDrawCount = snapshot.currentGame?.drawnNumbers?.length ?? 0;

  return {
    enabled: runtimeBingoSettings.autoRoundStartEnabled,
    liveRoundsIndependentOfBet: true,
    intervalMs: runtimeBingoSettings.autoRoundStartIntervalMs,
    minPlayers: runtimeBingoSettings.autoRoundMinPlayers,
    playerCount: snapshot.players.length,
    armedPlayerCount: getArmedPlayerIds(snapshot.code).length,
    armedPlayerIds: getArmedPlayerIds(snapshot.code),
    entryFee: getRoomConfiguredEntryFee(snapshot.code),
    payoutPercent: runtimeBingoSettings.payoutPercent,
    drawCapacity: bingoMaxDrawsPerRound,
    currentDrawCount,
    remainingDrawCapacity: Math.max(0, bingoMaxDrawsPerRound - currentDrawCount),
    nextStartAt: nextStartAtMs === null ? null : new Date(nextStartAtMs).toISOString(),
    millisUntilNextStart,
    canStartNow,
    serverTime: new Date(nowMs).toISOString(),
    /** BIN-451: Draw count after which the client must disable buy-more. */
    disableBuyAfterBalls: Math.floor(bingoMaxDrawsPerRound * 0.8),
  };
}

// ── Room update payload ────────────────────────────────────────────────────────

export type RoomUpdatePayload = RoomSnapshot & {
  scheduler: Record<string, unknown>;
  preRoundTickets: Record<string, Ticket[]>;
  /** Player IDs who have explicitly armed (bet:arm) for the next round. */
  armedPlayerIds: string[];
  luckyNumbers: Record<string, number>;
  serverTimestamp: number;
  /**
   * Server-authoritative stake per player (in kroner).
   * Clients display this directly — no client-side calculation needed.
   *
   * Only populated for players with an active stake:
   *   - RUNNING game → participant's ticket cost (entryFee × priceMultiplier per ticket)
   *   - Between rounds + armed → projected cost for next round
   * Players with 0 stake are omitted (absence = "—" / no stake).
   */
  playerStakes: Record<string, number>;
  /** BIN-443: Game variant info for the client's purchase UI. */
  gameVariant?: {
    gameType: string;
    ticketTypes: TicketTypeConfig[];
    replaceAmount?: number;
    /**
     * F3 (BIN-431): Jackpot header info. Propagated from variant config;
     * client shows `{drawThreshold} Jackpot : {prize} kr` when isDisplay=true.
     * Unity: Game1GamePlayPanel.SocketFlow.cs:518-520.
     */
    jackpot?: {
      drawThreshold: number;
      prize: number;
      isDisplay: boolean;
    };
  };
};

export function buildRoomUpdatePayload(
  snapshot: RoomSnapshot,
  nowMs: number,
  opts: {
    runtimeBingoSettings: BingoSchedulerSettings;
    drawScheduler: DrawScheduler;
    bingoMaxDrawsPerRound: number;
    schedulerTickMs: number;
    getArmedPlayerIds: (roomCode: string) => string[];
    getArmedPlayerTicketCounts: (roomCode: string) => Record<string, number>;
    getArmedPlayerSelections?: (roomCode: string) => Record<string, Array<{ type: string; qty: number }>>;
    getRoomConfiguredEntryFee: (roomCode: string) => number;
    getOrCreateDisplayTickets: (roomCode: string, playerId: string, count: number, gameSlug?: string) => Ticket[];
    getLuckyNumbers: (roomCode: string) => Record<string, number>;
    /** BIN-443: Variant config for client purchase UI. */
    getVariantConfig?: (roomCode: string) => { gameType: string; config: GameVariantConfig } | null;
    /**
     * G15 (BIN-431): sync hall-name lookup for ticket-detail enrichment.
     * Backed by an in-memory cache populated at room-create/join. Falls back
     * to hallId when the cache misses.
     */
    getHallName?: (hallId: string) => string | null;
    /**
     * G15 (BIN-431): supplier/operator brand name stamped onto tickets.
     * Optional — defaults to "Spillorama" when not provided.
     */
    supplierName?: string;
  }
): RoomUpdatePayload {
  const { getOrCreateDisplayTickets, getLuckyNumbers, runtimeBingoSettings } = opts;

  // Generate display tickets for players who are in the room but didn't
  // get game tickets (not armed). This ensures their boards always show
  // numbers — just without marking.
  // For armed players, use their chosen ticket count.
  const preRoundTickets: Record<string, Ticket[]> = {};
  const gameTickets = snapshot.currentGame?.tickets ?? {};
  const ticketsPerPlayer = runtimeBingoSettings.autoRoundTicketsPerPlayer;
  const armedTicketCounts = opts.getArmedPlayerTicketCounts(snapshot.code);
  for (const player of snapshot.players) {
    if (gameTickets[player.id] && gameTickets[player.id].length > 0) continue;
    const playerTicketCount = armedTicketCounts[player.id] ?? ticketsPerPlayer;
    preRoundTickets[player.id] = getOrCreateDisplayTickets(snapshot.code, player.id, playerTicketCount, snapshot.gameSlug);
  }

  // BIN-443: Include variant info so client can show correct purchase UI.
  // Fall back to default standard config so client always receives ticket types.
  const variantInfo = opts.getVariantConfig?.(snapshot.code);
  const effectiveGameType = variantInfo?.gameType ?? "standard";
  const effectiveConfig = variantInfo?.config ?? getDefaultVariantConfig(effectiveGameType);
  const gameVariant = {
    gameType: effectiveGameType,
    ticketTypes: effectiveConfig.ticketTypes,
    replaceAmount: effectiveConfig.replaceAmount,
    // F3 (BIN-431): Propagate jackpot info from variant config → client HeaderBar.
    jackpot: effectiveConfig.jackpot,
  };

  // ── G15 (BIN-431): Enrich tickets with detail fields for flip-to-details ───
  // Unity BingoTicket.cs:374-399 displays ticketNumber, hallName, supplierName,
  // price on tap/flip. Fields are all optional/non-breaking — we populate them
  // here (display-only; not persisted to the adapter) so every emitted tickets
  // payload carries them without touching BingoEngine's ticket-creation flow.
  const hallName = opts.getHallName?.(snapshot.hallId) ?? snapshot.hallId;
  const supplierName = opts.supplierName ?? "Spillorama";
  const boughtAtIso = new Date(nowMs).toISOString();
  const currentEntryFee = snapshot.currentGame?.entryFee ?? opts.getRoomConfiguredEntryFee(snapshot.code);

  function enrichTicketList(list: Ticket[], fee: number): Ticket[] {
    return list.map((t, idx) => {
      const tt = effectiveConfig.ticketTypes.find((x: TicketTypeConfig) => x.type === t.type);
      const price = roundCurrency(fee * (tt?.priceMultiplier ?? 1));
      return {
        ...t,
        ticketNumber: t.ticketNumber ?? t.id ?? String(idx + 1),
        hallName: t.hallName ?? hallName,
        supplierName: t.supplierName ?? supplierName,
        price: t.price ?? price,
        boughtAt: t.boughtAt ?? boughtAtIso,
      };
    });
  }

  // Enrich in-game tickets (per player)
  const enrichedGameTickets: Record<string, Ticket[]> = {};
  for (const [pid, list] of Object.entries(gameTickets)) {
    enrichedGameTickets[pid] = enrichTicketList(list, currentEntryFee);
  }
  // Enrich pre-round tickets (per player)
  const enrichedPreRound: Record<string, Ticket[]> = {};
  for (const [pid, list] of Object.entries(preRoundTickets)) {
    enrichedPreRound[pid] = enrichTicketList(list, opts.getRoomConfiguredEntryFee(snapshot.code));
  }

  // ── Server-authoritative stake per player ──────────────────────────────────
  // Calculated here so the client never has to derive monetary amounts itself.
  // Rules mirror StakeCalculator.ts but are the single source of truth.
  const armedPlayerIds = opts.getArmedPlayerIds(snapshot.code);
  const armedPlayerSelections = opts.getArmedPlayerSelections?.(snapshot.code) ?? {};
  const isGameRunning = snapshot.currentGame?.status === "RUNNING";
  const playerStakes: Record<string, number> = {};

  for (const player of snapshot.players) {
    let tickets: Ticket[] = [];
    let fee = 0;

    if (isGameRunning && gameTickets[player.id]?.length > 0) {
      // Active game participant — stake from actual game tickets & game's entry fee.
      tickets = gameTickets[player.id];
      fee = snapshot.currentGame!.entryFee;
    } else if (armedPlayerIds.includes(player.id)) {
      // Armed for next round — stake from pre-round tickets & room's configured fee.
      tickets = preRoundTickets[player.id] ?? [];
      fee = opts.getRoomConfiguredEntryFee(snapshot.code);
    }

    if (fee > 0) {
      // If the player has per-type selections (armed phase), use those for precise pricing
      const selections = armedPlayerSelections[player.id];
      if (!isGameRunning && selections && selections.length > 0) {
        const ticketTypes = effectiveConfig.ticketTypes;
        playerStakes[player.id] = roundCurrency(
          selections.reduce((sum, sel) => {
            const tt = ticketTypes.find((x: TicketTypeConfig) => x.type === sel.type);
            return sum + fee * (tt?.priceMultiplier ?? 1) * sel.qty;
          }, 0),
        );
      } else if (tickets.length > 0) {
        // Running game or legacy arm — calculate from actual tickets
        const ticketTypes = effectiveConfig.ticketTypes;
        playerStakes[player.id] = roundCurrency(
          tickets.reduce((sum, t) => {
            const tt = ticketTypes.find((x: TicketTypeConfig) => x.type === t.type);
            return sum + fee * (tt?.priceMultiplier ?? 1);
          }, 0),
        );
      }
    }
  }

  // G15 (BIN-431): swap in the enriched ticket maps so both the live game
  // snapshot and the pre-round display list carry detail fields on the wire.
  const outSnapshot = snapshot.currentGame
    ? { ...snapshot, currentGame: { ...snapshot.currentGame, tickets: enrichedGameTickets } }
    : snapshot;

  return {
    ...outSnapshot,
    preRoundTickets: enrichedPreRound,
    armedPlayerIds,
    playerStakes,
    luckyNumbers: getLuckyNumbers(snapshot.code),
    scheduler: buildRoomSchedulerState(snapshot, nowMs, opts),
    serverTimestamp: nowMs,
    gameVariant,
  };
}

// ── Leaderboard ────────────────────────────────────────────────────────────────

export function buildLeaderboard(
  roomCodes: string[],
  getRoomSnapshot: (code: string) => RoomSnapshot
): Array<{ nickname: string; points: number }> {
  const pointsByPlayer = new Map<string, { name: string; points: number }>();

  for (const code of roomCodes) {
    let snapshot: RoomSnapshot;
    try { snapshot = getRoomSnapshot(code); } catch { continue; }

    const nameById = new Map<string, string>();
    for (const p of snapshot.players) nameById.set(p.id, p.name);

    for (const game of snapshot.gameHistory) {
      for (const claim of game.claims) {
        if (!claim.valid) continue;
        const pts = claim.type === "BINGO" ? 2 : 1;
        const existing = pointsByPlayer.get(claim.playerId);
        const name = nameById.get(claim.playerId) ?? claim.playerId;
        if (existing) {
          existing.points += pts;
          if (!existing.name || existing.name === claim.playerId) existing.name = name;
        } else {
          pointsByPlayer.set(claim.playerId, { name, points: pts });
        }
      }
    }
  }

  return [...pointsByPlayer.values()]
    .sort((a, b) => b.points - a.points)
    .slice(0, 50)
    .map(({ name, points }) => ({ nickname: name, points }));
}
