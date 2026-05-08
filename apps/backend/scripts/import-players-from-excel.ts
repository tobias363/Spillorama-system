#!/usr/bin/env npx tsx
/**
 * One-shot Excel Player Import (Fase 1 MVP §22).
 *
 * Migrates the ~6000 legacy players from Tobias' Excel file into Spillorama
 * PostgreSQL. Run ONCE in production. Idempotent: re-running skips already-
 * imported rows by email + phone, so a partial run is safe to retry.
 *
 * Usage:
 *   npx tsx apps/backend/scripts/import-players-from-excel.ts \
 *     --input <path/to/players.xlsx> \
 *     [--dry-run] \
 *     [--report-dir <dir>] \
 *     [--sheet <name>] \
 *     [--default-hall-id <hallId>] \
 *     [--strict-hall]
 *
 * Flags:
 *   --input            Excel file (.xlsx, .xls). Required.
 *   --dry-run          Parse + validate, no DB writes.
 *   --report-dir       Where to write CSV reports. Default: ./import-reports.
 *   --sheet            Sheet name to read. Default: first sheet.
 *   --default-hall-id  Override main-hall fallback (for hall_number = 0/null).
 *                      If unset, the script auto-resolves a fallback hall:
 *                      the hall with hall_number = 0, else the lowest-id hall.
 *                      Use --strict-hall to disable any fallback.
 *   --strict-hall      Disable fallback — reject rows with blank/0 hall_number.
 *
 * Outputs:
 *   <report-dir>/import-imported-<timestamp>.csv  — successfully imported rows
 *   <report-dir>/import-errors-<timestamp>.csv    — rows that failed
 *   stdout                                         — summary stats
 *
 * The script:
 *   1. Reads the Excel file via the `xlsx` package.
 *   2. Looks up `app_halls` rows to build a hall_number → id map.
 *   3. Calls PlayerExcelImport.parseSheet to validate every row.
 *   4. For each valid row: skips if email or phone already exists (DB-side
 *      idempotency). Otherwise creates user + wallet inside one transaction,
 *      with kyc_status=PENDING (admin moderator must approve before play).
 *   5. Writes CSV reports + prints stats.
 *
 * Permanent admin-UI re-import is OUT OF SCOPE — see `parseSheet` docs.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import * as XLSX from "xlsx";

import {
  parseSheet,
  serializeImportedCsv,
  serializeErrorsCsv,
  type ParsedPlayerRow,
  type RowError,
  type RawRow,
  type ParserContext,
} from "../src/admin/PlayerExcelImport.js";

const scrypt = promisify(scryptCallback);

// ── CLI args ─────────────────────────────────────────────────────────────────

interface CliArgs {
  input: string;
  dryRun: boolean;
  reportDir: string;
  sheet: string | null;
  defaultHallId: string | null;
  strictHall: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    input: "",
    dryRun: false,
    reportDir: "./import-reports",
    sheet: null,
    defaultHallId: null,
    strictHall: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--input") args.input = argv[++i] ?? "";
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--report-dir") args.reportDir = argv[++i] ?? args.reportDir;
    else if (a === "--sheet") args.sheet = argv[++i] ?? null;
    else if (a === "--default-hall-id") args.defaultHallId = argv[++i] ?? null;
    else if (a === "--strict-hall") args.strictHall = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  if (!args.input) {
    printHelp();
    process.exit(2);
  }
  return args;
}

function printHelp() {
  console.log(`
Excel Player Import — one-shot migration of legacy players.

Usage:
  npx tsx apps/backend/scripts/import-players-from-excel.ts --input <file> [flags]

Required:
  --input <file>          Excel file (.xlsx or .xls)

Flags:
  --dry-run               Parse + validate, no DB writes
  --report-dir <dir>      Where to write CSV reports (default: ./import-reports)
  --sheet <name>          Sheet name to read (default: first sheet)
  --default-hall-id <id>  Override main-hall fallback for blank hall_number
  --strict-hall           Reject rows with blank/0 hall_number (no fallback)

Required column headers (case-insensitive, Norwegian aliases accepted):
  Username                 Display name (or 'Brukernavn')
  Hall Number              Legacy hall number (or 'Hallnummer')
  Email and/or Phone Number  At least one required

Optional column headers:
  Surname / Last Name      ('Etternavn')
  First Name               ('Fornavn')
  Birth Date               YYYY-MM-DD or DD.MM.YYYY ('Fødselsdato')
  Customer Number          ('Kundenummer')

Environment:
  APP_PG_CONNECTION_STRING (required) — Postgres URL
  APP_PG_SCHEMA            (default: public)

Behavior:
  - kyc_status set to PENDING (moderator must approve before play).
  - Random temp password assigned; player must use forgot-password.
  - Idempotent: existing email or phone is skipped, never overwritten.
  - Excel file is read with cellDates:true so date cells parse correctly.
`);
}

// ── DB helpers ───────────────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<string> {
  // Mirrors PlatformService.hashPassword — same envelope so the user can
  // log in normally afterward (though they'll need to reset via the
  // forgot-password flow since this temp password is never shown).
  const salt = randomBytes(16);
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
}

async function loadHallNumberMap(
  client: pg.Client,
  schema: string
): Promise<Map<number, string>> {
  const { rows } = await client.query<{ id: string; hall_number: number | null }>(
    `SELECT id, hall_number FROM ${schema}.app_halls WHERE hall_number IS NOT NULL`
  );
  const map = new Map<number, string>();
  for (const r of rows) {
    if (r.hall_number !== null) {
      map.set(r.hall_number, r.id);
    }
  }
  return map;
}

/**
 * Pick a fallback hall_id when --default-hall-id is not provided.
 * Strategy:
 *   1. Hall with hall_number = 0 (legacy "main hall" convention)
 *   2. First active hall ordered by id (deterministic)
 *   3. null if no halls exist
 */
