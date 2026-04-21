/**
 * BIN-647: Subgame drill-down report — pure aggregate builder.
 *
 * Legacy reference:
 *   (`getGame1Subgames`) renders
 *   rows with `gameNumber`, `gameMode`, `startDate`, `gameName`, `halls`,
 *   `ticketSold`, `earnedFromTickets`, `totalWinning`, `finalGameProfitAmount`
 *   and a computed `profitPercentage`.
 *
 * Input model:
 *   - Parent row in `hall_game_schedules` (`id = parentId`).
 *   - Children (sub-games) in `hall_game_schedules` where
 *     `parent_schedule_id = parentId`, ordered by `sub_game_sequence`.
 *   - Compliance-ledger events (`app_rg_compliance_ledger`) are the revenue
 *     source. Each child's revenue/players are aggregated from ledger rows
 *     linked via `hall_schedule_log.schedule_slot_id` → `game_session_id`
 *     → `app_rg_compliance_ledger.game_id`.
 *
 * This file is pure — no DB I/O. The route wires up the DB lookups and
 * feeds the results here. Same pattern as `adminTrackSpending.ts` so the two
 * rapporter-routes can share test/style conventions.
 */
import type { ScheduleSlot, HallDefinition, ScheduleLogEntry } from "../../platform/PlatformService.js";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";

export interface SubgameDrillDownItem {
  subGameId: string;
  subGameNumber: string | null;
  parentScheduleId: string;
  hallId: string;
  hallName: string;
  gameType: string;
  gameMode: string | null;
  name: string;
  sequence: number | null;
  startDate: string | null;
  revenue: number;
  totalWinnings: number;
  netProfit: number;
  profitPercentage: number;
  ticketCount: number;
  players: number;
}

export interface SubgameDrillDownTotals {
  revenue: number;
  totalWinnings: number;
  netProfit: number;
  ticketCount: number;
  players: number;
}

export interface SubgameDrillDownResult {
  parentId: string;
  from: string;
  to: string;
  items: SubgameDrillDownItem[];
  nextCursor: string | null;
  totals: SubgameDrillDownTotals;
}

export interface SubgameDrillDownInput {
  parentId: string;
  /** All sub-game (child) rows linked to `parentId`, pre-sorted by sequence. */
  children: ScheduleSlot[];
  /** Scheduled-game-log rows — used to tie child scheduleSlot → game_session_id. */
  scheduleLogs: ScheduleLogEntry[];
  /** Compliance-ledger events for the requested window (already hall-scoped). */
  entries: ComplianceLedgerEntry[];
  /** Hall definitions for name lookup. */
  halls: HallDefinition[];
  /** Inclusive ISO window. */
  from: string;
  to: string;
  /** Opaque offset cursor; absent = start at 0. */
  cursor?: string;
  /** Page size; default 50, max 500. */
  pageSize?: number;
}

/** Opaque-cursor helpers (offset-based, same style as BIN-628). */
function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): number {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  } catch {
    return 0;
  }
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertIsoWindow(from: string, to: string): { fromMs: number; toMs: number } {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs)) {
    throw new Error(`[BIN-647] Ugyldig 'from': ${from}`);
  }
  if (!Number.isFinite(toMs)) {
    throw new Error(`[BIN-647] Ugyldig 'to': ${to}`);
  }
  if (fromMs > toMs) {
    throw new Error(`[BIN-647] 'from' må være <= 'to' (${from} > ${to}).`);
  }
  return { fromMs, toMs };
}

/**
 * Group ledger entries by the `game_id` they belong to, then aggregate per
 * sub-game by joining via schedule-log rows. One sub-game can have many
 * game-sessions (played multiple times); we sum across all of them in the
 * requested window.
 */
interface SubGameAggregate {
  stakeSum: number;
  prizeSum: number;
  stakeCount: number;
  players: Set<string>;
  earliestStart: number | null;
}

function emptyAggregate(): SubGameAggregate {
  return { stakeSum: 0, prizeSum: 0, stakeCount: 0, players: new Set(), earliestStart: null };
}

/**
 * Build drill-down rows for every child sub-game of the given parent.
 *
 * Empty window ⇒ still returns one row per child (all zeros). Legacy behaviour
 * matches: the DataTable renders all children regardless of activity so admin
 * can see "configured but never played" sub-games.
 */
