/**
 * Spilleplan-lobby for Spill 1 (2026-05-08): unit-tester.
 *
 * Tester `Game1LobbyService.getLobbyState` for de seks viktigste klient-
 * scenarioene:
 *   1. Ingen plan dekker hallen → closed
 *   2. Plan finnes men nå er utenfor åpningstid → closed (med plan-info)
 *   3. Innenfor åpningstid + ingen run → idle (vis første item som "neste")
 *   4. Innenfor åpningstid + run i `idle` (master har ikke trykket Start) →
 *      idle (med run-id, men ingen scheduled-game ennå)
 *   5. Run i `running` med scheduled-game i `purchase_open` → purchase_open
 *   6. Run finished → finished
 *
 * Object.create-pattern + stub-pool + stub-services — ingen Postgres.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Game1LobbyService } from "./Game1LobbyService.js";
import { GamePlanService } from "./GamePlanService.js";
import { GamePlanRunService } from "./GamePlanRunService.js";
import { GameCatalogService } from "./GameCatalogService.js";
import { DomainError } from "../errors/DomainError.js";
import type { GamePlan, GamePlanWithItems, GamePlanRun } from "./gamePlan.types.js";
import type { GameCatalogEntry } from "./gameCatalog.types.js";

// ── helpers ──────────────────────────────────────────────────────────────

function makeCatalogEntry(
  overrides: Partial<GameCatalogEntry> = {},
): GameCatalogEntry {
  return {
    id: "gc-bingo",
    slug: "bingo",
    displayName: "Bingo",
    description: null,
    rules: {},
    ticketColors: ["gul", "hvit"],
    ticketPricesCents: { gul: 1000, hvit: 500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 100000 },
    },
    prizeMultiplierMode: "auto",
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

function makePlan(
  overrides: Partial<GamePlan> = {},
  items: { gameCatalogId: string; catalogEntry: GameCatalogEntry }[] = [
    { gameCatalogId: "gc-bingo", catalogEntry: makeCatalogEntry() },
    {
      gameCatalogId: "gc-jackpot",
      catalogEntry: makeCatalogEntry({
        id: "gc-jackpot",
        slug: "jackpot",
        displayName: "Jackpot",
      }),
    },
  ],
): GamePlanWithItems {
  return {
    id: "gp-1",
    name: "Pilot-spilleplan",
    description: null,
    hallId: "hall-1",
    groupOfHallsId: null,
    weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    startTime: "11:00",
    endTime: "21:00",
    isActive: true,
    createdAt: "2026-05-07T12:00:00Z",
    updatedAt: "2026-05-07T12:00:00Z",
    createdByUserId: "u-1",
    items: items.map((it, idx) => ({
      id: `item-${idx + 1}`,
      planId: "gp-1",
      position: idx + 1,
      gameCatalogId: it.gameCatalogId,
      bonusGameOverride: null,
      notes: null,
      createdAt: "2026-05-07T12:00:00Z",
      catalogEntry: it.catalogEntry,
    })),
    ...overrides,
  };
}

function makeRun(overrides: Partial<GamePlanRun> = {}): GamePlanRun {
  return {
    id: "run-1",
    planId: "gp-1",
    hallId: "hall-1",
    businessDate: "2026-05-08",
    currentPosition: 1,
    status: "idle",
    jackpotOverrides: {},
    startedAt: null,
    finishedAt: null,
    masterUserId: null,
    createdAt: "2026-05-08T11:00:00Z",
    updatedAt: "2026-05-08T11:00:00Z",
    ...overrides,
  };
}

function stubCatalogService(): GameCatalogService {
  const svc = Object.create(GameCatalogService.prototype) as GameCatalogService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  return svc;
}

function stubPlanService(plans: GamePlanWithItems[]): GamePlanService {
  const svc = Object.create(GamePlanService.prototype) as GamePlanService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { catalogService: GameCatalogService }).catalogService =
    stubCatalogService();
  (svc as unknown as { auditLogService: null }).auditLogService = null;
  // list returnerer planer som matcher hallId/groupOfHallsIds — vi
  // forenkler her ved alltid å returnere alle planene; service-siden
  // filtrerer ikke videre når vi tester (caller sjekker weekdays).
  (svc as unknown as {
    list: (filter: {
      hallId?: string;
      groupOfHallsIds?: string[];
      isActive?: boolean;
    }) => Promise<GamePlan[]>;
  }).list = async (filter) => {
    return plans.filter((p) => {
      if (filter.isActive !== undefined && p.isActive !== filter.isActive) {
        return false;
      }
      const matchesHall =
        filter.hallId !== undefined && p.hallId === filter.hallId;
      const matchesGroup =
        Array.isArray(filter.groupOfHallsIds) &&
        p.groupOfHallsId !== null &&
        filter.groupOfHallsIds.includes(p.groupOfHallsId);
      // Hvis hverken hallId eller groupOfHallsIds er sendt, returner alt.
      if (filter.hallId === undefined && !filter.groupOfHallsIds) return true;
      return matchesHall || matchesGroup;
    });
  };
  (svc as unknown as {
    getById: (id: string) => Promise<GamePlanWithItems | null>;
  }).getById = async (id) => plans.find((p) => p.id === id) ?? null;
  return svc;
}

function stubRunService(run: GamePlanRun | null): GamePlanRunService {
  const svc = Object.create(
    GamePlanRunService.prototype,
  ) as GamePlanRunService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as {
    findForDay: (
      hallId: string,
      businessDate: string | Date,
    ) => Promise<GamePlanRun | null>;
  }).findForDay = async () => run;
  return svc;
}

interface ScheduledGameRow {
  id: string;
  status: string;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  actual_start_time: string | null;
  catalog_entry_id: string | null;
}

function makeLobbyService(opts: {
  plans: GamePlanWithItems[];
  run: GamePlanRun | null;
  scheduledGame?: ScheduledGameRow | null;
  /**
   * GoH-IDer som hallens medlemskaps-query skal returnere. Default tom
   * (hallen er kun direkte-bundet).
   */
  goHIds?: string[];
}): {
  service: Game1LobbyService;
  queries: { sql: string; params: unknown[] | undefined }[];
} {
  const queries: { sql: string; params: unknown[] | undefined }[] = [];
  const stubPool = {
    async query(textOrConfig: unknown, params?: unknown[]): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      queries.push({ sql, params });
      // app_hall_group_members
      if (/app_hall_group_members/i.test(sql)) {
        return {
          rows: (opts.goHIds ?? []).map((g) => ({ group_id: g })),
        };
      }
      // app_game1_scheduled_games
      if (/app_game1_scheduled_games/i.test(sql)) {
        if (opts.scheduledGame) {
          return { rows: [opts.scheduledGame] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const planSvc = stubPlanService(opts.plans);
  const runSvc = stubRunService(opts.run);
  const svc = Game1LobbyService.forTesting({
    pool: stubPool as unknown as import("pg").Pool,
    schema: "public",
    planService: planSvc,
    planRunService: runSvc,
  });
  return { service: svc, queries };
}

/** Build a Date that is 14:00 Oslo on a Friday (2026-05-08). */
function fridayAt1400Oslo(): Date {
  // 2026-05-08 14:00 CEST = 12:00 UTC (Norge sommertid).
  return new Date("2026-05-08T12:00:00Z");
}

/** Build a Date that is 09:00 Oslo on a Friday (2026-05-08). */
function fridayAt0900Oslo(): Date {
  return new Date("2026-05-08T07:00:00Z");
}

/** Build a Date that is 22:30 Oslo on a Friday (2026-05-08). */
function fridayAt2230Oslo(): Date {
  return new Date("2026-05-08T20:30:00Z");
}

// ── tests ────────────────────────────────────────────────────────────────

test("Game1LobbyService: closed når ingen plan dekker hallen", async () => {
  const { service } = makeLobbyService({ plans: [], run: null });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.isOpen, false);
  assert.equal(state.overallStatus, "closed");
  assert.equal(state.openingTimeStart, null);
  assert.equal(state.openingTimeEnd, null);
  assert.equal(state.planId, null);
  assert.equal(state.runId, null);
  assert.equal(state.nextScheduledGame, null);
  assert.equal(state.totalPositions, 0);
});

test("Game1LobbyService: closed med plan-info utenfor åpningstid (før 11:00)", async () => {
  const plan = makePlan();
  const { service } = makeLobbyService({ plans: [plan], run: null });
  const state = await service.getLobbyState("hall-1", fridayAt0900Oslo());

  assert.equal(state.isOpen, false);
  assert.equal(state.overallStatus, "closed");
  assert.equal(state.openingTimeStart, "11:00");
  assert.equal(state.openingTimeEnd, "21:00");
  assert.equal(state.planId, "gp-1");
  assert.equal(state.planName, "Pilot-spilleplan");
  assert.equal(state.runId, null);
  // closed → ingen "neste"-info ennå (kunden ser åpningstider).
  assert.equal(state.nextScheduledGame, null);
});

test("Game1LobbyService: closed etter endTime (22:30 Oslo)", async () => {
  const plan = makePlan();
  const { service } = makeLobbyService({ plans: [plan], run: null });
  const state = await service.getLobbyState("hall-1", fridayAt2230Oslo());

  assert.equal(state.isOpen, false);
  assert.equal(state.overallStatus, "closed");
  assert.equal(state.openingTimeStart, "11:00");
  assert.equal(state.openingTimeEnd, "21:00");
});

test("Game1LobbyService: idle når innenfor åpningstid + ingen run", async () => {
  const plan = makePlan();
  const { service } = makeLobbyService({ plans: [plan], run: null });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.isOpen, true);
  assert.equal(state.overallStatus, "idle");
  assert.equal(state.openingTimeStart, "11:00");
  assert.equal(state.openingTimeEnd, "21:00");
  assert.equal(state.runId, null);
  assert.equal(state.runStatus, null);
  assert.equal(state.currentRunPosition, 0);
  assert.equal(state.totalPositions, 2);
  // Skal vise første item som "neste".
  assert.notEqual(state.nextScheduledGame, null);
  assert.equal(state.nextScheduledGame?.position, 1);
  assert.equal(state.nextScheduledGame?.catalogSlug, "bingo");
  assert.equal(state.nextScheduledGame?.catalogDisplayName, "Bingo");
  assert.equal(state.nextScheduledGame?.status, "idle");
  assert.equal(state.nextScheduledGame?.scheduledGameId, null);
});

test("Game1LobbyService: idle med run-i-idle (master har ikke trykket Start)", async () => {
  const plan = makePlan();
  const run = makeRun({ status: "idle", currentPosition: 1 });
  const { service } = makeLobbyService({ plans: [plan], run });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.isOpen, true);
  assert.equal(state.overallStatus, "idle");
  assert.equal(state.runId, "run-1");
  assert.equal(state.runStatus, "idle");
  assert.equal(state.currentRunPosition, 1);
  assert.equal(state.nextScheduledGame?.position, 1);
  assert.equal(state.nextScheduledGame?.scheduledGameId, null);
  assert.equal(state.nextScheduledGame?.status, "idle");
});

test("Game1LobbyService: purchase_open når scheduled-game er spawnet i purchase_open", async () => {
  const plan = makePlan();
  const run = makeRun({ status: "running", currentPosition: 1 });
  const scheduledGame = {
    id: "sg-1",
    status: "purchase_open",
    scheduled_start_time: "2026-05-08T12:00:00Z",
    scheduled_end_time: "2026-05-08T12:10:00Z",
    actual_start_time: null,
    catalog_entry_id: "gc-bingo",
  };
  const { service } = makeLobbyService({
    plans: [plan],
    run,
    scheduledGame,
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.isOpen, true);
  assert.equal(state.overallStatus, "purchase_open");
  assert.equal(state.runId, "run-1");
  assert.equal(state.runStatus, "running");
  assert.equal(state.nextScheduledGame?.scheduledGameId, "sg-1");
  assert.equal(state.nextScheduledGame?.status, "purchase_open");
  assert.equal(state.nextScheduledGame?.scheduledStartTime, "2026-05-08T12:00:00Z");
});

test("Game1LobbyService: running når scheduled-game er i running", async () => {
  const plan = makePlan();
  const run = makeRun({ status: "running", currentPosition: 1 });
  const scheduledGame = {
    id: "sg-1",
    status: "running",
    scheduled_start_time: "2026-05-08T12:00:00Z",
    scheduled_end_time: "2026-05-08T12:10:00Z",
    actual_start_time: "2026-05-08T12:01:00Z",
    catalog_entry_id: "gc-bingo",
  };
  const { service } = makeLobbyService({
    plans: [plan],
    run,
    scheduledGame,
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.overallStatus, "running");
  assert.equal(state.nextScheduledGame?.status, "running");
  assert.equal(
    state.nextScheduledGame?.actualStartTime,
    "2026-05-08T12:01:00Z",
  );
});

test("Game1LobbyService: paused-status mappes fra scheduled-game", async () => {
  const plan = makePlan();
  const run = makeRun({ status: "running", currentPosition: 1 });
  const scheduledGame = {
    id: "sg-1",
    status: "paused",
    scheduled_start_time: "2026-05-08T12:00:00Z",
    scheduled_end_time: "2026-05-08T12:10:00Z",
    actual_start_time: "2026-05-08T12:01:00Z",
    catalog_entry_id: "gc-bingo",
  };
  const { service } = makeLobbyService({
    plans: [plan],
    run,
    scheduledGame,
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.overallStatus, "paused");
  assert.equal(state.nextScheduledGame?.status, "paused");
});

test("Game1LobbyService: finished på siste position → planCompletedForToday=true + nextScheduledGame=null", async () => {
  // Plan har 2 items, run finished på position=2 (siste). Plan er HELT
  // ferdig for dagen — speiler `PLAN_COMPLETED_FOR_TODAY`-DomainError som
  // `getOrCreateForToday` kaster i samme scenario (Tobias-direktiv
  // 2026-05-14 10:17: "Plan-completed beats stengetid").
  const plan = makePlan();
  const run = makeRun({ status: "finished", currentPosition: 2 });
  const { service } = makeLobbyService({
    plans: [plan],
    run,
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.isOpen, true);
  assert.equal(state.overallStatus, "finished");
  assert.equal(state.runStatus, "finished");
  assert.equal(state.nextScheduledGame, null);
  assert.equal(state.currentRunPosition, 2);
  assert.equal(state.planCompletedForToday, true);
});

// ── Bug-fix 2026-05-14: finished + flere posisjoner igjen ─────────────
//
// Tobias-rapport 2026-05-14 13:00 (samme dag som PR #1422 landet):
//   Master-UI viser "Start neste spill — Bingo" etter at Bingo (position=1)
//   er ferdigspilt. Skal vise "1000-spill" (position=2).
//
// Root cause: Lobby-API returnerte `nextScheduledGame: null` ved finished
// plan-run (independent av om planen var helt ferdig eller bare på position 1).
// Master-UI faller tilbake til default plan-items[0] (Bingo).
//
// Fix: Når `run.status='finished'` OG `currentPosition < items.length`,
// returnerer lobby-API NESTE plan-item som `nextScheduledGame` med
// `status='idle'`. Master-klikk vil trigge `getOrCreateForToday` som
// (per PR #1422) advanc er plan-run til `previousPosition + 1`.

test("Game1LobbyService: finished på position=1 av 2 → nextScheduledGame=items[1]", async () => {
  const plan = makePlan();
  const run = makeRun({ status: "finished", currentPosition: 1 });
  const { service } = makeLobbyService({ plans: [plan], run });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.overallStatus, "finished");
  assert.equal(state.runStatus, "finished");
  assert.equal(state.planCompletedForToday, false);
  // nextScheduledGame skal peke til position=2 (Jackpot fra makePlan-default).
  assert.notEqual(state.nextScheduledGame, null);
  assert.equal(state.nextScheduledGame?.position, 2);
  assert.equal(state.nextScheduledGame?.catalogSlug, "jackpot");
  assert.equal(state.nextScheduledGame?.catalogDisplayName, "Jackpot");
  assert.equal(state.nextScheduledGame?.status, "idle");
  assert.equal(state.nextScheduledGame?.scheduledGameId, null);
});

test("Game1LobbyService: finished på position=7 av 13 → nextScheduledGame=items[8]", async () => {
  // 13-item plan (matcher pilot demo med Bingo/1000-spill/.../TV-Extra).
  // Run finished på position=7 — master har klikket gjennom 7 spill og
  // siste runde naturlig endte. Lobby skal vise spill #8 som neste.
  const items = Array.from({ length: 13 }, (_, idx) => {
    const slug = `game-${idx + 1}`;
    return {
      gameCatalogId: `gc-${slug}`,
      catalogEntry: makeCatalogEntry({
        id: `gc-${slug}`,
        slug,
        displayName: `Spill ${idx + 1}`,
      }),
    };
  });
  const plan = makePlan({}, items);
  const run = makeRun({ status: "finished", currentPosition: 7 });
  const { service } = makeLobbyService({ plans: [plan], run });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.overallStatus, "finished");
  assert.equal(state.planCompletedForToday, false);
  assert.equal(state.totalPositions, 13);
  assert.notEqual(state.nextScheduledGame, null);
  assert.equal(state.nextScheduledGame?.position, 8);
  assert.equal(state.nextScheduledGame?.catalogSlug, "game-8");
  assert.equal(state.nextScheduledGame?.catalogDisplayName, "Spill 8");
  assert.equal(state.nextScheduledGame?.status, "idle");
  assert.equal(state.nextScheduledGame?.scheduledGameId, null);
});

test("Game1LobbyService: finished på position=13 av 13 (siste) → planCompletedForToday=true", async () => {
  // 13-item plan, run finished på siste position. Plan er HELT ferdig —
  // speiler PLAN_COMPLETED_FOR_TODAY-DomainError fra getOrCreateForToday.
  const items = Array.from({ length: 13 }, (_, idx) => {
    const slug = `game-${idx + 1}`;
    return {
      gameCatalogId: `gc-${slug}`,
      catalogEntry: makeCatalogEntry({
        id: `gc-${slug}`,
        slug,
        displayName: `Spill ${idx + 1}`,
      }),
    };
  });
  const plan = makePlan({}, items);
  const run = makeRun({ status: "finished", currentPosition: 13 });
  const { service } = makeLobbyService({ plans: [plan], run });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.overallStatus, "finished");
  assert.equal(state.planCompletedForToday, true);
  assert.equal(state.nextScheduledGame, null);
  assert.equal(state.currentRunPosition, 13);
  assert.equal(state.totalPositions, 13);
});

test("Game1LobbyService: planCompletedForToday=false ved running-state", async () => {
  // Sanity: planCompletedForToday skal ALDRI være true når run kjører,
  // selv om currentPosition >= items.length (det er en logisk umulighet —
  // engine kan ikke ha vunnet siste runde uten å ha finished plan-run).
  const plan = makePlan();
  const run = makeRun({ status: "running", currentPosition: 2 });
  const scheduledGame = {
    id: "sg-1",
    status: "running",
    scheduled_start_time: "2026-05-08T12:00:00Z",
    scheduled_end_time: "2026-05-08T12:10:00Z",
    actual_start_time: "2026-05-08T12:01:00Z",
    catalog_entry_id: "gc-jackpot",
  };
  const { service } = makeLobbyService({
    plans: [plan],
    run,
    scheduledGame,
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.overallStatus, "running");
  assert.equal(state.planCompletedForToday, false);
});

test("Game1LobbyService: planCompletedForToday=false når ingen plan-run", async () => {
  // Sanity: planCompletedForToday skal være false når ingen run finnes
  // (master har ikke startet noe enda).
  const plan = makePlan();
  const { service } = makeLobbyService({ plans: [plan], run: null });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.overallStatus, "idle");
  assert.equal(state.planCompletedForToday, false);
});

test("Game1LobbyService: ugyldig hallId kaster INVALID_INPUT", async () => {
  const { service } = makeLobbyService({ plans: [], run: null });
  try {
    await service.getLobbyState("");
    assert.fail("Forventet DomainError");
  } catch (err) {
    assert.ok(err instanceof DomainError, `forventet DomainError, fikk ${err}`);
    assert.equal((err as DomainError).code, "INVALID_INPUT");
  }
});

test("Game1LobbyService: GoH-bundet plan plukker opp via medlemskap", async () => {
  // Plan er bundet til GoH "goh-pilot", ikke direkte til hall-1.
  const planForGoh = makePlan({
    hallId: null,
    groupOfHallsId: "goh-pilot",
  });
  const { service } = makeLobbyService({
    plans: [planForGoh],
    run: null,
    goHIds: ["goh-pilot"],
  });
  const state = await service.getLobbyState("hall-1", fridayAt1400Oslo());

  assert.equal(state.isOpen, true);
  assert.equal(state.overallStatus, "idle");
  assert.equal(state.planId, "gp-1");
});

test("Game1LobbyService: weekday-mismatch returnerer closed", async () => {
  // Plan dekker kun mandag-fredag, og 2026-05-09 er en lørdag.
  const plan = makePlan({
    weekdays: ["mon", "tue", "wed", "thu", "fri"],
  });
  // Lørdag 2026-05-09 14:00 Oslo = 12:00 UTC.
  const saturdayAt1400 = new Date("2026-05-09T12:00:00Z");
  const { service } = makeLobbyService({ plans: [plan], run: null });
  const state = await service.getLobbyState("hall-1", saturdayAt1400);

  assert.equal(state.isOpen, false);
  assert.equal(state.overallStatus, "closed");
  // Weekday mismatch → ingen plan-info eksponeres (defensivt: vi vet ikke
  // hvilken plan kunden skal se hvis flere planer er konfigurert).
  assert.equal(state.openingTimeStart, null);
});

test("Game1LobbyService: idle ved kanten av åpningstid (kl 11:00)", async () => {
  const plan = makePlan();
  // Akkurat 11:00 Oslo = 09:00 UTC i sommertid.
  const elevenSharp = new Date("2026-05-08T09:00:00Z");
  const { service } = makeLobbyService({ plans: [plan], run: null });
  const state = await service.getLobbyState("hall-1", elevenSharp);

  // 11:00 inkluderes (start <= now < end).
  assert.equal(state.isOpen, true);
  assert.equal(state.overallStatus, "idle");
});

test("Game1LobbyService: closed ved endTime (kl 21:00 sharp)", async () => {
  const plan = makePlan();
  // 21:00 Oslo = 19:00 UTC sommertid.
  const twentyOneSharp = new Date("2026-05-08T19:00:00Z");
  const { service } = makeLobbyService({ plans: [plan], run: null });
  const state = await service.getLobbyState("hall-1", twentyOneSharp);

  // 21:00 ekskluderes (now < end).
  assert.equal(state.isOpen, false);
  assert.equal(state.overallStatus, "closed");
});
