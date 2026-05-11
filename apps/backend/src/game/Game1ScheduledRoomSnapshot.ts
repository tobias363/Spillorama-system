import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { GameSnapshot, RoomSnapshot, Ticket } from "./types.js";
import { generateBingo75Ticket } from "./ticket.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-scheduled-room-snapshot" });

type QueryablePool = Pick<Pool, "query">;

interface EnrichDeps {
  pool: QueryablePool;
  schema?: string;
}

interface ScheduledSnapshotRow {
  id: string;
  status: string;
  ticket_config_json: unknown;
  actual_start_time: Date | string | null;
  actual_end_time: Date | string | null;
  pause_reason: string | null;
  draw_bag_json: unknown | null;
  draws_completed: number | string | null;
  paused: boolean | null;
  engine_started_at: Date | string | null;
  engine_ended_at: Date | string | null;
}

interface DrawRow {
  ball_value: number | string;
}

interface AssignmentRow {
  player_id: string;
  ticket_color: string;
  ticket_size: string;
  grid_numbers_json: unknown;
  markings_json: unknown;
}

interface PurchaseRow {
  id: string;
  player_id: string;
  buyer_user_id: string;
  hall_id: string;
  ticket_spec_json: unknown;
  total_amount_cents: number | string;
}

interface TicketSpecEntry {
  color: string;
  size: "small" | "large";
  count: number;
}

interface ScheduledGame1Projection {
  preRoundTickets: Record<string, Ticket[]>;
  armedPlayerIds: string[];
  playerStakes: Record<string, number>;
  playerPendingStakes: Record<string, number>;
}

