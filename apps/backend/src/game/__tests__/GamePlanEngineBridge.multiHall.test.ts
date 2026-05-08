/**
 * Multi-hall via group-of-halls (2026-05-08): bridgen skal ekspandere
 * `participating_halls_json` til ALLE aktive haller i masterens hall-
 * gruppe — ikke bare masteren selv.
 *
 * Kontekst: pilot-bruken er Teknobingo Årnes (master) sammen med
 * Bodø/Brumunddal/Fauske. Tidligere hardkodet bridgen
 * `participatingHalls = [run.hall_id]`, som brøt cross-hall-spill.
 *
 * Testene under bruker stub-pool (ingen Postgres) og verifiserer:
 *   - 4-hall GoH → master først, alle 4 inkludert
 *   - solo-GoH → kun masteren (regresjon: single-hall fortsatt fungerer)
 *   - GoH med 2 inaktive medlemmer → kun de 2 aktive returneres
 *   - master ikke i GoH → MASTER_NOT_IN_GROUP
 *   - tom aktiv-liste → NO_ACTIVE_HALLS_IN_GROUP
 *   - hall ikke i noen GoH → HALL_NOT_IN_GROUP (regresjon, eksisterende
 *     atferd beholdes)
 *   - idempotent retry → eksisterende rad gjenbrukes uten ny INSERT
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GameCatalogService } from "../GameCatalogService.js";
import { GamePlanService } from "../GamePlanService.js";
import { GamePlanRunService } from "../GamePlanRunService.js";
import { GamePlanEngineBridge } from "../GamePlanEngineBridge.js";
import { DomainError } from "../../errors/DomainError.js";
import type { GameCatalogEntry } from "../gameCatalog.types.js";
import type { GamePlanWithItems } from "../gamePlan.types.js";

// ── helpers (lokale kopier — vi vil ikke avhenge av at intern test-fil
//    eksporterer disse) ────────────────────────────────────────────────────

interface CapturedQuery {
  sql: string;
  params: unknown[] | undefined;
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
  items: { catalogEntry: GameCatalogEntry }[],
): GamePlanWithItems {
  return {
    id: "gp-1",
    name: "Spilleplan",
    description: null,
    hallId: "hall-master",
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
      gameCatalogId: it.catalogEntry.id,
      bonusGameOverride: null,
      notes: null,
      createdAt: "2026-05-07T12:00:00Z",
      catalogEntry: it.catalogEntry,
    })),
  };
}

function stubCatalogService(
  entries: Map<string, GameCatalogEntry>,
): GameCatalogService {
  const svc = Object.create(
    GameCatalogService.prototype,
  ) as GameCatalogService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { auditLogService: null }).auditLogService = null;
  (svc as unknown as {
    getById: (id: string) => Promise<GameCatalogEntry | null>;
  }).getById = async (id) => entries.get(id) ?? null;
  return svc;
}

function stubPlanService(
  plan: GamePlanWithItems | null,
): GamePlanService {
  const svc = Object.create(GamePlanService.prototype) as GamePlanService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { auditLogService: null }).auditLogService = null;
  (svc as unknown as {
    catalogService: GameCatalogService;
  }).catalogService = stubCatalogService(new Map());
  (svc as unknown as {
    getById: (id: string) => Promise<GamePlanWithItems | null>;
  }).getById = async (id) => {
    if (!plan) return null;
    return plan.id === id ? plan : null;
  };
  return svc;
}

function stubRunService(): GamePlanRunService {
  const svc = Object.create(
    GamePlanRunService.prototype,
  ) as GamePlanRunService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  return svc;
}

interface BridgeOptions {
  runRow?: Record<string, unknown> | null;
  plan?: GamePlanWithItems | null;
  existingScheduled?: { id: string; catalog_entry_id: string } | null;
  /** Group-id som hall hører til (resolveGroupHallId-svar). null = ingen. */
  hallGroupId?: string | null;
  /**
   * Hall-IDer som SQL-en for `resolveParticipatingHallIds` skal returnere.
   * Settes for å simulere `INNER JOIN app_halls + is_active=true`-resultatet
   * — testene putter inn akkurat det settet de vil teste.
   *
   * Setter du `groupHallMembers: []` simulerer du "alle medlemmer er
   * inaktive" — bridgen skal kaste NO_ACTIVE_HALLS_IN_GROUP.
   */
  groupHallMembers?: string[];
}

