/**
 * Delte test-fikstuer for AgentTicketRangeService-test-filene.
 *
 * Brukes av:
 *   - AgentTicketRangeService.basics.test.ts        (PT2 register/close/list)
 *   - AgentTicketRangeService.allocation.test.ts    (PT3 recordBatchSale)
 *   - AgentTicketRangeService.compliance.test.ts    (PT5 handoverRange)
 *   - AgentTicketRangeService.edge-cases.test.ts    (PT5 extendRange)
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *       (§ "Fase 2", "Fase 4", "Fase 7", "Fase 8")
 *
 * Filene ble splittet ut fra én monolittisk AgentTicketRangeService.test.ts
 * (2482 linjer / 76 tester) for å unngå Node `node:test` IPC-overflow på trege
 * CI-runnere ("Unable to deserialize cloned data."). Ingen tester er fjernet —
 * kun omorganisert. Se PR #472 / fix/ipc-flake-test-runner.
 */

import type { Pool } from "pg";
import { AgentTicketRangeService } from "../../AgentTicketRangeService.js";
import type { StaticTicketColor } from "../../StaticTicketService.js";

// ── Mock store / pool ──────────────────────────────────────────────────────

export interface MockTicket {
  id: string;
  hall_id: string;
  ticket_serial: string;
  ticket_color: StaticTicketColor;
  is_purchased: boolean;
  reserved_by_range_id: string | null;
  /** PT5: settes ved PT3-batch-salg. */
  sold_from_range_id?: string | null;
  /** PT4/PT5: nåværende ansvarlig bingovert. */
  responsible_user_id?: string | null;
  /** PT4: NULL = ikke utbetalt. PT5 filtrerer på dette. */
  paid_out_at?: Date | null;
}

export interface MockRange {
  id: string;
  agent_id: string;
  hall_id: string;
  ticket_color: StaticTicketColor;
  initial_serial: string;
  final_serial: string;
  serials: string[];
  next_available_index: number;
  current_top_serial: string | null;
  registered_at: Date;
  closed_at: Date | null;
  handover_from_range_id: string | null;
  /** PT5: settes ved handover. */
  handed_off_to_range_id: string | null;
}

export interface MockUser {
  id: string;
  role: "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "PLAYER" | "AGENT";
  hall_id: string | null;
}

export interface MockScheduledGame {
  id: string;
  status: string;
  master_hall_id: string;
  participating_halls: string[];
  scheduled_start_time: Date;
  scheduled_end_time: Date;
}

export interface MockStore {
  tickets: Map<string, MockTicket>; // key: ticket id
  ranges: Map<string, MockRange>; // key: range id
  scheduledGames: Map<string, MockScheduledGame>;
  /** PT5: app_users lookup for handover-validering. */
  users: Map<string, MockUser>;
  txActive: number;
  commitCount: number;
  rollbackCount: number;
  /**
   * Inject a hook that kjøres ved SELECT ... FOR UPDATE på scannet bong —
   * emulerer race: annen transaksjon kan mutere state før UPDATE.
   */
  onScannedSelectHook: (() => void) | null;
  /**
   * Inject: returner færre rader fra UPDATE enn forventet (for
   * reservation-mismatch-test).
   */
  forceReservationMismatch: boolean;
  /**
   * PT3: Inject færre rader oppdatert i batch-UPDATE app_static_tickets.
   */
  forceBatchUpdateMismatch: boolean;
  /**
   * PT3: Hook som kjøres rett før UPDATE av app_static_tickets (emulere race).
   */
  onBeforeBatchUpdateHook: (() => void) | null;
}

export function newStore(): MockStore {
  return {
    tickets: new Map(),
    ranges: new Map(),
    scheduledGames: new Map(),
    users: new Map(),
    txActive: 0,
    commitCount: 0,
    rollbackCount: 0,
    onScannedSelectHook: null,
    forceReservationMismatch: false,
    forceBatchUpdateMismatch: false,
    onBeforeBatchUpdateHook: null,
  };
}

