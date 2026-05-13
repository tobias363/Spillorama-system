/**
 * Smoke-tester for audit-db.mjs (Steg 1 av 3-stegs DB-auditor-plan).
 *
 * Dekker:
 *   - CLI-arg-parsing for alle flagg
 *   - Filtrering på tier og quick
 *   - SQL-substitusjon for schema-placeholder
 *   - Verdiformatering (null, Date, JSON, lange strenger)
 *   - Markdown-table-rendering
 *   - Markdown-rapport-struktur (header, sections, summary)
 *   - JSON-rapport-struktur (summary, results-array)
 *   - Queries-fil shape (alle 22 queries valider)
 *
 * Strategi: Test pure-funksjoner uten DB. Pool-interaksjon dekkes av
 * `walletLedgerReconciliation.integration.test.ts`-mønsteret hvis vi
 * trenger DB-tester senere.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error — .mjs ESM-import i .ts test
import { __TEST_ONLY__, loadQueries, filterQueries, buildMarkdownReport, buildJsonReport } from "../audit-db.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const QUERIES_PATH = join(__dirname, "..", "audit-db.queries.json");

const { parseArgs, substituteSchema, formatValue, renderRowsAsTable } =
  __TEST_ONLY__;

// ── CLI arg parsing ────────────────────────────────────────────────────────

describe("parseArgs", () => {
  test("default-verdier", () => {
    const a = parseArgs([]);
    assert.equal(a.json, false);
    assert.equal(a.quick, false);
    assert.equal(a.silent, false);
    assert.equal(a.help, false);
    assert.equal(a.tier, null);
    assert.equal(a.dbUrl, null);
    assert.equal(a.schema, null);
    assert.equal(a.output, null);
  });

  test("--json flag", () => {
    assert.equal(parseArgs(["--json"]).json, true);
  });

  test("--quick flag", () => {
    assert.equal(parseArgs(["--quick"]).quick, true);
  });

  test("--silent flag", () => {
    assert.equal(parseArgs(["--silent"]).silent, true);
  });

  test("--tier P1", () => {
    assert.equal(parseArgs(["--tier", "P1"]).tier, "P1");
  });

  test("--schema custom", () => {
    assert.equal(parseArgs(["--schema", "my_schema"]).schema, "my_schema");
  });

  test("--output path", () => {
    assert.equal(parseArgs(["--output", "/tmp/foo.md"]).output, "/tmp/foo.md");
  });

  test("--help", () => {
    assert.equal(parseArgs(["--help"]).help, true);
    assert.equal(parseArgs(["-h"]).help, true);
  });

  test("kombinerte flagg", () => {
    const a = parseArgs(["--json", "--tier", "P1", "--quick", "--silent"]);
    assert.equal(a.json, true);
    assert.equal(a.tier, "P1");
    assert.equal(a.quick, true);
    assert.equal(a.silent, true);
  });
});

// ── Schema substitution ────────────────────────────────────────────────────

describe("substituteSchema", () => {
  test("erstatter {{schema}} med public", () => {
    const sql = "SELECT * FROM {{schema}}.app_users";
    assert.equal(substituteSchema(sql, "public"), "SELECT * FROM public.app_users");
  });

  test("erstatter flere forekomster", () => {
    const sql = "SELECT * FROM {{schema}}.a JOIN {{schema}}.b ON a.id = b.a_id";
    assert.equal(
      substituteSchema(sql, "test_schema"),
      "SELECT * FROM test_schema.a JOIN test_schema.b ON a.id = b.a_id",
    );
  });

  test("ingen substituering hvis ingen placeholder", () => {
    const sql = "SELECT 1";
    assert.equal(substituteSchema(sql, "public"), "SELECT 1");
  });
});

// ── Filter queries ─────────────────────────────────────────────────────────

describe("filterQueries", () => {
  const sampleQueries = [
    { id: "a", tier: "P1", quick: true },
    { id: "b", tier: "P1", quick: false },
    { id: "c", tier: "P2", quick: true },
    { id: "d", tier: "P3", quick: false },
  ];

  test("ingen filter — alle queries", () => {
    const r = filterQueries(sampleQueries, {});
    assert.equal(r.length, 4);
  });

  test("filter på tier=P1", () => {
    const r = filterQueries(sampleQueries, { tier: "P1" });
    assert.equal(r.length, 2);
    assert.deepEqual(
      r.map((q: { id: string }) => q.id),
      ["a", "b"],
    );
  });

  test("filter quick=true", () => {
    const r = filterQueries(sampleQueries, { quick: true });
    assert.equal(r.length, 2);
    assert.deepEqual(
      r.map((q: { id: string }) => q.id),
      ["a", "c"],
    );
  });

  test("filter tier=P1 + quick=true", () => {
    const r = filterQueries(sampleQueries, { tier: "P1", quick: true });
    assert.equal(r.length, 1);
    assert.equal(r[0].id, "a");
  });

  test("tier case-insensitive", () => {
    const r = filterQueries(sampleQueries, { tier: "p1" });
    assert.equal(r.length, 2);
  });
});

// ── Value formatting ───────────────────────────────────────────────────────

describe("formatValue", () => {
  test("null → '—'", () => {
    assert.equal(formatValue(null), "—");
  });

  test("undefined → '—'", () => {
    assert.equal(formatValue(undefined), "—");
  });

  test("Date → ISO string", () => {
    const d = new Date("2026-05-14T12:00:00Z");
    assert.equal(formatValue(d), "2026-05-14T12:00:00.000Z");
  });

  test("object → JSON", () => {
    assert.equal(formatValue({ a: 1, b: "x" }), '{"a":1,"b":"x"}');
  });

  test("string → string", () => {
    assert.equal(formatValue("hello"), "hello");
  });

  test("number → string", () => {
    assert.equal(formatValue(42), "42");
  });

  test("trunkerer strenger > 200 tegn", () => {
    const long = "x".repeat(250);
    const out = formatValue(long);
    assert.equal(out.length, 200);
    assert.ok(out.endsWith("..."));
  });
});

// ── Table rendering ────────────────────────────────────────────────────────

describe("renderRowsAsTable", () => {
  test("tom array → fallback-tekst", () => {
    assert.equal(renderRowsAsTable([], []), "_(ingen rader)_");
  });

  test("renders header + rows fra fields", () => {
    const rows = [{ id: "a", name: "Foo" }];
    const md = renderRowsAsTable(rows, ["id", "name"]);
    assert.ok(md.includes("| id | name |"));
    assert.ok(md.includes("| --- | --- |"));
    assert.ok(md.includes("| a | Foo |"));
  });

  test("renders multiple rows", () => {
    const rows = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ];
    const md = renderRowsAsTable(rows, ["id", "value"]);
    const lines = md.split("\n");
    assert.equal(lines.length, 4); // header + sep + 2 rows
  });

  test("handler null-verdier", () => {
    const rows = [{ id: "a", name: null }];
    const md = renderRowsAsTable(rows, ["id", "name"]);
    assert.ok(md.includes("| a | — |"));
  });
});

// ── Queries-fil validation ─────────────────────────────────────────────────

describe("audit-db.queries.json shape", () => {
  test("fil eksisterer og parses som JSON", () => {
    const raw = readFileSync(QUERIES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    assert.ok(parsed.queries);
    assert.ok(Array.isArray(parsed.queries));
  });

  test("minst 20 queries (krav fra spec)", () => {
    const queries = loadQueries();
    assert.ok(
      queries.length >= 20,
      `forventet >=20 queries, fant ${queries.length}`,
    );
  });

  test("alle queries har required felter", () => {
    const queries = loadQueries();
    for (const q of queries) {
      assert.ok(q.id, `query mangler id: ${JSON.stringify(q).slice(0, 100)}`);
      assert.ok(q.tier, `query ${q.id} mangler tier`);
      assert.ok(q.severity, `query ${q.id} mangler severity`);
      assert.ok(q.category, `query ${q.id} mangler category`);
      assert.ok(q.description, `query ${q.id} mangler description`);
      assert.ok(q.sql, `query ${q.id} mangler sql`);
      assert.ok(q.fixAdvice, `query ${q.id} mangler fixAdvice`);
    }
  });

  test("alle tier-verdier er P1/P2/P3", () => {
    const queries = loadQueries();
    for (const q of queries) {
      assert.match(q.tier, /^P[123]$/, `query ${q.id} har ugyldig tier: ${q.tier}`);
    }
  });

  test("alle SQL-strings inneholder {{schema}} (untatt pg_catalog/pg_locks-queries)", () => {
    const queries = loadQueries();
    // pg_locks, pg_stat_*, pg_database er Postgres system-views — har ikke
    // user-schema. Disse er unntak fra schema-placeholder-regelen.
    const systemCatalogQueries = new Set(["lock-contention-active"]);
    for (const q of queries) {
      if (systemCatalogQueries.has(q.id)) {
        // Verifiser at den IKKE bruker user-schema-tabeller heller
        assert.ok(
          !q.sql.includes("{{schema}}"),
          `query ${q.id} skal være pg_catalog-only, men bruker {{schema}}`,
        );
        continue;
      }
      assert.ok(
        q.sql.includes("{{schema}}"),
        `query ${q.id} bruker ikke {{schema}}-placeholder`,
      );
    }
  });

  test("alle SQL-strings inneholder kun SELECT/WITH (read-only)", () => {
    const queries = loadQueries();
    for (const q of queries) {
      const sql = q.sql.trim().toUpperCase();
      const isReadOnly =
        sql.startsWith("SELECT") || sql.startsWith("WITH");
      assert.ok(
        isReadOnly,
        `query ${q.id} starter ikke med SELECT/WITH — ALLE queries må være read-only`,
      );
      // Defense-in-depth: aldri DML-verb i SQL.
      const forbidden = ["INSERT ", "UPDATE ", "DELETE ", "DROP ", "TRUNCATE ", "ALTER "];
      for (const word of forbidden) {
        assert.ok(
          !sql.includes(word),
          `query ${q.id} inneholder forbudt ord '${word.trim()}'`,
        );
      }
    }
  });

  test("alle quick-queries finnes (minst 5 stk)", () => {
    const queries = loadQueries();
    const quick = queries.filter((q: { quick?: boolean }) => q.quick === true);
    assert.ok(
      quick.length >= 5,
      `forventet >=5 quick queries, fant ${quick.length}`,
    );
  });

  test("ingen duplikate query-id-er", () => {
    const queries = loadQueries();
    const ids = queries.map((q: { id: string }) => q.id);
    const unique = new Set(ids);
    assert.equal(
      ids.length,
      unique.size,
      "duplikate id-er er ikke tillatt",
    );
  });
});

// ── Markdown report ────────────────────────────────────────────────────────

describe("buildMarkdownReport", () => {
  function mkResult(opts: {
    id?: string;
    tier?: string;
    ok?: boolean;
    rows?: Array<Record<string, unknown>>;
    error?: string | null;
  }) {
    return {
      ok: opts.ok ?? true,
      rowCount: opts.rows?.length ?? 0,
      rows: opts.rows ?? [],
      fields: opts.rows && opts.rows.length > 0 ? Object.keys(opts.rows[0]) : [],
      elapsedMs: 42,
      error: opts.error ?? null,
      query: {
        id: opts.id ?? "test-query",
        tier: opts.tier ?? "P1",
        severity: opts.tier ?? "P1",
        category: "stuck-state",
        description: "Test query",
        sql: "SELECT 1",
        fixAdvice: "Test fix advice",
      },
    };
  }

  test("renders header med timestamp og schema", () => {
    const md = buildMarkdownReport({
      timestamp: "2026-05-14T01:23:00Z",
      schema: "public",
      dbHost: "localhost:5432/test",
      results: [],
      options: { tier: null, quick: false },
    });
    assert.ok(md.includes("DB-audit-rapport — 2026-05-14T01:23:00Z"));
    assert.ok(md.includes("**Schema:** `public`"));
    assert.ok(md.includes("localhost:5432/test"));
  });

  test("renders P1-section når finn finnes", () => {
    const md = buildMarkdownReport({
      timestamp: "2026-05-14T01:23:00Z",
      schema: "public",
      dbHost: null,
      results: [
        mkResult({ id: "stuck-thing", tier: "P1", rows: [{ id: "x" }] }),
      ],
      options: { tier: null, quick: false },
    });
    assert.ok(md.includes("## P1 Bad-state"));
    assert.ok(md.includes("### stuck-thing"));
    assert.ok(md.includes("Test fix advice"));
  });

  test("renders sammendrag", () => {
    const md = buildMarkdownReport({
      timestamp: "2026-05-14T01:23:00Z",
      schema: "public",
      dbHost: null,
      results: [
        mkResult({ id: "ok-q", rows: [] }),
        mkResult({ id: "p1-finding", tier: "P1", rows: [{ x: 1 }] }),
      ],
      options: { tier: null, quick: false },
    });
    assert.ok(md.includes("## Sammendrag"));
    assert.ok(md.includes("P1: 1 funn"));
    assert.ok(md.includes("Helse-OK: 1"));
  });

  test("renders query-feil-seksjon", () => {
    const md = buildMarkdownReport({
      timestamp: "2026-05-14T01:23:00Z",
      schema: "public",
      dbHost: null,
      results: [mkResult({ id: "fail-q", ok: false, error: "table not found" })],
      options: { tier: null, quick: false },
    });
    assert.ok(md.includes("## Query-feil"));
    assert.ok(md.includes("table not found"));
  });
});

// ── JSON report ────────────────────────────────────────────────────────────

describe("buildJsonReport", () => {
  test("returnerer shape med summary og results", () => {
    const json = buildJsonReport({
      timestamp: "2026-05-14T01:23:00Z",
      schema: "public",
      dbHost: null,
      results: [
        {
          ok: true,
          rowCount: 2,
          rows: [{ a: 1 }, { a: 2 }],
          fields: ["a"],
          elapsedMs: 10,
          error: null,
          query: {
            id: "q1",
            tier: "P1",
            severity: "P1",
            category: "stuck-state",
            description: "desc",
            sql: "SELECT 1",
            fixAdvice: "fix it",
          },
        },
      ],
      options: { tier: null, quick: false },
    });
    assert.equal(json.timestamp, "2026-05-14T01:23:00Z");
    assert.equal(json.schema, "public");
    assert.equal(json.summary.totalQueries, 1);
    assert.equal(json.summary.totalFindings, 1);
    assert.equal(json.summary.findingsByTier.P1, 1);
    assert.equal(json.results[0].id, "q1");
    assert.equal(json.results[0].rowCount, 2);
    assert.equal(json.results[0].rows.length, 2);
  });

  test("tomme results gir totalFindings=0", () => {
    const json = buildJsonReport({
      timestamp: "2026-05-14T01:23:00Z",
      schema: "public",
      dbHost: null,
      results: [
        {
          ok: true,
          rowCount: 0,
          rows: [],
          fields: [],
          elapsedMs: 5,
          error: null,
          query: { id: "q1", tier: "P1", severity: "P1", category: "x", description: "d", sql: "SELECT 1", fixAdvice: "a" },
        },
      ],
      options: { tier: null, quick: false },
    });
    assert.equal(json.summary.totalFindings, 0);
    assert.equal(json.summary.okCount, 1);
  });

  test("trunkerer rows til max 50 i JSON", () => {
    const manyRows = Array.from({ length: 100 }, (_, i) => ({ i }));
    const json = buildJsonReport({
      timestamp: "2026-05-14T01:23:00Z",
      schema: "public",
      dbHost: null,
      results: [
        {
          ok: true,
          rowCount: 100,
          rows: manyRows,
          fields: ["i"],
          elapsedMs: 50,
          error: null,
          query: { id: "q1", tier: "P2", severity: "P2", category: "x", description: "d", sql: "SELECT 1", fixAdvice: "a" },
        },
      ],
      options: { tier: null, quick: false },
    });
    assert.equal(json.results[0].rowCount, 100);
    assert.equal(json.results[0].rows.length, 50);
  });
});
