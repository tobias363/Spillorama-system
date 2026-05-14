/**
 * F2 (BUG-F2, Tobias-rapport 2026-05-14):
 *
 * Pre-engine ticket-config-binding-hook for GamePlanEngineBridge. Hook
 * binder per-rom entryFee + variantConfig fra `ticket_config_json` POST-
 * INSERT av scheduled-game-rad, FØR engine.startGame trigges av master.
 * Dette dekker pre-game-vinduet hvor spillere kan kjøpe bonger via
 * buy-popup — uten denne hooken viser klient `20 kr` for Yellow
 * (10 × yellow-multiplier(2) = 20) istedenfor riktige 10 kr.
 *
 * Mirrer `Game1MasterControlService.onEngineStarted.test.ts` (PR #1375)
 * eksakt mønster — to faser med samme test-coverage:
 *
 * Dekning:
 *   1. Hook kalles med {scheduledGameId, roomCode, ticketConfigJson}
 *      POST-INSERT i suksess-path.
 *   2. Hook-feil er soft-fail — påvirker IKKE bridge-resultat eller
 *      scheduled-game-INSERT.
 *   3. Ingen hook satt → bridge fungerer som før (legacy-mode).
 *   4. setOnScheduledGameCreated(undefined) clearer hooken.
 *   5. Hook kalles IKKE for idempotent retry (eksisterende rad gjenbrukes,
 *      hook har allerede kjørt for original-INSERT).
 *
 * Object.create-pattern + stub-pool — ingen Postgres-oppkopling.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GameCatalogService } from "./GameCatalogService.js";
import { GamePlanService } from "./GamePlanService.js";
import { GamePlanRunService } from "./GamePlanRunService.js";
import { GamePlanEngineBridge } from "./GamePlanEngineBridge.js";
import type { GameCatalogEntry } from "./gameCatalog.types.js";
import type { GamePlanWithItems } from "./gamePlan.types.js";

// ── helpers (samme mønster som GamePlanEngineBridge.test.ts) ──────────────

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
    ticketColors: ["gul", "hvit", "lilla"],
    ticketPricesCents: { gul: 1000, hvit: 500, lilla: 1500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 100000, lilla: 300000 },
    },
    prizeMultiplierMode: "explicit_per_color",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-14T07:55:00Z",
    updatedAt: "2026-05-14T07:55:00Z",
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
    hallId: "hall-1",
    groupOfHallsId: null,
    weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    startTime: "11:00",
    endTime: "21:00",
    isActive: true,
    createdAt: "2026-05-14T07:55:00Z",
    updatedAt: "2026-05-14T07:55:00Z",
    createdByUserId: "u-1",
    items: items.map((it, idx) => ({
      id: `item-${idx + 1}`,
      planId: "gp-1",
      position: idx + 1,
      gameCatalogId: it.catalogEntry.id,
      bonusGameOverride: null,
      notes: null,
      createdAt: "2026-05-14T07:55:00Z",
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
  runRow?: Record<string, unknown> | null;
  plan?: GamePlanWithItems | null;
  existingScheduled?: { id: string; catalog_entry_id: string } | null;
  hallGroupId?: string | null;
  groupHallMembers?: string[];
  onScheduledGameCreated?: (input: {
    scheduledGameId: string;
    roomCode: string;
    ticketConfigJson: unknown;
  }) => Promise<void> | void;
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
      if (
        /SELECT\s+m?\.?group_id/i.test(sql) &&
        /app_hall_group_members/i.test(sql) &&
        /WHERE\s+m\.hall_id\s*=/i.test(sql)
      ) {
        if (options.hallGroupId !== null && options.hallGroupId !== undefined) {
          return { rows: [{ group_id: options.hallGroupId }] };
        }
        return { rows: [] };
      }
      if (
        /SELECT\s+master_hall_id/i.test(sql) &&
        /app_hall_groups/i.test(sql) &&
        /WHERE\s+id\s*=/i.test(sql) &&
        !/LEFT JOIN/i.test(sql)
      ) {
        if (
          options.hallGroupId !== null &&
          options.hallGroupId !== undefined
        ) {
          return { rows: [{ master_hall_id: null }] };
        }
        return { rows: [] };
      }
      if (
        /SELECT\s+m\.hall_id,\s*h\.name/i.test(sql) &&
        /app_hall_group_members/i.test(sql)
      ) {
        const masterId =
          (options.runRow?.hall_id as string | undefined) ?? null;
        if (options.groupHallMembers !== undefined) {
          return {
            rows: options.groupHallMembers.map((id) => ({
              hall_id: id,
              hall_name: id,
              is_active: true,
            })),
          };
        }
        if (masterId) {
          return {
            rows: [{ hall_id: masterId, hall_name: masterId, is_active: true }],
          };
        }
        return { rows: [] };
      }
      // resolveGoHMasterHallId: SELECT g.master_hall_id ... LEFT JOIN.
      if (
        /SELECT\s+g\.master_hall_id/i.test(sql) &&
        /app_hall_groups/i.test(sql) &&
        /LEFT JOIN/i.test(sql)
      ) {
        return { rows: [{ master_hall_id: null }] };
      }
      // releaseStaleRoomCodeBindings — SELECT for stale rows.
      if (
        /SELECT\s+id/i.test(sql) &&
        /app_game1_scheduled_games/i.test(sql) &&
        /room_code\s*=/i.test(sql)
      ) {
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
    onScheduledGameCreated: options.onScheduledGameCreated,
  });

  return { bridge, queries };
}

const defaultRunRow = {
  id: "run-1",
  plan_id: "gp-1",
  hall_id: "hall-1",
  business_date: "2026-05-14",
  jackpot_overrides_json: null,
};

// ── Hook kalles i suksess-path ───────────────────────────────────────────

test("onScheduledGameCreated hook kalles med scheduledGameId + roomCode + ticketConfigJson POST-INSERT", async () => {
  const calls: Array<{
    scheduledGameId: string;
    roomCode: string;
    ticketConfigJson: unknown;
  }> = [];

  const { bridge } = makeBridge({
    runRow: defaultRunRow,
    plan: makePlanWithItems([{ catalogEntry: makeCatalogEntry() }]),
    hallGroupId: "grp-1",
    onScheduledGameCreated: async (input) => {
      calls.push(input);
    },
  });

  const result = await bridge.createScheduledGameForPlanRunPosition("run-1", 1);

  assert.equal(result.reused, false);
  assert.equal(calls.length, 1, "hook skal være kalt akkurat én gang");
  const call = calls[0]!;
  assert.equal(call.scheduledGameId, result.scheduledGameId);
  assert.ok(call.roomCode, "roomCode skal være satt");
  assert.ok(
    call.roomCode.startsWith("BINGO_"),
    `roomCode skal være canonical bingo-rom, fikk: ${call.roomCode}`,
  );
  assert.ok(
    call.ticketConfigJson && typeof call.ticketConfigJson === "object",
    "ticketConfigJson skal være object",
  );
});

// ── Hook får ticket_config_json som bridgen skrev ─────────────────────────

test("onScheduledGameCreated får samme ticket_config_json som ble INSERT-et til DB", async () => {
  let captured: unknown = null;

  const catalog = makeCatalogEntry({
    ticketColors: ["gul", "hvit", "lilla"],
    ticketPricesCents: { gul: 1000, hvit: 500, lilla: 1500 },
  });

  const { bridge } = makeBridge({
    runRow: defaultRunRow,
    plan: makePlanWithItems([{ catalogEntry: catalog }]),
    hallGroupId: "grp-1",
    onScheduledGameCreated: async (input) => {
      captured = input.ticketConfigJson;
    },
  });

  await bridge.createScheduledGameForPlanRunPosition("run-1", 1);

  assert.ok(captured && typeof captured === "object");
  const cfg = captured as Record<string, unknown>;
  assert.ok(Array.isArray(cfg.ticketTypesData));
  const ticketTypesData = cfg.ticketTypesData as Array<{
    color: string;
    size: "small" | "large";
    pricePerTicket: number;
  }>;
  // Skal ha entries for alle 3 farger × 2 størrelser = 6 entries.
  assert.equal(ticketTypesData.length, 6);
  const find = (color: string, size: "small" | "large") =>
    ticketTypesData.find((e) => e.color === color && e.size === size);
  // Bekreft per-farge priser (i øre) er propagert.
  assert.equal(find("yellow", "small")!.pricePerTicket, 1000); // gul → yellow
  assert.equal(find("white", "small")!.pricePerTicket, 500); // hvit → white
  assert.equal(find("purple", "small")!.pricePerTicket, 1500); // lilla → purple
});

// ── Hook-feil er soft-fail ────────────────────────────────────────────────

test("onScheduledGameCreated hook som kaster gjør IKKE bridge-resultat til feil", async () => {
  const { bridge } = makeBridge({
    runRow: defaultRunRow,
    plan: makePlanWithItems([{ catalogEntry: makeCatalogEntry() }]),
    hallGroupId: "grp-1",
    onScheduledGameCreated: async () => {
      throw new Error("Simulert hook-feil");
    },
  });

  // Bridge skal returnere normal CreateScheduledGameResult selv om
  // hooken kaster — INSERT er allerede committed.
  const result = await bridge.createScheduledGameForPlanRunPosition("run-1", 1);
  assert.equal(result.reused, false);
  assert.ok(result.scheduledGameId);
  assert.ok(result.catalogEntry);
});

// ── Synkron throw fra hook er også soft-fail ──────────────────────────────

test("onScheduledGameCreated synkron throw er soft-fail (await Promise.resolve wrapping)", async () => {
  const { bridge } = makeBridge({
    runRow: defaultRunRow,
    plan: makePlanWithItems([{ catalogEntry: makeCatalogEntry() }]),
    hallGroupId: "grp-1",
    onScheduledGameCreated: () => {
      throw new Error("Synkron throw");
    },
  });

  const result = await bridge.createScheduledGameForPlanRunPosition("run-1", 1);
  assert.equal(result.reused, false);
});

// ── Ingen hook → ingen no-op-kall ─────────────────────────────────────────

test("ingen onScheduledGameCreated satt → bridge fungerer som før (legacy-mode)", async () => {
  const { bridge } = makeBridge({
    runRow: defaultRunRow,
    plan: makePlanWithItems([{ catalogEntry: makeCatalogEntry() }]),
    hallGroupId: "grp-1",
    // onScheduledGameCreated ikke satt
  });

  const result = await bridge.createScheduledGameForPlanRunPosition("run-1", 1);
  assert.equal(result.reused, false);
});

// ── setOnScheduledGameCreated kan settes etter konstruktør ────────────────

test("setOnScheduledGameCreated kan binde hook POST-konstruktor (DI-mønster)", async () => {
  const calls: Array<{ scheduledGameId: string; roomCode: string }> = [];

  const { bridge } = makeBridge({
    runRow: defaultRunRow,
    plan: makePlanWithItems([{ catalogEntry: makeCatalogEntry() }]),
    hallGroupId: "grp-1",
    // onScheduledGameCreated IKKE satt i constructor.
  });

  // Bind hook senere via setter.
  bridge.setOnScheduledGameCreated(async ({ scheduledGameId, roomCode }) => {
    calls.push({ scheduledGameId, roomCode });
  });

  await bridge.createScheduledGameForPlanRunPosition("run-1", 1);

  assert.equal(calls.length, 1);
});

// ── setOnScheduledGameCreated(undefined) clearer hooken ───────────────────

test("setOnScheduledGameCreated(undefined) clearer eksisterende hook", async () => {
  let called = 0;
  const { bridge } = makeBridge({
    runRow: defaultRunRow,
    plan: makePlanWithItems([{ catalogEntry: makeCatalogEntry() }]),
    hallGroupId: "grp-1",
    onScheduledGameCreated: async () => {
      called++;
    },
  });

  // Clear hook.
  bridge.setOnScheduledGameCreated(undefined);

  await bridge.createScheduledGameForPlanRunPosition("run-1", 1);
  assert.equal(called, 0, "hook skal IKKE kalles etter clear");
});

// ── Hook kalles IKKE for idempotent retry ─────────────────────────────────

test("idempotent retry (reused: true) trigger IKKE hook — den har allerede kjørt for original-INSERT", async () => {
  const calls: Array<{ scheduledGameId: string }> = [];

  const catalog = makeCatalogEntry();
  const { bridge } = makeBridge({
    runRow: defaultRunRow,
    plan: makePlanWithItems([{ catalogEntry: catalog }]),
    hallGroupId: "grp-1",
    // Eksisterende rad → idempotency-hit → reused: true.
    existingScheduled: { id: "g1-existing", catalog_entry_id: catalog.id },
    onScheduledGameCreated: async ({ scheduledGameId }) => {
      calls.push({ scheduledGameId });
    },
  });

  const result = await bridge.createScheduledGameForPlanRunPosition("run-1", 1);

  assert.equal(result.reused, true, "skal returnere reused: true");
  assert.equal(result.scheduledGameId, "g1-existing");
  assert.equal(
    calls.length,
    0,
    "hook skal IKKE kalles ved idempotent retry — pre-engine-binding er allerede skjedd ved original-INSERT",
  );
});

// ── Hook får canonical room_code som matcher INSERT-et ───────────────────

test("hook får canonical room_code som ble INSERT-et til DB", async () => {
  let capturedRoomCode = "";

  const { bridge, queries } = makeBridge({
    runRow: defaultRunRow,
    plan: makePlanWithItems([{ catalogEntry: makeCatalogEntry() }]),
    hallGroupId: "grp-1",
    onScheduledGameCreated: async ({ roomCode }) => {
      capturedRoomCode = roomCode;
    },
  });

  await bridge.createScheduledGameForPlanRunPosition("run-1", 1);

  // Finn INSERT-query og verifiser room_code-param.
  const insertQuery = queries.find((q) =>
    /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql),
  );
  assert.ok(insertQuery, "INSERT skal ha kjørt");
  // room_code er siste param (param[19] i 1-indexed = index 18 i array).
  const params = insertQuery.params!;
  const insertedRoomCode = params[params.length - 1] as string;
  assert.equal(
    capturedRoomCode,
    insertedRoomCode,
    "hook skal motta samme room_code som ble INSERT-et",
  );
});
