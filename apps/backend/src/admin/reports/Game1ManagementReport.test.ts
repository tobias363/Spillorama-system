/**
 * BIN-BOT-01: unit-tester for "Report Management Game 1"-aggregat.
 *
 * Dekker:
 *   - OMS / UTD / Payout% / RES beregning per sub-game.
 *   - Totals = sum av OMS/UTD på tvers av ALLE filtrerte rader.
 *   - Payout% = (UTD * 100) / OMS; 0 hvis OMS == 0.
 *   - Group of Hall + Hall filtrer riktig.
 *   - Fritekst-søk matcher mot subGameNumber / id / displayName.
 *   - type=bot returnerer kun bot-entries (metadata.isBot=true) → tom uten bot-data.
 *   - type=player (default) inkluderer alt.
 *   - Empty window gir rader (konfigurert-men-inaktiv), men 0 i alle tall.
 *   - Ugyldig vindu kaster.
 *   - Stabil sortering (hallId → sequence → id).
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";
import type { HallDefinition, ScheduleLogEntry, ScheduleSlot } from "../../platform/PlatformService.js";
import type { HallGroup } from "../HallGroupService.js";
import { buildGame1ManagementReport } from "./Game1ManagementReport.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function hall(id: string, name: string): HallDefinition {
  return {
    id,
    slug: id,
    name,
    region: "NO",
    address: "",
    isActive: true,
    clientVariant: "web",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function group(id: string, name: string, hallIds: string[]): HallGroup {
  return {
    id,
    legacyGroupHallId: `GH_${id}`,
    name,
    status: "active",
    tvId: null,
    productIds: [],
    members: hallIds.map((hallId) => ({
      hallId,
      hallName: `Hall ${hallId}`,
      hallStatus: "active",
      addedAt: "2026-01-01T00:00:00.000Z",
    })),
    extra: {},
    createdBy: "admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

function child(
  id: string,
  sequence: number,
  hallId: string,
  parentId = "parent-1",
  extras: Partial<ScheduleSlot> = {},
): ScheduleSlot {
  return {
    id,
    hallId,
    gameType: "standard",
    displayName: `SubGame ${sequence}`,
    dayOfWeek: null,
    startTime: "18:00",
    prizeDescription: "",
    maxTickets: 30,
    isActive: true,
    sortOrder: 0,
    variantConfig: { gameMode: "standard" },
    parentScheduleId: parentId,
    subGameSequence: sequence,
    subGameNumber: `CH_${sequence}_20260418_G2`,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...extras,
  };
}

function log(
  scheduleSlotId: string,
  gameSessionId: string,
  startedAt = "2026-04-18T18:00:00.000Z",
  hallId = "hall-a",
): ScheduleLogEntry {
  return {
    id: `log-${scheduleSlotId}-${gameSessionId}`,
    hallId,
    scheduleSlotId,
    gameSessionId,
    startedAt,
    endedAt: null,
    playerCount: null,
    totalPayout: null,
    notes: null,
    createdAt: startedAt,
  };
}

function entry(
  overrides: Partial<ComplianceLedgerEntry> &
    Pick<ComplianceLedgerEntry, "id" | "hallId" | "eventType" | "amount" | "createdAt" | "gameId">,
): ComplianceLedgerEntry {
  return {
    currency: "NOK",
    createdAtMs: Date.parse(overrides.createdAt),
    gameType: "MAIN_GAME",
    channel: "HALL",
    ...overrides,
  } as ComplianceLedgerEntry;
}

const HALLS: HallDefinition[] = [hall("hall-a", "Alpha"), hall("hall-b", "Beta")];
const GROUPS: HallGroup[] = [
  group("grp-1", "Group North", ["hall-a"]),
  group("grp-2", "Group South", ["hall-b"]),
];
const WINDOW_FROM = "2026-04-18T00:00:00.000Z";
const WINDOW_TO = "2026-04-19T00:00:00.000Z";

// ── Tests ───────────────────────────────────────────────────────────────────

test("BIN-BOT-01: OMS/UTD/Payout%/RES basic aggregate", () => {
  const child1 = child("sg-1", 1, "hall-a");
  const res = buildGame1ManagementReport({
    children: [child1],
    scheduleLogs: [log("sg-1", "game-1")],
    entries: [
      entry({ id: "e1", hallId: "hall-a", eventType: "STAKE", amount: 100, createdAt: "2026-04-18T18:00:00.000Z", gameId: "game-1" }),
      entry({ id: "e2", hallId: "hall-a", eventType: "STAKE", amount: 50, createdAt: "2026-04-18T18:05:00.000Z", gameId: "game-1" }),
      entry({ id: "e3", hallId: "hall-a", eventType: "PRIZE", amount: 90, createdAt: "2026-04-18T18:10:00.000Z", gameId: "game-1" }),
    ],
    halls: HALLS,
    hallGroups: GROUPS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });

  assert.equal(res.rows.length, 1);
  const row = res.rows[0]!;
  assert.equal(row.oms, 150);
  assert.equal(row.utd, 90);
  assert.equal(row.res, 60);
  assert.equal(row.payoutPct, 60); // 90/150 * 100
  assert.equal(row.hallName, "Alpha");
  assert.equal(row.groupOfHallName, "Group North");
  assert.equal(row.groupOfHallId, "grp-1");
  assert.equal(res.totals.oms, 150);
  assert.equal(res.totals.utd, 90);
  assert.equal(res.totals.res, 60);
  assert.equal(res.totals.payoutPct, 60);
});

test("BIN-BOT-01: OMS=0 ⇒ payout% = 0", () => {
  const res = buildGame1ManagementReport({
    children: [child("sg-1", 1, "hall-a")],
    scheduleLogs: [log("sg-1", "game-1")],
    entries: [
      // Only PRIZE, no STAKE — edge-case (shouldn't happen in practice)
      entry({ id: "e1", hallId: "hall-a", eventType: "PRIZE", amount: 50, createdAt: "2026-04-18T18:00:00.000Z", gameId: "game-1" }),
    ],
    halls: HALLS,
    hallGroups: GROUPS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });

  const row = res.rows[0]!;
  assert.equal(row.oms, 0);
  assert.equal(row.utd, 50);
  assert.equal(row.payoutPct, 0); // no div-by-zero
  assert.equal(row.res, -50);
});

test("BIN-BOT-01: totals = sum av ALLE filtrerte rader (flere sub-games)", () => {
  const res = buildGame1ManagementReport({
    children: [
      child("sg-1", 1, "hall-a"),
      child("sg-2", 2, "hall-a"),
      child("sg-3", 1, "hall-b", "parent-2"),
    ],
    scheduleLogs: [
      log("sg-1", "game-1"),
      log("sg-2", "game-2"),
      log("sg-3", "game-3", "2026-04-18T18:00:00.000Z", "hall-b"),
    ],
    entries: [
      entry({ id: "e1", hallId: "hall-a", eventType: "STAKE", amount: 100, createdAt: "2026-04-18T18:00:00.000Z", gameId: "game-1" }),
      entry({ id: "e2", hallId: "hall-a", eventType: "PRIZE", amount: 40, createdAt: "2026-04-18T18:00:00.000Z", gameId: "game-1" }),
      entry({ id: "e3", hallId: "hall-a", eventType: "STAKE", amount: 200, createdAt: "2026-04-18T18:00:00.000Z", gameId: "game-2" }),
      entry({ id: "e4", hallId: "hall-a", eventType: "PRIZE", amount: 150, createdAt: "2026-04-18T18:00:00.000Z", gameId: "game-2" }),
      entry({ id: "e5", hallId: "hall-b", eventType: "STAKE", amount: 50, createdAt: "2026-04-18T18:00:00.000Z", gameId: "game-3" }),
    ],
    halls: HALLS,
    hallGroups: GROUPS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });

  assert.equal(res.rows.length, 3);
  // totalOms = 100 + 200 + 50 = 350
  // totalUtd = 40 + 150 + 0 = 190
  // totalRes = 350 - 190 = 160
  // totalPayoutPct = (190 * 100) / 350 = 54.29 (rounded)
  assert.equal(res.totals.oms, 350);
  assert.equal(res.totals.utd, 190);
  assert.equal(res.totals.res, 160);
  assert.equal(res.totals.payoutPct, 54.29);
});

test("BIN-BOT-01: hallId-filter begrenser til én hall", () => {
  const res = buildGame1ManagementReport({
    children: [
      child("sg-1", 1, "hall-a"),
      child("sg-2", 1, "hall-b"),
    ],
    scheduleLogs: [
      log("sg-1", "game-1"),
      log("sg-2", "game-2", "2026-04-18T18:00:00.000Z", "hall-b"),
    ],
    entries: [],
    halls: HALLS,
    hallGroups: GROUPS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
    hallId: "hall-a",
  });

  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0]!.hallId, "hall-a");
});

test("BIN-BOT-01: groupOfHallId-filter begrenser til én gruppe", () => {
  const res = buildGame1ManagementReport({
    children: [
      child("sg-1", 1, "hall-a"),
      child("sg-2", 1, "hall-b"),
    ],
    scheduleLogs: [],
    entries: [],
    halls: HALLS,
    hallGroups: GROUPS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
    groupOfHallId: "grp-1",
  });

  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0]!.hallId, "hall-a");
  assert.equal(res.rows[0]!.groupOfHallId, "grp-1");
});

test("BIN-BOT-01: søk (q) matcher subGameNumber / displayName", () => {
  const res = buildGame1ManagementReport({
    children: [
      child("sg-1", 1, "hall-a", "parent-1", { subGameNumber: "NORTH_01" }),
      child("sg-2", 2, "hall-a", "parent-1", { subGameNumber: "SOUTH_01", displayName: "Alfa" }),
    ],
    scheduleLogs: [],
    entries: [],
    halls: HALLS,
    hallGroups: GROUPS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
    q: "north",
  });
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0]!.subGameNumber, "NORTH_01");

  const byName = buildGame1ManagementReport({
    children: [
      child("sg-1", 1, "hall-a"),
      child("sg-2", 2, "hall-a", "parent-1", { displayName: "Alfa" }),
    ],
    scheduleLogs: [],
    entries: [],
    halls: HALLS,
    hallGroups: GROUPS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
    q: "alfa",
  });
  assert.equal(byName.rows.length, 1);
});

test("BIN-BOT-01: type=bot ⇒ bare bot-entries (metadata.isBot=true)", () => {
  const children = [child("sg-1", 1, "hall-a")];
  const scheduleLogs = [log("sg-1", "game-1")];
  const entries: ComplianceLedgerEntry[] = [
    entry({ id: "e1", hallId: "hall-a", eventType: "STAKE", amount: 100, createdAt: "2026-04-18T18:00:00.000Z", gameId: "game-1", metadata: { isBot: true } }),
    entry({ id: "e2", hallId: "hall-a", eventType: "STAKE", amount: 500, createdAt: "2026-04-18T18:00:00.000Z", gameId: "game-1" /* player */ }),
  ];

  const player = buildGame1ManagementReport({
    children, scheduleLogs, entries,
    halls: HALLS, hallGroups: GROUPS,
    from: WINDOW_FROM, to: WINDOW_TO,
    type: "player",
  });
  assert.equal(player.rows[0]!.oms, 600);

  const bot = buildGame1ManagementReport({
    children, scheduleLogs, entries,
    halls: HALLS, hallGroups: GROUPS,
    from: WINDOW_FROM, to: WINDOW_TO,
    type: "bot",
  });
  assert.equal(bot.rows[0]!.oms, 100);
  assert.equal(bot.type, "bot");
});