function makeBridge(options: BridgeOptions = {}): {
  bridge: GamePlanEngineBridge;
  queries: CapturedQuery[];
} {
  const queries: CapturedQuery[] = [];
  const stubPool = {
    async query(textOrConfig: unknown, params?: unknown[]): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      queries.push({ sql, params });

      if (
        /SELECT\s+id,\s*plan_id/i.test(sql) &&
        /app_game_plan_run/i.test(sql)
      ) {
        if (options.runRow) return { rows: [options.runRow] };
        return { rows: [] };
      }
      if (
        /SELECT\s+jackpot_overrides_json/i.test(sql) &&
        /app_game_plan_run/i.test(sql)
      ) {
        if (options.runRow) {
          return {
            rows: [
              {
                jackpot_overrides_json: options.runRow.jackpot_overrides_json,
              },
            ],
          };
        }
        return { rows: [] };
      }
      if (
        /SELECT\s+id,\s*catalog_entry_id/i.test(sql) &&
        /app_game1_scheduled_games/i.test(sql)
      ) {
        if (options.existingScheduled)
          return { rows: [options.existingScheduled] };
        return { rows: [] };
      }
      // resolveGroupHallId
      if (
        /SELECT\s+group_id/i.test(sql) &&
        /app_hall_group_members/i.test(sql)
      ) {
        if (options.hallGroupId !== null && options.hallGroupId !== undefined) {
          return { rows: [{ group_id: options.hallGroupId }] };
        }
        return { rows: [] };
      }
      // resolveParticipatingHallIds
      if (
        /SELECT\s+DISTINCT\s+m\.hall_id/i.test(sql) &&
        /app_hall_group_members/i.test(sql)
      ) {
        const masterId =
          (options.runRow?.hall_id as string | undefined) ?? null;
        if (options.groupHallMembers !== undefined) {
          return {
            rows: options.groupHallMembers.map((id) => ({ hall_id: id })),
          };
        }
        if (masterId) {
          return { rows: [{ hall_id: masterId }] };
        }
        return { rows: [] };
      }
      if (
        /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(sql)
      ) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
  };

  const catalogEntries = new Map<string, GameCatalogEntry>();
  if (options.plan) {
    for (const item of options.plan.items) {
      catalogEntries.set(item.catalogEntry.id, item.catalogEntry);
    }
  }
  const catalog = stubCatalogService(catalogEntries);
  const plan = stubPlanService(options.plan ?? null);
  const run = stubRunService();

  const bridge = GamePlanEngineBridge.forTesting({
    pool: stubPool as never,
    schema: "public",
    catalogService: catalog,
    planService: plan,
    planRunService: run,
  });

  return { bridge, queries };
}

function getInsertParticipatingHalls(queries: CapturedQuery[]): string[] {
  const insert = queries.find((q) =>
    /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql),
  );
  assert.ok(insert, "INSERT skal kjøres");
  // params[13] = participating_halls_json (sjekk top-fil for kolonne-rekkefølge)
  const raw = insert!.params![13] as string;
  return JSON.parse(raw) as string[];
}

// ── tests ────────────────────────────────────────────────────────────────

test("4-hall GoH: participating_halls inneholder alle 4 med master først", async () => {
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const { bridge, queries } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-arnes",
      business_date: "2026-05-08",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-pilot",
    groupHallMembers: [
      "hall-arnes", // master kommer først pga ORDER BY CASE
      "hall-bodo",
      "hall-brumunddal",
      "hall-fauske",
    ],
  });

  const result = await bridge.createScheduledGameForPlanRunPosition(
    "run-1",
    1,
  );

  assert.equal(result.reused, false);
  const halls = getInsertParticipatingHalls(queries);
  assert.equal(halls.length, 4);
  assert.equal(halls[0], "hall-arnes", "master må være først");
  assert.deepEqual(halls.slice().sort(), [
    "hall-arnes",
    "hall-bodo",
    "hall-brumunddal",
    "hall-fauske",
  ]);
});

test("Solo-GoH (kun master): participating_halls = [masterHallId]", async () => {
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const { bridge, queries } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-solo",
      business_date: "2026-05-08",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-solo",
    groupHallMembers: ["hall-solo"],
  });

  const result = await bridge.createScheduledGameForPlanRunPosition(
    "run-1",
    1,
  );

  assert.equal(result.reused, false);
  const halls = getInsertParticipatingHalls(queries);
  assert.deepEqual(halls, ["hall-solo"]);
});

test("GoH med 2 inaktive haller: kun de 2 aktive returneres", async () => {
  // SQL-en filtrerer på `h.is_active = true`, så stub-en simulerer dette
  // ved kun å returnere de 2 aktive radene. Inaktive rader blir aldri med.
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const { bridge, queries } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-master",
      business_date: "2026-05-08",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-mixed",
    // Av 4 medlemmer er kun 2 aktive (de 2 andre er filtrert bort av
    // `h.is_active = true` i JOIN-en).
    groupHallMembers: ["hall-master", "hall-active-2"],
  });

  await bridge.createScheduledGameForPlanRunPosition("run-1", 1);

  const halls = getInsertParticipatingHalls(queries);
  assert.equal(halls.length, 2);
  assert.equal(halls[0], "hall-master", "master først");
  assert.ok(halls.includes("hall-active-2"));
  assert.ok(
    !halls.includes("hall-inactive-1"),
    "inaktive haller skal ikke være med",
  );
});

