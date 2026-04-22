/**
 * PT2+PT3 — enhetstester for AgentTicketRangeService.
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *       (§ "Fase 2: Vakt-start + range-registrering")
 *       (§ "Fase 4: Batch-oppdatering (returnering til stativ)")
 *
 * Dekker (≥20 tester):
 *   PT2:
 *   1. Input-validering (agentId/hallId/ticketColor/count).
 *   2. registerRange happy path.
 *   3. TICKET_WRONG_HALL.
 *   4. TICKET_WRONG_COLOR.
 *   5. TICKET_ALREADY_SOLD.
 *   6. TICKET_ALREADY_RESERVED (åpen range).
 *   7. Reservert av lukket range → tillatt.
 *   8. TICKET_NOT_FOUND (ukjent barcode).
 *   9. INSUFFICIENT_INVENTORY (færre bonger enn count).
 *  10. Race mellom to parallelle registerRange på samme barcode.
 *  11. closeRange happy path.
 *  12. closeRange RANGE_NOT_FOUND.
 *  13. closeRange FORBIDDEN (ikke eier).
 *  14. closeRange RANGE_ALREADY_CLOSED.
 *  15. listActiveRangesByAgent + listActiveRangesByHall.
 *  16. Transaksjonell rollback ved reservation-mismatch.
 *  17. count = 1 (minimum).
 *  18. count over MAX_RANGE_COUNT avvises.
 *
 *   PT3 (recordBatchSale):
 *  19. Happy-path (soldCount = currentTopIdx → newTopIdx; auto scheduledGame).
 *  20. newTop == currentTop → NO_TICKETS_SOLD.
 *  21. newTop > currentTop → INVALID_NEW_TOP.
 *  22. newTop utenfor range.serials → SERIAL_NOT_IN_RANGE.
 *  23. Range lukket → RANGE_ALREADY_CLOSED.
 *  24. Wrong agent → FORBIDDEN.
 *  25. Ingen planlagt spill → NO_UPCOMING_GAME_FOR_HALL.
 *  26. scheduledGameId eksplisitt (hall-match).
 *  27. scheduledGameId eksplisitt (hall mismatch) → SCHEDULED_GAME_HALL_MISMATCH.
 *  28. scheduledGameId eksplisitt (ukjent id) → SCHEDULED_GAME_NOT_FOUND.
 *  29. scheduledGameId eksplisitt (completed/cancelled) → SCHEDULED_GAME_NOT_JOINABLE.
 *  30. adminOverride = true → tillater batch-salg på annens range.
 *  31. Race: to parallelle batch-salg — kun én vinner.
 *  32. range.current_top_serial oppdateres etter happy-path.
 *  33. app_static_tickets oppdateres med is_purchased=true + sold_to_scheduled_game_id.
 *  34. Rollback ved batch-update-mismatch (færre rader oppdatert enn forventet).
 *  35. Tomt newTopSerial → INVALID_INPUT.
 *  36. RANGE_NOT_FOUND når rangeId ukjent.
 *  37. Partial sale: flere sekvensielle batch-salg dekrementerer top stegvis.
 *  38. participating_halls_json matching (hall er ikke master).
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { AgentTicketRangeService } from "../AgentTicketRangeService.js";
import { DomainError } from "../../game/BingoEngine.js";
import type { StaticTicketColor } from "../StaticTicketService.js";

// ── Mock store / pool ──────────────────────────────────────────────────────

interface MockTicket {
  id: string;
  hall_id: string;
  ticket_serial: string;
  ticket_color: StaticTicketColor;
  is_purchased: boolean;
  reserved_by_range_id: string | null;
}

interface MockRange {
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
}

interface MockScheduledGame {
  id: string;
  status: string;
  master_hall_id: string;
  participating_halls: string[];
  scheduled_start_time: Date;
  scheduled_end_time: Date;
}

interface MockStore {
  tickets: Map<string, MockTicket>; // key: ticket id
  ranges: Map<string, MockRange>; // key: range id
  scheduledGames: Map<string, MockScheduledGame>;
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

function newStore(): MockStore {
  return {
    tickets: new Map(),
    ranges: new Map(),
    scheduledGames: new Map(),
    txActive: 0,
    commitCount: 0,
    rollbackCount: 0,
    onScannedSelectHook: null,
    forceReservationMismatch: false,
    forceBatchUpdateMismatch: false,
    onBeforeBatchUpdateHook: null,
  };
}

function seedScheduledGame(
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

function seedTickets(
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

function seedRange(store: MockStore, range: Partial<MockRange> & { id: string; agent_id: string; hall_id: string; ticket_color: StaticTicketColor }): MockRange {
  const full: MockRange = {
    initial_serial: range.initial_serial ?? "100",
    final_serial: range.final_serial ?? "100",
    serials: range.serials ?? ["100"],
    next_available_index: range.next_available_index ?? 0,
    current_top_serial: range.current_top_serial ?? range.initial_serial ?? "100",
    registered_at: range.registered_at ?? new Date(),
    closed_at: range.closed_at ?? null,
    handover_from_range_id: range.handover_from_range_id ?? null,
    ...range,
  };
  store.ranges.set(full.id, full);
  return full;
}

function makeMockPool(store: MockStore): Pool {
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

    // INSERT range
    if (
      sql.includes("INSERT INTO")
      && sql.includes("app_agent_ticket_ranges")
    ) {
      const [id, agentId, hallId, color, initial, final, serialsJson] = params as [
        string, string, string, StaticTicketColor, string, string, string,
      ];
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
        handover_from_range_id: null,
      };
      store.ranges.set(id, row);
      return { rows: [{ registered_at: now }], rowCount: 1 };
    }

    // UPDATE tickets reserved_by_range_id
    if (
      sql.includes("UPDATE")
      && sql.includes("app_static_tickets")
      && sql.includes("SET reserved_by_range_id = $1")
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

    // UPDATE range SET closed_at = now()
    if (
      sql.includes("UPDATE")
      && sql.includes("app_agent_ticket_ranges")
      && sql.includes("SET closed_at = now()")
    ) {
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
        }],
        rowCount: 1,
      };
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

function makeService(store: MockStore): AgentTicketRangeService {
  return AgentTicketRangeService.forTesting(makeMockPool(store));
}

// ── Input-validering ───────────────────────────────────────────────────────

test("PT2 registerRange: tom agentId avvises", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 10,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT2 registerRange: tom hallId avvises", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-1",
        hallId: "",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 10,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT2 registerRange: ugyldig farge avvises", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-1",
        hallId: "hall-a",
        ticketColor: "rainbow" as StaticTicketColor,
        firstScannedSerial: "100",
        count: 10,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT2 registerRange: count <= 0 avvises", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-1",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 0,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT2 registerRange: count = 1 (minimum) tillates", async () => {
  const store = newStore();
  seedTickets(store, {
    hallId: "hall-a",
    color: "small",
    serials: ["100"],
  });
  const svc = makeService(store);
  const res = await svc.registerRange({
    agentId: "agent-1",
    hallId: "hall-a",
    ticketColor: "small",
    firstScannedSerial: "100",
    count: 1,
  });
  assert.equal(res.reservedCount, 1);
  assert.equal(res.initialTopSerial, "100");
  assert.equal(res.finalSerial, "100");
});

test("PT2 registerRange: count over MAX_RANGE_COUNT avvises", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-1",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 999999,
      }),
    (err: unknown) =>
      err instanceof DomainError
      && err.code === "INVALID_INPUT"
      && err.message.includes("maks"),
  );
});

// ── Happy-path + scan-valideringer ─────────────────────────────────────────

test("PT2 registerRange: happy path — 10 bonger reservert", async () => {
  const store = newStore();
  seedTickets(store, {
    hallId: "hall-a",
    color: "small",
    serials: ["100", "099", "098", "097", "096", "095", "094", "093", "092", "091"],
  });
  const svc = makeService(store);
  const res = await svc.registerRange({
    agentId: "agent-1",
    hallId: "hall-a",
    ticketColor: "small",
    firstScannedSerial: "100",
    count: 10,
  });
  assert.equal(res.reservedCount, 10);
  assert.equal(res.initialTopSerial, "100");
  assert.equal(res.finalSerial, "091");
  assert.ok(res.rangeId);

  // Alle 10 bonger skal nå ha reserved_by_range_id satt.
  const reserved = [...store.tickets.values()].filter((t) => t.reserved_by_range_id === res.rangeId);
  assert.equal(reserved.length, 10);

  // Range skal være opprettet med current_top_serial = initial.
  const range = store.ranges.get(res.rangeId);
  assert.ok(range);
  assert.equal(range!.current_top_serial, "100");
  assert.equal(range!.initial_serial, "100");
  assert.equal(range!.final_serial, "091");
  assert.equal(range!.serials.length, 10);
  assert.equal(range!.closed_at, null);

  // COMMIT-ed — ingen rollback.
  assert.equal(store.commitCount, 1);
  assert.equal(store.rollbackCount, 0);
});

test("PT2 registerRange: TICKET_NOT_FOUND ved ukjent barcode", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-1",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "ukjent-barcode",
        count: 1,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "TICKET_NOT_FOUND",
  );
});

test("PT2 registerRange: TICKET_WRONG_HALL hvis bongen er i annen hall", async () => {
  const store = newStore();
  seedTickets(store, {
    hallId: "hall-b",
    color: "small",
    serials: ["100"],
  });
  const svc = makeService(store);
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-1",
        hallId: "hall-a", // bingovert er i hall-a, men bongen er i hall-b
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 1,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "TICKET_WRONG_HALL",
  );

  // Rollback må ha skjedd.
  assert.equal(store.rollbackCount, 1);
  assert.equal(store.commitCount, 0);
});

test("PT2 registerRange: TICKET_WRONG_COLOR hvis farge mismatch", async () => {
  const store = newStore();
  seedTickets(store, {
    hallId: "hall-a",
    color: "small",
    serials: ["100"],
  });
  const svc = makeService(store);
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-1",
        hallId: "hall-a",
        ticketColor: "large",
        firstScannedSerial: "100",
        count: 1,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "TICKET_WRONG_COLOR",
  );
  assert.equal(store.rollbackCount, 1);
});

test("PT2 registerRange: TICKET_ALREADY_SOLD", async () => {
  const store = newStore();
  seedTickets(store, {
    hallId: "hall-a",
    color: "small",
    serials: ["100"],
    purchased: ["100"],
  });
  const svc = makeService(store);
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-1",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 1,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "TICKET_ALREADY_SOLD",
  );
});

test("PT2 registerRange: TICKET_ALREADY_RESERVED av åpen range", async () => {
  const store = newStore();
  const existingRangeId = "range-existing";
  seedTickets(store, {
    hallId: "hall-a",
    color: "small",
    serials: ["100"],
    reservedBy: { "100": existingRangeId },
  });
  seedRange(store, {
    id: existingRangeId,
    agent_id: "agent-other",
    hall_id: "hall-a",
    ticket_color: "small",
    initial_serial: "100",
    final_serial: "100",
    serials: ["100"],
    closed_at: null, // åpen
  });

  const svc = makeService(store);
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-1",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 1,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "TICKET_ALREADY_RESERVED",
  );
});

test("PT2 registerRange: bong reservert av LUKKET range kan re-reserveres", async () => {
  const store = newStore();
  const oldRangeId = "range-old";
  seedTickets(store, {
    hallId: "hall-a",
    color: "small",
    serials: ["100"],
    reservedBy: { "100": oldRangeId },
  });
  seedRange(store, {
    id: oldRangeId,
    agent_id: "agent-prev",
    hall_id: "hall-a",
    ticket_color: "small",
    initial_serial: "100",
    final_serial: "100",
    serials: ["100"],
    closed_at: new Date(), // lukket
  });

  const svc = makeService(store);
  const res = await svc.registerRange({
    agentId: "agent-1",
    hallId: "hall-a",
    ticketColor: "small",
    firstScannedSerial: "100",
    count: 1,
  });
  assert.equal(res.reservedCount, 1);
  // Ny range eier bongen nå.
  const t = store.tickets.get("tkt-hall-a-small-100");
  assert.equal(t!.reserved_by_range_id, res.rangeId);
});

test("PT2 registerRange: INSUFFICIENT_INVENTORY når færre bonger enn count", async () => {
  const store = newStore();
  seedTickets(store, {
    hallId: "hall-a",
    color: "small",
    serials: ["100", "099"], // kun 2 bonger
  });
  const svc = makeService(store);
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-1",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 10,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INSUFFICIENT_INVENTORY",
  );
});

// ── Race-sikring ──────────────────────────────────────────────────────────

test("PT2 registerRange: race — to parallelle kall på samme barcode, kun én vinner", async () => {
  const store = newStore();
  seedTickets(store, {
    hallId: "hall-a",
    color: "small",
    serials: ["100", "099", "098"],
  });

  const svc = makeService(store);

  // Kjør to registreringer "parallelt" (sekvensielt fordi mock-pool er
  // enkel-tråd, men den andre må se state-en fra den første).
  const r1 = await svc.registerRange({
    agentId: "agent-1",
    hallId: "hall-a",
    ticketColor: "small",
    firstScannedSerial: "100",
    count: 2,
  });
  assert.equal(r1.reservedCount, 2);

  // Andre registrering på samme scannet top må feile fordi bongen nå er
  // reservert av den åpne rangen fra første.
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-2",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 1,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "TICKET_ALREADY_RESERVED",
  );
});

test("PT2 registerRange: race — bong solgt mellom scan og reserve (simulert via hook)", async () => {
  const store = newStore();
  seedTickets(store, {
    hallId: "hall-a",
    color: "small",
    serials: ["100"],
  });

  // Injecter en mutasjon i SELECT-fasen: merk bongen som solgt rett før
  // scan-sjekken treffer den.
  store.onScannedSelectHook = () => {
    const t = store.tickets.get("tkt-hall-a-small-100")!;
    t.is_purchased = true;
  };

  const svc = makeService(store);
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-1",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 1,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "TICKET_ALREADY_SOLD",
  );
});

test("PT2 registerRange: reservation-mismatch kaster INTERNAL_ERROR og ruller tilbake", async () => {
  const store = newStore();
  seedTickets(store, {
    hallId: "hall-a",
    color: "small",
    serials: ["100", "099"],
  });
  store.forceReservationMismatch = true;

  const svc = makeService(store);
  await assert.rejects(
    () =>
      svc.registerRange({
        agentId: "agent-1",
        hallId: "hall-a",
        ticketColor: "small",
        firstScannedSerial: "100",
        count: 2,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INTERNAL_ERROR",
  );
  assert.equal(store.rollbackCount, 1);
  assert.equal(store.commitCount, 0);
});

// ── closeRange ─────────────────────────────────────────────────────────────

test("PT2 closeRange: happy path", async () => {
  const store = newStore();
  seedRange(store, {
    id: "range-1",
    agent_id: "agent-1",
    hall_id: "hall-a",
    ticket_color: "small",
  });
  const svc = makeService(store);
  const res = await svc.closeRange("range-1", "agent-1");
  assert.equal(res.rangeId, "range-1");
  assert.ok(res.closedAt);
  assert.ok(store.ranges.get("range-1")!.closed_at !== null);
});

test("PT2 closeRange: RANGE_NOT_FOUND", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () => svc.closeRange("no-such-range", "agent-1"),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_NOT_FOUND",
  );
});

test("PT2 closeRange: FORBIDDEN for ikke-eier", async () => {
  const store = newStore();
  seedRange(store, {
    id: "range-1",
    agent_id: "agent-1",
    hall_id: "hall-a",
    ticket_color: "small",
  });
  const svc = makeService(store);
  await assert.rejects(
    () => svc.closeRange("range-1", "agent-other"),
    (err: unknown) => err instanceof DomainError && err.code === "FORBIDDEN",
  );
});

test("PT2 closeRange: RANGE_ALREADY_CLOSED", async () => {
  const store = newStore();
  seedRange(store, {
    id: "range-1",
    agent_id: "agent-1",
    hall_id: "hall-a",
    ticket_color: "small",
    closed_at: new Date(),
  });
  const svc = makeService(store);
  await assert.rejects(
    () => svc.closeRange("range-1", "agent-1"),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_ALREADY_CLOSED",
  );
});

// ── List + get ─────────────────────────────────────────────────────────────

test("PT2 listActiveRangesByAgent: returnerer kun åpne ranges for gitt agent", async () => {
  const store = newStore();
  seedRange(store, {
    id: "r1",
    agent_id: "agent-1",
    hall_id: "hall-a",
    ticket_color: "small",
  });
  seedRange(store, {
    id: "r2",
    agent_id: "agent-1",
    hall_id: "hall-b",
    ticket_color: "large",
    closed_at: new Date(),
  });
  seedRange(store, {
    id: "r3",
    agent_id: "agent-other",
    hall_id: "hall-a",
    ticket_color: "small",
  });
  const svc = makeService(store);
  const list = await svc.listActiveRangesByAgent("agent-1");
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, "r1");
});

test("PT2 listActiveRangesByHall: returnerer kun åpne ranges for gitt hall", async () => {
  const store = newStore();
  seedRange(store, {
    id: "r1",
    agent_id: "a1",
    hall_id: "hall-a",
    ticket_color: "small",
  });
  seedRange(store, {
    id: "r2",
    agent_id: "a2",
    hall_id: "hall-a",
    ticket_color: "large",
  });
  seedRange(store, {
    id: "r3",
    agent_id: "a3",
    hall_id: "hall-b",
    ticket_color: "small",
  });
  const svc = makeService(store);
  const list = await svc.listActiveRangesByHall("hall-a");
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((r) => r.id).sort(),
    ["r1", "r2"],
  );
});

test("PT2 getRangeById: returnerer range eller null", async () => {
  const store = newStore();
  seedRange(store, {
    id: "r1",
    agent_id: "agent-1",
    hall_id: "hall-a",
    ticket_color: "small",
  });
  const svc = makeService(store);
  const found = await svc.getRangeById("r1");
  assert.ok(found);
  assert.equal(found!.id, "r1");
  const missing = await svc.getRangeById("nope");
  assert.equal(missing, null);
});

// ══════════════════════════════════════════════════════════════════════════
// PT3 — recordBatchSale
// ══════════════════════════════════════════════════════════════════════════

/**
 * Helper: setter opp en åpen range "range-1" for agent-1 i hall-a med
 * serials ["100","99","98","97","96","95"] (DESC). Toppen er "100".
 * Ticket-rader seedes med reserved_by_range_id = "range-1".
 */