export function buildSubgameDrillDown(input: SubgameDrillDownInput): SubgameDrillDownResult {
  const { fromMs, toMs } = assertIsoWindow(input.from, input.to);
  const pageSize = Math.max(1, Math.min(500, Math.floor(input.pageSize ?? 50)));
  const cursorOffset = input.cursor ? decodeCursor(input.cursor) : 0;

  const hallsById = new Map<string, HallDefinition>();
  for (const hall of input.halls) hallsById.set(hall.id, hall);

  // Index: scheduleSlotId → [gameSessionId...] from the log.
  const slotToGameSessions = new Map<string, Set<string>>();
  for (const log of input.scheduleLogs) {
    if (!log.scheduleSlotId || !log.gameSessionId) continue;
    let set = slotToGameSessions.get(log.scheduleSlotId);
    if (!set) {
      set = new Set<string>();
      slotToGameSessions.set(log.scheduleSlotId, set);
    }
    set.add(log.gameSessionId);
  }

  // Index: gameSessionId → ledger rows (filtered to window).
  const entriesByGameId = new Map<string, ComplianceLedgerEntry[]>();
  for (const entry of input.entries) {
    if (!entry.gameId) continue;
    if (entry.createdAtMs < fromMs || entry.createdAtMs > toMs) continue;
    let list = entriesByGameId.get(entry.gameId);
    if (!list) {
      list = [];
      entriesByGameId.set(entry.gameId, list);
    }
    list.push(entry);
  }

  // Stable ordering: honour caller-supplied children order (sub_game_sequence),
  // fall back to id for determinism.
  const sortedChildren = input.children
    .slice()
    .sort((a, b) => {
      const seqA = a.subGameSequence ?? Number.MAX_SAFE_INTEGER;
      const seqB = b.subGameSequence ?? Number.MAX_SAFE_INTEGER;
      if (seqA !== seqB) return seqA - seqB;
      return a.id.localeCompare(b.id);
    });

  const paged = sortedChildren.slice(cursorOffset, cursorOffset + pageSize);
  const nextOffset = cursorOffset + paged.length;
  const nextCursor = nextOffset < sortedChildren.length ? encodeCursor(nextOffset) : null;

  // Totals are computed over ALL children (not just the page) so admin sees
  // aggregate numbers for the full parent regardless of pagination position.
  const totals: SubgameDrillDownTotals = {
    revenue: 0,
    totalWinnings: 0,
    netProfit: 0,
    ticketCount: 0,
    players: 0,
  };
  const totalsPlayers = new Set<string>();

  function aggregateChild(child: ScheduleSlot): SubGameAggregate {
    const agg = emptyAggregate();
    const sessionIds = slotToGameSessions.get(child.id);
    if (!sessionIds) return agg;
    for (const sid of sessionIds) {
      const list = entriesByGameId.get(sid);
      if (!list) continue;
      for (const entry of list) {
        // Skip ORG_DISTRIBUTION — not spiller-revenue.
        if (entry.eventType === "STAKE") {
          agg.stakeSum += entry.amount;
          agg.stakeCount += 1;
          if (entry.walletId) agg.players.add(entry.walletId);
        } else if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
          agg.prizeSum += entry.amount;
        }
        if (agg.earliestStart === null || entry.createdAtMs < agg.earliestStart) {
          agg.earliestStart = entry.createdAtMs;
        }
      }
    }
    return agg;
  }

  // Build page items.
  const items: SubgameDrillDownItem[] = paged.map((child) => {
    const agg = aggregateChild(child);
    const revenue = roundCurrency(agg.stakeSum);
    const totalWinnings = roundCurrency(agg.prizeSum);
    const netProfit = roundCurrency(revenue - totalWinnings);
    const profitPercentage = revenue > 0 ? roundCurrency((netProfit / revenue) * 100) : 0;
    const hall = hallsById.get(child.hallId);
    const gameMode = typeof child.variantConfig?.gameMode === "string"
      ? (child.variantConfig.gameMode as string)
      : null;
    return {
      subGameId: child.id,
      subGameNumber: child.subGameNumber ?? null,
      parentScheduleId: child.parentScheduleId ?? input.parentId,
      hallId: child.hallId,
      hallName: hall?.name ?? child.hallId,
      gameType: child.gameType,
      gameMode,
      name: child.displayName,
      sequence: child.subGameSequence ?? null,
      startDate: agg.earliestStart !== null ? new Date(agg.earliestStart).toISOString() : null,
      revenue,
      totalWinnings,
      netProfit,
      profitPercentage,
      ticketCount: agg.stakeCount,
      players: agg.players.size,
    };
  });

  // Accumulate totals across ALL children (unpaged).
  for (const child of sortedChildren) {
    const agg = aggregateChild(child);
    totals.revenue += agg.stakeSum;
    totals.totalWinnings += agg.prizeSum;
    totals.ticketCount += agg.stakeCount;
    for (const w of agg.players) totalsPlayers.add(w);
  }
  totals.revenue = roundCurrency(totals.revenue);
  totals.totalWinnings = roundCurrency(totals.totalWinnings);
  totals.netProfit = roundCurrency(totals.revenue - totals.totalWinnings);
  totals.players = totalsPlayers.size;

  return {
    parentId: input.parentId,
    from: input.from,
    to: input.to,
    items,
    nextCursor,
    totals,
  };
}
