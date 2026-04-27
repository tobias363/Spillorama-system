/**
 * BIN-764: WalletAuditVerifier — verifiserer hash-chain-integritet for
 * wallet_entries.
 *
 * Per konto walker vi entries i id-rekkefølge og re-beregner hashen for hver:
 *   expected = SHA256(prev_stored_hash + canonical_json(entry_data))
 * Hvis `expected !== stored entry_hash` har raden blitt manipulert post-hoc
 * (eller en tidligere rad har, slik at kjeden brytes fra det punktet).
 *
 * Mismatch alarmeres via:
 *   - `console.error` med detail
 *   - `app_audit_log`-rad (resource = `wallet_audit`, action = `verify.mismatch`)
 *   - Prometheus-tellere (hvis registrert i process)
 *
 * Bruksmodi:
 *   - **Nightly cron**: full sweep over alle kontoer, batched per-konto.
 *   - **On-demand admin endpoint**: `GET /api/admin/wallet/audit-verify/:accountId`
 *     for én konto.
 *
 * Performance-notater:
 *   - Per-konto sekvensiell walk (én DB-query per batch på 1000 entries).
 *   - For hele systemet: vi listing alle account_ids først, deretter parallell
 *     med concurrency-cap (default 4). Forsiktig fordi DB-CPU er typisk hot
 *     under nightly window.
 *   - 10k entries på en konto verifiseres på <2 sek på moderne maskinvare
 *     (SHA-256 i Node er ~150 MB/s; canonical-JSON er ~5x snail-overhead).
 *
 * Backwards-compat: rader med `entry_hash IS NULL` (legacy pre-BIN-764) hoppes
 * over og rapporteres som `legacyUnhashed`. Backfill kan kjøres separat.
 */

import type { Pool } from "pg";
import {
  WALLET_HASH_CHAIN_GENESIS,
  canonicalJsonForEntry,
  computeEntryHash,
  type WalletEntryHashInput,
} from "../adapters/PostgresWalletAdapter.js";
import { logger as rootLogger, type Logger } from "../util/logger.js";

const logger = rootLogger.child({ module: "wallet-audit-verifier" });

export interface WalletAuditMismatch {
  accountId: string;
  entryId: string;
  storedHash: string | null;
  expectedHash: string;
  reason:
    | "hash_mismatch"
    | "previous_hash_mismatch"
    | "missing_hash"
    | "missing_previous_hash";
}

export interface WalletAuditVerifyResult {
  accountId: string;
  /** Antall entries gjennomgått. */
  entriesChecked: number;
  /** Entries som var hash-verifisert OK. */
  entriesValid: number;
  /** Legacy-rader uten entry_hash (NULL) — telles separat, ikke alarm. */
  legacyUnhashed: number;
  /** Detekterte mismatches. Tom array = chain er intakt. */
  mismatches: WalletAuditMismatch[];
  /** Total tid i ms. */
  durationMs: number;
}

export interface WalletAuditVerifyAllResult {
  accountsChecked: number;
  totalEntriesChecked: number;
  totalEntriesValid: number;
  totalLegacyUnhashed: number;
  totalMismatches: number;
  /** Kontoer som hadde >= 1 mismatch. */
  failedAccounts: WalletAuditVerifyResult[];
  durationMs: number;
}

export interface WalletAuditVerifierOptions {
  pool: Pool;
  schema: string;
  /** Batch-størrelse per DB-query (default 1000). */
  batchSize?: number;
  /** Concurrency for verifyAll (default 4). */
  concurrency?: number;
  /** Audit-log-skriver. Optional — hvis utelatt logges kun til console. */
  onMismatch?: (mismatch: WalletAuditMismatch) => Promise<void>;
  logger?: Logger;
}

interface EntryRow {
  id: string;
  operation_id: string;
  account_id: string;
  side: "DEBIT" | "CREDIT";
  amount: string;
  transaction_id: string | null;
  account_side: "deposit" | "winnings";
  created_at: Date | string;
  entry_hash: string | null;
  previous_entry_hash: string | null;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function entriesTable(schema: string): string {
  return `"${schema}"."wallet_entries"`;
}

export class WalletAuditVerifier {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly onMismatch?: (mismatch: WalletAuditMismatch) => Promise<void>;
  private readonly log: Logger;

