/**
 * BIN-BOT-01: "Report Management Game 1" aggregate report.
 *
 * Legacy reference:
 *   - `WF_B_Spillorama Admin V1.0.pdf` p.29 (Report Management → Game 1)
 *   - `WF_B_SpilloramaBotReport_V1.0_31.01.2024.pdf` p.5-8 (By Player / By Bot)
 *
 * Returns one row per sub-game child of any parent hall_game_schedule in the
 * requested date-window, with legacy column names OMS (sum stake / ticket-price),
 * UTD (sum payout), Payout%, RES (= OMS - UTD). Filterable by group-of-hall,
 * hall, type (player|bot), and free-text search. Totals are computed over the
 * entire filtered result-set (not just the current page).
 *
 * Data join:
 *   sub-game child (hall_game_schedules, parent_schedule_id IS NOT NULL)
 *     → hall_schedule_log row (schedule_slot_id = child.id)
 *       → app_rg_compliance_ledger rows (game_id = log.game_session_id)
 *         → STAKE rows sum to OMS, PRIZE + EXTRA_PRIZE rows sum to UTD
 *
 * Bot-filter:
 *   `type=bot` expects a metadata flag (`metadata.isBot === true` on the
 *   STAKE-entry). Since bot-support is not yet implemented, the filter is
 *   accepted but returns an empty result-set when `type=bot` — it does not
 *   crash. This keeps wire-compat with the legacy UI. `type=player` (default)
 *   includes every entry (bot-flag ignored).
 *
 * This file is pure — no DB I/O. The route wires up the DB lookups and feeds
 * the results here. Mirrors the SubgameDrillDownReport pattern from BIN-647
 * so both rapporter-routes share test/style conventions.
 */

import type {
  HallDefinition,
  ScheduleLogEntry,
  ScheduleSlot,
} from "../../platform/PlatformService.js";
import type { HallGroup } from "../HallGroupService.js";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";

export type Game1ReportType = "player" | "bot";

export interface Game1ManagementReportRow {
  subGameId: string;
  subGameNumber: string | null;
  childGameId: string;
  parentScheduleId: string;
  hallId: string;
  hallName: string;
  groupOfHallId: string | null;
  groupOfHallName: string | null;
  startedAt: string | null;
  oms: number;
  utd: number;
  payoutPct: number;
  res: number;
}

export interface Game1ManagementReportTotals {
  oms: number;
  utd: number;
  payoutPct: number;
  res: number;
}

export interface Game1ManagementReportResult {
  from: string;
  to: string;
  generatedAt: string;
  type: Game1ReportType;
  rows: Game1ManagementReportRow[];
  totals: Game1ManagementReportTotals;
}

export interface Game1ManagementReportInput {
  /** All sub-game (child) rows in the window (parent_schedule_id IS NOT NULL). */
  children: ScheduleSlot[];
  /** Scheduled-game-log rows — used to tie child scheduleSlot → game_session_id. */
  scheduleLogs: ScheduleLogEntry[];
  /** Compliance-ledger events for the requested window. */
  entries: ComplianceLedgerEntry[];
  /** Hall definitions for name lookup. */
  halls: HallDefinition[];
  /** Hall-group definitions for GoH name + filtering. */
  hallGroups: HallGroup[];
  /** Inclusive ISO window. */
  from: string;
  to: string;
  /** Optional filters. */
  groupOfHallId?: string;
  hallId?: string;
  type?: Game1ReportType;
  /** Free-text search over subGameNumber / childGameId / subGameId. */
  q?: string;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertIsoWindow(from: string, to: string): { fromMs: number; toMs: number } {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs)) {
    throw new Error(`[game1-report] Ugyldig 'from': ${from}`);
  }
  if (!Number.isFinite(toMs)) {
    throw new Error(`[game1-report] Ugyldig 'to': ${to}`);
  }
  if (fromMs > toMs) {
    throw new Error(`[game1-report] 'from' må være <= 'to' (${from} > ${to}).`);
  }
  return { fromMs, toMs };
}

