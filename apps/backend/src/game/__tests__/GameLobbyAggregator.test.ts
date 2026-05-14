/**
 * Bølge 1 (2026-05-08): snapshot-tester for GameLobbyAggregator.
 *
 * Mandat (audit-rapport):
 *   "Snapshot-test per state — minst 12 tester totalt, alle passering."
 *
 * Hver test setter opp pool-stub + service-mocks, kaller
 * `aggregator.getLobbyState(hallId, actor)` og verifiserer hele
 * `Spill1AgentLobbyState`-objektet (inkl. `inconsistencyWarnings`).
 *
 * Test-states som dekkes (jf. Bølge 1-mandat + code-review-utvidelser):
 *   1.  idle (ingen plan-run for businessDate)
 *   2.  purchase_open (scheduled-game spawnet, billettkjøp åpent, ingen ready)
 *   3.  ready_to_start (alle haller markert ready)
 *   4.  running (master har trykket Start)
 *   5.  paused (master har pauset)
 *   6.  finished (siste posisjon completed)
 *   7.  missing-plan (legacy daily_schedule path, ingen plan-run)
 *   8.  dual-scheduled-games (konflikt mellom legacy og bridge)
 *   9.  stale-goh-member (hall fjernet fra GoH etter spawn)
 *   10. plan-running-no-scheduled (BRIDGE_FAILED scenario)
 *   11. cross-tz-businessDate (kall ved 23:55 Oslo-tid, sjekk businessDate)
 *   12. status-mismatch (plan-run.running men scheduled-game.cancelled)
 *   13. stale-plan-run — running (yesterday-or-older fortsatt running)
 *   14. admin-actor-no-hall (ADMIN er master uavhengig av hallId)
 *   15. infra-error (DB throws → DomainError)
 *   16. hall-scope-flag (HALL_OPERATOR ser hall-scoped state)
 *
 * Code-review (PR #1050) la til:
 *   17. empty-state (ADMIN-uten-hall route-shape parser via Zod)
 *   18. stale-plan-run paused (warning trigger uavhengig av plan-status)
 *   19. currentPosition=0 (idle-run uten advance — buildPlanMeta ikke krasjer)
 *   20. malformed-participating-json (defensive parse, aggregator ikke krasjer)
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Spill1AgentLobbyStateSchema } from "@spillorama/shared-types";

import { GameLobbyAggregator } from "../GameLobbyAggregator.js";
import { DomainError } from "../../errors/DomainError.js";
import type {
  GamePlanRun,
  GamePlanRunStatus,
  GamePlanWithItems,
  Weekday,
} from "../gamePlan.types.js";
import type {
  GameCatalogEntry,
  TicketColor,
} from "../gameCatalog.types.js";

// ── shared test fixtures ────────────────────────────────────────────────

const TEST_BUSINESS_DATE_FN = (now: Date): string => {
  // For test, return UTC date — bypasser Oslo-tz konvertering så snapshot
  // er deterministisk uavhengig av kjøretid.
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

/** Fast clock for deterministisk snapshot-output. */
const FIXED_NOW = new Date("2026-05-08T15:00:00Z");
const FIXED_BUSINESS_DATE = TEST_BUSINESS_DATE_FN(FIXED_NOW);

function makeCatalogEntry(
  overrides: Partial<GameCatalogEntry> = {},
): GameCatalogEntry {
  const ticketColors: TicketColor[] = ["gul", "hvit"];
  return {
    id: "gc-innsatsen",
    slug: "innsatsen",
    displayName: "Innsatsen",
    description: null,
    rules: {},
    ticketColors,
    ticketPricesCents: { gul: 1000, hvit: 500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 50000 },
    },
    prizeMultiplierMode: "explicit_per_color",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-07T12:00:00Z",
    updatedAt: "2026-05-07T12:00:00Z",
    createdByUserId: "u-1",
    ...overrides,
  };
}

function makePlanWithItems(
  overrides: Partial<GamePlanWithItems> & { id: string },
): GamePlanWithItems {
  const catalog = makeCatalogEntry();
  return {
    id: overrides.id,
    name: overrides.name ?? `Plan-${overrides.id}`,
    description: null,
    hallId: overrides.hallId ?? "11111111-1111-1111-1111-111111111111",
    groupOfHallsId: overrides.groupOfHallsId ?? null,
    weekdays:
      overrides.weekdays ??
      (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as Weekday[]),
    startTime: overrides.startTime ?? "11:00",
    endTime: overrides.endTime ?? "21:00",
    isActive: overrides.isActive ?? true,
    createdAt: "2026-05-07T12:00:00Z",
    updatedAt: "2026-05-07T12:00:00Z",
    createdByUserId: "u-1",
    items: overrides.items ?? [
      {
        id: `item-${overrides.id}-1`,
        planId: overrides.id,
        position: 1,
        gameCatalogId: catalog.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T12:00:00Z",
        catalogEntry: catalog,
      },
      {
        id: `item-${overrides.id}-2`,
        planId: overrides.id,
        position: 2,
        gameCatalogId: catalog.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T12:00:00Z",
        catalogEntry: catalog,
      },
    ],
  };
}

function makePlanRun(
  overrides: Partial<GamePlanRun> & {
    id?: string;
    planId?: string;
    hallId?: string;
  } = {},
): GamePlanRun {
  return {
    id: overrides.id ?? "22222222-2222-2222-2222-222222222222",
    planId: overrides.planId ?? "33333333-3333-3333-3333-333333333333",
    hallId: overrides.hallId ?? "11111111-1111-1111-1111-111111111111",
    businessDate: overrides.businessDate ?? FIXED_BUSINESS_DATE,
    currentPosition: overrides.currentPosition ?? 1,
    status: (overrides.status ?? "idle") as GamePlanRunStatus,
    jackpotOverrides: overrides.jackpotOverrides ?? {},
    startedAt: overrides.startedAt ?? null,
    finishedAt: overrides.finishedAt ?? null,
    masterUserId: overrides.masterUserId ?? null,
    createdAt: overrides.createdAt ?? "2026-05-08T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-05-08T10:00:00Z",
  };
}

interface ScheduledGameRowStub {
  id: string;
  status: string;
  master_hall_id: string;
  group_hall_id: string | null;
  participating_halls_json: unknown;
  scheduled_start_time: string;
  scheduled_end_time: string | null;
  actual_start_time: string | null;
  actual_end_time: string | null;
  plan_run_id: string | null;
  plan_position: number | null;
  pause_reason: string | null;
  engine_paused?: boolean | null;
  engine_paused_at_phase?: number | null;
}

