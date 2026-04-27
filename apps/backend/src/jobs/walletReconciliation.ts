/**
 * BIN-763: Nightly wallet reconciliation cron.
 *
 * Industri-standard fra Pragmatic Play / Evolution: én gang per natt
 * sammenligner vi `wallet_accounts.{deposit_balance, winnings_balance}`
 * mot `SUM(wallet_entries.amount)` per konto + side, beregnet via
 * double-entry-modellen (CREDIT minus DEBIT). Avvik > 0.01 NOK alarmerer:
 *   - Skriver rad i `wallet_reconciliation_alerts` (med audit-felt).
 *   - Emit prometheus metric `wallet_reconciliation_divergence_total`.
 *   - Logger ERROR med strukturert payload.
 *
 * Vi skriver ALDRI tilbake til wallet_accounts ved divergens. ADMIN må
 * undersøke og lukke alerts manuelt via
 * `POST /api/admin/wallet/reconciliation-alerts/:id/resolve`.
 *
 * Schedule:
 *   - Default 03:00 lokal tid (matcher industri-konvensjon: post-midnatt-
 *     burst, men før morgen-trafikk i Norge).
 *   - Polling-interval default 15 min — jobben gater på (HH:MM, date-key)
 *     for å sikre én run per dag.
 *
 * Performance / batching:
 *   - Spørringen er én SQL som joiner wallet_accounts mot et aggregat
 *     på wallet_entries, batched per windowed offset (default 1000
 *     konti per iterasjon, 50 ms pause mellom batches for å ikke
 *     blokkere annen DB-trafikk).
 *
 * Idempotens:
 *   - Open-alert per (account_id, account_side) er enforced via partial
 *     UNIQUE index i schema. Vi ON CONFLICT DO NOTHING — samme divergens
 *     to ganger gir én rad.
 *   - "Run-once-per-day"-guard via lastRunDateKey i tick-funksjonen.
 */

import type { Pool } from "pg";
import type { JobResult } from "./JobScheduler.js";
import { logger as rootLogger } from "../util/logger.js";
import { metrics } from "../util/metrics.js";

const log = rootLogger.child({ module: "wallet-reconciliation" });

/**
 * Avvik mindre enn dette tolkes som flytetalls-støy og ignoreres.
 * 0.01 NOK = 1 øre. Spillorama-systemet bruker 6 desimalers presisjon
 * på balance, men forretningsmessig er øre minste enhet.
 */
const DIVERGENCE_THRESHOLD = 0.01;

export interface WalletReconciliationDeps {
  pool: Pool;
  schema: string;
  /**
   * Antall kontoer hentet per iterasjon. Default 1000 — gir rimelig
   * minne-fotavtrykk for systemer med 100k+ kontoer.
   */
  batchSize?: number;
  /**
   * Pause i ms mellom batches for å ikke blokkere annen DB-trafikk.
   * Default 50 ms. Sett til 0 i tester.
   */
  batchPauseMs?: number;
}

export interface ReconciliationDivergence {
  accountId: string;
  accountSide: "deposit" | "winnings";
  expected: number;
  actual: number;
  divergence: number;
}

export interface ReconciliationResult {
  accountsScanned: number;
  divergencesFound: number;
  alertsCreated: number;
  durationMs: number;
}

export interface ReconciliationAlertRow {
  id: string;
  accountId: string;
  accountSide: "deposit" | "winnings";
  expectedBalance: number;
  actualBalance: number;
  divergence: number;
  detectedAt: string;
}

/**
 * Service for nightly wallet reconciliation. Eksponert som klasse for
 * å kunne wrappes i admin "run-now"-endpoint og enklere mocks i tester.
 */
