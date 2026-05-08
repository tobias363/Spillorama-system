/**
 * BIN-764: One-shot CLI for å verifisere wallet hash-chain mot live database.
 *
 * Read-only — denne scriptet skriver ALDRI til DB. Den walker
 * `wallet_entries` per konto og re-beregner SHA-256-kjeden mot stored
 * `entry_hash`. Mismatches dumpes til stdout (exit-code 1) så ops kan koble
 * scriptet til en cron-jobb / GitHub Action / pre-deploy-gate.
 *
 * Bruk:
 *   APP_PG_CONNECTION_STRING=postgres://user:pw@host/db tsx scripts/verify-wallet-audit-chain.ts
 *
 * Valgfri env-vars:
 *   APP_PG_SCHEMA       — default 'public'
 *   AUDIT_VERIFY_BATCH  — batch-størrelse per query (default 1000)
 *   AUDIT_VERIFY_CONCURRENCY — antall parallelle kontoer (default 4)
 *   AUDIT_VERIFY_ACCOUNT_ID  — verifiser kun én konto (debug-modus)
 *
 * Exit-codes:
 *   0  — kjede intakt for alle kontoer
 *   1  — minst én mismatch detektert (TAMPER!)
 *   2  — runtime-feil (DB ikke tilgjengelig, schema mangler, etc.)
 *
 * Sikkerhet:
 *   * Read-only — bruker SELECT-statements i WalletAuditVerifier
 *   * Ingen audit-events skrives — kun stdout-rapport
 *   * Kan kjøres mot prod uten risiko (men trenger lese-tilgang)
 */

import { Pool } from "pg";
import { WalletAuditVerifier } from "../src/wallet/WalletAuditVerifier.js";

interface CliConfig {
  connectionString: string;
  schema: string;
  batchSize: number;
  concurrency: number;
  accountIdFilter: string | null;
}

function readConfig(): CliConfig {
  const connectionString =
    process.env.APP_PG_CONNECTION_STRING ?? process.env.WALLET_PG_CONNECTION_STRING ?? "";
  if (!connectionString) {
    console.error(
      "FEIL: APP_PG_CONNECTION_STRING (eller WALLET_PG_CONNECTION_STRING) må settes."
    );
    process.exit(2);
  }
  return {
    connectionString,
    schema: (process.env.APP_PG_SCHEMA ?? "public").replace(/[^a-zA-Z0-9_]/g, ""),
    batchSize: Number.parseInt(process.env.AUDIT_VERIFY_BATCH ?? "1000", 10) || 1000,
    concurrency: Number.parseInt(process.env.AUDIT_VERIFY_CONCURRENCY ?? "4", 10) || 4,
    accountIdFilter: process.env.AUDIT_VERIFY_ACCOUNT_ID?.trim() || null,
  };
}

function fmt(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

async function run(): Promise<void> {
  const cfg = readConfig();
  const pool = new Pool({ connectionString: cfg.connectionString });

  // Probe schema-tilstedeværelse før vi starter walk-en. Hvis migrasjonen
  // 20260902000000_wallet_entries_hash_chain.sql ikke er kjørt, gir vi en
  // tydelig feilmelding i stedet for kryptisk pg-error nedstrøms.
  try {
    const probe = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'wallet_entries'
          AND column_name IN ('entry_hash','previous_entry_hash')`,
      [cfg.schema]
    );
    if (probe.rows.length < 2) {
      console.error(
        `FEIL: ${cfg.schema}.wallet_entries mangler entry_hash/previous_entry_hash. ` +
          "Kjør migrasjon 20260902000000_wallet_entries_hash_chain.sql først."
      );
      await pool.end();
      process.exit(2);
    }
  } catch (err) {
    console.error("FEIL: kunne ikke kontakte database — ", err);
    await pool.end();
    process.exit(2);
  }

  const verifier = new WalletAuditVerifier({
    pool,
    schema: cfg.schema,
    batchSize: cfg.batchSize,
    concurrency: cfg.concurrency,
  });

  console.log("=== BIN-764: Wallet hash-chain verifikasjon ===");
  console.log(`Database schema  : ${cfg.schema}`);
  console.log(`Batch-størrelse  : ${cfg.batchSize}`);
  console.log(`Concurrency      : ${cfg.concurrency}`);
  if (cfg.accountIdFilter) {
    console.log(`Account-filter   : ${cfg.accountIdFilter}`);
  }
  console.log("");

  try {
    if (cfg.accountIdFilter) {
      const result = await verifier.verifyAccount(cfg.accountIdFilter);
      console.log(JSON.stringify(result, null, 2));
      const ok = result.mismatches.length === 0;
      console.log("");
      console.log(ok ? "RESULTAT: kjede intakt." : "RESULTAT: MISMATCH DETEKTERT — TAMPER!");
      await pool.end();
      process.exit(ok ? 0 : 1);
    }

    const summary = await verifier.verifyAll();
    console.log(`Kontoer sjekket          : ${summary.accountsChecked}`);
    console.log(`Entries sjekket          : ${summary.totalEntriesChecked}`);
    console.log(`Entries valide           : ${summary.totalEntriesValid}`);
    console.log(`Legacy uten hash (NULL)  : ${summary.totalLegacyUnhashed}`);
    console.log(`Mismatches detektert     : ${summary.totalMismatches}`);
    console.log(`Tid                      : ${fmt(summary.durationMs)}`);
    console.log("");

    if (summary.totalMismatches > 0) {
      console.error("MISMATCH PER KONTO:");
      for (const acc of summary.failedAccounts) {
        console.error(`  ${acc.accountId}: ${acc.mismatches.length} mismatch(es)`);
        for (const m of acc.mismatches.slice(0, 5)) {
          console.error(
            `    entry=${m.entryId} reason=${m.reason} stored=${m.storedHash?.slice(0, 16) ?? "NULL"} expected=${m.expectedHash.slice(0, 16)}`
          );
        }
        if (acc.mismatches.length > 5) {
          console.error(`    ... +${acc.mismatches.length - 5} flere`);
        }
      }
      console.log("");
      console.log("RESULTAT: HASH-CHAIN BRUTT — TAMPER DETECTED");
      await pool.end();
      process.exit(1);
    }

    console.log("RESULTAT: hash-chain intakt for alle kontoer.");
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error("FEIL under verifisering:", err);
    await pool.end();
    process.exit(2);
  }
}

run().catch(async (err) => {
  console.error("Uventet feil:", err);
  process.exit(2);
});
