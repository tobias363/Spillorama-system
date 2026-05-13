#!/usr/bin/env node
/**
 * Static DB-auditor — Steg 1 av 3-stegs DB-auditor-plan.
 *
 * Kjører 20-25 SQL-queries mot pilot-Postgres, detekterer kjente bug-
 * patterns og arkitektur-smells, og output-er en markdown-rapport.
 *
 * Komplementerer eksisterende Sentry + PostHog + Rrweb + EventTracker.
 * Bundles automatisk inn i bug-rapport-bundleren (devBugReport.ts).
 *
 * ## Bruk
 *
 *   APP_PG_CONNECTION_STRING="postgres://..." \
 *     npm run audit:db
 *
 * ## Flags
 *
 *   --json              Output JSON (default: markdown to file + console)
 *   --tier <P1|P2|P3>   Kun queries med valgt severity-tier
 *   --quick             Kun queries merket `quick: true` (rask < 5s totalt)
 *   --db-url <conn>     DB connection string (default: $APP_PG_CONNECTION_STRING)
 *   --schema <name>     Postgres schema (default: $APP_PG_SCHEMA eller "public")
 *   --output <file>     Skriv markdown til fil (default: /tmp/db-audit-<ts>.md)
 *   --silent            Ikke skriv til console (kun fil/JSON)
 *   --help              Vis denne hjelpen
 *
 * ## Exit-codes
 *
 *   0 — alt OK, ingen P1-funn
 *   1 — P1-funn detektert (kritisk bad-state)
 *   2 — runtime-feil (DB ikke tilgjengelig, etc.)
 *
 * ## Sikkerhet
 *
 *   * READ-ONLY — kun SELECT-statements. Aldri INSERT/UPDATE/DELETE.
 *   * Hver query har 5s timeout. Total kjøretid < 30s for `--quick`,
 *     < 60s for full kjøring.
 *   * Schema-navn valideres mot regex for å unngå SQL-injection.
 *   * Idempotent — kan kjøres gjentatte ganger uten side-effekt.
 *
 * ## Implementasjon
 *
 *   Queries lever i `audit-db.queries.json` (data-driven for senere
 *   Steg 2 cron-service og Steg 3 AI-anbefalinger).
 *
 * Tobias-direktiv 2026-05-13.
 */

import pg from "pg";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const QUERIES_PATH = join(__dirname, "audit-db.queries.json");

const DEFAULT_QUERY_TIMEOUT_MS = 5000;
const TIER_ORDER = ["P1", "P2", "P3"];
const SCHEMA_REGEX = /^[a-z_][a-z0-9_]*$/;

// ── CLI-parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    json: false,
    tier: null,
    quick: false,
    dbUrl: null,
    schema: null,
    output: null,
    silent: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--quick") args.quick = true;
    else if (a === "--silent") args.silent = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--tier") args.tier = argv[++i];
    else if (a === "--db-url") args.dbUrl = argv[++i];
    else if (a === "--schema") args.schema = argv[++i];
    else if (a === "--output") args.output = argv[++i];
  }
  return args;
}

function printHelp() {
  const text = `
audit-db — Static DB-auditor for pilot-state

Bruk:
  npm run audit:db [-- flags]

Flagg:
  --json              Output JSON i stedet for markdown
  --tier <P1|P2|P3>   Kun queries med valgt severity-tier
  --quick             Kun queries merket "quick: true" (rask < 5s totalt)
  --db-url <conn>     DB connection string (default: \$APP_PG_CONNECTION_STRING)
  --schema <name>     Postgres schema (default: \$APP_PG_SCHEMA eller "public")
  --output <file>     Skriv markdown til fil (default: /tmp/db-audit-<ts>.md)
  --silent            Ikke skriv til console
  --help              Vis denne hjelpen

Exit-codes:
  0  alt OK, ingen P1-funn
  1  P1-funn detektert
  2  runtime-feil
`;
  console.log(text.trim());
}

// ── Queries loading ────────────────────────────────────────────────────────

