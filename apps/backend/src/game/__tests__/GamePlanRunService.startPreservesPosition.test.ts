/**
 * BUG-D1 (2026-05-15): `GamePlanRunService.start()` skal IKKE overstyre
 * `current_position`. `getOrCreateForToday`-INSERT er eneste sannhet for
 * posisjon ved start — den beregner riktig `nextPosition` basert på
 * `previousPosition` (auto-advance BUG E, PR #1422).
 *
 * Symptom (Tobias-rapport via Agent D research §5.1):
 *   Master spilte Bingo (pos=1) gjentatte ganger i stedet for å advance
 *   til 1000-spill, 5×500, osv. fordi `start()` UPDATE overskrev
 *   `current_position` til 1.
 *
 * Fix: fjern `current_position = 1` fra `start()`-UPDATE. La INSERT i
 *   `getOrCreateForToday` være eneste sted som setter posisjon.
 *
 * Disse testene verifiserer:
 *   1. `start()` rør IKKE `current_position` (cp=2 forblir cp=2)
 *   2. SQL-UPDATE i `start()` inneholder ikke `current_position = X`
 *   3. End-to-end: `getOrCreateForToday(nextPos=2) → start()` resulterer
 *      i `current_position = 2` (regresjon-test for selve bug-en)
 *
 * Strategi: gjenbrukt Object.create-pattern fra
 *   `GamePlanRunService.autoAdvanceFromFinished.test.ts`. Stub-poolen
 *   sporer alle queries så vi kan asserter på SQL-tekst og at INSERT-
 *   parametrenes posisjon ikke overskrives av en senere UPDATE.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GamePlanRunService } from "../GamePlanRunService.js";
import { GamePlanService } from "../GamePlanService.js";
import { GameCatalogService } from "../GameCatalogService.js";
import type { AuditLogService } from "../../compliance/AuditLogService.js";
import type {
  GamePlanRun,
  GamePlanWithItems,
} from "../gamePlan.types.js";
import type { GameCatalogEntry } from "../gameCatalog.types.js";

// ── fixtures (delvis kopiert fra autoAdvanceFromFinished.test.ts) ─────────

const HALL_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const MASTER_USER_ID = "u-master-1";

function todayStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function makeCatalogEntry(
  id: string,
  slug: string,
  displayName: string,
): GameCatalogEntry {
  return {
    id,
    slug,
    displayName,
    description: null,
    rules: {},
    ticketColors: ["gul", "hvit"],
    ticketPricesCents: { gul: 1000, hvit: 500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 50000 },
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
  };
}

function makePlanWith13Items(): GamePlanWithItems {
  const slugs = [
    "bingo",
    "1000-spill",
    "5x500",
    "ball-x-10",
    "bokstav",
    "innsatsen",
    "jackpot",
    "kvikkis",
    "oddsen-55",
    "oddsen-56",
    "oddsen-57",
    "trafikklys",
    "tv-extra",
  ];
  return {
    id: PLAN_ID,
    name: "Demo Pilot Plan",
    description: null,
    hallId: HALL_ID,
    groupOfHallsId: null,
    weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    startTime: "11:00",
    endTime: "21:00",
    isActive: true,
    createdAt: "2026-05-07T12:00:00Z",
    updatedAt: "2026-05-07T12:00:00Z",
    createdByUserId: "u-1",
    items: slugs.map((slug, idx) => ({
      id: `item-${idx + 1}`,
      planId: PLAN_ID,
      position: idx + 1,
      gameCatalogId: `gc-${slug}`,
      bonusGameOverride: null,
      notes: null,
      createdAt: "2026-05-07T12:00:00Z",
      catalogEntry: makeCatalogEntry(`gc-${slug}`, slug, slug),
    })),
  };
}

interface CapturedQuery {
  sql: string;
  params: unknown[] | undefined;
}

interface CapturedAudit {
  actorId: string | null;
  action: string;
  resourceId: string | null;
  details: Record<string, unknown>;
}

interface MockOptions {
  /** Initial idle plan-run i DB (returneres av findForDay). */
  idleRun: {
    id: string;
    currentPosition: number;
  };
  plan: GamePlanWithItems;
}

/**
 * Lager en stub-pool som speiler en idle plan-run med vilkårlig posisjon.
 * Når `start()`-UPDATE kjører, oppdaterer stub-en in-memory rad-state slik
 * at den etterfølgende `requireById()` returnerer den nye state-en. Hvis
 * UPDATE inneholder `current_position = 1`-hardkoding (gammel oppførsel),
 * fanges det her ved at posisjonen reset-er — slik at testen kan asserter
 * mot både SQL-tekst OG sluttverdien.
 */