test("BIN-BOT-01: type=bot når ingen bot-data ⇒ OMS=0 for alle (krasjer ikke)", () => {
  const res = buildGame1ManagementReport({
    children: [child("sg-1", 1, "hall-a")],
    scheduleLogs: [log("sg-1", "game-1")],
    entries: [
      entry({ id: "e1", hallId: "hall-a", eventType: "STAKE", amount: 100, createdAt: "2026-04-18T18:00:00.000Z", gameId: "game-1" }),
    ],
    halls: HALLS,
    hallGroups: GROUPS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
    type: "bot",
  });

  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0]!.oms, 0);
  assert.equal(res.totals.oms, 0);
});

test("BIN-BOT-01: empty window gir rad per child men 0 i alle felter", () => {
  const res = buildGame1ManagementReport({
    children: [child("sg-1", 1, "hall-a")],
    scheduleLogs: [],
    entries: [],
    halls: HALLS,
    hallGroups: GROUPS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });

  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0]!.oms, 0);
  assert.equal(res.rows[0]!.utd, 0);
  assert.equal(res.rows[0]!.res, 0);
  assert.equal(res.rows[0]!.payoutPct, 0);
  assert.equal(res.rows[0]!.startedAt, null);
});

test("BIN-BOT-01: ugyldig ISO-vindu kaster", () => {
  assert.throws(
    () =>
      buildGame1ManagementReport({
        children: [],
        scheduleLogs: [],
        entries: [],
        halls: HALLS,
        hallGroups: GROUPS,
        from: "2026-04-20T00:00:00.000Z",
        to: "2026-04-18T00:00:00.000Z",
      }),
    /'from' må være <= 'to'/,
  );
  assert.throws(
    () =>
      buildGame1ManagementReport({
        children: [],
        scheduleLogs: [],
        entries: [],
        halls: HALLS,
        hallGroups: GROUPS,
        from: "bogus",
        to: "2026-04-19T00:00:00.000Z",
      }),
    /Ugyldig 'from'/,
  );
});

