/**
 * BIN-17.36: "Hall Specific Report" aggregate.
 *
 * Legacy reference:
 *   - `docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf` §17.36
 *   - Appendix B (PM-låst): Elvis Replacement Amount-kolonne må beholdes.
 *
 * Kolonner per wireframe + Appendix B:
 *   Group Of Hall Name | Hall Name | Agent | Elvis Replacement Amount |
 *   Game1 OMS/UTD/Payout%/RES | Game2 ... | Game3 ... | Game4 ... | Game5 ...
 *
 * Data-kilder:
 *   - `app_rg_compliance_ledger` (STAKE/PRIZE/EXTRA_PRIZE entries) for
 *     OMS/UTD per hall. Entry.metadata.isReplacement = true brukes for
 *     Elvis Replacement-aggregat (set i BingoEngine.chargeTicketReplacement).
 *   - `hall_schedule_log` + `hall_game_schedules` for å kategorisere hvilket
 *     Game 1-5 en ledger-entry tilhører (via gameSessionId → scheduleSlotId →
 *     slot.gameType → slug-mapping).
 *
 * Per Spillkatalog (project_spillkatalog.md): Game 1 = bingo, Game 2 =
 * rocket, Game 3 = mystery, Game 4 = wheel, Game 5 = spillorama. Alle interne
 * spill er "Hovedspill" i ledger (MAIN_GAME), bortsett fra Spill 4 data-bingo
 * (DATABINGO).
 */

import type {
  HallDefinition,
  ScheduleLogEntry,
  ScheduleSlot,
} from "../../platform/PlatformService.js";
import type { HallGroup } from "../HallGroupService.js";
import type { AgentProfile } from "../../agent/AgentStore.js";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";

/** Game-slots slik de vises i rapporten. Spill 1-5. */
export const HALL_SPECIFIC_GAMES = ["game1", "game2", "game3", "game4", "game5"] as const;
export type HallSpecificGame = (typeof HALL_SPECIFIC_GAMES)[number];

export interface GameAggregate {
  oms: number;
  utd: number;
  payoutPct: number;
  res: number;
}

export interface HallSpecificReportRow {
  hallId: string;
  hallName: string;
  groupOfHallId: string | null;
  groupOfHallName: string | null;
  /** Primær agent-displayName per hall (eller "—" hvis ingen). */
  agentDisplayName: string | null;
  /** Sum av STAKE-entries med metadata.isReplacement = true (øre). */
  elvisReplacementAmount: number;
  games: Record<HallSpecificGame, GameAggregate>;
}

export interface HallSpecificReportTotals {
  elvisReplacementAmount: number;
  games: Record<HallSpecificGame, GameAggregate>;
}

export interface HallSpecificReportResult {
  from: string;
  to: string;
  generatedAt: string;
  rows: HallSpecificReportRow[];
  totals: HallSpecificReportTotals;
}

export interface HallSpecificReportInput {
  halls: HallDefinition[];
  hallGroups: HallGroup[];
  agents: AgentProfile[];
  /** Alle sub-game-children OG parent-slots i vinduet — brukes for gameType-klassifisering. */
  scheduleSlots: ScheduleSlot[];
  scheduleLogs: ScheduleLogEntry[];
  entries: ComplianceLedgerEntry[];
  from: string;
  to: string;
  /** Valgfritt: filtrer til eksplisitte hallIds (fra query ?hallIds=a,b,c). */
  hallIds?: string[];
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertIsoWindow(from: string, to: string): { fromMs: number; toMs: number } {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs)) {
    throw new Error(`[hall-specific] Ugyldig 'from': ${from}`);
  }
  if (!Number.isFinite(toMs)) {
    throw new Error(`[hall-specific] Ugyldig 'to': ${to}`);
  }
  if (fromMs > toMs) {
    throw new Error(`[hall-specific] 'from' må være <= 'to' (${from} > ${to}).`);
  }
  return { fromMs, toMs };
}

function emptyGameAggregate(): GameAggregate {
  return { oms: 0, utd: 0, payoutPct: 0, res: 0 };
}

function emptyGamesRecord(): Record<HallSpecificGame, GameAggregate> {
  return {
    game1: emptyGameAggregate(),
    game2: emptyGameAggregate(),
    game3: emptyGameAggregate(),
    game4: emptyGameAggregate(),
    game5: emptyGameAggregate(),
  };
}

