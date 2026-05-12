/**
 * F-NEW-3 (Tobias-direktiv 2026-05-12, pilot-blokker): bridge "tar over"
 * hall-default-rommet.
 *
 * Bakgrunn: `GamePlanEngineBridge.createScheduledGameForPlanRunPosition`
 * INSERT-er en ny rad i `app_game1_scheduled_games` med kanonisk
 * `room_code = BINGO_<groupId>`. Unique-indeksen
 * `idx_app_game1_scheduled_games_room_code` (partial: WHERE room_code
 * IS NOT NULL AND status NOT IN ('completed','cancelled')) blokkerer
 * INSERT-en hvis en STALE aktiv rad allerede holder samme room_code.
 *
 * Pre-F-NEW-3 atferd: bridge degraderte til `room_code = NULL`
 * (lazy-binding fallback). Klienter kunne ikke joine fordi auto-draw-tick
 * emittet til `io.to(NULL)`. Pilot-blokker per Tobias-test 2026-05-12.
 *
 * F-NEW-3 fix: før INSERT release-er bridgen alle stale aktive rader som
 * holder samme room_code men peker på ANNEN (plan_run_id, plan_position).
 * Hver release setter `status='cancelled'` + skriver audit-entry. Etter
 * release-pass lykkes INSERT med room_code satt opp-front.
 *
 * Test-scenarier:
 *   - Ingen stale rader → INSERT med room_code lykkes uten release-pass-
 *     bivirkninger (regresjon mot multiHall.test.ts F-NEW-2-tester).
 *   - Én stale rad → release cancellerer den, INSERT lykkes.
 *   - Flere stale rader → alle cancelleres, INSERT lykkes.
 *   - Idempotent retry → eksisterende rad for samme (run, pos) reuses,
 *     ingen release-pass kjøres.
 *   - 23505 etter release-pass → retry én gang; hvis fortsatt 23505 →
 *     ROOM_CODE_CONFLICT-feil (ikke fallback til NULL).
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

// ── Helpers (kopiert fra multiHall.test.ts for å unngå cross-test-import) ──

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

/**
 * Stale rad som ligger og blokkerer room_code. Test-stub returnerer denne
 * fra `releaseStaleRoomCodeBindings`-SELECT-en.
 */
interface StaleScheduledRow {
  id: string;
  status: string;
  plan_run_id: string | null;
  plan_position: number | null;
  master_hall_id: string;
  group_hall_id: string;
}

interface BridgeOptions {
  runRow?: Record<string, unknown> | null;
  plan?: GamePlanWithItems | null;
  existingScheduled?: { id: string; catalog_entry_id: string } | null;
  hallGroupId?: string | null;
  groupHallMembers?: string[];
  /**
   * Rader som stub-en returnerer fra `releaseStaleRoomCodeBindings`-SELECT.
   * Hver rad simuleres som en stale aktiv scheduled-game som holder samme
   * room_code men ANNEN (run, pos).
   *
   * Stub-en simulerer også UPDATE-RETURNING-en: hver rad i `staleRows`
   * returneres som RETURNING-row med mindre `simulateRaceCancelled.has(id)`
   * — da returneres tom rows (race-vinner cancellet allerede).
   */
  staleRows?: StaleScheduledRow[];
  simulateRaceCancelled?: Set<string>;
  /**
   * Sett til true for å simulere at INSERT (etter første release-pass)
   * feiler med 23505. Stub-en kaster så på første INSERT. Hvis
   * `secondInsertOk` er true, kaster den IKKE på andre INSERT (retry-
   * pathen). Hvis false, kaster den begge ganger → bridge skal kaste
   * ROOM_CODE_CONFLICT.
   */
  simulateFirstInsert23505?: boolean;
  secondInsertOk?: boolean;
}

interface BridgeBuild {
  bridge: GamePlanEngineBridge;
  queries: CapturedQuery[];
  /** Map fra stale-game-id → antall UPDATE-kall mot raden. */
  updateCallCount: Map<string, number>;
  /** Tellere for audit-INSERTs. */
  auditInsertCount: number;
  /** Tellere for scheduled-games-INSERTs. */
  scheduledInsertCount: number;
}