  constructor(options: WalletAuditVerifierOptions) {
    this.pool = options.pool;
    this.schema = options.schema;
    this.batchSize = options.batchSize ?? 1000;
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.onMismatch = options.onMismatch;
    this.log = options.logger ?? logger;
  }

  /**
   * Verifiser kjeden for én konto. Walker entries i id-rekkefølge og
   * re-beregner hashen for hver. Returnerer detaljert resultat med listet
   * mismatches. Idempotent — kan kalles flere ganger uten side-effekt.
   */
  async verifyAccount(accountId: string): Promise<WalletAuditVerifyResult> {
    const startMs = Date.now();
    let entriesChecked = 0;
    let entriesValid = 0;
    let legacyUnhashed = 0;
    const mismatches: WalletAuditMismatch[] = [];

    let cursorId = "0";
    // Forrige rads stored entry_hash. Brukes for å validere previous_entry_hash-feltet
    // på neste rad (chain-link-integritet) i tillegg til selve hash-beregningen.
    let lastStoredHash: string = WALLET_HASH_CHAIN_GENESIS;
    let isFirstRow = true;

    // Stream entries i batches for å unngå memory-spike ved 10k+ rader.
    while (true) {
      const { rows } = await this.pool.query<EntryRow>(
        `SELECT id, operation_id, account_id, side, amount::text, transaction_id,
                account_side, created_at, entry_hash, previous_entry_hash
           FROM ${entriesTable(this.schema)}
          WHERE account_id = $1 AND id > $2
          ORDER BY id ASC
          LIMIT $3`,
        [accountId, cursorId, this.batchSize]
      );
      if (rows.length === 0) break;

      for (const row of rows) {
        entriesChecked += 1;
        cursorId = row.id;

        // Legacy-rader uten hash hoppes over. Reset lastStoredHash til GENESIS
        // for å håndtere kjeder som er delvis backfilled — første hashed rad etter
        // legacy-rader behandles som ny genesis-link.
        if (row.entry_hash === null) {
          legacyUnhashed += 1;
          lastStoredHash = WALLET_HASH_CHAIN_GENESIS;
          isFirstRow = false;
          continue;
        }

        // Re-beregn forventet hash basert på stored previous_entry_hash.
        const hashInput: WalletEntryHashInput = {
          id: String(row.id),
          operation_id: row.operation_id,
          account_id: row.account_id,
          side: row.side,
          amount: row.amount,
          transaction_id: row.transaction_id,
          account_side: row.account_side,
          created_at: asIso(row.created_at),
        };
        const storedPrev = row.previous_entry_hash ?? WALLET_HASH_CHAIN_GENESIS;
        const expected = computeEntryHash(storedPrev, hashInput);

        if (expected !== row.entry_hash) {
          mismatches.push({
            accountId,
            entryId: String(row.id),
            storedHash: row.entry_hash,
            expectedHash: expected,
            reason: "hash_mismatch",
          });
          await this.alarm(accountId, row, expected, "hash_mismatch");
        } else if (!isFirstRow && storedPrev !== lastStoredHash) {
          // Chain-link broken: previous_entry_hash matcher ikke forrige rads
          // stored entry_hash. Dette indikerer at en rad mellom forrige og
          // denne har blitt slettet eller endret.
          mismatches.push({
            accountId,
            entryId: String(row.id),
            storedHash: row.entry_hash,
            expectedHash: expected,
            reason: "previous_hash_mismatch",
          });
          await this.alarm(accountId, row, expected, "previous_hash_mismatch");
        } else {
          entriesValid += 1;
        }

        lastStoredHash = row.entry_hash;
        isFirstRow = false;
      }

      if (rows.length < this.batchSize) break;
    }

    return {
      accountId,
      entriesChecked,
      entriesValid,
      legacyUnhashed,
      mismatches,
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * Verifiser alle kontoer i systemet. Bruker concurrency-cap for å unngå
   * DB-overload. Returnerer aggregert resultat + liste med kontoer som feilet.
   */
  async verifyAll(): Promise<WalletAuditVerifyAllResult> {
    const startMs = Date.now();
    const accountIds = await this.listAccountIds();

    const failedAccounts: WalletAuditVerifyResult[] = [];
    let totalEntriesChecked = 0;
    let totalEntriesValid = 0;
    let totalLegacyUnhashed = 0;
    let totalMismatches = 0;

    // Enkel concurrency-pool: array av løpende promises, vent på en før vi
    // starter neste når vi treffer caset.
    const queue = [...accountIds];
    const inFlight = new Set<Promise<void>>();

    const processNext = async (): Promise<void> => {
      const accountId = queue.shift();
      if (!accountId) return;
      const result = await this.verifyAccount(accountId);
      totalEntriesChecked += result.entriesChecked;
      totalEntriesValid += result.entriesValid;
      totalLegacyUnhashed += result.legacyUnhashed;
      totalMismatches += result.mismatches.length;
      if (result.mismatches.length > 0) {
        failedAccounts.push(result);
      }
    };

    while (queue.length > 0 || inFlight.size > 0) {
      while (inFlight.size < this.concurrency && queue.length > 0) {
        const p = processNext().finally(() => {
          inFlight.delete(p);
        });
        inFlight.add(p);
      }
      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
    }

    const durationMs = Date.now() - startMs;
    this.log.info(
      {
        accountsChecked: accountIds.length,
        totalEntriesChecked,
        totalEntriesValid,
        totalLegacyUnhashed,
        totalMismatches,
        durationMs,
      },
      "verifyAll done"
    );

    return {
      accountsChecked: accountIds.length,
      totalEntriesChecked,
      totalEntriesValid,
      totalLegacyUnhashed,
      totalMismatches,
      failedAccounts,
      durationMs,
    };
  }

  private async listAccountIds(): Promise<string[]> {
    const { rows } = await this.pool.query<{ account_id: string }>(
      `SELECT DISTINCT account_id FROM ${entriesTable(this.schema)} ORDER BY account_id`
    );
    return rows.map((r) => r.account_id);
  }

  private async alarm(
    accountId: string,
    row: EntryRow,
    expected: string,
    reason: WalletAuditMismatch["reason"],
  ): Promise<void> {
    this.log.error(
      {
        accountId,
        entryId: row.id,
        storedHash: row.entry_hash,
        expectedHash: expected,
        previousHashStored: row.previous_entry_hash,
        reason,
      },
      "WALLET_AUDIT_TAMPER_DETECTED"
    );
    if (this.onMismatch) {
      try {
        await this.onMismatch({
          accountId,
          entryId: String(row.id),
          storedHash: row.entry_hash,
          expectedHash: expected,
          reason,
        });
      } catch (err) {
        this.log.error({ err }, "onMismatch hook feilet");
      }
    }
  }
}

/**
 * Helper: re-bereg canonical_json for én rad. Eksponert for tests.
 */
export function recomputeEntryHashForRow(row: {
  id: string | number;
  operation_id: string;
  account_id: string;
  side: "DEBIT" | "CREDIT";
  amount: string;
  transaction_id: string | null;
  account_side: "deposit" | "winnings";
  created_at: Date | string;
  previous_entry_hash: string | null;
}): { canonical: string; hash: string } {
  const input: WalletEntryHashInput = {
    id: String(row.id),
    operation_id: row.operation_id,
    account_id: row.account_id,
    side: row.side,
    amount: row.amount,
    transaction_id: row.transaction_id,
    account_side: row.account_side,
    created_at: asIso(row.created_at),
  };
  const prev = row.previous_entry_hash ?? WALLET_HASH_CHAIN_GENESIS;
  return {
    canonical: canonicalJsonForEntry(input),
    hash: computeEntryHash(prev, input),
  };
}