/**
 * Mapper fra en ScheduleSlot.gameType/variantConfig til rapport-game-slot.
 *
 * Dette er en best-effort-heuristikk siden legacy-skjemaet ikke har en
 * direkte game-slug-kolonne i schedule-slot. Vi leser først variantConfig.gameSlug
 * (BIN-615 setter denne på subgame-children), og faller tilbake til gameType
 * keyword-match.
 *
 * Ukjente gameType-verdier mappes til null (entries kastes da fra aggregatet).
 */
export function deriveGameSlotFromSchedule(slot: ScheduleSlot): HallSpecificGame | null {
  const slugRaw =
    typeof slot.variantConfig?.["gameSlug"] === "string"
      ? (slot.variantConfig["gameSlug"] as string)
      : undefined;
  const slug = (slugRaw ?? slot.gameType ?? "").toLowerCase();

  // Game 1 = Spill 1 (Bingo Norsk / Elvis / Traffic Light / Bingo75 — alle
  // "standard"-varianter under Hovedspill 1).
  if (
    slug === "bingo" ||
    slug === "standard" ||
    slug === "elvis" ||
    slug === "trafficlight" ||
    slug === "traffic-light" ||
    slug === "bingo75"
  ) {
    return "game1";
  }
  // Game 2 = Rocket (tallspill).
  if (slug === "rocket" || slug === "tallspill") return "game2";
  // Game 3 = Mystery.
  if (slug === "mystery") return "game3";
  // Game 4 = Data-bingo / wheel (legacy Game 4 DataBingo).
  if (slug === "wheel" || slug === "wheel-of-fortune" || slug === "databingo" || slug === "data-bingo") {
    return "game4";
  }
  // Game 5 = SpinnGo / Spillorama.
  if (slug === "spillorama" || slug === "spinngo" || slug === "spin-go" || slug === "color-draft") {
    return "game5";
  }
  return null;
}

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

/**
 * Build primary-agent lookup. "Primary agent" per hall = første aktive agent
 * med `isPrimary=true` tildelt denne hallen. Legacy-rapporten viser én
 * display-name-kolonne "Agent" — hvis flere agenter jobber hallen, vises den
 * primære.
 */
function buildPrimaryAgentByHall(agents: AgentProfile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const agent of agents) {
    if (agent.agentStatus !== "active") continue;
    for (const assignment of agent.halls) {
      if (!assignment.isPrimary) continue;
      if (!map.has(assignment.hallId)) {
        map.set(assignment.hallId, agent.displayName);
      }
    }
  }
  return map;
}

/**
 * Build "Hall Specific Report" aggregate.
 *
 * En rad per hall i `input.halls` (etter valgfri hallIds-filter). Alle haller
 * vises selv uten aktivitet — 0-rader er forventet ved tomme perioder.
 */
