/**
 * BUG E auto-advance (2026-05-14): tester for GamePlanRunService.getOrCreateForToday
 * auto-advance fra finished plan-run.
 *
 * Bakgrunn (Tobias-rapport 2026-05-14 09:58):
 *   "Hvert spill spilles kun en gang deretter videre til nytt spill. Før var
 *    det sånn at man måtte spille dette spillet 2 ganger før den går videre
 *    til neste på lista. Nå går den ikke videre til neste spiller heller. Nå
 *    er det 3 forsøk for da neste spill som vises er bingo. Vi må fikse at
 *    hvert spill spilles kun en gang deretter videre til nytt spill."
 *
 * Root cause:
 *   F-Plan-Reuse (2026-05-09) DELETE-r finished plan-run og INSERT-er ny på
 *   `current_position=1` uavhengig av hvor langt forrige run kom. Master må
 *   spille Bingo (position=1) på nytt hver gang.
 *
 * Fix: capture `previousPosition` FØR DELETE og bruk den til å sette
 *   `current_position = previousPosition + 1` på den nye plan-run-raden.
 *   Wrap til 1 når forrige nådde siste posisjon.
 *
 * Disse testene verifiserer at:
 *   1. Ingen tidligere plan-run i dag → start på position=1 (eksisterende oppførsel).
 *   2. Plan-run finished på position=1 → start på position=2.
 *   3. Plan-run finished på position=2 → start på position=3.
 *   4. Plan-run finished på position=13 (siste) → start på position=1 (wrap).
 *   5. Plan-run cancelled eller paused → IKKE behandlet (kun finished trigger reuse).
 *   6. Audit-event skrives med previousPosition + newPosition + autoAdvanced.
 *   7. Race-condition robusthet (eksisterende oppførsel beholdes).
 *   8. Plan med 0 items → wrap til 1 (defensive default).
 *
 * Strategi: gjenbruk Object.create-pattern fra GamePlanRunService.test.ts.
 * Stub-poolen håndterer DELETE og INSERT med dynamisk `current_position`
 * fra params.
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

// ── fixtures ──────────────────────────────────────────────────────────────

const HALL_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const PREV_RUN_ID = "33333333-3333-3333-3333-333333333333";

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

/**
 * Spilleplan med 13 katalog-spill (matcher seed-data fra demo-pilot-day):
 * Bingo, 1000-spill, 5×500, ..., TV-Extra.
 */
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

