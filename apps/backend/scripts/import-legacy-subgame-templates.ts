#!/usr/bin/env npx tsx
/**
 * G9: ETL CLI for å importere legacy MongoDB sub-game-maler.
 *
 * Tynn wrapper rundt `runImport()` i `src/scripts/legacySubGameImporter.ts`.
 * Logikk + Zod-validering + UPSERT-flyt ligger i src så den kan unit-testes.
 *
 * Bruk:
 *   npx tsx scripts/import-legacy-subgame-templates.ts --file path/to/templates.json
 *
 * Flagg:
 *   --file <path>      Påkrevd. Sti til JSON-eksport fra legacy MongoDB.
 *   --dry-run          Validér + rapportér uten å skrive til DB.
 *   --schema <name>    Postgres-schema (default: APP_PG_SCHEMA env eller 'public').
 *   --created-by <id>  Actor-id som settes på nye rader (default: 'system-etl').
 *
 * Env:
 *   APP_PG_CONNECTION_STRING (påkrevd, samme som backend).
 *   APP_PG_SCHEMA (valgfri, default 'public').
 *
 * Inputformat (JSON):
 *   {
 *     "gameTypes": [ ... ],
 *     "subGames": [ ... ],
 *     "patterns": [ ... ]
 *   }
 *
 * Aliaser støttes: `gameTypeTemplates`, `subGame1Templates`,
 * `subGameTemplates`, `patternTemplates`. Se LegacyPayloadSchema for
 * komplett felt-spec.
 *
 * Idempotent: kan kjøres flere ganger. UPSERT-nøkler:
 *   GameType  → type_slug
 *   SubGame   → sub_game_number (auto-utledes fra navn hvis ikke gitt)
 *   Pattern   → (game_type_id, pattern_number)
 *
 * Eksempler:
 *   # Dry-run for å sjekke før første live-import
 *   APP_PG_CONNECTION_STRING=... \
 *     npx tsx scripts/import-legacy-subgame-templates.ts \
 *     --file legacy-templates.json --dry-run
 *
 *   # Faktisk import
 *   APP_PG_CONNECTION_STRING=... \
 *     npx tsx scripts/import-legacy-subgame-templates.ts \
 *     --file legacy-templates.json
 */

import { readFileSync } from "node:fs";
import pg from "pg";
import { runImport } from "../src/scripts/legacySubGameImporter.js";

// ── CLI arg parsing ─────────────────────────────────────────────────────────

function getArg(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

const file = getArg("--file");
const schemaArg = getArg("--schema");
const createdBy = getArg("--created-by") ?? "system-etl";
const dryRun = process.argv.includes("--dry-run");

if (!file) {
  console.error(
    "Usage: npx tsx scripts/import-legacy-subgame-templates.ts --file <path.json> [--dry-run] [--schema public] [--created-by id]"
  );
  process.exit(1);
}

const connectionString = process.env.APP_PG_CONNECTION_STRING;
if (!connectionString) {
  console.error("Error: APP_PG_CONNECTION_STRING env var required.");
  process.exit(1);
}

const schema = (schemaArg ?? process.env.APP_PG_SCHEMA ?? "public").trim();

// ── Read + parse input ──────────────────────────────────────────────────────

let raw: string;
try {
  raw = readFileSync(file, "utf-8");
} catch (err) {
  console.error(`Error: kunne ikke lese fil '${file}': ${(err as Error).message}`);
  process.exit(1);
}

let payload: unknown;
try {
  payload = JSON.parse(raw);
} catch (err) {
  console.error(`Error: ugyldig JSON i '${file}': ${(err as Error).message}`);
  process.exit(1);
}

// ── Run import ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const report = await runImport(client, payload, {
      dryRun,
      schema,
      createdBy,
    });

    console.log("\n──────────────── RAPPORT ────────────────");
    console.log(`Total:    ${report.total}`);
    console.log(`Created:  ${report.created}`);
    console.log(`Updated:  ${report.updated}`);
    console.log(`Skipped:  ${report.skipped}`);
    console.log(`Failed:   ${report.failed}`);
    if (dryRun) {
      console.log("(DRY RUN — ingen DB-endringer)");
    }
    if (report.failed > 0) {
      console.log("\nFeilet (per resource/key):");
      for (const r of report.records) {
        if (r.action === "failed") {
          console.log(`  ${r.resource} '${r.key}': ${r.reason}`);
        }
      }
      process.exitCode = 2;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Import-feilet:", err);
  process.exit(1);
});
