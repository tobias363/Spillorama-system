/**
 * Tester for legacy admin-panel seed-script.
 *
 * Tester:
 *   - Mapping av legacy spilltyper → ny stack slugs
 *   - Mapping av legacy ticket-color-strenger → kanonisk TICKET_COLORS-enum
 *   - Hopp over Turbomania (Game 4 / themebingo) — DEPRECATED BIN-496
 *   - Hopp over tom Lynbingo daily-schedules (legacy har ingen)
 *   - Idempotens: samme payload kjørt 2x gir 0 nye created-rader
 *   - Validering av ukjente ticket-color-strings (fail-closed)
 *   - Schedule + DailySchedule UPSERT mot snapshot-data
 *   - parseLegacyDateRange / parseLegacyTimeWindow / slugify-helpers
 *
 * In-memory pg-stub speiler de SELECT/INSERT/UPDATE-mønstrene seedet bruker.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSeed, _internals, type SeedOptions } from "./seedLegacyGameConfig.js";
import {
  _internals as importerInternals,
  type ImportLogger,
  type QueryClient,
} from "./legacySubGameImporter.js";

// ── In-memory pg-stub (samme prinsipp som legacySubGameImporter.test.ts) ────

interface InMemoryRow {
  table: string;
  data: Record<string, unknown>;
}

class InMemoryPgStub {
  rows: InMemoryRow[] = [];
  calls: Array<{ sql: string; params: unknown[] }> = [];

  async query(
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    this.calls.push({ sql, params });
    const trimmed = sql.trim();

    // BEGIN / COMMIT / ROLLBACK — no-op for stub
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(trimmed)) {
      return { rows: [], rowCount: 0 };
    }

    if (/^SELECT/i.test(trimmed)) {
      const tableMatch = trimmed.match(/FROM\s+"[^"]+"\."([^"]+)"/i);
      const table = tableMatch?.[1] ?? "";
      // Match (game_type_id, pattern_number)
      if (
        /WHERE\s+game_type_id\s*=\s*\$1\s+AND\s+pattern_number\s*=\s*\$2/i.test(
          trimmed
        )
      ) {
        const matches = this.rows.filter(
          (r) =>
            r.table === table &&
            r.data["game_type_id"] === params[0] &&
            r.data["pattern_number"] === params[1] &&
            r.data["deleted_at"] === null
        );
        return {
          rows: matches.map((r) => ({ id: r.data["id"] })),
          rowCount: matches.length,
        };
      }
      const colMatch = trimmed.match(/WHERE\s+(\w+)\s*=\s*\$1/i);
      const col = colMatch?.[1] ?? "";
      const matches = this.rows.filter(
        (r) =>
          r.table === table &&
          r.data[col] === params[0] &&
          r.data["deleted_at"] === null
      );
      return {
        rows: matches.map((r) => ({ id: r.data["id"] })),
        rowCount: matches.length,
      };
    }

    if (/^INSERT INTO/i.test(trimmed)) {
      const tableMatch = trimmed.match(/INSERT INTO\s+"[^"]+"\."([^"]+)"/i);
      const table = tableMatch?.[1] ?? "";
      const colsMatch = trimmed.match(/\(([^)]+)\)\s*VALUES/i);
      if (!colsMatch) {
        throw new Error(`Kunne ikke parse INSERT: ${trimmed.slice(0, 120)}`);
      }
      const cols = colsMatch[1]!
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const data: Record<string, unknown> = { deleted_at: null };
      for (let i = 0; i < cols.length; i++) {
        data[cols[i]!] = params[i];
      }
      this.rows.push({ table, data });
      return { rows: [], rowCount: 1 };
    }

    if (/^UPDATE/i.test(trimmed)) {
      const tableMatch = trimmed.match(/UPDATE\s+"[^"]+"\."([^"]+)"/i);
      const table = tableMatch?.[1] ?? "";
      const id = params[0];
      const target = this.rows.find(
        (r) => r.table === table && r.data["id"] === id
      );
      if (target) {
        target.data["__updated"] = true;
      }
      return { rows: [], rowCount: target ? 1 : 0 };
    }

    throw new Error(`Ukjent SQL: ${trimmed.slice(0, 120)}`);
  }
}

function makeStubClient(): { client: QueryClient; pg: InMemoryPgStub } {
  const stub = new InMemoryPgStub();
  return {
    pg: stub,
    client: {
      query: stub.query.bind(stub) as unknown as QueryClient["query"],
    },
  };
}

function silent(): ImportLogger {
  return importerInternals.nullLogger();
}

// ── Sample-snapshot-builder ────────────────────────────────────────────────
//
// I stedet for å lese ekte snapshot-filer på disk lager testene en midlertidig
// katalog med 4 fixture-filer som dekker normale + edge-cases.

interface FixtureBundle {
  dir: string;
}

function writeFixtures(opts?: {
  /** Override game-mapping (default = standard 5 typer). */
  gameMapping?: unknown;
  /** Override default schedule (default = mandag-fredag-light). */
  schedules?: Record<string, unknown>;
  bingoConfig?: unknown;
  savedGames?: unknown;
}): FixtureBundle {
  const dir = mkdtempSync(join(tmpdir(), "seed-legacy-test-"));

  const gameMapping = opts?.gameMapping ?? {
    spillTypes: {
      "Papir bingo": {
        _legacy_id: "5f807893e86e8b18e65ed6f7",
        _new_slug: "bingo",
        _new_label: "Spill 1",
        dailySchedules: [
          {
            id_display: "DSN_TEST_BINGO",
            schedule_object_id: "test_schedule_papir_001",
            date_range: "29/04/2026-09/05/2026",
            time_window: "01:27 - 21:27",
            group_of_halls: "Oslo",
            master_hall: "Test Hall",
            type: "Normalt spill",
            status: "Aktiv",
          },
        ],
      },
      Lynbingo: {
        _legacy_id: "5f8078b3e86e8b18e65ed6f8",
        _new_slug: "rocket",
        _new_label: "Spill 2",
        dailySchedules: [],
      },
      BingoBonanza: {
        _legacy_id: "5f8078cbe86e8b18e65ed6f9",
        _new_slug: "monsterbingo",
        dailySchedules: [
          {
            id_display: "DSN_TEST_BB",
            schedule_object_id: "test_schedule_bb_001",
            date_range: "29/04/2026-09/05/2026",
            status: "Aktiv",
          },
        ],
      },
      Turbomania: {
        _legacy_id: "5f8078fce86e8b18e65ed6fa",
        _new_slug: "themebingo (DEPRECATED)",
        dailySchedules: [
          {
            id_display: "DSN_TURBO_DEPRECATED",
            schedule_object_id: "test_schedule_turbo_001",
            _note: "DEPRECATED",
          },
        ],
      },
      SpinnGo: {
        _legacy_id: "659bccf3bc629b04503c58ed",
        _new_slug: "spillorama",
        dailySchedules: [],
      },
    },
  };
  writeFileSync(
    join(dir, "legacy-game-management-mapping.json"),
    JSON.stringify(gameMapping)
  );

  const schedules = opts?.schedules ?? {
    "legacy-schedule-test-light.json": {
      schedule: {
        name: "Test Light Schedule",
        luckyNumberPrize: "100",
        scheduleType: "Manual",
        manualStartTime: "09:00",
        manualEndTime: "23:00",
      },
      subGameCount: 2,
      subGames: [
        {
          fields: {
            name: "Jackpot",
            custom_game_name: "Jackpot",
            notificationStartTime: "0s",
            minseconds: "5",
            maxseconds: "14",
            seconds: "10",
            "ticketColorType][": [
              "Small Yellow",
              "Large Yellow",
              "Small White",
              "Large White",
            ],
            jackpotPrizeYellow: "15000",
            jackpotPrizeWhite: "10000",
            jackpotDraw: "57",
          },
          prices: {
            "][Small Yellow": "10",
            "][Large Yellow": "20",
            "][Small White": "5",
            "][Large White": "10",
          },
          prizes: {
            Yellow: { "Row 1": "100", "Full House": "1000" },
            White: { "Row 1": "100", "Full House": "500" },
          },
          ticketColors: [],
        },
        {
          fields: {
            name: "Mystery",
            custom_game_name: "Superjoker",
            notificationStartTime: "0s",
            minseconds: "5",
            maxseconds: "15",
            seconds: "5",
            "ticketColorType][": ["Small Yellow", "Large Yellow"],
          },
          prices: {
            "][Small Yellow": "10",
            "][Large Yellow": "20",
          },
          prizes: {
            Yellow: { "Row 1": "200", "Full House": "0" },
          },
          ticketColors: [],
        },
      ],
    },
  };
  for (const [name, payload] of Object.entries(schedules)) {
    writeFileSync(join(dir, name), JSON.stringify(payload));
  }

  const bingoConfig = opts?.bingoConfig ?? {
    config: {
      mainGameName: "Game 3",
      start_date: "29/4/2026",
      end_date: "9/5/2026",
      schedule: { Wednesday: ["06:30", "23:30"] },
      isBotGame: "No",
      groupHalls: "Oslo",
      subGames: [
        {
          index: 0,
          winningType: "cash",
          patterns: [
            {
              name: "Coverall",
              prize_tier1: 55,
              prize_tier2: 10000,
              prize_tier3: 100,
            },
            { name: "Row 1", prize_tier1: 21, prize_tier2: 100, prize_tier3: 100 },
          ],
        },
        {
          index: 1,
          name: "Game3 Sub1",
          ticketPrice: 10,
          luckyNumberPrize: 100,
        },
      ],
    },
  };
  writeFileSync(
    join(dir, "legacy-bingobonanza-game3-config.json"),
    JSON.stringify(bingoConfig)
  );

  const savedGames = opts?.savedGames ?? {
    savedGames: { "Papir bingo": [], BingoBonanza: [] },
  };
  writeFileSync(
    join(dir, "legacy-saved-games-list.json"),
    JSON.stringify(savedGames)
  );

  return { dir };
}

