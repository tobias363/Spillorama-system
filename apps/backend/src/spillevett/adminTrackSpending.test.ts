/**
 * BIN-628 unit-tester for admin track-spending aggregat.
 *
 * Dekker regulatoriske hard-krav:
 *   - Fail-closed: TrackSpendingStaleDataError kastes ved stale data.
 *   - Per-hall limits: Regulatory vs hall_override skilles tydelig.
 *   - Aggregering: stake/prize/net, uniquePlayerCount, average korrekt.
 *   - Cursor-paginering: stabil offset, nextCursor = null på siste side.
 *   - Ingen mandatorisk pause-felt i responsen (Norway-memo).
 *   - Scoping: hallId-filter, playerId-filter, ORG_DISTRIBUTION ekskluderes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ComplianceLedgerEntry } from "../game/ComplianceLedger.js";
import type { HallDefinition } from "../platform/PlatformService.js";
import {
  buildTrackSpendingAggregate,
  buildTrackSpendingTransactions,
  TrackSpendingStaleDataError,
  TRACK_SPENDING_MAX_STALE_MS,
} from "./adminTrackSpending.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function hall(id: string, name: string, isActive = true): HallDefinition {
  return {
    id,
    slug: id,
    name,
    region: "NO",
    address: "",
    isActive,
    clientVariant: "unity",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function entry(
  overrides: Partial<ComplianceLedgerEntry> &
    Pick<ComplianceLedgerEntry, "id" | "hallId" | "eventType" | "amount" | "createdAt">,
): ComplianceLedgerEntry {
  return {
    currency: "NOK",
    createdAtMs: Date.parse(overrides.createdAt),
    gameType: "MAIN_GAME",
    channel: "HALL",
    ...overrides,
  } as ComplianceLedgerEntry;
}

const HALLS: HallDefinition[] = [
  hall("hall-a", "Alpha Bingohall"),
  hall("hall-b", "Beta Bingohall"),
  hall("hall-c", "Charlie Bingohall"),
];

const REGULATORY = { daily: 900, monthly: 4400 };

const FIXED_NOW = new Date("2026-04-19T12:00:00.000Z");

// ── Baseline-aggregat ──────────────────────────────────────────────────────

test("buildTrackSpendingAggregate: aggregates stake/prize/net per hall", () => {
  const entries: ComplianceLedgerEntry[] = [
    entry({ id: "s1", hallId: "hall-a", eventType: "STAKE", amount: 100, walletId: "w1", createdAt: "2026-04-18T10:00:00.000Z" }),
    entry({ id: "s2", hallId: "hall-a", eventType: "STAKE", amount: 200, walletId: "w2", createdAt: "2026-04-18T11:00:00.000Z" }),
    entry({ id: "p1", hallId: "hall-a", eventType: "PRIZE", amount: 50, walletId: "w1", createdAt: "2026-04-18T10:05:00.000Z" }),
    entry({ id: "s3", hallId: "hall-b", eventType: "STAKE", amount: 300, walletId: "w3", createdAt: "2026-04-18T12:00:00.000Z" }),
    entry({ id: "ep1", hallId: "hall-b", eventType: "EXTRA_PRIZE", amount: 30, walletId: "w3", createdAt: "2026-04-18T12:05:00.000Z" }),
  ];

  const result = buildTrackSpendingAggregate({
    entries,
    halls: HALLS,
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    now: FIXED_NOW,
  });

  const hallA = result.rows.find((r) => r.hallId === "hall-a");
  assert.ok(hallA, "hall-a må være i rows");
  assert.equal(hallA!.totalStake, 300);
  assert.equal(hallA!.totalPrize, 50);
  assert.equal(hallA!.netSpend, 250);
  assert.equal(hallA!.uniquePlayerCount, 2);
  assert.equal(hallA!.averageSpendPerPlayer, 125);
  assert.equal(hallA!.stakeEventCount, 2);

  const hallB = result.rows.find((r) => r.hallId === "hall-b");
  assert.ok(hallB);
  assert.equal(hallB!.totalStake, 300);
  assert.equal(hallB!.totalPrize, 30);
  assert.equal(hallB!.netSpend, 270);
  assert.equal(hallB!.uniquePlayerCount, 1);

  // Hall-c er aktiv men har 0 aktivitet — skal fortsatt være med (null-rad).
  const hallC = result.rows.find((r) => r.hallId === "hall-c");
  assert.ok(hallC);
  assert.equal(hallC!.totalStake, 0);
  assert.equal(hallC!.uniquePlayerCount, 0);
  assert.equal(hallC!.averageSpendPerPlayer, 0);

  assert.equal(result.totals.totalStake, 600);
  assert.equal(result.totals.totalPrize, 80);
  assert.equal(result.totals.netSpend, 520);
  assert.equal(result.totals.uniquePlayerCount, 3);
  assert.equal(result.totals.stakeEventCount, 3);
});

// ── Per-hall limits ────────────────────────────────────────────────────────

test("buildTrackSpendingAggregate: uses regulatory limits when no override", () => {
  const result = buildTrackSpendingAggregate({
    entries: [],
    halls: [hall("hall-a", "Alpha")],
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    now: FIXED_NOW,
  });

  const row = result.rows[0]!;
  assert.equal(row.limits.dailyLimit, 900);
  assert.equal(row.limits.monthlyLimit, 4400);
  assert.equal(row.limits.source, "regulatory");
});

test("buildTrackSpendingAggregate: applies hall-override limits when present", () => {
  const result = buildTrackSpendingAggregate({
    entries: [],
    halls: [hall("hall-a", "Alpha")],
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    hallOverrides: [{ hallId: "hall-a", dailyLimit: 500, monthlyLimit: 2000 }],
    now: FIXED_NOW,
  });

  const row = result.rows[0]!;
  assert.equal(row.limits.dailyLimit, 500);
  assert.equal(row.limits.monthlyLimit, 2000);
  assert.equal(row.limits.source, "hall_override");
});

test("buildTrackSpendingAggregate: partial override falls back to regulatory for missing field", () => {
  const result = buildTrackSpendingAggregate({
    entries: [],
    halls: [hall("hall-a", "Alpha")],
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    hallOverrides: [{ hallId: "hall-a", dailyLimit: 500 }],
    now: FIXED_NOW,
  });

  const row = result.rows[0]!;
  assert.equal(row.limits.dailyLimit, 500);
  assert.equal(row.limits.monthlyLimit, REGULATORY.monthly);
  assert.equal(row.limits.source, "hall_override");
});

// ── Fail-closed ─────────────────────────────────────────────────────────────

test("buildTrackSpendingAggregate: throws TrackSpendingStaleDataError when data too old", () => {
  assert.throws(
    () =>
      buildTrackSpendingAggregate({
        entries: [],
        halls: HALLS,
        from: "2026-04-18T00:00:00.000Z",
        to: "2026-04-19T00:00:00.000Z",
        regulatoryLimits: REGULATORY,
        dataAgeMs: TRACK_SPENDING_MAX_STALE_MS + 1,
        now: FIXED_NOW,
      }),
    (err: unknown) =>
      err instanceof TrackSpendingStaleDataError &&
      err.code === "TRACK_SPENDING_STALE_DATA" &&
      err.staleMs === TRACK_SPENDING_MAX_STALE_MS + 1,
  );
});

test("buildTrackSpendingAggregate: succeeds at exactly max-allowed stale ms", () => {
  const result = buildTrackSpendingAggregate({
    entries: [],
    halls: HALLS,
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    dataAgeMs: TRACK_SPENDING_MAX_STALE_MS,
    now: FIXED_NOW,
  });
  assert.equal(result.dataFreshness.staleMs, TRACK_SPENDING_MAX_STALE_MS);
  assert.equal(result.dataFreshness.maxAllowedStaleMs, TRACK_SPENDING_MAX_STALE_MS);
});

// ── No mandatory pause (Norway-memo) ────────────────────────────────────────

test("buildTrackSpendingAggregate: response contains no mandatory-pause field", () => {
  const result = buildTrackSpendingAggregate({
    entries: [],
    halls: [hall("hall-a", "Alpha")],
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    now: FIXED_NOW,
  });
  const row = result.rows[0]!;
  // Sjekker eksplisitt at row ikke har mandatoryPause-felt.
  assert.equal(
    Object.prototype.hasOwnProperty.call(row, "mandatoryPause"),
    false,
    "Regulatorisk: Norway har ikke mandatory pause — feltet skal ikke eksistere.",
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(row.limits, "mandatoryPause"),
    false,
  );
});

// ── Scoping ─────────────────────────────────────────────────────────────────

test("buildTrackSpendingAggregate: hallId filter returns only that hall", () => {
  const entries: ComplianceLedgerEntry[] = [
    entry({ id: "s1", hallId: "hall-a", eventType: "STAKE", amount: 100, walletId: "w1", createdAt: "2026-04-18T10:00:00.000Z" }),
    entry({ id: "s2", hallId: "hall-b", eventType: "STAKE", amount: 200, walletId: "w2", createdAt: "2026-04-18T10:00:00.000Z" }),
  ];
  const result = buildTrackSpendingAggregate({
    entries,
    halls: HALLS,
    hallId: "hall-a",
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    now: FIXED_NOW,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.hallId, "hall-a");
  assert.equal(result.hallId, "hall-a");
  // Totals er også scoped til hall-a.
  assert.equal(result.totals.totalStake, 100);
});

test("buildTrackSpendingAggregate: excludes entries outside time window", () => {
  const entries: ComplianceLedgerEntry[] = [
    entry({ id: "old", hallId: "hall-a", eventType: "STAKE", amount: 100, walletId: "w1", createdAt: "2026-04-10T10:00:00.000Z" }),
    entry({ id: "in", hallId: "hall-a", eventType: "STAKE", amount: 200, walletId: "w2", createdAt: "2026-04-18T10:00:00.000Z" }),
    entry({ id: "future", hallId: "hall-a", eventType: "STAKE", amount: 300, walletId: "w3", createdAt: "2026-04-20T10:00:00.000Z" }),
  ];
  const result = buildTrackSpendingAggregate({
    entries,
    halls: HALLS,
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    now: FIXED_NOW,
  });
  assert.equal(result.totals.totalStake, 200);
  assert.equal(result.totals.stakeEventCount, 1);
});

test("buildTrackSpendingAggregate: ignores ORG_DISTRIBUTION entries", () => {
  const entries: ComplianceLedgerEntry[] = [
    entry({ id: "s1", hallId: "hall-a", eventType: "STAKE", amount: 100, walletId: "w1", createdAt: "2026-04-18T10:00:00.000Z" }),
    entry({
      id: "org",
      hallId: "hall-a",
      eventType: "ORG_DISTRIBUTION",
      amount: 50,
      createdAt: "2026-04-18T11:00:00.000Z",
    }),
  ];
  const result = buildTrackSpendingAggregate({
    entries,
    halls: HALLS,
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    now: FIXED_NOW,
  });
  assert.equal(result.totals.totalStake, 100);
  assert.equal(result.totals.totalPrize, 0);
});

// ── Pagination ──────────────────────────────────────────────────────────────

test("buildTrackSpendingAggregate: pagination produces stable cursor + nextCursor=null on last page", () => {
  const halls = [
    hall("h1", "Alpha"),
    hall("h2", "Beta"),
    hall("h3", "Charlie"),
    hall("h4", "Delta"),
    hall("h5", "Echo"),
  ];
  const page1 = buildTrackSpendingAggregate({
    entries: [],
    halls,
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    pageSize: 2,
    now: FIXED_NOW,
  });
  assert.equal(page1.rows.length, 2);
  assert.equal(page1.rows[0]!.hallId, "h1");
  assert.equal(page1.rows[1]!.hallId, "h2");
  assert.ok(page1.nextCursor);

  const page2 = buildTrackSpendingAggregate({
    entries: [],
    halls,
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    pageSize: 2,
    cursor: page1.nextCursor!,
    now: FIXED_NOW,
  });
  assert.equal(page2.rows.length, 2);
  assert.equal(page2.rows[0]!.hallId, "h3");

  const page3 = buildTrackSpendingAggregate({
    entries: [],
    halls,
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    pageSize: 2,
    cursor: page2.nextCursor!,
    now: FIXED_NOW,
  });
  assert.equal(page3.rows.length, 1);
  assert.equal(page3.rows[0]!.hallId, "h5");
  assert.equal(page3.nextCursor, null, "siste side skal ha null cursor");
});

// ── Transactions ────────────────────────────────────────────────────────────

test("buildTrackSpendingTransactions: returns filtered+sorted event list", () => {
  const entries: ComplianceLedgerEntry[] = [
    entry({ id: "s1", hallId: "hall-a", eventType: "STAKE", amount: 100, walletId: "w1", playerId: "p1", createdAt: "2026-04-18T10:00:00.000Z" }),
    entry({ id: "p1", hallId: "hall-a", eventType: "PRIZE", amount: 40, walletId: "w1", playerId: "p1", createdAt: "2026-04-18T10:05:00.000Z" }),
    entry({ id: "s2", hallId: "hall-b", eventType: "STAKE", amount: 200, walletId: "w2", playerId: "p2", createdAt: "2026-04-18T11:00:00.000Z" }),
    entry({ id: "org1", hallId: "hall-a", eventType: "ORG_DISTRIBUTION", amount: 10, createdAt: "2026-04-18T12:00:00.000Z" }),
  ];

  const all = buildTrackSpendingTransactions({
    entries,
    halls: HALLS,
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    now: FIXED_NOW,
  });
  assert.equal(all.transactions.length, 3, "ORG_DISTRIBUTION skal filtreres bort");
  // Nyeste først: s2 (11:00) før p1/s1 (10:xx)
  assert.equal(all.transactions[0]!.id, "s2");

  const byPlayer = buildTrackSpendingTransactions({
    entries,
    halls: HALLS,
    playerId: "p1",
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    now: FIXED_NOW,
  });
  assert.equal(byPlayer.transactions.length, 2);
  assert.ok(byPlayer.transactions.every((tx) => tx.playerId === "p1"));
  assert.equal(byPlayer.playerId, "p1");

  const byHall = buildTrackSpendingTransactions({
    entries,
    halls: HALLS,
    hallId: "hall-b",
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    now: FIXED_NOW,
  });
  assert.equal(byHall.transactions.length, 1);
  assert.equal(byHall.transactions[0]!.hallId, "hall-b");
});

test("buildTrackSpendingTransactions: fails closed on stale data", () => {
  assert.throws(
    () =>
      buildTrackSpendingTransactions({
        entries: [],
        halls: HALLS,
        from: "2026-04-18T00:00:00.000Z",
        to: "2026-04-19T00:00:00.000Z",
        dataAgeMs: TRACK_SPENDING_MAX_STALE_MS + 10,
        now: FIXED_NOW,
      }),
    TrackSpendingStaleDataError,
  );
});

test("buildTrackSpendingTransactions: paginates transactions in order", () => {
  const entries: ComplianceLedgerEntry[] = Array.from({ length: 5 }, (_, i) =>
    entry({
      id: `s${i}`,
      hallId: "hall-a",
      eventType: "STAKE",
      amount: 10 * (i + 1),
      walletId: "w1",
      // Lager timestamps slik at s4 er nyeste (10:04), s0 eldste (10:00)
      createdAt: `2026-04-18T10:0${i}:00.000Z`,
    }),
  );
  const page1 = buildTrackSpendingTransactions({
    entries,
    halls: HALLS,
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    pageSize: 2,
    now: FIXED_NOW,
  });
  assert.equal(page1.transactions.length, 2);
  assert.equal(page1.transactions[0]!.id, "s4");
  assert.equal(page1.transactions[1]!.id, "s3");
  assert.ok(page1.nextCursor);

  const page2 = buildTrackSpendingTransactions({
    entries,
    halls: HALLS,
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    pageSize: 2,
    cursor: page1.nextCursor!,
    now: FIXED_NOW,
  });
  assert.equal(page2.transactions.length, 2);
  assert.equal(page2.transactions[0]!.id, "s2");
});

// ── Edge cases ──────────────────────────────────────────────────────────────

test("buildTrackSpendingAggregate: hallId for unknown hall returns empty rows but valid response", () => {
  const result = buildTrackSpendingAggregate({
    entries: [],
    halls: HALLS,
    hallId: "ghost-hall",
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    now: FIXED_NOW,
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.hallId, "ghost-hall");
  assert.equal(result.totals.totalStake, 0);
});

test("buildTrackSpendingAggregate: includes inactive hall if it had events in the window", () => {
  const halls = [hall("active", "Active Hall"), hall("gone", "Deactivated Hall", false)];
  const entries: ComplianceLedgerEntry[] = [
    entry({ id: "s1", hallId: "gone", eventType: "STAKE", amount: 50, walletId: "w1", createdAt: "2026-04-18T10:00:00.000Z" }),
  ];
  const result = buildTrackSpendingAggregate({
    entries,
    halls,
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    now: FIXED_NOW,
  });
  const ids = result.rows.map((r) => r.hallId);
  assert.ok(ids.includes("gone"), "deaktivert hall med events må være med");
  assert.ok(ids.includes("active"));
});

test("buildTrackSpendingAggregate: rejects invalid ISO dates", () => {
  assert.throws(
    () =>
      buildTrackSpendingAggregate({
        entries: [],
        halls: HALLS,
        from: "not-a-date",
        to: "2026-04-19T00:00:00.000Z",
        regulatoryLimits: REGULATORY,
        now: FIXED_NOW,
      }),
    /Ugyldig 'from'/,
  );
  assert.throws(
    () =>
      buildTrackSpendingAggregate({
        entries: [],
        halls: HALLS,
        from: "2026-04-19T00:00:00.000Z",
        to: "2026-04-18T00:00:00.000Z",
        regulatoryLimits: REGULATORY,
        now: FIXED_NOW,
      }),
    /'from' må være <= 'to'/,
  );
});

test("buildTrackSpendingAggregate: dataFreshness reflects supplied dataAgeMs", () => {
  const result = buildTrackSpendingAggregate({
    entries: [],
    halls: HALLS,
    from: "2026-04-18T00:00:00.000Z",
    to: "2026-04-19T00:00:00.000Z",
    regulatoryLimits: REGULATORY,
    dataAgeMs: 60_000,
    now: FIXED_NOW,
  });
  assert.equal(result.dataFreshness.staleMs, 60_000);
  assert.equal(result.dataFreshness.maxAllowedStaleMs, TRACK_SPENDING_MAX_STALE_MS);
  // computedAt skal være 60s før now.
  assert.equal(
    Date.parse(result.dataFreshness.computedAt),
    FIXED_NOW.getTime() - 60_000,
  );
});
