#!/usr/bin/env -S tsx
/**
 * G9 — Wallet vs Compliance Ledger reconciliation CLI.
 *
 * Read-only sammenligning av wallet_transactions (kilde for spiller-saldo)
 * mot app_rg_compliance_ledger (kilde for §71-rapport til Lotteritilsynet).
 *
 * ## Hvorfor dette eksisterer
 *
 * Wallet og compliance-ledger er to uavhengige skriveveier. For at vi
 * skal kunne stå inne for at "alt som ble debit-et fra wallet ble
 * korrekt rapportert til Lotteritilsynet", trenger vi en daglig
 * sammenligning. Dette scriptet er den sammenligningen.
 *
 * Komplementerer `verify-wallet-audit-chain.ts` (BIN-764, hash-chain):
 *   - Hash-chain verifiserer at wallet IKKE er tampered.
 *   - Reconciliation verifiserer at wallet ↔ §71-rapport stemmer.
 *
 * ## Bruk
 *
 *   APP_PG_CONNECTION_STRING="postgres://..." \
 *     npm --prefix apps/backend run reconcile:wallet-ledger -- \
 *     --from 2026-08-01 --to 2026-08-31
 *
 * ## CLI-flagg
 *
 *   --from <YYYY-MM-DD>     start-dato (Europe/Oslo, inklusiv)
 *   --to   <YYYY-MM-DD>     end-dato (Europe/Oslo, inklusiv) [default: i dag]
 *   --hall <hallId>         filtrer ledger-side til én hall [default: alle]
 *   --format <markdown|json|csv>  output-format [default: markdown]
 *   --db-url <conn>         DB connection string [default: env]
 *   --output <file>         skriv til fil i stedet for stdout
 *
 * ## Exit-codes
 *
 *   0 — alt stemmer (isReconciled=true)
 *   1 — divergens detektert
 *   2 — runtime-feil (DB ikke tilgjengelig, etc.)
 *
 * ## Sikkerhet
 *
 *   * READ-ONLY — bruker SELECT-statements, aldri INSERT/UPDATE/DELETE.
 *   * Idempotent — kan kjøres flere ganger med samme input uten side-effekt.
 *   * Anbefalt: bruk read-only DB-bruker mot prod.
 */

import { Pool } from "pg";
import { writeFileSync } from "node:fs";
import {
  classifyWalletTransaction,
  classifyLedgerEvent,
  isoToOsloDate,
  osloDateToUtcStartIso,
  osloDateToUtcEndIso,
  reconcile,
  formatMarkdown,
  formatJson,
  formatCsv,
  type WalletReconcileEvent,
  type LedgerReconcileEvent,
  type ReconciliationResult,
} from "./lib/walletLedgerReconciliation.js";

// ── CLI parsing ─────────────────────────────────────────────────────────────

interface CliConfig {
  fromDate: string;
  toDate: string;
  hallFilter: string | null;
  format: "markdown" | "json" | "csv";
  dbUrl: string;
  schema: string;
  outputFile: string | null;
}

function parseCliArgs(argv: ReadonlyArray<string>): CliConfig {
  const args = [...argv.slice(2)];
  let fromDate: string | null = null;
  let toDate: string | null = null;
  let hallFilter: string | null = null;
  let format: "markdown" | "json" | "csv" = "markdown";
  let dbUrl: string | null = null;
  let outputFile: string | null = null;

  while (args.length > 0) {
    const flag = args.shift()!;
    switch (flag) {
      case "--from":
        fromDate = requireValue(flag, args.shift());
        break;
      case "--to":
        toDate = requireValue(flag, args.shift());
        break;
      case "--hall":
        hallFilter = requireValue(flag, args.shift());
        break;
      case "--format":
        format = requireFormat(args.shift());
        break;
      case "--db-url":
        dbUrl = requireValue(flag, args.shift());
        break;
      case "--output":
        outputFile = requireValue(flag, args.shift());
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      // eslint-disable-next-line no-fallthrough
      default:
        console.error(`FEIL: ukjent flagg: ${flag}`);
        printUsage();
        process.exit(2);
    }
  }

  if (!fromDate) {
    console.error("FEIL: --from <YYYY-MM-DD> er påkrevd.");
    printUsage();
    process.exit(2);
  }
  if (!toDate) {
    // Default: i dag i Oslo-tid.
    toDate = isoToOsloDate(new Date().toISOString());
  }
  if (!isValidDate(fromDate)) {
    console.error(`FEIL: --from har ugyldig format: ${fromDate} (forventet YYYY-MM-DD)`);
    process.exit(2);
  }
  if (!isValidDate(toDate)) {
    console.error(`FEIL: --to har ugyldig format: ${toDate} (forventet YYYY-MM-DD)`);
    process.exit(2);
  }
  if (fromDate > toDate) {
    console.error(`FEIL: --from (${fromDate}) er etter --to (${toDate}).`);
    process.exit(2);
  }

  // Connection string priority: --db-url > env.
  const resolvedDbUrl =
    dbUrl ??
    process.env.APP_PG_CONNECTION_STRING ??
    process.env.WALLET_PG_CONNECTION_STRING ??
    process.env.WALLET_PG_TEST_CONNECTION_STRING ??
    "";
  if (!resolvedDbUrl) {
    console.error(
      "FEIL: ingen DB connection string. Bruk --db-url eller sett APP_PG_CONNECTION_STRING.",
    );
    process.exit(2);
  }

  const schema = (process.env.APP_PG_SCHEMA ?? "public").replace(/[^a-zA-Z0-9_]/g, "");

  return {
    fromDate,
    toDate,
    hallFilter,
    format,
    dbUrl: resolvedDbUrl,
    schema,
    outputFile,
  };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    console.error(`FEIL: ${flag} mangler verdi.`);
    process.exit(2);
  }
  return value;
}