// ── Helpers-tester ─────────────────────────────────────────────────────────

test("seedLegacyGameConfig: parseLegacyDateRange parser DD/MM/YYYY-DD/MM/YYYY", () => {
  const [start, end] = _internals.parseLegacyDateRange(
    "29/04/2026-09/05/2026"
  );
  assert.equal(start, "2026-04-29T00:00:00.000Z");
  assert.equal(end, "2026-05-09T23:59:59.999Z");
});

test("seedLegacyGameConfig: parseLegacyDateRange håndterer ugyldig input", () => {
  assert.deepEqual(_internals.parseLegacyDateRange(""), [null, null]);
  assert.deepEqual(_internals.parseLegacyDateRange("not-a-date"), [null, null]);
});

test("seedLegacyGameConfig: parseLegacyTimeWindow parser HH:MM - HH:MM", () => {
  assert.deepEqual(_internals.parseLegacyTimeWindow("01:27 - 21:27"), [
    "01:27",
    "21:27",
  ]);
  assert.deepEqual(_internals.parseLegacyTimeWindow("01:27-21:27"), [
    "01:27",
    "21:27",
  ]);
});

test("seedLegacyGameConfig: parseLegacyTimeWindow returnerer tom på ugyldig", () => {
  assert.deepEqual(_internals.parseLegacyTimeWindow(""), ["", ""]);
  assert.deepEqual(_internals.parseLegacyTimeWindow("invalid"), ["", ""]);
});