export function seedUser(store: MockStore, user: MockUser): void {
  store.users.set(user.id, user);
}

export function seedScheduledGame(
  store: MockStore,
  spec: Partial<MockScheduledGame> & { id: string; master_hall_id: string },
): MockScheduledGame {
  const now = new Date();
  const full: MockScheduledGame = {
    status: spec.status ?? "scheduled",
    participating_halls: spec.participating_halls ?? [],
    scheduled_start_time: spec.scheduled_start_time ?? new Date(now.getTime() + 60_000),
    scheduled_end_time: spec.scheduled_end_time ?? new Date(now.getTime() + 3_600_000),
    ...spec,
  };
  store.scheduledGames.set(full.id, full);
  return full;
}

export function seedTickets(
  store: MockStore,
  spec: {
    hallId: string;
    color: StaticTicketColor;
    serials: string[];
    /** default: all false */
    purchased?: string[];
    /** ticketSerial -> rangeId */
    reservedBy?: Record<string, string>;
  },
): void {
  for (const serial of spec.serials) {
    const id = `tkt-${spec.hallId}-${spec.color}-${serial}`;
    store.tickets.set(id, {
      id,
      hall_id: spec.hallId,
      ticket_serial: serial,
      ticket_color: spec.color,
      is_purchased: spec.purchased?.includes(serial) ?? false,
      reserved_by_range_id: spec.reservedBy?.[serial] ?? null,
    });
  }
}

export function seedRange(store: MockStore, range: Partial<MockRange> & { id: string; agent_id: string; hall_id: string; ticket_color: StaticTicketColor }): MockRange {
  const full: MockRange = {
    initial_serial: range.initial_serial ?? "100",
    final_serial: range.final_serial ?? "100",
    serials: range.serials ?? ["100"],
    next_available_index: range.next_available_index ?? 0,
    current_top_serial: range.current_top_serial ?? range.initial_serial ?? "100",
    registered_at: range.registered_at ?? new Date(),
    closed_at: range.closed_at ?? null,
    handover_from_range_id: range.handover_from_range_id ?? null,
    handed_off_to_range_id: range.handed_off_to_range_id ?? null,
    ...range,
  };
  store.ranges.set(full.id, full);
  return full;
}

