/**
 * PT2 — enhetstester for AgentTicketRangeService (basics).
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *       (§ "Fase 2: Vakt-start + range-registrering")
 *
 * Dekker:
 *   - Input-validering (agentId/hallId/ticketColor/count, count = 1, count > MAX).
 *   - registerRange happy path + scan-valideringer
 *     (TICKET_NOT_FOUND, TICKET_WRONG_HALL, TICKET_WRONG_COLOR,
 *      TICKET_ALREADY_SOLD, TICKET_ALREADY_RESERVED, lukket-range-rebrukes,
 *      INSUFFICIENT_INVENTORY).
 *   - Race-sikring (parallelle kall, scan-vs-sale-race, reservation-mismatch).
 *   - closeRange (happy, RANGE_NOT_FOUND, FORBIDDEN, RANGE_ALREADY_CLOSED).
 *   - list/get-helpers (listActiveRangesByAgent/Hall, getRangeById).
 *
 * Splittet ut fra AgentTicketRangeService.test.ts for å unngå
 * Node `node:test` IPC-overflow på trege CI-runnere. Se PR #472.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../../game/BingoEngine.js";
import type { StaticTicketColor } from "../StaticTicketService.js";
import {
  makeService,
  newStore,
  seedRange,
  seedTickets,
} from "./fixtures/agentTicketRangeFixtures.js";

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