test("Hall ikke i noen GoH: HALL_NOT_IN_GROUP (regresjon)", async () => {
  // Bevarer eksisterende atferd fra før multi-hall-fixen — bridgen
  // kaster fortsatt HALL_NOT_IN_GROUP når masterhallen ikke har et
  // aktivt gruppe-medlemskap. resolveGroupHallId returnerer ikke,
  // og bridgen kommer aldri til resolveParticipatingHallIds.
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const { bridge } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-orphan",
      business_date: "2026-05-08",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: null, // ingen aktiv gruppe
  });

  await assert.rejects(
    () => bridge.createScheduledGameForPlanRunPosition("run-1", 1),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "HALL_NOT_IN_GROUP");
      return true;
    },
  );
});

test("GoH der alle medlemmer er inaktive: NO_ACTIVE_HALLS_IN_GROUP", async () => {
  // resolveGroupHallId resolver gruppen (masteren har medlemskap), men
  // INNER JOIN-en mot app_halls filtrerer bort alle inaktive haller.
  // Bridgen skal kaste NO_ACTIVE_HALLS_IN_GROUP heller enn å spawne et
  // spill med tom participating_halls_json (som ville feilet i engine).
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const { bridge } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-master",
      business_date: "2026-05-08",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-all-inactive",
    groupHallMembers: [], // ingen aktive
  });

  await assert.rejects(
    () => bridge.createScheduledGameForPlanRunPosition("run-1", 1),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal(
        (err as DomainError).code,
        "NO_ACTIVE_HALLS_IN_GROUP",
      );
      return true;
    },
  );
});

test("Master ikke i deltager-listen: MASTER_NOT_IN_GROUP", async () => {
  // Defensiv sjekk: skal aldri skje fordi groupHallId resolves via
  // masterens medlemskap, men hvis databasen er korrupt og masteren
  // er FK-frittstående mens andre haller er medlemmer, skal vi feile
  // tydelig heller enn å produsere en rad uten masteren.
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const { bridge } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-master",
      business_date: "2026-05-08",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-corrupt",
    // Master er IKKE i listen — kun andre haller
    groupHallMembers: ["hall-other-1", "hall-other-2"],
  });

  await assert.rejects(
    () => bridge.createScheduledGameForPlanRunPosition("run-1", 1),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "MASTER_NOT_IN_GROUP");
      return true;
    },
  );
});

test("Idempotent retry: re-kall returnerer eksisterende rad uten ny INSERT", async () => {
  // Multi-hall ekspansjon må ikke bryte idempotency-garantien. Etter
  // første spawn skal re-kall med samme (run, position) returnere
  // eksisterende scheduled_game.id med catalog-entry, uten INSERT eller
  // ny SELECT mot app_hall_group_members (vi gjenbruker raden direkte).
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const { bridge, queries } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-arnes",
      business_date: "2026-05-08",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: { id: "sg-existing", catalog_entry_id: "gc-1" },
    hallGroupId: "hg-pilot",
    groupHallMembers: [
      "hall-arnes",
      "hall-bodo",
      "hall-brumunddal",
      "hall-fauske",
    ],
  });

  const result = await bridge.createScheduledGameForPlanRunPosition(
    "run-1",
    1,
  );

  assert.equal(result.reused, true);
  assert.equal(result.scheduledGameId, "sg-existing");
  assert.equal(result.catalogEntry.id, "gc-1");

  // Verifiser at INSERT ikke kjøres
  const insert = queries.find((q) =>
    /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql),
  );
  assert.equal(insert, undefined, "INSERT skal IKKE kjøres ved retry");

  // Verifiser at vi ikke kalte resolveParticipatingHallIds (DISTINCT-spørring)
  // — eksisterende rad hopper rett til catalog-fetch og returnerer.
  const partQ = queries.find(
    (q) =>
      /SELECT\s+DISTINCT\s+m\.hall_id/i.test(q.sql) &&
      /app_hall_group_members/i.test(q.sql),
  );
  assert.equal(
    partQ,
    undefined,
    "resolveParticipatingHallIds skal ikke kalles ved idempotent retry",
  );
});

test("Master først i ORDER BY: bridge tillit til SQL-rekkefølgen", async () => {
  // Stub-en returnerer rader i den rekkefølgen testen oppgir — i prod
  // er rekkefølgen styrt av `ORDER BY (CASE WHEN ... THEN 0 ELSE 1)`.
  // Denne testen verifiserer at koden ikke re-sorterer i JS — den
  // beholder SQL-rekkefølgen, så masteren forblir først.
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const { bridge, queries } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-master",
      business_date: "2026-05-08",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-pilot",
    // SQL ORDER BY plasserer master først; stub-en gjør det samme.
    groupHallMembers: ["hall-master", "hall-a", "hall-b"],
  });

  await bridge.createScheduledGameForPlanRunPosition("run-1", 1);
  const halls = getInsertParticipatingHalls(queries);
  assert.equal(halls[0], "hall-master");
  assert.equal(halls.length, 3);
});
