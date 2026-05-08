/**
 * Pilot-fix 2026-05-08: GoH-baserte planer i `getOrCreateForToday`.
 *
 * Bug: `GamePlanRunService.getOrCreateForToday` matchet kun planer der
 * `plan.hallId === hall`. Tobias' pilot-plan er GoH-bundet
 * (`hallId=null, groupOfHallsId='06b1c6ce-...'`) som førte til at hver
 * agent-poll på `/api/agent/game-plan/current` traff `NO_MATCHING_PLAN`,
 * og master-UI kunne ikke starte runden.
 *
 * Fix: ny helper `findGoHIdsForHall` som henter alle aktive
 * `app_hall_groups`-medlemskap for hallen, og utvidet `planService.list`
 * til å akseptere `groupOfHallsIds: string[]` som OR-es med `hallId`.
 *
 * Disse testene verifiserer:
 *   - Direkte hall-matching fortsatt fungerer (regresjon).
 *   - GoH-matching plukker plan med `hallId=null, groupOfHallsId=GoH`.
 *   - GoH-IDer som hall IKKE er medlem av blir ikke matchet.
 *   - Ukedags-filter fortsatt håndheves uavhengig av binding-type.
 *   - Når både direkte og GoH-plan dekker dagen, første sortert vinner.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GamePlanRunService } from "../GamePlanRunService.js";
import { GamePlanService } from "../GamePlanService.js";
import { GameCatalogService } from "../GameCatalogService.js";
import { DomainError } from "../../errors/DomainError.js";
import type {
  GamePlanRun,
  GamePlanWithItems,
  ListGamePlanFilter,
} from "../gamePlan.types.js";
import type { GameCatalogEntry } from "../gameCatalog.types.js";

// ── helpers ──────────────────────────────────────────────────────────────

interface CapturedQuery {
  sql: string;
  params: unknown[] | undefined;
}

function todayStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function todayWeekday(): string {
  const d = new Date();
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d.getDay()];
}

function makeCatalogEntry(
  overrides: Partial<GameCatalogEntry> = {},
): GameCatalogEntry {
  return {
    id: "gc-1",
    slug: "innsatsen",
    displayName: "Innsatsen",
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
  const catalog = makeCatalogEntry({ id: "gc-1" });
  return {
    id: overrides.id,
    name: overrides.name ?? `Plan-${overrides.id}`,
    description: null,
    hallId: overrides.hallId ?? null,
    groupOfHallsId: overrides.groupOfHallsId ?? null,
    weekdays:
      overrides.weekdays ??
      (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).slice(),
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
    ],
  };
}

interface GoHTestCtx {
  service: GamePlanRunService;
  queries: CapturedQuery[];
  /** Filtere som planService.list ble kalt med (sist først). */
  listFilters: ListGamePlanFilter[];
}

/**
 * Bygg en service-instans der:
 *   - `pool.query` returnerer `goHIdsForHall` på SELECT-mønsteret som
 *     `findGoHIdsForHall` bruker (FROM ... app_hall_group_members ...).
 *   - andre SELECT (findForDay) returnerer `existingRunRow` eller [].
 *   - `INSERT INTO ... app_game_plan_run` simuleres som suksess + setter
 *     en ny runRow så neste findForDay finner den.
 *   - `planService.list(filter)` filtrerer den injiserte plan-listen
 *     etter (hallId, groupOfHallsIds, isActive) — speiler den ekte
 *     SQL-semantikken med OR.
 */