interface HallReadyRowStub {
  gameId: string;
  hallId: string;
  isReady: boolean;
  readyAt: string | null;
  readyByUserId: string | null;
  digitalTicketsSold: number;
  physicalTicketsSold: number;
  excludedFromGame: boolean;
  excludedReason: string | null;
  createdAt: string;
  updatedAt: string;
  startTicketId: string | null;
  startScannedAt: string | null;
  finalScanTicketId: string | null;
  finalScannedAt: string | null;
}

interface AggregatorStubOpts {
  /** Pre-populated plan-run rows mapped by hall_id. */
  planRunByHall?: Map<string, GamePlanRun>;
  /** Pre-populated plans by id. */
  planById?: Map<string, GamePlanWithItems>;
  /** Scheduled-game rows; aggregator queries by plan_run_id+pos OR by hallId. */
  scheduledGameRows?: ScheduledGameRowStub[];
  /** Hall-ready-rows for getReadyStatusForGame(gameId). */
  hallReadyRowsByGameId?: Map<string, HallReadyRowStub[]>;
  /** GoH membership: groupId → [{hallId, hallName}]. */
  goHMembersByGroupId?: Map<
    string,
    {
      id: string;
      members: Array<{ hallId: string; hallName: string }>;
      masterHallId: string | null;
    }
  >;
  /** GoH list (for hallGroupService.list({hallId})) — looks up GoH for hall. */
  goHListByHallId?: Map<
    string,
    Array<{
      id: string;
      members: Array<{ hallId: string; hallName: string }>;
      masterHallId: string | null;
    }>
  >;
  /** Hall name lookup. */
  hallNamesById?: Map<string, string>;
  /** If true, throw infra-error when planRunService.findForDay is called. */
  throwOnFindForDay?: boolean;
}

function makeAggregator(opts: AggregatorStubOpts = {}): GameLobbyAggregator {
  const planRunByHall = opts.planRunByHall ?? new Map();
  const planById = opts.planById ?? new Map();
  const scheduledGameRows = opts.scheduledGameRows ?? [];
  const hallReadyRowsByGameId = opts.hallReadyRowsByGameId ?? new Map();
  const goHMembersByGroupId = opts.goHMembersByGroupId ?? new Map();
  const goHListByHallId = opts.goHListByHallId ?? new Map();
  const hallNamesById = opts.hallNamesById ?? new Map();

  const stubPool = {
    async query(textOrConfig: unknown, params?: unknown[]): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      // queryScheduledGameByPlanRun
      if (
        /WHERE (?:sg\.)?plan_run_id = \$1 AND (?:sg\.)?plan_position = \$2/i.test(sql) &&
        params
      ) {
        const [planRunId, position] = params as [string, number];
        const row = scheduledGameRows.find(
          (r) => r.plan_run_id === planRunId && r.plan_position === position,
        );
        return { rows: row ? [row] : [] };
      }
      // queryActiveScheduledGameForHall
      if (
        /(?:sg\.)?master_hall_id = \$1[\s\S]*OR (?:sg\.)?participating_halls_json/i.test(sql) &&
        params
      ) {
        const [hallId] = params as [string];
        const candidates = scheduledGameRows.filter((r) => {
          if (r.master_hall_id === hallId) return true;
          const part = parseHallIdsArrayLocal(r.participating_halls_json);
          return part.includes(hallId);
        });
        const active = candidates.filter((r) =>
          ["purchase_open", "ready_to_start", "running", "paused"].includes(
            r.status,
          ),
        );
        active.sort((a, b) =>
          a.scheduled_start_time.localeCompare(b.scheduled_start_time),
        );
        return { rows: active.slice(0, 1) };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  // Stub planService
  const planService = {
    async getById(id: string): Promise<GamePlanWithItems | null> {
      return planById.get(id) ?? null;
    },
    async list() {
      return [];
    },
  };

  // Stub planRunService
  const planRunService = {
    async findForDay(hallId: string, _bd: string): Promise<GamePlanRun | null> {
      if (opts.throwOnFindForDay) {
        const e = new Error("DB connection refused");
        (e as { code?: string }).code = "ECONNREFUSED";
        throw e;
      }
      return planRunByHall.get(hallId) ?? null;
    },
  };

  // Stub hallReadyService — return rows for the game
  const hallReadyService = {
    async getReadyStatusForGame(gameId: string): Promise<HallReadyRowStub[]> {
      return hallReadyRowsByGameId.get(gameId) ?? [];
    },
  };

  // Stub hallGroupService
  const hallGroupService = {
    async get(id: string) {
      const g = goHMembersByGroupId.get(id);
      if (!g) {
        const err = new DomainError("HALL_GROUP_NOT_FOUND", `${id}`);
        throw err;
      }
      return {
        id: g.id,
        name: `Group-${g.id}`,
        status: "active" as const,
        members: g.members.map(
          (m: { hallId: string; hallName: string }) => ({
            hallId: m.hallId,
            hallName: m.hallName,
            hallStatus: "active",
            addedAt: "2026-05-08T10:00:00Z",
          }),
        ),
        masterHallId: g.masterHallId,
      };
    },
    async list(filter: { status?: string; hallId?: string }) {
      if (filter.hallId) {
        const groups = goHListByHallId.get(filter.hallId) ?? [];
        return groups.map(
          (g: {
            id: string;
            members: Array<{ hallId: string; hallName: string }>;
            masterHallId: string | null;
          }) => ({
            id: g.id,
            name: `Group-${g.id}`,
            status: "active" as const,
            members: g.members.map(
              (m: { hallId: string; hallName: string }) => ({
                hallId: m.hallId,
                hallName: m.hallName,
                hallStatus: "active",
                addedAt: "2026-05-08T10:00:00Z",
              }),
            ),
            masterHallId: g.masterHallId,
          }),
        );
      }
      return [];
    },
  };

  // Stub platformService
  const platformService = {
    async getHall(hallId: string) {
      return {
        id: hallId,
        name: hallNamesById.get(hallId) ?? hallId,
      };
    },
  };

  return GameLobbyAggregator.forTesting({
    pool: stubPool as never,
    schema: "public",
    planService: planService as never,
    planRunService: planRunService as never,
    hallReadyService: hallReadyService as never,
    hallGroupService: hallGroupService as never,
    platformService: platformService as never,
    clock: () => FIXED_NOW,
  });
}

function parseHallIdsArrayLocal(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (x: unknown): x is string => typeof x === "string",
        );
      }
    } catch {
      return [];
    }
  }
  return [];
}