function seedBatchSaleScenario(store: MockStore): void {
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

test("PT3 recordBatchSale: happy-path — 5 bonger solgt, top går fra 100 til 95", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  const res = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "agent-1",
  });

  assert.equal(res.soldCount, 5);
  assert.equal(res.previousTopSerial, "100");
  assert.equal(res.newTopSerial, "95");
  assert.equal(res.scheduledGameId, "sched-game-1");
  assert.ok(res.gameStartTime);
  assert.deepEqual(res.soldSerials, ["100", "99", "98", "97", "96"]);

  // Range-oppdatering: current_top_serial = "95".
  const range = store.ranges.get("range-1")!;
  assert.equal(range.current_top_serial, "95");

  // app_static_tickets: 5 solgt, 1 gjenstår.
  const sold = [...store.tickets.values()].filter((t) => t.is_purchased);
  const unsold = [...store.tickets.values()].filter((t) => !t.is_purchased);
  assert.equal(sold.length, 5);
  assert.equal(unsold.length, 1);
  assert.equal(unsold[0]!.ticket_serial, "95");

  // COMMIT ble kalt, ingen rollback.
  assert.equal(store.commitCount, 1);
  assert.equal(store.rollbackCount, 0);
});

test("PT3 recordBatchSale: newTop == currentTop → NO_TICKETS_SOLD", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "100", // samme som current
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "NO_TICKETS_SOLD",
  );

  // Rollback — ingen oppdateringer.
  assert.equal(store.rollbackCount, 1);
  assert.equal(store.commitCount, 0);
  const range = store.ranges.get("range-1")!;
  assert.equal(range.current_top_serial, "100");
});