export function buildHallSpecificReport(
  input: HallSpecificReportInput
): HallSpecificReportResult {
  const { fromMs, toMs } = assertIsoWindow(input.from, input.to);
  const hallIdFilter = input.hallIds && input.hallIds.length > 0
    ? new Set(input.hallIds.map((h) => h.trim()).filter((h) => h.length > 0))
    : null;

  const hallsById = new Map<string, HallDefinition>();
  for (const hall of input.halls) hallsById.set(hall.id, hall);

  const groupByHall = buildGroupByHallMap(input.hallGroups);
  const primaryAgentByHall = buildPrimaryAgentByHall(input.agents);

  // Index: slotId → rapport-game-kategori.
  const slotToGame = new Map<string, HallSpecificGame>();
  for (const slot of input.scheduleSlots) {
    const game = deriveGameSlotFromSchedule(slot);
    if (game) slotToGame.set(slot.id, game);
  }

  // Index: gameSessionId → { hallId, scheduleSlotId, startedAtMs }.
  interface SessionInfo {
    hallId: string;
    slotId: string | null;
    startedAtMs: number;
  }
  const sessionById = new Map<string, SessionInfo>();
  for (const log of input.scheduleLogs) {
    if (!log.gameSessionId) continue;
    const ms = Date.parse(log.startedAt);
    sessionById.set(log.gameSessionId, {
      hallId: log.hallId,
      slotId: log.scheduleSlotId ?? null,
      startedAtMs: Number.isFinite(ms) ? ms : 0,
    });
  }

  // Per-hall aggregation state.
  interface HallAgg {
    elvisReplacement: number;
    games: Record<HallSpecificGame, { stakeSum: number; prizeSum: number }>;
  }
  const byHall = new Map<string, HallAgg>();

  function ensureHall(hallId: string): HallAgg {
    let agg = byHall.get(hallId);
    if (!agg) {
      agg = {
        elvisReplacement: 0,
        games: {
          game1: { stakeSum: 0, prizeSum: 0 },
          game2: { stakeSum: 0, prizeSum: 0 },
          game3: { stakeSum: 0, prizeSum: 0 },
          game4: { stakeSum: 0, prizeSum: 0 },
          game5: { stakeSum: 0, prizeSum: 0 },
        },
      };
      byHall.set(hallId, agg);
    }
    return agg;
  }

  for (const entry of input.entries) {
    if (entry.createdAtMs < fromMs || entry.createdAtMs > toMs) continue;
    // Bestem hvilken hall og hvilket game en entry tilhører. Primær-kilde:
    // entry.hallId + entry.gameId → session → slot → gameType.
    const hallId = entry.hallId;
    if (hallIdFilter && !hallIdFilter.has(hallId)) continue;

    const agg = ensureHall(hallId);

    // Elvis Replacement-delen (PM-låst kolonne).
    const meta = entry.metadata as Record<string, unknown> | undefined;
    const isReplacement = meta && meta["isReplacement"] === true;
    if (entry.eventType === "STAKE" && isReplacement) {
      agg.elvisReplacement += entry.amount;
    }

    // Game-kategori-routing.
    let gameSlot: HallSpecificGame | null = null;
    if (entry.gameId) {
      const sess = sessionById.get(entry.gameId);
      if (sess && sess.slotId) {
        gameSlot = slotToGame.get(sess.slotId) ?? null;
      }
    }
    if (!gameSlot) {
      // Fallback: ledger-gameType-kolonnen. DATABINGO → game4, MAIN_GAME → game1
      // (mest sannsynlig match for Hovedspill 1 som er >80% av volum).
      if (entry.gameType === "DATABINGO") gameSlot = "game4";
      else if (entry.gameType === "MAIN_GAME") gameSlot = "game1";
    }
    if (!gameSlot) continue;

    const gameAgg = agg.games[gameSlot];
    if (entry.eventType === "STAKE") {
      gameAgg.stakeSum += entry.amount;
    } else if (entry.eventType === "PRIZE" || entry.eventType === "EXTRA_PRIZE") {
      gameAgg.prizeSum += entry.amount;
    }
  }

  // Bygg én rad per hall — også haller uten aktivitet.
  const rows: HallSpecificReportRow[] = [];
  for (const hall of input.halls) {
    if (hallIdFilter && !hallIdFilter.has(hall.id)) continue;
    const agg = byHall.get(hall.id);
    const games = emptyGamesRecord();
    if (agg) {
      for (const key of HALL_SPECIFIC_GAMES) {
        const raw = agg.games[key];
        const oms = roundCurrency(raw.stakeSum);
        const utd = roundCurrency(raw.prizeSum);
        games[key] = {
          oms,
          utd,
          payoutPct: oms > 0 ? roundCurrency((utd * 100) / oms) : 0,
          res: roundCurrency(oms - utd),
        };
      }
    }
    const group = groupByHall.get(hall.id);
    rows.push({
      hallId: hall.id,
      hallName: hall.name,
      groupOfHallId: group?.id ?? null,
      groupOfHallName: group?.name ?? null,
      agentDisplayName: primaryAgentByHall.get(hall.id) ?? null,
      elvisReplacementAmount: roundCurrency(agg?.elvisReplacement ?? 0),
      games,
    });
  }

  // Stabil sortering: groupName asc, deretter hallName asc.
  rows.sort((a, b) => {
    const gA = a.groupOfHallName ?? "";
    const gB = b.groupOfHallName ?? "";
    if (gA !== gB) return gA.localeCompare(gB);
    return a.hallName.localeCompare(b.hallName);
  });

  // Totals = sum på tvers av rader.
  const totalGames = emptyGamesRecord();
  let totalElvis = 0;
  for (const r of rows) {
    totalElvis += r.elvisReplacementAmount;
    for (const key of HALL_SPECIFIC_GAMES) {
      totalGames[key].oms += r.games[key].oms;
      totalGames[key].utd += r.games[key].utd;
    }
  }
  for (const key of HALL_SPECIFIC_GAMES) {
    const oms = roundCurrency(totalGames[key].oms);
    const utd = roundCurrency(totalGames[key].utd);
    totalGames[key] = {
      oms,
      utd,
      payoutPct: oms > 0 ? roundCurrency((utd * 100) / oms) : 0,
      res: roundCurrency(oms - utd),
    };
  }

  return {
    from: input.from,
    to: input.to,
    generatedAt: new Date().toISOString(),
    rows,
    totals: {
      elvisReplacementAmount: roundCurrency(totalElvis),
      games: totalGames,
    },
  };
}