test("seedLegacyGameConfig: slugify lager safe-strings", () => {
  assert.equal(_internals.slugify("Wheel of Fortune"), "wheel_of_fortune");
  assert.equal(_internals.slugify("Spilleplan mandag-fredag"), "spilleplan_mandag_fredag");
  assert.equal(_internals.slugify("500 Spillet"), "500_spillet");
});

test("seedLegacyGameConfig: maybeInt returnerer null for tom/ikke-tall", () => {
  assert.equal(_internals.maybeInt(""), null);
  assert.equal(_internals.maybeInt(undefined), null);
  assert.equal(_internals.maybeInt(null), null);
  assert.equal(_internals.maybeInt("abc"), null);
  assert.equal(_internals.maybeInt("100"), 100);
  assert.equal(_internals.maybeInt(42), 42);
});

test("seedLegacyGameConfig: extractPricesByColor strippe ][-prefiks", () => {
  const out = _internals.extractPricesByColor({
    "][Small Yellow": "10",
    "][Large White": "5",
    "][Small Purple": "",
  });
  assert.deepEqual(out, {
    "Small Yellow": 10,
    "Large White": 5,
    "Small Purple": null,
  });
});

test("seedLegacyGameConfig: patternNameToMask matcher Coverall + Row 1", () => {
  // Coverall = Full House = (1<<25) - 1
  assert.equal(_internals.patternNameToMask("Coverall"), (1 << 25) - 1);
  assert.equal(_internals.patternNameToMask("Full House"), (1 << 25) - 1);
  // Row 1 = lower 5 bits
  assert.equal(_internals.patternNameToMask("Row 1"), 0b11111);
  // Row 2 = bits 5-9
  assert.equal(_internals.patternNameToMask("Row 2"), 0b11111 << 5);
  // Unknown returns 0 — admin må fylle inn senere
  assert.equal(_internals.patternNameToMask("Cosmic Pyramid"), 0);
});

