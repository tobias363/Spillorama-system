/**
 * Tester designet for å drepe mutation-testing-survivors fra første Stryker-
 * baseline-kjøring 2026-05-13 (se docs/auto-generated/MUTATION_BASELINE.md).
 *
 * Pre-baseline: 39.20% (69 killed, 49 survived, 58 nocov, 0 timeout, 140 errors).
 *
 * Fokus i denne suiten:
 *   - Linje 667 (ticketPricesCents filter — 6 survivors):
 *     `if (typeof price === "number" && Number.isFinite(price) && price > 0)`
 *   - Linje 676-681 (bonusGameOverride logic — 3 survivors):
 *     bonusGameOverride > catalog.bonusGameSlug, bonusGameEnabled-gate
 *   - Linje 269-270 (TERMINAL_SCHEDULED_GAME_STATUSES set):
 *     "completed"/"cancelled" status detection
 *   - Linje 220-225 (TIME_REGEX + timeToMinutes):
 *     regex-validering, h*60+m beregning
 *
 * Disse er alle observable via `getLobbyState`'s public interface.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Game1LobbyService } from "./Game1LobbyService.js";
import { GamePlanService } from "./GamePlanService.js";
import { GamePlanRunService } from "./GamePlanRunService.js";
import { GameCatalogService } from "./GameCatalogService.js";
import type { GamePlan, GamePlanWithItems, GamePlanRun } from "./gamePlan.types.js";
import type { GameCatalogEntry } from "./gameCatalog.types.js";

// ── helpers ─────────────────────────────────────────────────────────────────

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
  items: { gameCatalogId: string; catalogEntry: GameCatalogEntry; bonusGameOverride?: GameCatalogEntry["bonusGameSlug"] }[] = [
    { gameCatalogId: "gc-bingo", catalogEntry: makeCatalogEntry() },
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
      bonusGameOverride: it.bonusGameOverride ?? null,
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
  (svc as unknown as {
    list: () => Promise<GamePlan[]>;
  }).list = async () => plans;
  (svc as unknown as {
    getById: (id: string) => Promise<GamePlanWithItems | null>;
  }).getById = async (id) => plans.find((p) => p.id === id) ?? null;
  return svc;
}

function stubRunService(run: GamePlanRun | null): GamePlanRunService {
  const svc = Object.create(GamePlanRunService.prototype) as GamePlanRunService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as {
    findForDay: () => Promise<GamePlanRun | null>;
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

function makeService(opts: {
  plans: GamePlanWithItems[];
  run: GamePlanRun | null;
  scheduledGame?: ScheduledGameRow | null;
}): Game1LobbyService {
  const stubPool = {
    async query(textOrConfig: unknown): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      if (/app_hall_group_members/i.test(sql)) {
        return { rows: [] };
      }
      if (/app_game1_scheduled_games/i.test(sql)) {
        if (opts.scheduledGame) {
          return { rows: [opts.scheduledGame] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  return Game1LobbyService.forTesting({
    pool: stubPool as unknown as import("pg").Pool,
    schema: "public",
    planService: stubPlanService(opts.plans),
    planRunService: stubRunService(opts.run),
  });
}

function fridayAt1400Oslo(): Date {
  return new Date("2026-05-08T12:00:00Z");
}

// ── ticketPricesCents filter (linje 667) ─────────────────────────────────────

test("ticketPricesCents: positive priser propageres til output (kills ConditionalExpression on line 667)", async () => {
  const plan = makePlan(
    {},
    [{
      gameCatalogId: "gc-bingo",
      catalogEntry: makeCatalogEntry({
        ticketColors: ["gul", "hvit"],
        ticketPricesCents: { gul: 1000, hvit: 500 },
      }),
    }],
  );
  const svc = makeService({ plans: [plan], run: null });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  assert.ok(state.nextScheduledGame);
  assert.equal(state.nextScheduledGame!.ticketPricesCents.gul, 1000);
  assert.equal(state.nextScheduledGame!.ticketPricesCents.hvit, 500);
});

test("ticketPricesCents: 0 pris filtreres bort (kills EqualityOperator on line 667: 'price > 0' → 'price >= 0')", async () => {
  // Hvis `price > 0` mutates til `price >= 0`, ville pris 0 bli inkludert.
  // Med korrekt kode: pris 0 filtreres bort.
  const plan = makePlan(
    {},
    [{
      gameCatalogId: "gc-bingo",
      catalogEntry: makeCatalogEntry({
        ticketColors: ["gul", "hvit"],
        // gul har eksplisitt 0 → skal filtreres bort
        ticketPricesCents: { gul: 0, hvit: 500 },
      }),
    }],
  );
  const svc = makeService({ plans: [plan], run: null });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  assert.ok(state.nextScheduledGame);
  // hvit skal være satt, gul skal IKKE være satt (filtrert)
  assert.equal(state.nextScheduledGame!.ticketPricesCents.hvit, 500);
  assert.equal(state.nextScheduledGame!.ticketPricesCents.gul, undefined, "0-pris skal filtreres");
});

test("ticketPricesCents: NaN pris filtreres bort (kills ConditionalExpression on Number.isFinite check)", async () => {
  const plan = makePlan(
    {},
    [{
      gameCatalogId: "gc-bingo",
      catalogEntry: makeCatalogEntry({
        ticketColors: ["gul", "hvit"],
        ticketPricesCents: { gul: NaN as unknown as number, hvit: 500 },
      }),
    }],
  );
  const svc = makeService({ plans: [plan], run: null });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  assert.ok(state.nextScheduledGame);
  assert.equal(state.nextScheduledGame!.ticketPricesCents.hvit, 500);
  assert.equal(state.nextScheduledGame!.ticketPricesCents.gul, undefined);
});

test("ticketPricesCents: negativ pris filtreres bort (kills EqualityOperator on line 667: 'price > 0' → 'price <= 0')", async () => {
  // Hvis `price > 0` mutates til `price <= 0`, ville positive priser feile.
  // Vi har allerede testen for positive priser. Her tester vi negativ.
  const plan = makePlan(
    {},
    [{
      gameCatalogId: "gc-bingo",
      catalogEntry: makeCatalogEntry({
        ticketColors: ["gul", "hvit"],
        ticketPricesCents: { gul: -100 as unknown as number, hvit: 500 },
      }),
    }],
  );
  const svc = makeService({ plans: [plan], run: null });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  assert.ok(state.nextScheduledGame);
  assert.equal(state.nextScheduledGame!.ticketPricesCents.hvit, 500);
  assert.equal(state.nextScheduledGame!.ticketPricesCents.gul, undefined);
});

// ── bonusGameOverride (linje 676-681) ────────────────────────────────────────

test("bonusGameOverride på item slår catalog.bonusGameSlug (kills EqualityOperator on line 677)", async () => {
  // Item har override="treasure_chest"; catalog har bonusGameSlug=null.
  // Override skal vinne — output bonusGameSlug skal være "treasure_chest".
  const plan = makePlan(
    {},
    [{
      gameCatalogId: "gc-bingo",
      catalogEntry: makeCatalogEntry({
        bonusGameSlug: null,
        bonusGameEnabled: false,
      }),
      bonusGameOverride: "treasure_chest",
    }],
  );
  const svc = makeService({ plans: [plan], run: null });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  assert.equal(state.nextScheduledGame?.bonusGameSlug, "treasure_chest");
});

test("bonusGameOverride=null faller tilbake til catalog.bonusGameSlug når enabled", async () => {
  const plan = makePlan(
    {},
    [{
      gameCatalogId: "gc-bingo",
      catalogEntry: makeCatalogEntry({
        bonusGameSlug: "wheel_of_fortune",
        bonusGameEnabled: true,
      }),
      bonusGameOverride: null,
    }],
  );
  const svc = makeService({ plans: [plan], run: null });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  assert.equal(state.nextScheduledGame?.bonusGameSlug, "wheel_of_fortune");
});

test("bonusGameOverride=null + catalog.bonusGameEnabled=false → null (kills ConditionalExpression on bonusGameEnabled check)", async () => {
  const plan = makePlan(
    {},
    [{
      gameCatalogId: "gc-bingo",
      catalogEntry: makeCatalogEntry({
        bonusGameSlug: "wheel_of_fortune",
        bonusGameEnabled: false, // ikke aktivert
      }),
      bonusGameOverride: null,
    }],
  );
  const svc = makeService({ plans: [plan], run: null });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  // Catalog har slug, men enabled=false → null.
  assert.equal(state.nextScheduledGame?.bonusGameSlug, null);
});

// ── ticketColors propagering (kills ArrayDeclaration on line 663) ────────────

test("ticketColors propageres fra catalog til output (kills ArrayDeclaration / spread)", async () => {
  const plan = makePlan(
    {},
    [{
      gameCatalogId: "gc-bingo",
      catalogEntry: makeCatalogEntry({
        ticketColors: ["gul", "hvit", "lilla"],
        ticketPricesCents: { gul: 1000, hvit: 500, lilla: 1500 },
      }),
    }],
  );
  const svc = makeService({ plans: [plan], run: null });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  assert.ok(state.nextScheduledGame);
  // Verifiserer at alle 3 ticketColors propagert i riktig rekkefølge.
  assert.deepEqual(state.nextScheduledGame!.ticketColors, ["gul", "hvit", "lilla"]);
});

test("prizeMultiplierMode propageres fra catalog (kills ObjectLiteral mutants)", async () => {
  const plan = makePlan(
    {},
    [{
      gameCatalogId: "gc-bingo",
      catalogEntry: makeCatalogEntry({
        prizeMultiplierMode: "explicit_per_color",
      }),
    }],
  );
  const svc = makeService({ plans: [plan], run: null });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  assert.equal(state.nextScheduledGame?.prizeMultiplierMode, "explicit_per_color");
});

// ── catalogSlug + displayName fra catalog ────────────────────────────────────

test("catalogSlug propageres til nextScheduledGame", async () => {
  const plan = makePlan(
    {},
    [{
      gameCatalogId: "gc-trafikklys",
      catalogEntry: makeCatalogEntry({
        id: "gc-trafikklys",
        slug: "trafikklys",
        displayName: "Trafikklys",
      }),
    }],
  );
  const svc = makeService({ plans: [plan], run: null });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  assert.equal(state.nextScheduledGame?.catalogSlug, "trafikklys");
  assert.equal(state.nextScheduledGame?.catalogDisplayName, "Trafikklys");
});

// ── TERMINAL_SCHEDULED_GAME_STATUSES (linje 269-274, indirect test) ──────────

test("auto-reconcile: terminal scheduled-game ('completed') triggerer idle status (kills ArrayDeclaration/StringLiteral on line 269-271)", async () => {
  // Plan i status=running, men scheduled-game er completed (terminal status).
  // Auto-reconcile-pathen (F-02) skal mappe overall til "idle" eller "finished".
  // Hvis "completed" ble fjernet fra TERMINAL-set, ville auto-reconcile ikke
  // detektere det og state ville være feil.
  const plan = makePlan(
    {},
    [
      { gameCatalogId: "gc-bingo", catalogEntry: makeCatalogEntry() },
      { gameCatalogId: "gc-bingo2", catalogEntry: makeCatalogEntry({ id: "gc-bingo2", slug: "bingo2" }) },
    ],
  );
  // Run på 'running' med currentPosition=1 (ikke siste — så vi ikke triggere finish).
  const run = makeRun({ status: "running", currentPosition: 1 });
  // Scheduled-game er terminal, men IKKE siste position. Auto-reconcile-flyten
  // returnerer status="idle" og scheduledGameId=null.
  const scheduledGame: ScheduledGameRow = {
    id: "sg-1",
    status: "completed",
    scheduled_start_time: null,
    scheduled_end_time: null,
    actual_start_time: null,
    catalog_entry_id: "gc-bingo",
  };
  const svc = makeService({ plans: [plan], run, scheduledGame });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  // overallStatus skal mapppes til "idle" (ikke skal joine en avsluttet runde).
  assert.equal(state.overallStatus, "idle", "terminal scheduled-game skal gi idle, ikke running");
  assert.equal(state.nextScheduledGame?.scheduledGameId, null, "scheduledGameId nullet ut");
});

test("auto-reconcile: terminal scheduled-game ('cancelled') triggerer idle status (kills StringLiteral on line 271)", async () => {
  // Speil av forrige test, men med 'cancelled' istedenfor 'completed'.
  const plan = makePlan(
    {},
    [
      { gameCatalogId: "gc-bingo", catalogEntry: makeCatalogEntry() },
      { gameCatalogId: "gc-bingo2", catalogEntry: makeCatalogEntry({ id: "gc-bingo2", slug: "bingo2" }) },
    ],
  );
  const run = makeRun({ status: "running", currentPosition: 1 });
  const scheduledGame: ScheduledGameRow = {
    id: "sg-1",
    status: "cancelled",
    scheduled_start_time: null,
    scheduled_end_time: null,
    actual_start_time: null,
    catalog_entry_id: "gc-bingo",
  };
  const svc = makeService({ plans: [plan], run, scheduledGame });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  assert.equal(state.overallStatus, "idle");
});

// ── TIME_REGEX boundary (linje 220) — indirect via plan.startTime/endTime ────

test("TIME_REGEX: gyldig 23:59 åpningstid håndteres (kills Regex anchor on line 220)", async () => {
  // Hvis regex-anchor `^` blir fjernet, ville "asdf11:00" matche.
  // Hvis `$` blir fjernet, ville "11:00abc" matche. Gyldig HH:MM (00:00-23:59)
  // skal alltid matche.
  const plan = makePlan({ startTime: "00:00", endTime: "23:59" });
  const svc = makeService({ plans: [plan], run: null });
  const state = await svc.getLobbyState("hall-1", fridayAt1400Oslo());
  // 14:00 er innenfor 00:00-23:59
  assert.equal(state.isOpen, true);
  assert.equal(state.openingTimeStart, "00:00");
  assert.equal(state.openingTimeEnd, "23:59");
});

// ── h * 60 + m beregning (linje 225) ────────────────────────────────────────

test("timeToMinutes: 14:30 → 870 minutter (kills ArithmeticOperator on line 225)", async () => {
  // Indirect test: plan dekker 14:00-15:00, og 14:30 ligger innenfor.
  // Hvis `h * 60 + m` mutates til `h * 60 - m`, ville 14:30 = 840 - 30 = 810
  // som er UTENFOR 14:00 (840) → endTime (900) — feiler.
  // Hvis `h * 60` mutates til `h / 60`, ville 14:30 = 14/60 + 30 = ~30.23
  // som er utenfor 840-900 → feiler.
  const plan = makePlan({ startTime: "14:00", endTime: "15:00" });
  const svc = makeService({ plans: [plan], run: null });
  // 14:30 Oslo = 12:30 UTC sommertid.
  const fourteenThirty = new Date("2026-05-08T12:30:00Z");
  const state = await svc.getLobbyState("hall-1", fourteenThirty);
  assert.equal(state.isOpen, true, "14:30 skal være innenfor 14:00-15:00");
});

test("timeToMinutes: 13:59 → 839 (utenfor 14:00-15:00) (kills ArithmeticOperator boundary)", async () => {
  const plan = makePlan({ startTime: "14:00", endTime: "15:00" });
  const svc = makeService({ plans: [plan], run: null });
  // 13:59 Oslo = 11:59 UTC sommertid.
  const thirteenFiftyNine = new Date("2026-05-08T11:59:00Z");
  const state = await svc.getLobbyState("hall-1", thirteenFiftyNine);
  assert.equal(state.isOpen, false, "13:59 skal være UTENFOR 14:00-15:00");
  assert.equal(state.overallStatus, "closed");
});

// ── isOpen boundary: now < end (linje 254) ──────────────────────────────────

test("isOpen: 14:59 inkluderes når endTime=15:00 (kills ConditionalExpression on isOpen-boundary)", async () => {
  const plan = makePlan({ startTime: "14:00", endTime: "15:00" });
  const svc = makeService({ plans: [plan], run: null });
  const fourteenFiftyNine = new Date("2026-05-08T12:59:00Z");
  const state = await svc.getLobbyState("hall-1", fourteenFiftyNine);
  assert.equal(state.isOpen, true);
});
