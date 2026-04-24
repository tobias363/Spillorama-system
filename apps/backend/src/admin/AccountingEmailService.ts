/**
 * Accounting email dispatcher for Withdraw XML-batcher.
 *
 * Ansvar:
 *   - Hente aktiv e-post-allowlist (gjenbruk av `SecurityService
 *     .listWithdrawEmails` — PM-beslutning 2026-04-24: bruk eksisterende
 *     `app_withdraw_email_allowlist` som regnskaps-CC, ikke ny tabell).
 *   - Sende XML-vedlegget via `EmailService` (som wrapper nodemailer).
 *   - Oppdatere batch-raden med `email_sent_at` + snapshot av mottakere.
 *
 * Fail-modes:
 *   - Tom allowlist → markBatchEmailSent kalles IKKE; batchen beholdes
 *     som "generated but not sent" og cron kan prøve igjen neste dag.
 *   - SMTP disabled (EmailService.isEnabled === false) → log.warn og
 *     returner `{ sent: false, skipped: true }`. Batch-raden oppdateres
 *     ikke — samme retry-semantikk som tom allowlist.
 *   - Per-mottaker-feil → fortsett med neste mottaker; returner liste
 *     over leverte + feilede. Så lenge minst én mottaker lyktes,
 *     marker batchen som sendt.
 */

import type { EmailService, EmailAttachment } from "../integration/EmailService.js";
import type { SecurityService } from "../compliance/SecurityService.js";
import type {
  WithdrawXmlExportService,
  XmlExportBatch,
} from "./WithdrawXmlExportService.js";
import { DomainError } from "../game/BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "accounting-email-service" });

export interface AccountingEmailServiceDeps {
  emailService: EmailService;
  securityService: SecurityService;
  xmlExportService: WithdrawXmlExportService;
}

export interface SendBatchResult {
  sent: boolean;
  skipped: boolean;
  deliveredTo: string[];
  failedFor: Array<{ email: string; error: string }>;
  batch: XmlExportBatch | null;
}

/**
 * Format epost-body i norsk. Enkel HTML + text-variant; regnskap får
 * XML-en som vedlegg uansett.
 */
function renderBody(batch: XmlExportBatch): { subject: string; html: string; text: string } {
  const date = batch.generatedAt.slice(0, 10);
  const agentPart = batch.agentUserId ? ` for agent ${batch.agentUserId}` : "";
  const subject = `Spillorama — Bank-uttak XML ${date}${agentPart} (${batch.withdrawRequestCount} rader)`;
  const text =
    `Hei,\n\n` +
    `Vedlagt finner du XML-eksport av godkjente bank-uttak${agentPart}.\n\n` +
    `Batch-ID:        ${batch.id}\n` +
    `Generert:        ${batch.generatedAt}\n` +
    `Antall uttak:    ${batch.withdrawRequestCount}\n\n` +
    `Filen er vedlagt denne e-posten.\n\n` +
    `Vennlig hilsen\nSpillorama\n`;
  const html =
    `<p>Hei,</p>` +
    `<p>Vedlagt finner du XML-eksport av godkjente bank-uttak${agentPart}.</p>` +
    `<ul>` +
    `  <li><strong>Batch-ID:</strong> ${batch.id}</li>` +
    `  <li><strong>Generert:</strong> ${batch.generatedAt}</li>` +
    `  <li><strong>Antall uttak:</strong> ${batch.withdrawRequestCount}</li>` +
    `</ul>` +
    `<p>Filen er vedlagt denne e-posten.</p>` +
    `<p>Vennlig hilsen<br>Spillorama</p>`;
  return { subject, html, text };
}

export class AccountingEmailService {
  private readonly emailService: EmailService;
  private readonly securityService: SecurityService;
  private readonly xmlExportService: WithdrawXmlExportService;

  constructor(deps: AccountingEmailServiceDeps) {
    this.emailService = deps.emailService;
    this.securityService = deps.securityService;
    this.xmlExportService = deps.xmlExportService;
  }

  /**
   * Send en eksisterende XML-batch som e-post-vedlegg til allowlist.
   * `xmlContent` er XML-strengen generert av `WithdrawXmlExportService
   * .generateDailyXmlForAgent()` — kaller må sende den inn direkte slik
   * at vi ikke trenger å re-lese filen fra disk.
   */
  async sendXmlBatch(
    batchId: string,
    xmlContent: string
  ): Promise<SendBatchResult> {
    if (!batchId.trim()) {
      throw new DomainError("INVALID_INPUT", "batchId er påkrevd.");
    }

    const { batch } = await this.xmlExportService.getBatch(batchId);

    // Tom batch (0 rader) — skipp sending. Caller kan rapportere som no-op.
    if (batch.withdrawRequestCount === 0) {
      log.info({ batchId }, "sendXmlBatch: batch has 0 rows — skipping email");
      return {
        sent: false,
        skipped: true,
        deliveredTo: [],
        failedFor: [],
        batch,
      };
    }

    const emails = await this.securityService.listWithdrawEmails();
    if (emails.length === 0) {
      log.warn(
        { batchId },
        "sendXmlBatch: allowlist is empty — batch remains unsent"
      );
      return {
        sent: false,
        skipped: true,
        deliveredTo: [],
        failedFor: [],
        batch,
      };
    }

    if (!this.emailService.isEnabled()) {
      log.warn(
        { batchId, recipientCount: emails.length },
        "sendXmlBatch: SMTP disabled — batch remains unsent"
      );
      return {
        sent: false,
        skipped: true,
        deliveredTo: [],
        failedFor: [],
        batch,
      };
    }

    const { subject, html, text } = renderBody(batch);
    const filename =
      `spillorama-withdraw-${batch.generatedAt.slice(0, 10)}-${batch.id.slice(0, 8)}.xml`;
    const attachment: EmailAttachment = {
      filename,
      content: xmlContent,
      contentType: "application/xml",
    };

    const delivered: string[] = [];
    const failed: Array<{ email: string; error: string }> = [];
    for (const entry of emails) {
      try {
        const result = await this.emailService.sendEmail({
          to: entry.email,
          subject,
          html,
          text,
          attachments: [attachment],
        });
        if (result.skipped) {
          failed.push({ email: entry.email, error: "EMAIL_SKIPPED" });
        } else {
          delivered.push(entry.email);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, batchId, email: entry.email },
          "sendXmlBatch: per-recipient send failed"
        );
        failed.push({ email: entry.email, error: msg });
      }
    }

    // Minst én levert → marker batch som sendt med snapshot av mottakere.
    let updatedBatch = batch;
    if (delivered.length > 0) {
      updatedBatch = await this.xmlExportService.markBatchEmailSent(
        batchId,
        delivered
      );
    }

    return {
      sent: delivered.length > 0,
      skipped: delivered.length === 0,
      deliveredTo: delivered,
      failedFor: failed,
      batch: updatedBatch,
    };
  }
}