test("PT3 recordBatchSale: newTop > currentTop → INVALID_NEW_TOP", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  // Flytt current ned til 97 først slik at 100 blir "over" current.
  const range = store.ranges.get("range-1")!;
  range.current_top_serial = "97";
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "100", // høyere opp i DESC-listen
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_NEW_TOP",
  );
});

test("PT3 recordBatchSale: newTopSerial utenfor range.serials → SERIAL_NOT_IN_RANGE", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "80", // ikke i ["100"..."95"]
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "SERIAL_NOT_IN_RANGE",
  );
});

test("PT3 recordBatchSale: RANGE_ALREADY_CLOSED", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  store.ranges.get("range-1")!.closed_at = new Date();
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_ALREADY_CLOSED",
  );
});

test("PT3 recordBatchSale: annen agent uten adminOverride → FORBIDDEN", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-2", // ikke eier
    }),
    (err: unknown) => err instanceof DomainError && err.code === "FORBIDDEN",
  );
});

test("PT3 recordBatchSale: adminOverride tillater batch-salg på annens range", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  const res = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "admin-1", // ikke eier, men override
    adminOverride: true,
  });
  assert.equal(res.soldCount, 5);
});

test("PT3 recordBatchSale: ingen planlagt spill → NO_UPCOMING_GAME_FOR_HALL", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  store.scheduledGames.clear(); // ingen spill
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) =>
      err instanceof DomainError
      && err.code === "NO_UPCOMING_GAME_FOR_HALL",
  );
  assert.equal(store.rollbackCount, 1);
});