function makeBridge(options: BridgeOptions = {}): BridgeBuild {
  const queries: CapturedQuery[] = [];
  const updateCallCount = new Map<string, number>();
  let auditInsertCount = 0;
  let scheduledInsertCount = 0;

  const stubPool = {
    async query(textOrConfig: unknown, params?: unknown[]): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      queries.push({ sql, params });

      // SELECT run-rad
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

      // Idempotency-sjekk: SELECT eksisterende (run, position)
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
        /SELECT\s+m?\.?group_id/i.test(sql) &&
        /app_hall_group_members/i.test(sql) &&
        /WHERE\s+m\.hall_id\s*=/i.test(sql)
      ) {
        if (options.hallGroupId !== null && options.hallGroupId !== undefined) {
          return { rows: [{ group_id: options.hallGroupId }] };
        }
        return { rows: [] };
      }

      // HallGroupMembershipQuery.getActiveMembers: first query — group exists
      // check (WITHOUT LEFT JOIN — that's the resolveGoHMasterHallId path).
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

      // HallGroupMembershipQuery.getActiveMembers: members-listen
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

      // F-NEW-3 release-pass SELECT: stale aktive rader med samme room_code.
      if (
        /SELECT\s+id,\s*status,\s*plan_run_id,\s*plan_position/i.test(sql) &&
        /app_game1_scheduled_games/i.test(sql) &&
        /room_code\s*=/i.test(sql)
      ) {
        return { rows: options.staleRows ?? [] };
      }

      // F-NEW-3 release-pass UPDATE: cancel stale rad.
      if (
        /UPDATE\s+"[^"]*"\."app_game1_scheduled_games"/i.test(sql) &&
        /status\s*=\s*'cancelled'/i.test(sql) &&
        /stop_reason\s*=\s*'auto_cancelled_by_bridge_takeover'/i.test(sql)
      ) {
        const id = (params?.[0] as string) ?? "";
        updateCallCount.set(id, (updateCallCount.get(id) ?? 0) + 1);
        if (options.simulateRaceCancelled?.has(id)) {
          return { rows: [] };
        }
        return { rows: [{ id }] };
      }

      // F-NEW-3 audit-INSERT mot app_game1_master_audit.
      if (
        /INSERT INTO\s+"[^"]*"\."app_game1_master_audit"/i.test(sql)
      ) {
        auditInsertCount += 1;
        return { rowCount: 1, rows: [] };
      }

      // Scheduled-game INSERT (primær-path med room_code).
      if (
        /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(sql)
      ) {
        scheduledInsertCount += 1;
        if (
          options.simulateFirstInsert23505 &&
          scheduledInsertCount === 1
        ) {
          const err = new Error(
            "duplicate key value violates unique constraint",
          ) as Error & { code: string };
          err.code = "23505";
          throw err;
        }
        if (
          options.simulateFirstInsert23505 &&
          scheduledInsertCount === 2 &&
          options.secondInsertOk === false
        ) {
          const err = new Error(
            "duplicate key value violates unique constraint",
          ) as Error & { code: string };
          err.code = "23505";
          throw err;
        }
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

  // proxy som telles per-mutering — vi får ikke direkte updateCallCount-telling
  // ovenfor uten å lese fra closure. Vi konstruerer build-objektet etter at
  // alle closures er bundet.
  const build: BridgeBuild = {
    bridge,
    queries,
    updateCallCount,
    get auditInsertCount() {
      return auditInsertCount;
    },
    get scheduledInsertCount() {
      return scheduledInsertCount;
    },
  } as BridgeBuild;
  return build;
}

function getInsertRoomCode(queries: CapturedQuery[]): string | null {
  const insert = queries.find(
    (q) =>
      /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql) &&
      /room_code/i.test(q.sql),
  );
  if (!insert) return null;
  return (insert.params![18] as string) ?? null;
}

function countInserts(queries: CapturedQuery[]): number {
  return queries.filter((q) =>
    /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql),
  ).length;
}

function countReleaseSelects(queries: CapturedQuery[]): number {
  return queries.filter(
    (q) =>
      /SELECT\s+id,\s*status,\s*plan_run_id,\s*plan_position/i.test(q.sql) &&
      /app_game1_scheduled_games/i.test(q.sql) &&
      /room_code\s*=/i.test(q.sql),
  ).length;
}

function countCancelUpdates(queries: CapturedQuery[]): number {
  return queries.filter(
    (q) =>
      /UPDATE\s+"[^"]*"\."app_game1_scheduled_games"/i.test(q.sql) &&
      /status\s*=\s*'cancelled'/i.test(q.sql) &&
      /stop_reason\s*=\s*'auto_cancelled_by_bridge_takeover'/i.test(q.sql),
  ).length;
}

function countAuditInserts(queries: CapturedQuery[]): number {
  return queries.filter((q) =>
    /INSERT INTO\s+"[^"]*"\."app_game1_master_audit"/i.test(q.sql),
  ).length;
}