function makeRunService(opts: {
  goHIdsForHall: string[];
  plans: GamePlanWithItems[];
  /** Hvis satt, returnerer findForDay denne raden (eksisterende run). */
  existingRunRow?: Record<string, unknown> | null;
}): GoHTestCtx {
  const queries: CapturedQuery[] = [];
  const listFilters: ListGamePlanFilter[] = [];
  let runRow: Record<string, unknown> | null = opts.existingRunRow ?? null;

  const stubPool = {
    async query(textOrConfig: unknown, params?: unknown[]): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      queries.push({ sql, params });

      // findGoHIdsForHall mønster
      if (/app_hall_group_members/i.test(sql)) {
        return {
          rows: opts.goHIdsForHall.map((id) => ({ group_id: id })),
        };
      }

      // INSERT inn i plan_run
      if (/INSERT INTO\s+"public"\."app_game_plan_run"/i.test(sql)) {
        if (params && Array.isArray(params)) {
          runRow = {
            id: params[0] as string,
            plan_id: params[1] as string,
            hall_id: params[2] as string,
            business_date: params[3] as string,
            current_position: 1,
            status: "idle",
            jackpot_overrides_json: {},
            started_at: null,
            finished_at: null,
            master_user_id: null,
            created_at: new Date(),
            updated_at: new Date(),
          };
        }
        return { rowCount: 1, rows: [] };
      }

      // findForDay / requireById SELECT
      if (/^\s*SELECT/i.test(sql)) {
        if (runRow) return { rows: [runRow] };
        return { rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
  };

  // GameCatalogService stub
  const catalogSvc = Object.create(
    GameCatalogService.prototype,
  ) as GameCatalogService;
  (catalogSvc as unknown as { pool: unknown }).pool = stubPool;
  (catalogSvc as unknown as { schema: string }).schema = "public";
  (catalogSvc as unknown as { auditLogService: null }).auditLogService = null;
  (catalogSvc as unknown as {
    getById: (id: string) => Promise<GameCatalogEntry | null>;
  }).getById = async () => null;

  // GamePlanService stub — emulerer ekte filter-semantikk
  const planSvc = Object.create(GamePlanService.prototype) as GamePlanService;
  (planSvc as unknown as { pool: unknown }).pool = stubPool;
  (planSvc as unknown as { schema: string }).schema = "public";
  (planSvc as unknown as { auditLogService: null }).auditLogService = null;
  (planSvc as unknown as {
    catalogService: GameCatalogService;
  }).catalogService = catalogSvc;
  (planSvc as unknown as {
    getById: (id: string) => Promise<GamePlanWithItems | null>;
  }).getById = async (id) => opts.plans.find((p) => p.id === id) ?? null;
  (planSvc as unknown as {
    list: (filter: ListGamePlanFilter) => Promise<GamePlanWithItems[]>;
  }).list = async (filter) => {
    listFilters.push(filter);
    const hasHallScope = filter.hallId !== undefined;
    const hasGroupIdsScope =
      Array.isArray(filter.groupOfHallsIds) &&
      filter.groupOfHallsIds.length > 0;
    return opts.plans
      .filter((p) => {
        // is_active filter
        if (filter.isActive !== undefined && p.isActive !== filter.isActive) {
          return false;
        }
        // hall + groupOfHallsIds OR-es; hvis bare én er satt, brukes den.
        if (hasHallScope && hasGroupIdsScope) {
          const matchHall = p.hallId === filter.hallId;
          const matchGoH =
            p.groupOfHallsId !== null &&
            filter.groupOfHallsIds!.includes(p.groupOfHallsId);
          return matchHall || matchGoH;
        }
        if (hasHallScope) {
          return p.hallId === filter.hallId;
        }
        if (hasGroupIdsScope) {
          return (
            p.groupOfHallsId !== null &&
            filter.groupOfHallsIds!.includes(p.groupOfHallsId)
          );
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const svc = Object.create(
    GamePlanRunService.prototype,
  ) as GamePlanRunService;
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { planService: GamePlanService }).planService = planSvc;
  (svc as unknown as {
    catalogService: GameCatalogService;
  }).catalogService = catalogSvc;
  (svc as unknown as { auditLogService: null }).auditLogService = null;

  return { service: svc, queries, listFilters };
}

async function expectDomainError(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await fn();
    assert.fail(`${label}: forventet DomainError men fikk success`);
  } catch (err) {
    if (!(err instanceof DomainError)) {
      throw err;
    }
    assert.equal(err.code, expectedCode, `${label}: feil DomainError-kode`);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

test("GoH-matching: regresjon — direkte hall-binding fortsatt matchet", async () => {
  const plan = makePlanWithItems({
    id: "plan-direct",
    hallId: "hall-1",
    groupOfHallsId: null,
  });
  const { service, listFilters } = makeRunService({
    goHIdsForHall: [],
    plans: [plan],
  });
  const run = await service.getOrCreateForToday("hall-1", todayStr());
  assert.equal(run.status, "idle");
  assert.equal(run.planId, "plan-direct");
  // Filter skal ha hallId="hall-1" og INGEN groupOfHallsIds (siden hall
  // ikke er medlem av noen GoH).
  const lastFilter = listFilters[listFilters.length - 1];
  assert.equal(lastFilter.hallId, "hall-1");
  assert.equal(lastFilter.groupOfHallsIds, undefined);
});

test("GoH-matching: GoH-bundet plan plukkes når hall er medlem av GoH", async () => {
  // Simulerer Tobias' pilot-plan: hallId=null, groupOfHallsId=GoH-A,
  // hall er medlem av GoH-A.
  const plan = makePlanWithItems({
    id: "plan-goh",
    hallId: null,
    groupOfHallsId: "goh-A",
  });
  const { service, listFilters } = makeRunService({
    goHIdsForHall: ["goh-A"],
    plans: [plan],
  });
  const run = await service.getOrCreateForToday("hall-1", todayStr());
  assert.equal(run.status, "idle");
  assert.equal(run.planId, "plan-goh");
  // Filter skal ha både hallId="hall-1" og groupOfHallsIds=["goh-A"].
  const lastFilter = listFilters[listFilters.length - 1];
  assert.equal(lastFilter.hallId, "hall-1");
  assert.deepEqual(lastFilter.groupOfHallsIds, ["goh-A"]);
});

test("GoH-matching: hall medlem av flere GoH-er — alle ID-er sendes til list-filter", async () => {
  const planA = makePlanWithItems({
    id: "plan-A",
    hallId: null,
    groupOfHallsId: "goh-A",
  });
  const planB = makePlanWithItems({
    id: "plan-B",
    hallId: null,
    groupOfHallsId: "goh-B",
    isActive: false, // ikke aktiv → skal IKKE plukkes
  });
  const planC = makePlanWithItems({
    id: "plan-C",
    hallId: null,
    groupOfHallsId: "goh-C",
  });
  // Hall er medlem av A og C, men IKKE B.
  const { service, listFilters } = makeRunService({
    goHIdsForHall: ["goh-A", "goh-C"],
    plans: [planA, planB, planC],
  });
  const run = await service.getOrCreateForToday("hall-1", todayStr());
  assert.ok(run.planId === "plan-A" || run.planId === "plan-C");
  const lastFilter = listFilters[listFilters.length - 1];
  assert.deepEqual(lastFilter.groupOfHallsIds, ["goh-A", "goh-C"]);
  assert.equal(lastFilter.isActive, true);
});

test("GoH-matching: plan med GoH som hall IKKE er medlem av blir ikke matchet", async () => {
  // Plan er bundet til goh-X, men hall er kun medlem av goh-A.
  const plan = makePlanWithItems({
    id: "plan-other",
    hallId: null,
    groupOfHallsId: "goh-X",
  });
  const { service } = makeRunService({
    goHIdsForHall: ["goh-A"],
    plans: [plan],
  });
  await expectDomainError(
    "no goh match",
    () => service.getOrCreateForToday("hall-1", todayStr()),
    "NO_MATCHING_PLAN",
  );
});

test("GoH-matching: plan i GoH med ukedag som ikke matcher dagen blir ikke matchet", async () => {
  const today = todayWeekday();
  const otherDay = today === "mon" ? "tue" : "mon";
  const plan = makePlanWithItems({
    id: "plan-goh",
    hallId: null,
    groupOfHallsId: "goh-A",
    weekdays: [otherDay] as ["mon"], // type-cast nok for testdata
  });
  const { service } = makeRunService({
    goHIdsForHall: ["goh-A"],
    plans: [plan],
  });
  await expectDomainError(
    "weekday mismatch",
    () => service.getOrCreateForToday("hall-1", todayStr()),
    "NO_MATCHING_PLAN",
  );
});

test("GoH-matching: ingen GoH-medlemskap + ingen direkte plan → NO_MATCHING_PLAN", async () => {
  const { service } = makeRunService({
    goHIdsForHall: [],
    plans: [],
  });
  await expectDomainError(
    "no plans",
    () => service.getOrCreateForToday("hall-1", todayStr()),
    "NO_MATCHING_PLAN",
  );
});

test("GoH-matching: når direkte plan + GoH-plan begge dekker dagen, første alfabetisk vinner", async () => {
  // Begge planene matcher hall-1 og dagens ukedag. Liste-stub-en sorterer
  // på navn ASC, så "AAA" kommer først.
  const planA = makePlanWithItems({
    id: "plan-aaa",
    name: "AAA Direct",
    hallId: "hall-1",
    groupOfHallsId: null,
  });
  const planB = makePlanWithItems({
    id: "plan-bbb",
    name: "BBB GoH",
    hallId: null,
    groupOfHallsId: "goh-A",
  });
  const { service } = makeRunService({
    goHIdsForHall: ["goh-A"],
    plans: [planA, planB],
  });
  const run = await service.getOrCreateForToday("hall-1", todayStr());
  assert.equal(run.planId, "plan-aaa");
});

test("GoH-matching: dedup på id når en plan i teorien matcher begge filtere", async () => {
  // CHECK constraint i DB håndhever XOR (hallId XOR groupOfHallsId), så
  // dette kan teknisk ikke skje. Men dedup-koden er defensiv. Vi
  // simulerer ved å ha to plan-objekter med samme id og forskjellig
  // binding — men siden array er sortert + dedup-en er en Set, blir kun
  // én bevart.
  const planSame = makePlanWithItems({
    id: "plan-X",
    name: "Plan",
    hallId: "hall-1",
    groupOfHallsId: null,
  });
  // Returner begge "treff" fra list-stub-en — fake duplikat
  const planDuplicate = { ...planSame };
  const { service } = makeRunService({
    goHIdsForHall: ["goh-A"],
    plans: [planSame, planDuplicate],
  });
  const run = await service.getOrCreateForToday("hall-1", todayStr());
  // Ingen feil, returnerer plan-X.
  assert.equal(run.planId, "plan-X");
});

test("GoH-matching: findGoHIdsForHall querier app_hall_group_members + app_hall_groups", async () => {
  const plan = makePlanWithItems({
    id: "plan-direct",
    hallId: "hall-1",
    groupOfHallsId: null,
  });
  const { service, queries } = makeRunService({
    goHIdsForHall: [],
    plans: [plan],
  });
  await service.getOrCreateForToday("hall-1", todayStr());
  // Verifiser at GoH-spørringen ble kjørt med hallId som parameter.
  const goHQuery = queries.find((q) =>
    /app_hall_group_members/i.test(q.sql),
  );
  assert.ok(goHQuery, "findGoHIdsForHall-spørring skal være kjørt");
  assert.deepEqual(goHQuery?.params, ["hall-1"]);
  // Verifiser at det er INNER JOIN mot app_hall_groups med
  // active+not-deleted-filter (samme mønster som GamePlanEngineBridge).
  assert.match(goHQuery!.sql, /app_hall_groups/i);
  assert.match(goHQuery!.sql, /deleted_at IS NULL/i);
  assert.match(goHQuery!.sql, /status = 'active'/i);
});