test("PT3 recordBatchSale: completed scheduled_game filtreres ut → NO_UPCOMING_GAME_FOR_HALL", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  // Endre spillet til completed → skal ikke plukkes.
  store.scheduledGames.get("sched-game-1")!.status = "completed";
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) =>
      err instanceof DomainError
      && err.code === "NO_UPCOMING_GAME_FOR_HALL",
  );
});

test("PT3 recordBatchSale: eksplisitt scheduledGameId matcher hall", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  // Legg til et annet spill som skal velges først (starter tidligere).
  seedScheduledGame(store, {
    id: "sched-preferred",
    master_hall_id: "hall-a",
    participating_halls: ["hall-a"],
    status: "scheduled",
    scheduled_start_time: new Date(Date.now() - 30_000), // tidligere = ville blitt valgt
    scheduled_end_time: new Date(Date.now() + 3_600_000),
  });

  const svc = makeService(store);
  const res = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "agent-1",
    scheduledGameId: "sched-game-1", // eksplisitt valg overstyrer auto
  });
  assert.equal(res.scheduledGameId, "sched-game-1");
});

test("PT3 recordBatchSale: eksplisitt scheduledGameId med feil hall → SCHEDULED_GAME_HALL_MISMATCH", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  seedScheduledGame(store, {
    id: "sched-other-hall",
    master_hall_id: "hall-b", // annen hall
    participating_halls: ["hall-b"],
    status: "scheduled",
  });
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
      scheduledGameId: "sched-other-hall",
    }),
    (err: unknown) =>
      err instanceof DomainError
      && err.code === "SCHEDULED_GAME_HALL_MISMATCH",
  );
});