// ── Tests ────────────────────────────────────────────────────────────────

test("F-NEW-3: ingen stale rader → release-pass kjører men cancellerer ingenting, INSERT med room_code lykkes", async () => {
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const build = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-arnes",
      business_date: "2026-05-12",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "demo-pilot-goh",
    groupHallMembers: ["hall-arnes", "hall-bodo"],
    staleRows: [],
  });

  const result = await build.bridge.createScheduledGameForPlanRunPosition(
    "run-1",
    1,
  );

  assert.equal(result.reused, false);
  assert.equal(
    getInsertRoomCode(build.queries),
    "BINGO_DEMO-PILOT-GOH",
    "room_code må være satt opp-front i INSERT",
  );
  assert.equal(
    countReleaseSelects(build.queries),
    1,
    "release-pass SELECT skal kjøres én gang",
  );
  assert.equal(
    countCancelUpdates(build.queries),
    0,
    "ingen UPDATE-cancel skal kjøres når det ikke finnes stale rader",
  );
  assert.equal(
    countAuditInserts(build.queries),
    0,
    "ingen audit-INSERT når ingen rader cancelles",
  );
  assert.equal(countInserts(build.queries), 1, "kun én INSERT (scheduled-game)");
});

test("F-NEW-3: én stale rad blokkerer canonical room_code → cancellet + INSERT lykkes", async () => {
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const build = makeBridge({
    runRow: {
      id: "run-new",
      plan_id: "gp-1",
      hall_id: "hall-arnes",
      business_date: "2026-05-12",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "demo-pilot-goh",
    groupHallMembers: ["hall-arnes", "hall-bodo"],
    staleRows: [
      {
        id: "sg-stale-1",
        status: "ready_to_start",
        plan_run_id: "run-old",
        plan_position: 1,
        master_hall_id: "hall-arnes",
        group_hall_id: "demo-pilot-goh",
      },
    ],
  });

  const result = await build.bridge.createScheduledGameForPlanRunPosition(
    "run-new",
    1,
  );

  assert.equal(result.reused, false);
  assert.equal(
    getInsertRoomCode(build.queries),
    "BINGO_DEMO-PILOT-GOH",
    "room_code må fortsatt være satt etter at stale-rad er cancellet",
  );
  assert.equal(
    countCancelUpdates(build.queries),
    1,
    "én stale rad skal cancelleres",
  );
  assert.equal(
    countAuditInserts(build.queries),
    1,
    "én audit-INSERT for den cancellete raden",
  );
  assert.equal(
    countInserts(build.queries),
    1,
    "én INSERT for ny scheduled-game (ikke fallback til lazy-binding)",
  );
});

test("F-NEW-3: flere stale rader → alle cancelleres, audit-spor per rad, INSERT lykkes", async () => {
  // Edge: usannsynlig at vi har > 1 stale aktiv rad pga unique-indeksen,
  // men hvis indeks ble droppet/recreatet kunne det skje. Bridgen skal
  // håndtere det idempotent.
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const build = makeBridge({
    runRow: {
      id: "run-new",
      plan_id: "gp-1",
      hall_id: "hall-arnes",
      business_date: "2026-05-12",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "demo-pilot-goh",
    groupHallMembers: ["hall-arnes"],
    staleRows: [
      {
        id: "sg-stale-1",
        status: "running",
        plan_run_id: "run-old-1",
        plan_position: 1,
        master_hall_id: "hall-arnes",
        group_hall_id: "demo-pilot-goh",
      },
      {
        id: "sg-stale-2",
        status: "paused",
        plan_run_id: "run-old-2",
        plan_position: 3,
        master_hall_id: "hall-arnes",
        group_hall_id: "demo-pilot-goh",
      },
    ],
  });

  await build.bridge.createScheduledGameForPlanRunPosition("run-new", 1);

  assert.equal(
    countCancelUpdates(build.queries),
    2,
    "begge stale rader skal cancelleres",
  );
  assert.equal(
    countAuditInserts(build.queries),
    2,
    "audit-spor per cancellet rad",
  );
  assert.equal(
    countInserts(build.queries),
    1,
    "kun én ny INSERT (scheduled-game)",
  );
});

test("F-NEW-3: race-vinner cancellet rad allerede → UPDATE returnerer 0 rows, ingen audit-INSERT, INSERT fortsetter", async () => {
  // Mellom SELECT og UPDATE kan en annen prosess (recovery-cron etc.) ha
  // cancellet raden. UPDATE-WHERE-status-filteret håndhever at vi ikke
  // dobbel-canceller. Audit skrives kun for rader vi faktisk cancellet.
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const build = makeBridge({
    runRow: {
      id: "run-new",
      plan_id: "gp-1",
      hall_id: "hall-arnes",
      business_date: "2026-05-12",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "demo-pilot-goh",
    groupHallMembers: ["hall-arnes"],
    staleRows: [
      {
        id: "sg-stale-1",
        status: "ready_to_start",
        plan_run_id: "run-old",
        plan_position: 1,
        master_hall_id: "hall-arnes",
        group_hall_id: "demo-pilot-goh",
      },
    ],
    simulateRaceCancelled: new Set(["sg-stale-1"]),
  });

  await build.bridge.createScheduledGameForPlanRunPosition("run-new", 1);

  assert.equal(
    countCancelUpdates(build.queries),
    1,
    "UPDATE-attempt skjer fortsatt",
  );
  assert.equal(
    countAuditInserts(build.queries),
    0,
    "ingen audit-INSERT når UPDATE returnerer 0 rader (race-vinner)",
  );
  assert.equal(
    countInserts(build.queries),
    1,
    "INSERT lykkes fortsatt — room_code er frigjort av race-vinner",
  );
});

test("F-NEW-3: idempotent retry (eksisterende rad for samme run, pos) → release-pass kjøres IKKE", async () => {
  // Idempotency-pathen (SELECT linje ~844) returnerer eksisterende rad
  // FØR release-pass-SELECT. Vi skal ikke kjøre release-pass overhodet
  // når vi gjenbruker en rad — fordi vår egen rad allerede HAR
  // room_code-bindingen.
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const build = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-arnes",
      business_date: "2026-05-12",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: { id: "sg-existing", catalog_entry_id: "gc-1" },
    hallGroupId: "demo-pilot-goh",
    groupHallMembers: ["hall-arnes"],
    // staleRows er irrelevant — release-pass skal aldri kjøres
    staleRows: [
      {
        id: "sg-other",
        status: "running",
        plan_run_id: "run-X",
        plan_position: 1,
        master_hall_id: "hall-arnes",
        group_hall_id: "demo-pilot-goh",
      },
    ],
  });

  const result = await build.bridge.createScheduledGameForPlanRunPosition(
    "run-1",
    1,
  );

  assert.equal(result.reused, true);
  assert.equal(result.scheduledGameId, "sg-existing");
  assert.equal(
    countReleaseSelects(build.queries),
    0,
    "release-pass SELECT skal ALDRI kjøres ved idempotent retry",
  );
  assert.equal(
    countCancelUpdates(build.queries),
    0,
    "ingen UPDATE-cancel ved idempotent retry",
  );
  assert.equal(
    countInserts(build.queries),
    0,
    "ingen INSERT ved idempotent retry",
  );
});

test("F-NEW-3: 23505 etter release-pass → retry én gang; hvis fortsatt 23505 → ROOM_CODE_CONFLICT", async () => {
  // Pure race: en annen prosess vant room_code mellom vår release-pass
  // og INSERT, og holder den fortsatt etter retry-en. Vi skal IKKE
  // degradere til lazy-binding (room_code=null) — det brøt pilot-flyten
  // pre-F-NEW-3. I stedet kaster vi ROOM_CODE_CONFLICT med actionable
  // metadata.
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const build = makeBridge({
    runRow: {
      id: "run-new",
      plan_id: "gp-1",
      hall_id: "hall-arnes",
      business_date: "2026-05-12",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "demo-pilot-goh",
    groupHallMembers: ["hall-arnes"],
    staleRows: [],
    simulateFirstInsert23505: true,
    secondInsertOk: false,
  });

  await assert.rejects(
    () => build.bridge.createScheduledGameForPlanRunPosition("run-new", 1),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "ROOM_CODE_CONFLICT");
      const details = (err as DomainError).details as Record<
        string,
        unknown
      > | undefined;
      assert.equal(
        details?.attemptedRoomCode,
        "BINGO_DEMO-PILOT-GOH",
        "details.attemptedRoomCode skal være kanonisk kode",
      );
      assert.equal(
        details?.runId,
        "run-new",
        "details.runId skal være den nye plan-run-en",
      );
      assert.equal(details?.position, 1);
      return true;
    },
  );

  // Forventet: 2 INSERT-forsøk (initial + retry), 2 release-pass-SELECTs.
  assert.equal(
    countInserts(build.queries),
    2,
    "to INSERT-forsøk (initial + retry etter andre release-pass)",
  );
  assert.equal(
    countReleaseSelects(build.queries),
    2,
    "to release-pass-SELECTs (initial + retry)",
  );
});