function requireFormat(value: string | undefined): "markdown" | "json" | "csv" {
  if (value === "markdown" || value === "json" || value === "csv") {
    return value;
  }
  console.error(`FEIL: --format må være markdown, json eller csv (fikk: ${value}).`);
  process.exit(2);
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00.000Z");
  return !Number.isNaN(d.getTime());
}

function printUsage(): void {
  console.error(`
G9 — Wallet vs Compliance Ledger reconciliation

Bruk:
  reconcile-wallet-vs-ledger --from <date> [--to <date>] [--hall <id>]
                             [--format markdown|json|csv] [--db-url <conn>]
                             [--output <file>]

Eksempler:
  reconcile-wallet-vs-ledger --from 2026-08-01
  reconcile-wallet-vs-ledger --from 2026-08-01 --to 2026-08-31 --format json
  reconcile-wallet-vs-ledger --from 2026-08-01 --hall demo-hall-001 --output report.md

Exit-codes:
  0  alt stemmer
  1  divergens detektert
  2  runtime-feil
`);
}

// ── DB queries ──────────────────────────────────────────────────────────────

interface RawWalletRow {
  id: string;
  account_id: string;
  transaction_type: string;
  amount: string;
  reason: string;
  idempotency_key: string | null;
  created_at: Date | string;
  is_system: boolean;
}

interface RawLedgerRow {
  id: string;
  wallet_id: string | null;
  hall_id: string;
  game_type: string;
  event_type: string;
  amount: string;
  created_at: Date | string;
}

/**
 * Hent wallet_transactions i datointervallet, joinet mot wallet_accounts
 * for å filtrere bort system-konti.
 *
 * Vi henter ALL transaksjoner i intervallet og lar pure-logic-laget
 * klassifisere dem (STAKE/PRIZE/null) — det gir oss separat unit-test-
 * dekning for klassifisering.
 */
async function fetchWalletEvents(
  pool: Pool,
  schema: string,
  fromDate: string,
  toDate: string,
): Promise<WalletReconcileEvent[]> {
  const startIso = osloDateToUtcStartIso(fromDate);
  const endIso = osloDateToUtcEndIso(toDate);

  const { rows } = await pool.query<RawWalletRow>(
    `SELECT t.id, t.account_id, t.transaction_type, t.amount::text AS amount,
            t.reason, t.idempotency_key, t.created_at, a.is_system
       FROM "${schema}"."wallet_transactions" t
       JOIN "${schema}"."wallet_accounts" a ON a.id = t.account_id
      WHERE t.created_at >= $1 AND t.created_at < $2
        AND a.is_system = false
      ORDER BY t.created_at ASC`,
    [startIso, endIso],
  );

  const out: WalletReconcileEvent[] = [];
  for (const row of rows) {
    const side = classifyWalletTransaction(
      row.transaction_type,
      row.reason ?? "",
      row.idempotency_key,
    );
    if (!side) continue;
    const createdIso = asIso(row.created_at);
    out.push({
      transactionId: row.id,
      accountId: row.account_id,
      businessDate: isoToOsloDate(createdIso),
      amountNok: Number(row.amount),
      side,
      transactionType: row.transaction_type,
      reason: row.reason ?? "",
      createdAt: createdIso,
    });
  }
  return out;
}

/**
 * Hent compliance-ledger-events i datointervallet. Filtrerer bort events
 * uten wallet_id (systemic events som ikke kan matches mot spiller-konti).
 */
