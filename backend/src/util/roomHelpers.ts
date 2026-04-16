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
    serverTime: new Date(nowMs).toISOString()
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
    getRoomConfiguredEntryFee: (roomCode: string) => number;
    getOrCreateDisplayTickets: (roomCode: string, playerId: string, count: number, gameSlug?: string) => Ticket[];
    getLuckyNumbers: (roomCode: string) => Record<string, number>;
    /** BIN-443: Variant config for client purchase UI. */
    getVariantConfig?: (roomCode: string) => { gameType: string; config: GameVariantConfig } | null;
  }
): RoomUpdatePayload {
  const { getOrCreateDisplayTickets, getLuckyNumbers, runtimeBingoSettings } = opts;

  // Generate display tickets for players who are in the room but didn't
  // get game tickets (not armed). This ensures their boards always show
  // numbers — just without marking.
  const preRoundTickets: Record<string, Ticket[]> = {};
  const gameTickets = snapshot.currentGame?.tickets ?? {};
  const ticketsPerPlayer = runtimeBingoSettings.autoRoundTicketsPerPlayer;
  for (const player of snapshot.players) {
    if (gameTickets[player.id] && gameTickets[player.id].length > 0) continue;
    preRoundTickets[player.id] = getOrCreateDisplayTickets(snapshot.code, player.id, ticketsPerPlayer, snapshot.gameSlug);
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
  };

  // ── Server-authoritative stake per player ──────────────────────────────────
  // Calculated here so the client never has to derive monetary amounts itself.
  // Rules mirror StakeCalculator.ts but are the single source of truth.
  const armedPlayerIds = opts.getArmedPlayerIds(snapshot.code);
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

    if (tickets.length > 0 && fee > 0) {
      const ticketTypes = effectiveConfig.ticketTypes;
      playerStakes[player.id] = roundCurrency(
        tickets.reduce((sum, t) => {
          const tt = ticketTypes.find((x: TicketTypeConfig) => x.type === t.type);
          return sum + fee * (tt?.priceMultiplier ?? 1);
        }, 0),
      );
    }
  }

  return {
    ...snapshot,
    preRoundTickets,
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