test("seedLegacyGameConfig: deriveDefaultPatternRows returnerer 5 patterns", () => {
  const rows = _internals.deriveDefaultPatternRows("Jackpot");
  assert.equal(rows.length, 5);
  assert.equal(rows[0]!.name, "Row 1");
  assert.equal(rows[0]!.claimType, "LINE");
  assert.equal(rows[4]!.name, "Full House");
  assert.equal(rows[4]!.claimType, "BINGO");
  assert.equal(rows[4]!.mask, (1 << 25) - 1);
});

// ── Validering / mapping ──────────────────────────────────────────────────

test("seedLegacyGameConfig: LEGACY_TO_NEW_GAME_TYPE har ikke Turbomania (deprecated)", () => {
  const m = _internals.LEGACY_TO_NEW_GAME_TYPE as Record<string, unknown>;
  assert.ok(m["Papir bingo"], "Papir bingo må mappes");
  assert.ok(m.Lynbingo, "Lynbingo må mappes");
  assert.ok(m.BingoBonanza, "BingoBonanza må mappes");
  assert.ok(m.SpinnGo, "SpinnGo må mappes");
  assert.equal(
    m.Turbomania,
    undefined,
    "Turbomania (Game 4) skal IKKE være i mapping (deprecated BIN-496)"
  );
});

test("seedLegacyGameConfig: LEGACY_COLOR_TO_CANONICAL dekker alle observerte legacy-farger", () => {
  const m = _internals.LEGACY_COLOR_TO_CANONICAL;
  // Fra mandag-fredag, lordag, sondag schedules
  assert.equal(m["Small Yellow"], "SMALL_YELLOW");
  assert.equal(m["Large Yellow"], "LARGE_YELLOW");
  assert.equal(m["Small White"], "SMALL_WHITE");
  assert.equal(m["Large White"], "LARGE_WHITE");
  // Fra Traffic Light sub-game
  assert.equal(m["Small Red"], "RED");
  assert.equal(m["Small Green"], "GREEN");
  // Fra Elvis sub-game (test23feb)
  assert.equal(m["Small Elvis1"], "ELVIS1");
  assert.equal(m["Small Elvis5"], "ELVIS5");
});

// ── Snapshot-reading ──────────────────────────────────────────────────────

test("seedLegacyGameConfig: readSnapshots leser alle 4 fil-typer", () => {
  const { dir } = writeFixtures();
  const snapshots = _internals.readSnapshots(dir);
  assert.ok(snapshots.gameMapping, "gameMapping må være satt");
  assert.equal(snapshots.scheduleSnapshots.length, 1);
  assert.ok(snapshots.bingoBonanzaConfig, "bingoBonanzaConfig må være satt");
  assert.ok(snapshots.savedGamesList, "savedGamesList må være satt");
});

test("seedLegacyGameConfig: readSnapshots feiler uten game-management-mapping.json", () => {
  // Skriv kun schedule-fil, ingen mapping
  const dir = mkdtempSync(join(tmpdir(), "seed-legacy-no-mapping-"));
  writeFileSync(
    join(dir, "legacy-schedule-x.json"),
    JSON.stringify({
      schedule: {
        name: "X",
        scheduleType: "Manual",
      },
      subGames: [],
    })
  );
  assert.throws(() => _internals.readSnapshots(dir), /game-management-mapping/);
});

// ── Full runSeed-tester ───────────────────────────────────────────────────

