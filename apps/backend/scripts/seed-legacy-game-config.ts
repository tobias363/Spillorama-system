#!/usr/bin/env npx tsx
/**
 * Seed legacy admin-panel snapshots → ny backend.
 *
 * Foundational migration som tar 9 JSON dump-filer fra
 * `https://spillorama.aistechnolabs.info` admin-panel og populerer:
 *   - app_game_types
 *   - app_sub_games
 *   - app_patterns
 *   - app_schedules
 *   - app_daily_schedules
 *
 * All logikk lever i `src/scripts/seedLegacyGameConfig.ts` så den kan
 * unit-testes. Denne wrapperen er kun CLI-arg-parsing + DB-tilkobling +
 * rapportering.
 *
 * Bruk:
 *   # Dry-run — valider + rapportér uten DB-skriv
 *   APP_PG_CONNECTION_STRING=... \
 *     npx tsx scripts/seed-legacy-game-config.ts --dry-run
 *
 *   # Faktisk seed (idempotent UPSERT — kan kjøres flere ganger)
 *   APP_PG_CONNECTION_STRING=... \
 *     npx tsx scripts/seed-legacy-game-config.ts
 *
 *   # Tilpasset snapshot-katalog
 *   APP_PG_CONNECTION_STRING=... \
 *     npx tsx scripts/seed-legacy-game-config.ts \
 *       --snapshot-dir /path/to/snapshots/2026-04-30
 *
 * Flagg:
 *   --snapshot-dir <path>   Default: docs/legacy-snapshots/2026-04-30
 *   --dry-run               Validér uten DB-writes
 *   --schema <name>         Postgres-schema (default: APP_PG_SCHEMA env eller 'public')
 *   --created-by <id>       Actor-id for nye rader (default: 'system-seed-legacy')
 *
 * Env:
 *   APP_PG_CONNECTION_STRING  (påkrevd, samme som backend)
 *   APP_PG_SCHEMA             (valgfri, default 'public')
 *
 * Idempotent: scriptet kan kjøres flere ganger uten å duplisere data.
 * UPSERT-nøkler:
 *   - GameType:      type_slug
 *   - SubGame:       sub_game_number
 *   - Pattern:       (game_type_id, pattern_number)
 *   - Schedule:      schedule_number
 *   - DailySchedule: id (preserveres fra legacy schedule_object_id)
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { runSeed } from "../src/scripts/seedLegacyGameConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── CLI arg parsing ─────────────────────────────────────────────────────────

function getArg(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

const snapshotDirArg = getArg("--snapshot-dir");
const schemaArg = getArg("--schema");
const createdBy = getArg("--created-by") ?? "system-seed-legacy";
const dryRun = process.argv.includes("--dry-run");

// Default snapshot-katalog er repo-relativ:
//   apps/backend/scripts/seed-legacy-game-config.ts → repo-rot er ../../..
const defaultSnapshotDir = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "legacy-snapshots",
  "2026-04-30"
);

const snapshotDir = snapshotDirArg
  ? path.resolve(snapshotDirArg)
  : defaultSnapshotDir;

const connectionString = process.env.APP_PG_CONNECTION_STRING;
if (!connectionString) {
  console.error("Error: APP_PG_CONNECTION_STRING env var required.");
  process.exit(1);
}

const schema = (schemaArg ?? process.env.APP_PG_SCHEMA ?? "public").trim();

// ── Run seed ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    if (!dryRun) {
      await client.query("BEGIN");
    }
    const report = await runSeed(client, {
      snapshotDir,
      dryRun,
      schema,
      createdBy,
    });

    if (!dryRun) {
      await client.query("COMMIT");
    }

    console.log("\n──────────────── RAPPORT ────────────────");
    console.log(`Total:    ${report.total}`);
    console.log(`Created:  ${report.created}`);
    console.log(`Updated:  ${report.updated}`);
    console.log(`Skipped:  ${report.skipped}`);
    console.log(`Failed:   ${report.failed}`);
    console.log("");
    console.log("Per resource:");
    for (const [key, agg] of Object.entries(report.perResource)) {
      const skippedStr =
        "skipped" in agg && agg.skipped > 0 ? ` skipped=${agg.skipped}` : "";
      console.log(
        `  ${key.padEnd(15)} total=${agg.total} created=${agg.created} updated=${agg.updated} failed=${agg.failed}${skippedStr}`
      );
    }
    if (dryRun) {
      console.log("\n(DRY RUN — ingen DB-endringer)");
    }
    if (report.mapping.skippedLegacyTypes.length > 0) {
      console.log("\nSkipped legacy-types:");
      for (const s of report.mapping.skippedLegacyTypes) {
        console.log(`  - ${s}`);
      }
    }
    if (report.mapping.droppedLegacyFields.length > 0) {
      console.log("\nDropped legacy-fields:");
      for (const s of report.mapping.droppedLegacyFields) {
        console.log(`  - ${s}`);
      }
    }
    if (report.mapping.unknownTicketColors.length > 0) {
      console.log("\nUnknown ticket-colors (skulle ikke skje — sjekk):");
      for (const s of report.mapping.unknownTicketColors) {
        console.log(`  - ${s}`);
      }
    }
    if (report.failed > 0) {
      console.log("\nFeilet:");
      for (const r of report.records) {
        if (r.action === "failed") {
          console.log(`  ${r.resource} '${r.key}': ${r.reason}`);
        }
      }
      process.exitCode = 2;
    }
  } catch (err) {
    if (!dryRun) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback errors — connection may already be dead.
      }
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Seed-feilet:", err);
  process.exit(1);
});
