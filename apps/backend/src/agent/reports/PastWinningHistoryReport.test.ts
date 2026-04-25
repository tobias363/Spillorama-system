/**
 * BIN-17.32: enhetstester for Past Winning History-aggregat.
 *
 * Dekker:
 *   - Ticket-id-søk (substring, case-insensitive).
 *   - Dato-vindu-filter (inclusive).
 *   - Sortering: paidOutAt descending, deretter ticketId for stabilitet.
 *   - Paginering (offset/limit + total-count).
 *   - Tom input gir tom respons med korrekte metadata.
 *   - Ugyldig vindu kaster.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPastWinningHistory,
  type PastWinningSourceTicket,
} from "./PastWinningHistoryReport.js";

function mkTicket(overrides: Partial<PastWinningSourceTicket>): PastWinningSourceTicket {
  return {
    ticketId: overrides.ticketId ?? "T-1",
    ticketType: overrides.ticketType ?? "small_yellow",
    ticketColor: overrides.ticketColor ?? "small",
    priceCents: overrides.priceCents ?? 10_00,
    paidOutAt: overrides.paidOutAt ?? "2026-04-01T12:00:00.000Z",
    winningPattern: overrides.winningPattern ?? "full_house",
    hallId: overrides.hallId ?? "hall-oslo",
  };
}

test("buildPastWinningHistory: sorterer descending på paidOutAt", () => {
  const tickets: PastWinningSourceTicket[] = [
    mkTicket({ ticketId: "T-A", paidOutAt: "2026-04-01T08:00:00.000Z" }),
    mkTicket({ ticketId: "T-B", paidOutAt: "2026-04-03T08:00:00.000Z" }),
    mkTicket({ ticketId: "T-C", paidOutAt: "2026-04-02T08:00:00.000Z" }),
  ];
  const result = buildPastWinningHistory({
    tickets,
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-30T23:59:59.999Z",
  });
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0]?.ticketId, "T-B");
  assert.equal(result.rows[1]?.ticketId, "T-C");
  assert.equal(result.rows[2]?.ticketId, "T-A");
});

test("buildPastWinningHistory: filtrerer ticketId (case-insensitive substring)", () => {
  const tickets: PastWinningSourceTicket[] = [
    mkTicket({ ticketId: "01-1001" }),
    mkTicket({ ticketId: "01-2002" }),
    mkTicket({ ticketId: "02-3003" }),
  ];
  const result = buildPastWinningHistory({
    tickets,
    from: "2026-03-01T00:00:00.000Z",
    to: "2026-05-01T00:00:00.000Z",
    ticketId: "01-",
  });
  assert.equal(result.rows.length, 2);
  assert.equal(result.total, 2);
});

test("buildPastWinningHistory: dato-vindu er inclusive i begge ender", () => {
  const tickets: PastWinningSourceTicket[] = [
    mkTicket({ ticketId: "T-before", paidOutAt: "2026-03-31T23:00:00.000Z" }),
    mkTicket({ ticketId: "T-start", paidOutAt: "2026-04-01T00:00:00.000Z" }),
    mkTicket({ ticketId: "T-end", paidOutAt: "2026-04-30T23:59:59.999Z" }),
    mkTicket({ ticketId: "T-after", paidOutAt: "2026-05-01T08:00:00.000Z" }),
  ];
  const result = buildPastWinningHistory({
    tickets,
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-30T23:59:59.999Z",
  });
  const ids = result.rows.map((r) => r.ticketId).sort();
  assert.deepEqual(ids, ["T-end", "T-start"]);
});

test("buildPastWinningHistory: paginering med offset+limit", () => {
  const tickets: PastWinningSourceTicket[] = Array.from({ length: 25 }, (_, i) =>
    mkTicket({
      ticketId: `T-${i.toString().padStart(3, "0")}`,
      paidOutAt: `2026-04-${(i + 1).toString().padStart(2, "0")}T12:00:00.000Z`,
    })
  );
  const page1 = buildPastWinningHistory({
    tickets,
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-30T23:59:59.999Z",
    offset: 0,
    limit: 10,
  });
  assert.equal(page1.rows.length, 10);
  assert.equal(page1.total, 25);
  assert.equal(page1.offset, 0);
  assert.equal(page1.limit, 10);

  const page3 = buildPastWinningHistory({
    tickets,
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-30T23:59:59.999Z",
    offset: 20,
    limit: 10,
  });
  assert.equal(page3.rows.length, 5);
  assert.equal(page3.total, 25);
});

test("buildPastWinningHistory: tom input gir tom respons (ingen krasj)", () => {
  const result = buildPastWinningHistory({
    tickets: [],
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-30T23:59:59.999Z",
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.total, 0);
  assert.equal(result.offset, 0);
  assert.equal(result.limit, 100);
});

test("buildPastWinningHistory: ugyldig vindu kaster", () => {
  assert.throws(() =>
    buildPastWinningHistory({
      tickets: [],
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-04-01T00:00:00.000Z",
    })
  );
  assert.throws(() =>
    buildPastWinningHistory({
      tickets: [],
      from: "ikke-iso",
      to: "2026-04-01T00:00:00.000Z",
    })
  );
});

test("buildPastWinningHistory: bevarer ticketType, ticketColor, priceCents, winningPattern i output", () => {
  const tickets: PastWinningSourceTicket[] = [
    mkTicket({
      ticketId: "T-1",
      ticketType: "large_blue",
      ticketColor: "large",
      priceCents: 25_00,
      winningPattern: "row_3",
    }),
  ];
  const result = buildPastWinningHistory({
    tickets,
    from: "2026-03-01T00:00:00.000Z",
    to: "2026-05-01T00:00:00.000Z",
  });
  const row = result.rows[0];
  assert.ok(row);
  assert.equal(row.ticketType, "large_blue");
  assert.equal(row.ticketColor, "large");
  assert.equal(row.priceCents, 2500);
  assert.equal(row.winningPattern, "row_3");
});