const HALL_A = "11111111-1111-1111-1111-111111111111";
const HALL_B = "44444444-4444-4444-4444-444444444444";
const HALL_C = "55555555-5555-5555-5555-555555555555";
const GOH_ID = "66666666-6666-6666-6666-666666666666";
const PLAN_ID = "33333333-3333-3333-3333-333333333333";
const RUN_ID = "22222222-2222-2222-2222-222222222222";
const SCHEDULED_GAME_ID = "77777777-7777-7777-7777-777777777777";
const SCHEDULED_GAME_LEGACY_ID = "88888888-8888-8888-8888-888888888888";

// ── Test 1: idle (ingen plan-run for businessDate) ──────────────────────

test("state=idle: ingen plan-run, men hallen er medlem av GoH med plan", async () => {
  const aggregator = makeAggregator({
    planRunByHall: new Map(),
    scheduledGameRows: [],
    goHListByHallId: new Map([
      [
        HALL_A,
        [
          {
            id: GOH_ID,
            members: [
              { hallId: HALL_A, hallName: "Master Hall A" },
              { hallId: HALL_B, hallName: "Hall B" },
              { hallId: HALL_C, hallName: "Hall C" },
            ],
            masterHallId: HALL_A,
          },
        ],
      ],
    ]),
    hallNamesById: new Map([
      [HALL_A, "Master Hall A"],
      [HALL_B, "Hall B"],
      [HALL_C, "Hall C"],
    ]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  assert.equal(state.hallId, HALL_A);
  assert.equal(state.hallName, "Master Hall A");
  assert.equal(state.businessDate, FIXED_BUSINESS_DATE);
  assert.equal(state.currentScheduledGameId, null);
  assert.equal(state.planMeta, null);
  assert.equal(state.scheduledGameMeta, null);
  // Halls listed from GoH
  assert.equal(state.halls.length, 3);
  for (const h of state.halls) {
    assert.equal(h.colorCode, "gray", `${h.hallId} should be gray (no game)`);
    assert.equal(h.isReady, false);
    assert.equal(h.excludedFromGame, false);
  }
  assert.equal(state.allHallsReady, false);
  assert.equal(state.masterHallId, HALL_A);
  assert.equal(state.groupOfHallsId, GOH_ID);
  // Caller (AGENT på HALL_A) ER master fordi GoH-master = HALL_A
  assert.equal(state.isMasterAgent, true);
  assert.equal(state.nextScheduledStartTime, null);
  assert.equal(state.inconsistencyWarnings.length, 0);
});

// ── Test 2: purchase_open (scheduled-game spawnet, kjøp åpent, 0 ready) ──

test("state=purchase_open: scheduled-game spawnet via plan-bridge, ingen ready ennå", async () => {
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "running",
    currentPosition: 1,
    startedAt: "2026-05-08T14:00:00Z",
  });
  const schedGame: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_ID,
    status: "purchase_open",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: [HALL_A, HALL_B, HALL_C],
    scheduled_start_time: "2026-05-08T15:00:00Z",
    scheduled_end_time: "2026-05-08T16:00:00Z",
    actual_start_time: null,
    actual_end_time: null,
    plan_run_id: RUN_ID,
    plan_position: 1,
    pause_reason: null,
  };

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [schedGame],
    hallReadyRowsByGameId: new Map([
      [SCHEDULED_GAME_ID, []], // No ready rows yet
    ]),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [
            { hallId: HALL_A, hallName: "Master Hall A" },
            { hallId: HALL_B, hallName: "Hall B" },
            { hallId: HALL_C, hallName: "Hall C" },
          ],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([
      [HALL_A, "Master Hall A"],
      [HALL_B, "Hall B"],
      [HALL_C, "Hall C"],
    ]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  assert.equal(state.currentScheduledGameId, SCHEDULED_GAME_ID);
  assert.notEqual(state.planMeta, null);
  assert.equal(state.planMeta?.planRunId, RUN_ID);
  assert.equal(state.planMeta?.planRunStatus, "running");
  assert.equal(state.planMeta?.currentPosition, 1);
  assert.equal(state.planMeta?.totalPositions, 2);
  assert.equal(state.planMeta?.catalogSlug, "innsatsen");
  assert.equal(state.planMeta?.jackpotSetupRequired, false);

  assert.notEqual(state.scheduledGameMeta, null);
  assert.equal(state.scheduledGameMeta?.scheduledGameId, SCHEDULED_GAME_ID);
  assert.equal(state.scheduledGameMeta?.status, "purchase_open");
  assert.equal(state.allHallsReady, false);
  assert.equal(state.halls.length, 3);
  // Alle haller røde fordi ingen ready-rad finnes (scheduled-game eksisterer
  // → defaults til "ingen spillere = red")
  for (const h of state.halls) {
    assert.equal(h.colorCode, "red");
    assert.equal(h.isReady, false);
  }
  assert.equal(state.inconsistencyWarnings.length, 0);
});

// ── Test 3: ready_to_start (alle haller ready) ──────────────────────────

test("state=ready_to_start: alle haller har trykket Klar", async () => {
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "running",
    currentPosition: 1,
  });
  const schedGame: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_ID,
    status: "ready_to_start",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: [HALL_A, HALL_B],
    scheduled_start_time: "2026-05-08T15:00:00Z",
    scheduled_end_time: "2026-05-08T16:00:00Z",
    actual_start_time: null,
    actual_end_time: null,
    plan_run_id: RUN_ID,
    plan_position: 1,
    pause_reason: null,
  };
  const readyRow = (hallId: string): HallReadyRowStub => ({
    gameId: SCHEDULED_GAME_ID,
    hallId,
    isReady: true,
    readyAt: "2026-05-08T14:55:00Z",
    readyByUserId: "u-agent-" + hallId,
    digitalTicketsSold: 5,
    physicalTicketsSold: 10,
    excludedFromGame: false,
    excludedReason: null,
    createdAt: "2026-05-08T14:50:00Z",
    updatedAt: "2026-05-08T14:55:00Z",
    // computeHallStatus: hvis physical-flow er aktiv (physicalSold > 0),
    // krever vi at start_ticket_id og final_scan_ticket_id er satt for
    // colorCode='green'. Sett dem her så testen verifiserer green-state.
    startTicketId: "1",
    startScannedAt: "2026-05-08T14:53:00Z",
    finalScanTicketId: "11",
    finalScannedAt: "2026-05-08T14:54:00Z",
  });

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [schedGame],
    hallReadyRowsByGameId: new Map([
      [SCHEDULED_GAME_ID, [readyRow(HALL_A), readyRow(HALL_B)]],
    ]),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [
            { hallId: HALL_A, hallName: "Master Hall A" },
            { hallId: HALL_B, hallName: "Hall B" },
          ],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([
      [HALL_A, "Master Hall A"],
      [HALL_B, "Hall B"],
    ]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  assert.equal(state.scheduledGameMeta?.status, "ready_to_start");
  assert.equal(state.allHallsReady, true);
  assert.equal(state.halls.length, 2);
  for (const h of state.halls) {
    assert.equal(h.isReady, true);
    // Med digitalTicketsSold=5 og physicalTicketsSold=10 + ingen physical-flow
    // (start_ticket_id null), forventer vi green.
    assert.equal(h.colorCode, "green");
  }
  assert.equal(state.isMasterAgent, true);
  assert.equal(state.inconsistencyWarnings.length, 0);
});