async function resolveDefaultHall(
  client: pg.Client,
  schema: string
): Promise<string | null> {
  const { rows: zeroRows } = await client.query<{ id: string }>(
    `SELECT id FROM ${schema}.app_halls WHERE hall_number = 0 LIMIT 1`
  );
  if (zeroRows[0]) return zeroRows[0].id;

  const { rows: anyRows } = await client.query<{ id: string }>(
    `SELECT id FROM ${schema}.app_halls
     WHERE is_active = true
     ORDER BY id
     LIMIT 1`
  );
  return anyRows[0]?.id ?? null;
}

interface ImportStats {
  attempted: number;
  inserted: number;
  skippedDuplicate: number;
  failedAtDb: number;
}

interface DbReason {
  rowNumber: number;
  reason: string;
  email: string | null;
  phone: string | null;
}

async function importRow(
  client: pg.Client,
  schema: string,
  row: ParsedPlayerRow
): Promise<"inserted" | "skipped"> {
  // Idempotency: check both email and phone.
  if (row.email) {
    const { rows: existing } = await client.query<{ id: string }>(
      `SELECT id FROM ${schema}.app_users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [row.email]
    );
    if (existing[0]) return "skipped";
  }
  if (row.phone) {
    const { rows: existing } = await client.query<{ id: string }>(
      `SELECT id FROM ${schema}.app_users WHERE phone = $1 AND deleted_at IS NULL LIMIT 1`,
      [row.phone]
    );
    if (existing[0]) return "skipped";
  }
  // Generate a random unguessable temp password (player resets via email link).
  const tempPassword = randomBytes(16).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  const userId = randomUUID();
  const walletId = `wallet-user-${userId}`;
  // Synthesize an email if missing — we keep app_users.email NOT NULL.
  // Format intentionally invalid so it cannot be used to log in or reach
  // the user; the player must add a real email via support.
  const email =
    row.email ??
    `imported-${userId}@no-email.spillorama-import.invalid`;

  const complianceData = {
    importedFrom: "excel-bulk-import",
    importedAt: new Date().toISOString(),
    customerNumber: row.customerNumber,
    hadOriginalEmail: row.email !== null,
  };

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO ${schema}.app_users
        (id, email, display_name, surname, password_hash, wallet_id,
         role, phone, birth_date, hall_id, kyc_status, compliance_data,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PLAYER', $7, $8::date, $9,
               'PENDING', $10::jsonb, now(), now())`,
      [
        userId,
        email,
        row.displayName,
        row.surname,
        passwordHash,
        walletId,
        row.phone,
        row.birthDate,
        row.hallId,
        JSON.stringify(complianceData),
      ]
    );
    // Wallet — minimal initial balance row. The platform's wallet adapter
    // handles this in normal register-flow via ensureAccount; we replicate
    // the schema directly here to avoid loading the full app DI graph.
    await client.query(
      `INSERT INTO ${schema}.wallet_accounts (id, balance, currency, created_at, updated_at)
       VALUES ($1, 0, 'NOK', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [walletId]
    );
    await client.query("COMMIT");
    return "inserted";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const inputPath = resolve(args.input);
  console.log(`[import] Reading Excel: ${inputPath}`);

  const buffer = readFileSync(inputPath);
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = args.sheet ?? workbook.SheetNames[0];
  if (!sheetName || !workbook.Sheets[sheetName]) {
    console.error(`[import] Sheet not found: ${sheetName ?? "<first>"}`);
    console.error(`[import] Available sheets: ${workbook.SheetNames.join(", ")}`);
    process.exit(1);
  }
  const sheet = workbook.Sheets[sheetName];
  const rawRows: RawRow[] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
    defval: null,
  }) as RawRow[];
  console.log(`[import] Loaded ${rawRows.length} rows from sheet '${sheetName}'`);

  const connectionString = process.env.APP_PG_CONNECTION_STRING;
  if (!connectionString) {
    console.error("[import] APP_PG_CONNECTION_STRING env var required");
    process.exit(1);
  }
  const schema = process.env.APP_PG_SCHEMA?.trim() || "public";

  const client = new pg.Client({ connectionString });
  await client.connect();

  let parserCtx: ParserContext;
  try {
    const hallMap = await loadHallNumberMap(client, schema);
    console.log(`[import] Loaded ${hallMap.size} halls with hall_number set`);

    let mainHallId: string | null;
    if (args.strictHall) {
      mainHallId = null;
      console.log(
        "[import] --strict-hall: rows with blank/0 hall_number will be REJECTED"
      );
    } else if (args.defaultHallId) {
      mainHallId = args.defaultHallId;
      console.log(`[import] Using --default-hall-id: ${mainHallId}`);
    } else {
      mainHallId = await resolveDefaultHall(client, schema);
      if (mainHallId) {
        console.log(`[import] Auto-resolved fallback hall: ${mainHallId}`);
      } else {
        console.warn(
          "[import] No fallback hall found — blank/0 hall_number will REJECT."
        );
      }
    }
    parserCtx = { hallNumberToId: hallMap, mainHallId };

    // Parse + validate.
    const result = parseSheet(rawRows, parserCtx);
    console.log(
      `[import] Parsed: ${result.rows.length} valid, ${result.errors.length} errors (${result.totalRowsRead} data rows)`
    );

    // DB-level dup check + insert.
    const stats: ImportStats = {
      attempted: result.rows.length,
      inserted: 0,
      skippedDuplicate: 0,
      failedAtDb: 0,
    };
    const dbErrors: DbReason[] = [];

    if (args.dryRun) {
      console.log("[import] DRY RUN — skipping DB writes");
    } else {
      for (const row of result.rows) {
        try {
          const outcome = await importRow(client, schema, row);
          if (outcome === "inserted") {
            stats.inserted++;
            if (stats.inserted % 100 === 0) {
              console.log(`[import] ...inserted ${stats.inserted}`);
            }
          } else {
            stats.skippedDuplicate++;
          }
        } catch (err) {
          stats.failedAtDb++;
          dbErrors.push({
            rowNumber: row.rowNumber,
            reason: `DB_INSERT_FAILED: ${(err as Error).message}`,
            email: row.email,
            phone: row.phone,
          });
        }
      }
    }

    // Reports.
    mkdirSync(args.reportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const importedCsvPath = join(
      args.reportDir,
      `import-imported-${stamp}.csv`
    );
    const errorsCsvPath = join(
      args.reportDir,
      `import-errors-${stamp}.csv`
    );

    writeFileSync(importedCsvPath, serializeImportedCsv(result.rows), "utf8");

    const allErrors: RowError[] = [
      ...result.errors,
      ...dbErrors.map((e) => ({
        rowNumber: e.rowNumber,
        reason: e.reason,
        rawValues: { email: e.email, phone: e.phone },
      })),
    ];
    writeFileSync(errorsCsvPath, serializeErrorsCsv(allErrors), "utf8");

    console.log(`\n[import] Reports written:`);
    console.log(`  - ${importedCsvPath}`);
    console.log(`  - ${errorsCsvPath}`);

    // Summary.
    console.log(`\n[import] === SUMMARY ===`);
    console.log(`  Total rows read:      ${result.totalRowsRead}`);
    console.log(`  Parser errors:        ${result.errors.length}`);
    console.log(`  Valid for DB:         ${stats.attempted}`);
    console.log(`  Inserted:             ${stats.inserted}`);
    console.log(`  Skipped (duplicate):  ${stats.skippedDuplicate}`);
    console.log(`  DB-level failures:    ${stats.failedAtDb}`);
    if (args.dryRun) {
      console.log("\n[import] This was a DRY RUN. Re-run without --dry-run to apply.");
    } else {
      console.log("\n[import] Done.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[import] FATAL:", err);
  process.exit(1);
});
