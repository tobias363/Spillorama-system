/**
 * Withdraw XML-eksport daglig cron.
 *
 * Kjører én gang per dag (ca kl. 23:00 lokal tid — legacy lignet cron-
 * mønsteret fra de andre daglige jobbene). For hver aktiv agent som har
 * ACCEPTED bank-uttak siden forrige batch, genereres en XML + sendes som
 * vedlegg til regnskaps-allowlisten.
 *
 * Guarding:
 *   - `lastRunDateKey` sørger for at jobben bare kjører én gang per dag
 *     selv om scheduler-ticker polling-intervallet er kortere.
 *   - `runAtHourLocal` — defaulter til 23 (sent på kvelden). Testing via
 *     `alwaysRun=true`.
 *
 * Feil-semantikk:
 *   - Per-agent feil ruller ikke tilbake andre agenters batcher — logges
 *     og hoppes videre. Dette speiler pattern i `machineTicketAutoClose`.
 *   - Hvis SMTP er disabled eller allowlist er tom, genereres XML-fil +
 *     DB-rad likevel (slik at rader flyttes til EXPORTED); e-post
 *     markeres som ikke-sendt og batchen kan sendes manuelt via admin-UI.
 */

import type { JobResult } from "./JobScheduler.js";
import type { WithdrawXmlExportService } from "../admin/WithdrawXmlExportService.js";
import type { AccountingEmailService } from "../admin/AccountingEmailService.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "job:xml-export-daily" });

export interface XmlExportDailyTickDeps {
  xmlExportService: WithdrawXmlExportService;
  accountingEmailService: AccountingEmailService;
  /** Default 23 (lokal tid). */
  runAtHourLocal?: number;
  /** For tester: ignorer hour/date-key-guard. */
  alwaysRun?: boolean;
}

export function createXmlExportDailyTickJob(deps: XmlExportDailyTickDeps) {
  const runAtHour = deps.runAtHourLocal ?? 23;
  let lastRunDateKey = "";

  function dateKey(nowMs: number): string {
    const d = new Date(nowMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return async function runXmlExportDailyTick(nowMs: number): Promise<JobResult> {
    const now = new Date(nowMs);
    const todayKey = dateKey(nowMs);

    if (!deps.alwaysRun) {
      if (now.getHours() < runAtHour) {
        return { itemsProcessed: 0, note: `waiting for ${runAtHour}:00 local` };
      }
      if (todayKey === lastRunDateKey) {
        return { itemsProcessed: 0, note: "already ran today" };
      }
    }

    let agentIds: Array<string | null>;
    try {
      agentIds = await deps.xmlExportService.listDistinctAgentUserIds();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "42P01" || code === "42703") {
        return { itemsProcessed: 0, note: "xml tables missing (42P01/42703)" };
      }
      throw err;
    }

    if (agentIds.length === 0) {
      lastRunDateKey = todayKey;
      return { itemsProcessed: 0, note: "no accepted bank withdrawals" };
    }

    let batchesGenerated = 0;
    let rowsExported = 0;
    let emailsSent = 0;
    let emailsSkipped = 0;
    const errors: string[] = [];

    for (const agentId of agentIds) {
      try {
        const result = await deps.xmlExportService.generateDailyXmlForAgent(agentId);
        if (result.rows.length === 0) {
          continue;
        }
        batchesGenerated += 1;
        rowsExported += result.rows.length;

        // Send e-post med XML som vedlegg.
        const sendResult = await deps.accountingEmailService.sendXmlBatch(
          result.batch.id,
          result.xmlContent
        );
        if (sendResult.sent) {
          emailsSent += sendResult.deliveredTo.length;
        } else {
          emailsSkipped += 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${agentId ?? "none"}:${msg}`);
        log.warn({ err, agentId }, "xmlExportDailyTick: per-agent failure");
      }
    }

    lastRunDateKey = todayKey;

    const note =
      `batches=${batchesGenerated} rows=${rowsExported}` +
      ` mailsDelivered=${emailsSent} mailsSkipped=${emailsSkipped}` +
      (errors.length ? ` errors=${errors.length}` : "");
    return {
      itemsProcessed: batchesGenerated,
      note,
    };
  };
}
