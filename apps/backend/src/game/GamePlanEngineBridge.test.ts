/**
 * Fase 4 (2026-05-07): unit-tester for GamePlanEngineBridge.
 *
 * Tester:
 *   - createScheduledGameForPlanRunPosition happy path (oppretter rad
 *     med catalog_entry_id + plan_run_id + plan_position satt)
 *   - catalog premier propageres til ticket_config_json
 *   - jackpot-override mappes korrekt til jackpot_config_json
 *   - bonus-spill-flag respekteres (catalog → ticket_config.bonusGame)
 *   - 3-bongfarger (gul/hvit/lilla) propageres riktig
 *   - run uten override på jackpot-game → blokker (JACKPOT_SETUP_REQUIRED)
 *   - idempotent retry: samme (run, position) returnerer eksisterende rad
 *
 * Object.create-pattern + stub-pool — ingen Postgres-oppkopling.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GameCatalogService } from "./GameCatalogService.js";
import { GamePlanService } from "./GamePlanService.js";
import { GamePlanRunService } from "./GamePlanRunService.js";
import {
  GamePlanEngineBridge,
  buildJackpotConfigFromOverride,
  buildTicketConfigFromCatalog,
} from "./GamePlanEngineBridge.js";
import { DomainError } from "../errors/DomainError.js";
import type { GameCatalogEntry } from "./gameCatalog.types.js";
import type { GamePlanWithItems } from "./gamePlan.types.js";

// ── helpers ──────────────────────────────────────────────────────────────

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
    rules: { mini_game_rotation: ["wheel", "chest"] },
    ticketColors: ["gul", "hvit"],
    ticketPricesCents: { gul: 1000, hvit: 500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      // Default: bevar gammel explicit-per-color shape så eksisterende
      // bridge-tester (som ikke setter prizeMultiplierMode) får samme
      // bingoPrizes-verdier som før. Tester for "auto"-modus overstyrer
      // mode + bingoBase eksplisitt.
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
  items: {
    catalogEntry: GameCatalogEntry;
    bonusGameOverride?: import("./gameCatalog.types.js").BonusGameSlug | null;
  }[],
): GamePlanWithItems {
  return {
    id: "gp-1",
    name: "Spilleplan",
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
      gameCatalogId: it.catalogEntry.id,
      bonusGameOverride: it.bonusGameOverride ?? null,
      notes: null,
      createdAt: "2026-05-07T12:00:00Z",
      catalogEntry: it.catalogEntry,
    })),
  };
}

function stubCatalogService(
  entries: Map<string, GameCatalogEntry>,
): GameCatalogService {
  const svc = Object.create(GameCatalogService.prototype) as GameCatalogService;
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

function stubPlanService(plan: GamePlanWithItems | null): GamePlanService {
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
  const svc = Object.create(GamePlanRunService.prototype) as GamePlanRunService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  return svc;
}

interface BridgeOptions {
  /** Run-rad som skal returneres fra SELECT på app_game_plan_run. */
  runRow?: Record<string, unknown> | null;
  /** Plan til planService.getById. */
  plan?: GamePlanWithItems | null;
  /** Eksisterende scheduled-game (for idempotent retry-test). */
  existingScheduled?: { id: string; catalog_entry_id: string } | null;
  /** Hall-group-medlemskap for resolveGroupHallId. */
  hallGroupId?: string | null;
  /**
   * Aktive haller i hall-gruppen (multi-hall via GoH, 2026-05-08).
   * Brukes av `resolveParticipatingHallIds`. Hvis ikke satt
   * eksplisitt, faller stuben tilbake til `[runRow.hall_id]` for
   * bakover-kompatibilitet med eksisterende tester.
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

      // SELECT … FROM "public"."app_game_plan_run" WHERE id = $1
      if (
        /SELECT\s+id,\s*plan_id/i.test(sql) &&
        /app_game_plan_run/i.test(sql)
      ) {
        if (options.runRow) return { rows: [options.runRow] };
        return { rows: [] };
      }
      // SELECT jackpot_overrides_json FROM ... app_game_plan_run
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
      // SELECT id, catalog_entry_id FROM ... app_game1_scheduled_games
      if (
        /SELECT\s+id,\s*catalog_entry_id/i.test(sql) &&
        /app_game1_scheduled_games/i.test(sql)
      ) {
        if (options.existingScheduled)
          return { rows: [options.existingScheduled] };
        return { rows: [] };
      }
      // SELECT group_id FROM ... app_hall_group_members
      // (resolveGroupHallId — fra master-hall til gruppe)
      if (
        /SELECT\s+group_id/i.test(sql) &&
        /app_hall_group_members/i.test(sql)
      ) {
        if (options.hallGroupId !== null && options.hallGroupId !== undefined) {
          return { rows: [{ group_id: options.hallGroupId }] };
        }
        return { rows: [] };
      }
      // SELECT m.hall_id, m.added_at FROM ... app_hall_group_members
      // (resolveParticipatingHallIds — alle aktive haller i gruppen).
      // 2026-05-08: DISTINCT ble fjernet pga. PG-feil 42P10 ("for SELECT
      // DISTINCT, ORDER BY expressions must appear in select list" når
      // ORDER BY brukte en CASE-ekspresjon for å heise master til topps).
      // PRIMARY KEY (group_id, hall_id) garanterer uniqueness uten DISTINCT.
      if (
        /SELECT\s+m\.hall_id,\s*m\.added_at/i.test(sql) &&
        /app_hall_group_members/i.test(sql)
      ) {
        const masterId =
          (options.runRow?.hall_id as string | undefined) ?? null;
        // Eksplisitt members-liste vinner over default-fallback.
        if (options.groupHallMembers !== undefined) {
          return {
            rows: options.groupHallMembers.map((id) => ({ hall_id: id })),
          };
        }
        // Default: solo-gruppe med kun masteren (bakover-kompatibel
        // med eksisterende tester som ikke setter groupHallMembers).
        if (masterId) {
          return { rows: [{ hall_id: masterId }] };
        }
        return { rows: [] };
      }
      // INSERT INTO app_game1_scheduled_games
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

// ── tests ────────────────────────────────────────────────────────────────

test("buildTicketConfigFromCatalog: 2 farger oversettes gul→yellow, hvit→white", () => {
  // C2-fix (2026-05-07): engine forventer `ticketTypesData` som ARRAY-of-
  // objects med {color, size, pricePerTicket}. Hver bongfarge får
  // entries for både small og large.
  const catalog = makeCatalogEntry();
  const cfg = buildTicketConfigFromCatalog(catalog);
  assert.equal(cfg.catalogId, "gc-1");
  assert.equal(cfg.catalogSlug, "innsatsen");
  const ticketTypesData = cfg.ticketTypesData as Array<{
    color: string;
    size: "small" | "large";
    pricePerTicket: number;
  }>;
  assert.ok(Array.isArray(ticketTypesData));
  // 2 farger × 2 størrelser = 4 entries
  assert.equal(ticketTypesData.length, 4);
  const find = (color: string, size: "small" | "large") =>
    ticketTypesData.find((e) => e.color === color && e.size === size);
  assert.equal(find("yellow", "small")!.pricePerTicket, 1000);
  assert.equal(find("yellow", "large")!.pricePerTicket, 2000);
  assert.equal(find("white", "small")!.pricePerTicket, 500);
  assert.equal(find("white", "large")!.pricePerTicket, 1000);
  assert.equal(find("purple", "small"), undefined);
  // Bingo-premier per farge
  const bingoPrizes = cfg.bingoPrizes as Record<string, number>;
  assert.equal(bingoPrizes.yellow, 200000);
  assert.equal(bingoPrizes.white, 50000);
  // Row-premier
  const rowPrizes = cfg.rowPrizes as Record<string, number>;
  assert.equal(rowPrizes.row1, 10000);
  assert.equal(rowPrizes.row2, 10000);
  assert.equal(rowPrizes.row3, 10000);
  assert.equal(rowPrizes.row4, 10000);
  assert.deepEqual(cfg.rules, { mini_game_rotation: ["wheel", "chest"] });
});

test("buildTicketConfigFromCatalog: 3 farger (gul/hvit/lilla) propageres", () => {
  const catalog = makeCatalogEntry({
    ticketColors: ["gul", "hvit", "lilla"],
    ticketPricesCents: { gul: 1000, hvit: 500, lilla: 2000 },
    prizesCents: {
      rad1: 5000,
      rad2: 7500,
      rad3: 10000,
      rad4: 15000,
      bingo: { gul: 100000, hvit: 50000, lilla: 250000 },
    },
  });
  const cfg = buildTicketConfigFromCatalog(catalog);
  const ticketTypesData = cfg.ticketTypesData as Array<{
    color: string;
    size: "small" | "large";
    pricePerTicket: number;
  }>;
  assert.equal(ticketTypesData.length, 6);
  const find = (color: string, size: "small" | "large") =>
    ticketTypesData.find((e) => e.color === color && e.size === size);
  assert.equal(find("yellow", "small")!.pricePerTicket, 1000);
  assert.equal(find("yellow", "large")!.pricePerTicket, 2000);
  assert.equal(find("white", "small")!.pricePerTicket, 500);
  assert.equal(find("white", "large")!.pricePerTicket, 1000);
  assert.equal(find("purple", "small")!.pricePerTicket, 2000);
  assert.equal(find("purple", "large")!.pricePerTicket, 4000);
  const bingoPrizes = cfg.bingoPrizes as Record<string, number>;
  assert.equal(bingoPrizes.yellow, 100000);
  assert.equal(bingoPrizes.white, 50000);
  assert.equal(bingoPrizes.purple, 250000);
});

// C2-regresjons-test: verifiser at engine sin extractTicketCatalog faktisk
// kan parse output-en. Hvis ikke vil purchase-flow feile med
// "Spillets ticket-konfig er ikke satt".
test("C2: bridge-output kompatibel med engine.extractTicketCatalog (kontrakt)", () => {
  const cat = makeCatalogEntry({
    ticketColors: ["gul", "hvit", "lilla"],
    ticketPricesCents: { gul: 1000, hvit: 500, lilla: 2500 },
    prizesCents: {
      rad1: 5000,
      rad2: 7500,
      rad3: 10000,
      rad4: 15000,
      bingo: { gul: 100000, hvit: 50000, lilla: 250000 },
    },
  });
  const cfg = buildTicketConfigFromCatalog(cat);
  // Replisere engine sin parse-logikk fra
  // Game1TicketPurchaseService.extractTicketCatalog (linje 1191-1226).
  const list = (cfg as { ticketTypesData?: unknown }).ticketTypesData;
  assert.ok(Array.isArray(list), "ticketTypesData må være array");
  const parsed: Array<{ color: string; size: string; priceCents: number }> = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    const color = typeof i.color === "string" ? i.color.trim() : "";
    const sizeRaw = typeof i.size === "string" ? i.size.toLowerCase() : "";
    const size = sizeRaw === "small" || sizeRaw === "large" ? sizeRaw : null;
    let priceCents: number | null = null;
    for (const key of ["priceCents", "priceCentsEach", "pricePerTicket", "price"]) {
      const val = i[key];
      if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
        priceCents = Math.round(val);
        break;
      }
    }
    if (!color || !size || priceCents === null) continue;
    parsed.push({ color, size, priceCents });
  }
  assert.equal(parsed.length, 6, "engine skal kunne parse alle 6 entries");
  const catalogByKey = new Map<string, number>();
  for (const item of parsed) {
    catalogByKey.set(`${item.color}:${item.size}`, item.priceCents);
  }
  assert.equal(catalogByKey.get("yellow:small"), 1000);
  assert.equal(catalogByKey.get("yellow:large"), 2000);
  assert.equal(catalogByKey.get("purple:large"), 5000);
});

test("buildTicketConfigFromCatalog: bonus-spill aktivert legges på", () => {
  const catalog = makeCatalogEntry({
    bonusGameSlug: "wheel_of_fortune",
    bonusGameEnabled: true,
  });
  const cfg = buildTicketConfigFromCatalog(catalog);
  // Tolkning A (2026-05-07): bonus-shape inkluderer overrideApplied-flagg.
  assert.deepEqual(cfg.bonusGame, {
    slug: "wheel_of_fortune",
    enabled: true,
    overrideApplied: false,
  });
});

test("buildTicketConfigFromCatalog: bonus-slug satt men disabled → bonusGame mangler", () => {
  const catalog = makeCatalogEntry({
    bonusGameSlug: "wheel_of_fortune",
    bonusGameEnabled: false,
  });
  const cfg = buildTicketConfigFromCatalog(catalog);
  assert.equal(cfg.bonusGame, undefined);
});

test("buildJackpotConfigFromOverride: null → tom obj", () => {
  assert.deepEqual(buildJackpotConfigFromOverride(null), {});
});

test("buildJackpotConfigFromOverride: oversetter farger til engelsk", () => {
  // H1-fix (2026-05-07): primær-keys er `prizeByColor` + `draw` (engine-
  // leselig). Backward-compat alias-keys (`jackpotPrize` + `jackpotDraw`)
  // bevares også for admin-tooling.
  const cfg = buildJackpotConfigFromOverride({
    draw: 50,
    prizesCents: { gul: 100000, hvit: 50000, lilla: 200000 },
  });
  // Primær-keys (engine-shape)
  assert.equal(cfg.draw, 50);
  assert.deepEqual(cfg.prizeByColor, {
    yellow: 100000,
    white: 50000,
    purple: 200000,
  });
  // Backward-compat alias-keys
  assert.equal(cfg.jackpotDraw, 50);
  assert.deepEqual(cfg.jackpotPrize, {
    yellow: 100000,
    white: 50000,
    purple: 200000,
  });
});

// H1-regresjons-test: verifiser at engine sin resolveJackpotConfig finner
// jackpot-data i ticket_config_json under spill1.jackpot.
test("H1: buildEngineTicketConfig embedder jackpot under spill1.jackpot (engine kan parse)", async () => {
  const { resolveJackpotConfig } = await import("./Game1DrawEngineHelpers.js");
  const { buildEngineTicketConfig } = await import("./GamePlanEngineBridge.js");
  const cat = makeCatalogEntry({
    ticketColors: ["gul", "hvit"],
    ticketPricesCents: { gul: 1000, hvit: 500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 50000 },
    },
  });
  const override = {
    draw: 56,
    prizesCents: { gul: 600000, hvit: 300000 },
  };
  const cfg = buildEngineTicketConfig(cat, override);
  const resolved = resolveJackpotConfig(cfg);
  assert.ok(resolved, "engine skal finne jackpot under spill1.jackpot");
  assert.equal(resolved!.draw, 56);
  assert.equal(resolved!.prizeByColor.yellow, 600000);
  assert.equal(resolved!.prizeByColor.white, 300000);
});

test("H1: buildEngineTicketConfig uten jackpot-override har ticketColors[]-blokk men ikke jackpot", async () => {
  // Pilot-fix (2026-05-08): `spill1`-wrapper inneholder NÅ alltid
  // `ticketColors[]` for engine-payout-pathen. Jackpot legges på toppen
  // når relevant. Originale H1-test asserterte spill1 === undefined når
  // jackpot mangler — den invariant er BRUT med vilje fordi engine
  // trenger ticketColors[] for korrekt Rad 1-4 + Fullt Hus-payout.
  const { buildEngineTicketConfig } = await import("./GamePlanEngineBridge.js");
  const cat = makeCatalogEntry();
  const cfg = buildEngineTicketConfig(cat, null);
  const spill1 = (cfg as Record<string, unknown>).spill1 as
    | Record<string, unknown>
    | undefined;
  assert.ok(spill1, "spill1-blokk skal eksistere (pilot-fix)");
  assert.ok(
    Array.isArray(spill1.ticketColors),
    "spill1.ticketColors skal være array",
  );
  assert.equal(
    spill1.jackpot,
    undefined,
    "spill1.jackpot skal mangle uten override",
  );
});

test("createScheduledGameForPlanRunPosition: happy path oppretter rad", async () => {
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const { bridge, queries } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-1",
      business_date: "2026-05-07",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-1",
  });

  const result = await bridge.createScheduledGameForPlanRunPosition(
    "run-1",
    1,
  );

  assert.equal(result.reused, false);
  assert.equal(result.catalogEntry.id, "gc-1");
  assert.ok(result.scheduledGameId.length > 0);

  const insertQ = queries.find((q) =>
    /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql),
  );
  assert.ok(insertQ, "INSERT skal kjøres");
  const params = insertQ!.params!;
  // Pilot-fix (2026-05-08): game_config_json flyttet fra inline NULL i
  // SQL til ny $15-parameter. Catalog/plan_run/plan_position skiftet.
  // params: [id, sub_game_index, sub_game_name, custom_game_name, day,
  //          start, end, notif_seconds, ticket_config, jackpot_config,
  //          game_mode, master_hall, group_hall, participating,
  //          game_config, catalog_id, plan_run_id, plan_position]
  assert.equal(params[1], 0); // sub_game_index = position-1
  assert.equal(params[2], "Innsatsen"); // sub_game_name
  assert.equal(params[3], null); // custom_game_name
  assert.equal(params[4], "2026-05-07"); // scheduled_day
  assert.equal(params[10], "Manual"); // game_mode
  assert.equal(params[11], "hall-1"); // master_hall_id
  assert.equal(params[12], "hg-1"); // group_hall_id
  // participating_halls_json
  assert.deepEqual(JSON.parse(params[13] as string), ["hall-1"]);
  // Pilot-fix: game_config_json bærer spill1.ticketColors[]
  const gameCfg = JSON.parse(params[14] as string);
  assert.equal(gameCfg.catalogId, "gc-1");
  assert.ok(gameCfg.spill1, "game_config skal ha spill1-blokk");
  assert.ok(
    Array.isArray(gameCfg.spill1.ticketColors),
    "game_config.spill1.ticketColors skal være array",
  );
  assert.equal(params[15], "gc-1"); // catalog_entry_id
  assert.equal(params[16], "run-1"); // plan_run_id
  assert.equal(params[17], 1); // plan_position
  // ticket_config_json contains catalog mapping
  const ticketCfg = JSON.parse(params[8] as string);
  assert.equal(ticketCfg.catalogId, "gc-1");
  // C2-fix: ticketTypesData er array-of-objects (ikke record)
  assert.ok(Array.isArray(ticketCfg.ticketTypesData));
  const yellowSmall = (ticketCfg.ticketTypesData as Array<{
    color: string;
    size: string;
    pricePerTicket: number;
  }>).find((e) => e.color === "yellow" && e.size === "small");
  assert.ok(yellowSmall);
  assert.equal(yellowSmall!.pricePerTicket, 1000);
  // bingoPrizes per farge (Fullt hus)
  assert.equal(ticketCfg.bingoPrizes.yellow, 200000);
});

test("createScheduledGameForPlanRunPosition: idempotent retry — eksisterende rad gjenbrukes", async () => {
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const { bridge, queries } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-1",
      business_date: "2026-05-07",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: { id: "sg-existing", catalog_entry_id: "gc-1" },
    hallGroupId: "hg-1",
  });

  const result = await bridge.createScheduledGameForPlanRunPosition(
    "run-1",
    1,
  );

  assert.equal(result.reused, true);
  assert.equal(result.scheduledGameId, "sg-existing");
  assert.equal(result.catalogEntry.id, "gc-1");

  // Skal IKKE være INSERT i queries
  const insertQ = queries.find((q) =>
    /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql),
  );
  assert.equal(insertQ, undefined, "INSERT skal IKKE kjøres ved retry");
});

test("createScheduledGameForPlanRunPosition: jackpot-game uten override → JACKPOT_SETUP_REQUIRED", async () => {
  const jackpotCatalog = makeCatalogEntry({
    id: "gc-jackpot",
    slug: "jackpot",
    displayName: "Jackpot",
    requiresJackpotSetup: true,
  });
  const plan = makePlanWithItems([{ catalogEntry: jackpotCatalog }]);
  const { bridge } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-1",
      business_date: "2026-05-07",
      jackpot_overrides_json: {}, // ingen override
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-1",
  });

  await assert.rejects(
    () => bridge.createScheduledGameForPlanRunPosition("run-1", 1),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "JACKPOT_SETUP_REQUIRED");
      return true;
    },
  );
});

test("createScheduledGameForPlanRunPosition: jackpot-game med override → mappes til jackpot_config_json", async () => {
  const jackpotCatalog = makeCatalogEntry({
    id: "gc-jackpot",
    slug: "jackpot",
    displayName: "Jackpot",
    ticketColors: ["gul", "hvit", "lilla"],
    requiresJackpotSetup: true,
  });
  const plan = makePlanWithItems([{ catalogEntry: jackpotCatalog }]);
  const { bridge, queries } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-1",
      business_date: "2026-05-07",
      jackpot_overrides_json: {
        "1": {
          draw: 50,
          prizesCents: { gul: 100000, hvit: 50000, lilla: 250000 },
        },
      },
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-1",
  });

  const result = await bridge.createScheduledGameForPlanRunPosition(
    "run-1",
    1,
  );

  assert.equal(result.reused, false);
  const insertQ = queries.find((q) =>
    /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql),
  );
  // jackpot_config_json (kolonne 9) — backward-compat: admin-tooling
  // forventer fortsatt jackpotPrize/jackpotDraw på top-level her.
  const jackpotCfg = JSON.parse(insertQ!.params![9] as string);
  assert.equal(jackpotCfg.jackpotDraw, 50);
  assert.deepEqual(jackpotCfg.jackpotPrize, {
    yellow: 100000,
    white: 50000,
    purple: 250000,
  });
  // H1-fix: ekte engine-leselig location er ticket_config_json under
  // spill1.jackpot — verifiser at det også er skrevet dit.
  const ticketCfg = JSON.parse(insertQ!.params![8] as string);
  assert.ok(ticketCfg.spill1, "spill1-wrapper i ticket-config");
  assert.equal(ticketCfg.spill1.jackpot.draw, 50);
  assert.deepEqual(ticketCfg.spill1.jackpot.prizeByColor, {
    yellow: 100000,
    white: 50000,
    purple: 250000,
  });
});

test("createScheduledGameForPlanRunPosition: hall uten group-medlemskap → HALL_NOT_IN_GROUP", async () => {
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const { bridge } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-1",
      business_date: "2026-05-07",
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

test("createScheduledGameForPlanRunPosition: ukjent run → GAME_PLAN_RUN_NOT_FOUND", async () => {
  const { bridge } = makeBridge({
    runRow: null,
    plan: null,
  });

  await assert.rejects(
    () => bridge.createScheduledGameForPlanRunPosition("run-missing", 1),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "GAME_PLAN_RUN_NOT_FOUND");
      return true;
    },
  );
});

test("createScheduledGameForPlanRunPosition: ugyldig position → INVALID_INPUT", async () => {
  const { bridge } = makeBridge({});

  await assert.rejects(
    () => bridge.createScheduledGameForPlanRunPosition("run-1", 0),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_INPUT");
      return true;
    },
  );
});

test("getJackpotConfigForPosition: catalog-spill uten override returnerer null", async () => {
  const { bridge } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-1",
      business_date: "2026-05-07",
      jackpot_overrides_json: {},
    },
  });

  const result = await bridge.getJackpotConfigForPosition("run-1", 1);
  assert.equal(result, null);
});

test("getJackpotConfigForPosition: returnerer override når den finnes", async () => {
  const { bridge } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-1",
      business_date: "2026-05-07",
      jackpot_overrides_json: {
        "2": {
          draw: 60,
          prizesCents: { gul: 50000 },
        },
      },
    },
  });

  const result = await bridge.getJackpotConfigForPosition("run-1", 2);
  assert.ok(result);
  assert.equal(result!.draw, 60);
  assert.equal(result!.prizesCents.gul, 50000);
});

// ── Tolkning A (2026-05-07): per-item bonus-override forrang ────────────

test("Tolkning A: bonus_game_override forrang over catalog.bonusGameSlug", async () => {
  const catalog = makeCatalogEntry({
    bonusGameSlug: "treasure_chest",
    bonusGameEnabled: true,
  });
  const plan = makePlanWithItems([
    { catalogEntry: catalog, bonusGameOverride: "wheel_of_fortune" },
  ]);
  const { bridge, queries } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-1",
      business_date: "2026-05-07",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-1",
  });
  await bridge.createScheduledGameForPlanRunPosition("run-1", 1);
  const insertQ = queries.find((q) =>
    /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql),
  );
  assert.ok(insertQ, "INSERT skal kjøres");
  const ticketCfg = JSON.parse(insertQ!.params![8] as string);
  assert.deepEqual(ticketCfg.bonusGame, {
    slug: "wheel_of_fortune",
    enabled: true,
    overrideApplied: true,
  });
});

test("Tolkning A: bonus_game_override null faller tilbake til catalog.bonusGameSlug", async () => {
  const catalog = makeCatalogEntry({
    bonusGameSlug: "color_draft",
    bonusGameEnabled: true,
  });
  const plan = makePlanWithItems([
    { catalogEntry: catalog, bonusGameOverride: null },
  ]);
  const { bridge, queries } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-1",
      business_date: "2026-05-07",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-1",
  });
  await bridge.createScheduledGameForPlanRunPosition("run-1", 1);
  const insertQ = queries.find((q) =>
    /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql),
  );
  const ticketCfg = JSON.parse(insertQ!.params![8] as string);
  assert.deepEqual(ticketCfg.bonusGame, {
    slug: "color_draft",
    enabled: true,
    overrideApplied: false,
  });
});

test("Tolkning A: ingen bonus i catalog OG ingen override → bonusGame fraværende", async () => {
  const catalog = makeCatalogEntry({
    bonusGameSlug: null,
    bonusGameEnabled: false,
  });
  const plan = makePlanWithItems([
    { catalogEntry: catalog, bonusGameOverride: null },
  ]);
  const { bridge, queries } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-1",
      business_date: "2026-05-07",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-1",
  });
  await bridge.createScheduledGameForPlanRunPosition("run-1", 1);
  const insertQ = queries.find((q) =>
    /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql),
  );
  const ticketCfg = JSON.parse(insertQ!.params![8] as string);
  assert.equal(
    ticketCfg.bonusGame,
    undefined,
    "bonusGame skal være fraværende når begge kilder er null",
  );
});

test("Tolkning A: catalog.bonusGameEnabled=false overstyrer override (off-switch)", async () => {
  const catalog = makeCatalogEntry({
    bonusGameSlug: "mystery",
    bonusGameEnabled: false,
  });
  const plan = makePlanWithItems([
    { catalogEntry: catalog, bonusGameOverride: "wheel_of_fortune" },
  ]);
  const { bridge, queries } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-1",
      business_date: "2026-05-07",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "hg-1",
  });
  await bridge.createScheduledGameForPlanRunPosition("run-1", 1);
  const insertQ = queries.find((q) =>
    /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql),
  );
  const ticketCfg = JSON.parse(insertQ!.params![8] as string);
  assert.equal(
    ticketCfg.bonusGame,
    undefined,
    "catalog-disabled skal vinne over override (off-switch-semantikk)",
  );
});

test("getJackpotConfigForPosition: tolererer snake_case prizes_cents fra DB", async () => {
  const { bridge } = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-1",
      business_date: "2026-05-07",
      jackpot_overrides_json: {
        "1": {
          draw: 55,
          prizes_cents: { hvit: 75000 },
        },
      },
    },
  });

  const result = await bridge.getJackpotConfigForPosition("run-1", 1);
  assert.ok(result);
  assert.equal(result!.draw, 55);
  assert.equal(result!.prizesCents.hvit, 75000);
});

// ── Auto-multiplikator (Tobias 2026-05-07) ──────────────────────────────

test("Auto-mode: bingoPrizes regnes ut fra bingoBase × (ticketPrice/500)", () => {
  // hvit 5kr → base × 1, gul 10kr → base × 2, lilla 15kr → base × 3
  const cat = makeCatalogEntry({
    ticketColors: ["gul", "hvit", "lilla"],
    ticketPricesCents: { gul: 1000, hvit: 500, lilla: 1500 },
    prizeMultiplierMode: "auto",
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingoBase: 100000, // base 1000 kr (gjelder hvit 5 kr)
      bingo: {},
    },
  });
  const cfg = buildTicketConfigFromCatalog(cat);
  const bingoPrizes = cfg.bingoPrizes as Record<string, number>;
  assert.equal(bingoPrizes.white, 100000); // 5 kr × 1
  assert.equal(bingoPrizes.yellow, 200000); // 10 kr × 2
  assert.equal(bingoPrizes.purple, 300000); // 15 kr × 3
  // bingoBase eksponeres i config for diagnostikk
  assert.equal(cfg.bingoBase, 100000);
  assert.equal(cfg.prizeMultiplierMode, "auto");
});

test("Auto-mode: bingoBase = 0 produserer tom bingoPrizes", () => {
  const cat = makeCatalogEntry({
    prizeMultiplierMode: "auto",
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingoBase: 0,
      bingo: {},
    },
  });
  const cfg = buildTicketConfigFromCatalog(cat);
  const bingoPrizes = cfg.bingoPrizes as Record<string, number>;
  assert.deepEqual(bingoPrizes, {});
});

test("Explicit-mode: bingoPrizes leses fra prizesCents.bingo per farge (Trafikklys-stil)", () => {
  const cat = makeCatalogEntry({
    ticketColors: ["gul", "hvit", "lilla"],
    ticketPricesCents: { gul: 1500, hvit: 1500, lilla: 1500 },
    prizeMultiplierMode: "explicit_per_color",
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      // ikke bingoBase — eksplisitt per-farge
      bingo: { gul: 50000, hvit: 30000, lilla: 70000 },
    },
  });
  const cfg = buildTicketConfigFromCatalog(cat);
  const bingoPrizes = cfg.bingoPrizes as Record<string, number>;
  assert.equal(bingoPrizes.yellow, 50000);
  assert.equal(bingoPrizes.white, 30000);
  assert.equal(bingoPrizes.purple, 70000);
  // bingoBase eksponeres IKKE i explicit-modus
  assert.equal(cfg.bingoBase, undefined);
  assert.equal(cfg.prizeMultiplierMode, "explicit_per_color");
});