/**
 * Build GoH-by-hall map. A hall can theoretically be a member of multiple
 * groups; we pick the first active group the hall belongs to, matching
 * legacy behaviour where `hall.group_of_hall_name` was a denormalised string.
 */
function buildGroupByHallMap(hallGroups: HallGroup[]): Map<string, { id: string; name: string }> {
  const map = new Map<string, { id: string; name: string }>();
  for (const group of hallGroups) {
    if (group.status !== "active") continue;
    for (const member of group.members) {
      if (member.hallStatus === "inactive") continue;
      if (!map.has(member.hallId)) {
        map.set(member.hallId, { id: group.id, name: group.name });
      }
    }
  }
  return map;
}

interface Aggregate {
  stakeSum: number;
  prizeSum: number;
  earliestStart: number | null;
  hasEntries: boolean;
}

function emptyAggregate(): Aggregate {
  return { stakeSum: 0, prizeSum: 0, earliestStart: null, hasEntries: false };
}

function isBotEntry(entry: ComplianceLedgerEntry): boolean {
  const meta = entry.metadata;
  if (!meta || typeof meta !== "object") return false;
  const bot = (meta as Record<string, unknown>)["isBot"];
  return bot === true;
}

/**
 * Build the "Report Management Game 1" aggregate.
 *
 * Empty window / no activity ⇒ returns a row per filtered sub-game with
 * zero totals. Same contract as BIN-647 (drill-down): admin needs to see
 * configured-but-inactive sub-games too.
 */