test("BIN-BOT-01: stabil sortering (hallId → sequence → id)", () => {
  const res = buildGame1ManagementReport({
    children: [
      child("sg-b2", 2, "hall-b", "parent-2"),
      child("sg-a2", 2, "hall-a"),
      child("sg-b1", 1, "hall-b", "parent-2"),
      child("sg-a1", 1, "hall-a"),
    ],
    scheduleLogs: [],
    entries: [],
    halls: HALLS,
    hallGroups: GROUPS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });

  const ids = res.rows.map((r) => r.subGameId);
  assert.deepEqual(ids, ["sg-a1", "sg-a2", "sg-b1", "sg-b2"]);
});

test("BIN-BOT-01: log startedAt utenfor vindu blir ikke talt", () => {
  const res = buildGame1ManagementReport({
    children: [child("sg-1", 1, "hall-a")],
    scheduleLogs: [
      // Outside window
      log("sg-1", "game-1", "2026-04-01T18:00:00.000Z"),
    ],
    entries: [
      // In-window entry but the session started before the window
      entry({ id: "e1", hallId: "hall-a", eventType: "STAKE", amount: 100, createdAt: "2026-04-18T18:00:00.000Z", gameId: "game-1" }),
    ],
    halls: HALLS,
    hallGroups: GROUPS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });

  assert.equal(res.rows[0]!.oms, 0);
});

test("BIN-BOT-01: childGameId fallback til subGameNumber hvis finnes, ellers id", () => {
  const res = buildGame1ManagementReport({
    children: [
      child("sg-1", 1, "hall-a", "parent-1", { subGameNumber: "CG_X" }),
      child("sg-2", 2, "hall-a", "parent-1", { subGameNumber: null }),
    ],
    scheduleLogs: [],
    entries: [],
    halls: HALLS,
    hallGroups: GROUPS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });

  assert.equal(res.rows[0]!.childGameId, "CG_X");
  assert.equal(res.rows[1]!.childGameId, "sg-2");
});