test("PT3 recordBatchSale: eksplisitt scheduledGameId ukjent → SCHEDULED_GAME_NOT_FOUND", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
      scheduledGameId: "no-such-game",
    }),
    (err: unknown) =>
      err instanceof DomainError
      && err.code === "SCHEDULED_GAME_NOT_FOUND",
  );
});

test("PT3 recordBatchSale: eksplisitt scheduledGameId status completed → SCHEDULED_GAME_NOT_JOINABLE", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  store.scheduledGames.get("sched-game-1")!.status = "completed";
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
      scheduledGameId: "sched-game-1",
    }),
    (err: unknown) =>
      err instanceof DomainError
      && err.code === "SCHEDULED_GAME_NOT_JOINABLE",
  );
});

test("PT3 recordBatchSale: RANGE_NOT_FOUND ved ukjent rangeId", async () => {
  const store = newStore();
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "nope",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_NOT_FOUND",
  );
});

test("PT3 recordBatchSale: tomt newTopSerial → INVALID_INPUT", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT3 recordBatchSale: tomt rangeId → INVALID_INPUT", async () => {
  const svc = makeService(newStore());
  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("PT3 recordBatchSale: rollback når batch-update treffer færre rader enn forventet", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  store.forceBatchUpdateMismatch = true;
  const svc = makeService(store);

  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INTERNAL_ERROR",
  );
  assert.equal(store.rollbackCount, 1);
  assert.equal(store.commitCount, 0);

  // Range skal IKKE være oppdatert.
  const range = store.ranges.get("range-1")!;
  assert.equal(range.current_top_serial, "100");
});