async function fetchLedgerEvents(
  pool: Pool,
  schema: string,
  fromDate: string,
  toDate: string,
  hallFilter: string | null,
): Promise<LedgerReconcileEvent[]> {
  const startIso = osloDateToUtcStartIso(fromDate);
  const endIso = osloDateToUtcEndIso(toDate);

  const params: Array<string | number> = [startIso, endIso];
  let where = "created_at >= $1 AND created_at < $2 AND wallet_id IS NOT NULL";
  if (hallFilter) {
    params.push(hallFilter);
    where += ` AND hall_id = $${params.length}`;
  }

  const { rows } = await pool.query<RawLedgerRow>(
    `SELECT id, wallet_id, hall_id, game_type, event_type, amount::text AS amount, created_at
       FROM "${schema}"."app_rg_compliance_ledger"
      WHERE ${where}
      ORDER BY created_at ASC`,
    params,
  );

  const out: LedgerReconcileEvent[] = [];
  for (const row of rows) {
    const side = classifyLedgerEvent(row.event_type);
    if (!side) continue;
    if (!row.wallet_id) continue;
    const createdIso = asIso(row.created_at);
    out.push({
      id: row.id,
      walletId: row.wallet_id,
      businessDate: isoToOsloDate(createdIso),
      hallId: row.hall_id,
      gameType: row.game_type,
      amountNok: Number(row.amount),
      side,
      eventType: row.event_type,
      createdAt: createdIso,
    });
  }
  return out;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ── Schema-probe ────────────────────────────────────────────────────────────

/**
 * Probe for required tables before running the reconciliation. Gives a
 * clear error message if migrations haven't been run.
 */
async function probeSchema(pool: Pool, schema: string): Promise<void> {
  const required = [
    "wallet_transactions",
    "wallet_accounts",
    "app_rg_compliance_ledger",
  ];
  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = ANY($2::text[])`,
    [schema, required],
  );
  const found = new Set(rows.map((r) => r.table_name));
  const missing = required.filter((t) => !found.has(t));
  if (missing.length > 0) {
    throw new Error(
      `Schema "${schema}" mangler kreverte tabeller: ${missing.join(", ")}. Kjør migrations først.`,
    );
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function run(): Promise<number> {
  const cfg = parseCliArgs(process.argv);

  // Logg kun til stderr så stdout reserveres for output (gjør det piping-vennlig).
  console.error("=== G9: Wallet vs Compliance Ledger reconciliation ===");
  console.error(`Period           : ${cfg.fromDate} → ${cfg.toDate} (Europe/Oslo)`);
  console.error(`Hall filter      : ${cfg.hallFilter ?? "(alle)"}`);
  console.error(`Format           : ${cfg.format}`);
  console.error(`Schema           : ${cfg.schema}`);
  console.error(`Output           : ${cfg.outputFile ?? "stdout"}`);
  console.error("");

  const pool = new Pool({ connectionString: cfg.dbUrl });
  let result: ReconciliationResult;
  try {
    await probeSchema(pool, cfg.schema);

    console.error("Henter wallet-transaksjoner...");
    const walletEvents = await fetchWalletEvents(pool, cfg.schema, cfg.fromDate, cfg.toDate);
    console.error(`  → ${walletEvents.length} relevante events`);

    console.error("Henter compliance-ledger-events...");
    const ledgerEvents = await fetchLedgerEvents(
      pool,
      cfg.schema,
      cfg.fromDate,
      cfg.toDate,
      cfg.hallFilter,
    );
    console.error(`  → ${ledgerEvents.length} relevante events`);
    console.error("");

    console.error("Reconcile...");
    result = reconcile({
      fromDate: cfg.fromDate,
      toDate: cfg.toDate,
      hallFilter: cfg.hallFilter,
      walletEvents,
      ledgerEvents,
    });
    console.error(
      `  → ${result.isReconciled ? "RECONCILED" : "DIVERGENS DETEKTERT"}: ${result.walletOnlyBuckets.length} walletOnly, ${result.ledgerOnlyBuckets.length} ledgerOnly, ${result.amountMismatches.length} amountMismatch, ${result.countMismatches.length} countMismatch`,
    );
    console.error("");
  } catch (err) {
    console.error("FEIL under reconciliation:", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    await pool.end();
    return 2;
  }

  // Render output
  const output =
    cfg.format === "json"
      ? formatJson(result)
      : cfg.format === "csv"
        ? formatCsv(result)
        : formatMarkdown(result);

  if (cfg.outputFile) {
    try {
      writeFileSync(cfg.outputFile, output, "utf8");
      console.error(`Skrev rapport til ${cfg.outputFile}`);
    } catch (err) {
      console.error("FEIL ved skriving til output-fil:", err instanceof Error ? err.message : err);
      await pool.end();
      return 2;
    }
  } else {
    process.stdout.write(output);
    if (!output.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }

  await pool.end();
  return result.isReconciled ? 0 : 1;
}

run()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error("Uventet feil:", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(2);
  });