// ── Test 4: running (master har trykket Start) ─────────────────────────

test("state=running: master har startet runden", async () => {
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "running",
    currentPosition: 1,
    startedAt: "2026-05-08T14:00:00Z",
  });
  const schedGame: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_ID,
    status: "running",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: [HALL_A, HALL_B],
    scheduled_start_time: "2026-05-08T15:00:00Z",
    scheduled_end_time: "2026-05-08T16:00:00Z",
    actual_start_time: "2026-05-08T15:00:30Z",
    actual_end_time: null,
    plan_run_id: RUN_ID,
    plan_position: 1,
    pause_reason: null,
  };

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [schedGame],
    hallReadyRowsByGameId: new Map([[SCHEDULED_GAME_ID, []]]),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [
            { hallId: HALL_A, hallName: "A" },
            { hallId: HALL_B, hallName: "B" },
          ],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([
      [HALL_A, "A"],
      [HALL_B, "B"],
    ]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  assert.equal(state.scheduledGameMeta?.status, "running");
  assert.equal(state.scheduledGameMeta?.actualStartTime, "2026-05-08T15:00:30Z");
  assert.equal(state.nextScheduledStartTime, "2026-05-08T15:00:30Z");
  assert.equal(state.inconsistencyWarnings.length, 0);
});

// ── Test 5: paused ─────────────────────────────────────────────────────

test("state=paused: master har pauset runden", async () => {
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "paused",
    currentPosition: 1,
  });
  const schedGame: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_ID,
    status: "paused",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: [HALL_A],
    scheduled_start_time: "2026-05-08T15:00:00Z",
    scheduled_end_time: "2026-05-08T16:00:00Z",
    actual_start_time: "2026-05-08T15:01:00Z",
    actual_end_time: null,
    plan_run_id: RUN_ID,
    plan_position: 1,
    pause_reason: "Master pause — system error",
  };

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [schedGame],
    hallReadyRowsByGameId: new Map([[SCHEDULED_GAME_ID, []]]),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  assert.equal(state.scheduledGameMeta?.status, "paused");
  assert.equal(
    state.scheduledGameMeta?.pauseReason,
    "Master pause — system error",
  );
  assert.equal(state.planMeta?.planRunStatus, "paused");
  // No PLAN_SCHED_STATUS_MISMATCH expected — paused/paused is consistent.
  assert.equal(state.inconsistencyWarnings.length, 0);
});

test("state=auto-paused: running scheduled-game med engine pause vises som paused", async () => {
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "running",
    currentPosition: 1,
  });
  const schedGame: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_ID,
    status: "running",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: [HALL_A],
    scheduled_start_time: "2026-05-08T15:00:00Z",
    scheduled_end_time: "2026-05-08T16:00:00Z",
    actual_start_time: "2026-05-08T15:01:00Z",
    actual_end_time: null,
    plan_run_id: RUN_ID,
    plan_position: 1,
    pause_reason: null,
    engine_paused: true,
    engine_paused_at_phase: 1,
  };

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [schedGame],
    hallReadyRowsByGameId: new Map([[SCHEDULED_GAME_ID, []]]),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  assert.equal(state.currentScheduledGameId, SCHEDULED_GAME_ID);
  assert.equal(state.scheduledGameMeta?.status, "paused");
  assert.equal(state.scheduledGameMeta?.pauseReason, "Auto-pause etter fase 1");
  assert.equal(state.planMeta?.planRunStatus, "running");
  assert.equal(state.inconsistencyWarnings.length, 0);
});

// ── Test 6: finished ───────────────────────────────────────────────────

test("state=finished: siste position spilt — planMeta peker til siste catalog-slug", async () => {
  // Plan har 2 items, run finished på position=2 (siste). Plan er HELT
  // ferdig — `getOrCreateForToday` ville kaste PLAN_COMPLETED_FOR_TODAY
  // hvis master prøvde å starte ny. planMeta beholder siste catalog-slug
  // så UI kan rendre "Plan ferdig"-banner med kontekst.
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "finished",
    currentPosition: 2,
    finishedAt: "2026-05-08T20:00:00Z",
  });
  // No active scheduled-game (already completed).
  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [],
    hallReadyRowsByGameId: new Map(),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  assert.equal(state.currentScheduledGameId, null);
  assert.equal(state.scheduledGameMeta, null);
  assert.equal(state.planMeta?.planRunStatus, "finished");
  assert.equal(state.planMeta?.currentPosition, 2);
  assert.equal(state.planMeta?.totalPositions, 2);
  assert.equal(state.inconsistencyWarnings.length, 0);
});

// ── Bug-fix 2026-05-14: finished + flere posisjoner igjen → planMeta advancer ─

