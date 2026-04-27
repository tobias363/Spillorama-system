/**
 * G9: unit-tester for legacy sub-game ETL.
 *
 * Tester med en in-memory query-stub som speiler faktisk SQL-flyt: SELECT
 * for å sjekke om rad finnes (returnerer 0/1 rad), INSERT/UPDATE for å
 * persistere. Vi verifiserer:
 *   - Validering av ugyldig payload-shape
 *   - Mapping av legacy-felt til Postgres-kolonner
 *   - Idempotens: samme payload kjørt 2x gir samme tilstand
 *   - Dry-run skriver ingen rader
 *   - GameType må upsertes før SubGame/Pattern (resolveGameTypeId)
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  runImport,
  LegacyPayloadSchema,
  _internals,
  type ImportLogger,
  type QueryClient,
} from "./legacySubGameImporter.js";

// ── Test-harness: in-memory pg-stub ────────────────────────────────────────

interface InMemoryRow {
  table: string;
  data: Record<string, unknown>;
}

interface QueryCall {
  sql: string;
  params: unknown[];
}

class InMemoryPgStub {
  rows: InMemoryRow[] = [];
  calls: QueryCall[] = [];

  /**
   * Speiler de SELECT/INSERT/UPDATE-kallene runImport gjør. Logikk er
   * smal: vi parser tabell-navnet og kolonnen som vi matcher på, og
   * holder rader i `this.rows`.
   */
  async query(sql: string, params: unknown[] = []): Promise<{
    rows: Record<string, unknown>[];
    rowCount: number;
  }> {
    this.calls.push({ sql, params });
    const trimmed = sql.trim();

    // SELECT-er: matcher fra tabell + WHERE-klausul.
    if (/^SELECT/i.test(trimmed)) {
      const tableMatch = trimmed.match(/FROM\s+"[^"]+"\."([^"]+)"/i);
      const table = tableMatch?.[1] ?? "";
      // Heuristikk: matcher første WHERE-kolonne (vi kjenner spørringene).
      // Dekker:
      //   - type_slug = $1
      //   - sub_game_number = $1
      //   - id = $1
      //   - game_type_id = $1 AND pattern_number = $2
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

    // INSERT
    if (/^INSERT INTO/i.test(trimmed)) {
      const tableMatch = trimmed.match(/INSERT INTO\s+"[^"]+"\."([^"]+)"/i);
      const table = tableMatch?.[1] ?? "";
      // Forenklet kolonne-mapping basert på rekkefølge i SQL — vi henter
      // kolonner fra parentesen rett etter tabell-navnet.
      const colsMatch = trimmed.match(/\(([^)]+)\)\s*VALUES/i);
      if (!colsMatch) {
        throw new Error(`Kunne ikke parse kolonner fra INSERT: ${trimmed}`);
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

    // UPDATE
    if (/^UPDATE/i.test(trimmed)) {
      const tableMatch = trimmed.match(/UPDATE\s+"[^"]+"\."([^"]+)"/i);
      const table = tableMatch?.[1] ?? "";
      // Sista param er id (matcher `WHERE id = $1` på toppen av UPDATE).
      const id = params[0];
      const target = this.rows.find(
        (r) => r.table === table && r.data["id"] === id
      );
      if (target) {
        // Vi simulerer UPDATE som no-op men registrerer at det skjedde.
        target.data["__updated"] = true;
      }
      return { rows: [], rowCount: target ? 1 : 0 };
    }

    throw new Error(`Ukjent SQL i stub: ${trimmed.slice(0, 60)}`);
  }
}

function makeStubClient(): {
  client: QueryClient;
  pg: InMemoryPgStub;
} {
  const stub = new InMemoryPgStub();
  return {
    pg: stub,
    client: {
      query: stub.query.bind(stub) as unknown as QueryClient["query"],
    },
  };
}

function silentLogger(): ImportLogger {
  return _internals.nullLogger();
}

// ── Validering-tester ──────────────────────────────────────────────────────

test("G9 ETL: payload-validering avviser feil shape", async () => {
  const { client } = makeStubClient();
  await assert.rejects(
    () =>
      runImport(client, { gameTypes: "ikke-en-array" }, {
        logger: silentLogger(),
      }),
    /Ugyldig payload-shape/
  );
});

test("G9 ETL: tom payload gir tom rapport", async () => {
  const { client } = makeStubClient();
  const report = await runImport(
    client,
    {},
    { logger: silentLogger() }
  );
  assert.equal(report.total, 0);
  assert.equal(report.created, 0);
  assert.equal(report.failed, 0);
});

test("G9 ETL: zod-validering avviser pattern uten name", async () => {
  const { client } = makeStubClient();
  await assert.rejects(
    () =>
      runImport(
        client,
        {
          patterns: [{ mask: 1, gameTypeSlug: "game_1" }], // mangler name
        },
        { logger: silentLogger() }
      ),
    /Ugyldig payload-shape/
  );
});

test("G9 ETL: zod-validering avviser pattern med mask > 25 bit", async () => {
  const { client } = makeStubClient();
  await assert.rejects(
    () =>
      runImport(
        client,
        {
          patterns: [
            {
              name: "Bad",
              mask: 0x2000000, // 2^25 — over taket
              gameTypeSlug: "game_1",
            },
          ],
        },
        { logger: silentLogger() }
      ),
    /Ugyldig payload-shape/
  );
});

// ── Sample-import-test ─────────────────────────────────────────────────────

const SAMPLE_PAYLOAD = {
  gameTypes: [
    {
      typeSlug: "game_1",
      name: "Norsk Bingo",
      gridRows: 5,
      gridColumns: 5,
      rangeMin: 1,
      rangeMax: 75,
      luckyNumbers: [10, 20],
    },
  ],
  subGames: [
    {
      gameTypeSlug: "game_1",
      name: "Wheel of Fortune",
      subGameNumber: "SG_WOF_001",
      patternRows: [
        { patternId: "p-row-1", name: "Row 1" },
        { patternId: "p-fh", name: "Fullt Hus" },
      ],
      ticketColors: ["Small Yellow", "Large Yellow"],
    },
  ],
  patterns: [
    {
      gameTypeSlug: "game_1",
      patternNumber: "PT_ROW_1",
      name: "Row 1",
      mask: 0b11111,
      claimType: "LINE" as const,
      orderIndex: 0,
    },
    {
      gameTypeSlug: "game_1",
      patternNumber: "PT_FH",
      name: "Fullt Hus",
      mask: 0x1ffffff,
      claimType: "BINGO" as const,
      orderIndex: 4,
      isJackpot: true,
    },
  ],
};

test("G9 ETL: importerer sample legacy-mal komplett", async () => {
  const { client, pg } = makeStubClient();
  const report = await runImport(client, SAMPLE_PAYLOAD, {
    logger: silentLogger(),
  });

  assert.equal(report.total, 4);
  assert.equal(report.created, 4);
  assert.equal(report.updated, 0);
  assert.equal(report.failed, 0);

  // Verifiser at riktig antall rader ligger i hver tabell.
  const gameTypes = pg.rows.filter((r) => r.table === "app_game_types");
  const subGames = pg.rows.filter((r) => r.table === "app_sub_games");
  const patterns = pg.rows.filter((r) => r.table === "app_patterns");
  assert.equal(gameTypes.length, 1);
  assert.equal(subGames.length, 1);
  assert.equal(patterns.length, 2);

  // Verifiser felt-mapping på GameType.
  const gt = gameTypes[0]!.data;
  assert.equal(gt["type_slug"], "game_1");
  assert.equal(gt["name"], "Norsk Bingo");
  assert.equal(gt["grid_rows"], 5);
  assert.equal(gt["range_min"], 1);
  assert.equal(gt["range_max"], 75);

  // Verifiser at SubGame fikk riktig gameTypeId (resolved fra slug).
  const sg = subGames[0]!.data;
  assert.equal(sg["sub_game_number"], "SG_WOF_001");
  assert.equal(sg["name"], "Wheel of Fortune");
  // gameTypeId må være den UUID-en GameType-raden fikk.
  assert.equal(sg["game_type_id"], gt["id"]);

  // Verifiser pattern-mapping.
  const pRow = patterns.find((p) => p.data["pattern_number"] === "PT_ROW_1");
  const pFh = patterns.find((p) => p.data["pattern_number"] === "PT_FH");
  assert.ok(pRow, "PT_ROW_1 må finnes");
  assert.ok(pFh, "PT_FH må finnes");
  assert.equal(pRow!.data["mask"], 0b11111);
  assert.equal(pRow!.data["claim_type"], "LINE");
  assert.equal(pFh!.data["mask"], 0x1ffffff);
  assert.equal(pFh!.data["claim_type"], "BINGO");
  assert.equal(pFh!.data["is_jackpot"], true);
});

// ── Idempotens-test ────────────────────────────────────────────────────────

test("G9 ETL: idempotent — kjører 2x → samme tilstand, ingen duplikater", async () => {
  const { client, pg } = makeStubClient();

  const report1 = await runImport(client, SAMPLE_PAYLOAD, {
    logger: silentLogger(),
  });
  assert.equal(report1.created, 4);
  assert.equal(report1.updated, 0);

  const initialCount = pg.rows.length;

  const report2 = await runImport(client, SAMPLE_PAYLOAD, {
    logger: silentLogger(),
  });
  // Andre kjøring må ikke opprette nye rader — kun UPDATE eksisterende.
  assert.equal(report2.created, 0);
  assert.equal(report2.updated, 4);
  assert.equal(report2.failed, 0);

  // Antall rader uendret.
  assert.equal(
    pg.rows.length,
    initialCount,
    "Idempotens-brudd: nye rader opprettet på 2. kjøring"
  );

  // Alle eksisterende rader må være markert som oppdatert.
  for (const r of pg.rows) {
    assert.equal(
      r.data["__updated"],
      true,
      `Rad i ${r.table} ble ikke UPDATE-d på 2. kjøring`
    );
  }
});

// ── Dry-run-test ───────────────────────────────────────────────────────────

test("G9 ETL: dry-run gjør ingen INSERT/UPDATE", async () => {
  const { client, pg } = makeStubClient();
  const report = await runImport(client, SAMPLE_PAYLOAD, {
    dryRun: true,
    logger: silentLogger(),
  });
  assert.equal(report.total, 4);
  assert.equal(report.created, 4); // som om de ville bli opprettet
  assert.equal(pg.rows.length, 0, "Dry-run må ikke skrive rader til DB");
  // Verifiser at det ikke var noen INSERT eller UPDATE-kall.
  const writeCalls = pg.calls.filter(
    (c) =>
      /^\s*INSERT/i.test(c.sql) || /^\s*UPDATE/i.test(c.sql)
  );
  assert.equal(writeCalls.length, 0, "Dry-run må ikke gjøre write-queries");
});

// ── Avhengighets-test ──────────────────────────────────────────────────────

test("G9 ETL: SubGame uten matchende GameType feiler med kontekst", async () => {
  const { client } = makeStubClient();
  const report = await runImport(
    client,
    {
      subGames: [
        {
          gameTypeSlug: "ikke-finnes",
          name: "Orphan SG",
          subGameNumber: "SG_ORPHAN",
        },
      ],
    },
    { logger: silentLogger() }
  );
  assert.equal(report.failed, 1);
  assert.equal(report.records[0]!.action, "failed");
  assert.match(
    report.records[0]!.reason ?? "",
    /GameType 'ikke-finnes' finnes ikke/
  );
});

test("G9 ETL: Pattern uten matchende GameType feiler med kontekst", async () => {
  const { client } = makeStubClient();
  const report = await runImport(
    client,
    {
      patterns: [
        {
          gameTypeSlug: "ikke-finnes",
          name: "Orphan Pattern",
          mask: 1,
        },
      ],
    },
    { logger: silentLogger() }
  );
  assert.equal(report.failed, 1);
  assert.match(
    report.records[0]!.reason ?? "",
    /GameType 'ikke-finnes' finnes ikke/
  );
});

// ── Alias-test ─────────────────────────────────────────────────────────────

test("G9 ETL: alias 'subGame1Templates' tolkes som subGames", async () => {
  const { client, pg } = makeStubClient();
  // Sett opp en eksisterende GameType først.
  await runImport(
    client,
    { gameTypes: [{ typeSlug: "game_1", name: "Test" }] },
    { logger: silentLogger() }
  );
  const initialCount = pg.rows.length;

  const report = await runImport(
    client,
    {
      subGame1Templates: [
        {
          gameTypeSlug: "game_1",
          name: "From Alias",
          subGameNumber: "SG_ALIAS",
        },
      ],
    },
    { logger: silentLogger() }
  );

  assert.equal(report.created, 1);
  assert.equal(pg.rows.length, initialCount + 1);
  const sg = pg.rows.find(
    (r) =>
      r.table === "app_sub_games" && r.data["sub_game_number"] === "SG_ALIAS"
  );
  assert.ok(sg, "SubGame fra alias-key må være importert");
});

// ── Helper-tests ───────────────────────────────────────────────────────────

test("G9 ETL helpers: deriveSubGameNumber gir stabil verdi fra navn", () => {
  const result = _internals.deriveSubGameNumber({
    name: "Wheel of Fortune!",
    gameTypeSlug: "game_1",
  });
  assert.match(result, /^SG_/);
  assert.match(result, /game_1/);
});

test("G9 ETL helpers: derivePatternNumber bruker legacyId hvis tilgjengelig", () => {
  const result = _internals.derivePatternNumber({
    name: "Row 1",
    mask: 1,
    gameTypeSlug: "game_1",
    legacyId: "abc123",
  });
  assert.equal(result, "PT_LEGACY_abc123");
});

test("G9 ETL helpers: gameNameFromTypeRef gjør slug → CamelCase", () => {
  assert.equal(_internals.gameNameFromTypeRef("game_1"), "Game1");
  assert.equal(_internals.gameNameFromTypeRef("monster_bingo"), "MonsterBingo");
});

// ── Schema export-test ────────────────────────────────────────────────────

test("G9 ETL: LegacyPayloadSchema er eksportert", () => {
  // Schema må kunne brukes utenfra (f.eks. av andre import-flyter).
  const result = LegacyPayloadSchema.safeParse({});
  assert.equal(result.success, true);
});
