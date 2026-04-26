/**
 * BIN-767 — Wallet idempotency-key TTL-cleanup (casino-grade industri-standard).
 *
 * Bakgrunn:
 *   `wallet_transactions.idempotency_key` får en UNIQUE-index (partial,
 *   WHERE idempotency_key IS NOT NULL) per
 *   `migrations/20260413000001_initial_schema.sql`. Indexen vokser ubegrenset
 *   med antallet wallet-transaksjoner og samler "døde" idempotency-keys som
 *   ingen klient kan re-bruke fornuftig etter timer/dager (klient-retry-vinduer
 *   er sekunder-til-minutter, ikke uker).
 *
 *   Industri-standard for kasino-/wallet-systemer er 90-dagers retention-vindu.
 *   Etter det er det trygt å NULL-ut nøkkelen — selve transactions-raden
 *   beholdes (audit-trail), men UNIQUE-indexen får droppet den entry.
 *
 * Designvalg:
 *   - Vi NULL-er kun `idempotency_key`-kolonnen, IKKE DELETE av rad. Audit-
 *     trail (operation_id + entries) er bevart fullt ut. Den partielle
 *     UNIQUE-indexen mister bare entry når kolonnen er NULL.
 *   - Batch-deletion (default 1000 rader per iterasjon) for å unngå at en
 *     stor sletting holder en lang lock på indexen. `ctid`-trick gir oss
 *     kontroll over batch-størrelsen uten å trenge en separat PK på
 *     idempotency_key alene.
 *   - Idempotent re-run: matcher kun rader hvor `idempotency_key IS NOT NULL`
 *     og `created_at < cutoff`. Andre kjøring samme dag finner null rader
 *     og no-op-er (etter at første kjøring fjernet alle gamle nøkler).
 *   - Date-key gating (samme pattern som `selfExclusionCleanup`,
 *     `jackpotDailyTick`): cron kjører kun én gang per dag selv om
 *     polling-intervallet er kortere.
 *
 * Standard-tidspunkt: 04:00 lokal tid. Off-peak, etter at daglige rapporter
 * (XML-export 23:00, jackpot-akkum 00:15, RG-cleanup 00:00) har fått ro.
 *
 * Feature-flag: `JOB_IDEMPOTENCY_CLEANUP_ENABLED` — default ON. Industri-
 * standard er 90-dager retention; det er ingen grunn til å la indexen
 * vokse ubegrenset i prod. Kan slås av i staging/dev hvis ønskelig.
 */

import type { Pool } from "pg";
import type { JobResult } from "./JobScheduler.js";
import { logger as rootLogger } from "../util/logger.js";
import { metrics } from "../util/metrics.js";

const log = rootLogger.child({ module: "job:idempotency-key-cleanup" });

export interface IdempotencyKeyCleanupDeps {
  pool: Pool;
  schema: string;
  /**
   * Retention-vindu (dager). Default 90 = industri-standard for kasino-wallet.
   * Eksponert som dep slik at tester kan bruke kortere vinduer.
   */
  retentionDays?: number;
  /**
   * Maks antall rader oppdatert per SQL-iterasjon. Default 1000 — holder
   * lock-tid lav uten å gjøre cron-en uendelig treig på store backlogs.
   */
  batchSize?: number;
  /**
   * Sikkerhetsnett: hvis et batch-loop går mer enn dette antallet
   * iterasjoner kapper vi for å unngå at jobben kjører i evig løkke
   * ved en uoppdaget bug. Default 10_000 (=10M rader maks per kjøring).
   */
  maxBatches?: number;
  /** Lokal kjøre-time. Default 4 (04:00). */
  runAtHourLocal?: number;
  /** For tester: ignorer date-key/hour-guard. */
  alwaysRun?: boolean;
}

export function createIdempotencyKeyCleanupJob(deps: IdempotencyKeyCleanupDeps) {
  const retentionDays = deps.retentionDays ?? 90;
  const batchSize = Math.max(1, deps.batchSize ?? 1000);
  const maxBatches = Math.max(1, deps.maxBatches ?? 10_000);
  const runAtHour = deps.runAtHourLocal ?? 4;
  const table = `"${deps.schema}"."wallet_transactions"`;

  let lastRunDateKey = "";

  function dateKey(nowMs: number): string {
    const d = new Date(nowMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return async function runIdempotencyKeyCleanup(nowMs: number): Promise<JobResult> {
    const now = new Date(nowMs);
    const todayKey = dateKey(nowMs);

    if (!deps.alwaysRun) {
      if (now.getHours() < runAtHour) {
        return {
          itemsProcessed: 0,
          note: `waiting for ${String(runAtHour).padStart(2, "0")}:00 local`,
        };
      }
      if (todayKey === lastRunDateKey) {
        return { itemsProcessed: 0, note: "already ran today" };
      }
    }

    let totalPruned = 0;
    let batches = 0;

    try {
      // Batch-loop: hver iterasjon NULL-er opptil `batchSize` rader hvor
      // idempotency_key er gammel. Stopper når en iterasjon returnerer 0
      // (alle gamle nøkler er ryddet) eller når `maxBatches` nås.
      //
      // Vi bruker `ctid`-subquery + LIMIT for å begrense batch-størrelsen.
      // Dette er PostgreSQL-idiomatisk for "update opp til N rader som
      // matcher predikatet" uten å trenge et eget batch-id-felt.
      //
      // INTERVAL er hardkodet til '1 day' og multiplisert med retentionDays
      // for å unngå SQL-injection mot intervalstreng.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (batches >= maxBatches) {
          log.warn(
            { batches, totalPruned, retentionDays, batchSize },
            "idempotency-key-cleanup: maxBatches nådd — avslutter for å unngå evig løkke"
          );
          break;
        }
        const result = await deps.pool.query<{ pruned: string }>(
          `WITH targets AS (
              SELECT ctid
                FROM ${table}
               WHERE idempotency_key IS NOT NULL
                 AND created_at < now() - ($1::int * INTERVAL '1 day')
               LIMIT $2
            )
            UPDATE ${table} t
               SET idempotency_key = NULL
              FROM targets
             WHERE t.ctid = targets.ctid
           RETURNING 1 AS pruned`,
          [retentionDays, batchSize]
        );
        const rowsThisBatch = result.rowCount ?? 0;
        totalPruned += rowsThisBatch;
        batches += 1;
        if (rowsThisBatch < batchSize) break; // siste (eller eneste) batch
      }
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? "";
      if (code === "42P01") {
        // Tabell mangler (typisk i isolerte tester / fresh dev-DB uten
        // initial-migration). Soft-no-op matcher pattern i andre cron-jobs.
        return {
          itemsProcessed: 0,
          note: "wallet_transactions tabell mangler (migrasjon ikke kjørt?)",
        };
      }
      log.error({ err }, "idempotency-key-cleanup: SQL-feil");
      throw err;
    }

    if (totalPruned > 0) {
      metrics.walletIdempotencyKeysPrunedTotal.inc(totalPruned);
      log.info(
        { totalPruned, batches, retentionDays, batchSize },
        "wallet idempotency-keys pruned"
      );
    }

    lastRunDateKey = todayKey;

    return {
      itemsProcessed: totalPruned,
      note: `pruned=${totalPruned} batches=${batches} retentionDays=${retentionDays}`,
    };
  };
}