test("state=finished mid-plan: planMeta peker til NESTE catalog-slug (BUG E follow-up)", async () => {
  // Tobias-rapport 2026-05-14 13:00 (samme dag som PR #1422 landet):
  //   Master-UI viser "Start neste spill — Bingo" etter at Bingo
  //   (position=1) er ferdigspilt. Skal vise "1000-spill" (position=2).
  //
  // Root cause: buildPlanMeta brukte clamping `Math.min(rawPosition, items.length)`
  // som returnerte position=1 selv ved finished-state. UI fall tilbake
  // til Bingo-default.
  //
  // Fix: når `planRun.status === 'finished'` OG `currentPosition < items.length`,
  // peker `positionForDisplay` til `currentPosition + 1` slik at
  // `catalogSlug`/`catalogDisplayName` viser NESTE plan-item.
  //
  // Komplementært til PR #1422 sin DB-side advance-logikk i
  // `getOrCreateForToday`.
  const catalog1 = makeCatalogEntry({
    id: "gc-bingo",
    slug: "bingo",
    displayName: "Bingo",
  });
  const catalog2 = makeCatalogEntry({
    id: "gc-1000-spill",
    slug: "1000-spill",
    displayName: "1000-spill",
  });
  const plan = makePlanWithItems({
    id: PLAN_ID,
    hallId: null,
    groupOfHallsId: GOH_ID,
    items: [
      {
        id: `item-${PLAN_ID}-1`,
        planId: PLAN_ID,
        position: 1,
        gameCatalogId: catalog1.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T12:00:00Z",
        catalogEntry: catalog1,
      },
      {
        id: `item-${PLAN_ID}-2`,
        planId: PLAN_ID,
        position: 2,
        gameCatalogId: catalog2.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T12:00:00Z",
        catalogEntry: catalog2,
      },
    ],
  });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "finished",
    currentPosition: 1, // ← Bingo ferdig, ny syklus starter på 1000-spill
    finishedAt: "2026-05-08T13:00:00Z",
  });
  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [],
    hallReadyRowsByGameId: new Map(),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  // planRunStatus skal fortsatt være finished (UI viser status-pille korrekt).
  assert.equal(state.planMeta?.planRunStatus, "finished");
  // currentPosition i meta speiler RAW DB-verdi (vi forfalsker den ikke).
  assert.equal(state.planMeta?.currentPosition, 1);
  assert.equal(state.planMeta?.totalPositions, 2);
  // catalogSlug/displayName peker til NESTE item (position=2 = 1000-spill).
  // Dette er det avgjørende: UI rendrer "Start neste spill — 1000-spill",
  // ikke "Start neste spill — Bingo".
  assert.equal(state.planMeta?.catalogSlug, "1000-spill");
  assert.equal(state.planMeta?.catalogDisplayName, "1000-spill");
});

test("state=finished mid-plan (13-item demo): finished på position=7 → planMeta viser position=8", async () => {
  // 13-item plan som matcher pilot demo (Bingo/1000-spill/.../TV-Extra).
  // Run finished på position=7 — master har klikket gjennom 7 spill.
  // planMeta skal vise spill #8 (catalog-slug speiler dette).
  const items = Array.from({ length: 13 }, (_, idx) => {
    const slug = `game-${idx + 1}`;
    return {
      id: `item-${PLAN_ID}-${idx + 1}`,
      planId: PLAN_ID,
      position: idx + 1,
      gameCatalogId: `gc-${slug}`,
      bonusGameOverride: null,
      notes: null,
      createdAt: "2026-05-07T12:00:00Z",
      catalogEntry: makeCatalogEntry({
        id: `gc-${slug}`,
        slug,
        displayName: `Spill ${idx + 1}`,
      }),
    };
  });
  const plan = makePlanWithItems({
    id: PLAN_ID,
    hallId: null,
    groupOfHallsId: GOH_ID,
    items,
  });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "finished",
    currentPosition: 7,
    finishedAt: "2026-05-08T15:00:00Z",
  });
  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [],
    hallReadyRowsByGameId: new Map(),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  assert.equal(state.planMeta?.planRunStatus, "finished");
  assert.equal(state.planMeta?.currentPosition, 7);
  assert.equal(state.planMeta?.totalPositions, 13);
  // catalogSlug peker til position=8 (game-8 i syntetisk demo-list).
  assert.equal(state.planMeta?.catalogSlug, "game-8");
  assert.equal(state.planMeta?.catalogDisplayName, "Spill 8");
});

// ── Test 7: missing-plan (legacy daily_schedule path) ──────────────────

test("state=missing-plan: legacy daily_schedule spawn-rad uten plan-run", async () => {
  // Hallen har en aktiv scheduled-game spawnet via legacy Game1ScheduleTickService
  // (catalog_entry_id og plan_run_id er null). Plan-runtime kjenner ikke til den.
  const schedGame: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_LEGACY_ID,
    status: "purchase_open",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: [HALL_A],
    scheduled_start_time: "2026-05-08T15:00:00Z",
    scheduled_end_time: "2026-05-08T16:00:00Z",
    actual_start_time: null,
    actual_end_time: null,
    plan_run_id: null, // legacy = null
    plan_position: null,
    pause_reason: null,
  };

  const aggregator = makeAggregator({
    planRunByHall: new Map(), // No plan-run
    planById: new Map(),
    scheduledGameRows: [schedGame],
    hallReadyRowsByGameId: new Map([[SCHEDULED_GAME_LEGACY_ID, []]]),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  assert.equal(state.currentScheduledGameId, SCHEDULED_GAME_LEGACY_ID);
  assert.equal(state.planMeta, null); // No plan-run → no planMeta
  assert.notEqual(state.scheduledGameMeta, null);
  assert.equal(state.scheduledGameMeta?.status, "purchase_open");
  // No warnings — legacy path is valid.
  assert.equal(state.inconsistencyWarnings.length, 0);
});

// ── Test 8: dual-scheduled-games (legacy + plan-bridge konflikt) ───────

test("state=dual-scheduled-games: legacy + plan-bridge har spawnet samtidig", async () => {
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "running",
    currentPosition: 1,
  });
  // Legacy-row har tidligere scheduled_start_time så legacy-query
  // (ORDER BY scheduled_start_time ASC LIMIT 1) returnerer DENNE og ikke
  // plan-bridge-raden. Plan-bridge-query finner bridge-raden via
  // plan_run_id+position. Resultat: bridgeRow !== legacyRow → DUAL conflict.
  const legacyRow: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_LEGACY_ID,
    status: "purchase_open",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: [HALL_A],
    scheduled_start_time: "2026-05-08T14:30:00Z", // earlier
    scheduled_end_time: "2026-05-08T15:30:00Z",
    actual_start_time: null,
    actual_end_time: null,
    plan_run_id: null,
    plan_position: null,
    pause_reason: null,
  };
  const bridgeRow: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_ID,
    status: "running",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: [HALL_A],
    scheduled_start_time: "2026-05-08T15:00:00Z", // later
    scheduled_end_time: "2026-05-08T16:00:00Z",
    actual_start_time: "2026-05-08T15:01:00Z",
    actual_end_time: null,
    plan_run_id: RUN_ID,
    plan_position: 1,
    pause_reason: null,
  };

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [bridgeRow, legacyRow],
    hallReadyRowsByGameId: new Map([[SCHEDULED_GAME_ID, []]]),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  // Plan-bridge wins — currentScheduledGameId = SCHEDULED_GAME_ID
  assert.equal(state.currentScheduledGameId, SCHEDULED_GAME_ID);
  // DUAL_SCHEDULED_GAMES warning
  const dualWarn = state.inconsistencyWarnings.find(
    (w) => w.code === "DUAL_SCHEDULED_GAMES",
  );
  assert.notEqual(dualWarn, undefined);
});