export class WalletReconciliationService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly batchSize: number;
  private readonly batchPauseMs: number;

  constructor(deps: WalletReconciliationDeps) {
    this.pool = deps.pool;
    this.schema = deps.schema;
    this.batchSize = Math.max(1, deps.batchSize ?? 1000);
    this.batchPauseMs = Math.max(0, deps.batchPauseMs ?? 50);
  }

  /**
   * Kjør én full reconciliation-runde. Logger ERROR per divergens og
   * INFO med oppsummering på slutten. Caller (cron-tick) håndterer
   * "already-ran-today"-guard.
   */
  async reconcileAll(): Promise<ReconciliationResult> {
    const start = process.hrtime.bigint();
    let accountsScanned = 0;
    let divergencesFound = 0;
    let alertsCreated = 0;
    let offset = 0;

    while (true) {
      const batch = await this.fetchAccountSideBatch(offset, this.batchSize);
      if (batch.length === 0) break;

      for (const row of batch) {
        accountsScanned += 1;
        const diff = row.actual - row.expected;
        if (Math.abs(diff) <= DIVERGENCE_THRESHOLD) continue;

        divergencesFound += 1;
        const inserted = await this.persistAlert({
          accountId: row.accountId,
          accountSide: row.accountSide,
          expected: row.expected,
          actual: row.actual,
          divergence: diff,
        });
        if (inserted) alertsCreated += 1;

        metrics.walletReconciliationDivergence.inc({
          account_id: row.accountId,
          side: row.accountSide,
        });

        log.error(
          {
            accountId: row.accountId,
            accountSide: row.accountSide,
            expected: row.expected,
            actual: row.actual,
            divergence: diff,
            alertInserted: inserted,
          },
          "wallet-reconciliation: divergence detected",
        );
      }

      // Hver iterasjon henter `batchSize` konti, hver av dem ekspandert til
      // 2 rader (deposit + winnings). Hvis vi fikk færre rader enn 2 *
      // batchSize, har vi nådd siste vindu.
      if (batch.length < this.batchSize * 2) break;
      offset += this.batchSize;

      if (this.batchPauseMs > 0) {
        await new Promise((r) => setTimeout(r, this.batchPauseMs));
      }
    }

    metrics.walletReconciliationAccountsScanned.inc(accountsScanned);
    if (divergencesFound === 0) {
      metrics.walletReconciliationClean.inc();
    }

    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    metrics.walletReconciliationDuration.observe(durationMs);

    return {
      accountsScanned,
      divergencesFound,
      alertsCreated,
      durationMs,
    };
  }

  /**
   * Henter ett vindu av (konto, side)-tupler med beregnet expected/actual.
   *
   * Spørringen joiner wallet_accounts mot et aggregat over wallet_entries
   * per (account_id, account_side). Vi expander hver konto til 2 rader
   * (deposit + winnings) via UNION ALL slik at JSON-aggregatet holder
   * radstrukturen forutsigbar for batching.
   *
   * EXPLAIN-bevis (test): Index Scan via idx_wallet_entries_account_side
   * for sum-leddet, Seq Scan på wallet_accounts (ordered by id) for
   * windowing.
   */
  private async fetchAccountSideBatch(
    offset: number,
    limit: number,
  ): Promise<
    Array<{
      accountId: string;
      accountSide: "deposit" | "winnings";
      expected: number;
      actual: number;
    }>
  > {
    // Hent én chunk av kontoer (sortert deterministisk for stabil paginering),
    // og join inn ledger-summen per side. COALESCE(0) sikrer at konti
    // uten entries (f.eks. nylig opprettede med 0-balanse) ikke faller
    // ut av resultatet.
    const sql = `
      WITH chunk AS (
        SELECT id, deposit_balance, winnings_balance
        FROM "${this.schema}"."wallet_accounts"
        ORDER BY id
        OFFSET $1
        LIMIT $2
      ),
      sums AS (
        SELECT account_id, account_side,
               SUM(CASE WHEN side = 'CREDIT' THEN amount ELSE -amount END) AS net
        FROM "${this.schema}"."wallet_entries"
        WHERE account_id IN (SELECT id FROM chunk)
        GROUP BY account_id, account_side
      )
      SELECT chunk.id AS account_id,
             'deposit'::text AS account_side,
             COALESCE((SELECT net FROM sums WHERE sums.account_id = chunk.id AND sums.account_side = 'deposit'), 0) AS expected,
             chunk.deposit_balance AS actual
      FROM chunk
      UNION ALL
      SELECT chunk.id AS account_id,
             'winnings'::text AS account_side,
             COALESCE((SELECT net FROM sums WHERE sums.account_id = chunk.id AND sums.account_side = 'winnings'), 0) AS expected,
             chunk.winnings_balance AS actual
      FROM chunk
      ORDER BY account_id, account_side
    `;

    const { rows } = await this.pool.query<{
      account_id: string;
      account_side: "deposit" | "winnings";
      expected: string | number;
      actual: string | number;
    }>(sql, [offset, limit]);

    return rows.map((r) => ({
      accountId: r.account_id,
      accountSide: r.account_side,
      expected: Number(r.expected),
      actual: Number(r.actual),
    }));
  }

  /**
   * Forsøk å persistere en alert-rad. Returnerer true hvis ny rad ble
   * laget, false hvis det allerede finnes en åpen alert for samme
   * (account_id, account_side) — partial UNIQUE index garanterer det.
   */
  private async persistAlert(d: ReconciliationDivergence): Promise<boolean> {
    const sql = `
      INSERT INTO "${this.schema}"."wallet_reconciliation_alerts"
        (account_id, account_side, expected_balance, actual_balance, divergence)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (account_id, account_side) WHERE resolved_at IS NULL
      DO NOTHING
      RETURNING id
    `;
    const { rowCount } = await this.pool.query(sql, [
      d.accountId,
      d.accountSide,
      d.expected,
      d.actual,
      d.divergence,
    ]);
    return (rowCount ?? 0) > 0;
  }

  /**
   * List åpne alerts for admin-dashboardet. Sortert nyeste først.
   */
  async listOpenAlerts(limit = 100): Promise<ReconciliationAlertRow[]> {
    const cappedLimit = Math.max(1, Math.min(500, limit));
    const { rows } = await this.pool.query<{
      id: string | number;
      account_id: string;
      account_side: "deposit" | "winnings";
      expected_balance: string | number;
      actual_balance: string | number;
      divergence: string | number;
      detected_at: Date | string;
    }>(
      `SELECT id, account_id, account_side, expected_balance, actual_balance,
              divergence, detected_at
         FROM "${this.schema}"."wallet_reconciliation_alerts"
         WHERE resolved_at IS NULL
         ORDER BY detected_at DESC
         LIMIT $1`,
      [cappedLimit],
    );
    return rows.map((r) => ({
      id: String(r.id),
      accountId: r.account_id,
      accountSide: r.account_side,
      expectedBalance: Number(r.expected_balance),
      actualBalance: Number(r.actual_balance),
      divergence: Number(r.divergence),
      detectedAt:
        r.detected_at instanceof Date ? r.detected_at.toISOString() : String(r.detected_at),
    }));
  }

  /**
   * Marker en alert som resolved. Returnerer true hvis raden ble oppdatert,
   * false hvis ikke funnet eller allerede resolved.
   */
  async resolveAlert(
    id: string | number,
    resolvedBy: string,
    resolutionNote: string,
  ): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE "${this.schema}"."wallet_reconciliation_alerts"
          SET resolved_at = now(),
              resolved_by = $2,
              resolution_note = $3
        WHERE id = $1 AND resolved_at IS NULL`,
      [id, resolvedBy, resolutionNote],
    );
    return (rowCount ?? 0) > 0;
  }
}

// ── Cron-tick wrapper ────────────────────────────────────────────────────────

export interface WalletReconciliationTickDeps {
  service: WalletReconciliationService;
  /** Default 3 — kjør 03:00 lokal tid (industri-standard). */
  runAtHourLocal?: number;
  /** Default 0 — full time. */
  runAtMinuteLocal?: number;
  /** For tester: ignorer time + date-key-guard. */
  alwaysRun?: boolean;
}

/**
 * Tick-funksjon: gater på klokkeslett + date-key, kaller service ved match.
 * Mønster matcher `jackpotDailyTick` og `xmlExportDailyTick`.
 */
export function createWalletReconciliationJob(deps: WalletReconciliationTickDeps) {
  const runAtHour = deps.runAtHourLocal ?? 3;
  const runAtMinute = deps.runAtMinuteLocal ?? 0;
  let lastRunDateKey = "";

  function dateKey(nowMs: number): string {
    const d = new Date(nowMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return async function runWalletReconciliation(nowMs: number): Promise<JobResult> {
    const now = new Date(nowMs);
    const todayKey = dateKey(nowMs);

    if (!deps.alwaysRun) {
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const scheduledMinutes = runAtHour * 60 + runAtMinute;
      if (currentMinutes < scheduledMinutes) {
        return {
          itemsProcessed: 0,
          note: `waiting for ${String(runAtHour).padStart(2, "0")}:${String(runAtMinute).padStart(2, "0")} local`,
        };
      }
      if (todayKey === lastRunDateKey) {
        return { itemsProcessed: 0, note: "already ran today" };
      }
    }

    try {
      const result = await deps.service.reconcileAll();
      lastRunDateKey = todayKey;
      const note =
        `scanned=${result.accountsScanned}` +
        ` divergences=${result.divergencesFound}` +
        ` alertsCreated=${result.alertsCreated}` +
        ` durationMs=${Math.round(result.durationMs)}`;
      if (result.divergencesFound === 0) {
        log.info({ ...result }, "wallet-reconciliation: clean run");
      } else {
        log.warn({ ...result }, "wallet-reconciliation: divergences detected — see alerts");
      }
      return { itemsProcessed: result.divergencesFound, note };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") {
        // Tabell mangler (migrasjon ikke kjørt). Soft-no-op — matcher
        // mønster i swedbankPaymentSync og jackpotDailyTick.
        return {
          itemsProcessed: 0,
          note: "wallet_accounts/wallet_reconciliation_alerts tabell mangler (migrasjon ikke kjørt?)",
        };
      }
      log.error({ err }, "wallet-reconciliation: tick failed");
      throw err;
    }
  };
}