test("seedLegacyGameConfig: runSeed populerer alle 5 tabeller for happy-path", async () => {
  const { dir } = writeFixtures();
  const { client, pg } = makeStubClient();
  const opts: SeedOptions = {
    snapshotDir: dir,
    schema: "public",
    createdBy: "test",
    logger: silent(),
  };

  const report = await runSeed(client, opts);

  // 4 game-types (ingen Turbomania), 2 sub-games (Jackpot + Mystery), >0 patterns,
  // 1 schedule, 2 daily-schedules (Papir bingo + BingoBonanza; Lynbingo+SpinnGo
  // har tom dailySchedules-array; Turbomania er hoppet over).
  const gameTypeRows = pg.rows.filter((r) => r.table === "app_game_types");
  const subGameRows = pg.rows.filter((r) => r.table === "app_sub_games");
  const patternRows = pg.rows.filter((r) => r.table === "app_patterns");
  const scheduleRows = pg.rows.filter((r) => r.table === "app_schedules");
  const dailyRows = pg.rows.filter((r) => r.table === "app_daily_schedules");

  assert.equal(gameTypeRows.length, 4, "4 GameTypes (ingen Turbomania)");
  assert.equal(
    subGameRows.length,
    2,
    "2 SubGames (Jackpot + Mystery, unik per navn)"
  );
  // 5 default-patterns (Row 1-4 + Full House) + Coverall + Row 1 fra
  // BingoBonanza-config = 7. (Row 1 i BingoBonanza har annet game_type_id =
  // 'monsterbingo' så det kolliderer ikke.)
  assert.ok(
    patternRows.length >= 5,
    `Minst 5 patterns (Row 1-4 + Full House) — fant ${patternRows.length}`
  );
  assert.equal(scheduleRows.length, 1, "1 Schedule (Test Light Schedule)");
  assert.equal(dailyRows.length, 2, "2 DailySchedules (Papir + BB)");

  // GameType-mapping: bingo, rocket, monsterbingo, spillorama
  const slugs = gameTypeRows.map((r) => r.data["type_slug"]).sort();
  assert.deepEqual(slugs, ["bingo", "monsterbingo", "rocket", "spillorama"]);

  // Schedule schedule_number må starte med SID_LEGACY_
  assert.ok(
    String(scheduleRows[0]!.data["schedule_number"]).startsWith("SID_LEGACY_")
  );
  // DailySchedule-id må preserve legacy schedule_object_id
  const dailyIds = dailyRows.map((r) => r.data["id"]).sort();
  assert.deepEqual(dailyIds, ["test_schedule_bb_001", "test_schedule_papir_001"]);

  // Mapping-rapport må flagge Turbomania som hoppet over
  const skippedNote = report.mapping.skippedLegacyTypes.find((s) =>
    s.includes("Turbomania")
  );
  assert.ok(skippedNote, "Turbomania-skip må være rapportert");

  assert.equal(report.failed, 0, "Ingen feilede inserts");
  assert.equal(report.created, report.total, "Alle skal være created (første kjør)");
});

test("seedLegacyGameConfig: runSeed er idempotent (2x kjør gir 0 nye created)", async () => {
  const { dir } = writeFixtures();
  const { client } = makeStubClient();
  const opts: SeedOptions = {
    snapshotDir: dir,
    schema: "public",
    createdBy: "test",
    logger: silent(),
  };

  const r1 = await runSeed(client, opts);
  const r2 = await runSeed(client, opts);

  assert.ok(r1.created > 0, "Første kjør må create rader");
  assert.equal(r2.created, 0, "Andre kjør må ikke create nye rader");
  assert.equal(r2.updated, r1.created, "Andre kjør må update like mange som første created");
});

test("seedLegacyGameConfig: runSeed med dryRun=true skriver ingen INSERT/UPDATE", async () => {
  const { dir } = writeFixtures();
  const { client, pg } = makeStubClient();

  const r = await runSeed(client, {
    snapshotDir: dir,
    schema: "public",
    createdBy: "test",
    dryRun: true,
    logger: silent(),
  });

  // Ingen INSERTs eller UPDATEs i stub
  const writes = pg.calls.filter(
    (c) => /^INSERT|^UPDATE/i.test(c.sql.trim())
  );
  assert.equal(writes.length, 0, "Dry-run må ikke kalle INSERT/UPDATE");
  assert.ok(r.total > 0, "Dry-run rapporterer fortsatt aksjoner");
});

test("seedLegacyGameConfig: runSeed kaster feil på ukjent ticket-color", async () => {
  const { dir } = writeFixtures({
    schedules: {
      "legacy-schedule-bad-color.json": {
        schedule: {
          name: "Bad Color Schedule",
          scheduleType: "Manual",
          manualStartTime: "09:00",
          manualEndTime: "23:00",
        },
        subGameCount: 1,
        subGames: [
          {
            fields: {
              name: "Jackpot",
              "ticketColorType][": ["Sparkly Rainbow"], // ukjent farge
            },
            prices: {},
            prizes: {},
          },
        ],
      },
    },
  });
  const { client } = makeStubClient();

  await assert.rejects(
    () =>
      runSeed(client, {
        snapshotDir: dir,
        schema: "public",
        createdBy: "test",
        logger: silent(),
      }),
    /Ukjent legacy-ticket-color 'Sparkly Rainbow'/
  );
});