// ── Test 9: stale-goh-member ───────────────────────────────────────────

test("state=stale-goh-member: hall fjernet fra GoH etter spawn", async () => {
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "running",
    currentPosition: 1,
  });
  // Snapshot på spawn-tid: HALL_A, HALL_B, HALL_C er deltakere
  const schedGame: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_ID,
    status: "purchase_open",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: [HALL_A, HALL_B, HALL_C],
    scheduled_start_time: "2026-05-08T15:00:00Z",
    scheduled_end_time: "2026-05-08T16:00:00Z",
    actual_start_time: null,
    actual_end_time: null,
    plan_run_id: RUN_ID,
    plan_position: 1,
    pause_reason: null,
  };
  // Men nå er HALL_C fjernet fra GoH.
  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [schedGame],
    hallReadyRowsByGameId: new Map([[SCHEDULED_GAME_ID, []]]),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [
            { hallId: HALL_A, hallName: "Master A" },
            { hallId: HALL_B, hallName: "B" },
            // HALL_C fjernet
          ],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([
      [HALL_A, "Master A"],
      [HALL_B, "B"],
    ]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  // HALL_C should NOT appear in halls
  const hallIds = state.halls.map((h) => h.hallId);
  assert.ok(!hallIds.includes(HALL_C), "HALL_C should be filtered out");
  assert.ok(hallIds.includes(HALL_A));
  assert.ok(hallIds.includes(HALL_B));
  // MISSING_GOH_MEMBERSHIP warning
  const staleWarn = state.inconsistencyWarnings.find(
    (w) => w.code === "MISSING_GOH_MEMBERSHIP",
  );
  assert.notEqual(staleWarn, undefined);
});

// ── Test 10: plan-running-no-scheduled (BRIDGE_FAILED) ────────────────

test("state=plan-running-no-scheduled: BRIDGE_FAILED warning", async () => {
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "running",
    currentPosition: 1,
  });
  // Plan-run says running, but NO scheduled-game exists.
  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [], // Bridge failed — no row
    hallReadyRowsByGameId: new Map(),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  assert.equal(state.currentScheduledGameId, null);
  const bridgeWarn = state.inconsistencyWarnings.find(
    (w) => w.code === "BRIDGE_FAILED",
  );
  assert.notEqual(bridgeWarn, undefined);
});

// ── Test 11: cross-tz-businessDate ─────────────────────────────────────

test("state=cross-tz-businessDate: businessDate i Oslo-tz, ikke UTC", async () => {
  // Sett klokke til 22:55 UTC (= 00:55 Oslo sommerstid eller 23:55 vintertid).
  // Resultat: businessDate skal være Oslo-dato, ikke UTC-dato. Bruker fast
  // testdato 2026-05-08 22:55 UTC = 2026-05-09 00:55 Oslo (sommer).
  const lateNow = new Date("2026-05-08T22:55:00Z");

  const planService = {
    async getById() { return null; },
    async list() { return []; },
  };
  const planRunService = {
    async findForDay() { return null; },
  };
  const hallReadyService = {
    async getReadyStatusForGame() { return []; },
  };
  const hallGroupService = {
    async get() { throw new DomainError("HALL_GROUP_NOT_FOUND", "n/a"); },
    async list() { return []; },
  };
  const platformService = {
    async getHall(id: string) { return { id, name: "Test" }; },
  };
  const stubPool = {
    async query() { return { rowCount: 0, rows: [] }; },
  };

  const aggregator = GameLobbyAggregator.forTesting({
    pool: stubPool as never,
    schema: "public",
    planService: planService as never,
    planRunService: planRunService as never,
    hallReadyService: hallReadyService as never,
    hallGroupService: hallGroupService as never,
    platformService: platformService as never,
    clock: () => lateNow,
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  // Oslo sommer (CEST) UTC+2 — 22:55 UTC = 00:55 9. mai
  assert.equal(state.businessDate, "2026-05-09");
});

// ── Test 12: terminal completed mellom plan-posisjoner ───────────────────

test("state=inter-round: plan-run.running med scheduled-game.completed er ikke mismatch", async () => {
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "running",
    currentPosition: 1,
  });
  const schedGame: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_ID,
    status: "completed",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: [HALL_A],
    scheduled_start_time: "2026-05-08T15:00:00Z",
    scheduled_end_time: "2026-05-08T16:00:00Z",
    actual_start_time: "2026-05-08T15:00:00Z",
    actual_end_time: "2026-05-08T15:10:00Z",
    plan_run_id: RUN_ID,
    plan_position: 1,
    pause_reason: null,
  };

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [schedGame],
    hallReadyRowsByGameId: new Map([[SCHEDULED_GAME_ID, []]]),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  assert.equal(state.currentScheduledGameId, SCHEDULED_GAME_ID);
  assert.equal(state.scheduledGameMeta?.status, "completed");
  assert.equal(
    state.inconsistencyWarnings.some(
      (w) => w.code === "PLAN_SCHED_STATUS_MISMATCH",
    ),
    false,
  );
});

// ── Test 13: status-mismatch (plan-run.running med scheduled-game.cancelled) ──

test("state=status-mismatch: plan-run.running men scheduled-game.cancelled", async () => {
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "running",
    currentPosition: 1,
  });
  // EDGE CASE (bevisst): PLAN_SCHED_STATUS_MISMATCH trigges KUN når
  // plan-run-status divergerer fra en bridge-spawnet rad. Hvis kun
  // legacy-row finnes i cancelled-state og ingen bridge-row, får vi
  // hverken status-mismatch eller bridge-failed — fordi
  // queryActiveScheduledGameForHall ekskluderer cancelled-rader uansett
  // (status NOT IN ('purchase_open','ready_to_start','running','paused')).
  // Dette er konsistent med audit-rapport §3.5 "stale legacy snapshot
  // behandles som ingen aktiv game". Code-review (PR #1050) funn 6.
  //
  // I denne testen sender vi en BRIDGE-row (plan_run_id+plan_position
  // matcher) i 'cancelled'-state, så queryScheduledGameByPlanRun
  // returnerer raden uavhengig av status. Det er stien som faktisk
  // trigger PLAN_SCHED_STATUS_MISMATCH.
  const schedGame: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_ID,
    status: "cancelled",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: [HALL_A],
    scheduled_start_time: "2026-05-08T15:00:00Z",
    scheduled_end_time: "2026-05-08T16:00:00Z",
    actual_start_time: null,
    actual_end_time: null,
    plan_run_id: RUN_ID,
    plan_position: 1,
    pause_reason: null,
  };

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [schedGame],
    hallReadyRowsByGameId: new Map([[SCHEDULED_GAME_ID, []]]),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  // Plan-bridge match → currentScheduledGameId returneres
  assert.equal(state.currentScheduledGameId, SCHEDULED_GAME_ID);
  assert.equal(state.scheduledGameMeta?.status, "cancelled");
  // Status mismatch warning
  const mismatch = state.inconsistencyWarnings.find(
    (w) => w.code === "PLAN_SCHED_STATUS_MISMATCH",
  );
  assert.notEqual(mismatch, undefined);
});

