/**
 * PT2 — enhetstester for AgentTicketRangeService.
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *       (§ "Fase 2: Vakt-start + range-registrering")
 *
 * Dekker (≥15 tester):
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

interface MockStore {
  tickets: Map<string, MockTicket>; // key: ticket id
  ranges: Map<string, MockRange>; // key: range id
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
}

function newStore(): MockStore {
  return {
    tickets: new Map(),
    ranges: new Map(),
    txActive: 0,
    commitCount: 0,
    rollbackCount: 0,
    onScannedSelectHook: null,
    forceReservationMismatch: false,
  };
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

    // SELECT range FOR UPDATE (close-flow)
    if (
      sql.includes("FROM")
      && sql.includes("app_agent_ticket_ranges")
      && sql.includes("WHERE id = $1")
      && sql.includes("FOR UPDATE")
    ) {
      const [id] = params as [string];
      const r = store.ranges.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          id: r.id,
          agent_id: r.agent_id,
          closed_at: r.closed_at,
        }],
        rowCount: 1,
      };
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