test("F-NEW-3: 23505 etter første release → retry-INSERT lykkes (transient race)", async () => {
  // Transient race: første INSERT feiler med 23505, men ved retry har
  // race-vinneren cancellet sin rad eller andre forhold endret. Bridgen
  // skal logge advarsel og fortsette med room_code satt.
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const build = makeBridge({
    runRow: {
      id: "run-new",
      plan_id: "gp-1",
      hall_id: "hall-arnes",
      business_date: "2026-05-12",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "demo-pilot-goh",
    groupHallMembers: ["hall-arnes"],
    staleRows: [],
    simulateFirstInsert23505: true,
    secondInsertOk: true,
  });

  const result = await build.bridge.createScheduledGameForPlanRunPosition(
    "run-new",
    1,
  );

  assert.equal(result.reused, false);
  // Andre INSERT bør ha samme room_code som første — ingen lazy-binding-
  // degradering.
  const inserts = build.queries.filter((q) =>
    /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql),
  );
  assert.equal(inserts.length, 2);
  // Begge INSERT bør ha room_code-kolonnen
  for (const insert of inserts) {
    assert.ok(
      /room_code/i.test(insert.sql),
      "begge INSERT-forsøk skal ha room_code-kolonnen (ingen lazy-binding-degradering)",
    );
  }
});