test("seedLegacyGameConfig: runSeed hopper over Turbomania DSN", async () => {
  const { dir } = writeFixtures();
  const { client, pg } = makeStubClient();

  await runSeed(client, {
    snapshotDir: dir,
    schema: "public",
    createdBy: "test",
    logger: silent(),
  });

  // Ingen daily-schedule-rad for Turbomania-id-en
  const dailyRows = pg.rows.filter(
    (r) => r.table === "app_daily_schedules"
  );
  const turboRow = dailyRows.find(
    (r) => r.data["id"] === "test_schedule_turbo_001"
  );
  assert.equal(
    turboRow,
    undefined,
    "test_schedule_turbo_001 skal IKKE finnes (DEPRECATED)"
  );
});

test("seedLegacyGameConfig: runSeed hopper over Lynbingo (tom dailySchedules)", async () => {
  const { dir } = writeFixtures();
  const { client, pg } = makeStubClient();

  await runSeed(client, {
    snapshotDir: dir,
    schema: "public",
    createdBy: "test",
    logger: silent(),
  });

  // Ingen daily-schedule som peker på rocket-game-type
  const dailyRows = pg.rows.filter(
    (r) => r.table === "app_daily_schedules"
  );
  const rocketRow = dailyRows.find((r) => {
    const od = r.data["other_data_json"];
    if (typeof od === "string") {
      const parsed = JSON.parse(od) as { newGameTypeSlug?: string };
      return parsed.newGameTypeSlug === "rocket";
    }
    return false;
  });
  assert.equal(rocketRow, undefined, "Lynbingo (rocket) skal ikke ha DailySchedule");
});

test("seedLegacyGameConfig: serializeScheduleSubGame mapper jackpotData korrekt", () => {
  const result = _internals.serializeScheduleSubGame(
    {
      fields: {
        name: "Jackpot",
        custom_game_name: "Jackpot",
        notificationStartTime: "0s",
        minseconds: "5",
        maxseconds: "14",
        seconds: "10",
        "ticketColorType][": ["Small Yellow", "Large Yellow"],
        jackpotPrizeYellow: "15000",
        jackpotPrizeWhite: "10000",
        jackpotDraw: "57",
      },
      prices: { "][Small Yellow": "10", "][Large Yellow": "20" },
      prizes: { Yellow: { "Row 1": "100", "Full House": "1000" } },
      ticketColors: [],
    },
    0
  );
  assert.equal(result.name, "Jackpot");
  assert.equal((result.minseconds as number), 5);
  const jpData = result.jackpotData as Record<string, unknown>;
  assert.equal(jpData.jackpotPrizeYellow, 15000);
  assert.equal(jpData.jackpotPrizeWhite, 10000);
  assert.equal(jpData.jackpotDraw, 57);
  // Canonical colors
  const tt = result.ticketTypesData as { ticketType: string[] };
  assert.deepEqual(tt.ticketType, ["SMALL_YELLOW", "LARGE_YELLOW"]);
});

test("seedLegacyGameConfig: serializeScheduleSubGame setter elvisData når replace_price er satt", () => {
  const result = _internals.serializeScheduleSubGame(
    {
      fields: {
        name: "Elvis",
        custom_game_name: "elvis Custom",
        "ticketColorType][": ["Small Elvis1", "Small Elvis2"],
        replace_price: "5",
        notificationStartTime: "10s",
        minseconds: "5",
        maxseconds: "6",
        seconds: "5",
      },
      prices: {},
      prizes: {},
      ticketColors: [],
    },
    0
  );
  const elvis = result.elvisData as Record<string, unknown>;
  assert.equal(elvis.replaceTicketPrice, 5);
});

// ── Validering: LegacyPayloadSchema fail ───────────────────────────────────

test("seedLegacyGameConfig: readSnapshots feiler ved invalid schedule-shape", () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-legacy-invalid-"));
  // Skriv minimal mapping så den validerer
  writeFileSync(
    join(dir, "legacy-game-management-mapping.json"),
    JSON.stringify({ spillTypes: {} })
  );
  // Skriv schedule uten påkrevd "schedule.name"
  writeFileSync(
    join(dir, "legacy-schedule-bad.json"),
    JSON.stringify({ schedule: {}, subGames: [] })
  );

  assert.throws(() => _internals.readSnapshots(dir), /Invalid schedule snapshot/);
});