export function makeMockPool(store: MockStore): Pool {
  const runQuery = async (sql: string, params: unknown[] = []) => {
    const s = sql.trim();

    if (s === "BEGIN") {
      store.txActive += 1;
      return { rows: [], rowCount: 0 };
    }
    if (s === "COMMIT") {
      store.txActive = Math.max(0, store.txActive - 1);
      store.commitCount += 1;
      return { rows: [], rowCount: 0 };
    }
    if (s === "ROLLBACK") {
      store.txActive = Math.max(0, store.txActive - 1);
      store.rollbackCount += 1;
      return { rows: [], rowCount: 0 };
    }

    // SELECT scanned ticket (WHERE ticket_serial = $1 ORDER BY hall_id ASC ... FOR UPDATE)
    if (
      sql.includes("FROM")
      && sql.includes("app_static_tickets")
      && sql.includes("WHERE ticket_serial = $1")
      && sql.includes("FOR UPDATE")
    ) {
      if (store.onScannedSelectHook) {
        const hook = store.onScannedSelectHook;
        store.onScannedSelectHook = null;
        hook();
      }
      const [serial] = params as [string];
      const rows = [...store.tickets.values()]
        .filter((t) => t.ticket_serial === serial)
        .sort((a, b) => {
          if (a.hall_id !== b.hall_id) return a.hall_id < b.hall_id ? -1 : 1;
          return a.ticket_color < b.ticket_color ? -1 : 1;
        });
      return { rows, rowCount: rows.length };
    }

    // SELECT range open (WHERE id = $1 AND closed_at IS NULL)
    if (
      sql.includes("FROM")
      && sql.includes("app_agent_ticket_ranges")
      && sql.includes("WHERE id = $1 AND closed_at IS NULL")
    ) {
      const [id] = params as [string];
      const r = store.ranges.get(id);
      const rows = r && r.closed_at === null ? [{ id: r.id }] : [];
      return { rows, rowCount: rows.length };
    }

    // SELECT available tickets (LEFT JOIN, WHERE hall_id = $1 AND ticket_color = $2 AND is_purchased = false AND ticket_serial <= $3)
    if (
      sql.includes("LEFT JOIN")
      && sql.includes("is_purchased = false")
      && sql.includes("ticket_serial <= $3")
    ) {
      const [hallId, color, maxSerial, limit] = params as [string, StaticTicketColor, string, number];
      const candidates = [...store.tickets.values()]
        .filter((t) => t.hall_id === hallId
          && t.ticket_color === color
          && !t.is_purchased
          && t.ticket_serial <= maxSerial)
        .filter((t) => {
          if (!t.reserved_by_range_id) return true;
          const r = store.ranges.get(t.reserved_by_range_id);
          return !r || r.closed_at !== null; // reservert av lukket range → tilgjengelig
        })
        .sort((a, b) => (a.ticket_serial < b.ticket_serial ? 1 : -1))
        .slice(0, limit);
      const rows = candidates.map((t) => ({
        id: t.id,
        ticket_serial: t.ticket_serial,
        reserved_by_range_id: t.reserved_by_range_id,
      }));
      return { rows, rowCount: rows.length };
    }

    // INSERT range (PT2 registerRange + PT5 handoverRange).
    // PT2 bruker 7 params (handover_from_range_id = NULL), PT5 bruker 8
    // (handover_from_range_id = $8). Differensieres via params.length.
    if (
      sql.includes("INSERT INTO")
      && sql.includes("app_agent_ticket_ranges")
    ) {
      const [id, agentId, hallId, color, initial, final, serialsJson] = params as [
        string, string, string, StaticTicketColor, string, string, string,
      ];
      const handoverFrom = (params[7] as string | undefined) ?? null;
      const serials = JSON.parse(serialsJson) as string[];
      const now = new Date();
      const row: MockRange = {
        id,
        agent_id: agentId,
        hall_id: hallId,
        ticket_color: color,
        initial_serial: initial,
        final_serial: final,
        serials,
        next_available_index: 0,
        current_top_serial: initial,
        registered_at: now,
        closed_at: null,
        handover_from_range_id: handoverFrom,
        handed_off_to_range_id: null,
      };
      store.ranges.set(id, row);
      // PT2 bruker RETURNING, PT5 ikke — men det skader ikke å returnere uansett.
      return { rows: [{ registered_at: now }], rowCount: 1 };
    }

    // UPDATE tickets reserved_by_range_id WHERE id = ANY (PT2 registerRange +
    // PT5 extendRange). Bruker id-array for å identifisere kandidater.
    if (
      sql.includes("UPDATE")
      && sql.includes("app_static_tickets")
      && sql.includes("SET reserved_by_range_id = $1")
      && sql.includes("WHERE id = ANY($2::text[])")
    ) {
      const [rangeId, ids] = params as [string, string[]];
      let count = 0;
      for (const tid of ids) {
        const t = store.tickets.get(tid);
        if (t && !t.is_purchased) {
          t.reserved_by_range_id = rangeId;
          count += 1;
        }
      }
      if (store.forceReservationMismatch) {
        count = Math.max(0, count - 1);
      }
      return { rows: [], rowCount: count };
    }

    // SELECT range FOR UPDATE (close-flow OR batch-sale-flow).
    // Differentiate basert på hvor mange kolonner som ønskes:
    //   - close: SELECT id, agent_id, closed_at
    //   - batch-sale: SELECT id, agent_id, hall_id, ticket_color,
    //                        initial_serial, final_serial, serials,
    //                        current_top_serial, closed_at
    if (
      sql.includes("FROM")
      && sql.includes("app_agent_ticket_ranges")
      && sql.includes("WHERE id = $1")
      && sql.includes("FOR UPDATE")
    ) {
      const [id] = params as [string];
      const r = store.ranges.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      const wantsBatch = sql.includes("serials");
      if (wantsBatch) {
        return {
          rows: [{
            id: r.id,
            agent_id: r.agent_id,
            hall_id: r.hall_id,
            ticket_color: r.ticket_color,
            initial_serial: r.initial_serial,
            final_serial: r.final_serial,
            serials: r.serials,
            current_top_serial: r.current_top_serial,
            closed_at: r.closed_at,
          }],
          rowCount: 1,
        };
      }
      return {
        rows: [{
          id: r.id,
          agent_id: r.agent_id,
          closed_at: r.closed_at,
        }],
        rowCount: 1,
      };
    }

    // PT3: SELECT scheduled_game by id (findScheduledGameById)
    if (
      sql.includes("FROM")
      && sql.includes("app_game1_scheduled_games")
      && sql.includes("WHERE id = $1")
    ) {
      const [id] = params as [string];
      const g = store.scheduledGames.get(id);
      if (!g) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          id: g.id,
          status: g.status,
          scheduled_start_time: g.scheduled_start_time,
          scheduled_end_time: g.scheduled_end_time,
          master_hall_id: g.master_hall_id,
          participating_halls_json: g.participating_halls,
        }],
        rowCount: 1,
      };
    }

    // PT3: SELECT next scheduled_game for hall (findNextScheduledGameForHall)
    if (
      sql.includes("FROM")
      && sql.includes("app_game1_scheduled_games")
      && sql.includes("status IN")
      && sql.includes("master_hall_id = $1")
    ) {
      const [hallId] = params as [string];
      const now = Date.now();
      const validStatuses = new Set([
        "scheduled",
        "purchase_open",
        "ready_to_start",
        "running",
        "paused",
      ]);
      const candidates = [...store.scheduledGames.values()]
        .filter((g) => validStatuses.has(g.status)
          && g.scheduled_end_time.getTime() > now
          && (g.master_hall_id === hallId
            || g.participating_halls.includes(hallId)))
        .sort((a, b) => a.scheduled_start_time.getTime() - b.scheduled_start_time.getTime())
        .slice(0, 1);
      const rows = candidates.map((g) => ({
        id: g.id,
        scheduled_start_time: g.scheduled_start_time,
      }));
      return { rows, rowCount: rows.length };
    }

    // PT3: UPDATE app_static_tickets SET is_purchased = true (batch-sale)
    if (
      sql.includes("UPDATE")
      && sql.includes("app_static_tickets")
      && sql.includes("SET is_purchased = true")
    ) {
      if (store.onBeforeBatchUpdateHook) {
        const hook = store.onBeforeBatchUpdateHook;
        store.onBeforeBatchUpdateHook = null;
        hook();
      }
      const [scheduledGameId, userId, rangeId, hallId, serials] = params as [
        string, string, string, string, string[],
      ];
      let count = 0;
      for (const t of store.tickets.values()) {
        if (
          t.hall_id === hallId
          && serials.includes(t.ticket_serial)
          && t.reserved_by_range_id === rangeId
          && !t.is_purchased
        ) {
          t.is_purchased = true;
          (t as unknown as { sold_to_scheduled_game_id: string }).sold_to_scheduled_game_id = scheduledGameId;
          (t as unknown as { sold_by_user_id: string }).sold_by_user_id = userId;
          (t as unknown as { sold_from_range_id: string }).sold_from_range_id = rangeId;
          (t as unknown as { responsible_user_id: string }).responsible_user_id = userId;
          count += 1;
        }
      }
      if (store.forceBatchUpdateMismatch) {
        count = Math.max(0, count - 1);
      }
      return { rows: [], rowCount: count };
    }

    // PT3: UPDATE range SET current_top_serial = $1
    if (
      sql.includes("UPDATE")
      && sql.includes("app_agent_ticket_ranges")
      && sql.includes("SET current_top_serial = $1")
    ) {
      const [newTop, id] = params as [string, string];
      const r = store.ranges.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      r.current_top_serial = newTop;
      return { rows: [], rowCount: 1 };
    }

    // UPDATE range SET closed_at = now() (PT2 closeRange + PT5 handoverRange)
    // PT2: 1 param, ingen handed_off_to_range_id.
    // PT5: 2 params: [handed_off_to_range_id, id], setter begge.
    if (
      sql.includes("UPDATE")
      && sql.includes("app_agent_ticket_ranges")
      && sql.includes("SET closed_at = now()")
    ) {
      const hasHandedOff = sql.includes("handed_off_to_range_id");
      if (hasHandedOff) {
        const [handedOffTo, id] = params as [string, string];
        const r = store.ranges.get(id);
        if (!r) return { rows: [], rowCount: 0 };
        r.closed_at = new Date();
        r.handed_off_to_range_id = handedOffTo;
        return { rows: [{ closed_at: r.closed_at }], rowCount: 1 };
      }
      const [id] = params as [string];
      const r = store.ranges.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      r.closed_at = new Date();
      return { rows: [{ closed_at: r.closed_at }], rowCount: 1 };
    }

    // SELECT list active ranges by agent/hall
    if (
      sql.includes("FROM")
      && sql.includes("app_agent_ticket_ranges")
      && sql.includes("closed_at IS NULL")
      && (sql.includes("WHERE agent_id = $1") || sql.includes("WHERE hall_id = $1"))
    ) {
      const isAgent = sql.includes("WHERE agent_id = $1");
      const [key] = params as [string];
      const rows = [...store.ranges.values()]
        .filter((r) => r.closed_at === null
          && (isAgent ? r.agent_id === key : r.hall_id === key))
        .sort((a, b) => (a.registered_at > b.registered_at ? -1 : 1))
        .map((r) => ({
          id: r.id,
          agent_id: r.agent_id,
          hall_id: r.hall_id,
          ticket_color: r.ticket_color,
          initial_serial: r.initial_serial,
          final_serial: r.final_serial,
          serials: r.serials,
          next_available_index: r.next_available_index,
          current_top_serial: r.current_top_serial,
          registered_at: r.registered_at,
          closed_at: r.closed_at,
          handover_from_range_id: r.handover_from_range_id,
          handed_off_to_range_id: r.handed_off_to_range_id,
        }));
      return { rows, rowCount: rows.length };
    }

    // SELECT getRangeById
    if (
      sql.includes("FROM")
      && sql.includes("app_agent_ticket_ranges")
      && sql.includes("WHERE id = $1")
      && !sql.includes("FOR UPDATE")
      && !sql.includes("closed_at IS NULL")
    ) {
      const [id] = params as [string];
      const r = store.ranges.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          id: r.id,
          agent_id: r.agent_id,
          hall_id: r.hall_id,
          ticket_color: r.ticket_color,
          initial_serial: r.initial_serial,
          final_serial: r.final_serial,
          serials: r.serials,
          next_available_index: r.next_available_index,
          current_top_serial: r.current_top_serial,
          registered_at: r.registered_at,
          closed_at: r.closed_at,
          handover_from_range_id: r.handover_from_range_id,
          handed_off_to_range_id: r.handed_off_to_range_id,
        }],
        rowCount: 1,
      };
    }

    // PT5: SELECT app_users by id (handover target-validering).
    if (
      sql.includes("FROM")
      && sql.includes("app_users")
      && sql.includes("WHERE id = $1")
    ) {
      const [id] = params as [string];
      const u = store.users.get(id);
      if (!u) return { rows: [], rowCount: 0 };
      return {
        rows: [{ id: u.id, role: u.role, hall_id: u.hall_id }],
        rowCount: 1,
      };
    }

    // PT5 handover: UPDATE tickets SET reserved_by_range_id WHERE reserved_by_range_id = $2
    if (
      sql.includes("UPDATE")
      && sql.includes("app_static_tickets")
      && sql.includes("SET reserved_by_range_id = $1")
      && sql.includes("WHERE reserved_by_range_id = $2")
      && sql.includes("is_purchased = false")
    ) {
      const [newRangeId, oldRangeId] = params as [string, string];
      let count = 0;
      for (const t of store.tickets.values()) {
        if (t.reserved_by_range_id === oldRangeId && !t.is_purchased) {
          t.reserved_by_range_id = newRangeId;
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }

    // PT5 handover: UPDATE tickets SET responsible_user_id WHERE sold_from_range_id AND is_purchased=true AND paid_out_at IS NULL
    if (
      sql.includes("UPDATE")
      && sql.includes("app_static_tickets")
      && sql.includes("SET responsible_user_id = $1")
      && sql.includes("WHERE sold_from_range_id = $2")
      && sql.includes("paid_out_at IS NULL")
    ) {
      const [newUserId, oldRangeId] = params as [string, string];
      let count = 0;
      for (const t of store.tickets.values()) {
        if (
          t.sold_from_range_id === oldRangeId
          && t.is_purchased
          && (t.paid_out_at === null || t.paid_out_at === undefined)
        ) {
          t.responsible_user_id = newUserId;
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }

    // PT5 extend: SELECT available tickets (LEFT JOIN, ticket_serial < $3, FOR UPDATE OF s)
    if (
      sql.includes("LEFT JOIN")
      && sql.includes("is_purchased = false")
      && sql.includes("ticket_serial < $3")
      && sql.includes("FOR UPDATE OF s")
    ) {
      const [hallId, color, lessThanSerial, limit] = params as [
        string, StaticTicketColor, string, number,
      ];
      const candidates = [...store.tickets.values()]
        .filter((t) => t.hall_id === hallId
          && t.ticket_color === color
          && !t.is_purchased
          && t.ticket_serial < lessThanSerial)
        .filter((t) => {
          if (!t.reserved_by_range_id) return true;
          const r = store.ranges.get(t.reserved_by_range_id);
          return !r || r.closed_at !== null;
        })
        .sort((a, b) => (a.ticket_serial < b.ticket_serial ? 1 : -1))
        .slice(0, limit);
      const rows = candidates.map((t) => ({
        id: t.id,
        ticket_serial: t.ticket_serial,
      }));
      return { rows, rowCount: rows.length };
    }

    // PT5 extend: UPDATE range SET serials = $1::jsonb, final_serial = $2
    if (
      sql.includes("UPDATE")
      && sql.includes("app_agent_ticket_ranges")
      && sql.includes("SET serials = $1::jsonb")
      && sql.includes("final_serial = $2")
    ) {
      const [serialsJson, newFinalSerial, id] = params as [string, string, string];
      const r = store.ranges.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      r.serials = JSON.parse(serialsJson) as string[];
      r.final_serial = newFinalSerial;
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`MockPool: unhandled SQL: ${s.slice(0, 120)}`);
  };

  const client = {
    query: runQuery,
    release: () => { /* no-op */ },
  };

  const pool = {
    connect: async () => client,
    query: runQuery,
  } as unknown as Pool;

  return pool;
}

export function makeService(store: MockStore): AgentTicketRangeService {
  return AgentTicketRangeService.forTesting(makeMockPool(store));
}

// ── Scenario-helpers (delt mellom flere test-filer) ────────────────────────

/**
 * Setter opp en åpen range "range-1" for agent-1 i hall-a med serials
 * ["100","99","98","97","96","95"] (DESC). Toppen er "100".
 * Ticket-rader seedes med reserved_by_range_id = "range-1".
 *
 * Brukes av PT3 recordBatchSale-tester.
 */
export function seedBatchSaleScenario(store: MockStore): void {
  const serials = ["100", "99", "98", "97", "96", "95"];
  seedRange(store, {
    id: "range-1",
    agent_id: "agent-1",
    hall_id: "hall-a",
    ticket_color: "small",
    initial_serial: "100",
    final_serial: "95",
    serials,
    current_top_serial: "100",
  });
  const reservedBy: Record<string, string> = {};
  for (const s of serials) reservedBy[s] = "range-1";
  seedTickets(store, {
    hallId: "hall-a",
    color: "small",
    serials,
    reservedBy,
  });
  // Ett planlagt spill i hallen — starter om 1 min, varer 1 time.
  seedScheduledGame(store, {
    id: "sched-game-1",
    master_hall_id: "hall-a",
    participating_halls: ["hall-a"],
    status: "scheduled",
  });
}

/**
 * Kari har en åpen range (range-kari) med serials ["100"..."95"],
 * currentTop = "97" (dvs. "100", "99", "98" er solgt og har sold_from_range_id
 * = range-kari). Per (bruker per-1) er seedet som HALL_OPERATOR i samme hall.
 *
 * Brukes av PT5 handoverRange-tester.
 */
export function seedHandoverScenario(store: MockStore): void {
  const serials = ["100", "99", "98", "97", "96", "95"];
  seedRange(store, {
    id: "range-kari",
    agent_id: "kari-1",
    hall_id: "hall-a",
    ticket_color: "small",
    initial_serial: "100",
    final_serial: "95",
    serials,
    current_top_serial: "97", // 100, 99, 98 er solgt
  });
  // Usolgte bonger (97-95) har reserved_by_range_id = range-kari.
  for (const s of ["97", "96", "95"]) {
    const id = `tkt-hall-a-small-${s}`;
    store.tickets.set(id, {
      id,
      hall_id: "hall-a",
      ticket_serial: s,
      ticket_color: "small",
      is_purchased: false,
      reserved_by_range_id: "range-kari",
      sold_from_range_id: null,
      responsible_user_id: null,
      paid_out_at: null,
    });
  }
  // Solgte-uutbetalte bonger (100, 99, 98) har sold_from_range_id = range-kari
  // og responsible_user_id = kari-1.
  for (const s of ["100", "99", "98"]) {
    const id = `tkt-hall-a-small-${s}`;
    store.tickets.set(id, {
      id,
      hall_id: "hall-a",
      ticket_serial: s,
      ticket_color: "small",
      is_purchased: true,
      reserved_by_range_id: null,
      sold_from_range_id: "range-kari",
      responsible_user_id: "kari-1",
      paid_out_at: null,
    });
  }
  // Kari + Per som brukere.
  seedUser(store, { id: "kari-1", role: "HALL_OPERATOR", hall_id: "hall-a" });
  seedUser(store, { id: "per-1", role: "HALL_OPERATOR", hall_id: "hall-a" });
}

/**
 * Setter opp en åpen range range-per med serials ["100"..."96"]
 * (5 bonger) i hall-a + farge small, og tilgjengelige bonger ["95"..."85"]
 * (11 bonger) i inventaret som ikke er reservert.
 *
 * Brukes av PT5 extendRange-tester.
 */
export function seedExtendScenario(store: MockStore): void {
  const serials = ["100", "99", "98", "97", "96"];
  seedRange(store, {
    id: "range-per",
    agent_id: "per-1",
    hall_id: "hall-a",
    ticket_color: "small",
    initial_serial: "100",
    final_serial: "96",
    serials,
    current_top_serial: "98", // 100, 99 solgt, 98-96 usolgt
  });
  for (const s of serials) {
    const id = `tkt-hall-a-small-${s}`;
    store.tickets.set(id, {
      id,
      hall_id: "hall-a",
      ticket_serial: s,
      ticket_color: "small",
      is_purchased: ["100", "99"].includes(s),
      reserved_by_range_id: ["100", "99"].includes(s) ? null : "range-per",
      sold_from_range_id: ["100", "99"].includes(s) ? "range-per" : null,
      responsible_user_id: ["100", "99"].includes(s) ? "per-1" : null,
      paid_out_at: null,
    });
  }
  // Tilgjengelig inventar under 96: 95, 94, 93, ..., 85 (11 bonger).
  for (let n = 95; n >= 85; n -= 1) {
    const s = String(n);
    const id = `tkt-hall-a-small-${s}`;
    store.tickets.set(id, {
      id,
      hall_id: "hall-a",
      ticket_serial: s,
      ticket_color: "small",
      is_purchased: false,
      reserved_by_range_id: null,
      paid_out_at: null,
    });
  }
}