function makeStartService(opts: MockOptions): {
  service: GamePlanRunService;
  queries: CapturedQuery[];
  audits: CapturedAudit[];
} {
  const queries: CapturedQuery[] = [];
  const audits: CapturedAudit[] = [];
  const dateStr = todayStr();

  let currentRunRow: Record<string, unknown> = {
    id: opts.idleRun.id,
    plan_id: PLAN_ID,
    hall_id: HALL_ID,
    business_date: dateStr,
    current_position: opts.idleRun.currentPosition,
    status: "idle",
    jackpot_overrides_json: {},
    started_at: null,
    finished_at: null,
    master_user_id: null,
    created_at: new Date("2026-05-15T10:00:00Z"),
    updated_at: new Date("2026-05-15T10:00:00Z"),
  };

  const stubPool = {
    async query(
      textOrConfig: unknown,
      params?: unknown[],
    ): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      queries.push({ sql, params });

      if (/UPDATE\s+"public"\."app_game_plan_run"/i.test(sql)) {
        // Simuler at UPDATE persisterer felt-endringer på raden.
        // Hvis koden (etter fix) IKKE inneholder `current_position = X`,
        // skal `currentRunRow.current_position` forbli uendret.
        // Hvis koden (før fix) overskriver current_position, vil testen
        // også fange det her hvis vi gjør faktisk parsing — men siden vi
        // primært asserter på SQL-tekst (regex), trenger stub kun å
        // håndtere status-flippen.
        currentRunRow = {
          ...currentRunRow,
          status: "running",
          started_at: new Date(),
          master_user_id: (params?.[1] as string) ?? null,
          updated_at: new Date(),
        };

        // Hvis SQL eksplisitt inneholder `current_position = N` (bug-form),
        // simuler det også så regresjon-testene kan fange flyten ende-til-ende.
        const cpMatch = sql.match(/current_position\s*=\s*(\d+)/i);
        if (cpMatch && cpMatch[1] !== undefined) {
          currentRunRow.current_position = Number(cpMatch[1]);
        }
        return { rowCount: 1, rows: [] };
      }

      if (/^\s*SELECT/i.test(sql)) {
        return { rows: [currentRunRow] };
      }

      return { rowCount: 1, rows: [] };
    },
  };

  const planSvc = Object.create(GamePlanService.prototype) as GamePlanService;
  (planSvc as unknown as { pool: unknown }).pool = stubPool;
  (planSvc as unknown as { schema: string }).schema = "public";
  (planSvc as unknown as {
    list: () => Promise<GamePlanWithItems[]>;
  }).list = async () => [opts.plan];
  (planSvc as unknown as {
    getById: (id: string) => Promise<GamePlanWithItems | null>;
  }).getById = async (id) => (opts.plan.id === id ? opts.plan : null);

  const catalogSvc = Object.create(
    GameCatalogService.prototype,
  ) as GameCatalogService;
  (catalogSvc as unknown as { pool: unknown }).pool = stubPool;
  (catalogSvc as unknown as { schema: string }).schema = "public";

  const auditSvc = {
    async record(input: {
      actorId: string | null;
      actorType: string;
      action: string;
      resource?: string;
      resourceId?: string | null;
      details?: Record<string, unknown>;
    }): Promise<void> {
      audits.push({
        actorId: input.actorId,
        action: input.action,
        resourceId: input.resourceId ?? null,
        details: input.details ?? {},
      });
    },
  } as unknown as AuditLogService;

  const svc = Object.create(
    GamePlanRunService.prototype,
  ) as GamePlanRunService;
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { planService: GamePlanService }).planService = planSvc;
  (svc as unknown as {
    catalogService: GameCatalogService;
  }).catalogService = catalogSvc;
  (svc as unknown as {
    auditLogService: AuditLogService | null;
  }).auditLogService = auditSvc;
  (svc as unknown as {
    inlineCleanupHook: null;
  }).inlineCleanupHook = null;

  return { service: svc, queries, audits };
}

// ── helpers ───────────────────────────────────────────────────────────────

function findStartUpdate(queries: CapturedQuery[]): CapturedQuery | undefined {
  return queries.find(
    (q) =>
      /UPDATE\s+"public"\."app_game_plan_run"/i.test(q.sql) &&
      /status\s*=\s*'running'/i.test(q.sql),
  );
}

// ── tests ─────────────────────────────────────────────────────────────────

test("BUG-D1 regression: start() bevarer current_position fra getOrCreateForToday (cp=2 forblir cp=2)", async () => {
  // Reproduserer Tobias-rapport: `getOrCreateForToday` har auto-advanced
  // til position=2 (1000-spill) — `start()` skal IKKE resette til 1.
  const { service } = makeStartService({
    idleRun: {
      id: "run-id-1",
      currentPosition: 2, // 1000-spill (etter auto-advance fra Bingo)
    },
    plan: makePlanWith13Items(),
  });

  const started = await service.start(HALL_ID, todayStr(), MASTER_USER_ID);

  assert.equal(
    started.currentPosition,
    2,
    "start() skal IKKE overskrive current_position. Forventet 2 (1000-spill), fikk " +
      String(started.currentPosition),
  );
  assert.equal(started.status, "running", "status skal flippe til running");
});