test("PT3 recordBatchSale: sekvensielle batch-salg dekrementerer top stegvis", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  // Første batch: 100 → 97 (3 solgt).
  const r1 = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "97",
    userId: "agent-1",
  });
  assert.equal(r1.soldCount, 3);
  assert.deepEqual(r1.soldSerials, ["100", "99", "98"]);
  assert.equal(store.ranges.get("range-1")!.current_top_serial, "97");

  // Andre batch: 97 → 95 (2 solgt).
  const r2 = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "agent-1",
  });
  assert.equal(r2.soldCount, 2);
  assert.deepEqual(r2.soldSerials, ["97", "96"]);
  assert.equal(store.ranges.get("range-1")!.current_top_serial, "95");

  // Alle 5 bonger solgt (mellom 100 og 95 eksklusivt, altså 100,99,98,97,96).
  const sold = [...store.tickets.values()].filter((t) => t.is_purchased);
  assert.equal(sold.length, 5);
});

test("PT3 recordBatchSale: race — to parallelle batch-salg på samme range, kun én vinner", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  // Første kallet lykkes: 100 → 97.
  const r1 = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "97",
    userId: "agent-1",
  });
  assert.equal(r1.soldCount, 3);

  // Andre kallet forsøker å ta topp fra 100 → 95, men siden range nå står på
  // 97 må 100-targeting feile — 100 ligger "over" nåværende top (97).
  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "100",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_NEW_TOP",
  );
});

