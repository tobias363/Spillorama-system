/**
 * BIN-17.36: enhetstester for "Hall Specific Report"-aggregat.
 *
 * Dekker:
 *   - Per-hall rad med Group Of Hall + Agent-displayName.
 *   - Elvis Replacement aggregeres kun fra entries med metadata.isReplacement=true.
 *   - OMS/UTD/Payout%/RES beregnes per Game 1-5 via slot→game-mapping.
 *   - Fallback-mapping når slot ikke finnes: DATABINGO → game4, MAIN_GAME → game1.
 *   - hallIds-filter begrenser radene.
 *   - Tom input gir 0-rader per hall (ingen aktivitet ≠ ingen rad).
 *   - Ugyldig vindu kaster.
 *   - Sortering: groupName → hallName asc.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type {
  HallDefinition,
  ScheduleLogEntry,
  ScheduleSlot,
} from "../../platform/PlatformService.js";
import type { HallGroup } from "../HallGroupService.js";
import type { AgentProfile } from "../../agent/AgentStore.js";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";
import {
  buildHallSpecificReport,
  deriveGameSlotFromSchedule,
} from "./HallSpecificReport.js";

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
  } as HallDefinition;
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
  } as HallGroup;
}

function agent(userId: string, name: string, primaryHallId: string): AgentProfile {
  return {
    userId,
    email: `${userId}@x.com`,
    displayName: name,
    surname: null,
    phone: null,
    role: "AGENT",
    agentStatus: "active",
    language: "nb",
    avatarFilename: null,
    parentUserId: null,
    halls: [
      {
        userId,
        hallId: primaryHallId,
        isPrimary: true,
        assignedAt: "2026-01-01T00:00:00.000Z",
        assignedByUserId: null,
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as AgentProfile;
}

function slot(id: string, hallId: string, gameType: string, variantConfig: Record<string, unknown> = {}): ScheduleSlot {
  return {
    id,
    hallId,
    gameType,
    displayName: `${gameType}-${id}`,
    dayOfWeek: null,
    startTime: "18:00",
    prizeDescription: "",
    maxTickets: 30,
    isActive: true,
    sortOrder: 0,
    variantConfig,
    parentScheduleId: null,
    subGameSequence: null,
    subGameNumber: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as ScheduleSlot;
}

function log(slotId: string, hallId: string, gameSessionId: string, startedAt: string): ScheduleLogEntry {
  return {
    id: `log-${gameSessionId}`,
    hallId,
    scheduleSlotId: slotId,
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
  overrides: Partial<ComplianceLedgerEntry> & Pick<ComplianceLedgerEntry, "eventType" | "amount" | "hallId">
): ComplianceLedgerEntry {
  const createdAt = overrides.createdAt ?? "2026-04-10T12:00:00.000Z";
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2, 9)}`,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    hallId: overrides.hallId,
    gameType: overrides.gameType ?? "MAIN_GAME",
    channel: overrides.channel ?? "HALL",
    eventType: overrides.eventType,
    amount: overrides.amount,
    currency: "NOK",
    gameId: overrides.gameId,
    playerId: overrides.playerId,
    walletId: overrides.walletId,
    metadata: overrides.metadata,
  };
}

test("buildHallSpecificReport: aggregerer OMS/UTD per game-slot og beregner Payout%/RES", () => {
  const halls = [hall("hall-oslo", "Oslo")];
  const slots = [slot("slot-g1", "hall-oslo", "standard", { gameSlug: "bingo" })];
  const logs = [log("slot-g1", "hall-oslo", "game-1", "2026-04-10T12:00:00.000Z")];
  const entries: ComplianceLedgerEntry[] = [
    entry({ eventType: "STAKE", amount: 100, hallId: "hall-oslo", gameId: "game-1" }),
    entry({ eventType: "STAKE", amount: 50, hallId: "hall-oslo", gameId: "game-1" }),
    entry({ eventType: "PRIZE", amount: 90, hallId: "hall-oslo", gameId: "game-1" }),
  ];
  const result = buildHallSpecificReport({
    halls,
    hallGroups: [],
    agents: [],
    scheduleSlots: slots,
    scheduleLogs: logs,
    entries,
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-30T23:59:59.999Z",
  });
  const row = result.rows[0];
  assert.ok(row);
  assert.equal(row.games.game1.oms, 150);
  assert.equal(row.games.game1.utd, 90);
  assert.equal(row.games.game1.payoutPct, 60);
  assert.equal(row.games.game1.res, 60);
});

test("buildHallSpecificReport: Elvis Replacement summeres kun fra metadata.isReplacement=true", () => {
  const halls = [hall("hall-oslo", "Oslo")];
  const entries: ComplianceLedgerEntry[] = [
    entry({
      eventType: "STAKE",
      amount: 50,
      hallId: "hall-oslo",
      gameType: "DATABINGO",
      metadata: { isReplacement: true },
    }),
    entry({
      eventType: "STAKE",
      amount: 30,
      hallId: "hall-oslo",
      gameType: "DATABINGO",
      metadata: { isReplacement: true },
    }),
    entry({ eventType: "STAKE", amount: 100, hallId: "hall-oslo", gameType: "DATABINGO" }),
  ];
  const result = buildHallSpecificReport({
    halls,
    hallGroups: [],
    agents: [],
    scheduleSlots: [],
    scheduleLogs: [],
    entries,
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-30T23:59:59.999Z",
  });
  assert.equal(result.rows[0]?.elvisReplacementAmount, 80);
  assert.equal(result.totals.elvisReplacementAmount, 80);
});

test("buildHallSpecificReport: populates Group Of Hall Name og Agent displayName", () => {
  const halls = [hall("hall-oslo", "Oslo"), hall("hall-bergen", "Bergen")];
  const hallGroups = [group("g-ost", "Øst", ["hall-oslo"])];
  const agents = [agent("agent-1", "Anna Agent", "hall-oslo")];
  const result = buildHallSpecificReport({
    halls,
    hallGroups,
    agents,
    scheduleSlots: [],
    scheduleLogs: [],
    entries: [],
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-30T23:59:59.999Z",
  });
  const oslo = result.rows.find((r) => r.hallId === "hall-oslo");
  const bergen = result.rows.find((r) => r.hallId === "hall-bergen");
  assert.equal(oslo?.groupOfHallName, "Øst");
  assert.equal(oslo?.agentDisplayName, "Anna Agent");
  assert.equal(bergen?.groupOfHallName, null);
  assert.equal(bergen?.agentDisplayName, null);
});

test("buildHallSpecificReport: hallIds-filter begrenser rader", () => {
  const halls = [hall("a", "A"), hall("b", "B"), hall("c", "C")];
  const result = buildHallSpecificReport({
    halls,
    hallGroups: [],
    agents: [],
    scheduleSlots: [],
    scheduleLogs: [],
    entries: [],
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-30T23:59:59.999Z",
    hallIds: ["a", "c"],
  });
  const ids = result.rows.map((r) => r.hallId).sort();
  assert.deepEqual(ids, ["a", "c"]);
});

test("buildHallSpecificReport: fallback gameType DATABINGO → game4, MAIN_GAME → game1", () => {
  const halls = [hall("hall-1", "Hall 1")];
  const entries: ComplianceLedgerEntry[] = [
    entry({ eventType: "STAKE", amount: 100, hallId: "hall-1", gameType: "MAIN_GAME" }),
    entry({ eventType: "STAKE", amount: 200, hallId: "hall-1", gameType: "DATABINGO" }),
  ];
  const result = buildHallSpecificReport({
    halls,
    hallGroups: [],
    agents: [],
    scheduleSlots: [],
    scheduleLogs: [],
    entries,
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-30T23:59:59.999Z",
  });
  const row = result.rows[0];
  assert.ok(row);
  assert.equal(row.games.game1.oms, 100);
  assert.equal(row.games.game4.oms, 200);
});

test("buildHallSpecificReport: tom aktivitet gir rad per hall med 0-tall", () => {
  const halls = [hall("hall-1", "Hall 1"), hall("hall-2", "Hall 2")];
  const result = buildHallSpecificReport({
    halls,
    hallGroups: [],
    agents: [],
    scheduleSlots: [],
    scheduleLogs: [],
    entries: [],
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-30T23:59:59.999Z",
  });
  assert.equal(result.rows.length, 2);
  for (const row of result.rows) {
    assert.equal(row.elvisReplacementAmount, 0);
    for (const g of ["game1", "game2", "game3", "game4", "game5"] as const) {
      assert.equal(row.games[g].oms, 0);
      assert.equal(row.games[g].utd, 0);
      assert.equal(row.games[g].payoutPct, 0);
      assert.equal(row.games[g].res, 0);
    }
  }
});

test("buildHallSpecificReport: ugyldig vindu kaster", () => {
  assert.throws(() =>
    buildHallSpecificReport({
      halls: [],
      hallGroups: [],
      agents: [],
      scheduleSlots: [],
      scheduleLogs: [],
      entries: [],
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-04-01T00:00:00.000Z",
    })
  );
});

test("buildHallSpecificReport: sortering — groupName asc, deretter hallName asc", () => {
  const halls = [hall("h-c", "Gamma"), hall("h-a", "Alpha"), hall("h-b", "Beta")];
  const hallGroups = [
    group("g-1", "Øst", ["h-a"]),
    group("g-2", "Vest", ["h-b", "h-c"]),
  ];
  const result = buildHallSpecificReport({
    halls,
    hallGroups,
    agents: [],
    scheduleSlots: [],
    scheduleLogs: [],
    entries: [],
    from: "2026-04-01T00:00:00.000Z",
    to: "2026-04-30T23:59:59.999Z",
  });
  const ordered = result.rows.map((r) => r.hallName);
  assert.deepEqual(ordered, ["Alpha", "Beta", "Gamma"]);
});

test("deriveGameSlotFromSchedule: maps ulike gameType-verdier", () => {
  assert.equal(deriveGameSlotFromSchedule(slot("x", "h", "standard")), "game1");
  assert.equal(deriveGameSlotFromSchedule(slot("x", "h", "elvis")), "game1");
  assert.equal(deriveGameSlotFromSchedule(slot("x", "h", "rocket")), "game2");
  assert.equal(deriveGameSlotFromSchedule(slot("x", "h", "mystery")), "game3");
  assert.equal(deriveGameSlotFromSchedule(slot("x", "h", "wheel")), "game4");
  assert.equal(deriveGameSlotFromSchedule(slot("x", "h", "spillorama")), "game5");
  assert.equal(deriveGameSlotFromSchedule(slot("x", "h", "unknown-game")), null);
  // gameSlug in variantConfig overrides gameType.
  assert.equal(
    deriveGameSlotFromSchedule(slot("x", "h", "legacy", { gameSlug: "rocket" })),
    "game2"
  );
});