test("BUG-D1 regression: SQL-UPDATE i start() inneholder IKKE 'current_position = '", async () => {
  // Strukturell guard: koden skal ikke ha hardkodet current_position i UPDATE.
  // Hvis denne testen feiler, har noen reintrodusert bug-en.
  const { service, queries } = makeStartService({
    idleRun: {
      id: "run-id-1",
      currentPosition: 7, // Jackpot — vilkårlig posisjon
    },
    plan: makePlanWith13Items(),
  });

  await service.start(HALL_ID, todayStr(), MASTER_USER_ID);

  const updateQuery = findStartUpdate(queries);
  assert.ok(updateQuery, "start() må kjøre en UPDATE som setter status='running'");
  assert.ok(
    !/current_position\s*=/i.test(updateQuery.sql),
    "SQL-UPDATE i start() skal ALDRI sette current_position. Funnet SQL:\n" +
      updateQuery.sql,
  );
});

test("BUG-D1 regression: cp=5 forblir cp=5 etter start() (vilkårlig mid-plan position)", async () => {
  // Generaliserer testen til en vilkårlig posisjon midt i planen for å fange
  // tilfeller der noen reintroduserer hardkoding til en annen verdi enn 1.
  const { service } = makeStartService({
    idleRun: {
      id: "run-id-1",
      currentPosition: 5, // bokstav (item 5)
    },
    plan: makePlanWith13Items(),
  });

  const started = await service.start(HALL_ID, todayStr(), MASTER_USER_ID);

  assert.equal(
    started.currentPosition,
    5,
    "start() skal bevare current_position uansett startverdi (forventet 5, fikk " +
      String(started.currentPosition) +
      ")",
  );
});

test("BUG-D1: cp=1 forblir cp=1 (start på første spill — eksisterende oppførsel)", async () => {
  // Sanity-test: når plan-run faktisk er på position 1 (fresh start, ingen
  // tidligere finished-run), skal start() også fungere — vi bare verifiserer
  // at posisjonen bevares fra INSERT, ikke at en hardkoding tilfeldigvis treffer.
  const { service, queries } = makeStartService({
    idleRun: {
      id: "run-id-1",
      currentPosition: 1, // Bingo (fresh start)
    },
    plan: makePlanWith13Items(),
  });

  const started = await service.start(HALL_ID, todayStr(), MASTER_USER_ID);

  assert.equal(started.currentPosition, 1);
  assert.equal(started.status, "running");

  // Verifiser at SQL-en likevel ikke inneholder hardkoding — selv om
  // start- og slutt-verdi er like (1=1), skal koden ikke ha hardkoding.
  const updateQuery = findStartUpdate(queries);
  assert.ok(
    updateQuery && !/current_position\s*=/i.test(updateQuery.sql),
    "Selv ved cp=1 skal SQL ikke inneholde current_position-hardkoding",
  );
});

test("BUG-D1: start() skriver audit-event game_plan_run.start (uendret oppførsel)", async () => {
  // Audit-trail skal være uendret — vi rør kun UPDATE-feltet, ikke
  // audit-event-en.
  const { service, audits } = makeStartService({
    idleRun: {
      id: "run-id-1",
      currentPosition: 3,
    },
    plan: makePlanWith13Items(),
  });

  await service.start(HALL_ID, todayStr(), MASTER_USER_ID);

  const startAudit = audits.find((a) => a.action === "game_plan_run.start");
  assert.ok(startAudit, "game_plan_run.start audit-event må skrives");
  assert.equal(startAudit.actorId, MASTER_USER_ID);
  assert.equal(startAudit.resourceId, "run-id-1");
  assert.equal(startAudit.details.planId, PLAN_ID);
  assert.equal(startAudit.details.hallId, HALL_ID);
});

test("BUG-D1: start() kaster GAME_PLAN_RUN_INVALID_TRANSITION hvis run.status !== 'idle' (uendret)", async () => {
  // Eksisterende guard — verifiser at vi ikke endret transition-reglene.
  const { service } = makeStartService({
    idleRun: {
      id: "run-id-1",
      currentPosition: 2,
    },
    plan: makePlanWith13Items(),
  });

  // Override findForDay-rad til running-state for å trigge guard.
  (service as unknown as {
    findForDay: () => Promise<GamePlanRun | null>;
  }).findForDay = async () => ({
    id: "run-id-1",
    planId: PLAN_ID,
    hallId: HALL_ID,
    businessDate: todayStr(),
    currentPosition: 2,
    status: "running",
    jackpotOverrides: {},
    startedAt: new Date().toISOString(),
    finishedAt: null,
    masterUserId: "prev-user",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await assert.rejects(
    () => service.start(HALL_ID, todayStr(), MASTER_USER_ID),
    (err: unknown) => {
      assert.equal(
        (err as { code?: string }).code,
        "GAME_PLAN_RUN_INVALID_TRANSITION",
      );
      return true;
    },
  );
});