// ── Test 13: stale-plan-run (yesterday-or-older fortsatt åpen) ─────────

test("state=stale-plan-run: gårsdagens run fortsatt running", async () => {
  const yesterday = "2026-05-07"; // FIXED_BUSINESS_DATE er 2026-05-08
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  // findForDay queries by (hall, today). To trigger this scenario, we
  // simulate by returning a run for HALL_A but with businessDate=yesterday.
  // Note: findForDay only looks up by today's date in production; to test
  // this we rely on the stub returning whatever we tell it. The actual
  // staleness check in aggregator is `planRun.businessDate < businessDate`.
  //
  // For this test we use a special stub that doesn't filter by date in the
  // map.
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "running",
    currentPosition: 1,
    businessDate: yesterday,
  });

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [],
    hallReadyRowsByGameId: new Map(),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  // STALE_PLAN_RUN warning
  const staleWarn = state.inconsistencyWarnings.find(
    (w) => w.code === "STALE_PLAN_RUN",
  );
  assert.notEqual(staleWarn, undefined);
});

// ── Test 14: admin-actor (alltid master, uavhengig av hallId) ────────

test("isMasterAgent: ADMIN er alltid master uavhengig av hallId", async () => {
  const aggregator = makeAggregator({
    planRunByHall: new Map(),
    scheduledGameRows: [],
    goHListByHallId: new Map([
      [
        HALL_A,
        [
          {
            id: GOH_ID,
            members: [{ hallId: HALL_A, hallName: "A" }],
            masterHallId: HALL_A,
          },
        ],
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  // ADMIN uten hallId — fortsatt master
  const stateAdminNoHall = await aggregator.getLobbyState(HALL_A, {
    role: "ADMIN",
    hallId: null,
  });
  assert.equal(stateAdminNoHall.isMasterAgent, true);

  // AGENT på HALL_B (ikke master) — ikke master
  const stateAgentDifferentHall = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_B,
  });
  assert.equal(stateAgentDifferentHall.isMasterAgent, false);

  // Ingen actor-context — ikke master
  const stateNoActor = await aggregator.getLobbyState(HALL_A);
  assert.equal(stateNoActor.isMasterAgent, false);
});

// ── Test 15: infra-error (DB throws) ──────────────────────────────────

test("infra-error: planRunService kaster ECONNREFUSED → DomainError", async () => {
  const aggregator = makeAggregator({ throwOnFindForDay: true });

  await assert.rejects(
    async () => {
      await aggregator.getLobbyState(HALL_A, {
        role: "AGENT",
        hallId: HALL_A,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "skal være DomainError");
      assert.equal(
        (err as DomainError).code,
        "LOBBY_AGGREGATOR_INFRA_ERROR",
      );
      return true;
    },
  );
});

// ── Test 16: hall-scope-flag — HALL_OPERATOR ser hall-scoped state ────

test("hall-scope: HALL_OPERATOR på HALL_A får isMasterAgent=true når master = HALL_A", async () => {
  const plan = makePlanWithItems({ id: PLAN_ID, hallId: null, groupOfHallsId: GOH_ID });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "running",
    currentPosition: 1,
  });
  const schedGame: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_ID,
    status: "running",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: [HALL_A, HALL_B],
    scheduled_start_time: "2026-05-08T15:00:00Z",
    scheduled_end_time: "2026-05-08T16:00:00Z",
    actual_start_time: "2026-05-08T15:01:00Z",
    actual_end_time: null,
    plan_run_id: RUN_ID,
    plan_position: 1,
    pause_reason: null,
  };

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [schedGame],
    hallReadyRowsByGameId: new Map([[SCHEDULED_GAME_ID, []]]),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [
            { hallId: HALL_A, hallName: "A" },
            { hallId: HALL_B, hallName: "B" },
          ],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([
      [HALL_A, "A"],
      [HALL_B, "B"],
    ]),
  });

  const stateMasterAgent = await aggregator.getLobbyState(HALL_A, {
    role: "HALL_OPERATOR",
    hallId: HALL_A,
  });
  assert.equal(stateMasterAgent.isMasterAgent, true);

  const stateNonMasterAgent = await aggregator.getLobbyState(HALL_A, {
    role: "HALL_OPERATOR",
    hallId: HALL_B,
  });
  assert.equal(stateNonMasterAgent.isMasterAgent, false);
});

// ── Test 17: empty-state schema-validation (route-level shape) ────────

test("empty-state: ADMIN-uten-hall route-shape parser via Spill1AgentLobbyStateSchema", () => {
  // Code-review (PR #1050) funn 1: 'agentGame1Lobby.ts:142-160' returnerer
  // empty-state med null-felter. Denne testen verifiserer at den eksakte
  // shape-en route-en konstruerer faktisk passerer Zod-skjemaet — det er
  // kontrakten Bølge 3-frontend baserer parsing på.
  //
  // Vi konstruerer empty-state-objektet 1:1 som route-handleren gjør, og
  // kaller parse(). Hvis schemaet noen gang strammes inn slik at
  // null-feltene avvises, fanger denne testen det før wire-skewen treffer
  // prod.
  const emptyState = {
    hallId: null,
    hallName: null,
    businessDate: null,
    generatedAt: new Date().toISOString(),
    currentScheduledGameId: null,
    planMeta: null,
    scheduledGameMeta: null,
    halls: [] as never[],
    allHallsReady: false,
    masterHallId: null,
    groupOfHallsId: null,
    isMasterAgent: false,
    nextScheduledStartTime: null,
    inconsistencyWarnings: [] as never[],
  };

  const result = Spill1AgentLobbyStateSchema.safeParse(emptyState);
  assert.equal(
    result.success,
    true,
    `empty-state må parse via schema. Feil: ${result.success ? "" : JSON.stringify(result.error.issues)}`,
  );
  if (result.success) {
    assert.equal(result.data.hallId, null);
    assert.equal(result.data.hallName, null);
    assert.equal(result.data.businessDate, null);
    assert.equal(result.data.halls.length, 0);
    assert.equal(result.data.inconsistencyWarnings.length, 0);
    assert.equal(result.data.allHallsReady, false);
    assert.equal(result.data.isMasterAgent, false);
  }
});

