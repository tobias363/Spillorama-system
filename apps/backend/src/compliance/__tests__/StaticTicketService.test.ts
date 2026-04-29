/**
 * PT1: unit-tester for StaticTicketService.
 *
 * Dekker:
 *   1. CSV-parser (parseStaticTicketCsv) — pure funksjon, ingen DB.
 *   2. deriveColorFamily — normalisering av ticket_color-streng til familie.
 *   3. Service-validering via `forTesting` + stub-pool.
 *   4. importFromCSV — happy path + rollback + idempotent re-import.
 *   5. bulkMarkSold — dobbelsalg-beskyttelse + matching.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  StaticTicketService,
  parseStaticTicketCsv,
  deriveColorFamily,
  MAX_CSV_ROWS,
} from "../StaticTicketService.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function nums25(): string {
  // 25 gyldige tall (1-75), kommaseparert
  const xs: number[] = [];
  for (let i = 0; i < 25; i += 1) xs.push(((i * 3) % 75) + 1);
  return xs.join(",");
}

function csvRow(hall: string, ticketId: string, color: string): string {
  return `${hall},${ticketId},${color},${nums25()}`;
}

function csvHeader(): string {
  return "hall_name,ticket_id,ticket_color,num1,num2,num3,num4,num5,num6,num7,num8,num9,num10,num11,num12,num13,num14,num15,num16,num17,num18,num19,num20,num21,num22,num23,num24,num25";
}

// ── deriveColorFamily ──────────────────────────────────────────────────────

test("PT1 deriveColorFamily: small_yellow → small", () => {
  assert.equal(deriveColorFamily("small_yellow"), "small");
});

test("PT1 deriveColorFamily: small-yellow (hyphen) → small", () => {
  assert.equal(deriveColorFamily("small-yellow"), "small");
});

test("PT1 deriveColorFamily: large_white → large", () => {
  assert.equal(deriveColorFamily("large_white"), "large");
});

test("PT1 deriveColorFamily: traffic-light → traffic-light", () => {
  assert.equal(deriveColorFamily("traffic-light"), "traffic-light");
});

test("PT1 deriveColorFamily: trafficLight → traffic-light", () => {
  assert.equal(deriveColorFamily("trafficLight"), "traffic-light");
});

test("PT1 deriveColorFamily: elvis → large", () => {
  assert.equal(deriveColorFamily("elvis"), "large");
});

test("PT1 deriveColorFamily: case-insensitive (SMALL_YELLOW)", () => {
  assert.equal(deriveColorFamily("SMALL_YELLOW"), "small");
});

test("PT1 deriveColorFamily: ukjent farge kaster INVALID_INPUT", () => {
  try {
    deriveColorFamily("rainbow_unicorn");
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.equal((err as DomainError).code, "INVALID_INPUT");
  }
});

// ── parseStaticTicketCsv ───────────────────────────────────────────────────

test("PT1 parseCsv: enkel data-rad uten header", () => {
  const csv = csvRow("Notodden", "01-1001", "small_yellow");
  const rows = parseStaticTicketCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.ticketId, "01-1001");
  assert.equal(rows[0]!.ticketType, "small_yellow");
  assert.equal(rows[0]!.ticketColor, "small");
  assert.equal(rows[0]!.cardMatrix.length, 25);
  assert.equal(rows[0]!.hallNameInCsv, "Notodden");
});

test("PT1 parseCsv: header-rad hoppes over", () => {
  const csv = [csvHeader(), csvRow("Notodden", "01-1001", "small_yellow")].join("\n");
  const rows = parseStaticTicketCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.ticketId, "01-1001");
});

test("PT1 parseCsv: flere rader", () => {
  const csv = [
    csvHeader(),
    csvRow("Notodden", "01-1001", "small_yellow"),
    csvRow("Notodden", "01-1002", "small_yellow"),
    csvRow("Notodden", "01-1003", "large_white"),
  ].join("\n");
  const rows = parseStaticTicketCsv(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.ticketColor, "small");
  assert.equal(rows[2]!.ticketColor, "large");
});

test("PT1 parseCsv: tab-delimitert (legacy-format) støttes", () => {
  const tabRow = `Notodden\t01-1001\tsmall_yellow\t${nums25().replace(/,/g, "\t")}`;
  const rows = parseStaticTicketCsv(tabRow);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.ticketId, "01-1001");
});

test("PT1 parseCsv: tom fil avvises", () => {
  try {
    parseStaticTicketCsv("");
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
  }
});

test("PT1 parseCsv: kun header (ingen data-rader) avvises", () => {
  try {
    parseStaticTicketCsv(csvHeader());
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.ok((err as DomainError).message.includes("ingen data"));
  }
});

test("PT1 parseCsv: feil antall kolonner kaster INVALID_INPUT med lineNumber", () => {
  const bad = "Notodden,01-1001,small_yellow,1,2,3"; // mangler 22 tall
  try {
    parseStaticTicketCsv(bad);
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.ok((err as DomainError).message.includes("Linje 1"));
    assert.ok((err as DomainError).message.includes("28 kolonner"));
  }
});

test("PT1 parseCsv: tall utenfor 1-75 range avvises", () => {
  const bad = `Notodden,01-1001,small_yellow,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,76`;
  try {
    parseStaticTicketCsv(bad);
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.ok((err as DomainError).message.includes("num25"));
    assert.ok((err as DomainError).message.includes("76"));
  }
});

test("PT1 parseCsv: ikke-heltall i tall-felt avvises", () => {
  const bad = `Notodden,01-1001,small_yellow,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,3.5`;
  try {
    parseStaticTicketCsv(bad);
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.ok((err as DomainError).message.includes("ikke et heltall"));
  }
});

test("PT1 parseCsv: duplicate ticket_id innen fil avvises", () => {
  const csv = [
    csvRow("Notodden", "01-1001", "small_yellow"),
    csvRow("Notodden", "01-1001", "small_yellow"),
  ].join("\n");
  try {
    parseStaticTicketCsv(csv);
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.ok((err as DomainError).message.includes("duplicate"));
  }
});

test("PT1 parseCsv: tom ticket_id avvises", () => {
  const bad = `Notodden,,small_yellow,${nums25()}`;
  try {
    parseStaticTicketCsv(bad);
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.ok((err as DomainError).message.includes("ticket_id"));
  }
});

test("PT1 parseCsv: tom hall_name avvises", () => {
  const bad = `,01-1001,small_yellow,${nums25()}`;
  try {
    parseStaticTicketCsv(bad);
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.ok((err as DomainError).message.includes("hall_name"));
  }
});

test("PT1 parseCsv: for mange rader avvises", () => {
  // Bygg en CSV med MAX_CSV_ROWS+1 rader
  const lines: string[] = [];
  for (let i = 0; i < MAX_CSV_ROWS + 1; i += 1) {
    lines.push(csvRow("Notodden", `id-${i}`, "small_yellow"));
  }
  try {
    parseStaticTicketCsv(lines.join("\n"));
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.ok((err as DomainError).message.includes("maks"));
  }
});

test("PT1 parseCsv: tomme blank-linjer ignoreres", () => {
  const csv = [
    csvHeader(),
    "",
    csvRow("Notodden", "01-1001", "small_yellow"),
    "",
    csvRow("Notodden", "01-1002", "small_yellow"),
  ].join("\n");
  const rows = parseStaticTicketCsv(csv);
  assert.equal(rows.length, 2);
});

// ── importFromCSV — mock-pool integrasjon ─────────────────────────────────

interface MockRow {
  id: string;
  hall_id: string;
  ticket_serial: string;
  ticket_color: string;
  ticket_type: string;
  card_matrix: number[];
  is_purchased: boolean;
  purchased_at: Date | null;
  imported_at: Date;
  sold_by_user_id: string | null;
  sold_from_range_id: string | null;
  responsible_user_id: string | null;
  sold_to_scheduled_game_id: string | null;
  reserved_by_range_id: string | null;
  paid_out_at: Date | null;
  paid_out_amount_cents: number | null;
  paid_out_by_user_id: string | null;
}

interface MockStore {
  halls: Set<string>;
  tickets: Map<string, MockRow>; // key = `${hall_id}::${serial}::${color}`
  beginCount: number;
  commitCount: number;
  rollbackCount: number;
  forceImportFailureAtRow: number | null;
}

function newStore(halls: string[] = ["hall-notodden"]): MockStore {
  return {
    halls: new Set(halls),
    tickets: new Map(),
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    forceImportFailureAtRow: null,
  };
}

function makeMockPool(store: MockStore): Pool {
  let insertCount = 0;
  const query = async (sql: string, params: unknown[] = []) => {
    const s = sql.trim();
    if (s.startsWith("BEGIN")) {
      store.beginCount += 1;
      return { rows: [], rowCount: 0 };
    }
    if (s.startsWith("COMMIT")) {
      store.commitCount += 1;
      return { rows: [], rowCount: 0 };
    }
    if (s.startsWith("ROLLBACK")) {
      store.rollbackCount += 1;
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("app_halls") && s.startsWith("SELECT")) {
      const [id] = params as [string];
      return store.halls.has(id)
        ? { rows: [{ id }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes("app_static_tickets") && s.startsWith("INSERT")) {
      insertCount += 1;
      if (
        store.forceImportFailureAtRow !== null
        && insertCount === store.forceImportFailureAtRow
      ) {
        throw new Error("simulated DB failure");
      }
      const [id, hallId, serial, color, type, matrixJson] = params as [
        string, string, string, string, string, string,
      ];
      const key = `${hallId}::${serial}::${color}`;
      if (store.tickets.has(key)) {
        // ON CONFLICT DO NOTHING → returner 0 rader
        return { rows: [], rowCount: 0 };
      }
      const row: MockRow = {
        id,
        hall_id: hallId,
        ticket_serial: serial,
        ticket_color: color,
        ticket_type: type,
        card_matrix: JSON.parse(matrixJson),
        is_purchased: false,
        purchased_at: null,
        imported_at: new Date(),
        sold_by_user_id: null,
        sold_from_range_id: null,
        responsible_user_id: null,
        sold_to_scheduled_game_id: null,
        reserved_by_range_id: null,
        paid_out_at: null,
        paid_out_amount_cents: null,
        paid_out_by_user_id: null,
      };
      store.tickets.set(key, row);
      return { rows: [{ id }], rowCount: 1 };
    }
    if (sql.includes("app_static_tickets") && s.startsWith("SELECT")) {
      // findByBarcode
      if (sql.includes("WHERE ticket_serial = $1")) {
        const [serial] = params as [string];
        const row = [...store.tickets.values()].find((r) => r.ticket_serial === serial);
        return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      // bulkMarkSold SELECT existing (må komme før listAvailable-sjekken
      // fordi begge har `hall_id = $1 AND ticket_color = $2`)
      if (sql.includes("ticket_serial = ANY")) {
        const [hallId, color, serials] = params as [string, string, string[]];
        const rows = serials
          .map((s) => store.tickets.get(`${hallId}::${s}::${color}`))
          .filter((r): r is MockRow => r !== undefined)
          .map((r) => ({ ticket_serial: r.ticket_serial, is_purchased: r.is_purchased }));
        return { rows, rowCount: rows.length };
      }
      // listAvailableByHallAndColor
      if (sql.includes("WHERE hall_id = $1") && sql.includes("ticket_color = $2")) {
        const [hallId, color] = params as [string, string];
        const rows = [...store.tickets.values()]
          .filter((r) =>
            r.hall_id === hallId
            && r.ticket_color === color
            && !r.is_purchased
            && r.reserved_by_range_id === null,
          )
          .sort((a, b) => b.ticket_serial.localeCompare(a.ticket_serial));
        return { rows, rowCount: rows.length };
      }
    }
    if (sql.includes("app_static_tickets") && s.startsWith("UPDATE")) {
      // bulkMarkSold UPDATE
      const [hallId, color, serials, soldByUserId, soldFromRangeId, responsibleUserId, scheduledGameId] =
        params as [string, string, string[], string, string, string, string | null];
      const updated: { id: string }[] = [];
      for (const serial of serials) {
        const row = store.tickets.get(`${hallId}::${serial}::${color}`);
        if (
          row
          && !row.is_purchased
          && row.reserved_by_range_id === soldFromRangeId
        ) {
          row.is_purchased = true;
          row.purchased_at = new Date();
          row.sold_by_user_id = soldByUserId;
          row.sold_from_range_id = soldFromRangeId;
          row.responsible_user_id = responsibleUserId;
          row.sold_to_scheduled_game_id = scheduledGameId;
          updated.push({ id: row.id });
        }
      }
      return { rows: updated, rowCount: updated.length };
    }
    throw new Error(`unhandled SQL in mock: ${s.slice(0, 100)}`);
  };

  const connect = async () => ({
    query,
    release: () => {},
  });

  return { query, connect } as unknown as Pool;
}

test("PT1 importFromCSV: happy path — 3 rader, alle inserted", async () => {
  const store = newStore();
  const pool = makeMockPool(store);
  const svc = StaticTicketService.forTesting(pool);
  const csv = [
    csvHeader(),
    csvRow("Notodden", "01-1001", "small_yellow"),
    csvRow("Notodden", "01-1002", "small_yellow"),
    csvRow("Notodden", "01-1003", "large_white"),
  ].join("\n");
  const result = await svc.importFromCSV(csv, "hall-notodden");
  assert.equal(result.inserted, 3);
  assert.equal(result.skipped, 0);
  assert.equal(result.totalRows, 3);
  assert.equal(store.tickets.size, 3);
  assert.equal(store.beginCount, 1);
  assert.equal(store.commitCount, 1);
  assert.equal(store.rollbackCount, 0);
});

test("PT1 importFromCSV: ukjent hall → HALL_NOT_FOUND", async () => {
  const store = newStore(["hall-a"]);
  const pool = makeMockPool(store);
  const svc = StaticTicketService.forTesting(pool);
  const csv = csvRow("X", "01-1001", "small_yellow");
  try {
    await svc.importFromCSV(csv, "hall-unknown");
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
    assert.equal((err as DomainError).code, "HALL_NOT_FOUND");
  }
});

test("PT1 importFromCSV: DB-feil mid-import → ROLLBACK, ingen rader inserted", async () => {
  const store = newStore();
  store.forceImportFailureAtRow = 2; // feil på andre INSERT
  const pool = makeMockPool(store);
  const svc = StaticTicketService.forTesting(pool);
  const csv = [
    csvRow("Notodden", "01-1001", "small_yellow"),
    csvRow("Notodden", "01-1002", "small_yellow"),
    csvRow("Notodden", "01-1003", "small_yellow"),
  ].join("\n");
  try {
    await svc.importFromCSV(csv, "hall-notodden");
    assert.fail("Forventet feil");
  } catch (err) {
    assert.ok(err instanceof DomainError);
  }
  // Første INSERT committet til mock-store, men ekte DB vil ROLLBACK
  // siden BEGIN ikke commiter før alle insert er OK. Mock-storen holder
  // "DB-state" utenfor transaksjonen; det viktige er at ROLLBACK ble kalt.
  assert.equal(store.beginCount, 1);
  assert.equal(store.rollbackCount, 1);
  assert.equal(store.commitCount, 0);
});

test("PT1 importFromCSV: idempotent re-import → duplikater skippes", async () => {
  const store = newStore();
  const pool = makeMockPool(store);
  const svc = StaticTicketService.forTesting(pool);
  const csv = csvRow("Notodden", "01-1001", "small_yellow");
  const first = await svc.importFromCSV(csv, "hall-notodden");
  assert.equal(first.inserted, 1);
  assert.equal(first.skipped, 0);
  // Re-import samme CSV → duplicate, skal skippes
  const second = await svc.importFromCSV(csv, "hall-notodden");
  assert.equal(second.inserted, 0);
  assert.equal(second.skipped, 1);
  assert.equal(second.totalRows, 1);
  assert.equal(store.tickets.size, 1);
});

test("PT1 importFromCSV: tom hallId avvises", async () => {
  const svc = StaticTicketService.forTesting(makeMockPool(newStore()));
  try {
    await svc.importFromCSV(csvRow("X", "01-1001", "small_yellow"), "");
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
  }
});

test("PT1 importFromCSV: ugyldig CSV → ingen DB-touch (parse feiler først)", async () => {
  const store = newStore();
  const pool = makeMockPool(store);
  const svc = StaticTicketService.forTesting(pool);
  try {
    await svc.importFromCSV("bad,data", "hall-notodden");
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
  }
  // Parser feiler FØR transaksjonen starter, men hallId-sjekken går først
  // og den bruker .pool.query, så hall-sjekk går igjennom før parse.
  // Viktig invariant: ingen tickets inserted.
  assert.equal(store.tickets.size, 0);
  assert.equal(store.beginCount, 0);
});

// ── listAvailableByHallAndColor ────────────────────────────────────────────

test("PT1 listAvailableByHallAndColor: filtrerer på hall + color + usolgt", async () => {
  const store = newStore();
  const pool = makeMockPool(store);
  const svc = StaticTicketService.forTesting(pool);
  await svc.importFromCSV(
    [
      csvRow("Notodden", "01-1001", "small_yellow"),
      csvRow("Notodden", "01-1002", "small_yellow"),
      csvRow("Notodden", "01-1003", "large_white"),
    ].join("\n"),
    "hall-notodden",
  );
  const small = await svc.listAvailableByHallAndColor("hall-notodden", "small", 10);
  assert.equal(small.length, 2);
  const large = await svc.listAvailableByHallAndColor("hall-notodden", "large", 10);
  assert.equal(large.length, 1);
});

test("PT1 listAvailableByHallAndColor: ugyldig color avvises", async () => {
  const svc = StaticTicketService.forTesting(makeMockPool(newStore()));
  try {
    await svc.listAvailableByHallAndColor("hall-notodden", "rainbow" as "small", 10);
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
  }
});

// ── findByBarcode ──────────────────────────────────────────────────────────

test("PT1 findByBarcode: returnerer null når ikke funnet", async () => {
  const svc = StaticTicketService.forTesting(makeMockPool(newStore()));
  const result = await svc.findByBarcode("nonexistent");
  assert.equal(result, null);
});

test("PT1 findByBarcode: finner bong via serial", async () => {
  const store = newStore();
  const pool = makeMockPool(store);
  const svc = StaticTicketService.forTesting(pool);
  await svc.importFromCSV(csvRow("Notodden", "01-1001", "small_yellow"), "hall-notodden");
  const result = await svc.findByBarcode("01-1001");
  assert.ok(result);
  assert.equal(result!.ticketSerial, "01-1001");
  assert.equal(result!.ticketColor, "small");
  assert.equal(result!.ticketType, "small_yellow");
});

test("PT1 findByBarcode: tom barcode avvises", async () => {
  const svc = StaticTicketService.forTesting(makeMockPool(newStore()));
  try {
    await svc.findByBarcode("");
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
  }
});

// ── bulkMarkSold ──────────────────────────────────────────────────────────

test("PT1 bulkMarkSold: kun bonger reservert av rangeId oppdateres", async () => {
  const store = newStore();
  const pool = makeMockPool(store);
  const svc = StaticTicketService.forTesting(pool);
  await svc.importFromCSV(
    [
      csvRow("Notodden", "01-1001", "small_yellow"),
      csvRow("Notodden", "01-1002", "small_yellow"),
    ].join("\n"),
    "hall-notodden",
  );
  // Reserve-state simuleres direkte i store (PT2 håndterer reservasjon)
  for (const row of store.tickets.values()) {
    row.reserved_by_range_id = "range-kari";
  }

  const result = await svc.bulkMarkSold({
    hallId: "hall-notodden",
    ticketColor: "small",
    ticketSerials: ["01-1001", "01-1002"],
    soldByUserId: "user-kari",
    soldFromRangeId: "range-kari",
    responsibleUserId: "user-kari",
    soldToScheduledGameId: "sched-1",
  });
  assert.equal(result.matched, 2);
  assert.equal(result.updated, 2);
  assert.equal(result.alreadySold.length, 0);
});

test("PT1 bulkMarkSold: allerede solgt bong returneres i alreadySold", async () => {
  const store = newStore();
  const pool = makeMockPool(store);
  const svc = StaticTicketService.forTesting(pool);
  await svc.importFromCSV(
    [
      csvRow("Notodden", "01-1001", "small_yellow"),
      csvRow("Notodden", "01-1002", "small_yellow"),
    ].join("\n"),
    "hall-notodden",
  );
  // Reserve og marker én som allerede solgt
  for (const row of store.tickets.values()) {
    row.reserved_by_range_id = "range-kari";
  }
  const first = [...store.tickets.values()][0]!;
  first.is_purchased = true;

  const result = await svc.bulkMarkSold({
    hallId: "hall-notodden",
    ticketColor: "small",
    ticketSerials: [first.ticket_serial, "01-1002"],
    soldByUserId: "user-kari",
    soldFromRangeId: "range-kari",
    responsibleUserId: "user-kari",
    soldToScheduledGameId: null,
  });
  assert.equal(result.matched, 2);
  assert.equal(result.updated, 1);
  assert.deepEqual(result.alreadySold, [first.ticket_serial]);
});

test("PT1 bulkMarkSold: tom serials-array avvises", async () => {
  const svc = StaticTicketService.forTesting(makeMockPool(newStore()));
  try {
    await svc.bulkMarkSold({
      hallId: "hall-notodden",
      ticketColor: "small",
      ticketSerials: [],
      soldByUserId: "user-1",
      soldFromRangeId: "range-1",
      responsibleUserId: "user-1",
      soldToScheduledGameId: null,
    });
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
  }
});

test("PT1 bulkMarkSold: manglende påkrevd felt avvises", async () => {
  const svc = StaticTicketService.forTesting(makeMockPool(newStore()));
  try {
    await svc.bulkMarkSold({
      hallId: "hall-notodden",
      ticketColor: "small",
      ticketSerials: ["01-1001"],
      soldByUserId: "",
      soldFromRangeId: "range-1",
      responsibleUserId: "user-1",
      soldToScheduledGameId: null,
    });
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError);
  }
});