export function loadQueries() {
  const raw = readFileSync(QUERIES_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.queries)) {
    throw new Error(
      `audit-db.queries.json mangler 'queries' array (path: ${QUERIES_PATH})`,
    );
  }
  return parsed.queries;
}

export function filterQueries(queries, opts) {
  let filtered = queries;
  if (opts.tier) {
    const tier = String(opts.tier).toUpperCase();
    filtered = filtered.filter((q) => String(q.tier).toUpperCase() === tier);
  }
  if (opts.quick) {
    filtered = filtered.filter((q) => q.quick === true);
  }
  return filtered;
}

// ── SQL execution ──────────────────────────────────────────────────────────

function substituteSchema(sql, schema) {
  return sql.replace(/\{\{schema\}\}/g, schema);
}

async function runQuery(pool, query, schema, timeoutMs) {
  const sql = substituteSchema(query.sql, schema);
  const client = await pool.connect();
  try {
    // Set per-statement timeout slik at vi aldri henger på en treg query.
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    const start = Date.now();
    const result = await client.query(sql);
    const elapsedMs = Date.now() - start;
    return {
      ok: true,
      rowCount: result.rowCount ?? result.rows.length,
      rows: result.rows,
      fields: result.fields ? result.fields.map((f) => f.name) : [],
      elapsedMs,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      rowCount: 0,
      rows: [],
      fields: [],
      elapsedMs: 0,
      error: String(err.message ?? err),
    };
  } finally {
    client.release();
  }
}

// ── Output formatting ──────────────────────────────────────────────────────

function formatValue(v) {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "[unserializable]";
    }
  }
  // Truncate long strings i tabell-render
  const s = String(v);
  return s.length > 200 ? s.slice(0, 197) + "..." : s;
}

function renderRowsAsTable(rows, fields) {
  if (!rows || rows.length === 0) return "_(ingen rader)_";
  const cols = fields.length > 0 ? fields : Object.keys(rows[0]);
  const header = "| " + cols.join(" | ") + " |";
  const sep = "| " + cols.map(() => "---").join(" | ") + " |";
  const body = rows.map(
    (r) => "| " + cols.map((c) => formatValue(r[c])).join(" | ") + " |",
  );
  return [header, sep, ...body].join("\n");
}