function makePlanWithNItems(n: number): GamePlanWithItems {
  return {
    id: PLAN_ID,
    name: `Plan med ${n} items`,
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
    items: Array.from({ length: n }, (_, idx) => ({
      id: `item-${idx + 1}`,
      planId: PLAN_ID,
      position: idx + 1,
      gameCatalogId: `gc-${idx + 1}`,
      bonusGameOverride: null,
      notes: null,
      createdAt: "2026-05-07T12:00:00Z",
      catalogEntry: makeCatalogEntry(
        `gc-${idx + 1}`,
        `slug-${idx + 1}`,
        `Game ${idx + 1}`,
      ),
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
  /** Forrige finished run — eller null (ingen tidligere). */
  previousRun: {
    id: string;
    currentPosition: number;
    status: "finished" | "running" | "paused" | "idle";
  } | null;
  /** Plan som planService.list returnerer. */
  plan: GamePlanWithItems;
}

function makeService(opts: MockOptions): {
  service: GamePlanRunService;
  queries: CapturedQuery[];
  audits: CapturedAudit[];
} {
  const queries: CapturedQuery[] = [];
  const audits: CapturedAudit[] = [];
  const dateStr = todayStr();

  // findForDay returnerer enten previousRun eller den nye INSERT'ede raden.
  // Vi sporer "currentRunRow" som muteres etter DELETE og INSERT.
  let currentRunRow: Record<string, unknown> | null = opts.previousRun
    ? {
        id: opts.previousRun.id,
        plan_id: PLAN_ID,
        hall_id: HALL_ID,
        business_date: dateStr,
        current_position: opts.previousRun.currentPosition,
        status: opts.previousRun.status,
        jackpot_overrides_json: {},
        started_at: new Date("2026-05-14T10:00:00Z"),
        finished_at:
          opts.previousRun.status === "finished"
            ? new Date("2026-05-14T11:00:00Z")
            : null,
        master_user_id: "u-prev-master",
        created_at: new Date("2026-05-14T10:00:00Z"),
        updated_at: new Date("2026-05-14T11:00:00Z"),
      }
    : null;

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

      if (/DELETE FROM\s+"public"\."app_game_plan_run"/i.test(sql)) {
        // F-Plan-Reuse DELETE: fjern raden så neste findForDay returnerer null
        // INNTIL INSERT skjer.
        currentRunRow = null;
        return { rowCount: 1, rows: [] };
      }

      if (/INSERT INTO\s+"public"\."app_game_plan_run"/i.test(sql)) {
        // Fang parametre — viktigste er $5 (current_position).
        if (params && Array.isArray(params) && params.length >= 5) {
          currentRunRow = {
            id: params[0] as string,
            plan_id: params[1] as string,
            hall_id: params[2] as string,
            business_date: params[3] as string,
            current_position: params[4] as number,
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

      if (/^\s*SELECT/i.test(sql)) {
        // findForDay
        if (currentRunRow) return { rows: [currentRunRow] };
        return { rows: [] };
      }

      return { rowCount: 1, rows: [] };
    },
  };

  // Plan-service mock — returnerer plan via list.
  const planSvc = Object.create(GamePlanService.prototype) as GamePlanService;
  (planSvc as unknown as { pool: unknown }).pool = stubPool;
  (planSvc as unknown as { schema: string }).schema = "public";
  (planSvc as unknown as {
    list: () => Promise<GamePlanWithItems[]>;
  }).list = async () => [opts.plan];
  (planSvc as unknown as {
    getById: (id: string) => Promise<GamePlanWithItems | null>;
  }).getById = async (id) => (opts.plan.id === id ? opts.plan : null);

  // Catalog-service stub (ikke brukt direkte i auto-advance, men kreves av konstruktør).
  const catalogSvc = Object.create(
    GameCatalogService.prototype,
  ) as GameCatalogService;
  (catalogSvc as unknown as { pool: unknown }).pool = stubPool;
  (catalogSvc as unknown as { schema: string }).schema = "public";

  // Audit-service stub — fanger alle events.
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

function findInsertParams(queries: CapturedQuery[]): unknown[] | undefined {
  const insert = queries.find((q) =>
    /INSERT INTO\s+"public"\."app_game_plan_run"/i.test(q.sql),
  );
  return insert?.params;
}

function findAudit(
  audits: CapturedAudit[],
  action: string,
): CapturedAudit | undefined {
  return audits.find((a) => a.action === action);
}

// ── tests ─────────────────────────────────────────────────────────────────

test("auto-advance: ingen tidligere plan-run → start på position=1 (eksisterende oppførsel)", async () => {
  const plan = makePlanWith13Items();
  const { service, queries, audits } = makeService({
    previousRun: null,
    plan,
  });

  const run = await service.getOrCreateForToday(HALL_ID, todayStr());

  assert.equal(run.status, "idle");
  assert.equal(run.currentPosition, 1, "uten forrige run skal start på 1");

  const insertParams = findInsertParams(queries);
  assert.ok(insertParams, "INSERT må ha kjørt");
  assert.equal(insertParams?.[4], 1, "$5 (current_position) skal være 1");

  // Audit skal være game_plan_run.create (ikke recreate_after_finish).
  const createAudit = findAudit(audits, "game_plan_run.create");
  assert.ok(createAudit, "create-audit må skrives");
  assert.equal(
    createAudit?.details.previousPosition,
    undefined,
    "previousPosition skal IKKE være satt når ingen forrige run",
  );
  assert.equal(
    createAudit?.details.autoAdvanced,
    undefined,
    "autoAdvanced skal IKKE være satt når ingen forrige run",
  );
});

test("auto-advance: forrige finished på position=1 → ny på position=2", async () => {
  const plan = makePlanWith13Items();
  const { service, queries, audits } = makeService({
    previousRun: {
      id: PREV_RUN_ID,
      currentPosition: 1,
      status: "finished",
    },
    plan,
  });

  const run = await service.getOrCreateForToday(HALL_ID, todayStr());

  assert.equal(run.status, "idle");
  assert.equal(
    run.currentPosition,
    2,
    "forrige finished på pos 1 → ny på pos 2 (1000-spill)",
  );

  const insertParams = findInsertParams(queries);
  assert.equal(insertParams?.[4], 2);

  // Audit skal være recreate_after_finish med autoAdvanced=true.
  const recreateAudit = findAudit(audits, "game_plan_run.recreate_after_finish");
  assert.ok(recreateAudit, "recreate-audit må skrives");
  assert.equal(recreateAudit?.details.previousPosition, 1);
  assert.equal(recreateAudit?.details.newPosition, 2);
  assert.equal(recreateAudit?.details.autoAdvanced, true);
  assert.equal(recreateAudit?.details.previousRunId, PREV_RUN_ID);
  assert.equal(recreateAudit?.details.planItemCount, 13);
});

test("auto-advance: forrige finished på position=2 → ny på position=3", async () => {
  const plan = makePlanWith13Items();
  const { service, queries, audits } = makeService({
    previousRun: {
      id: PREV_RUN_ID,
      currentPosition: 2,
      status: "finished",
    },
    plan,
  });

  const run = await service.getOrCreateForToday(HALL_ID, todayStr());

  assert.equal(run.currentPosition, 3);

  const insertParams = findInsertParams(queries);
  assert.equal(insertParams?.[4], 3);

  const audit = findAudit(audits, "game_plan_run.recreate_after_finish");
  assert.equal(audit?.details.previousPosition, 2);
  assert.equal(audit?.details.newPosition, 3);
  assert.equal(audit?.details.autoAdvanced, true);
});

test("auto-advance: forrige finished på position=12 → ny på position=13 (siste)", async () => {
  const plan = makePlanWith13Items();
  const { service, queries, audits } = makeService({
    previousRun: {
      id: PREV_RUN_ID,
      currentPosition: 12,
      status: "finished",
    },
    plan,
  });

  const run = await service.getOrCreateForToday(HALL_ID, todayStr());

  assert.equal(
    run.currentPosition,
    13,
    "forrige pos 12 → ny pos 13 (TV-Extra, siste i sekvensen)",
  );

  const audit = findAudit(audits, "game_plan_run.recreate_after_finish");
  assert.equal(audit?.details.autoAdvanced, true);
  assert.equal(audit?.details.newPosition, 13);
});

test("plan-completed beats stengetid: forrige finished på position=13 (siste) → AVVIS med PLAN_COMPLETED_FOR_TODAY", async () => {
  // Tobias-direktiv 2026-05-14 10:17: Plan-completed beats stengetid.
  // Selv om bingohall fortsatt åpen, skal master IKKE kunne starte ny
  // plan-run når plan er fullført for dagen. INGEN wrap.
  const plan = makePlanWith13Items();
  const { service } = makeService({
    previousRun: {
      id: PREV_RUN_ID,
      currentPosition: 13,
      status: "finished",
    },
    plan,
  });

  await assert.rejects(
    () => service.getOrCreateForToday(HALL_ID, todayStr()),
    (err: unknown) => {
      assert.ok(err instanceof Error, "should throw Error");
      assert.equal(
        (err as { code?: string }).code,
        "PLAN_COMPLETED_FOR_TODAY",
        "should reject with PLAN_COMPLETED_FOR_TODAY code",
      );
      return true;
    },
    "forrige pos 13 (siste) → AVVIS, ingen wrap",
  );
});

test("plan-completed: forrige finished på position > items.length → AVVIS (planen redusert, men ferdig)", async () => {
  // Edge case: forrige rad har en posisjon utenfor plan-items (eks. planen
  // ble redusert). Vi skal AVVIS, ikke wrap. Plan-completed-state.
  const plan = makePlanWithNItems(5); // kun 5 items
  const { service } = makeService({
    previousRun: {
      id: PREV_RUN_ID,
      currentPosition: 10, // utenfor planen
      status: "finished",
    },
    plan,
  });

  await assert.rejects(
    () => service.getOrCreateForToday(HALL_ID, todayStr()),
    (err: unknown) => {
      assert.equal(
        (err as { code?: string }).code,
        "PLAN_COMPLETED_FOR_TODAY",
        "previousPosition > items.length → AVVIS, ikke wrap",
      );
      return true;
    },
  );
});

test("auto-advance: plan med 0 items → wrap til 1 (defensive default)", async () => {
  // Plan uten items skal ikke krasje — bare fall til wrap (position=1).
  const plan = makePlanWithNItems(0);
  const { service, queries, audits } = makeService({
    previousRun: {
      id: PREV_RUN_ID,
      currentPosition: 5,
      status: "finished",
    },
    plan,
  });

  const run = await service.getOrCreateForToday(HALL_ID, todayStr());

  assert.equal(run.currentPosition, 1);

  const audit = findAudit(audits, "game_plan_run.recreate_after_finish");
  assert.equal(audit?.details.autoAdvanced, false);
  assert.equal(audit?.details.planItemCount, 0);
});

test("auto-advance: forrige idle (ikke finished) → returneres som-er (ingen advance)", async () => {
  // Hvis eksisterende run er idle/running/paused skal vi returnere den UENDRET
  // (eksisterende idempotency-oppførsel). Auto-advance gjelder KUN finished.
  const plan = makePlanWith13Items();
  const { service, queries, audits } = makeService({
    previousRun: {
      id: PREV_RUN_ID,
      currentPosition: 3,
      status: "idle",
    },
    plan,
  });

  const run = await service.getOrCreateForToday(HALL_ID, todayStr());

  assert.equal(run.id, PREV_RUN_ID, "skal returnere eksisterende idle-run");
  assert.equal(run.currentPosition, 3, "posisjon uendret");
  assert.equal(run.status, "idle");

  // Ingen INSERT skal ha skjedd.
  const insertParams = findInsertParams(queries);
  assert.equal(
    insertParams,
    undefined,
    "INSERT skal IKKE kjøres når idle-run finnes",
  );

  // Ingen audit-events.
  assert.equal(audits.length, 0, "ingen audit-events for idempotent return");
});

test("auto-advance: forrige running → returneres som-er (ingen advance)", async () => {
  const plan = makePlanWith13Items();
  const { service, queries } = makeService({
    previousRun: {
      id: PREV_RUN_ID,
      currentPosition: 5,
      status: "running",
    },
    plan,
  });

  const run = await service.getOrCreateForToday(HALL_ID, todayStr());

  assert.equal(run.id, PREV_RUN_ID);
  assert.equal(run.currentPosition, 5);
  assert.equal(run.status, "running");
  assert.equal(findInsertParams(queries), undefined);
});

test("auto-advance: audit-event inkluderer alle sporbarhets-felter", async () => {
  // Lotteritilsynet-sporbarhet: hver advance skal logges med
  // previousRunId + previousPosition + newPosition + autoAdvanced + planItemCount.
  const plan = makePlanWith13Items();
  const { service, audits } = makeService({
    previousRun: {
      id: PREV_RUN_ID,
      currentPosition: 7,
      status: "finished",
    },
    plan,
  });

  await service.getOrCreateForToday(HALL_ID, todayStr());

  const audit = findAudit(audits, "game_plan_run.recreate_after_finish");
  assert.ok(audit);
  assert.equal(audit?.actorId, "system");
  assert.equal(audit?.details.previousRunId, PREV_RUN_ID);
  assert.equal(audit?.details.previousPosition, 7);
  assert.equal(audit?.details.newPosition, 8);
  assert.equal(audit?.details.autoAdvanced, true);
  assert.equal(audit?.details.planItemCount, 13);
  assert.equal(audit?.details.planId, PLAN_ID);
  assert.equal(audit?.details.hallId, HALL_ID);
});