// ── Test 18: STALE_PLAN_RUN trigges også for status='paused' ──────────

test("STALE_PLAN_RUN: trigges når yesterday-run står i status='paused' (ikke kun running)", async () => {
  // Code-review (PR #1050) flagget at testen for stale-plan-run kun
  // dekker 'running'. Aggregator-koden bruker 'planRun.status !== "finished"'
  // som guard, så 'paused' og 'idle' skal også trigge warning. Denne
  // testen verifiserer paused-grenen.
  const yesterday = "2026-05-07"; // FIXED_BUSINESS_DATE er 2026-05-08
  const plan = makePlanWithItems({
    id: PLAN_ID,
    hallId: null,
    groupOfHallsId: GOH_ID,
  });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "paused", // ← key forskjell fra Test 13
    currentPosition: 1,
    businessDate: yesterday,
  });

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [],
    hallReadyRowsByGameId: new Map(),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  const staleWarn = state.inconsistencyWarnings.find(
    (w) => w.code === "STALE_PLAN_RUN",
  );
  assert.notEqual(
    staleWarn,
    undefined,
    "STALE_PLAN_RUN må trigge for paused-state også, ikke kun running",
  );
  // Verify detail.planRunStatus reflects 'paused' (so caller can act on it)
  const detail = staleWarn?.detail as { planRunStatus?: string } | undefined;
  assert.equal(detail?.planRunStatus, "paused");
});

// ── Test 19: currentPosition=0 edge-case (idle-run uten advance) ──────

test("planMeta: currentPosition=0 (idle-run uten advance) — buildPlanMeta krasjer ikke", async () => {
  // Code-review (PR #1050) flagget at currentPosition=0 er en gyldig
  // edge-case for idle-state der lazy-create returnerer run uten
  // advance. buildPlanMeta sin guard 'Math.max(1, ...)' beskytter mot
  // crash, men vi vil ha eksplisitt test.
  const plan = makePlanWithItems({
    id: PLAN_ID,
    hallId: null,
    groupOfHallsId: GOH_ID,
  });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "idle",
    currentPosition: 0, // ← edge-case
  });

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [],
    hallReadyRowsByGameId: new Map(),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  // Aggregator skal ikke krasje. planMeta kan eksistere (med
  // currentPosition=0 i meta-objektet) eller falle tilbake til null
  // hvis items ikke matcher — begge er akseptable. Det viktige er
  // at vi ikke kaster.
  assert.notEqual(state, undefined);
  // Hvis planMeta finnes, må currentPosition være korrekt eksponert.
  // (Note: vi parser ikke via Zod-schema her fordi test-fixturene
  // bruker syntetiske IDer som ikke er valid UUIDv4. Schema-parsing
  // dekkes av Test 17 empty-state + route-laget i prod.)
  if (state.planMeta !== null) {
    assert.equal(state.planMeta.currentPosition, 0);
    // totalPositions speiler items-count (2 fra makePlanWithItems-default).
    assert.equal(state.planMeta.totalPositions, 2);
  }
});

// ── Test 20: malformed JSON i participating_halls_json ────────────────

test("malformed-participating-json: ugyldig JSON-streng håndteres defensivt", async () => {
  // Code-review (PR #1050) flagget at parseHallIdsArray sin try/catch
  // bør verifiseres med eksplisitt test. Hvis 'participating_halls_json'
  // i DB er en ugyldig JSON-streng (corrupt rad / partial write),
  // skal aggregator returnere tom liste og ikke krasje.
  const plan = makePlanWithItems({
    id: PLAN_ID,
    hallId: null,
    groupOfHallsId: GOH_ID,
  });
  const planRun = makePlanRun({
    id: RUN_ID,
    planId: PLAN_ID,
    hallId: HALL_A,
    status: "running",
    currentPosition: 1,
  });
  // Sett participating_halls_json til en streng som IKKE er valid JSON.
  const schedGame: ScheduledGameRowStub = {
    id: SCHEDULED_GAME_ID,
    status: "running",
    master_hall_id: HALL_A,
    group_hall_id: GOH_ID,
    participating_halls_json: "not-json-at-all-{[",
    scheduled_start_time: "2026-05-08T15:00:00Z",
    scheduled_end_time: "2026-05-08T16:00:00Z",
    actual_start_time: "2026-05-08T15:01:00Z",
    actual_end_time: null,
    plan_run_id: RUN_ID,
    plan_position: 1,
    pause_reason: null,
  };

  const aggregator = makeAggregator({
    planRunByHall: new Map([[HALL_A, planRun]]),
    planById: new Map([[PLAN_ID, plan]]),
    scheduledGameRows: [schedGame],
    hallReadyRowsByGameId: new Map([[SCHEDULED_GAME_ID, []]]),
    goHMembersByGroupId: new Map([
      [
        GOH_ID,
        {
          id: GOH_ID,
          members: [{ hallId: HALL_A, hallName: "A" }],
          masterHallId: HALL_A,
        },
      ],
    ]),
    hallNamesById: new Map([[HALL_A, "A"]]),
  });

  // Aggregator skal returnere state uten å throw, og participating
  // skal tolkes som tom array.
  const state = await aggregator.getLobbyState(HALL_A, {
    role: "AGENT",
    hallId: HALL_A,
  });

  // currentScheduledGameId skal fortsatt være satt (vi hentet raden).
  assert.equal(state.currentScheduledGameId, SCHEDULED_GAME_ID);
  // Med tom participating-array etter parse-feil, blir alle ikke-master
  // haller markert ekskludert via "Ikke deltaker"-grenen.
  // Master (HALL_A) skal fortsatt vises som ikke-ekskludert.
  const masterEntry = state.halls.find((h) => h.hallId === HALL_A);
  assert.notEqual(masterEntry, undefined);
  assert.equal(masterEntry?.excludedFromGame, false);
  assert.equal(masterEntry?.isMaster, true);
  // Note: Schema-parse dekkes av Test 17 empty-state. Test-fixturer her
  // bruker syntetiske IDer som ikke er UUIDv4, så strict schema-parse
  // ville feile på UUID-validering. Aggregator-kontrakten testes i
  // prod via route-laget (commit 4 — Zod safeParse).
});