export function buildMarkdownReport(args) {
  const { timestamp, schema, dbHost, results, options } = args;
  const lines = [];

  // Header
  lines.push(`# DB-audit-rapport — ${timestamp}`);
  lines.push("");
  lines.push(`**Schema:** \`${schema}\``);
  lines.push(`**DB-host:** ${dbHost ?? "(default)"}`);
  lines.push(`**Filter:** tier=${options.tier ?? "alle"}, quick=${options.quick}`);
  lines.push(`**Total queries:** ${results.length}`);
  lines.push("");

  // Summary by tier
  const byTier = {};
  for (const tier of TIER_ORDER) byTier[tier] = [];
  let totalFindings = 0;
  let totalErrors = 0;
  let okCount = 0;
  for (const r of results) {
    if (!r.ok) totalErrors++;
    if (r.ok && r.rowCount === 0) {
      okCount++;
      continue;
    }
    if (r.ok && r.rowCount > 0) {
      totalFindings++;
      const tier = r.query.tier ?? "P3";
      if (!byTier[tier]) byTier[tier] = [];
      byTier[tier].push(r);
    }
  }

  lines.push(`**Funn:** P1×${byTier.P1?.length ?? 0}, P2×${byTier.P2?.length ?? 0}, P3×${byTier.P3?.length ?? 0}`);
  lines.push(`**Query-feil:** ${totalErrors}`);
  lines.push(`**Helse-OK (0 rader):** ${okCount}`);
  lines.push("");

  // Per-tier sections
  for (const tier of TIER_ORDER) {
    const queryResults = byTier[tier] ?? [];
    if (queryResults.length === 0) continue;
    const tierLabel =
      tier === "P1"
        ? "P1 Bad-state (kritisk)"
        : tier === "P2"
          ? "P2 Arkitektur-smell"
          : "P3 Performance";
    lines.push(`## ${tierLabel} (${queryResults.length} funn)`);
    lines.push("");

    for (const r of queryResults) {
      lines.push(`### ${r.query.id} (${r.rowCount} rader)`);
      lines.push("");
      lines.push(`**Severity:** ${r.query.severity ?? r.query.tier}`);
      lines.push(`**Kategori:** ${r.query.category ?? "—"}`);
      lines.push(`**Tid:** ${r.elapsedMs}ms`);
      lines.push("");
      lines.push(r.query.description ?? "(ingen beskrivelse)");
      lines.push("");

      // Truncate display rows til max 20 for å holde rapporten lesbar.
      const displayRows = r.rows.slice(0, 20);
      lines.push(renderRowsAsTable(displayRows, r.fields));
      if (r.rows.length > displayRows.length) {
        lines.push("");
        lines.push(`_(viser første ${displayRows.length} av ${r.rows.length} rader)_`);
      }
      lines.push("");

      if (r.query.fixAdvice) {
        lines.push(`**Fix-anbefaling:** ${r.query.fixAdvice}`);
      }
      lines.push("");
    }
  }

  // Errors section
  const errors = results.filter((r) => !r.ok);
  if (errors.length > 0) {
    lines.push(`## Query-feil (${errors.length})`);
    lines.push("");
    for (const r of errors) {
      lines.push(`- **${r.query.id}**: ${r.error}`);
    }
    lines.push("");
  }

  // Helse-OK section
  const okResults = results.filter((r) => r.ok && r.rowCount === 0);
  if (okResults.length > 0) {
    lines.push(`## Helse-OK (0 funn på ${okResults.length} queries)`);
    lines.push("");
    for (const r of okResults) {
      lines.push(`- \`${r.query.id}\` (${r.query.tier}) — ${r.elapsedMs}ms`);
    }
    lines.push("");
  }

  // Summary
  lines.push("## Sammendrag");
  lines.push("");
  lines.push(`- P1: ${byTier.P1?.length ?? 0} funn ${(byTier.P1?.length ?? 0) > 0 ? "— gjenstår å fikse" : "— OK"}`);
  lines.push(`- P2: ${byTier.P2?.length ?? 0} funn ${(byTier.P2?.length ?? 0) > 0 ? "— bør planlegges" : "— OK"}`);
  lines.push(`- P3: ${byTier.P3?.length ?? 0} funn ${(byTier.P3?.length ?? 0) > 0 ? "— observasjon" : "— OK"}`);
  lines.push(`- Helse-OK: ${okCount} queries returnerte ingen rader`);
  if (totalErrors > 0) {
    lines.push(`- ⚠️ ${totalErrors} queries feilet under kjøring`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("_Generert av `audit-db.mjs` — Steg 1 av 3-stegs DB-auditor-plan._");

  return lines.join("\n");
}

export function buildJsonReport(args) {
  const { timestamp, schema, dbHost, results, options } = args;
  const byTier = { P1: 0, P2: 0, P3: 0 };
  let totalFindings = 0;
  let totalErrors = 0;
  let okCount = 0;
  for (const r of results) {
    if (!r.ok) {
      totalErrors++;
      continue;
    }
    if (r.rowCount === 0) {
      okCount++;
      continue;
    }
    totalFindings++;
    const tier = r.query.tier ?? "P3";
    byTier[tier] = (byTier[tier] ?? 0) + 1;
  }
  return {
    timestamp,
    schema,
    dbHost,
    options,
    summary: {
      totalQueries: results.length,
      totalFindings,
      totalErrors,
      okCount,
      findingsByTier: byTier,
    },
    results: results.map((r) => ({
      id: r.query.id,
      tier: r.query.tier,
      severity: r.query.severity,
      category: r.query.category,
      description: r.query.description,
      fixAdvice: r.query.fixAdvice,
      ok: r.ok,
      rowCount: r.rowCount,
      elapsedMs: r.elapsedMs,
      error: r.error,
      rows: r.ok && r.rowCount > 0 ? r.rows.slice(0, 50) : [],
      // Inkluder ikke rows for ok-with-0-rows for å holde JSON liten.
    })),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const dbUrl = args.dbUrl ?? process.env.APP_PG_CONNECTION_STRING ?? "";
  const schema = (args.schema ?? process.env.APP_PG_SCHEMA ?? "public").trim();

  if (!dbUrl) {
    console.error(
      "FEIL: mangler DB connection. Bruk --db-url eller sett APP_PG_CONNECTION_STRING.",
    );
    process.exit(2);
  }
  if (!SCHEMA_REGEX.test(schema)) {
    console.error(`FEIL: ugyldig schema-navn '${schema}' (matche /^[a-z_][a-z0-9_]*$/)`);
    process.exit(2);
  }

  // Hent DB-host for rapport-kontekst (uten passord).
  let dbHost = null;
  try {
    const parsed = new URL(dbUrl);
    dbHost = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    /* OK, ikke kritisk */
  }

  const allQueries = loadQueries();
  const queries = filterQueries(allQueries, args);

  if (queries.length === 0) {
    console.error(
      `Ingen queries matcher filter (tier=${args.tier}, quick=${args.quick}).`,
    );
    process.exit(0);
  }

  const pool = new Pool({
    connectionString: dbUrl,
    max: 4,
    // Beskytter mot evig henging — totalt timeout per connection.
    statement_timeout: 60_000,
  });

  if (!args.silent && !args.json) {
    console.error(`[audit-db] Starter ${queries.length} queries mot ${dbHost ?? "DB"} (schema=${schema})`);
  }

  const results = [];
  const overallStart = Date.now();
  for (const q of queries) {
    const timeoutMs = q.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    const result = await runQuery(pool, q, schema, timeoutMs);
    result.query = q;
    results.push(result);
    if (!args.silent && !args.json) {
      const status = result.ok
        ? result.rowCount === 0
          ? "OK"
          : `${result.rowCount} funn`
        : "FEIL";
      console.error(`[audit-db] ${q.id} (${q.tier}) — ${status} — ${result.elapsedMs}ms`);
    }
  }
  const overallMs = Date.now() - overallStart;

  await pool.end();

  const timestamp = new Date().toISOString();
  const reportArgs = {
    timestamp,
    schema,
    dbHost,
    results,
    options: { tier: args.tier, quick: args.quick },
  };

  // JSON mode for bug-rapport-bundler
  if (args.json) {
    const json = buildJsonReport(reportArgs);
    json.elapsedMsTotal = overallMs;
    if (args.output) {
      try {
        mkdirSync(dirname(args.output), { recursive: true });
      } catch {
        /* OK */
      }
      writeFileSync(args.output, JSON.stringify(json, null, 2), "utf8");
      if (!args.silent) {
        console.error(`[audit-db] JSON skrevet til ${args.output}`);
      }
    } else {
      process.stdout.write(JSON.stringify(json, null, 2) + "\n");
    }
  } else {
    // Markdown mode
    const md = buildMarkdownReport(reportArgs);
    const outputPath =
      args.output ?? `/tmp/db-audit-${timestamp.replace(/[:.]/g, "-")}.md`;
    try {
      mkdirSync(dirname(outputPath), { recursive: true });
    } catch {
      /* OK */
    }
    writeFileSync(outputPath, md, "utf8");
    if (!args.silent) {
      console.error(`[audit-db] Markdown skrevet til ${outputPath} (${overallMs}ms total)`);
      process.stdout.write(md + "\n");
    }
  }

  // Exit-code basert på P1-funn eller errors
  const hasP1 = results.some(
    (r) => r.ok && r.rowCount > 0 && r.query.tier === "P1",
  );
  const hasError = results.some((r) => !r.ok);
  if (hasError) process.exit(2);
  if (hasP1) process.exit(1);
  process.exit(0);
}

// Run only when invoked directly (not when imported)
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error("[audit-db] FATAL:", err);
    process.exit(2);
  });
}

// Test-only exports
export const __TEST_ONLY__ = {
  parseArgs,
  filterQueries,
  substituteSchema,
  formatValue,
  renderRowsAsTable,
};