test("F-NEW-3: stale rad med samme (run, position) men annen ID skal IKKE cancelleres (idempotency-grense)", async () => {
  // Defensiv: stub-en kan i teorien returnere en stale rad med samme
  // (plan_run_id, plan_position) hvis schema-en var korrupt. Bridge-SQL
  // ekskluderer EKSPLISITT vår egen (run, pos) i WHERE-klausulen
  // (`NOT (plan_run_id = $2 AND plan_position = $3)`), så stub-en må
  // simulere SQL-en og IKKE returnere en slik rad. Denne testen
  // verifiserer at vi BRUKER den filter-klausulen — vi sjekker at
  // WHERE-SQL inneholder NOT-betingelsen, slik at en framtidig refaktor
  // ikke fjerner den ved et uhell.
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const build = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-arnes",
      business_date: "2026-05-12",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "demo-pilot-goh",
    groupHallMembers: ["hall-arnes"],
    staleRows: [],
  });

  await build.bridge.createScheduledGameForPlanRunPosition("run-1", 1);

  const releaseSelect = build.queries.find(
    (q) =>
      /SELECT\s+id,\s*status,\s*plan_run_id,\s*plan_position/i.test(q.sql) &&
      /app_game1_scheduled_games/i.test(q.sql) &&
      /room_code\s*=/i.test(q.sql),
  );
  assert.ok(releaseSelect, "release-pass SELECT må ha kjørt");
  assert.ok(
    /NOT\s*\(plan_run_id\s*=\s*\$2\s*AND\s*plan_position\s*=\s*\$3\)/i.test(
      releaseSelect!.sql,
    ),
    "release-pass SELECT skal eksplisitt ekskludere egen (run, position)",
  );
});

test("F-NEW-3 regresjon: lazy-binding (room_code=NULL) fallback-INSERT er fjernet", async () => {
  // Pre-F-NEW-3 hadde bridgen en fallback der den re-INSERTet UTEN
  // room_code-kolonnen ved 23505. Det brøt klient-flyten fordi auto-
  // draw-tick emittet til `io.to(NULL)`. F-NEW-3 fjernet den pathen —
  // alle INSERT-er skal inneholde room_code-kolonnen.
  const catalog = makeCatalogEntry();
  const plan = makePlanWithItems([{ catalogEntry: catalog }]);
  const build = makeBridge({
    runRow: {
      id: "run-1",
      plan_id: "gp-1",
      hall_id: "hall-arnes",
      business_date: "2026-05-12",
      jackpot_overrides_json: {},
    },
    plan,
    existingScheduled: null,
    hallGroupId: "demo-pilot-goh",
    groupHallMembers: ["hall-arnes"],
    staleRows: [],
    simulateFirstInsert23505: true,
    secondInsertOk: true,
  });

  await build.bridge.createScheduledGameForPlanRunPosition("run-1", 1);

  const insertWithoutRoomCode = build.queries.find(
    (q) =>
      /INSERT INTO\s+"public"\."app_game1_scheduled_games"/i.test(q.sql) &&
      !/room_code/i.test(q.sql),
  );
  assert.equal(
    insertWithoutRoomCode,
    undefined,
    "ingen INSERT skal mangle room_code-kolonnen — lazy-binding-fallback er fjernet",
  );
});