export type ScheduledGame1ProjectedRoomSnapshot = RoomSnapshot & {
  __scheduledGame1Projection?: ScheduledGame1Projection;
};

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function table(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (value == null) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseNumberArray(raw: unknown): number[] {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function parseGrid(raw: unknown): number[][] {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const flat = parsed.map((value) => Number(value));
  const grid: number[][] = [];
  for (let row = 0; row < 5; row += 1) {
    grid.push(flat.slice(row * 5, row * 5 + 5));
  }
  return grid.filter((row) => row.length > 0);
}

function parseMarkedNumbers(grid: number[][], raw: unknown): number[] {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const marked = Array.isArray((parsed as { marked?: unknown } | null)?.marked)
    ? (parsed as { marked: unknown[] }).marked
    : [];
  const flat = grid.flat();
  return marked
    .map((value, index) => value === true ? flat[index] : null)
    .filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0);
}

function ticketTypeFromSize(value: string): "small" | "large" {
  return value.toLowerCase() === "large" ? "large" : "small";
}

function ticketDisplayColor(size: string, color: string): string {
  const title = color.length > 0
    ? color.charAt(0).toUpperCase() + color.slice(1).toLowerCase()
    : color;
  return `${ticketTypeFromSize(size) === "large" ? "Large" : "Small"} ${title}`.trim();
}

function toGameStatus(row: ScheduledSnapshotRow): GameSnapshot["status"] {
  if (
    row.engine_ended_at !== null ||
    row.actual_end_time !== null ||
    row.status === "completed" ||
    row.status === "cancelled"
  ) {
    return "ENDED";
  }
  return "RUNNING";
}

function hasEngineState(row: ScheduledSnapshotRow): boolean {
  return row.draw_bag_json !== null && row.engine_started_at !== null;
}

function parseTicketSpec(raw: unknown): TicketSpecEntry[] {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const out: TicketSpecEntry[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const color = typeof record.color === "string" ? record.color : "";
    const size = record.size === "large" ? "large" : "small";
    const count = Math.max(0, Math.floor(Number(record.count) || 0));
    if (color && count > 0) out.push({ color, size, count });
  }
  return out;
}

function entryFeeFromTicketConfig(raw: unknown): number {
  const cfg = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const direct = Number(cfg.entryFee ?? cfg.entry_fee);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const ticketTypes = Array.isArray(cfg.ticketTypesData)
    ? cfg.ticketTypesData
    : Array.isArray(cfg.ticketTypes)
      ? cfg.ticketTypes
      : [];
  const prices = ticketTypes
    .map((entry) => Number((entry as Record<string, unknown>)?.priceCentsEach))
    .filter((value) => Number.isFinite(value) && value > 0);
  return prices.length > 0 ? Math.min(...prices) / 100 : 0;
}

function makeAssignmentGrid(size: "small" | "large", color: string): Array<number | null> {
  return generateBingo75Ticket(ticketDisplayColor(size, color), size).grid.flat();
}

async function ensureAssignmentsForPurchases(
  deps: EnrichDeps,
  schema: string,
  scheduledGameId: string,
  purchases: PurchaseRow[],
): Promise<void> {
  if (purchases.length === 0) return;
  const assignments = table(schema, "app_game1_ticket_assignments");
  for (const purchase of purchases) {
    let sequence = 1;
    for (const spec of parseTicketSpec(purchase.ticket_spec_json)) {
      for (let i = 0; i < spec.count; i += 1) {
        const grid = makeAssignmentGrid(spec.size, spec.color);
        const markings = { marked: grid.map((cell) => cell === 0) };
        await deps.pool.query(
          `INSERT INTO ${assignments}
              (id, scheduled_game_id, purchase_id, buyer_user_id, hall_id,
               ticket_color, ticket_size, grid_numbers_json,
               sequence_in_purchase, markings_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb)
             ON CONFLICT (purchase_id, sequence_in_purchase) DO NOTHING`,
          [
            `g1a-${randomUUID()}`,
            scheduledGameId,
            purchase.id,
            purchase.buyer_user_id,
            purchase.hall_id,
            spec.color,
            spec.size,
            JSON.stringify(grid),
            sequence,
            JSON.stringify(markings),
          ],
        );
        sequence += 1;
      }
    }
  }
}

function buildSyntheticGameSnapshot(
  row: ScheduledSnapshotRow,
  drawnNumbers: number[],
  tickets: Record<string, Ticket[]> = {},
  marks: Record<string, number[][]> = {},
): GameSnapshot {
  const fullBag = parseNumberArray(row.draw_bag_json);
  const drawsCompleted = Math.max(0, Number(row.draws_completed) || 0);
  const remainingBag = fullBag.slice(Math.min(drawsCompleted, fullBag.length));
  const startedAt = toIso(row.actual_start_time) ?? toIso(row.engine_started_at) ?? new Date().toISOString();
  const endedAt = toIso(row.actual_end_time) ?? toIso(row.engine_ended_at);

  return {
    id: row.id,
    status: toGameStatus(row),
    entryFee: 0,
    ticketsPerPlayer: 0,
    prizePool: 0,
    remainingPrizePool: 0,
    payoutPercent: 0,
    maxPayoutBudget: 0,
    remainingPayoutBudget: 0,
    drawBag: remainingBag,
    drawnNumbers,
    remainingNumbers: remainingBag.length,
    patterns: [],
    patternResults: [],
    claims: [],
    tickets,
    marks,
    participatingPlayerIds: Object.keys(tickets),
    isPaused: row.paused ?? false,
    ...(row.pause_reason ? { pauseReason: row.pause_reason } : {}),
    startedAt,
    ...(endedAt ? { endedAt } : {}),
  };
}

export async function enrichScheduledGame1RoomSnapshot(
  snapshot: RoomSnapshot,
  deps: EnrichDeps,
): Promise<RoomSnapshot> {
  if (snapshot.gameSlug && snapshot.gameSlug.toLowerCase() !== "bingo") {
    return snapshot;
  }

  const schema = deps.schema ?? "public";
  const scheduledGames = table(schema, "app_game1_scheduled_games");
  const gameState = table(schema, "app_game1_game_state");
  const draws = table(schema, "app_game1_draws");
  const assignments = table(schema, "app_game1_ticket_assignments");
  const purchases = table(schema, "app_game1_ticket_purchases");
  const users = table(schema, "app_users");

  try {
    const { rows } = await deps.pool.query<ScheduledSnapshotRow>(
      `SELECT sg.id,
              sg.status,
              sg.ticket_config_json,
              sg.actual_start_time,
              sg.actual_end_time,
              sg.pause_reason,
              gs.draw_bag_json,
              gs.draws_completed,
              gs.paused,
              gs.engine_started_at,
              gs.engine_ended_at
         FROM ${scheduledGames} sg
         LEFT JOIN ${gameState} gs ON gs.scheduled_game_id = sg.id
        WHERE UPPER(sg.room_code) = UPPER($1)
          AND sg.status IN ('purchase_open', 'ready_to_start', 'running', 'paused')
        ORDER BY sg.actual_start_time DESC NULLS LAST, sg.updated_at DESC
        LIMIT 1`,
      [snapshot.code],
    );
    const row = rows[0];
    if (!row) return snapshot;

    const { rows: purchaseRows } = await deps.pool.query<PurchaseRow>(
      `SELECT p.id,
              u.wallet_id AS player_id,
              p.buyer_user_id,
              p.hall_id,
              p.ticket_spec_json,
              p.total_amount_cents
         FROM ${purchases} p
         JOIN ${users} u ON u.id = p.buyer_user_id
        WHERE p.scheduled_game_id = $1
          AND p.refunded_at IS NULL
        ORDER BY p.purchased_at ASC, p.id ASC`,
      [row.id],
    );

    try {
      await ensureAssignmentsForPurchases(deps, schema, row.id, purchaseRows);
    } catch (err) {
      log.warn({ err, scheduledGameId: row.id }, "scheduled Game1 assignment backfill failed");
    }

    const { rows: drawRows } = await deps.pool.query<DrawRow>(
      `SELECT ball_value
         FROM ${draws}
        WHERE scheduled_game_id = $1
        ORDER BY draw_sequence ASC`,
      [row.id],
    );

    const drawnFromRows = drawRows
      .map((draw) => Number(draw.ball_value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const fallbackDrawn = parseNumberArray(row.draw_bag_json).slice(
      0,
      Math.max(0, Number(row.draws_completed) || 0),
    );
    const drawnNumbers = drawnFromRows.length > 0 ? drawnFromRows : fallbackDrawn;
    const playersByWalletId = new Map(
      snapshot.players.map((player) => [player.walletId, player.id]),
    );
    const tickets: Record<string, Ticket[]> = {};
    const marks: Record<string, number[][]> = {};
    const playerStakes: Record<string, number> = {};
    for (const purchase of purchaseRows) {
      const playerId = playersByWalletId.get(purchase.player_id);
      if (!playerId) continue;
      playerStakes[playerId] =
        (playerStakes[playerId] ?? 0) + (Number(purchase.total_amount_cents) || 0) / 100;
    }
    const { rows: assignmentRows } = await deps.pool.query<AssignmentRow>(
      `SELECT u.wallet_id AS player_id,
              a.ticket_color,
              a.ticket_size,
              a.grid_numbers_json,
              a.markings_json
         FROM ${assignments} a
         JOIN ${users} u ON u.id = a.buyer_user_id
        WHERE a.scheduled_game_id = $1
        ORDER BY a.purchase_id ASC, a.sequence_in_purchase ASC`,
      [row.id],
    );
    for (const assignment of assignmentRows) {
      const playerId = playersByWalletId.get(assignment.player_id);
      if (!playerId) continue;
      const grid = parseGrid(assignment.grid_numbers_json);
      const type = ticketTypeFromSize(assignment.ticket_size);
      const ticket: Ticket = {
        grid,
        type,
        color: ticketDisplayColor(assignment.ticket_size, assignment.ticket_color),
      };
      (tickets[playerId] ??= []).push(ticket);
      (marks[playerId] ??= []).push(parseMarkedNumbers(grid, assignment.markings_json));
    }

    const projection: ScheduledGame1Projection = {
      preRoundTickets: hasEngineState(row) ? {} : tickets,
      armedPlayerIds: hasEngineState(row) ? [] : Object.keys(tickets),
      playerStakes,
      playerPendingStakes: {},
    };

    const enriched: ScheduledGame1ProjectedRoomSnapshot = {
      ...snapshot,
      ...(hasEngineState(row)
        ? {
            currentGame: {
              ...buildSyntheticGameSnapshot(row, drawnNumbers, tickets, marks),
              entryFee: entryFeeFromTicketConfig(row.ticket_config_json),
            },
          }
        : {}),
      __scheduledGame1Projection: projection,
    };
    return enriched;
  } catch (err) {
    log.warn(
      { err, roomCode: snapshot.code },
      "scheduled Game1 snapshot enrichment failed — using BingoEngine snapshot",
    );
    return snapshot;
  }
}