test("PT3 recordBatchSale: happy-path — hall er participating, ikke master", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  // Endre spillet: hall-a er deltaker, men ikke master.
  store.scheduledGames.clear();
  seedScheduledGame(store, {
    id: "sched-participating",
    master_hall_id: "hall-MASTER",
    participating_halls: ["hall-MASTER", "hall-a"],
    status: "purchase_open",
  });
  const svc = makeService(store);

  const res = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "agent-1",
  });
  assert.equal(res.scheduledGameId, "sched-participating");
});

test("PT3 recordBatchSale: selger hele rangen (newTop = final_serial)", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  // newTop = "95" = siste serial i rangen (= final_serial).
  // Siden newTopIndex = serials.length - 1 = 5 og currentTopIndex = 0,
  // slicer vi [0, 5) → alle bortsett fra "95" (selv = ny top).
  // "95" blir stående som usolgt topp.
  const res = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "agent-1",
  });
  assert.equal(res.soldCount, 5);
  assert.equal(res.soldSerials[res.soldSerials.length - 1], "96");

  // Den siste bongen "95" står fortsatt som usolgt.
  const t95 = [...store.tickets.values()].find((t) => t.ticket_serial === "95")!;
  assert.equal(t95.is_purchased, false);
});

test("PT3 recordBatchSale: dobbeltkall med samme newTop → andre kall NO_TICKETS_SOLD", async () => {
  const store = newStore();
  seedBatchSaleScenario(store);
  const svc = makeService(store);

  const r1 = await svc.recordBatchSale({
    rangeId: "range-1",
    newTopSerial: "95",
    userId: "agent-1",
  });
  assert.equal(r1.soldCount, 5);

  // Andre kall med samme newTop → NO_TICKETS_SOLD (idempotent-safe).
  await assert.rejects(
    () => svc.recordBatchSale({
      rangeId: "range-1",
      newTopSerial: "95",
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "NO_TICKETS_SOLD",
  );
});