export function buildGame1ManagementReport(
  input: Game1ManagementReportInput
): Game1ManagementReportResult {
  const { fromMs, toMs } = assertIsoWindow(input.from, input.to);
  const type: Game1ReportType = input.type ?? "player";
  const qNeedle = input.q?.trim().toLowerCase();
  const hallFilter = input.hallId?.trim() || undefined;
  const groupFilter = input.groupOfHallId?.trim() || undefined;

  const hallsById = new Map<string, HallDefinition>();
  for (const hall of input.halls) hallsById.set(hall.id, hall);

  const groupByHall = buildGroupByHallMap(input.hallGroups);

  // Filter children by requested scope.
  let filteredChildren = input.children.filter(
    (c) => c.parentScheduleId !== null && c.parentScheduleId !== undefined
  );
  if (hallFilter) {
    filteredChildren = filteredChildren.filter((c) => c.hallId === hallFilter);
  }
  if (groupFilter) {
    filteredChildren = filteredChildren.filter((c) => {
      const group = groupByHall.get(c.hallId);
      return group?.id === groupFilter;
    });
  }
  if (qNeedle) {
    filteredChildren = filteredChildren.filter((c) => {
      const haystack = [
        c.subGameNumber ?? "",
        c.id,
        c.displayName,
        c.parentScheduleId ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(qNeedle);
    });
  }

  // Index: scheduleSlotId → [{gameSessionId, startedAt}...].
  const slotToSessions = new Map<
    string,
    Array<{ gameSessionId: string; startedAtMs: number }>
  >();
  for (const log of input.scheduleLogs) {
    if (!log.scheduleSlotId || !log.gameSessionId) continue;
    let list = slotToSessions.get(log.scheduleSlotId);
    if (!list) {
      list = [];
      slotToSessions.set(log.scheduleSlotId, list);
    }
    const ms = Date.parse(log.startedAt);
    list.push({
      gameSessionId: log.gameSessionId,
      startedAtMs: Number.isFinite(ms) ? ms : 0,
    });
  }

  // Index: gameSessionId → ledger rows (window-filtered + bot-filtered).
  const entriesByGameId = new Map<string, ComplianceLedgerEntry[]>();
  for (const entry of input.entries) {
    if (!entry.gameId) continue;
    if (entry.createdAtMs < fromMs || entry.createdAtMs > toMs) continue;
    // Type-filter: bot-only ⇒ metadata.isBot === true. Player ⇒ any.
    if (type === "bot" && !isBotEntry(entry)) continue;
    let list = entriesByGameId.get(entry.gameId);
    if (!list) {
      list = [];
      entriesByGameId.set(entry.gameId, list);
    }
    list.push(entry);
  }

  function aggregateChild(child: ScheduleSlot): Aggregate {
    const agg = emptyAggregate();
    const sessions = slotToSessions.get(child.id);
    if (!sessions) return agg;
    for (const session of sessions) {
      // Session start-time should fall within the requested window to be
      // counted (the started_at is authoritative; ledger-entry times can
      // leak across day-boundaries for multi-round games).
      if (session.startedAtMs < fromMs || session.startedAtMs > toMs) continue;
      if (agg.earliestStart === null || session.startedAtMs < agg.earliestStart) {
        agg.earliestStart = session.startedAtMs;
      }
      const entries = entriesByGameId.get(session.gameSessionId);
      if (!entries) continue;
      for (const entry of entries) {
        agg.hasEntries = true;
        if (entry.eventType === "STAKE") {
          agg.stakeSum += entry.amount;
        } else if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
          agg.prizeSum += entry.amount;
        }
      }
    }
    return agg;
  }

  // Stable ordering: by startedAt desc (most recent first), then hallId, then id.
  const sortedChildren = filteredChildren.slice().sort((a, b) => {
    const seqA = a.subGameSequence ?? Number.MAX_SAFE_INTEGER;
    const seqB = b.subGameSequence ?? Number.MAX_SAFE_INTEGER;
    if (a.hallId !== b.hallId) return a.hallId.localeCompare(b.hallId);
    if (seqA !== seqB) return seqA - seqB;
    return a.id.localeCompare(b.id);
  });

  const rows: Game1ManagementReportRow[] = sortedChildren.map((child) => {
    const agg = aggregateChild(child);
    const oms = roundCurrency(agg.stakeSum);
    const utd = roundCurrency(agg.prizeSum);
    const res = roundCurrency(oms - utd);
    const payoutPct = oms > 0 ? roundCurrency((utd * 100) / oms) : 0;
    const hall = hallsById.get(child.hallId);
    const group = groupByHall.get(child.hallId);
    return {
      subGameId: child.id,
      subGameNumber: child.subGameNumber ?? null,
      // Legacy "childGameId" field used subGameNumber as its human-readable
      // id for listing + drill-link templates; fall back to raw id.
      childGameId: child.subGameNumber ?? child.id,
      parentScheduleId: child.parentScheduleId ?? "",
      hallId: child.hallId,
      hallName: hall?.name ?? child.hallId,
      groupOfHallId: group?.id ?? null,
      groupOfHallName: group?.name ?? null,
      startedAt: agg.earliestStart !== null ? new Date(agg.earliestStart).toISOString() : null,
      oms,
      utd,
      payoutPct,
      res,
    };
  });

  // Totals = sum of the filtered row-set (OMS / UTD). Payout% is computed
  // once at the end from the summed OMS/UTD (not an average of per-row %).
  const totalOmsRaw = rows.reduce((acc, r) => acc + r.oms, 0);
  const totalUtdRaw = rows.reduce((acc, r) => acc + r.utd, 0);
  const totalOms = roundCurrency(totalOmsRaw);
  const totalUtd = roundCurrency(totalUtdRaw);
  const totals: Game1ManagementReportTotals = {
    oms: totalOms,
    utd: totalUtd,
    payoutPct: totalOms > 0 ? roundCurrency((totalUtd * 100) / totalOms) : 0,
    res: roundCurrency(totalOms - totalUtd),
  };

  return {
    from: input.from,
    to: input.to,
    generatedAt: new Date().toISOString(),
    type,
    rows,
    totals,
  };
}
