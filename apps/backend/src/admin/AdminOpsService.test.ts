/**
 * Tobias 2026-04-27: unit-tester for AdminOpsService — pure compute-funksjoner
 * (`computeHallHealth`, `computeGroupAggregate`) + service-level
 * `aggregateOverview` med mocks.
 *
 * Pattern: vi tester pure-funksjonene direkte (ingen DB), og bygger en
 * AdminOpsService med stub-deps for å verifisere aggregate-flyten.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminOpsService,
  computeHallHealth,
  computeGroupAggregate,
  type HallRoomSummary,
  type AdminOpsAlert,
  type HallOpsRow,
} from "./AdminOpsService.js";
import type { HallDefinition, PlatformService } from "../platform/PlatformService.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { HallGroup, HallGroupService } from "./HallGroupService.js";
import type { WalletReconciliationService } from "../jobs/walletReconciliation.js";
import type { PaymentRequestService } from "../payments/PaymentRequestService.js";
import type { Pool } from "pg";

function makeHall(overrides: Partial<HallDefinition> = {}): HallDefinition {
  return {
    id: "hall-1",
    slug: "h1",
    name: "Hall 1",
    region: "Oslo",
    address: "",
    isActive: true,
    clientVariant: "web",
    hallNumber: 101,
    isTestHall: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRoom(overrides: Partial<HallRoomSummary> = {}): HallRoomSummary {
  return {
    code: "R1",
    hallId: "hall-1",
    gameSlug: "bingo",
    playerCount: 5,
    gameStatus: "RUNNING",
    drawnCount: 10,
    maxDraws: 75,
    isPaused: false,
    endedReason: null,
    lastDrawAtMs: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── computeHallHealth ──────────────────────────────────────────────────────

test("computeHallHealth: GREEN by default for active hall, no alerts, no rooms", () => {
  const result = computeHallHealth({
    hall: makeHall(),
    rooms: [],
    nowMs: 1_000_000,
    unacknowledgedAlertCount: 0,
    maxAlertSeverity: null,
  });
  assert.equal(result.color, "GREEN");
  assert.equal(result.reason, null);
});

test("computeHallHealth: RED when hall is inactive", () => {
  const result = computeHallHealth({
    hall: makeHall({ isActive: false }),
    rooms: [],
    nowMs: 1_000_000,
    unacknowledgedAlertCount: 0,
    maxAlertSeverity: null,
  });
  assert.equal(result.color, "RED");
  assert.equal(result.reason, "Hall inaktiv");
});

test("computeHallHealth: RED when CRITICAL alert exists", () => {
  const result = computeHallHealth({
    hall: makeHall(),
    rooms: [],
    nowMs: 1_000_000,
    unacknowledgedAlertCount: 1,
    maxAlertSeverity: "CRITICAL",
  });
  assert.equal(result.color, "RED");
  assert.equal(result.reason, "Kritisk alert");
});

test("computeHallHealth: RED when room is RUNNING but no draw for >60s", () => {
  const nowMs = 1_000_000;
  const result = computeHallHealth({
    hall: makeHall(),
    rooms: [
      makeRoom({
        code: "STUCK",
        gameStatus: "RUNNING",
        lastDrawAtMs: nowMs - 90_000, // 90s ago
      }),
    ],
    nowMs,
    unacknowledgedAlertCount: 0,
    maxAlertSeverity: null,
  });
  assert.equal(result.color, "RED");
  assert.match(result.reason ?? "", /STUCK/);
  assert.match(result.reason ?? "", /90s siden/);
});

test("computeHallHealth: YELLOW when WARNING alert exists (no stuck rooms)", () => {
  const result = computeHallHealth({
    hall: makeHall(),
    rooms: [],
    nowMs: 1_000_000,
    unacknowledgedAlertCount: 1,
    maxAlertSeverity: "WARNING",
  });
  assert.equal(result.color, "YELLOW");
  assert.equal(result.reason, "Aktiv advarsel");
});

test("computeHallHealth: YELLOW when room is RUNNING but draw 30-60s old", () => {
  const nowMs = 1_000_000;
  const result = computeHallHealth({
    hall: makeHall(),
    rooms: [
      makeRoom({
        code: "SLOW",
        gameStatus: "RUNNING",
        lastDrawAtMs: nowMs - 45_000, // 45s ago — slow but not stuck
      }),
    ],
    nowMs,
    unacknowledgedAlertCount: 0,
    maxAlertSeverity: null,
  });
  assert.equal(result.color, "YELLOW");
  assert.match(result.reason ?? "", /SLOW/);
});

test("computeHallHealth: GREEN when room runs fine (recent draw)", () => {
  const nowMs = 1_000_000;
  const result = computeHallHealth({
    hall: makeHall(),
    rooms: [
      makeRoom({
        code: "OK",
        gameStatus: "RUNNING",
        lastDrawAtMs: nowMs - 5_000, // 5s ago
      }),
    ],
    nowMs,
    unacknowledgedAlertCount: 0,
    maxAlertSeverity: null,
  });
  assert.equal(result.color, "GREEN");
});

test("computeHallHealth: stuck-room takes priority over WARNING-alert", () => {
  // Stuck-rooms (RED) skal trumfe WARNING-alerts (YELLOW).
  const nowMs = 1_000_000;
  const result = computeHallHealth({
    hall: makeHall(),
    rooms: [
      makeRoom({
        code: "STUCK",
        gameStatus: "RUNNING",
        lastDrawAtMs: nowMs - 120_000,
      }),
    ],
    nowMs,
    unacknowledgedAlertCount: 1,
    maxAlertSeverity: "WARNING",
  });
  assert.equal(result.color, "RED");
  assert.match(result.reason ?? "", /STUCK/);
});

test("computeHallHealth: rooms uten lastDrawAt eller med gameStatus !== RUNNING ignoreres", () => {
  const result = computeHallHealth({
    hall: makeHall(),
    rooms: [
      makeRoom({ code: "WAIT", gameStatus: "WAITING", lastDrawAtMs: null }),
      makeRoom({ code: "ENDED", gameStatus: "ENDED", lastDrawAtMs: null }),
    ],
    nowMs: 1_000_000,
    unacknowledgedAlertCount: 0,
    maxAlertSeverity: null,
  });
  assert.equal(result.color, "GREEN");
});

// ── computeGroupAggregate ─────────────────────────────────────────────────

function makeHallRow(overrides: Partial<HallOpsRow> = {}): HallOpsRow {
  return {
    id: "hall-1",
    name: "Hall 1",
    hallNumber: 101,
    region: "Oslo",
    isActive: true,
    isTestHall: false,
    groupId: null,
    groupName: null,
    updatedAt: "2026-01-01T00:00:00Z",
    activeRoomCount: 0,
    totalPlayerCount: 0,
    health: "GREEN",
    healthReason: null,
    unacknowledgedAlertCount: 0,
    ...overrides,
  };
}

test("computeGroupAggregate: NONE when no halls have active rooms", () => {
  const result = computeGroupAggregate({
    group: { id: "g-1", name: "Gruppe 1", hallIds: ["hall-1", "hall-2"] },
    hallsById: new Map([
      ["hall-1", makeHallRow({ id: "hall-1", activeRoomCount: 0 })],
      ["hall-2", makeHallRow({ id: "hall-2", activeRoomCount: 0 })],
    ]),
  });
  assert.equal(result.readyAggregate, "NONE");
  assert.equal(result.hallsWithActiveRoom, 0);
  assert.equal(result.hallCount, 2);
});

test("computeGroupAggregate: ALL_READY when every hall has active room", () => {
  const result = computeGroupAggregate({
    group: { id: "g-1", name: "Gruppe 1", hallIds: ["hall-1", "hall-2"] },
    hallsById: new Map([
      ["hall-1", makeHallRow({ id: "hall-1", activeRoomCount: 1 })],
      ["hall-2", makeHallRow({ id: "hall-2", activeRoomCount: 2 })],
    ]),
  });
  assert.equal(result.readyAggregate, "ALL_READY");
  assert.equal(result.hallsWithActiveRoom, 2);
});

test("computeGroupAggregate: PARTIAL when some halls have active rooms", () => {
  const result = computeGroupAggregate({
    group: { id: "g-1", name: "Gruppe 1", hallIds: ["hall-1", "hall-2"] },
    hallsById: new Map([
      ["hall-1", makeHallRow({ id: "hall-1", activeRoomCount: 1 })],
      ["hall-2", makeHallRow({ id: "hall-2", activeRoomCount: 0 })],
    ]),
  });
  assert.equal(result.readyAggregate, "PARTIAL");
  assert.equal(result.hallsWithActiveRoom, 1);
});

// ── aggregateOverview (med mocks) ─────────────────────────────────────────

interface FakeRoomSnapshot {
  code: string;
  hallId: string;
  hostPlayerId: string;
  gameSlug: string;
  createdAt: string;
  players: unknown[];
  currentGame?: {
    id: string;
    status: string;
    drawnNumbers: number[];
    drawBag: number[];
    isPaused?: boolean;
    endedReason?: string;
  };
  gameHistory: unknown[];
}

function buildTestService(opts: {
  halls: HallDefinition[];
  rooms: { summary: { code: string; hallId: string; gameSlug: string; playerCount: number; createdAt: string; gameStatus: string; hostPlayerId: string }; snapshot: FakeRoomSnapshot; lastDrawAtMs: number | null }[];
  hallGroups?: HallGroup[];
  walletAlerts?: Array<{ id: string; accountId: string; accountSide: "deposit" | "winnings"; expectedBalance: number; actualBalance: number; divergence: number; detectedAt: string }>;
  pendingPayments?: Array<{ id: string; kind: "deposit" | "withdraw"; userId: string; walletId: string; amountCents: number; hallId: string | null; status: "PENDING"; createdAt: string; updatedAt: string }>;
  opsAlertRows?: Array<{ id: string; severity: "INFO" | "WARNING" | "CRITICAL"; type: string; hall_id: string | null; message: string; details: Record<string, unknown>; acknowledged_at: null; acknowledged_by_user_id: null; created_at: string }>;
  nowMs?: number;
}): AdminOpsService {
  const platformService = {
    listHalls: async () => opts.halls,
  } as unknown as PlatformService;

  const engine = {
    listRoomSummaries: () =>
      opts.rooms.map((r) => ({
        code: r.summary.code,
        hallId: r.summary.hallId,
        hostPlayerId: r.summary.hostPlayerId,
        gameSlug: r.summary.gameSlug,
        playerCount: r.summary.playerCount,
        createdAt: r.summary.createdAt,
        gameStatus: r.summary.gameStatus as "NONE" | "WAITING" | "RUNNING" | "ENDED",
      })),
    getRoomSnapshot: (code: string) => {
      const found = opts.rooms.find(
        (r) => r.snapshot.code === code.toUpperCase(),
      );
      if (!found) throw new Error(`ROOM_NOT_FOUND: ${code}`);
      return found.snapshot;
    },
  } as unknown as BingoEngine;

  // Test injecter lastDrawAt-port direkte istedenfor å mocke en privat
  // engine-metode — speiles 1:1 mot index.ts produksjons-adapter.
  const lastDrawAtPort = (code: string): number | null => {
    const found = opts.rooms.find(
      (r) => r.snapshot.code === code.toUpperCase(),
    );
    return found ? found.lastDrawAtMs : null;
  };

  const hallGroupService = {
    list: async () => opts.hallGroups ?? [],
  } as unknown as HallGroupService;

  const reconciliationService = {
    listOpenAlerts: async () => opts.walletAlerts ?? [],
  } as unknown as WalletReconciliationService;

  const paymentRequestService = {
    listPending: async () => opts.pendingPayments ?? [],
  } as unknown as PaymentRequestService;

  // Pool mock — kun for app_ops_alerts.
  const opsRows = opts.opsAlertRows ?? [];
  const pool = {
    query: async (_sql: string, _params?: unknown[]) => ({ rows: opsRows, rowCount: opsRows.length }),
  } as unknown as Pool;

  return new AdminOpsService({
    pool,
    schema: "public",
    platformService,
    engine,
    lastDrawAtPort,
    hallGroupService,
    reconciliationService,
    paymentRequestService,
    now: () => opts.nowMs ?? Date.now(),
  });
}

test("aggregateOverview: tom verden gir tomme arrays + nullmetrics", async () => {
  const svc = buildTestService({ halls: [], rooms: [], nowMs: 1_700_000_000_000 });
  const overview = await svc.aggregateOverview();
  assert.deepEqual(overview.halls, []);
  assert.deepEqual(overview.rooms, []);
  assert.deepEqual(overview.groups, []);
  assert.deepEqual(overview.alerts, []);
  assert.equal(overview.metrics.totalHalls, 0);
  assert.equal(overview.metrics.activeHalls, 0);
  assert.equal(overview.metrics.totalRooms, 0);
  assert.equal(overview.metrics.runningRooms, 0);
  assert.equal(overview.metrics.totalPlayersOnline, 0);
  assert.equal(overview.metrics.totalAlerts, 0);
});

test("aggregateOverview: én hall med RUNNING rom + recent draw → GREEN, metrics korrekt", async () => {
  const nowMs = 1_700_000_000_000;
  const svc = buildTestService({
    halls: [makeHall({ id: "hall-1", name: "Hall 1" })],
    rooms: [
      {
        summary: {
          code: "R1",
          hallId: "hall-1",
          gameSlug: "bingo",
          playerCount: 7,
          createdAt: "2026-01-01T00:00:00Z",
          gameStatus: "RUNNING",
          hostPlayerId: "p-host",
        },
        snapshot: {
          code: "R1",
          hallId: "hall-1",
          hostPlayerId: "p-host",
          gameSlug: "bingo",
          createdAt: "2026-01-01T00:00:00Z",
          players: [],
          currentGame: {
            id: "g-1",
            status: "RUNNING",
            drawnNumbers: [1, 2, 3, 4, 5],
            drawBag: [6, 7, 8],
          },
          gameHistory: [],
        },
        lastDrawAtMs: nowMs - 5_000,
      },
    ],
    nowMs,
  });
  const overview = await svc.aggregateOverview();
  assert.equal(overview.halls.length, 1);
  assert.equal(overview.halls[0]!.health, "GREEN");
  assert.equal(overview.halls[0]!.activeRoomCount, 1);
  assert.equal(overview.halls[0]!.totalPlayerCount, 7);
  assert.equal(overview.rooms.length, 1);
  assert.equal(overview.rooms[0]!.drawnCount, 5);
  assert.equal(overview.rooms[0]!.maxDraws, 8); // drawBag.length + drawn = 3 + 5
  assert.equal(overview.metrics.runningRooms, 1);
  assert.equal(overview.metrics.totalPlayersOnline, 7);
});

test("aggregateOverview: stuck-rom (no draw 90s) → RED for hallen", async () => {
  const nowMs = 1_700_000_000_000;
  const svc = buildTestService({
    halls: [makeHall({ id: "hall-1" })],
    rooms: [
      {
        summary: {
          code: "STUCK",
          hallId: "hall-1",
          gameSlug: "bingo",
          playerCount: 3,
          createdAt: "2026-01-01T00:00:00Z",
          gameStatus: "RUNNING",
          hostPlayerId: "p-host",
        },
        snapshot: {
          code: "STUCK",
          hallId: "hall-1",
          hostPlayerId: "p-host",
          gameSlug: "bingo",
          createdAt: "2026-01-01T00:00:00Z",
          players: [],
          currentGame: {
            id: "g-1",
            status: "RUNNING",
            drawnNumbers: [1, 2],
            drawBag: [3],
          },
          gameHistory: [],
        },
        lastDrawAtMs: nowMs - 90_000,
      },
    ],
    nowMs,
  });
  const overview = await svc.aggregateOverview();
  assert.equal(overview.halls[0]!.health, "RED");
  assert.match(overview.halls[0]!.healthReason ?? "", /STUCK/);
});

test("aggregateOverview: wallet-recon-alerts blir mappet til CRITICAL alerts", async () => {
  const svc = buildTestService({
    halls: [],
    rooms: [],
    walletAlerts: [
      {
        id: "1",
        accountId: "wallet-foo",
        accountSide: "winnings",
        expectedBalance: 100,
        actualBalance: 150,
        divergence: 50,
        detectedAt: "2026-04-27T08:00:00Z",
      },
    ],
    nowMs: 1_700_000_000_000,
  });
  const overview = await svc.aggregateOverview();
  assert.equal(overview.alerts.length, 1);
  const alert = overview.alerts[0]!;
  assert.equal(alert.severity, "CRITICAL");
  assert.equal(alert.type, "wallet.reconciliation.divergence");
  assert.equal(alert.source, "wallet_reconciliation");
  assert.equal(alert.id, "wallet-recon:1");
  assert.match(alert.message, /wallet-foo/);
  assert.equal(overview.metrics.criticalAlerts, 1);
});

test("aggregateOverview: pending payment > 30min → WARNING alert", async () => {
  const nowMs = 1_700_000_000_000;
  const submittedAt = new Date(nowMs - 45 * 60 * 1000).toISOString();
  const svc = buildTestService({
    halls: [],
    rooms: [],
    pendingPayments: [
      {
        id: "pr-12345678",
        kind: "deposit",
        userId: "u-1",
        walletId: "w-1",
        amountCents: 50_000,
        hallId: "hall-1",
        status: "PENDING",
        createdAt: submittedAt,
        updatedAt: submittedAt,
      },
    ],
    nowMs,
  });
  const overview = await svc.aggregateOverview();
  assert.equal(overview.alerts.length, 1);
  assert.equal(overview.alerts[0]!.severity, "WARNING");
  assert.equal(overview.alerts[0]!.type, "payment_request.stale");
  assert.equal(overview.alerts[0]!.hallId, "hall-1");
  assert.match(overview.alerts[0]!.message, /Innskudd/);
  assert.equal(overview.metrics.warningAlerts, 1);
});

test("aggregateOverview: pending payment under threshold blir IKKE alert", async () => {
  const nowMs = 1_700_000_000_000;
  const submittedAt = new Date(nowMs - 5 * 60 * 1000).toISOString(); // 5 min ago
  const svc = buildTestService({
    halls: [],
    rooms: [],
    pendingPayments: [
      {
        id: "pr-recent",
        kind: "withdraw",
        userId: "u-2",
        walletId: "w-2",
        amountCents: 10_000,
        hallId: null,
        status: "PENDING",
        createdAt: submittedAt,
        updatedAt: submittedAt,
      },
    ],
    nowMs,
  });
  const overview = await svc.aggregateOverview();
  assert.equal(overview.alerts.length, 0);
});

test("aggregateOverview: hall-grupper aggregeres med ALL_READY/PARTIAL/NONE", async () => {
  const nowMs = 1_700_000_000_000;
  const svc = buildTestService({
    halls: [
      makeHall({ id: "hall-1", name: "Hall 1" }),
      makeHall({ id: "hall-2", name: "Hall 2" }),
      makeHall({ id: "hall-3", name: "Hall 3" }),
    ],
    rooms: [
      // hall-1 har et aktivt rom; hall-2 og hall-3 ikke.
      {
        summary: {
          code: "R1",
          hallId: "hall-1",
          gameSlug: "bingo",
          playerCount: 2,
          createdAt: "2026-01-01T00:00:00Z",
          gameStatus: "RUNNING",
          hostPlayerId: "p-host",
        },
        snapshot: {
          code: "R1",
          hallId: "hall-1",
          hostPlayerId: "p-host",
          gameSlug: "bingo",
          createdAt: "2026-01-01T00:00:00Z",
          players: [],
          currentGame: {
            id: "g-1",
            status: "RUNNING",
            drawnNumbers: [1],
            drawBag: [2, 3],
          },
          gameHistory: [],
        },
        lastDrawAtMs: nowMs - 5_000,
      },
    ],
    hallGroups: [
      {
        id: "group-a",
        legacyGroupHallId: null,
        name: "Group A",
        status: "active",
        tvId: null,
        productIds: [],
        members: [
          { hallId: "hall-1", hallName: "Hall 1", hallStatus: "active", addedAt: "2026-01-01T00:00:00Z" },
          { hallId: "hall-2", hallName: "Hall 2", hallStatus: "active", addedAt: "2026-01-01T00:00:00Z" },
        ],
        extra: {},
        createdBy: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
      },
    ],
    nowMs,
  });
  const overview = await svc.aggregateOverview();
  assert.equal(overview.groups.length, 1);
  assert.equal(overview.groups[0]!.readyAggregate, "PARTIAL");
  assert.equal(overview.groups[0]!.hallCount, 2);
  assert.equal(overview.groups[0]!.hallsWithActiveRoom, 1);

  // Hall-1 skal ha groupId/groupName satt.
  const hall1 = overview.halls.find((h) => h.id === "hall-1")!;
  assert.equal(hall1.groupId, "group-a");
  assert.equal(hall1.groupName, "Group A");

  // Hall-3 er IKKE medlem — skal ha null.
  const hall3 = overview.halls.find((h) => h.id === "hall-3")!;
  assert.equal(hall3.groupId, null);
});
